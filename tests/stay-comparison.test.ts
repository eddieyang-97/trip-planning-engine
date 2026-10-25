import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {embedded,migrate,type Database} from '../src/database.js';
import {Core,type ToolName} from '../src/core.js';
import {DomainError,criteriaSchema,tripInput} from '../src/domain.js';
import {flaineCriteria} from '../src/acceptance.js';
import {FixtureProvider} from '../src/providers.js';
import {stayCriteria,stayObservation} from './fixtures/stays.js';
import {evaluateStay,stayObservationSchema} from '../src/stay-domain.js';
import {readItineraryViewLink} from '../src/itinerary-view-links.js';
const key=()=>({idempotencyKey:randomUUID()});
const code=(s:string)=>(e:unknown)=>e instanceof DomainError&&e.code===s;
async function setup(db:Database,adults=10){
  await migrate(db);const core=new Core(db,false,false),owner={userId:randomUUID(),clientId:'fictional-stay-owner'},other={userId:randomUUID(),clientId:'fictional-stay-other'};
  for(const actor of [owner,other])await db.query('insert into client_grants values($1,$2,$3,null)',[actor.userId,actor.clientId,['read','write']]);
  const trip=(await core.call('create_trip',{...key(),name:'Fictional Zermatt lodging research',destination:'Fictional Zermatt',startDate:'2027-02-11',endDate:'2027-02-14',adults},owner));
  const decision=(await core.call('create_stay_decision',{...key(),tripId:trip.tripId,title:'Fictional group stay',criteria:stayCriteria(adults)},owner));
  return {db,core,owner,other,tripId:trip.tripId,decisionId:decision.decisionId};
}
async function count(db:Database,table:string){return (await db.query(`select count(*)::int n from ${table}`)).rows[0]!.n;}

test('stay comparisons use equal whole-party dates, room combinations, sleeping places and mandatory fees for 8 and 10 adults',async()=>{
  for(const adults of [8,10]){
    const db=await embedded();try{
      const {core,owner,tripId,decisionId}=await setup(db,adults);
      const hotel=stayObservation(adults),home=stayObservation(adults,'entire_home');
      const h=await core.call('save_stay_candidate',{...key(),decisionId,expectedRevision:1,observation:hotel},owner);
      const c=await core.callFromWeb('save_stay_candidate',{...key(),decisionId,expectedRevision:2,observation:home},owner.userId);
      const compared=await core.call('compare_stays',{decisionId},owner);
      assert.equal(compared.criteria.adults,adults);assert.equal(compared.candidates.length,2);assert.equal(compared.results.length,2);
      for(const [saved,fullTotal] of [[h,adults*30000],[c,adults*27500+26000]] as const){
        const result=compared.results.find((r:any)=>r.candidateId===saved.candidateId);assert.equal(result.totalMinor,fullTotal);assert.equal(result.knownSubtotalMinor,fullTotal);assert.equal(result.sleepingPlaces,adults);assert.equal(result.bedCount,adults);assert.equal(result.nights,3);assert.equal(result.eligibility,'eligible');
      }
      const read=await core.callFromWeb('get_stay_decision',{decisionId},owner.userId);assert.deepEqual(read,compared);
      assert.equal(read.candidates.find((c:any)=>c.id===h.candidateId).observations[0].payload.refundableDeposit.amountMinor,100000);
      assert.equal(new URL(read.webPath,'https://travel.example').searchParams.get('stay'),decisionId);
      assert.ok(JSON.stringify(read).includes(hotel.source.observedAt));assert.ok(JSON.stringify(read).includes(home.cancellation.terms));
      assert.equal((await core.call('get_trip',{tripId},owner)).trip.id,tripId);
      assert.equal(await count(db,'search_runs'),0);assert.equal(await count(db,'booking_records'),0);
    }finally{await db.close();}
  }
});

test('unknown cost, charges, bed capacity and availability stay conditional; different dates, party and currency cannot pass',async()=>{
  const c=stayCriteria(10),base=stayObservation(10);
  for(const observed of [
    {...base,baseTotalMinor:null},
    {...base,mandatoryChargesComplete:false,excludedCharges:['Linen fee unquoted']},
    {...base,charges:[{label:'Cleaning unquoted',kind:'cleaning' as const,amountMinor:null,includedInBase:false}]},
    {...base,charges:[{label:'Tax inclusion unconfirmed',kind:'tax' as const,amountMinor:5000,includedInBase:null}]},
    {...base,quotedAdults:null},
  ]){const result=evaluateStay(stayObservationSchema.parse(observed),c);assert.equal(result.totalMinor,null);assert.notEqual(result.eligibility,'eligible');}
  const partialAboveBudget=evaluateStay({...base,mandatoryChargesComplete:false},{...c,maximumTotalMinor:250000});assert.equal(partialAboveBudget.totalMinor,null);assert.equal(partialAboveBudget.eligibility,'ineligible');assert.equal(partialAboveBudget.checks.find(check=>check.name==='budget')?.status,'fail');
  assert.equal(evaluateStay({...base,baseTotalMinor:null,charges:[{label:'Known cleaning',kind:'cleaning',amountMinor:20000,includedInBase:false}]},c).knownSubtotalMinor,20000);
  assert.notEqual(evaluateStay({...base,currency:'GBP',mandatoryChargesComplete:false},{...c,maximumTotalMinor:250000}).checks.find(check=>check.name==='budget')?.status,'fail','Never infer CHF budget failure from GBP without conversion');
  const unknownBeds=evaluateStay({...base,units:[{name:'Double room',count:5,beds:[{type:'double',count:1,sleepingPlaces:null}]}]},c);
  assert.equal(unknownBeds.sleepingPlaces,null);assert.equal(unknownBeds.bedCount,5);assert.equal(unknownBeds.eligibility,'conditional','double bed does not imply two usable places');
  const noBeds=evaluateStay({...base,units:[{name:'Unconfirmed layout',count:5,beds:[]}]},c);assert.equal(noBeds.sleepingPlaces,null);assert.equal(noBeds.bedCount,null);
  for(const observed of [{...base,quotedAdults:8},{...base,currency:'GBP'},{...base,checkOut:'2027-02-15'},{...base,availability:'unavailable' as const}])assert.equal(evaluateStay(observed,c).eligibility,'ineligible');
  assert.equal(evaluateStay({...base,units:[{name:'Four twin rooms',count:4,beds:[{type:'single',count:2,sleepingPlaces:1}]}]},c).eligibility,'ineligible');
  const db=await embedded();try{
    const s=await setup(db),saved=await s.core.call('save_stay_candidate',{...key(),decisionId:s.decisionId,expectedRevision:1,observation:{...base,availability:'unknown'}},s.owner);
    await assert.rejects(s.core.call('select_stay_candidate',{...key(),decisionId:s.decisionId,expectedRevision:2,observationId:saved.observationId,rationale:'Review uncertainty',acknowledgeUnknowns:false},s.owner),code('VALIDATION_ERROR'));
    const selected=await s.core.call('select_stay_candidate',{...key(),decisionId:s.decisionId,expectedRevision:2,observationId:saved.observationId,rationale:'Availability remains a dated unknown, to confirm separately',acknowledgeUnknowns:true},s.owner);
    assert.ok(selected.selectionId);assert.equal(await count(db,'booking_records'),0);assert.equal(await count(db,'itinerary_items'),0);
    const budgetDecision=await s.core.call('create_stay_decision',{...key(),tripId:s.tripId,title:'Fictional hard budget',criteria:{...c,maximumTotalMinor:250000}},s.owner);
    const tooExpensive=await s.core.call('save_stay_candidate',{...key(),decisionId:budgetDecision.decisionId,expectedRevision:1,observation:{...base,mandatoryChargesComplete:false}},s.owner);
    await assert.rejects(s.core.call('select_stay_candidate',{...key(),decisionId:budgetDecision.decisionId,expectedRevision:2,observationId:tooExpensive.observationId,rationale:'Acknowledgement cannot override known budget failure',acknowledgeUnknowns:true},s.owner),code('VALIDATION_ERROR'));assert.equal(await count(db,'selections'),1);
  }finally{await db.close();}
});

test('new manual prices append evidence while selected observations, independent rationale and reported itinerary bookings survive',async()=>{
  const db=await embedded();try{
    const {core,owner,tripId,decisionId}=await setup(db),old=stayObservation();
    const saved=await core.call('save_stay_candidate',{...key(),decisionId,expectedRevision:1,observation:old},owner);
    await core.call('set_stay_disposition',{...key(),decisionId,expectedRevision:2,candidateId:saved.candidateId,disposition:'saved',rationale:'PRIVATE-FIXTURE-ONLY shortlist reasoning'},owner);
    const selected=await core.call('select_stay_candidate',{...key(),decisionId,expectedRevision:3,observationId:saved.observationId,rationale:'PRIVATE-FIXTURE-ONLY selected evidence'},owner);
    const commit=await core.callFromWeb('commit_stay_selection',{...key(),decisionId,expectedRevision:4,expectedItineraryRevision:1,selectionId:selected.selectionId},owner.userId);
    let plan=await core.call('get_itinerary',{tripId},owner);assert.equal(plan.items[0].payload.status,'tentative');assert.equal(plan.items[0].payload.bookingNote,'');assert.equal(plan.items[0].sourceLink.observationId,saved.observationId);
    const booked={...plan.items[0].payload,status:'user_reported_booked',bookingNote:'PRIVATE-FIXTURE-ONLY externally booked report'};
    await core.call('update_itinerary_item',{...key(),tripId,itemId:commit.itemId,expectedRevision:plan.revision,item:booked},owner);
    const frozenItem=(await db.query('select * from itinerary_items where id=$1',[commit.itemId])).rows[0];
    const current=await core.call('get_stay_decision',{decisionId},owner);
    const later=await core.call('save_stay_candidate',{...key(),decisionId,expectedRevision:current.decision.revision,candidateId:saved.candidateId,observation:{...old,baseTotalMinor:250000,source:{...old.source,observedAt:'2026-10-02T13:00:00Z'}}},owner);
    assert.equal(later.candidateId,saved.candidateId);assert.notEqual(later.observationId,saved.observationId);
    let newest=later;for(let n=0;n<5;n++)newest=await core.call('save_stay_candidate',{...key(),decisionId,expectedRevision:newest.revision,candidateId:saved.candidateId,observation:{...old,baseTotalMinor:260000+n}},owner);
    const fresh=await core.callFromWeb('get_stay_decision',{decisionId},owner.userId);
    assert.equal((await core.call('list_decisions',{tripId},owner)).decisions.find((d:any)=>d.id===decisionId).booking_linked,true);
    await assert.rejects(core.call('archive_decision',{...key(),decisionId,expectedRevision:fresh.decision.revision},owner),code('BOOKING_LINKED'));
    assert.equal((await core.call('get_stay_decision',{decisionId},owner)).decision.revision,fresh.decision.revision);assert.equal(await count(db,'decision_lifecycle_events'),0);
    assert.equal(fresh.selection.selectedBy,owner.userId);assert.equal(fresh.candidates[0].rationale_by,owner.userId);assert.equal((await core.call('get_stay_observation',{decisionId,observationId:saved.observationId},owner)).observation.created_by,owner.userId);assert.equal((await db.query('select created_by from stay_itinerary_links where item_id=$1',[commit.itemId])).rows[0]!.created_by,owner.userId);
    assert.equal(fresh.selection.observationId,saved.observationId);assert.equal(fresh.selection.rationale,'PRIVATE-FIXTURE-ONLY selected evidence');assert.equal(fresh.candidates[0].rationale,'PRIVATE-FIXTURE-ONLY shortlist reasoning');
    assert.equal(fresh.candidates[0].observations.length,5);assert.equal(fresh.candidates[0].observationCount,7);assert.ok(fresh.candidates[0].observationHistory.some((o:any)=>o.id===saved.observationId),'historical metadata discovers the exact observation outside the five full payloads');assert.equal(fresh.candidates[0].latestObservationId,newest.observationId);assert.ok(!fresh.candidates[0].observations.some((o:any)=>o.id===saved.observationId),'selected evidence remains independently retrievable outside the bounded recent window');
    assert.equal((await core.call('get_stay_observation',{decisionId,observationId:saved.observationId},owner)).observation.payload.baseTotalMinor,old.baseTotalMinor);
    assert.deepEqual((await db.query('select * from itinerary_items where id=$1',[commit.itemId])).rows[0],frozenItem);
    plan=await core.call('get_itinerary',{tripId},owner);assert.equal(plan.items[0].payload.status,'user_reported_booked');assert.equal(plan.items[0].sourceLink.selectionId,selected.selectionId);
    assert.equal(await count(db,'observations'),7);assert.equal(await count(db,'selections'),1);assert.equal(await count(db,'itinerary_items'),1);assert.equal(await count(db,'itinerary_events'),2);assert.equal(await count(db,'booking_records'),0);
  }finally{await db.close();}
});

test('reviewed tentative commit is idempotent, revision guarded and cannot use cross-decision selections',async()=>{
  const db=await embedded();try{
    const {core,owner,tripId,decisionId}=await setup(db),saved=await core.call('save_stay_candidate',{...key(),decisionId,expectedRevision:1,observation:stayObservation()},owner);
    const selected=await core.call('select_stay_candidate',{...key(),decisionId,expectedRevision:2,observationId:saved.observationId,rationale:'Fictional reviewed group fit'},owner);
    const args={...key(),decisionId,expectedRevision:3,expectedItineraryRevision:1,selectionId:selected.selectionId};
    const interrupted:Database={...db,transaction:(fn,options)=>db.transaction(tx=>fn({...tx,query:async(sql,params)=>{if(sql.startsWith('insert into stay_itinerary_links'))throw Error('Fictional link persistence failure after item insertion');return tx.query(sql,params) as any;}}),options)};
    await assert.rejects(new Core(interrupted,false).call('commit_stay_selection',args,owner),/Fictional link persistence failure/);
    for(const table of ['itinerary_items','itinerary_events','stay_itinerary_links'])assert.equal(await count(db,table),0,'whole transaction rolls back '+table);
    assert.equal((await db.query('select revision from decisions where id=$1',[decisionId])).rows[0]!.revision,3);assert.equal((await db.query('select itinerary_revision from trips where id=$1',[tripId])).rows[0]!.itinerary_revision,1);assert.equal((await db.query("select count(*)::int n from mutation_requests where operation='commit_stay_selection'")).rows[0]!.n,0);
    await assert.rejects(core.call('commit_stay_selection',{...args,...key(),expectedItineraryRevision:2},owner),code('REVISION_CONFLICT'));
    const first=await core.call('commit_stay_selection',args,owner);assert.equal(first.supplierTransactionMade,false);assert.deepEqual(await core.callFromWeb('commit_stay_selection',args,owner.userId),first);
    let read=await core.call('get_stay_decision',{decisionId},owner),plan=await core.call('get_itinerary',{tripId},owner);
    const repeated=await core.call('commit_stay_selection',{...args,...key(),expectedRevision:read.decision.revision,expectedItineraryRevision:plan.revision},owner);assert.equal(repeated.itemId,first.itemId);
    await assert.rejects(core.call('commit_stay_selection',{...args,...key()},owner),code('REVISION_CONFLICT'));
    const otherDecision=await core.call('create_stay_decision',{...key(),tripId,title:'Other fictional decision',criteria:stayCriteria()},owner);
    await assert.rejects(core.call('commit_stay_selection',{...args,...key(),decisionId:otherDecision.decisionId,expectedRevision:1,expectedItineraryRevision:plan.revision},owner),code('REVISION_CONFLICT'));
    read=await core.call('get_stay_decision',{decisionId},owner);assert.equal(read.links.length,1);assert.equal(read.links[0].itemId,first.itemId);assert.equal(read.links[0].observationId,saved.observationId);
    assert.equal(await count(db,'itinerary_items'),1);assert.equal(await count(db,'stay_itinerary_links'),1);assert.equal(await count(db,'itinerary_events'),1);assert.equal(await count(db,'booking_records'),0);
    plan=await core.call('get_itinerary',{tripId},owner);
    await core.call('remove_itinerary_item',{...key(),tripId,itemId:first.itemId,expectedRevision:plan.revision},owner);
    const removed=(await db.query('select * from itinerary_items where id=$1',[first.itemId])).rows[0];assert.ok(removed!.removed_at);
    await assert.rejects(core.call('commit_stay_selection',args,owner),(e:any)=>e instanceof DomainError&&/removed/i.test(e.message));
    read=await core.call('get_stay_decision',{decisionId},owner);plan=await core.call('get_itinerary',{tripId},owner);
    await assert.rejects(core.call('commit_stay_selection',{...args,...key(),expectedRevision:read.decision.revision,expectedItineraryRevision:plan.revision},owner),(e:any)=>e instanceof DomainError&&/removed/i.test(e.message));
    assert.deepEqual((await db.query('select * from itinerary_items where id=$1',[first.itemId])).rows[0],removed);assert.equal(await count(db,'itinerary_items'),1);assert.equal(await count(db,'itinerary_events'),2);assert.equal(plan.items.length,0);
  }finally{await db.close();}
});

test('stay research and cached writes are owner/grant protected; shared plans do not expose provenance, rationale or source links',async()=>{
  const db=await embedded();try{
    const {core,owner,other,tripId,decisionId}=await setup(db),observation={...stayObservation(),source:{...stayObservation().source,label:'PRIVATE-FIXTURE-ONLY source research'}};
    const args={...key(),decisionId,expectedRevision:1,observation},saved=await core.call('save_stay_candidate',args,owner);
    const selected=await core.call('select_stay_candidate',{...key(),decisionId,expectedRevision:2,observationId:saved.observationId,rationale:'PRIVATE-FIXTURE-ONLY evaluation'},owner);
    await core.call('commit_stay_selection',{...key(),decisionId,expectedRevision:3,expectedItineraryRevision:1,selectionId:selected.selectionId},owner);
    const invite=await core.callFromWeb('create_itinerary_invite',{...key(),tripId,label:'Fictional editor',role:'editor'},owner.userId);
    await core.callFromWeb('accept_itinerary_invite',{...key(),token:invite.token,displayName:'Fictional editor'},other.userId);
    const link=await core.callFromWeb('create_itinerary_view_link',{...key(),tripId,label:'Fictional viewer'},owner.userId);
    for(const [name,input] of [['get_stay_decision',{decisionId}],['list_stay_decisions',{tripId}],['compare_stays',{decisionId}],['save_stay_candidate',args]] as [ToolName,unknown][]){
      await assert.rejects(core.call(name,input,other),code('FORBIDDEN_OR_NOT_FOUND'));await assert.rejects(core.callFromWeb(name,input,other.userId),code('FORBIDDEN_OR_NOT_FOUND'));
    }
    for(const plan of [await core.callFromWeb('get_itinerary',{tripId},other.userId),await readItineraryViewLink(db,{token:link.token})]){
      assert.equal(plan.items.length,1);assert.equal(plan.items[0].sourceLink,undefined);assert.ok(!('stayResearch' in plan));assert.ok(!JSON.stringify(plan).includes('PRIVATE-FIXTURE-ONLY'));assert.ok(!JSON.stringify(plan).includes(selected.selectionId));
    }
    await db.query('update client_grants set revoked_at=now() where owner_id=$1 and client_id=$2',[owner.userId,owner.clientId]);
    await assert.rejects(core.call('save_stay_candidate',args,owner),code('FORBIDDEN_OR_NOT_FOUND'),'cached mutation cannot bypass revoked assistant grant');
    await assert.rejects(core.call('get_stay_decision',{decisionId},owner),code('FORBIDDEN_OR_NOT_FOUND'));
    await core.callFromWeb('revoke_itinerary_access',{...key(),tripId,inviteId:invite.inviteId},owner.userId);
    await assert.rejects(core.callFromWeb('get_itinerary',{tripId},other.userId),code('FORBIDDEN_OR_NOT_FOUND'));
    assert.equal(await count(db,'observations'),1);assert.equal(await count(db,'itinerary_items'),1);assert.equal(await count(db,'search_runs'),0);
  }finally{await db.close();}
});

test('stay research archive preserves linked tentative evidence and permanent trip deletion clears the entire graph without resurrection',async()=>{
  const db=await embedded();try{
    const {core,owner,tripId,decisionId}=await setup(db),saved=await core.call('save_stay_candidate',{...key(),decisionId,expectedRevision:1,observation:stayObservation()},owner);
    const selected=await core.call('select_stay_candidate',{...key(),decisionId,expectedRevision:2,observationId:saved.observationId,rationale:'Fictional selected lodging'},owner);
    const args={...key(),decisionId,expectedRevision:3,expectedItineraryRevision:1,selectionId:selected.selectionId},committed=await core.call('commit_stay_selection',args,owner);
    const before=(await core.call('get_stay_decision',{decisionId},owner));
    const archived=await core.call('archive_decision',{...key(),decisionId,expectedRevision:before.decision.revision},owner);
    assert.equal((await core.call('list_stay_decisions',{tripId},owner)).decisions.length,0);
    const archivedPlan=await core.call('get_itinerary',{tripId},owner);
    assert.equal(archivedPlan.items[0].id,committed.itemId);assert.equal(archivedPlan.stayResearch.decisions.length,0);assert.equal(archivedPlan.research.decisions.length,0);
    assert.equal(archivedPlan.research.archivedCount,1,'A stay-only trip must expose the generic archived research panel so its decision can be restored on the web');
    await assert.rejects(core.call('save_stay_candidate',{...key(),decisionId,expectedRevision:archived.revision,observation:stayObservation()},owner),code('DECISION_ARCHIVED'));
    await core.call('restore_decision',{...key(),decisionId,expectedRevision:archived.revision},owner);
    const restored=await core.call('get_stay_decision',{decisionId},owner);assert.deepEqual(restored.selection,before.selection);assert.deepEqual(restored.links,before.links);
    const review=await core.callFromWeb('prepare_trip_action',{...key(),tripId,action:'delete'},owner.userId);
    await core.callFromWeb('delete_trip',{...key(),tripId,expectedRevision:review.expectedRevision,confirmationToken:review.confirmationToken,confirmationName:review.trip.name,confirmed:true},owner.userId);
    for(const table of ['trips','decisions','candidates','observations','selections','stay_itinerary_links','itinerary_items','itinerary_events'])assert.equal(await count(db,table),0,table);
    await assert.rejects(core.call('commit_stay_selection',args,owner),code('FORBIDDEN_OR_NOT_FOUND'));assert.equal(await count(db,'itinerary_items'),0);
  }finally{await db.close();}
});

test('ten-adult trip validation leaves flight limits unchanged and stay tables have effective Data API protection',async()=>{
  assert.ok(tripInput.safeParse({...key(),name:'Ten',destination:'Fictional resort',startDate:'2027-02-11',endDate:'2027-02-14',adults:10}).success);
  assert.equal(tripInput.safeParse({...key(),name:'Eleven',destination:'Fictional resort',startDate:'2027-02-11',endDate:'2027-02-14',adults:11}).success,false);
  assert.equal(criteriaSchema.safeParse({...flaineCriteria,adults:10}).success,false);
  const db=await embedded();try{
    await db.execute('create role anon; create role authenticated; alter default privileges in schema public grant all on tables to anon,authenticated');
    const {core,owner,decisionId,tripId}=await setup(db);
    const mutationCount=await count(db,'mutation_requests');
    await assert.rejects(core.call('create_stay_decision',{...key(),tripId,title:'Incorrect subgroup basis',criteria:stayCriteria(8)},owner),code('VALIDATION_ERROR'));
    assert.equal(await count(db,'decisions'),1);assert.equal(await count(db,'criteria_versions'),1);assert.equal(await count(db,'mutation_requests'),mutationCount);
    for(const role of ['anon','authenticated']){
      assert.equal((await db.query("select has_table_privilege($1,'stay_itinerary_links','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') allowed",[role])).rows[0]!.allowed,false);
      await assert.rejects(db.transaction(async tx=>{await tx.execute(`set local role ${role}`);return tx.query('select * from stay_itinerary_links');}),(e:any)=>e.code==='42501');
    }
    assert.equal((await db.query("select relrowsecurity from pg_class where oid='stay_itinerary_links'::regclass")).rows[0]!.relrowsecurity,true);
    const flight=(await new FixtureProvider().search(flaineCriteria)).offers[0]!;
    await assert.rejects(core.call('save_candidate',{...key(),decisionId,expectedRevision:1,offer:flight},owner),code('VALIDATION_ERROR'));
    await assert.rejects(core.call('update_decision_criteria',{...key(),decisionId,expectedRevision:1,criteria:flaineCriteria},owner),code('VALIDATION_ERROR'));
    assert.equal(await count(db,'observations'),0);assert.equal(await count(db,'criteria_versions'),1);
  }finally{await db.close();}
});
