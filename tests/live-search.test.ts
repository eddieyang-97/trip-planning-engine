import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {embedded,migrate} from '../src/database.js';
import {Core,saveOffer} from '../src/core.js';
import {SerpApiFlightProvider,airportInstant} from '../src/live-provider.js';
import {runOneLiveJob} from '../src/live-search.js';
import {flaineCriteria,flaineTrip} from '../src/acceptance.js';
import {probeQuery} from '../src/serpapi-probe.js';
import {configuration} from '../src/config.js';

const key=()=>({idempotencyKey:randomUUID()});
const account={account_status:'Active',plan_monthly_price:0,plan_searches_left:3,account_rate_limit_per_hour:3,this_hour_searches:0};
function leg(back=false) {return {flights:[{airline:'easyJet',flight_number:back?'TEST2':'TEST1',travel_class:'Economy',
  departure_airport:{id:back?'GVA':'LGW',time:back?'2026-12-20 12:35':'2026-12-18 08:30'},
  arrival_airport:{id:back?'LGW':'GVA',time:back?'2026-12-20 13:15':'2026-12-18 11:10'}}],
  ...(back?{booking_token:'private-booking-token'}:{departure_token:'private-departure-token'})};}
function body(url:URL) {
  if(url.pathname==='/account.json')return account;
  return {search_metadata:{status:'Success',google_flights_url:'https://www.google.com/travel/flights'},search_parameters:probeQuery,
    ...(url.searchParams.has('booking_token')?{selected_flights:[leg(),leg(true)],booking_options:[{together:{book_with:'easyJet',price:452}}]}:
      url.searchParams.has('departure_token')?{other_flights:[leg(true)]}:{best_flights:[leg()]})};
}
async function setup() {
  const db=await embedded();await migrate(db);
  const actor={userId:randomUUID(),clientId:'pilot'};
  await db.query('insert into client_grants values($1,$2,$3,null)',[actor.userId,actor.clientId,['read','write','search']]);
  const core=new Core(db,false,true),trip=await core.call('create_trip',{...key(),...flaineTrip},actor);
  const decision=await core.call('create_decision',{...key(),tripId:trip.tripId,title:'Flights',criteria:flaineCriteria},actor);
  const args={...key(),decisionId:decision.decisionId,expectedRevision:1,criteriaVersion:1,provider:'live'};
  return {db,core,actor,decision,args};
}
test('live pilot reserves once, calls three stages, persists provider evidence and never leaks tokens',async()=>{
  const {db,core,actor,args}=await setup();
  try {
    const run=await core.call('start_search',args,actor);
    assert.equal((await core.call('start_search',args,actor)).runId,run.runId);
    let requests=0;
    const provider=new SerpApiFlightProvider('private-key',async input=>{
      const url=new URL(String(input));
      if(url.pathname==='/search.json') {
        requests++;
        const attempt=(await db.query('select status from provider_attempts where run_id=$1 and attempt=$2',[run.runId,requests])).rows[0];
        assert.equal(attempt?.status,'reserved','commit durable intent before sending');
      }
      return Response.json(body(url));
    });
    assert.equal(await runOneLiveJob(db,provider,saveOffer),true);
    assert.equal(await runOneLiveJob(db,provider,saveOffer),false);
    const result=await core.call('get_search_run',{runId:run.runId},actor);
    assert.equal(result.status,'complete');assert.equal(requests,3);assert.equal(result.attempts.length,3);
    assert.equal(result.observations[0].provenance,'provider_reported');
    const offer=result.observations[0].payload;
    assert.equal(offer.priceMinor,45200);assert.equal(offer.priceBasis,'unknown');assert.equal(offer.exactPartyQuoted,false);
    assert.equal(offer.snowboardTotalMinor,null);assert.equal(offer.expiresAt,null);
    assert.equal(offer.outbound[0].arrival,'2026-12-18T10:10:00.000Z');
    assert.equal(result.coverage.complete,false);
    assert.equal(JSON.stringify(result).includes('private-'),false);
    await assert.rejects(core.call('get_search_run',{runId:run.runId},{...actor,userId:randomUUID()}));
  }finally{await db.close();}
});
test('concurrent starts are idempotent and owner allowance cannot be bypassed with new keys',async()=>{
  const {db,core,actor,args}=await setup();
  try {
    const runs=await Promise.all([core.call('start_search',args,actor),core.call('start_search',args,actor)]);
    assert.equal(runs[0]!.runId,runs[1]!.runId);
    await core.call('start_search',{...args,...key(),expectedRevision:2},actor);
    await assert.rejects(core.call('start_search',{...args,...key(),expectedRevision:3},actor),{code:'BUDGET_EXCEEDED'});
    assert.equal((await db.query('select sum(reserved_requests)::int as n from search_runs')).rows[0]!.n,6);
  }finally{await db.close();}
});
test('expired live work becomes uncertain and is never resent; queued revoked work sends nothing',async()=>{
  const {db,core,actor,args}=await setup();
  try {
    const old=await core.call('start_search',args,actor);
    await db.query("update search_runs set status='running',lease_until=now()-interval '1 second' where id=$1",[old.runId]);
    await db.query("insert into provider_attempts(run_id,attempt,stage,status) values($1,1,'outbound','reserved')",[old.runId]);
    const queued=await core.call('start_search',{...args,...key(),expectedRevision:2},actor);
    await db.query('update client_grants set revoked_at=now() where owner_id=$1',[actor.userId]);
    const provider=new SerpApiFlightProvider('private-key',async()=>{assert.fail('must not send');});
    await runOneLiveJob(db,provider,saveOffer);
    const rows=(await db.query('select id,status,error_code from search_runs')).rows;
    assert.equal(rows.find(r=>r.id===old.runId)!.status,'outcome_unknown');
    assert.equal(rows.find(r=>r.id===queued.runId)!.error_code,'AUTHORIZATION_REVOKED');
    assert.equal((await db.query('select status from provider_attempts')).rows[0]!.status,'outcome_unknown');
  }finally{await db.close();}
});
test('revocation between stages prevents further spending; network uncertainty consumes a single attempt',async()=>{
  for(const revoke of [false,true]) {
    const {db,core,actor,args}=await setup();
    try {
      const run=await core.call('start_search',args,actor);let searches=0;
      const provider=new SerpApiFlightProvider('private-key',async input=>{
        const url=new URL(String(input));
        if(url.pathname==='/search.json') {
          searches++;
          if(!revoke)throw Error(String(input));
          await db.query('update client_grants set revoked_at=now() where owner_id=$1',[actor.userId]);
        }
        return Response.json(body(url));
      });
      await runOneLiveJob(db,provider,saveOffer);await runOneLiveJob(db,provider,saveOffer);
      assert.equal(searches,1);
      const row=(await db.query('select * from search_runs where id=$1',[run.runId])).rows[0]!;
      assert.notEqual(row.status,'complete');assert.equal(JSON.stringify(row).includes('private-key'),false);
    }finally{await db.close();}
  }
});
test('explicit opt-in and supported scope required; wall time conversion rejects DST ambiguities',async()=>{
  assert.equal(configuration({SERPAPI_API_KEY:'key'}).liveSearch,false);
  assert.throws(()=>configuration({LIVE_SEARCH_ENABLED:'true'}),/SERPAPI_API_KEY/);
  assert.throws(()=>configuration({LIVE_SEARCH_ENABLED:'yes'}),/LIVE_SEARCH_ENABLED/);
  assert.equal(airportInstant('2026-10-25 01:30','LGW'),null);
  assert.equal(airportInstant('2026-03-29 01:30','LGW'),null);
  assert.equal(airportInstant('2026-12-18 11:10','XXX'),null);
  const provider=new SerpApiFlightProvider('key',async()=>{assert.fail('must not send');});
  await assert.rejects(provider.search({...flaineCriteria,adults:3},async()=>{}),{code:'UNSUPPORTED_SEARCH'});
  const {db,actor,args}=await setup();
  try{await assert.rejects(new Core(db,false).call('start_search',args,actor),{code:'PROVIDER_ACCESS_REQUIRED'});}
  finally{await db.close();}
});
