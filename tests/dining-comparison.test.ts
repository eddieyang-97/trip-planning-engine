import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {embedded,migrate,type Database} from '../src/database.js';
import {Core,type ToolName} from '../src/core.js';
import {DomainError} from '../src/domain.js';
import {diningCriteria,diningObservation} from './fixtures/dining.js';
import {evaluateDining,diningObservationSchema} from '../src/dining-domain.js';
import {readItineraryViewLink} from '../src/itinerary-view-links.js';
const key=()=>({idempotencyKey:randomUUID()});
const code=(s:string)=>(e:unknown)=>e instanceof DomainError&&e.code===s;
async function setup(db:Database,adults=10){
  await migrate(db);const core=new Core(db,false,false),owner={userId:randomUUID(),clientId:'fictional-dining-owner'},other={userId:randomUUID(),clientId:'fictional-dining-other'};
  for(const actor of [owner,other])await db.query('insert into client_grants values($1,$2,$3,null)',[actor.userId,actor.clientId,['read','write']]);
  const trip=(await core.call('create_trip',{...key(),name:'Fictional group dining research',destination:'Fictional village',startDate:'2027-02-11',endDate:'2027-02-14',adults},owner));
  const decision=(await core.call('create_dining_decision',{...key(),tripId:trip.tripId,title:'Fictional group dinner',criteria:diningCriteria(adults)},owner));
  return {db,core,owner,other,tripId:trip.tripId,decisionId:decision.decisionId};
}
async function count(db:Database,table:string){return (await db.query(`select count(*)::int n from ${table}`)).rows[0]!.n;}

test('dining compares explicit per-person/group estimates without inventing mandatory fees, inventory or dietary fit',()=>{
  const c=diningCriteria(),o=diningObservation(),a=evaluateDining(o,c);assert.equal(a.totalMinor,55000);assert.equal(a.knownSubtotalMinor,55000);assert.equal(a.eligibility,'conditional');assert.ok(a.unknowns.some(s=>s.includes('Table availability')));
  assert.equal(evaluateDining({...o,price:{...o.price,basis:'whole_party',amountMinor:50000}},c).totalMinor,55000);
  assert.equal(evaluateDining({...o,charges:[{label:'Included service',basis:'unknown',amountMinor:null,includedInBase:true}]},c).totalMinor,50000);
  for(const value of [{...o,price:{...o.price,basis:'unknown' as const}},{...o,mandatoryChargesComplete:false},{...o,charges:[{label:'Service',basis:'whole_party' as const,amountMinor:null,includedInBase:false}]},diningObservation(10,'tavern')])assert.equal(evaluateDining(value,c).totalMinor,null);
  for(const value of [{...o,date:'2027-02-13'},{...o,meal:'lunch' as const},{...o,quotedAdults:8},{...o,currency:'CHF'},{...o,groupSuitability:{status:'unsuitable' as const,details:'Cannot seat ten'}},{...o,dietary:[{requirement:'Vegetarian',status:'unsupported' as const,details:'No menu alternative'}]},{...o,availability:'unavailable' as const,availabilityDetails:'Dated direct response for this meal'}])assert.equal(evaluateDining(value,c).eligibility,'ineligible');
  assert.equal(evaluateDining({...o,dietary:[]},c).eligibility,'conditional');assert.equal(evaluateDining({...o,price:{...o.price,amountMinor:11000},mandatoryChargesComplete:false},c).eligibility,'ineligible','known lower bound above budget fails');
  assert.equal(evaluateDining({...o,quotedAdults:null},c).totalMinor,null);
  assert.equal(diningObservationSchema.safeParse({...o,reservation:{...o.reservation,observedAt:null}}).success,false);
  assert.equal(diningObservationSchema.safeParse({...o,availability:'reported_available',availabilityDetails:''}).success,false);
  assert.equal(diningObservationSchema.safeParse({...o,menu:{...o.menu,observedAt:null}}).success,false);
  assert.equal(diningObservationSchema.safeParse({...o,reservation:{...o.reservation,url:'javascript:alert(1)'}}).success,false);
});

test('dining check details match complete and incomplete evidence',()=>{
  const c=diningCriteria(),o=diningObservation();
  const complete=evaluateDining(o,c);
  assert.deepEqual(complete.checks.find(check=>check.name==='total'),{name:'total',status:'pass',detail:'Expected whole-party meal cost includes recorded mandatory service and fees'});
  assert.deepEqual(complete.checks.find(check=>check.name==='menu'),{name:'menu',status:'pass',detail:'Menu and its observation time are recorded'});
  const incomplete=evaluateDining({...o,mandatoryChargesComplete:false,menu:{summary:'',url:null,observedAt:null}},c);
  for(const name of ['total','menu']){
    const check=incomplete.checks.find(value=>value.name===name);
    assert.equal(check?.status,'unknown');assert.ok(check&&incomplete.unknowns.includes(check.detail));
  }
});

test('whole-party dining shortlist keeps dated menu, reservation provenance, rejected rationale and pinned selection across rereads',async()=>{
  const db=await embedded();try{
    const {core,owner,tripId,decisionId}=await setup(db),o=diningObservation();
    const first=await core.call('save_dining_candidate',{...key(),decisionId,expectedRevision:1,observation:o},owner);
    const second=await core.callFromWeb('save_dining_candidate',{...key(),decisionId,expectedRevision:2,observation:diningObservation(10,'tavern')},owner.userId);
    await core.call('set_dining_disposition',{...key(),decisionId,expectedRevision:3,candidateId:second.candidateId,disposition:'rejected',rationale:'Unknown cover charge and no reported booking route'},owner);
    const comparison=await core.call('compare_dining',{decisionId},owner);assert.equal(comparison.results[0].candidateId,first.candidateId);assert.equal(comparison.results[1].totalMinor,null);assert.deepEqual(await core.callFromWeb('get_dining_decision',{decisionId},owner.userId),comparison);
    const receipts=await count(db,'mutation_requests');await assert.rejects(core.call('select_dining_candidate',{...key(),decisionId,expectedRevision:4,observationId:first.observationId,rationale:'Needs acknowledgement'},owner),code('VALIDATION_ERROR'));assert.equal(await count(db,'selections'),0);assert.equal(await count(db,'mutation_requests'),receipts);
    const selected=await core.call('select_dining_candidate',{...key(),decisionId,expectedRevision:4,observationId:first.observationId,rationale:'Preferred menu; table needs confirmation',acknowledgeUnknowns:true},owner);
    const committed=await core.call('commit_dining_selection',{...key(),decisionId,expectedRevision:5,expectedItineraryRevision:1,selectionId:selected.selectionId},owner);
    for(let i=0;i<6;i++)await core.call('save_dining_candidate',{...key(),decisionId,expectedRevision:6+i,candidateId:first.candidateId,observation:{...o,price:{...o.price,amountMinor:6000+i}}},owner);
    const fresh=await core.call('get_dining_decision',{decisionId},owner);assert.equal(fresh.candidates.find((c:any)=>c.id===first.candidateId).observationCount,7);assert.equal(fresh.selection.observationId,first.observationId);assert.deepEqual(fresh.selection.observation,o);assert.equal(fresh.selection.rationale,'Preferred menu; table needs confirmation');assert.equal(fresh.candidates.find((c:any)=>c.id===second.candidateId).rationale,'Unknown cover charge and no reported booking route');
    assert.deepEqual((await core.call('get_dining_observation',{decisionId,observationId:first.observationId},owner)).observation.payload,o);
    assert.equal((await core.call('get_decision',{decisionId},owner)).selection.id,selected.selectionId);assert.equal((await core.call('get_trip',{tripId},owner)).decisions[0].dining.selection.id,selected.selectionId);
    const plan=await core.call('get_itinerary',{tripId},owner);assert.equal(plan.items[0].id,committed.itemId);assert.equal(plan.items[0].payload.type,'restaurant');assert.equal(plan.items[0].payload.status,'tentative');assert.equal(plan.items[0].payload.startTime,'19:30');assert.equal(plan.items[0].payload.timeZone,'Europe/Rome');assert.equal(plan.items[0].sourceLink.observationId,first.observationId);assert.equal(await count(db,'booking_records'),0);assert.equal(await count(db,'search_runs'),0);
  }finally{await db.close();}
});

test('restaurant names never auto-merge; inconsistent appends need anchored human reconciliation; validation and RLS preserve boundaries',async()=>{
  const db=await embedded();try{
    await db.execute('create role anon;create role authenticated;alter default privileges in schema public grant all on tables to anon,authenticated');
    const {core,owner,tripId,decisionId}=await setup(db),o=diningObservation();
    const a=await core.call('save_dining_candidate',{...key(),decisionId,expectedRevision:1,observation:o},owner);
    const b=await core.call('save_dining_candidate',{...key(),decisionId,expectedRevision:2,observation:o},owner);assert.notEqual(a.candidateId,b.candidateId);
    const changed={...o,source:{...o.source,url:'https://different.example/branch'}};const args={...key(),decisionId,expectedRevision:3,candidateId:a.candidateId,observation:changed};
    await assert.rejects(core.call('save_dining_candidate',args,owner),code('IDENTITY_REVIEW_REQUIRED'));
    await assert.rejects(core.call('save_dining_candidate',{...args,identityReview:{priorObservationId:b.observationId,confirmedSameRestaurant:true,reason:'Wrong anchor'}},owner),code('REVISION_CONFLICT'));
    assert.equal(await count(db,'observations'),2);assert.equal((await core.call('get_dining_decision',{decisionId},owner)).decision.revision,3);
    const identityReview={priorObservationId:a.observationId,confirmedSameRestaurant:true,reason:'Human checked venue changed its source page'};
    const reconciled=await core.call('save_dining_candidate',{...args,identityReview},owner);assert.deepEqual((await core.call('get_dining_observation',{decisionId,observationId:reconciled.observationId},owner)).observation.identity_review,identityReview);
    await assert.rejects(core.call('create_dining_decision',{...key(),tripId,title:'Wrong subgroup',criteria:diningCriteria(8)},owner),code('VALIDATION_ERROR'));
    await assert.rejects(core.call('create_dining_decision',{...key(),tripId,title:'Outside trip',criteria:{...diningCriteria(),date:'2027-02-15'}},owner),code('VALIDATION_ERROR'));
    for(const role of ['anon','authenticated']){assert.equal((await db.query("select has_table_privilege($1,'dining_itinerary_links','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') allowed",[role])).rows[0]!.allowed,false);await assert.rejects(db.transaction(async tx=>{await tx.execute(`set local role ${role}`);return tx.query('select * from dining_itinerary_links');}),(e:any)=>e.code==='42501');}
    assert.equal((await db.query("select relrowsecurity from pg_class where oid='dining_itinerary_links'::regclass")).rows[0]!.relrowsecurity,true);
    await assert.rejects(core.call('get_stay_decision',{decisionId},owner),code('FORBIDDEN_OR_NOT_FOUND'));
    await assert.rejects(core.call('update_decision_criteria',{...key(),decisionId,expectedRevision:4,criteria:{}},owner));
  }finally{await db.close();}
});

test('a linked meal can be manually reported booked without rewriting its research; even a removed booked item blocks research archive',async()=>{
  const db=await embedded();try{
    const {core,owner,tripId,decisionId}=await setup(db),saved=await core.call('save_dining_candidate',{...key(),decisionId,expectedRevision:1,observation:diningObservation()},owner);
    const selected=await core.call('select_dining_candidate',{...key(),decisionId,expectedRevision:2,observationId:saved.observationId,rationale:'Fictional reviewed choice',acknowledgeUnknowns:true},owner);
    await core.call('commit_dining_selection',{...key(),decisionId,expectedRevision:3,expectedItineraryRevision:1,selectionId:selected.selectionId},owner);
    let plan=await core.call('get_itinerary',{tripId},owner);const row=plan.items[0];
    await core.call('update_itinerary_item',{...key(),tripId,expectedRevision:plan.revision,itemId:row.id,item:{...row.payload,status:'user_reported_booked',bookingNote:'PRIVATE fictional direct confirmation'}},owner);
    await assert.rejects(core.call('archive_decision',{...key(),decisionId,expectedRevision:4},owner),code('BOOKING_LINKED'));
    assert.equal((await core.call('list_decisions',{tripId},owner)).decisions[0].booking_linked,true);
    plan=await core.call('get_itinerary',{tripId},owner);await core.call('remove_itinerary_item',{...key(),tripId,expectedRevision:plan.revision,itemId:row.id},owner);
    await assert.rejects(core.call('archive_decision',{...key(),decisionId,expectedRevision:4},owner),code('BOOKING_LINKED'));
    const read=await core.call('get_dining_decision',{decisionId},owner);assert.equal(read.selection.observationId,saved.observationId);assert.equal(read.selection.rationale,'Fictional reviewed choice');assert.equal(read.links[0].status,'user_reported_booked');assert.ok(read.links[0].removedAt);assert.equal(await count(db,'booking_records'),0,'manual itinerary reporting is distinct from research booking records');
  }finally{await db.close();}
});

test('reviewed tentative commit is idempotent, revision guarded and cannot use cross-decision selections',async()=>{
  const db=await embedded();try{
    const {core,owner,tripId,decisionId}=await setup(db),saved=await core.call('save_dining_candidate',{...key(),decisionId,expectedRevision:1,observation:diningObservation()},owner);
    const selected=await core.call('select_dining_candidate',{...key(),decisionId,expectedRevision:2,observationId:saved.observationId,rationale:'Fictional reviewed group fit',acknowledgeUnknowns:true},owner);
    const args={...key(),decisionId,expectedRevision:3,expectedItineraryRevision:1,selectionId:selected.selectionId};
    const interrupted:Database={...db,transaction:(fn,options)=>db.transaction(tx=>fn({...tx,query:async(sql,params)=>{if(sql.startsWith('insert into dining_itinerary_links'))throw Error('Fictional link persistence failure after item insertion');return tx.query(sql,params) as any;}}),options)};
    await assert.rejects(new Core(interrupted,false).call('commit_dining_selection',args,owner),/Fictional link persistence failure/);
    for(const table of ['itinerary_items','itinerary_events','dining_itinerary_links'])assert.equal(await count(db,table),0,'whole transaction rolls back '+table);
    assert.equal((await db.query('select revision from decisions where id=$1',[decisionId])).rows[0]!.revision,3);assert.equal((await db.query('select itinerary_revision from trips where id=$1',[tripId])).rows[0]!.itinerary_revision,1);assert.equal((await db.query("select count(*)::int n from mutation_requests where operation='commit_dining_selection'")).rows[0]!.n,0);
    await assert.rejects(core.call('commit_dining_selection',{...args,...key(),expectedItineraryRevision:2},owner),code('REVISION_CONFLICT'));
    const first=await core.call('commit_dining_selection',args,owner);assert.equal(first.supplierTransactionMade,false);assert.deepEqual(await core.callFromWeb('commit_dining_selection',args,owner.userId),first);
    let read=await core.call('get_dining_decision',{decisionId},owner),plan=await core.call('get_itinerary',{tripId},owner);
    const repeated=await core.call('commit_dining_selection',{...args,...key(),expectedRevision:read.decision.revision,expectedItineraryRevision:plan.revision},owner);assert.equal(repeated.itemId,first.itemId);
    await assert.rejects(core.call('commit_dining_selection',{...args,...key()},owner),code('REVISION_CONFLICT'));
    const otherDecision=await core.call('create_dining_decision',{...key(),tripId,title:'Other fictional decision',criteria:diningCriteria()},owner);
    await assert.rejects(core.call('commit_dining_selection',{...args,...key(),decisionId:otherDecision.decisionId,expectedRevision:1,expectedItineraryRevision:plan.revision},owner),code('REVISION_CONFLICT'));
    read=await core.call('get_dining_decision',{decisionId},owner);assert.equal(read.links.length,1);assert.equal(read.links[0].itemId,first.itemId);assert.equal(read.links[0].observationId,saved.observationId);
    assert.equal(await count(db,'itinerary_items'),1);assert.equal(await count(db,'dining_itinerary_links'),1);assert.equal(await count(db,'itinerary_events'),1);assert.equal(await count(db,'booking_records'),0);
    plan=await core.call('get_itinerary',{tripId},owner);
    await core.call('remove_itinerary_item',{...key(),tripId,itemId:first.itemId,expectedRevision:plan.revision},owner);
    const removed=(await db.query('select * from itinerary_items where id=$1',[first.itemId])).rows[0];assert.ok(removed!.removed_at);
    await assert.rejects(core.call('commit_dining_selection',args,owner),(e:any)=>e instanceof DomainError&&/removed/i.test(e.message));
    read=await core.call('get_dining_decision',{decisionId},owner);plan=await core.call('get_itinerary',{tripId},owner);
    await assert.rejects(core.call('commit_dining_selection',{...args,...key(),expectedRevision:read.decision.revision,expectedItineraryRevision:plan.revision},owner),(e:any)=>e instanceof DomainError&&/removed/i.test(e.message));
    assert.deepEqual((await db.query('select * from itinerary_items where id=$1',[first.itemId])).rows[0],removed);assert.equal(await count(db,'itinerary_items'),1);assert.equal(await count(db,'itinerary_events'),2);assert.equal(plan.items.length,0);
  }finally{await db.close();}
});

test('dining research and cached writes are owner/grant protected; shared plans do not expose provenance, rationale or source links',async()=>{
  const db=await embedded();try{
    const {core,owner,other,tripId,decisionId}=await setup(db),observation={...diningObservation(),source:{...diningObservation().source,label:'PRIVATE-FIXTURE-ONLY source research'}};
    const args={...key(),decisionId,expectedRevision:1,observation},saved=await core.call('save_dining_candidate',args,owner);
    const selected=await core.call('select_dining_candidate',{...key(),decisionId,expectedRevision:2,observationId:saved.observationId,rationale:'PRIVATE-FIXTURE-ONLY evaluation',acknowledgeUnknowns:true},owner);
    await core.call('commit_dining_selection',{...key(),decisionId,expectedRevision:3,expectedItineraryRevision:1,selectionId:selected.selectionId},owner);
    const invite=await core.callFromWeb('create_itinerary_invite',{...key(),tripId,label:'Fictional editor',role:'editor'},owner.userId);
    await core.callFromWeb('accept_itinerary_invite',{...key(),token:invite.token,displayName:'Fictional editor'},other.userId);
    const link=await core.callFromWeb('create_itinerary_view_link',{...key(),tripId,label:'Fictional viewer'},owner.userId);
    for(const [name,input] of [['get_dining_decision',{decisionId}],['list_dining_decisions',{tripId}],['compare_dining',{decisionId}],['save_dining_candidate',args]] as [ToolName,unknown][]){
      await assert.rejects(core.call(name,input,other),code('FORBIDDEN_OR_NOT_FOUND'));await assert.rejects(core.callFromWeb(name,input,other.userId),code('FORBIDDEN_OR_NOT_FOUND'));
    }
    for(const plan of [await core.callFromWeb('get_itinerary',{tripId},other.userId),await readItineraryViewLink(db,{token:link.token})]){
      assert.equal(plan.items.length,1);assert.equal(plan.items[0].sourceLink,undefined);assert.ok(!('diningResearch' in plan));assert.ok(!JSON.stringify(plan).includes('PRIVATE-FIXTURE-ONLY'));assert.ok(!JSON.stringify(plan).includes(selected.selectionId));
    }
    await db.query('update client_grants set revoked_at=now() where owner_id=$1 and client_id=$2',[owner.userId,owner.clientId]);
    await assert.rejects(core.call('save_dining_candidate',args,owner),code('FORBIDDEN_OR_NOT_FOUND'),'cached mutation cannot bypass revoked assistant grant');
    await assert.rejects(core.call('get_dining_decision',{decisionId},owner),code('FORBIDDEN_OR_NOT_FOUND'));
    await core.callFromWeb('revoke_itinerary_access',{...key(),tripId,inviteId:invite.inviteId},owner.userId);
    await assert.rejects(core.callFromWeb('get_itinerary',{tripId},other.userId),code('FORBIDDEN_OR_NOT_FOUND'));
    assert.equal(await count(db,'observations'),1);assert.equal(await count(db,'itinerary_items'),1);assert.equal(await count(db,'search_runs'),0);
  }finally{await db.close();}
});

test('dining research archive preserves linked tentative evidence and permanent trip deletion clears the entire graph without resurrection',async()=>{
  const db=await embedded();try{
    const {core,owner,tripId,decisionId}=await setup(db),saved=await core.call('save_dining_candidate',{...key(),decisionId,expectedRevision:1,observation:diningObservation()},owner);
    const selected=await core.call('select_dining_candidate',{...key(),decisionId,expectedRevision:2,observationId:saved.observationId,rationale:'Fictional selected dining',acknowledgeUnknowns:true},owner);
    const args={...key(),decisionId,expectedRevision:3,expectedItineraryRevision:1,selectionId:selected.selectionId},committed=await core.call('commit_dining_selection',args,owner);
    const before=(await core.call('get_dining_decision',{decisionId},owner));
    const archived=await core.call('archive_decision',{...key(),decisionId,expectedRevision:before.decision.revision},owner);
    assert.equal((await core.call('list_dining_decisions',{tripId},owner)).decisions.length,0);
    const archivedPlan=await core.call('get_itinerary',{tripId},owner);
    assert.equal(archivedPlan.items[0].id,committed.itemId);assert.equal(archivedPlan.diningResearch.decisions.length,0);assert.equal(archivedPlan.research.decisions.length,0);
    assert.equal(archivedPlan.research.archivedCount,1,'A dining-only trip must expose the generic archived research panel so its decision can be restored on the web');
    await assert.rejects(core.call('save_dining_candidate',{...key(),decisionId,expectedRevision:archived.revision,observation:diningObservation()},owner),code('DECISION_ARCHIVED'));
    await core.call('restore_decision',{...key(),decisionId,expectedRevision:archived.revision},owner);
    const restored=await core.call('get_dining_decision',{decisionId},owner);assert.deepEqual(restored.selection,before.selection);assert.deepEqual(restored.links,before.links);
    const review=await core.callFromWeb('prepare_trip_action',{...key(),tripId,action:'delete'},owner.userId);
    await core.callFromWeb('delete_trip',{...key(),tripId,expectedRevision:review.expectedRevision,confirmationToken:review.confirmationToken,confirmationName:review.trip.name,confirmed:true},owner.userId);
    for(const table of ['trips','decisions','candidates','observations','selections','dining_itinerary_links','itinerary_items','itinerary_events'])assert.equal(await count(db,table),0,table);
    await assert.rejects(core.call('commit_dining_selection',args,owner),code('FORBIDDEN_OR_NOT_FOUND'));assert.equal(await count(db,'itinerary_items'),0);
  }finally{await db.close();}
});
