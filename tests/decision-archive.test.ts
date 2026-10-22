import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {embedded,migrate,type Database} from '../src/database.js';
import {Core,runOneJob,saveOffer} from '../src/core.js';
import {flaineCriteria,flaineTrip} from '../src/acceptance.js';
import {FixtureProvider} from '../src/providers.js';
import {DomainError} from '../src/domain.js';
import {createApp} from '../src/app.js';
import {itineraryRoutes} from '../src/itinerary-web.js';
import {readItineraryViewLink} from '../src/itinerary-view-links.js';
import {SerpApiFlightProvider} from '../src/live-provider.js';
import {runOneLiveJob} from '../src/live-search.js';
const key=()=>({idempotencyKey:randomUUID()});
const code=(s:string)=>(e:unknown)=>e instanceof DomainError&&e.code===s;
const manual={type:'flight',title:'Fictional manually booked SWISS flight',startDate:'2026-12-18',startTime:null,endDate:null,endTime:null,timeZone:null,endTimeZone:null,location:'London',url:null,notes:'Keep this manual item',openQuestion:'',status:'user_reported_booked',bookingNote:'Fictional external booking report'};
async function setup(db:Database){
  await migrate(db);const core=new Core(db,true,true),owner={userId:randomUUID(),clientId:'archive-owner'},other={userId:randomUUID(),clientId:'archive-other'};
  for(const actor of [owner,other])await db.query('insert into client_grants values($1,$2,$3,null)',[actor.userId,actor.clientId,['read','write','search']]);
  const tripId=(await core.call('create_trip',{...flaineTrip,...key()},owner)).tripId;
  const decisionId=(await core.call('create_decision',{...key(),tripId,title:'TEST — flight research',criteria:flaineCriteria},owner)).decisionId;
  return {core,owner,other,tripId,decisionId};
}
const evidenceTables=['criteria_versions','candidates','observations','selections','booking_records','search_runs','provider_attempts','live_search_usage','itinerary_items','itinerary_events'];
async function evidence(db:Database){const values:Record<string,unknown>={};for(const table of evidenceTables)values[table]=(await db.query(`select * from ${table}`)).rows;return values;}

test('archive/restore persists across database restart without changing selected evidence, criteria or manually booked itinerary',async()=>{
  const path=await mkdtemp(join(tmpdir(),'decision-archive-'));let db=await embedded(path);
  try{
    const s=await setup(db),{core,owner,tripId,decisionId}=s;
    await core.callFromWeb('add_itinerary_item',{...key(),tripId,expectedRevision:1,item:manual},owner.userId);
    const offer=(await new FixtureProvider().search(flaineCriteria)).offers[2]!;
    let saved:any;for(let n=0;n<10;n++)saved=await core.call('save_candidate',{...key(),decisionId,expectedRevision:n+1,offer:{...offer,seller:`Fictional seller ${n}`}},owner);
    await core.call('set_candidate_disposition',{...key(),decisionId,expectedRevision:11,candidateId:saved.candidateId,disposition:'saved'},owner);
    const selected=await core.call('select_candidate',{...key(),decisionId,expectedRevision:12,observationId:saved.observationId,rationale:'Conditional: unresolved baggage and transfer costs',acknowledgeConditional:true},owner);
    assert.equal(selected.assessment.eligibility,'conditional');
    await core.call('update_decision_criteria',{...key(),decisionId,expectedRevision:13,criteria:{...flaineCriteria,adults:3}},owner);
    const before=await core.call('get_decision',{decisionId,limit:1,offset:9},owner),unchanged=await evidence(db);
    const args={...key(),decisionId,expectedRevision:14},archived=await core.callFromWeb('archive_decision',args,owner.userId);
    assert.equal(archived.revision,15);assert.equal(archived.archived,true);assert.equal(archived.archivedBy,owner.userId);
    assert.deepEqual(await core.call('archive_decision',args,owner),archived);
    assert.deepEqual(await evidence(db),unchanged);
    const hidden=await core.call('get_itinerary',{tripId},owner);
    assert.equal(hidden.revision,2);assert.equal(hidden.items[0].payload.status,'user_reported_booked');assert.deepEqual(hidden.research.decisions,[]);assert.equal(hidden.research.archivedCount,1);
    assert.deepEqual((await core.call('get_trip',{tripId},owner)).decisions,[]);
    assert.deepEqual((await core.call('list_decisions',{tripId},owner)).decisions,[]);
    assert.equal((await core.callFromWeb('list_decisions',{tripId,status:'archived'},owner.userId)).decisions[0].id,decisionId);
    await db.close();db=await embedded(path);
    const fresh=new Core(db,true,true),read=await fresh.call('get_decision',{decisionId,limit:1,offset:9},owner);
    assert.equal(read.archived,true);assert.equal(read.decision.archived_by,owner.userId);assert.equal(read.lifecycleHistory.length,1);
    assert.deepEqual(read.selections,before.selections);assert.equal(read.selections[0].criteriaChanged,true);
    assert.deepEqual(read.observations,before.observations);assert.deepEqual(read.criteria,before.criteria);
    const restored=await fresh.call('restore_decision',{...key(),decisionId,expectedRevision:15},owner);assert.equal(restored.revision,16);assert.equal(restored.archivedAt,null);
    const visible=await fresh.call('get_itinerary',{tripId},owner);assert.equal(visible.research.decisions[0].id,decisionId);assert.equal(visible.research.decisions[0].observations.length,10);
    assert.deepEqual(await evidence(db),unchanged);
    const current=await fresh.call('get_decision',{decisionId},owner);assert.equal(current.archived,false);assert.deepEqual(current.selections,before.selections);assert.deepEqual(current.lifecycleHistory.map((e:any)=>[e.action,e.revision,e.actor_id]),[['restore',16,owner.userId],['archive',15,owner.userId]]);
    await assert.rejects(fresh.call('archive_decision',args,owner),code('REVISION_CONFLICT'));
    const review=await fresh.callFromWeb('prepare_trip_action',{...key(),tripId,action:'delete'},owner.userId);
    await fresh.callFromWeb('delete_trip',{...key(),tripId,expectedRevision:review.expectedRevision,confirmationToken:review.confirmationToken,confirmationName:review.trip.name,confirmed:true},owner.userId);
    assert.deepEqual((await db.query('select * from decision_lifecycle_events')).rows,[],'existing permanent trip deletion erases archive metadata too');
  }finally{await db.close();await rm(path,{recursive:true,force:true});}
});

test('archive is owner-only, revisioned, idempotent and blocks research writes until restored',async()=>{
  const db=await embedded();try{
    const {core,owner,other,tripId,decisionId}=await setup(db);
    const invite=await core.callFromWeb('create_itinerary_invite',{...key(),tripId,label:'Fictional editor',role:'editor'},owner.userId);
    await core.callFromWeb('accept_itinerary_invite',{...key(),token:invite.token,displayName:'Fixture editor'},other.userId);
    const link=await core.callFromWeb('create_itinerary_view_link',{...key(),tripId,label:'Fictional link'},owner.userId);
    const args={...key(),decisionId,expectedRevision:1};
    for(const name of ['archive_decision','restore_decision'] as const){await assert.rejects(core.call(name,args,other),code('FORBIDDEN_OR_NOT_FOUND'));await assert.rejects(core.callFromWeb(name,args,other.userId),code('FORBIDDEN_OR_NOT_FOUND'));}
    await assert.rejects(core.call('list_decisions',{tripId,status:'all'},other),code('FORBIDDEN_OR_NOT_FOUND'));
    await assert.rejects(core.callFromWeb('list_decisions',{tripId,status:'archived'},other.userId),code('FORBIDDEN_OR_NOT_FOUND'));
    await assert.rejects(core.call('archive_decision',{...args,expectedRevision:2},owner),code('REVISION_CONFLICT'));
    const outcomes=await Promise.all([core.call('archive_decision',args,owner),core.call('archive_decision',args,owner)]);assert.deepEqual(outcomes[0],outcomes[1]);
    assert.equal((await db.query('select count(*)::int n from decision_lifecycle_events')).rows[0]!.n,1);
    await assert.rejects(core.call('archive_decision',{...args,expectedRevision:2},owner),code('IDEMPOTENCY_CONFLICT'));
    await assert.rejects(core.call('archive_decision',{...key(),decisionId,expectedRevision:1},owner),code('REVISION_CONFLICT'));
    const offer=(await new FixtureProvider().search(flaineCriteria)).offers[2]!;
    for(const [name,extra] of [
      ['start_search',{provider:'live',criteriaVersion:1}],['save_candidate',{offer}],['update_decision_criteria',{criteria:flaineCriteria}],
      ['select_candidate',{observationId:randomUUID(),rationale:'No',acknowledgeConditional:true}],['record_booking',{selectionId:randomUUID(),bookedAt:'2026-01-01T00:00:00Z',note:'No'}],['set_candidate_disposition',{candidateId:randomUUID(),disposition:'saved'}],
    ] as const)await assert.rejects(core.call(name,{...key(),decisionId,expectedRevision:2,...extra},owner),code('DECISION_ARCHIVED'));
    const editorPlan=await core.callFromWeb('get_itinerary',{tripId},other.userId);assert.deepEqual(editorPlan.research,{decisions:[],truncatedDecisions:false});
    const publicPlan=await readItineraryViewLink(db,{token:link.token});assert.deepEqual(publicPlan.research,{decisions:[],truncatedDecisions:false});assert.ok(!JSON.stringify(publicPlan).includes(decisionId));
    await db.query("update client_grants set permissions=array['read'] where owner_id=$1",[owner.userId]);
    await assert.rejects(core.call('archive_decision',args,owner),code('FORBIDDEN_OR_NOT_FOUND'));
    await assert.rejects(core.call('restore_decision',{...key(),decisionId,expectedRevision:2},owner),code('FORBIDDEN_OR_NOT_FOUND'));
    await core.callFromWeb('restore_decision',{...key(),decisionId,expectedRevision:2},owner.userId);
    assert.equal((await db.query('select count(*)::int n from search_runs')).rows[0]!.n,0);assert.equal((await db.query('select count(*)::int n from mutation_requests where operation in (\'archive_decision\',\'restore_decision\')')).rows[0]!.n,2);
  }finally{await db.close();}
});

test('booking safeguard includes a booking attached to a superseded selection',async()=>{
  const db=await embedded();try{
    const {core,owner,decisionId}=await setup(db),offer=(await new FixtureProvider().search(flaineCriteria)).offers[2]!;
    const saved=await core.call('save_candidate',{...key(),decisionId,expectedRevision:1,offer},owner);
    const choose=(expectedRevision:number)=>core.call('select_candidate',{...key(),decisionId,expectedRevision,observationId:saved.observationId,rationale:'Fixture choice',acknowledgeConditional:true},owner);
    const selection=await choose(2);await core.call('record_booking',{...key(),decisionId,expectedRevision:3,selectionId:selection.selectionId,bookedAt:'2026-01-01T00:00:00Z',note:'Fictional report'},owner);
    await choose(4);const before=await evidence(db);
    await assert.rejects(core.call('archive_decision',{...key(),decisionId,expectedRevision:5},owner),code('BOOKING_LINKED'));
    assert.deepEqual(await evidence(db),before);assert.equal((await db.query('select revision,archived_at from decisions')).rows[0]!.revision,5);
    assert.equal((await db.query('select count(*)::int n from decision_lifecycle_events')).rows[0]!.n,0);
  }finally{await db.close();}
});

test('already admitted fixture work completes while archived; expired live work stays uncertain and quota is retained',async()=>{
  const db=await embedded();try{
    const {core,owner,tripId,decisionId}=await setup(db);
    const run=await core.call('start_search',{...key(),decisionId,expectedRevision:1,criteriaVersion:1,provider:'fixture'},owner);
    await core.call('archive_decision',{...key(),decisionId,expectedRevision:2},owner);
    await runOneJob(db,new FixtureProvider());const result=await core.call('get_search_run',{runId:run.runId},owner);assert.equal(result.status,'complete');assert.equal(result.decisionArchived,true);assert.ok(result.observations.length>1);
    assert.deepEqual((await core.call('get_itinerary',{tripId},owner)).research.decisions,[]);
    await core.call('restore_decision',{...key(),decisionId,expectedRevision:3},owner);
    const live=await core.call('start_search',{...key(),decisionId,expectedRevision:4,criteriaVersion:1,provider:'live'},owner);
    await db.query("update search_runs set status='running',lease_until=now()-interval '1 second' where id=$1",[live.runId]);
    await db.query("insert into provider_attempts(run_id,attempt,stage,status) values($1,1,'outbound','reserved')",[live.runId]);
    const usage=(await db.query('select * from live_search_usage')).rows;
    await core.call('archive_decision',{...key(),decisionId,expectedRevision:5},owner);
    const provider=new SerpApiFlightProvider('fictional-key',async()=>assert.fail('archived uncertain work must not replay'));
    await runOneLiveJob(db,provider,saveOffer);await runOneLiveJob(db,provider,saveOffer);
    const recovered=await core.call('get_search_run',{runId:live.runId},owner);assert.equal(recovered.status,'outcome_unknown');assert.equal(recovered.attempts[0].status,'outcome_unknown');
    await core.call('restore_decision',{...key(),decisionId,expectedRevision:6},owner);
    assert.deepEqual((await db.query('select * from live_search_usage')).rows,usage);assert.equal((await db.query('select count(*)::int n from search_runs')).rows[0]!.n,2);
  }finally{await db.close();}
});

test('HTTP web and official MCP client archive/restore share durable state, discovery and authorization',async()=>{
  const db=await embedded(),http=createServer(),client=new Client({name:'archive-fixture',version:'1'});
  try{
    const {core,owner,other,tripId,decisionId}=await setup(db);
    await new Promise<void>(r=>http.listen(0,'127.0.0.1',r));const addr=http.address();assert.ok(addr&&typeof addr!=='string');const origin=`http://127.0.0.1:${addr.port}`;
    http.on('request',createApp({core,publicOrigin:origin,authenticate:async h=>{if(h!=='Bearer fixture-mcp')throw Error('No MCP');return owner;},itinerary:itineraryRoutes({core,origin,authenticate:async h=>{if(!['Bearer fixture-web','Bearer other'].includes(h??''))throw Error('No direct session');return {userId:h==='Bearer other'?other.userId:owner.userId};}})}));
    const post=(name:string,args:unknown,token='fixture-web',from=origin)=>fetch(`${origin}/itinerary-api/${name}`,{method:'POST',headers:{origin:from,authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(args)});
    await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers:{authorization:'Bearer fixture-mcp'}}}));
    const tools=(await client.listTools()).tools;
    for(const name of ['archive_decision','restore_decision','list_decisions'])assert.ok(tools.some(t=>t.name===name));
    assert.equal(tools.find(t=>t.name==='list_decisions')!.annotations!.readOnlyHint,true);
    const args={...key(),decisionId,expectedRevision:1};
    assert.equal((await post('archive_decision',args,'fixture-web','https://evil.test')).status,403);
    assert.equal((await post('archive_decision',args,'missing')).status,401);
    assert.equal((await post('archive_decision',args,'other')).status,404);
    assert.equal((await post('archive_decision',{...args,ownerId:owner.userId})).status,400);
    const archived=await post('archive_decision',args);assert.equal(archived.status,200);
    const get=await client.callTool({name:'get_trip',arguments:{tripId}});assert.deepEqual((get.structuredContent as any).decisions,[]);
    const list=await client.callTool({name:'list_decisions',arguments:{tripId,status:'archived'}});assert.equal((list.structuredContent as any).decisions[0].id,decisionId);
    assert.equal((await post('restore_decision',{...key(),decisionId,expectedRevision:1})).status,409);
    const restore=await client.callTool({name:'restore_decision',arguments:{...key(),decisionId,expectedRevision:2}});assert.ok(!restore.isError);
    assert.equal((await(await post('get_itinerary',{tripId})).json()).research.decisions[0].id,decisionId);
    assert.equal((await post('archive_decision',args)).status,409);
    const zero=await client.callTool({name:'list_decisions',arguments:{tripId,status:'all',limit:0}});assert.equal(zero.isError,true);
  }finally{await client.close();await new Promise<void>(r=>http.close(()=>r()));await db.close();}
});

test('migration 012 preserves a legacy research graph and paginates deliberate archived discovery',async()=>{
  const db=await embedded();try{
    await migrate(db);
    // Recreate the pre-012 state while preserving actual existing research records.
    const {core,owner,tripId,decisionId}=await setup(db);
    const before=await evidence(db);
    await db.execute('drop table decision_lifecycle_events;alter table decisions drop constraint decision_archive_actor;alter table decisions drop column archived_at;alter table decisions drop column archived_by;delete from app_schema_migrations where version=12');
    const old=(await db.query('select * from decisions')).rows[0]!;
    await migrate(db);await migrate(db);const row=(await db.query('select * from decisions')).rows[0]!;
    assert.deepEqual(row,{...old,archived_at:null,archived_by:null});assert.deepEqual(await evidence(db),before);
    await core.call('archive_decision',{...key(),decisionId,expectedRevision:1},owner);
    const second=await core.call('create_decision',{...key(),tripId,title:'ZZ other decision',criteria:flaineCriteria},owner);
    await core.call('archive_decision',{...key(),decisionId:second.decisionId,expectedRevision:1},owner);
    const page=await core.call('list_decisions',{tripId,status:'archived',limit:1},owner);assert.equal(page.pagination.hasMore,true);assert.equal(page.decisions[0].id,decisionId);
    const next=await core.call('list_decisions',{tripId,status:'archived',limit:1,offset:1},owner);assert.equal(next.pagination.hasMore,false);assert.equal(next.decisions[0].id,second.decisionId);
    assert.deepEqual((await core.call('list_decisions',{tripId,status:'archived',offset:2},owner)).decisions,[]);
    assert.equal((await db.query("select relrowsecurity from pg_class where oid='decision_lifecycle_events'::regclass")).rows[0]!.relrowsecurity,true);
  }finally{await db.close();}
});

test('archiving does not cancel an admitted live run or refund its supplier allowance (fake transport only)',async()=>{
  const db=await embedded();try{
    const {core,owner,decisionId}=await setup(db);
    await core.call('update_decision_criteria',{...key(),decisionId,expectedRevision:1,criteria:{...flaineCriteria,origins:['LHR'],destination:'HKG',outbound:'2027-04-02',inbound:null}},owner);
    const queued=await core.call('start_search',{...key(),decisionId,expectedRevision:2,criteriaVersion:2,provider:'live'},owner);
    const usage=(await db.query('select * from live_search_usage')).rows;await core.call('archive_decision',{...key(),decisionId,expectedRevision:3},owner);
    let requests=0;const provider=new SerpApiFlightProvider('fictional-key',async input=>{
      const url=new URL(String(input));if(url.pathname==='/account.json')return Response.json({account_status:'Active',plan_monthly_price:0,plan_searches_left:100,account_rate_limit_per_hour:50,this_hour_searches:0});
      requests++;return Response.json({search_metadata:{status:'Success',google_flights_url:'https://www.google.com/travel/flights'},search_parameters:Object.fromEntries(url.searchParams),best_flights:[{price:250,flights:[{airline:'Fictional Air',flight_number:'TEST1',travel_class:'Economy',departure_airport:{id:'LHR',time:'2027-04-02 10:00'},arrival_airport:{id:'HKG',time:'2027-04-03 06:00'}}]}]});
    });
    await runOneLiveJob(db,provider,saveOffer);await runOneLiveJob(db,provider,saveOffer);
    const result=await new Core(db,false,true).call('get_search_run',{runId:queued.runId},owner);
    assert.equal(result.status,'complete');assert.equal(result.attempts[0].status,'success');assert.equal(requests,1);assert.equal(result.observations.length,1);
    assert.deepEqual((await db.query('select * from live_search_usage')).rows,usage);assert.equal((await core.call('get_decision',{decisionId},owner)).archived,true);
    assert.equal(result.observations[0].payload.priceBasis,'unknown');assert.equal(result.observations[0].payload.exactPartyQuoted,false);
  }finally{await db.close();}
});

test('archive metadata, history and retry receipt roll back atomically if journal persistence fails',async()=>{
  const db=await embedded();try{
    const {core,owner,decisionId}=await setup(db),args={...key(),decisionId,expectedRevision:1};
    const broken:Database={...db,transaction:(fn,options)=>db.transaction(tx=>fn({...tx,query:async(sql,params)=>{
      if(sql.startsWith('insert into decision_lifecycle_events'))throw Error('fictional journal failure');return tx.query(sql,params) as any;
    }}),options)};
    await assert.rejects(new Core(broken,true,true).call('archive_decision',args,owner),/fictional journal failure/);
    const state=await core.call('get_decision',{decisionId},owner);assert.equal(state.archived,false);assert.equal(state.decision.revision,1);assert.deepEqual(state.lifecycleHistory,[]);
    assert.equal((await db.query("select count(*)::int n from mutation_requests where operation='archive_decision'")).rows[0]!.n,0);
    await core.call('archive_decision',args,owner);assert.equal((await core.call('get_decision',{decisionId},owner)).lifecycleHistory.length,1);
  }finally{await db.close();}
});
