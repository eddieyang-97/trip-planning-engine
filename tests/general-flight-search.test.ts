import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {SerpApiFlightProvider,airportInstant,liveQuery,validateLiveCriteria} from '../src/live-provider.js';
import {criteriaSchema,evaluate,identity,offerSchema,type Criteria} from '../src/domain.js';
import {flaineCriteria} from '../src/acceptance.js';
import {embedded,migrate} from '../src/database.js';
import {Core,saveOffer} from '../src/core.js';
import {runOneLiveJob} from '../src/live-search.js';
import type {ProbeEvent} from '../src/serpapi-probe.js';
import {draftResearchFlight} from '../web/itinerary-research.js';
import {createServer} from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createApp} from '../src/app.js';

const key=()=>({idempotencyKey:randomUUID()});
const criteria=(change:Partial<Criteria>={})=>criteriaSchema.parse({...flaineCriteria,origins:['LHR','LGW','LTN','STN','LCY','SEN'],outbound:'2027-01-14',inbound:'2027-01-18',snowboardRequired:false,...change});
const account={account_status:'Active',plan_monthly_price:0,plan_searches_left:250,account_rate_limit_per_hour:50,this_hour_searches:0};
function leg(origin:string,destination:string,day:string,number:string,price=100,token?:string){
  return {flights:[{flight_number:number,airline:number.startsWith('BA')?'British Airways':'easyJet',travel_class:'Economy',
    departure_airport:{id:origin,time:day+' 08:00'},arrival_airport:{id:destination,time:day+' 11:00'},extensions:['Cabin bag allowance unverified']}],
    price,extensions:['Checked baggage may cost extra'],...(token?{departure_token:token}:{})};
}
function transport(change?:(body:any,url:URL)=>Response|void){
  const calls:URL[]=[];
  const send:typeof fetch=async input=>{
    const url=new URL(String(input));calls.push(url);if(url.pathname==='/account.json')return Response.json(account);
    const q=Object.fromEntries(url.searchParams),origin=q.departure_id!.split(',')[0]!,destination=q.arrival_id!;
    const body:any={search_metadata:{status:'Success',created_at:'2026-10-01 12:00:00 UTC',google_flights_url:'https://www.google.com/travel/flights'},search_parameters:q};
    if(q.departure_token)body.other_flights=[leg(destination,q.departure_token==='two'?'LGW':origin,q.return_date!,'U2 10',200),leg(destination,origin,q.return_date!,'BA 11',240)];
    else body.best_flights=[leg(origin,destination,q.outbound_date!,'BA 1',100,'one'),leg(q.departure_id!.includes('LGW')?'LGW':origin,destination,q.outbound_date!,'U2 2',110,'two'),leg(origin,destination,q.outbound_date!,'BA 3',120,'three')];
    return change?.(body,url)??Response.json(body);
  };
  return {send,calls};
}
test('arbitrary airports, dates and party build bounded return query and several airline options',async()=>{
  const {send,calls}=transport(),events:ProbeEvent[]=[];
  const result=await new SerpApiFlightProvider('test-secret',send).search(criteria(),async e=>{events.push(e);});
  assert.equal(result.report.status,'completed');assert.equal(calls.length,4);assert.equal(result.report.requestsAttempted,3);
  assert.equal(calls[1]!.searchParams.get('departure_id'),'LHR,LGW,LTN,STN,LCY,SEN');
  assert.equal(calls[1]!.searchParams.get('adults'),'4');assert.equal(calls[1]!.searchParams.get('stops'),'3');
  assert.equal(calls.some(u=>u.searchParams.has('booking_token')),false);
  assert.equal(result.offers.length,4);assert.ok(result.offers.some(o=>o.outbound[0]!.operatingFlight.startsWith('BA')));
  assert.ok(result.offers.some(o=>o.outbound[0]!.operatingFlight.startsWith('U2')));
  assert.equal(result.report.coverage.expandedOutboundCount,2);assert.equal(result.report.coverage.complete,false);
  assert.deepEqual(result.report.coverage.queriedAirports,criteria().origins);
  assert.deepEqual(result.report.coverage.returnedAirports,['LHR','LGW']);
  for(const offer of result.offers){assert.equal(offer.priceBasis,'unknown');assert.equal(offer.priceMinor===20000||offer.priceMinor===24000,true);assert.equal(offer.exactPartyQuoted,false);assert.equal(offer.expiresAt,null);assert.equal(offer.snowboardAllowed,'unknown');assert.equal(offer.discovery!.supplierObservedAt,'2026-10-01T12:00:00.000Z');assert.ok(offer.discovery!.baggage.outbound.length);assert.equal(evaluate(offer,criteria()).totalMinor,null);}
  assert.deepEqual(events.map(e=>e.status),['reserved','success','reserved','success','reserved','success']);
  assert.equal(JSON.stringify(result).includes('test-secret'),false);assert.equal(JSON.stringify(result).includes('departure_token'),false);
});

test('one-way supports non-European routes and party endpoints without return calls or invented legs',async()=>{
  for(const adults of [1,9]){
    const c=criteria({origins:['JFK'],destination:'LAX',outbound:'2027-04-02',inbound:null,adults});
    const {send,calls}=transport(),result=await new SerpApiFlightProvider('test-secret',send).search(c,async()=>{});
    assert.equal(calls.length,2);assert.equal(calls[1]!.searchParams.get('type'),'2');assert.equal(calls[1]!.searchParams.has('return_date'),false);
    assert.equal(result.offers.length,3);const offer=result.offers[0]!;assert.deepEqual(offer.inbound,[]);
    assert.equal(offer.adults,adults);assert.equal(offer.discovery!.priceScope,'one_way');assert.equal(evaluate(offer,c).travelMinutes,360);
    assert.equal(evaluate(offer,c).checks.find(v=>v.constraint==='dates')!.verdict,'pass');
    assert.equal(evaluate(offer,criteria({origins:['JFK'],destination:'LAX',outbound:c.outbound,inbound:'2027-04-05'})).eligibility,'ineligible');
    assert.notEqual(identity(offer),identity({...offer,inbound:[...offer.outbound]}));
    assert.ok(draftResearchFlight({id:'x',candidateId:'x',disposition:'neutral',provenance:'provider_reported',offer,selected:false,bookingReported:false},'outbound').title.includes('JFK'));
    assert.throws(()=>draftResearchFlight({id:'x',candidateId:'x',disposition:'neutral',provenance:'provider_reported',offer,selected:false,bookingReported:false},'inbound'));
  }
  assert.equal(airportInstant('2027-01-14 08:00','DEL'),'2027-01-14T02:30:00.000Z');
  assert.equal(airportInstant('2027-01-14 08:00','HND'),'2027-01-13T23:00:00.000Z');
});

test('invalid input fails before provider dispatch or durable budget admission',async()=>{
  for(const change of [{adults:0},{adults:10},{outbound:'2027-02-30'},{inbound:'2027-01-01'},{origins:['LHR','LHR']},{destination:'LHR'},{origins:Array(7).fill('LGW')}])assert.throws(()=>criteria(change as any));
  assert.throws(()=>validateLiveCriteria(criteria({origins:['LON']})),{code:'UNSUPPORTED_AIRPORT'});
  assert.throws(()=>validateLiveCriteria(criteria({outbound:'2020-01-01'})),{code:'UNSUPPORTED_SEARCH'});
  const {db,core,actor,decision,args}=await setup(criteria({origins:['XXX']}));
  try{await assert.rejects(core.call('start_search',args,actor),{code:'UNSUPPORTED_AIRPORT'});assert.equal((await db.query('select count(*)::int as n from search_runs')).rows[0]!.n,0);assert.equal((await db.query('select count(*)::int as n from live_search_usage')).rows[0]!.n,0);assert.equal((await core.call('get_decision',{decisionId:decision.decisionId},actor)).decision.revision,1);}finally{await db.close();}
});

test('empty, mismatched echo, malformed legs, wrong cabin, stops and dates do not fabricate coverage',async()=>{
  for(const mode of ['empty','echo','date','zone','cabin','connection'] as const){
    const {send}=transport(body=>{
      if(mode==='empty')body.best_flights=[];
      if(mode==='echo')body.search_parameters.adults='1';
      for(const out of body.best_flights??[]){
        if(mode==='date')out.flights[0].departure_airport.time='2027-01-15 08:00';
        if(mode==='zone')out.flights[0].arrival_airport.id='XXX';
        if(mode==='cabin')out.flights[0].travel_class='Business';
        if(mode==='connection')out.flights.push({...out.flights[0]});
      }
    });
    const result=await new SerpApiFlightProvider('test-secret',send).search(criteria(),async()=>{});
    assert.equal(result.offers.length,0,mode);assert.deepEqual(result.report.coverage.returnedAirports,[]);
    assert.equal(result.report.requestsAttempted,1);assert.equal(result.report.status,mode==='echo'?'stopped':'completed');
  }
});

test('unknown outcome after partial results preserves evidence and stops without replay',async()=>{
  const {send,calls}=transport((_body,url)=>{if(url.searchParams.get('departure_token')==='two')throw new Error('Timeout with test-secret');});
  const result=await new SerpApiFlightProvider('test-secret',send).search(criteria(),async()=>{});
  assert.equal(result.report.status,'outcome_unknown');assert.equal(result.offers.length,2);assert.equal(result.report.requestsAttempted,3);
  assert.equal(calls.length,4);assert.equal(result.report.coverage.expansionFailures,1);assert.equal(JSON.stringify(result).includes('test-secret'),false);
});

test('known failure of one return expansion permits bounded independent results from the other',async()=>{
  const {send}=transport((_body,url)=>url.searchParams.get('departure_token')==='one'?Response.json({error:'Invalid parameters'},{status:400}):undefined);
  const result=await new SerpApiFlightProvider('test-secret',send).search(criteria(),async()=>{});
  assert.equal(result.offers.length,2);assert.equal(result.report.coverage.expansionFailures,1);assert.equal(result.report.requestsAttempted,3);
});

test('valid connections retain actual elapsed duration while zero-stop criteria reject them',async()=>{
  for(const maxStops of [0,1]){
    const c=criteria({origins:['LHR'],destination:'JFK',inbound:null,maxStops});
    const {send}=transport(body=>{body.best_flights=[{price:190,flights:[
      {flight_number:'BA 1',travel_class:'Economy',departure_airport:{id:'LHR',time:'2027-01-14 08:00'},arrival_airport:{id:'DUB',time:'2027-01-14 09:00'}},
      {flight_number:'EI 2',travel_class:'Economy',departure_airport:{id:'DUB',time:'2027-01-14 10:00'},arrival_airport:{id:'JFK',time:'2027-01-14 13:00'}},
    ]}];});
    const result=await new SerpApiFlightProvider('test-secret',send).search(c,async()=>{});
    assert.equal(result.offers.length,maxStops?1:0);
    if(maxStops){const evaluated=evaluate(result.offers[0]!,c);assert.equal(evaluated.travelMinutes,600);assert.equal(evaluated.schedule.connections,1);}
  }
});

test('twenty-observation limit preserves both expanded departures and no fourth dispatch occurs',async()=>{
  const {send,calls}=transport((body,url)=>{if(url.searchParams.has('departure_token'))body.other_flights=Array.from({length:30},(_,i)=>leg('GVA','LHR','2027-01-18',`TEST ${i}`,200+i));});
  const result=await new SerpApiFlightProvider('test-secret',send).search(criteria(),async()=>{});
  assert.equal(result.offers.length,20);assert.equal(calls.length,4);assert.equal(result.report.coverage.resultLimitReached,true);
  assert.equal(result.offers.filter(o=>o.outbound[0]!.origin==='LHR').length,10);assert.equal(result.offers.filter(o=>o.outbound[0]!.origin==='LGW').length,10);
  assert.equal(result.report.coverage.unexpandedOutboundCount,1);
  assert.throws(()=>offerSchema.parse({...result.offers[0],discovery:{...result.offers[0]!.discovery,priceScope:'one_way'}}));
});

test('account preflight, intent persistence and payload secret filtering remain fail closed',async()=>{
  for(const mode of ['paid','credits','ledger','payload'] as const){
    const {send:normal,calls}=transport(body=>{if(mode==='payload')for(const out of body.best_flights??[])out.extensions=['test-secret'];});
    let reservations=0;
    const send:typeof fetch=async(input,init)=>String(input).includes('/account.json')&&['paid','credits'].includes(mode)?Response.json({...account,...(mode==='paid'?{plan_monthly_price:25}:{plan_searches_left:2})}):normal(input,init);
    const result=await new SerpApiFlightProvider('test-secret',send).search(criteria(),async()=>{reservations++;if(mode==='ledger')throw Error('Cannot persist');});
    assert.equal(result.offers.length,0);assert.equal(calls.filter(u=>u.pathname==='/search.json').length,mode==='payload'?1:0);assert.equal(JSON.stringify(result).includes('test-secret'),false);
    if(mode==='paid'||mode==='credits')assert.equal(reservations,0);
  }
});

async function setup(c=criteria()){
  const db=await embedded();await migrate(db);const actor={userId:randomUUID(),clientId:'general-flight-test'};
  await db.query('insert into client_grants values($1,$2,$3,null)',[actor.userId,actor.clientId,['read','write','search']]);
  const core=new Core(db,false,true),trip=await core.call('create_trip',{...key(),name:'Isolated flight test',destination:'Test',startDate:c.outbound,endDate:c.inbound??c.outbound,adults:c.adults},actor);
  const decision=await core.call('create_decision',{...key(),tripId:trip.tripId,title:'Flights',criteria:c},actor);
  return {db,core,actor,trip,decision,args:{...key(),decisionId:decision.decisionId,expectedRevision:1,criteriaVersion:1,provider:'live'}};
}

test('general search persists multiple itineraries, compares uncertainties, survives restart and protects web/MCP boundaries',async()=>{
  const {db,core,actor,trip,decision,args}=await setup();
  try{
    const run=await core.call('start_search',args,actor),{send,calls}=transport();
    await runOneLiveJob(db,new SerpApiFlightProvider('test-secret',async(input,init)=>{
      if(String(input).includes('/search.json'))assert.equal((await db.query("select count(*)::int as n from provider_attempts where run_id=$1 and status='reserved'",[run.runId])).rows[0]!.n,1);
      return send(input,init);
    }),saveOffer);
    const restarted=new Core(db,false,true),ready=await restarted.call('get_search_run',{runId:run.runId},actor);
    assert.equal(ready.status,'complete');assert.equal(ready.observations.length,4);assert.equal(ready.attempts.length,3);
    assert.equal(ready.coverage.acceptedObservationCount,4);assert.equal((await restarted.call('start_search',args,actor)).runId,run.runId);
    await runOneLiveJob(db,new SerpApiFlightProvider('test-secret',send),saveOffer);assert.equal(calls.length,4);
    const compared=await restarted.call('compare_candidates',{decisionId:decision.decisionId,criteriaVersion:1,observationIds:ready.observations.map((o:any)=>o.id)},actor);
    assert.equal(compared.results.length,4);assert.ok(compared.results.every((r:any)=>r.totalMinor===null&&r.schedule.outbound.length&&r.observedPrice.amountMinor));
    const projection=await restarted.callFromWeb('get_itinerary',{tripId:trip.tripId},actor.userId);assert.equal(projection.research.decisions[0].observations.length,4);
    await assert.rejects(restarted.callFromWeb('start_search',args,actor.userId));
    await assert.rejects(restarted.call('get_search_run',{runId:run.runId},{...actor,userId:randomUUID()}));
    await db.query("update client_grants set permissions=$2 where owner_id=$1",[actor.userId,['read','write']]);
    await assert.rejects(restarted.call('start_search',{...args,...key(),expectedRevision:2},actor));
    assert.equal((await db.query('select count(*)::int as n from live_search_usage')).rows[0]!.n,1);
    assert.equal((await db.query('select count(*)::int as n from observations')).rows[0]!.n,4);
  }finally{await db.close();}
});

test('official MCP SDK discovers generalized schema and retrieves a real adapter path using isolated HTTP fixtures',async()=>{
  const {db,core,actor,args}=await setup(criteria({origins:['CDG','ORY'],destination:'FCO',outbound:'2027-03-10',inbound:null,adults:2}));
  const http=createServer(),client=new Client({name:'general-search-test',version:'1'}),token=randomUUID();
  try{
    await new Promise<void>(resolve=>http.listen(0,'127.0.0.1',resolve));
    const address=http.address();assert.ok(address&&typeof address!=='string');const origin=`http://127.0.0.1:${address.port}`;
    http.on('request',createApp({core,publicOrigin:origin,authenticate:async header=>{if(header!==`Bearer ${token}`)throw Error('Unauthorized');return actor;}}));
    await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers:{Authorization:`Bearer ${token}`}}}));
    const list=await client.listTools();assert.match(list.tools.find(t=>t.name==='start_search')!.description!,/1–6 origins/);
    const call=async(name:string,input:Record<string,any>)=>{
      const result=await client.callTool({name,arguments:input});assert.equal(result.isError,undefined,JSON.stringify(result));return result.structuredContent as any;
    };
    const run=await call('start_search',args),{send,calls}=transport();
    await runOneLiveJob(db,new SerpApiFlightProvider('test-secret',send),saveOffer);
    const ready=await call('get_search_run',{runId:run.runId});assert.equal(ready.status,'complete');assert.equal(ready.observations.length,6);
    assert.deepEqual(ready.coverage.pairs.map((p:any)=>[p.origin,p.outbound.scope,p.outbound.status]),[['CDG','single_airport','queried'],['ORY','single_airport','queried']]);
    assert.equal(ready.observations[0].payload.adults,2);assert.deepEqual(ready.observations[0].payload.inbound,[]);
    assert.equal((await call('start_search',args)).runId,run.runId);assert.equal(calls.length,3);
    await db.query('update client_grants set revoked_at=now() where owner_id=$1',[actor.userId]);
    assert.equal((await client.callTool({name:'get_search_run',arguments:{runId:run.runId}})).isError,true);
  }finally{await client.close();await new Promise<void>((resolve,reject)=>http.close(e=>e?reject(e):resolve()));await db.close();}
});

test('a catalogue expansion reconciles old v2 identities without replacing candidate IDs or history',async()=>{
  const c=criteria({origins:['JFK'],destination:'LAX',outbound:'2027-02-03',inbound:null});
  const {db,core,actor,decision}=await setup(c);
  try{
    const {send}=transport(),offer=(await new SerpApiFlightProvider('test-secret',send).search(c,async()=>{})).offers[0]!;
    const saved=await core.call('save_candidate',{...key(),decisionId:decision.decisionId,expectedRevision:1,offer},actor);
    const original=(await db.query('select payload from observations where id=$1',[saved.observationId])).rows[0]!.payload;
    await db.query("update candidates set identity_key='airport-local-v2:old-unresolved-zone',disposition='saved' where id=$1",[saved.candidateId]);
    const next=await core.call('save_candidate',{...key(),decisionId:decision.decisionId,expectedRevision:2,offer},actor);
    assert.equal(next.candidateId,saved.candidateId);assert.equal((await db.query('select count(*)::int as n from candidates')).rows[0]!.n,1);
    assert.equal((await db.query('select disposition from candidates')).rows[0]!.disposition,'saved');
    assert.deepEqual((await db.query('select payload from observations where id=$1',[saved.observationId])).rows[0]!.payload,original);
    assert.equal(offerSchema.safeParse(original).success,true);
  }finally{await db.close();}
});
