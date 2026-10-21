import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {createServer,get} from 'node:http';
import {randomUUID} from 'node:crypto';
import {SerpApiFlightProvider,airportInstant,liveQuery} from '../src/live-provider.js';
import {validateFlightEcho,type LiveProviderEvent} from '../src/flight-result-validation.js';
import {criteriaSchema,type Criteria} from '../src/domain.js';
import {flaineCriteria} from '../src/acceptance.js';
import {embedded,migrate} from '../src/database.js';
import {Core,saveOffer} from '../src/core.js';
import {runOneLiveJob} from '../src/live-search.js';

const criteria=(change:Partial<Criteria>={})=>criteriaSchema.parse({...flaineCriteria,origins:['CDG'],destination:'FCO',outbound:'2027-03-10',inbound:'2027-03-15',snowboardRequired:false,...change});
const account={account_status:'Active',plan_monthly_price:0,plan_searches_left:250,account_rate_limit_per_hour:50,this_hour_searches:0};
const fixtures=async()=>({first:JSON.parse(await readFile(new URL('./fixtures/serpapi-flights/first.json',import.meta.url),'utf8')),back:JSON.parse(await readFile(new URL('./fixtures/serpapi-flights/return.json',import.meta.url),'utf8'))});
const transport=(first:any,back:any):typeof fetch=>async input=>Response.json(String(input).includes('/account.json')?account:new URL(String(input)).searchParams.has('departure_token')?back:first);

test('bounded timezone inversion preserves DST gaps/overlaps, fractional offsets and date-line transitions',()=>{
  assert.equal(airportInstant('2026-10-25 01:30','LGW'),null);
  assert.equal(airportInstant('2026-03-29 01:30','LGW'),null);
  assert.equal(airportInstant('2027-01-14 08:00','DEL'),'2027-01-14T02:30:00.000Z');
  assert.equal(airportInstant('2027-01-14 08:00','KTM'),'2027-01-14T02:15:00.000Z');
  assert.equal(airportInstant('2027-04-04 01:45','LDH'),null,'Lord Howe half-hour overlap');
  assert.equal(airportInstant('2027-10-03 02:15','LDH'),null,'Lord Howe half-hour gap');
  assert.equal(airportInstant('2011-12-30 12:00','APW'),null,'Samoa skipped a calendar day');
  assert.equal(airportInstant('2027-02-30 08:00','CDG'),null);assert.equal(airportInstant('2027-01-14 08:00','XXX'),null);
});

test('handwritten supplier-shaped first and return responses accept numeric echoes and omitted defaults',async()=>{
  const {first,back}=await fixtures(),events:LiveProviderEvent[]=[];
  const result=await new SerpApiFlightProvider('test-secret',transport(first,back)).search(criteria(),async e=>{events.push(e);});
  assert.equal(result.offers.length,1);assert.equal(result.report.status,'completed');assert.equal(result.offers[0]!.priceMinor,23000);
  assert.equal(result.offers[0]!.priceBasis,'unknown');assert.equal(result.offers[0]!.exactPartyQuoted,false);
  assert.deepEqual(events.map(e=>e.status),['reserved','success','reserved','success']);
  assert.deepEqual(result.report.coverage.resultValidationFailures,[]);assert.ok(result.report.coverage.echoOmissions[0]!.fields.includes('stops'));
});

test('default omissions differ from material scope mismatches, including non-default party and one-way type',async()=>{
  const {first}=await fixtures(),q=liveQuery(criteria());
  for(const field of ['departure_id','arrival_id','outbound_date','return_date','currency','adults']){
    const p=structuredClone(first.search_parameters);delete p[field];assert.equal(validateFlightEcho(q,p,false).reason,'request_echo_missing_or_mismatched',field);
  }
  for(const [field,value] of [['departure_id','LGW'],['currency','USD'],['adults',1],['travel_class',2],['type',2],['stops',0],['return_date','2027-03-16'],['children',1],['infants_on_lap',1],['adults',null]] as const){
    const p={...first.search_parameters,[field]:value};assert.ok(validateFlightEcho(q,p,false).reason,`${field}=${value}`);
  }
  const defaults=liveQuery(criteria({adults:1})),p={...first.search_parameters};delete p.adults;assert.equal(validateFlightEcho(defaults,p,false).reason,null);
  assert.equal(validateFlightEcho({...q,type:'2',return_date:undefined} as any,{...p,type:2},false).reason,'request_echo_missing_or_mismatched','one-way must not echo a return date');
  delete p.return_date;delete p.type;assert.ok(validateFlightEcho(liveQuery(criteria({inbound:null,adults:1})),p,false).reason,'one-way non-default type cannot be inferred');
  assert.equal(validateFlightEcho(q,{...first.search_parameters,departure_id:' cdg ',currency:'gbp',adults:'04'},false).reason,null);
});

test('token omission requires matching selected departure; conflicting tokens or selected itineraries fail closed',async()=>{
  for(const mode of ['matching','unbound','mismatch','token_mismatch'] as const){
    const {first,back}=await fixtures();delete back.search_parameters.departure_token;
    if(mode!=='unbound')back.selected_flights=[structuredClone(first.best_flights[0])];
    if(mode==='mismatch')back.selected_flights[0].flights[0].flight_number='DIFFERENT';
    if(mode==='token_mismatch')back.search_parameters.departure_token='unrelated-token';
    const events:LiveProviderEvent[]=[],result=await new SerpApiFlightProvider('test-secret',transport(first,back)).search(criteria(),async e=>{events.push(e);});
    assert.equal(result.offers.length,mode==='matching'?1:0,mode);
    if(mode==='matching')continue;
    const last=events.at(-1)!;assert.equal(last.status,'success','preserve supplier completion');assert.ok(last.resultValidation);
    assert.equal(result.report.status,'stopped');assert.equal(result.report.reason,'result_validation_failed');
    assert.equal(result.report.coverage.resultValidationFailures.length,1);assert.equal(JSON.stringify(result).includes('unrelated-token'),false);
  }
});

test('provider success and rejected-result diagnostics persist independently without observations or replay',async()=>{
  const db=await embedded();await migrate(db);const actor={userId:randomUUID(),clientId:'review-flight'};const k=()=>({idempotencyKey:randomUUID()});
  try{
    await db.query('insert into client_grants values($1,$2,$3,null)',[actor.userId,actor.clientId,['read','write','search']]);
    const core=new Core(db,false,true),trip=await core.call('create_trip',{...k(),name:'Review fixture',destination:'Test',startDate:'2027-03-10',endDate:'2027-03-15',adults:4},actor);
    const decision=await core.call('create_decision',{...k(),tripId:trip.tripId,title:'Flights',criteria:criteria()},actor),args={...k(),decisionId:decision.decisionId,expectedRevision:1,criteriaVersion:1,provider:'live'};
    const run=await core.call('start_search',args,actor),{first,back}=await fixtures();back.selected_flights=[structuredClone(first.best_flights[0])];back.selected_flights[0].flights[0].flight_number='WRONG';
    let requests=0;const send=transport(first,back),provider=new SerpApiFlightProvider('test-secret',async(input,init)=>{if(String(input).includes('/search.json'))requests++;return send(input,init);});
    await runOneLiveJob(db,provider,saveOffer);const ready=await new Core(db,false,true).call('get_search_run',{runId:run.runId},actor);
    assert.equal(ready.status,'failed');assert.equal(ready.attempts[1].status,'success');assert.equal(ready.attempts[1].diagnostic.resultValidation.reason,'selected_departure_mismatch');
    assert.equal(ready.coverage.resultValidationFailures[0].reason,'selected_departure_mismatch');assert.equal(ready.observations.length,0);
    assert.equal((await core.call('start_search',args,actor)).runId,run.runId);await runOneLiveJob(db,provider,saveOffer);assert.equal(requests,2);
    assert.equal((await db.query('select count(*)::int as n from observations')).rows[0]!.n,0);assert.equal((await db.query('select sum(requests)::int as n from live_search_usage')).rows[0]!.n,3);
  }finally{await db.close();}
});

test('200 outbound and two 200-result expansions yield to concurrent HTTP and bound event-loop stalls',async t=>{
  const c=criteria({origins:['LHR'],destination:'GVA',outbound:'2027-01-14',inbound:'2027-01-18',maxStops:2});
  const segment=(origin:string,destination:string,date:string,start:string,end:string,n:number)=>({flight_number:`TEST ${n}`,travel_class:'Economy',departure_airport:{id:origin,time:`${date} ${start}`},arrival_airport:{id:destination,time:`${date} ${end}`}});
  const out=(i:number)=>({price:100+i,departure_token:`fixture-${i}`,flights:[segment('LHR','AMS',c.outbound,'08:00','10:00',i),segment('AMS','CDG',c.outbound,'11:00','12:00',i+200),segment('CDG','GVA',c.outbound,'13:00','14:00',i+400)]});
  const back=(i:number)=>{const date=i<190?'2027-01-19':c.inbound!;return {price:230,flights:[segment('GVA','CDG',date,'08:00','10:00',i),segment('CDG','AMS',date,'11:00','12:00',i+200),segment('AMS','LHR',date,'13:00','14:00',i+400)]};};
  let phase='outbound',heartbeats=0,last=performance.now(),maxGap=0,active=true,servedDuringSearch=0;
  const heartbeat=()=>{if(!active)return;const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;heartbeats++;setImmediate(heartbeat);};setImmediate(heartbeat);
  const server=createServer((_req,res)=>{if(active)servedDuringSearch++;res.end('ok');});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  const pending=new Promise<void>((resolve,reject)=>get(`http://127.0.0.1:${address.port}`,res=>{res.resume();res.on('end',resolve);}).on('error',reject));
  const send:typeof fetch=async input=>{const url=new URL(String(input));if(url.pathname==='/account.json')return Response.json(account);phase=url.searchParams.has('departure_token')?'return':'outbound';return Response.json({search_metadata:{status:'Success'},search_parameters:Object.fromEntries(url.searchParams),best_flights:Array.from({length:200},(_,i)=>phase==='outbound'?out(i):back(i))});};
  const started=performance.now();
  try{
    const result=await new SerpApiFlightProvider('test-secret',send).search(c,async()=>{});active=false;await pending;
    assert.equal(result.report.requestsAttempted,3);assert.equal(result.offers.length,20);assert.ok(servedDuringSearch>0,'HTTP handler must run while normalizing');
    assert.ok(heartbeats>=20,`normalization yielded only ${heartbeats} times`);assert.ok(maxGap<250,`largest event-loop stall ${maxGap.toFixed(1)}ms`);
    assert.ok(performance.now()-started<5000,'bounded worst-case fixture processing exceeded five seconds');
    t.diagnostic(`600 itineraries / 1800 segments: ${(performance.now()-started).toFixed(1)}ms; max event-loop gap ${maxGap.toFixed(1)}ms; ${heartbeats} heartbeats`);
  }finally{active=false;await pending;await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
