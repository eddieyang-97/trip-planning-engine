import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {criteriaSchema,evaluate,type Criteria} from '../src/domain.js';
import {flaineCriteria} from '../src/acceptance.js';
import {SerpApiFlightProvider} from '../src/live-provider.js';
import {liveSearchPlan,type LiveAttemptEvent} from '../src/live-coverage.js';
import {embedded,migrate} from '../src/database.js';
import {Core,saveOffer} from '../src/core.js';
import {runOneLiveJob} from '../src/live-search.js';

const key=()=>({idempotencyKey:randomUUID()});
const criteria=(change:Partial<Criteria>={})=>criteriaSchema.parse({...flaineCriteria,origins:['LHR','LGW','LTN','STN'],destination:'GVA',outbound:'2027-01-14',inbound:null,snowboardRequired:false,...change});
function leg(origin:string,destination:string,date:string,index=0){
  return {price:100+index+Math.max(0,['LHR','LGW','LTN','STN'].indexOf(origin)),departure_token:`private-token-${origin}-${index}`,flights:[{airline:'Fixture Air',flight_number:`TEST ${origin} ${index}`,travel_class:'Economy',
    departure_airport:{id:origin,time:date+' 08:00'},arrival_airport:{id:destination,time:date+' 11:00'}}]};
}
function transport(change?:(body:any,url:URL)=>Response|void){
  const calls:URL[]=[];
  const send:typeof fetch=async input=>{
    const url=new URL(String(input));if(url.pathname==='/account.json')return Response.json({account_status:'Active',plan_monthly_price:0,plan_searches_left:250,account_rate_limit_per_hour:50,this_hour_searches:0});
    calls.push(url);const q=Object.fromEntries(url.searchParams),origins=q.departure_id!.split(',');
    const body:any={search_parameters:q,search_metadata:{status:'Success'},best_flights:q.departure_token?
      [leg(q.arrival_id!,q.departure_token.split('-')[2]!,q.return_date!)]:origins.map(origin=>leg(origin,q.arrival_id!,q.outbound_date!))};
    return change?.(body,url)??Response.json(body);
  };
  return {send,calls};
}
async function setup(c=criteria()){
  const db=await embedded();await migrate(db);const actor={userId:randomUUID(),clientId:'bounded-airports'};
  await db.query('insert into client_grants values($1,$2,$3,null)',[actor.userId,actor.clientId,['read','write','search']]);
  const core=new Core(db,false,true),trip=await core.call('create_trip',{...key(),name:'Airport coverage fixture',destination:'Test',startDate:c.outbound,endDate:c.inbound??c.outbound,adults:c.adults},actor);
  const decision=await core.call('create_decision',{...key(),tripId:trip.tripId,title:'Flights',criteria:c},actor);
  return {db,core,actor,decision,args:{...key(),decisionId:decision.decisionId,expectedRevision:1,criteriaVersion:1,provider:'live'}};
}

test('plans keep saved origin order, reserve three calls and explicitly omit one-way airports beyond budget',()=>{
  const c=criteria(),plan=liveSearchPlan(c);
  assert.deepEqual(plan.baseQueries,[['LHR'],['LGW'],['LTN']]);assert.deepEqual(plan.omittedOrigins,['STN']);
  assert.equal(plan.maximumProviderRequests,3);assert.equal(plan.maximumReturnExpansions,0);assert.equal(plan.pairs.length,4);
  assert.deepEqual(c.origins,['LHR','LGW','LTN','STN']);assert.deepEqual(liveSearchPlan(c),plan);
  const back=liveSearchPlan(criteria({inbound:'2027-01-18'}));assert.deepEqual(back.baseQueries,[c.origins]);assert.equal(back.maximumReturnExpansions,2);assert.deepEqual(back.omittedOrigins,[]);
});

test('one-way queries three distinct pairs, rejects off-query routes, deduplicates and reports the unsearched fourth',async()=>{
  const {send,calls}=transport((body,url)=>{const first=body.best_flights[0];body.best_flights=[first,first,leg('STN','GVA','2027-01-14')];});
  const events:LiveAttemptEvent[]=[],result=await new SerpApiFlightProvider('test-secret',send).search(criteria(),async e=>{events.push(e);});
  assert.deepEqual(calls.map(u=>u.searchParams.get('departure_id')),['LHR','LGW','LTN']);assert.equal(calls.length,3);
  assert.deepEqual(result.offers.map(o=>o.outbound[0]!.origin),['LHR','LGW','LTN']);assert.equal(result.offers.length,3);
  assert.equal(result.report.reason,'airport_query_budget_exhausted');assert.equal(result.report.coverage.complete,false);
  assert.deepEqual(result.report.coverage.queriedAirports,['LHR','LGW','LTN']);assert.deepEqual(result.report.coverage.notRequestedAirports,['STN']);
  assert.deepEqual(result.report.coverage.pairs.map((p:any)=>p.outbound.scope),['single_airport','single_airport','single_airport',null]);
  assert.equal(result.report.coverage.pairs[3].outbound.status,'not_attempted');assert.equal(result.report.coverage.pairs[3].omissionReason,'request_budget');
  assert.deepEqual(events.filter(e=>e.status==='reserved').map(e=>e.query!.origins),[['LHR'],['LGW'],['LTN']]);
  assert.ok(result.offers.every(o=>evaluate(o,criteria()).totalMinor===null));assert.equal(JSON.stringify(result).includes('private-token'),false);
});

test('observation cap preserves options at all planned origins and discloses per-pair truncation',async()=>{
  const {send}=transport((body,url)=>{body.best_flights=Array.from({length:80},(_,i)=>leg(url.searchParams.get('departure_id')!,'GVA','2027-01-14',i));});
  const result=await new SerpApiFlightProvider('test-secret',send).search(criteria(),async()=>{});
  assert.equal(result.offers.length,20);assert.deepEqual(['LHR','LGW','LTN'].map(origin=>result.offers.filter(o=>o.outbound[0]!.origin===origin).length),[7,7,6]);
  assert.equal(result.report.coverage.observationTruncated,true);assert.ok(result.report.coverage.pairs.slice(0,3).every((p:any)=>p.observationLimitReached));
  assert.equal(result.report.coverage.scanTruncated,false,'three responses of 80 results each were fully scanned');
});

test('known pair failure allows an independent airport; unknown outcome stops remaining queries without replay',async()=>{
  for(const uncertain of [false,true]){
    const {send,calls}=transport((_body,url)=>{if(url.searchParams.get('departure_id')==='LGW'){if(uncertain)throw Error('lost response test-secret');return Response.json({error:'unsupported request'},{status:400});}});
    const result=await new SerpApiFlightProvider('test-secret',send).search(criteria(),async()=>{});
    assert.equal(calls.length,uncertain?2:3);assert.equal(result.offers.length,uncertain?1:2);
    assert.equal(result.report.coverage.pairs[1].outbound.status,uncertain?'outcome_unknown':'failed');
    assert.equal(result.report.coverage.pairs[2].outbound.status,uncertain?'not_attempted':'queried');
    assert.equal(result.report.status,uncertain?'outcome_unknown':'completed');assert.equal(result.report.reason,uncertain?'network_outcome_unknown':'partial_airport_query_failure');
    assert.equal(JSON.stringify(result).includes('test-secret'),false);
  }
});

test('return coverage distinguishes combined base scope, individual expansions, failures and unexpanded origins',async()=>{
  const {send,calls}=transport((_body,url)=>url.searchParams.get('departure_token')?.includes('LHR')?Response.json({error:'unsupported return'},{status:400}):undefined);
  const c=criteria({inbound:'2027-01-18'}),events:LiveAttemptEvent[]=[],result=await new SerpApiFlightProvider('test-secret',send).search(c,async e=>{events.push(e);});
  assert.equal(calls.length,3);assert.equal(result.offers.length,1);assert.equal(result.offers[0]!.outbound[0]!.origin,'LGW');
  const pairs=result.report.coverage.pairs;assert.ok(pairs.every((p:any)=>p.outbound.scope==='combined_airports'));
  assert.equal(pairs[0].return.status,'failed');assert.equal(pairs[1].return.status,'queried');assert.deepEqual(pairs[1].return.acceptedReturnDestinations,['LGW']);
  assert.equal(pairs[2].return.status,'not_attempted');assert.equal(pairs[2].omissionReason,'return_not_expanded');
  assert.deepEqual(events.filter(e=>e.status==='reserved'&&e.stage==='return').map(e=>[e.query!.selectedOrigin,e.query!.parentAttempt]),[['LHR',1],['LGW',1]]);
  assert.ok(events.filter(e=>e.stage==='return').every(e=>e.query!.selectedDeparture?.includes('TEST')));
  assert.equal(JSON.stringify(result).includes('private-token'),false);
});

function mixedReturnTransport(prioritizeGatwick=false){
  return transport((body,url)=>{
    if(!url.searchParams.has('departure_token')){body.best_flights=[leg('LHR','GVA','2027-01-14')];return;}
    const heathrow=Array.from({length:10},(_,index)=>leg('GVA','LHR','2027-01-18',index));
    const gatwick=[leg('GVA','LGW','2027-01-18',10),leg('GVA','LGW','2027-01-18',11)];
    body.best_flights=prioritizeGatwick?[...gatwick,...heathrow]:[...heathrow,...gatwick];
  });
}

test('accepted return destinations describe capped observations rather than every destination in the source response',async()=>{
  for(const prioritizeGatwick of [false,true]){
    const {send,calls}=mixedReturnTransport(prioritizeGatwick);
    const result=await new SerpApiFlightProvider('test-secret',send).search(criteria({origins:['LHR','LGW'],inbound:'2027-01-18'}),async()=>{});
    assert.equal(calls.length,2);assert.equal(result.offers.length,10);
    const pair=result.report.coverage.pairs[0],saved=[...new Set(result.offers.map(offer=>offer.inbound.at(-1)!.destination))];
    assert.deepEqual(pair.return.acceptedReturnDestinations,saved);
    assert.deepEqual(saved,prioritizeGatwick?['LGW','LHR']:['LHR']);
    assert.equal(Object.hasOwn(pair.return,'returnedDestinations'),false);
    assert.equal(pair.observationLimitReached,true);assert.equal(pair.complete,false);assert.equal(result.report.coverage.complete,false);
    assert.equal(result.report.coverage.observationTruncated,true);
  }
});

test('persistent and legacy coverage expose accepted destinations without rewriting stored counts or observations',async()=>{
  const {db,core,actor,args}=await setup(criteria({origins:['LHR','LGW'],inbound:'2027-01-18'}));
  try{
    const run=await core.call('start_search',args,actor),{send}=mixedReturnTransport();
    await runOneLiveJob(db,new SerpApiFlightProvider('test-secret',send),saveOffer);
    const before=(await db.query('select coverage from search_runs where id=$1',[run.runId])).rows[0]!.coverage;
    assert.deepEqual(before.pairs[0].return.acceptedReturnDestinations,['LHR']);
    const original=(await db.query('select id,payload from observations where run_id=$1 order by id',[run.runId])).rows;
    assert.equal(original.length,10);
    const legacy=structuredClone(before);legacy.pairs[0].return.returnedDestinations=legacy.pairs[0].return.acceptedReturnDestinations;
    delete legacy.pairs[0].return.acceptedReturnDestinations;
    await db.query('update search_runs set coverage=$2 where id=$1',[run.runId,JSON.stringify(legacy)]);
    const ready=await new Core(db,false,true).call('get_search_run',{runId:run.runId},actor);
    assert.deepEqual(ready.coverage.pairs[0].return.acceptedReturnDestinations,['LHR']);assert.equal(Object.hasOwn(ready.coverage.pairs[0].return,'returnedDestinations'),false);
    assert.equal(ready.observations.length,10);assert.equal(ready.coverage.complete,false);
    assert.deepEqual((await db.query('select coverage from search_runs where id=$1',[run.runId])).rows[0]!.coverage,legacy,'polling must not rewrite older coverage');
    assert.deepEqual((await db.query('select id,payload from observations where run_id=$1 order by id',[run.runId])).rows,original);
  }finally{await db.close();}
});

test('mismatched selected departure preserves supplier success and separately rejects return coverage',async()=>{
  const {send}=transport((body,url)=>{if(url.searchParams.has('departure_token'))body.selected_flights=[leg('STN','GVA','2027-01-14',9)];});
  const events:LiveAttemptEvent[]=[],result=await new SerpApiFlightProvider('test-secret',send).search(criteria({inbound:'2027-01-18'}),async e=>{events.push(e);});
  assert.equal(result.offers.length,0);assert.deepEqual(events.filter(e=>e.stage==='return'&&e.status!=='reserved').map(e=>e.status),['success','success']);
  assert.equal(result.report.coverage.pairs[0].return.status,'result_rejected');assert.equal(result.report.status,'stopped');
  assert.ok(events.filter(e=>e.stage==='return'&&e.status==='success').every(e=>e.resultValidation==='selected_departure_mismatch'));
});

test('persisted pair coverage reconciles result rejection from the authoritative successful-attempt diagnostic',async()=>{
  const {db,core,actor,args}=await setup(criteria({origins:['LHR'],inbound:'2027-01-18'}));
  try{
    const run=await core.call('start_search',args,actor),{send}=transport((body,url)=>{if(url.searchParams.has('departure_token'))body.selected_flights=[leg('STN','GVA','2027-01-14',9)];});
    await runOneLiveJob(db,new SerpApiFlightProvider('test-secret',send),saveOffer);
    const coverage=(await db.query('select coverage from search_runs where id=$1',[run.runId])).rows[0]!.coverage;
    // Simulate an older projection without the convenience field. The durable
    // diagnostic still rejects usability without rewriting supplier success.
    for(const query of coverage.queries)delete query.resultValidation;
    await db.query('update search_runs set coverage=$2 where id=$1',[run.runId,JSON.stringify(coverage)]);
    const ready=await new Core(db,false,true).call('get_search_run',{runId:run.runId},actor);
    assert.equal(ready.status,'failed');assert.equal(ready.attempts[1].status,'success');assert.equal(ready.coverage.pairs[0].return.status,'result_rejected');
    assert.equal(ready.attempts[1].query.resultValidation,'selected_departure_mismatch');assert.equal(ready.observations.length,0);
    assert.equal((await db.query('select count(*)::int as n from observations')).rows[0]!.n,0);
  }finally{await db.close();}
});

test('persistent plan and scoped intent precede dispatch; partial observations, comparison and retries survive a new core',async()=>{
  for(const uncertain of [false,true]){
  const {db,core,actor,args,decision}=await setup();
  try{
    const run=await core.call('start_search',args,actor);assert.deepEqual(run.searchPlan.baseQueries,[['LHR'],['LGW'],['LTN']]);
    const queued=await core.call('get_search_run',{runId:run.runId},actor);assert.equal(queued.coverage.pairs[0].outbound.status,'not_attempted');
    const {send,calls}=transport((_body,url)=>{if(url.searchParams.get('departure_id')==='LGW'){if(uncertain)throw Error('lost acknowledgement');return Response.json({error:'unsupported request'},{status:400});}});
    await runOneLiveJob(db,new SerpApiFlightProvider('test-secret',async(input,init)=>{
      const url=new URL(String(input));if(url.pathname==='/search.json'){
        const row=(await db.query('select coverage from search_runs where id=$1',[run.runId])).rows[0]!,query=row.coverage.queries.at(-1);
        assert.equal(query.status,'reserved');assert.deepEqual(query.origins,[url.searchParams.get('departure_id')]);
        assert.equal(query.adults,4);assert.equal(query.outboundDate,'2027-01-14');
      }
      return send(input,init);
    }),saveOffer);
    const restarted=new Core(db,false,true),ready=await restarted.call('get_search_run',{runId:run.runId},actor);
    assert.equal(ready.status,uncertain?'outcome_unknown':'complete');assert.equal(ready.observations.length,uncertain?1:2);assert.equal(ready.coverage.acceptedObservationCount,uncertain?1:2);
    assert.deepEqual(ready.attempts.map((a:any)=>[a.status,a.query.origins[0]]),uncertain?[['success','LHR'],['outcome_unknown','LGW']]:[['success','LHR'],['failed','LGW'],['success','LTN']]);
    assert.equal(ready.coverage.pairs[3].omissionReason,'request_budget');assert.equal(JSON.stringify(ready).includes('test-secret'),false);
    const comparison=await restarted.call('compare_candidates',{decisionId:decision.decisionId,criteriaVersion:1,observationIds:ready.observations.map((o:any)=>o.id)},actor);assert.equal(comparison.results.length,uncertain?1:2);
    assert.equal((await restarted.call('start_search',args,actor)).runId,run.runId);await runOneLiveJob(db,new SerpApiFlightProvider('test-secret',send),saveOffer);assert.equal(calls.length,uncertain?2:3);
    await assert.rejects(restarted.call('get_search_run',{runId:run.runId},{...actor,userId:randomUUID()}));
    assert.equal((await db.query('select sum(requests)::int as n from live_search_usage')).rows[0]!.n,3);
    assert.equal((await db.query('select count(*)::int as n from observations')).rows[0]!.n,uncertain?1:2);
  }finally{await db.close();}
  }
});

test('revocation after one airport prevents the next dispatch and new evidence, preserving committed query scope',async()=>{
  const {db,core,actor,args}=await setup();
  try{
    const run=await core.call('start_search',args,actor),{send,calls}=transport();
    await runOneLiveJob(db,new SerpApiFlightProvider('test-secret',async(input,init)=>{
      const response=await send(input,init);if(String(input).includes('/search.json'))await db.query('update client_grants set permissions=$2 where owner_id=$1',[actor.userId,['read']]);return response;
    }),saveOffer);
    const ready=await core.call('get_search_run',{runId:run.runId},actor);assert.equal(calls.length,1);assert.equal(ready.status,'outcome_unknown');assert.equal(ready.observations.length,0);
    assert.equal(ready.coverage.pairs[0].outbound.status,'queried');assert.equal(ready.coverage.pairs[1].outbound.status,'not_attempted');assert.equal(ready.attempts.length,1);
    assert.equal((await db.query('select sum(requests)::int as n from live_search_usage')).rows[0]!.n,3);
  }finally{await db.close();}
});

test('expired worker reconciles saved query scope with unknown attempt status and never resumes unattempted airports',async()=>{
  const {db,core,actor,args}=await setup();
  try{
    const run=await core.call('start_search',args,actor),plan=run.searchPlan;
    const query={attempt:1,stage:'outbound',status:'reserved',origins:['LHR'],destination:'GVA',outboundDate:'2027-01-14',returnDate:null,adults:4,currency:'GBP',cabin:'economy',maxStops:2,fareSource:'SerpApi / Google Flights'};
    await db.query("update search_runs set status='running',lease_until=now()-interval '1 second',coverage=$2 where id=$1",[run.runId,JSON.stringify({plan,queries:[query],complete:false})]);
    await db.query("insert into provider_attempts(run_id,attempt,stage,status) values($1,1,'outbound','reserved')",[run.runId]);
    const restarted=new Core(db,false,true);await runOneLiveJob(db,new SerpApiFlightProvider('test-secret',async()=>{assert.fail('must not replay');}),saveOffer);
    const ready=await restarted.call('get_search_run',{runId:run.runId},actor);assert.equal(ready.status,'outcome_unknown');
    assert.equal(ready.coverage.queries[0].status,'outcome_unknown');assert.equal(ready.coverage.pairs[0].outbound.status,'outcome_unknown');assert.equal(ready.coverage.pairs[1].outbound.status,'not_attempted');
    assert.equal(ready.coverage.pairs[0].observationCount,null);assert.equal(ready.observations.length,0);
    assert.equal((await restarted.call('start_search',args,actor)).runId,run.runId);assert.equal((await db.query('select count(*)::int as n from search_runs')).rows[0]!.n,1);
  }finally{await db.close();}
});

test('failed second intent commit sends no second query and retains earlier observations without inventing scope',async()=>{
  const {send,calls}=transport(),result=await new SerpApiFlightProvider('test-secret',send).search(criteria(),async e=>{if(e.attempt===2&&e.status==='reserved')throw Error('commit failed');});
  assert.equal(calls.length,1);assert.equal(result.report.requestsAttempted,1);assert.equal(result.offers.length,1);assert.equal(result.report.status,'outcome_unknown');
  assert.equal(result.report.coverage.queries.length,1);assert.equal(result.report.coverage.pairs[1].outbound.status,'not_attempted');
});

test('failure after scope write rolls back the second intent and preserves earlier evidence',async()=>{
  const {db,core,actor,args}=await setup();
  try{
    const run=await core.call('start_search',args,actor),{send,calls}=transport();let injected=false;
    const guarded={...db,transaction:((work:any,options:any)=>db.transaction(async tx=>work({...tx,query:async(sql:string,params:any[])=>{
      const result=await tx.query(sql,params);
      if(!injected&&sql==='update search_runs set coverage=$2 where id=$1'){
        const query=JSON.parse(params[1]).queries.at(-1);if(query?.attempt===2&&query.status==='reserved'){injected=true;throw Error('simulated commit failure');}
      }
      return result;
    }}),options)) as typeof db.transaction};
    await runOneLiveJob(guarded,new SerpApiFlightProvider('test-secret',send),saveOffer);
    const ready=await core.call('get_search_run',{runId:run.runId},actor);assert.equal(injected,true);assert.equal(calls.length,1);
    assert.equal(ready.status,'outcome_unknown');assert.equal(ready.attempts.length,1);assert.equal(ready.coverage.queries.length,1);assert.equal(ready.observations.length,1);
    assert.equal((await db.query('select count(*)::int as n from provider_attempts')).rows[0]!.n,1);
    assert.equal((await db.query('select count(*)::int as n from observations')).rows[0]!.n,1);
    assert.equal((await db.query('select sum(requests)::int as n from live_search_usage')).rows[0]!.n,3);
  }finally{await db.close();}
});

test('queued legacy runs retain their combined query instead of silently acquiring a different search plan',async()=>{
  const {db,core,actor,args}=await setup(criteria({origins:['LHR','LGW']}));
  try{
    const run=await core.call('start_search',args,actor);await db.query("update search_runs set coverage='{}'::jsonb where id=$1",[run.runId]);
    const {send,calls}=transport();await runOneLiveJob(db,new SerpApiFlightProvider('test-secret',send),saveOffer);
    const ready=await core.call('get_search_run',{runId:run.runId},actor);assert.equal(calls.length,1);assert.equal(calls[0]!.searchParams.get('departure_id'),'LHR,LGW');
    assert.equal(ready.coverage.plan.mode,'legacy_combined');assert.equal(ready.observations.length,2);assert.equal(ready.coverage.pairs[0].outbound.scope,'combined_airports');
  }finally{await db.close();}
});
