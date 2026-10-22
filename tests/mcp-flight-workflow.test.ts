import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createApp} from '../src/app.js';
import {Core,saveOffer} from '../src/core.js';
import {embedded,migrate} from '../src/database.js';
import {runOneLiveJob} from '../src/live-search.js';
import {SerpApiFlightProvider} from '../src/live-provider.js';
import type {Actor} from '../src/domain.js';

const key=()=>({idempotencyKey:randomUUID()});
// Handwritten fictional observations; this exercises the adapter, never the supplier.
// Echoes here mirror requests for workflow testing, not independent API contract evidence.
function supplierFixture(){
  let searches=0;
  const send:typeof fetch=async input=>{
    const url=new URL(String(input));
    assert.equal(url.hostname,'serpapi.com');
    if(url.pathname==='/account.json')return Response.json({account_status:'Active',plan_monthly_price:0,
      plan_searches_left:100,account_rate_limit_per_hour:50,this_hour_searches:0});
    assert.equal(url.pathname,'/search.json');searches++;
    const q=Object.fromEntries(url.searchParams),returning=!!q.departure_token;
    const origins=q.departure_id!.split(',');
    const flight=(origin:string,index:number)=>({price:180+index*25,departure_token:`fictional-${origin}`,
      extensions:['Checked baggage price unknown'],flights:[{flight_number:`TEST ${origin}${index}`,
        airline:index?'Fictional Air B':'Fictional Air A',travel_class:'Economy',
        departure_airport:{id:returning?q.arrival_id:origin,time:`${returning?q.return_date:q.outbound_date} ${index?'10':'08'}:00`},
        arrival_airport:{id:returning?origin:q.arrival_id,time:`${returning?q.return_date:q.outbound_date} ${index?'14':'11'}:00`}}]});
    return Response.json({search_metadata:{status:'Success',google_flights_url:'https://www.google.com/travel/flights'},
      search_parameters:q,best_flights:returning?[flight(origins[0]!,0)]:
        [flight(origins[0]!,0),flight(origins[1]??origins[0]!,1)]});
  };
  return {provider:new SerpApiFlightProvider('fictional-test-key',send),searches:()=>searches};
}

for(const oneWay of [false,true])test(`connected MCP ${oneWay?'one-way':'return'}: criteria to durable search, comparison, shortlist and reasoned selection read-back`,async()=>{
  const db=await embedded(),http=createServer(),clients:Client[]=[];
  const owner={userId:randomUUID(),clientId:'workflow-owner'},other={userId:randomUUID(),clientId:'workflow-other'};
  const tokens=new Map<string,Actor>([[randomUUID(),owner],[randomUUID(),other]]);
  let core=new Core(db,false,true);
  try{
    await migrate(db);
    for(const actor of [owner,other])await db.query('insert into client_grants values($1,$2,$3,null)',
      [actor.userId,actor.clientId,['read','write','search']]);
    await new Promise<void>(resolve=>http.listen(0,'127.0.0.1',resolve));
    const address=http.address();assert.ok(address&&typeof address!=='string');
    const origin=`http://127.0.0.1:${address.port}`;
    const authenticate=async(header:string|undefined)=>{
      const actor=tokens.get(header?.replace(/^Bearer /,'')??'');if(!actor)throw Error('Unauthorized');return actor;
    };
    const installApp=()=>{http.removeAllListeners('request');http.on('request',createApp({core,publicOrigin:origin,authenticate}));};
    installApp();
    const connect=async(actor=owner)=>{
      const client=new Client({name:'flight-workflow-test',version:'1'});clients.push(client);
      const token=[...tokens].find(([,a])=>a===actor)![0];
      await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),
        {requestInit:{headers:{Authorization:`Bearer ${token}`}}}));return client;
    };
    let client=await connect();
    const call=async(name:string,args:Record<string,unknown>)=>{
      const result=await client.callTool({name,arguments:args});
      assert.ok(!result.isError,JSON.stringify(result));return result.structuredContent as Record<string,any>;
    };
    const deny=async(name:string,args:Record<string,unknown>,code:string)=>{
      const result=await client.callTool({name,arguments:args});assert.equal(result.isError,true);
      assert.equal((result.structuredContent as any).code,code);
    };
    // Inspect the actual wire-discovered schema, not only Zod's internal parser.
    const tools=(await client.listTools()).tools;
    for(const name of ['create_decision','update_decision_criteria']){
      const criteria=(tools.find(t=>t.name===name)!.inputSchema.properties!.criteria as any);
      assert.ok(criteria.properties.inbound.anyOf.some((v:any)=>v.type==='null'));
      assert.ok(criteria.properties.inbound.anyOf.some((v:any)=>v.type==='string'&&v.format==='date'));
      assert.ok(!criteria.required.includes('inbound'),'omission also means one-way');
    }
    const description=tools.find(t=>t.name==='start_search')!.description!;
    assert.match(description,/1–6 origins/);assert.match(description,/three metered requests/);
    assert.doesNotMatch(description,/Flaine|easyJet|18–20 Dec/);
    const criteria={origins:oneWay?['JFK','EWR']:['LHR','LGW','LTN'],destination:oneWay?'LAX':'GVA',
      outbound:'2027-04-02',inbound:oneWay?null:'2027-04-06',adults:oneWay?2:4,currency:'GBP',maxStops:1,
      snowboardRequired:false,snowboardQuantity:null,earliestOutboundLocal:null,groupBudgetMinor:null,
      assumptions:['Economy; checked baggage and onward transfers need verification'],
      preferences:{costWeight:0.5,costBestMinor:20000,costWorstMinor:200000,durationBestMinutes:120,durationWorstMinutes:1440}};
    const trip=await call('create_trip',{...key(),name:'Isolated F3 fictional test',destination:criteria.destination,
      startDate:criteria.outbound,endDate:criteria.inbound??criteria.outbound,adults:criteria.adults});
    const decision=await call('create_decision',{...key(),tripId:trip.tripId,title:'Flight decision',criteria});
    assert.deepEqual((await call('get_decision',{decisionId:decision.decisionId})).selections,[]);
    // Exercise both nullable and omitted input through MCP; neither inserts a fake return date.
    const {inbound,...omittedReturn}=criteria;
    const updated=await call('update_decision_criteria',{...key(),decisionId:decision.decisionId,expectedRevision:1,
      criteria:oneWay?omittedReturn:criteria});
    const searchArgs={...key(),decisionId:decision.decisionId,expectedRevision:updated.revision,criteriaVersion:2,provider:'live'};
    const run=await call('start_search',searchArgs);
    assert.equal(run.status,'queued');
    assert.equal((await call('get_search_run',{runId:run.runId})).observations.length,0);
    const fixture=supplierFixture();
    await runOneLiveJob(db,fixture.provider,saveOffer);
    const ready=await call('get_search_run',{runId:run.runId});
    assert.equal(ready.status,'complete');assert.ok(ready.observations.length>=2);
    assert.equal(ready.coverage.complete,false);assert.equal(ready.attempts.length,oneWay?2:3);
    assert.equal(ready.coverage.pairs.length,criteria.origins.length);
    assert.ok(ready.attempts.every((a:any)=>a.status==='success'));
    const compared=await call('compare_candidates',{decisionId:decision.decisionId,criteriaVersion:2,
      observationIds:ready.observations.map((o:any)=>o.id)});
    assert.equal(compared.results.length,ready.observations.length);
    for(const result of compared.results){
      assert.equal(result.eligibility,'conditional');assert.equal(result.totalMinor,null);
      assert.equal(result.observedPrice.basis,'unknown');assert.equal(result.observedPrice.exactPartyQuoted,false);
      assert.ok(result.schedule.outbound.length);assert.equal(result.schedule.inbound.length,oneWay?0:1);
      assert.ok(result.travelMinutes>0);assert.equal(result.schedule.connections,0);
      assert.ok(result.restrictions.discovery.baggage.outbound.includes('Checked baggage price unknown'));
    }
    const chosen=compared.results[0],evidence=ready.observations.find((o:any)=>o.id===chosen.observationId);
    const saved=await call('set_candidate_disposition',{...key(),decisionId:decision.decisionId,expectedRevision:run.revision,
      candidateId:chosen.candidateId,disposition:'saved'});
    const rationale='Prefer the shorter observed schedule. Price basis, checked baggage and transfers remain unverified; selection only, no booking.';
    const selectArgs={...key(),decisionId:decision.decisionId,expectedRevision:saved.revision,
      observationId:chosen.observationId,rationale,acknowledgeConditional:true};
    await deny('select_candidate',{...selectArgs,acknowledgeConditional:false},'VALIDATION_ERROR');
    assert.equal((await db.query('select count(*)::int as n from selections')).rows[0]!.n,0);
    const selected=await call('select_candidate',selectArgs);assert.equal(selected.booked,false);
    assert.equal((await call('select_candidate',selectArgs)).selectionId,selected.selectionId);
    await deny('select_candidate',{...selectArgs,...key()},'REVISION_CONFLICT');
    // A new server Core and client retain no conversational or response memory.
    await client.close();core=new Core(db,false,true);installApp();client=await connect();
    const read=await call('get_decision',{decisionId:decision.decisionId,limit:1,offset:50});
    assert.deepEqual(read.observations,[],'selection evidence must survive pagination');
    assert.equal(read.selections.length,1);
    const selection=read.selections[0];
    assert.equal(selection.id,selected.selectionId);assert.equal(selection.rationale,rationale);
    assert.equal(selection.criteria_version,2);assert.equal(selection.criteriaChanged,false);
    assert.deepEqual(selection.criteria,{version:2,payload:criteria});
    assert.deepEqual(selection.observation,{...evidence,disposition:'saved'});assert.deepEqual(selection.evaluation,selected.assessment);
    const persistedTrip=await call('get_trip',{tripId:trip.tripId});
    assert.equal(persistedTrip.decisions[0].selections[0].rationale,rationale);
    assert.deepEqual(persistedTrip.decisions[0].bookings,[]);
    const web=await core.callFromWeb('get_itinerary',{tripId:trip.tripId},owner.userId);
    assert.equal(web.research.decisions[0].observations.find((o:any)=>o.id===chosen.observationId).selected,true);
    await call('update_decision_criteria',{...key(),decisionId:decision.decisionId,expectedRevision:selected.revision,
      criteria:{...criteria,adults:criteria.adults+1}});
    const changed=await call('get_decision',{decisionId:decision.decisionId});
    assert.equal(changed.selections[0].criteriaChanged,true);
    assert.deepEqual(changed.selections[0].criteria,selection.criteria);
    assert.deepEqual(changed.selections[0].evaluation,selection.evaluation,'saved assessment is never recomputed');
    assert.equal((await call('start_search',searchArgs)).runId,run.runId,'an old identical retry adds no run');
    await runOneLiveJob(db,fixture.provider,saveOffer);
    assert.equal(fixture.searches(),oneWay?2:3);
    for(const [table,count] of [['search_runs',1],['live_search_usage',1],['provider_attempts',oneWay?2:3],
      ['selections',1],['booking_records',0],['observations',ready.observations.length]] as const){
      assert.equal((await db.query(`select count(*)::int as n from ${table}`)).rows[0]!.n,count);
    }
    client=await connect(other);
    await deny('get_decision',{decisionId:decision.decisionId},'FORBIDDEN_OR_NOT_FOUND');
    await deny('get_search_run',{runId:run.runId},'FORBIDDEN_OR_NOT_FOUND');
    await deny('select_candidate',{...selectArgs,...key(),expectedRevision:changed.decision.revision},'FORBIDDEN_OR_NOT_FOUND');
    const invite=await core.callFromWeb('create_itinerary_invite',{...key(),tripId:trip.tripId,label:'Fictional viewer'},owner.userId);
    await core.callFromWeb('accept_itinerary_invite',{...key(),token:invite.token,displayName:'Fictional viewer'},other.userId);
    const shared=await call('get_itinerary',{tripId:trip.tripId});
    assert.ok(!JSON.stringify(shared).includes(rationale));assert.deepEqual(shared.research.decisions,[]);
    await deny('get_decision',{decisionId:decision.decisionId},'FORBIDDEN_OR_NOT_FOUND');
    client=await connect();
    await db.query('update client_grants set revoked_at=now() where owner_id=$1',[owner.userId]);
    await deny('get_decision',{decisionId:decision.decisionId},'FORBIDDEN_OR_NOT_FOUND');
  }finally{
    for(const client of clients)await client.close();
    await new Promise<void>((resolve,reject)=>http.close(error=>error?reject(error):resolve()));await db.close();
  }
});
