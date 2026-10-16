import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {embedded,migrate} from '../src/database.js';
import {Core,runOneJob,saveOffer} from '../src/core.js';
import {flaineTrip,flaineCriteria} from '../src/acceptance.js';
import {FixtureProvider} from '../src/providers.js';
import {readItineraryViewLink} from '../src/itinerary-view-links.js';
import {DomainError,canonical} from '../src/domain.js';
import {itineraryRoutes} from '../src/itinerary-web.js';
import {createApp} from '../src/app.js';
import {runOneLiveJob} from '../src/live-search.js';
import {SerpApiFlightProvider} from '../src/live-provider.js';
const key=()=>({idempotencyKey:randomUUID()});
const code=(value:string)=>(e:unknown)=>e instanceof DomainError&&e.code===value;
const note={type:'note' as const,title:'PRIVATE lifecycle fixture',startDate:'2026-12-18',startTime:null,endDate:null,endTime:null,timeZone:null,endTimeZone:null,location:'',url:null,notes:'PRIVATE note',openQuestion:'',status:'tentative' as const,bookingNote:''};

test('lifecycle migration preserves existing trips and quota while identifying and erasing legacy create-trip cache content',async()=>{
  const db=await embedded();try{
    for(const file of ['001_initial.sql','002_account_linking.sql','003_policy_notes.sql','004_itinerary.sql','005_live_search.sql','006_itinerary_sharing.sql','007_itinerary_editors.sql','008_itinerary_view_links.sql','009_itinerary_comments.sql','010_account_profiles.sql'])await db.execute(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
    await db.execute('create table app_schema_migrations(version integer primary key)');for(let n=1;n<=10;n++)await db.query('insert into app_schema_migrations values($1)',[n]);
    const owner=randomUUID(),tripId=randomUUID(),decisionId=randomUUID(),runId=randomUUID(),create={...flaineTrip,...key()};
    await db.query('insert into trips(id,owner_id,payload) values($1,$2,$3)',[tripId,owner,JSON.stringify(flaineTrip)]);
    await db.query('insert into decisions(id,trip_id,title) values($1,$2,$3)',[decisionId,tripId,'Legacy research']);
    await db.query('insert into criteria_versions values($1,1,$2)',[decisionId,JSON.stringify(flaineCriteria)]);
    await db.query("insert into search_runs(id,decision_id,criteria_version,provider,status,requested_by,reserved_requests) values($1,$2,1,'serpapi','queued',$3,3)",[runId,decisionId,owner]);
    await db.query("insert into mutation_requests values($1,'create_trip',$2,$3,$4)",[owner,create.idempotencyKey,createHash('sha256').update(canonical(create)).digest('hex'),JSON.stringify({tripId,...flaineTrip})]);
    await migrate(db);await migrate(db);
    assert.equal((await db.query('select trip_id from mutation_requests')).rows[0]!.trip_id,tripId);
    assert.equal((await db.query('select requests from live_search_usage')).rows[0]!.requests,3);
    const core=new Core(db,false),plan=await core.callFromWeb('get_itinerary',{tripId},owner);assert.equal(plan.trip.lifecycle_revision,1);assert.equal(plan.trip.archived_at,null);
    const r=await core.callFromWeb('prepare_trip_action',{...key(),tripId,action:'delete'},owner);
    await core.callFromWeb('delete_trip',{...key(),tripId,expectedRevision:r.expectedRevision,confirmationToken:r.confirmationToken,confirmationName:r.trip.name,confirmed:true},owner);
    await assert.rejects(core.callFromWeb('create_trip',create,owner),code('FORBIDDEN_OR_NOT_FOUND'));
    const cached=(await db.query("select response from mutation_requests where operation='create_trip'")).rows[0]!.response;assert.equal(cached,null);
    assert.equal((await db.query('select requests from live_search_usage')).rows[0]!.requests,3);
  }finally{await db.close();}
});
async function setup(){
  const db=await embedded();await migrate(db);const core=new Core(db,true,true),owner={userId:randomUUID(),clientId:'owner-client'},editor={userId:randomUUID(),clientId:'friend-client'};
  for(const a of [owner,editor,{...owner,clientId:'second-client'}])await db.query('insert into client_grants values($1,$2,$3,null)',[a.userId,a.clientId,['read','write','search']]);
  const create={...flaineTrip,...key()},tripId=(await core.call('create_trip',create,owner)).tripId;
  const web=(name:any,args:any,user=owner.userId)=>core.callFromWeb(name,args,user);
  const invite=await web('create_itinerary_invite',{...key(),tripId,label:'Fictional editor',role:'editor'});
  await web('accept_itinerary_invite',{...key(),token:invite.token,displayName:'Friend'},editor.userId);
  const link=await web('create_itinerary_view_link',{...key(),tripId,label:'Fictional anonymous link'});
  const review=async(action='delete',user=owner.userId)=>web('prepare_trip_action',{...key(),tripId,action},user);
  const confirm=(r:any)=>({...key(),tripId:r.trip.id,expectedRevision:r.expectedRevision,confirmationToken:r.confirmationToken,confirmationName:r.trip.name,confirmed:true});
  return {db,core,owner,editor,create,tripId,web,invite,link,review,confirm};
}

test('owner archive/restore works across web and MCP; archived discovery, sharing and editing are preserved',async()=>{
  const s=await setup();try{
    const {core,owner,editor,web,tripId,link}=s;
    const initial=await web('get_itinerary',{tripId});
    const args={...key(),tripId,expectedRevision:initial.trip.lifecycle_revision};
    const archived=await core.call('archive_trip',args,owner);assert.equal(archived.archived,true);
    assert.equal((await core.call('list_trips',{},owner)).trips.length,0);
    assert.equal((await core.call('list_trips',{status:'archived'},owner)).trips[0].id,tripId);
    assert.equal((await web('list_trips',{status:'all'},editor.userId)).trips[0].role,'editor');
    assert.ok((await readItineraryViewLink(s.db,{token:link.token})).trip.archived_at);
    await web('add_shared_itinerary_item',{...key(),tripId,expectedRevision:1,item:(({status,bookingNote,...rest})=>rest)(note)},editor.userId);
    const plan=await web('get_itinerary',{tripId});assert.equal(plan.items.length,1);assert.ok(plan.trip.archived_at);
    await assert.rejects(core.call('restore_trip',{...key(),tripId,expectedRevision:plan.trip.lifecycle_revision},editor),code('FORBIDDEN_OR_NOT_FOUND'));
    await assert.rejects(web('restore_trip',{...key(),tripId,expectedRevision:archived.lifecycleRevision}),code('REVISION_CONFLICT'));
    await web('restore_trip',{...key(),tripId,expectedRevision:plan.trip.lifecycle_revision});
    assert.equal((await core.call('list_trips',{},owner)).trips.length,1);
    await assert.rejects(core.call('archive_trip',args,owner),code('REVISION_CONFLICT'),'an old archive retry cannot undo restoration');
    await s.db.query("update client_grants set permissions=array['read'] where owner_id=$1 and client_id=$2",[owner.userId,owner.clientId]);
    await assert.rejects(core.call('archive_trip',{...key(),tripId,expectedRevision:plan.trip.lifecycle_revision},owner),code('FORBIDDEN_OR_NOT_FOUND'));
  }finally{await s.db.close();}
});

test('permanent deletion erases the relational graph and cached content without resurrecting retries or removing other trips',async()=>{
  const s=await setup();try{
    const {core,owner,tripId,web}=s;
    const add={...key(),tripId,expectedRevision:1,item:note};await web('add_itinerary_item',add);
    await web('add_itinerary_comment',{...key(),tripId,body:'PRIVATE discussion'});
    const d=await core.call('create_decision',{...key(),tripId,title:'PRIVATE research',criteria:flaineCriteria},owner);
    const start={...key(),decisionId:d.decisionId,expectedRevision:1,criteriaVersion:1,provider:'fixture'};
    await core.call('start_search',start,owner);await runOneJob(s.db,new FixtureProvider());
    const offer=(await new FixtureProvider().search(flaineCriteria)).offers[1]!;
    const saved=await core.call('save_candidate',{...key(),decisionId:d.decisionId,expectedRevision:2,offer},owner);
    const selected=await core.call('select_candidate',{...key(),decisionId:d.decisionId,expectedRevision:3,observationId:saved.observationId,rationale:'PRIVATE choice',acknowledgeConditional:true},owner);
    await core.call('record_booking',{...key(),decisionId:d.decisionId,expectedRevision:4,selectionId:selected.selectionId,bookedAt:new Date().toISOString(),note:'PRIVATE booking'},owner);
    const other=(await core.call('create_trip',{...flaineTrip,name:'Other trip',...key()},owner)).tripId;
    await s.db.query('insert into account_profiles(user_id,display_name) values($1,$2)',[owner.userId,'Keep profile']);
    const r=await s.review();assert.equal(r.counts.items,1);assert.equal(r.counts.decisions,1);assert.equal(r.counts.comments,1);
    const deletion=s.confirm(r),receipt=await web('delete_trip',deletion);assert.equal(receipt.deleted,true);
    assert.deepEqual(await web('delete_trip',deletion),receipt);
    for(const table of ['decisions','criteria_versions','candidates','search_runs','observations','selections','booking_records','itinerary_items','itinerary_events','itinerary_comments','itinerary_members','itinerary_invites','trip_action_confirmations'])assert.equal((await s.db.query(`select count(*)::int n from ${table}`)).rows[0]!.n,0,table);
    assert.equal((await s.db.query('select count(*)::int n from account_profiles')).rows[0]!.n,1);
    assert.equal((await core.call('get_trip',{tripId:other},owner)).trip.id,other);
    for(const work of [()=>core.call('create_trip',s.create,owner),()=>web('add_itinerary_item',add),()=>core.call('start_search',start,owner),()=>web('get_itinerary',{tripId}),()=>readItineraryViewLink(s.db,{token:s.link.token}),()=>web('accept_itinerary_invite',{...key(),token:s.invite.token,displayName:'Again'},s.editor.userId)])await assert.rejects(work,code('FORBIDDEN_OR_NOT_FOUND'));
    const cached=(await s.db.query('select response from mutation_requests where trip_id=$1',[tripId])).rows;
    assert.ok(cached.every(row=>row.response===null||row.response.deleted===true));
    assert.ok(!JSON.stringify(cached).includes('PRIVATE'));
  }finally{await s.db.close();}
});

test('destructive confirmations bind exact trip, account, client, name, revision, expiry and current grant',async()=>{
  const s=await setup();try{
    const {core,owner,web,tripId,editor}=s;
    await assert.rejects(web('prepare_trip_action',{...key(),tripId,action:'delete'},editor.userId),code('FORBIDDEN_OR_NOT_FOUND'));
    const r=await core.call('prepare_trip_action',{...key(),tripId,action:'delete'},owner),args=s.confirm(r);
    await assert.rejects(core.call('delete_trip',args,{...owner,clientId:'second-client'}),code('CONFIRMATION_REQUIRED'));
    await assert.rejects(web('delete_trip',args),code('CONFIRMATION_REQUIRED'));
    await assert.rejects(core.call('delete_trip',{...args,confirmationName:'Wrong trip'},owner),code('CONFIRMATION_REQUIRED'));
    await assert.rejects(core.call('delete_trip',{...args,confirmed:false},owner));
    await web('add_itinerary_item',{...key(),tripId,expectedRevision:1,item:note});
    await assert.rejects(core.call('delete_trip',args,owner),code('REVISION_CONFLICT'));
    const fresh=await core.call('prepare_trip_action',{...key(),tripId,action:'delete'},owner);
    await s.db.query("update trip_action_confirmations set expires_at=now()-interval '1 second'");
    await assert.rejects(core.call('delete_trip',s.confirm(fresh),owner),code('CONFIRMATION_REQUIRED'));
    const granted=await core.call('prepare_trip_action',{...key(),tripId,action:'delete'},owner);
    await s.db.query('update client_grants set revoked_at=now() where owner_id=$1 and client_id=$2',[owner.userId,owner.clientId]);
    await assert.rejects(core.call('delete_trip',s.confirm(granted),owner),code('FORBIDDEN_OR_NOT_FOUND'));
    assert.equal((await web('get_itinerary',{tripId})).items.length,1,'cancelling or failed confirmation changes no content');
  }finally{await s.db.close();}
});

test('collaborators leave only themselves via MCP; contributions and anonymous access remain and rejoining needs a fresh invite',async()=>{
  const s=await setup();try{
    const {core,owner,editor,web,tripId}=s;
    await web('add_itinerary_comment',{...key(),tripId,body:'Friend contribution'},editor.userId);
    await assert.rejects(s.review('leave'),code('FORBIDDEN_OR_NOT_FOUND'));
    const r=await core.call('prepare_trip_action',{...key(),tripId,action:'leave'},editor),args=s.confirm(r);
    assert.equal(r.counts,undefined,'leaving must not expose private research counts');
    const left=await core.call('leave_trip',args,editor);assert.equal(left.left,true);assert.deepEqual(await core.call('leave_trip',args,editor),left);
    assert.equal((await core.call('list_trips',{status:'all'},editor)).trips.length,0);
    assert.equal((await web('list_itinerary_comments',{tripId})).comments[0].body,'Friend contribution');
    await readItineraryViewLink(s.db,{token:s.link.token});
    await assert.rejects(web('accept_itinerary_invite',{...key(),token:s.invite.token,displayName:'Friend'},editor.userId),code('FORBIDDEN_OR_NOT_FOUND'));
    const next=await web('create_itinerary_invite',{...key(),tripId,label:'Rejoin',role:'editor'});
    await web('accept_itinerary_invite',{...key(),token:next.token,displayName:'Friend'},editor.userId);
    await assert.rejects(core.call('leave_trip',args,editor),code('REVISION_CONFLICT'));
    assert.equal((await core.call('list_trips',{},owner)).trips.length,1);assert.equal((await core.call('list_trips',{},editor)).trips.length,1);
  }finally{await s.db.close();}
});

test('delete stops further live stages and evidence writes while preserving the reserved search allowance',async()=>{
  const s=await setup();try{
    const {core,owner,tripId}=s;
    const d=await core.call('create_decision',{...key(),tripId,title:'Flight fixture',criteria:flaineCriteria},owner);
    const run=await core.call('start_search',{...key(),decisionId:d.decisionId,expectedRevision:1,criteriaVersion:1,provider:'live'},owner);
    let sent=0;
    const provider=new SerpApiFlightProvider('fixture-key',async input=>{
      const url=new URL(String(input));
      if(url.pathname==='/account.json')return Response.json({account_status:'Active',plan_monthly_price:0,plan_searches_left:100,account_rate_limit_per_hour:100,this_hour_searches:0});
      sent++;const r=await s.review();await s.web('delete_trip',s.confirm(r));throw Error('Fictional interrupted response');
    });
    await runOneLiveJob(s.db,provider,saveOffer);assert.equal(sent,1);assert.equal(await runOneLiveJob(s.db,provider,saveOffer),false);
    assert.equal((await s.db.query('select count(*)::int n from observations')).rows[0]!.n,0);
    assert.equal((await s.db.query('select requests from live_search_usage where reservation_id=$1',[run.runId])).rows[0]!.requests,3);
    const next=(await core.call('create_trip',{...flaineTrip,...key()},owner)).tripId;
    const nd=await core.call('create_decision',{...key(),tripId:next,title:'Next fixture',criteria:flaineCriteria},owner);
    await core.call('start_search',{...key(),decisionId:nd.decisionId,expectedRevision:1,criteriaVersion:1,provider:'live'},owner);
    await assert.rejects(core.call('start_search',{...key(),decisionId:nd.decisionId,expectedRevision:2,criteriaVersion:1,provider:'live'},owner),code('BUDGET_EXCEEDED'));
  }finally{await s.db.close();}
});

test('HTTP lifecycle confirms only direct same-origin actions and deletion denies outstanding calendar tickets and view links',async()=>{
  const s=await setup(),http=createServer();try{
    await s.web('add_itinerary_item',{...key(),tripId:s.tripId,expectedRevision:1,item:note});
    await new Promise<void>(resolve=>http.listen(0,'127.0.0.1',resolve));const address=http.address();assert.ok(address&&typeof address!=='string');const origin=`http://127.0.0.1:${address.port}`;
    const authenticate=async(header?:string)=>{if(header!=='Bearer fixture-owner')throw Error('No session');return {userId:s.owner.userId};};
    http.on('request',createApp({core:s.core,publicOrigin:origin,authenticate:async()=>{throw Error('MCP disabled');},itinerary:itineraryRoutes({core:s.core,origin,authenticate})}));
    const post=(path:string,body:unknown,from=origin,token='fixture-owner')=>fetch(origin+path,{method:'POST',headers:{origin:from,authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});
    const prep={...key(),tripId:s.tripId,action:'delete'};
    assert.equal((await post('/itinerary-api/prepare_trip_action',prep,'https://other.test')).status,403);
    assert.equal((await post('/itinerary-api/prepare_trip_action',prep,origin,'missing')).status,401);
    const r=await(await post('/itinerary-api/prepare_trip_action',prep)).json();assert.ok(r.confirmationToken);
    const plan=await s.web('get_itinerary',{tripId:s.tripId});
    const exported=await(await post('/itinerary-api/calendar-export',{tripId:s.tripId,expectedRevision:plan.revision,itemIds:[plan.items[0].id]})).json();assert.ok(exported.url);
    const deleted=await post('/itinerary-api/delete_trip',s.confirm(r));assert.equal(deleted.status,200);
    assert.equal((await fetch(origin+exported.url)).status,404);
    assert.equal((await post('/itinerary-share/read',{token:s.link.token})).status,404);
  }finally{await new Promise<void>(resolve=>http.close(()=>resolve()));await s.db.close();}
});
