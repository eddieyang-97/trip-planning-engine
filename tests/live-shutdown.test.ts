import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {pooledDatabase} from '../src/database.js';
import {randomUUID} from 'node:crypto';
import {Core,saveOffer} from '../src/core.js';
import {embedded,migrate,type Database} from '../src/database.js';
import {SerpApiFlightProvider} from '../src/live-provider.js';
import {runOneLiveJob} from '../src/live-search.js';
import {startSearchWorker} from '../src/search-worker.js';
import {flaineCriteria,flaineTrip} from '../src/acceptance.js';

const key=()=>({idempotencyKey:randomUUID()}),secret='isolated-provider-secret';
const account={account_status:'Active',plan_monthly_price:0,plan_searches_left:100,account_rate_limit_per_hour:100,this_hour_searches:0};
const criteria={...flaineCriteria,origins:['LHR','LGW','LTN'],outbound:'2027-01-14',inbound:null,adults:4};
function response(url:URL){return Response.json({search_metadata:{status:'Success'},search_parameters:Object.fromEntries(url.searchParams),best_flights:[{
  flights:[{airline:'Fictional Air',flight_number:'FIXTURE1',travel_class:'Economy',
    departure_airport:{id:url.searchParams.get('departure_id'),time:'2027-01-14 08:00'},arrival_airport:{id:'GVA',time:'2027-01-14 10:30'}}],price:123,
}]});}
function gate(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};}
async function setup(db:Database){
  const actor={userId:randomUUID(),clientId:'isolated-shutdown'},core=new Core(db,false,true);
  await db.query('insert into client_grants values($1,$2,$3,null)',[actor.userId,actor.clientId,['read','write','search']]);
  const trip=await core.call('create_trip',{...key(),...flaineTrip},actor);
  const decision=await core.call('create_decision',{...key(),tripId:trip.tripId,title:'Synthetic interruption',criteria},actor);
  const args={...key(),decisionId:decision.decisionId,expectedRevision:1,criteriaVersion:1,provider:'live'};
  const run=await core.call('start_search',args,actor);
  return {actor,core,decision,args,run};
}

// Every transport is injected. A cancellation need not be acknowledged by a supplier.
test('shutdown before claim leaves queued work and quota unchanged; scheduler stop aborts active work', {timeout:10000},async()=>{
  const db=await embedded();await migrate(db);let worker:ReturnType<typeof startSearchWorker>|undefined;
  try{
    const s=await setup(db),cancel=new AbortController();cancel.abort();
    assert.equal(await runOneLiveJob(db,new SerpApiFlightProvider(secret,async()=>assert.fail('no dispatch')),saveOffer,cancel.signal),false);
    assert.equal((await s.core.call('get_search_run',{runId:s.run.runId},s.actor)).status,'queued');
    assert.equal((await db.query('select count(*)::int as n from provider_attempts')).rows[0]!.n,0);
    const entered=gate();let aborted=false;
    worker=startSearchWorker(async signal=>{entered.resolve();await new Promise<void>(resolve=>signal.addEventListener('abort',()=>{aborted=true;resolve();},{once:true}));},()=>assert.fail('worker failed'),5);
    await entered.promise;const stopped=worker.stop();assert.equal(worker.stop(),stopped);await stopped;
    assert.equal(aborted,true);
    assert.equal((await db.query('select sum(requests)::int as n from live_search_usage')).rows[0]!.n,3);
  }finally{await worker?.stop();await db.close();}
});

for(const phase of ['preflight','body',1,2,3] as const)test(`shutdown interrupts ${phase} promptly, persists partial evidence and never replays`,{timeout:15000},async()=>{
  const db=await embedded();await migrate(db);const entered=gate(),cancel=new AbortController();let searches=0,accounts=0,signal:AbortSignal|undefined;
  try{
    const s=await setup(db),provider=new SerpApiFlightProvider(secret,async(input,init)=>{
      const url=new URL(String(input));signal=init?.signal??undefined;
      if(url.pathname==='/account.json'){
        accounts++;if(phase==='preflight'){entered.resolve();return new Promise<Response>(()=>{});}return Response.json(account);
      }
      searches++;
      assert.equal((await db.query('select status from provider_attempts where run_id=$1 and attempt=$2',[s.run.runId,searches])).rows[0]!.status,'reserved');
      if(phase===searches){entered.resolve();return new Promise<Response>(()=>{});}
      if(phase==='body'){entered.resolve();return {ok:true,status:200,json:()=>new Promise(()=>{})} as Response;}
      return response(url);
    });
    const work=runOneLiveJob(db,provider,saveOffer,cancel.signal);await entered.promise;
    const start=performance.now();cancel.abort(new Error('private shutdown diagnostics'));await work;
    assert.ok(performance.now()-start<2000,'healthy persistence has ample margin inside the 30s platform budget');assert.equal(signal?.aborted,true);
    const fresh=new Core(db,false,true),ready=await fresh.call('get_search_run',{runId:s.run.runId},s.actor);
    const expectedCalls=typeof phase==='number'?phase:phase==='body'?1:0;
    assert.equal(accounts,1);assert.equal(searches,expectedCalls);assert.equal(ready.status,'outcome_unknown');assert.equal(ready.coverage.acceptedObservationCount,Math.max(0,expectedCalls-1));
    assert.equal(ready.observations.length,Math.max(0,expectedCalls-1));assert.equal(ready.error_code,'worker_interrupted');
    assert.deepEqual(ready.attempts.map((a:any)=>a.status),Array.from({length:expectedCalls},(_,i)=>i===expectedCalls-1?'outcome_unknown':'success'));
    assert.equal(JSON.stringify(ready).includes(secret),false);assert.equal(JSON.stringify(ready).includes('private shutdown'),false);
    await assert.rejects(fresh.call('get_search_run',{runId:s.run.runId},{...s.actor,userId:randomUUID()}));
    assert.equal((await fresh.call('start_search',s.args,s.actor)).runId,s.run.runId);
    assert.equal(await runOneLiveJob(db,provider,saveOffer),false);assert.equal(searches,expectedCalls);
    assert.equal((await db.query('select count(*)::int as n from search_runs')).rows[0]!.n,1);
    assert.equal((await db.query('select count(*)::int as n from provider_attempts')).rows[0]!.n,expectedCalls);
    assert.equal((await db.query('select sum(requests)::int as n from live_search_usage')).rows[0]!.n,3);
    assert.equal((await db.query('select count(*)::int as n from observations')).rows[0]!.n,Math.max(0,expectedCalls-1));
  }finally{cancel.abort();await db.close();}
});

for(const boundary of ['after_preflight','after_intent','between_queries','after_partial_save'] as const)test(`shutdown at ${boundary} does not dispatch another request`,{timeout:15000},async()=>{
  const db=await embedded();await migrate(db);const cancel=new AbortController();let searches=0;
  try{
    const s=await setup(db);
    const provider=new SerpApiFlightProvider(secret,async input=>{
      const url=new URL(String(input));
      if(url.pathname==='/account.json'){if(boundary==='after_preflight')cancel.abort();return Response.json(account);}
      searches++;return response(url);
    });
    const wrapped={search:((c,record,plan,signal)=>provider.search(c,async event=>{
      await record(event);
      if((boundary==='after_intent'&&event.status==='reserved')||(boundary==='between_queries'&&event.status==='success'))cancel.abort();
    },plan,signal)) as typeof provider.search};
    const save:typeof saveOffer=async(...args)=>{const result=await saveOffer(...args);if(boundary==='after_partial_save')cancel.abort();return result;};
    await runOneLiveJob(db,wrapped,save,cancel.signal);
    const ready=await new Core(db,false,true).call('get_search_run',{runId:s.run.runId},s.actor);
    const calls=boundary==='after_partial_save'?3:boundary==='between_queries'?1:0;
    assert.equal(searches,calls);assert.equal(ready.observations.length,calls);
    assert.equal(ready.status,boundary==='after_partial_save'?'complete':'outcome_unknown');
    assert.equal(ready.attempts.length,boundary==='after_intent'?1:calls);
    if(boundary==='after_intent')assert.equal(ready.attempts[0].status,'outcome_unknown');
    await runOneLiveJob(db,wrapped,save);assert.equal(searches,calls);
    assert.equal((await db.query('select sum(requests)::int as n from live_search_usage')).rows[0]!.n,3);
  }finally{await db.close();}
});

for(const interrupted of [2,3])test(`return expansion ${interrupted} interruption keeps completed return observations`,{timeout:15000},async()=>{
  const db=await embedded();await migrate(db);const cancel=new AbortController(),entered=gate();let searches=0;
  try{
    const s=await setup(db);
    // Separate return decision; no mutation of real trips or provider fixtures.
    const d=await s.core.call('create_decision',{...key(),tripId:(await s.core.call('get_decision',{decisionId:s.decision.decisionId},s.actor)).decision.trip_id,title:'Return interruption',criteria:{...criteria,origins:['LHR'],inbound:'2027-01-18'}},s.actor);
    // Leave the original synthetic run terminal so admission selects this return run.
    await db.query("update search_runs set status='failed',error_code='TEST_ONLY' where id=$1",[s.run.runId]);
    const run=await s.core.call('start_search',{...key(),decisionId:d.decisionId,expectedRevision:1,criteriaVersion:1,provider:'live'},s.actor);
    const provider=new SerpApiFlightProvider(secret,async(input)=>{
      const url=new URL(String(input));if(url.pathname==='/account.json')return Response.json(account);
      searches++;if(searches===interrupted){entered.resolve();return new Promise<Response>(()=>{});}
      const leg=(back:boolean,index:number)=>({flights:[{airline:'Fictional Air',flight_number:`FIXTURE${back?'B':'A'}${index}`,travel_class:'Economy',
        departure_airport:{id:back?'GVA':'LHR',time:back?'2027-01-18 12:00':`2027-01-14 ${index?'09':'08'}:00`},
        arrival_airport:{id:back?'LHR':'GVA',time:back?'2027-01-18 13:00':`2027-01-14 ${index?'11':'10'}:30`}}],price:123,departure_token:`fictional-${index}`});
      return Response.json({search_metadata:{status:'Success'},search_parameters:Object.fromEntries(url.searchParams),best_flights:url.searchParams.has('departure_token')?[leg(true,0)]:[leg(false,0),leg(false,1)]});
    });
    const work=runOneLiveJob(db,provider,saveOffer,cancel.signal);await entered.promise;cancel.abort();await work;
    const ready=await new Core(db,false,true).call('get_search_run',{runId:run.runId},s.actor);
    assert.equal(ready.status,'outcome_unknown');assert.equal(ready.observations.length,interrupted===3?1:0);
    assert.equal(ready.attempts.at(-1).status,'outcome_unknown');assert.equal(ready.attempts.at(-1).stage,'return');
    assert.equal(ready.coverage.acceptedObservationCount,interrupted===3?1:0);
    await runOneLiveJob(db,provider,saveOffer);assert.equal(searches,interrupted);
  }finally{cancel.abort();await db.close();}
});

test('pooled PostgreSQL shutdown persists partial results; failed finalization recovers without replay',{
  skip:!process.env.TEST_POSTGRES_URL,timeout:30000,
},async()=>{
  const url=new URL(process.env.TEST_POSTGRES_URL!);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));assert.equal(url.search,'');
  const schema='shutdown_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:url.href,max:1});
  let db:Database|undefined;
  try{
    await admin.query(`create schema ${schema}`);
    db=pooledDatabase(new pg.Pool({connectionString:url.href,max:5,options:`-c search_path=${schema}`,statement_timeout:5000}));
    for(const file of ['001_initial.sql','003_policy_notes.sql','004_itinerary.sql','005_live_search.sql','006_itinerary_sharing.sql','007_itinerary_editors.sql','008_itinerary_view_links.sql','009_itinerary_comments.sql','010_account_profiles.sql','011_trip_lifecycle.sql'])await db.execute(await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
    for(const failPersistence of [false,true]){
      const s=await setup(db),cancel=new AbortController(),entered=gate();let searches=0,failed=false;
      const provider=new SerpApiFlightProvider(secret,async input=>{
        const url=new URL(String(input));if(url.pathname==='/account.json')return Response.json(account);
        searches++;if(searches===2){entered.resolve();return new Promise<Response>(()=>{});}return response(url);
      });
      const underlying=db;
      const guarded:Database={...db,transaction:((work,options)=>{
        if(failed)return Promise.reject(Error('isolated DB outage'));
        return underlying.transaction(async tx=>work({...tx,query:async(sql,params)=>{
          // Fail before acknowledging the in-flight attempt, then keep finalization unavailable.
          if(failPersistence&&sql.includes('update provider_attempts set status=$3')&&params?.[2]==='outcome_unknown'){
            failed=true;throw Error('isolated DB outage');
          }
          return tx.query(sql,params);
        }}),options);
      }) as Database['transaction']};
      const work=runOneLiveJob(guarded,provider,saveOffer,cancel.signal);await entered.promise;cancel.abort();
      if(failPersistence){
        await assert.rejects(work);
        assert.equal((await db.query('select status from provider_attempts where run_id=$1 and attempt=2',[s.run.runId])).rows[0]!.status,'reserved');
        assert.equal((await db.query('select status from search_runs where id=$1',[s.run.runId])).rows[0]!.status,'running');
        await db.query("update search_runs set lease_until=now()-interval '1 second' where id=$1",[s.run.runId]);
      }else await work;
      await runOneLiveJob(db,new SerpApiFlightProvider(secret,async()=>assert.fail('restart must not dispatch')),saveOffer);
      const fresh=new Core(db,false,true),ready=await fresh.call('get_search_run',{runId:s.run.runId},s.actor);
      assert.equal(ready.status,'outcome_unknown');assert.equal(searches,2);
      assert.deepEqual(ready.attempts.map((a:any)=>a.status),['success','outcome_unknown']);
      assert.equal(ready.coverage.pairs[2].outbound.status,'not_attempted');
      assert.equal(ready.observations.length,failPersistence?0:1);
      assert.equal((await fresh.call('start_search',s.args,s.actor)).runId,s.run.runId);
      assert.equal((await db.query('select count(*)::int as n from provider_attempts where run_id=$1',[s.run.runId])).rows[0]!.n,2);
      assert.equal((await db.query('select sum(requests)::int as n from live_search_usage where requested_by=$1',[s.actor.userId])).rows[0]!.n,3);
    }
  }finally{await db?.close();await admin.query(`drop schema if exists ${schema} cascade`);await admin.end();}
});

test('late supplier acknowledgement after abort cannot change the terminal run or add observations',{timeout:10000},async()=>{
  const db=await embedded();await migrate(db);const entered=gate(),late=gate(),cancel=new AbortController();let searches=0;
  try{
    const s=await setup(db),provider=new SerpApiFlightProvider(secret,async input=>{
      const url=new URL(String(input));if(url.pathname==='/account.json')return Response.json(account);
      searches++;entered.resolve();await late.promise;return response(url);
    });
    const work=runOneLiveJob(db,provider,saveOffer,cancel.signal);await entered.promise;cancel.abort();await work;
    const before=await s.core.call('get_search_run',{runId:s.run.runId},s.actor);
    late.resolve();await new Promise<void>(resolve=>setImmediate(resolve));
    const after=await new Core(db,false,true).call('get_search_run',{runId:s.run.runId},s.actor);
    assert.deepEqual(after,before);assert.equal(after.status,'outcome_unknown');assert.equal(after.observations.length,0);assert.equal(searches,1);
    assert.equal((await db.query('select count(*)::int as n from provider_attempts')).rows[0]!.n,1);
  }finally{late.resolve();await db.close();}
});
