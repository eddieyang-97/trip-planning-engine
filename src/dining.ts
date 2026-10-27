import {createHash,randomUUID} from 'node:crypto';
import type {Queryable} from './database.js';
import {DomainError,canonical} from './domain.js';
import {dispatchItinerary,itineraryItemSchema} from './itinerary.js';
import {evaluateDining,diningCriteriaSchema,diningObservationSchema,diningReads,type DiningToolName,type DiningCriteria,type DiningObservation} from './dining-domain.js';
import {sameRestaurant,diningSourceUrl} from './dining-identity.js';

const fail=(code:string,message:string):never=>{throw new DomainError(code,message);};
export async function ownedDining(tx:Queryable,decisionId:string,userId:string,lock=false){
  return (await tx.query(`select d.*,exists(select 1 from dining_itinerary_links l join itinerary_items i on i.id=l.item_id where l.decision_id=d.id and i.payload->>'status'='user_reported_booked') as booking_linked from decisions d join trips t on t.id=d.trip_id where d.id=$1 and t.owner_id=$2 and d.kind='dining' ${lock?'for update of d':''}`,[decisionId,userId])).rows[0]??fail('FORBIDDEN_OR_NOT_FOUND','Dining research is unavailable.');
}
export async function listDiningDecisions(tx:Queryable,tripId:string,userId:string){
  if(!(await tx.query('select id from trips where id=$1 and owner_id=$2',[tripId,userId])).rows.length)fail('FORBIDDEN_OR_NOT_FOUND','Dining research is unavailable.');
  const rows=(await tx.query("select d.id,d.trip_id,d.title,d.revision,d.kind,d.archived_at,exists(select 1 from dining_itinerary_links l join itinerary_items i on i.id=l.item_id where l.decision_id=d.id and i.payload->>'status'='user_reported_booked') as booking_linked from decisions d where trip_id=$1 and kind='dining' and archived_at is null order by title,id limit 21",[tripId])).rows;
  return {decisions:rows.slice(0,20).map(d=>({...d,webPath:diningPath(tripId,d.id)})),truncated:rows.length>20};
}
const diningPath=(tripId:string,decisionId:string)=>`/itinerary?trip=${tripId}&dining=${decisionId}`;
async function diningCriteria(tx:Queryable,decisionId:string):Promise<DiningCriteria>{
  const row=(await tx.query('select payload from criteria_versions where decision_id=$1 order by version desc limit 1',[decisionId])).rows[0];
  return diningCriteriaSchema.parse(row?.payload);
}
async function observation(tx:Queryable,decisionId:string,observationId:string):Promise<{id:string;candidate_id:string;payload:DiningObservation;[key:string]:any}>{
  const row=(await tx.query('select * from observations where decision_id=$1 and id=$2',[decisionId,observationId])).rows[0]??fail('FORBIDDEN_OR_NOT_FOUND','This observation does not belong to the dining decision.');
  return {...row,id:row.id,candidate_id:row.candidate_id,payload:diningObservationSchema.parse(row.payload)};
}
export async function readDiningDecision(tx:Queryable,decisionId:string,userId:string){
  const decision=await ownedDining(tx,decisionId,userId),criteria=await diningCriteria(tx,decisionId);
  const candidates:{id:string;disposition:string;rationale:string;observations:Record<string,any>[];latestObservationId:string|null;observationCount:number;[key:string]:any}[]=[];
  for(const candidate of (await tx.query('select id,disposition,rationale,rationale_by,rationale_at from candidates where decision_id=$1 order by id limit 20',[decisionId])).rows){
    const count=(await tx.query('select count(*)::int n from observations where candidate_id=$1',[candidate.id])).rows[0]!.n;
    const observations=(await tx.query('select id,payload,created_at,created_by,identity_review,provenance from observations where candidate_id=$1 order by created_at desc,id desc limit 5',[candidate.id])).rows;
    const observationHistory=(await tx.query(`select id,created_at as "createdAt",payload->'source'->>'observedAt' as "observedAt",payload->'price'->'amountMinor' as "amountMinor",payload->>'currency' as currency from observations where candidate_id=$1 order by created_at desc,id desc limit 100`,[candidate.id])).rows;
    candidates.push({...candidate,id:candidate.id,disposition:candidate.disposition,rationale:candidate.rationale,observations,observationHistory,latestObservationId:observations[0]?.id??null,observationCount:count});
  }
  const selected=(await tx.query('select * from selections where decision_id=$1 and superseded_at is null',[decisionId])).rows[0];
  const selectedObservation=selected?await observation(tx,decisionId,selected.observation_id):null;
  const selection=selected?{id:selected.id,observationId:selected.observation_id,candidateId:selectedObservation!.candidate_id,rationale:selected.rationale,evaluation:selected.evaluation,
    observation:selectedObservation!.payload,criteria,selectedBy:selected.selected_by,createdAt:selected.created_at}:null;
  const links=(await tx.query(`select l.item_id as "itemId",l.selection_id as "selectionId",l.observation_id as "observationId",l.candidate_id as "candidateId",i.removed_at as "removedAt",i.payload->>'status' as status from dining_itinerary_links l join itinerary_items i on i.id=l.item_id where l.decision_id=$1 order by l.created_at,l.item_id`,[decisionId])).rows;
  const results=candidates.flatMap(c=>c.observations[0]?[{candidateId:c.id,observationId:c.observations[0].id,...evaluateDining(c.observations[0].payload as DiningObservation,criteria)}]:[]);
  const order={eligible:0,conditional:1,ineligible:2};
  // A lower subtotal is not a cheaper meal when its exact full-party total is unknown.
  results.sort((a,b)=>order[a.eligibility]-order[b.eligibility]||(a.totalMinor===null&&b.totalMinor===null?0:a.totalMinor===null?1:b.totalMinor===null?-1:a.totalMinor-b.totalMinor)||a.candidateId.localeCompare(b.candidateId));
  return {decision,archived:!!decision.archived_at,lifecycleHistory:(await tx.query('select * from decision_lifecycle_events where decision_id=$1 order by revision desc limit 20',[decision.id])).rows,criteria,candidates,selection,links,results,webPath:diningPath(decision.trip_id,decision.id),supplierTransactionMade:false,
    ordering:'Eligibility, then complete exact-date whole-party expected meal total. Unknown totals are never ranked as cheapest. No currency conversion.',
    warning:'Manual/sourced reports are unverified. Selection and saving to the itinerary do not reserve or book.'};
}
export async function diningItemSourceLinks(tx:Queryable,tripId:string):Promise<{itemId:string;decisionId:string;candidateId:string;observationId:string;selectionId:string;rationale:string;source:DiningObservation['source'];webPath:string}[]>{
  return (await tx.query(`select l.item_id as "itemId",l.decision_id as "decisionId",l.candidate_id as "candidateId",l.observation_id as "observationId",l.selection_id as "selectionId",s.rationale,o.payload->'source' as source
    from dining_itinerary_links l join selections s on s.id=l.selection_id join observations o on o.id=l.observation_id where l.trip_id=$1`,[tripId])).rows
    .map(link=>({itemId:link.itemId,decisionId:link.decisionId,candidateId:link.candidateId,observationId:link.observationId,selectionId:link.selectionId,rationale:link.rationale,source:link.source,webPath:diningPath(tripId,link.decisionId)}));
}
export async function dispatchDining(tx:Queryable,name:DiningToolName,a:any,userId:string){
  if(name==='list_dining_decisions')return listDiningDecisions(tx,a.tripId,userId);
  if(name==='create_dining_decision'){
    const trip=(await tx.query('select payload from trips where id=$1 and owner_id=$2',[a.tripId,userId])).rows[0]??fail('FORBIDDEN_OR_NOT_FOUND','Dining research is unavailable.');
    if(a.criteria.date<trip.payload.startDate||a.criteria.date>trip.payload.endDate)fail('VALIDATION_ERROR','The meal date must be within the trip dates.');
    if(a.criteria.adults!==trip.payload.adults)fail('VALIDATION_ERROR','This dining decision must cover all adults in the trip. Subgroup dining is not supported yet.');
    const count=(await tx.query("select count(*)::int n from decisions where trip_id=$1 and kind='dining'",[a.tripId])).rows[0]!.n;
    if(count>=20)fail('BUDGET_EXCEEDED','This pilot supports 20 dining decisions per trip, including archived decisions.');
    const id=randomUUID();
    await tx.query("insert into decisions(id,trip_id,title,kind) values($1,$2,$3,'dining')",[id,a.tripId,a.title]);
    await tx.query('insert into criteria_versions values($1,1,$2)',[id,JSON.stringify(a.criteria)]);
    return {decisionId:id,revision:1,criteriaVersion:1,webPath:diningPath(a.tripId,id),supplierTransactionMade:false};
  }
  if(name==='get_dining_decision'||name==='compare_dining')return readDiningDecision(tx,a.decisionId,userId);
  const decision=await ownedDining(tx,a.decisionId,userId,!diningReads.has(name));
  if(name==='get_dining_observation'){
    const saved=await observation(tx,decision.id,a.observationId);
    return {decisionId:decision.id,observation:saved,assessment:evaluateDining(saved.payload,await diningCriteria(tx,decision.id))};
  }
  if(a.expectedRevision!==decision.revision)fail('REVISION_CONFLICT','The dining decision changed. Reload it before saving.');
  if(decision.archived_at)fail('DECISION_ARCHIVED','Restore this dining decision before changing it.');
  const criteria=await diningCriteria(tx,decision.id);
  let result:Record<string,any>;
  if(name==='save_dining_candidate'){
    let candidate:any;
    if(a.candidateId){
      candidate=(await tx.query('select * from candidates where id=$1 and decision_id=$2',[a.candidateId,decision.id])).rows[0];if(!candidate)fail('FORBIDDEN_OR_NOT_FOUND','Candidate does not belong to this dining decision.');
      const prior=(await tx.query('select id,payload from observations where candidate_id=$1 order by created_at desc,id desc limit 1',[candidate.id])).rows[0];
      if(a.identityReview&&a.identityReview.priorObservationId!==prior?.id)fail('REVISION_CONFLICT','Review the latest candidate observation before reconciling its identity.');
      if(!prior||!sameRestaurant(prior.payload,a.observation)){
        if(!a.identityReview)fail('IDENTITY_REVIEW_REQUIRED','The restaurant/source identity is missing or differs. Save a separate option, or explicitly reconcile against the latest observation with a reason after human review.');
      }
    }
    else{
      if(a.identityReview)fail('VALIDATION_ERROR','Identity reconciliation requires an existing candidate ID.');
      if((await tx.query('select count(*)::int n from candidates where decision_id=$1',[decision.id])).rows[0]!.n>=20)fail('BUDGET_EXCEEDED','This pilot supports 20 restaurants per decision.');
      const id=randomUUID(),discriminator=canonical([diningSourceUrl(a.observation.source.url),a.observation.restaurantName]);
      // Add means a distinct option; never infer identity from display labels or
      // a generic source URL. An append must explicitly target its stable ID.
      const identity='dining-v2:'+createHash('sha256').update(discriminator).digest('hex')+':'+id;
      await tx.query('insert into candidates(id,decision_id,identity_key) values($1,$2,$3)',[id,decision.id,identity]);candidate={id};
    }
    if((await tx.query('select count(*)::int n from observations where candidate_id=$1',[candidate.id])).rows[0]!.n>=100)fail('BUDGET_EXCEEDED','This pilot retains up to 100 observations per restaurant.');
    const id=randomUUID();
    await tx.query("insert into observations(id,decision_id,candidate_id,provenance,payload,created_by,identity_review) values($1,$2,$3,'user_reported',$4,$5,$6)",[id,decision.id,candidate.id,JSON.stringify(a.observation),userId,a.identityReview?JSON.stringify(a.identityReview):null]);
    result={candidateId:candidate.id,observationId:id,provenance:'user_reported'};
  }else if(name==='set_dining_disposition'){
    const update=await tx.query('update candidates set disposition=$3,rationale=$4,rationale_by=$5,rationale_at=now() where id=$1 and decision_id=$2 returning id',[a.candidateId,decision.id,a.disposition,a.rationale,userId]);
    if(!update.rows.length)fail('FORBIDDEN_OR_NOT_FOUND','Candidate does not belong to this dining decision.');
    result={candidateId:a.candidateId,disposition:a.disposition,rationale:a.rationale};
  }else if(name==='select_dining_candidate'){
    const row=await observation(tx,decision.id,a.observationId),assessment=evaluateDining(row.payload,criteria);
    if(assessment.eligibility==='ineligible')fail('VALIDATION_ERROR','This restaurant fails a known constraint. Review the dates, party, dietary fit, currency or budget.');
    if(assessment.eligibility==='conditional'&&!a.acknowledgeUnknowns)fail('VALIDATION_ERROR','Review and explicitly acknowledge the unresolved dining conditions before selecting.');
    await tx.query('update selections set superseded_at=now() where decision_id=$1 and superseded_at is null',[decision.id]);
    const id=randomUUID();
    await tx.query('insert into selections(id,decision_id,observation_id,criteria_version,rationale,evaluation,selected_by) values($1,$2,$3,1,$4,$5,$6)',[id,decision.id,row.id,a.rationale,JSON.stringify(assessment),userId]);
    result={selectionId:id,observationId:row.id,candidateId:row.candidate_id,assessment,booked:false};
  }else if(name==='commit_dining_selection'){
    const selected=(await tx.query('select * from selections where id=$1 and decision_id=$2 and superseded_at is null',[a.selectionId,decision.id])).rows[0]??fail('REVISION_CONFLICT','This selection is no longer current. Review the dining decision.');
    const trip=(await tx.query('select * from trips where id=$1 for update',[decision.trip_id])).rows[0]!;
    if(a.expectedItineraryRevision!==trip.itinerary_revision)fail('REVISION_CONFLICT','The itinerary changed. Reload and review it before saving the selected meal.');
    const existing=(await tx.query('select l.item_id,i.removed_at from dining_itinerary_links l join itinerary_items i on i.id=l.item_id where l.selection_id=$1',[selected.id])).rows[0];
    if(existing?.removed_at)fail('REVISION_CONFLICT','This selection was already saved and its itinerary item was removed. Review the plan; saving again will not restore or duplicate it.');
    if(existing)return {itemId:existing.item_id,selectionId:selected.id,revision:decision.revision,itineraryRevision:trip.itinerary_revision,alreadySaved:true,supplierTransactionMade:false};
    const row=await observation(tx,decision.id,selected.observation_id),o=row.payload;
    // Research rationale and evidence remain owner-private in the link/selection, outside shared notes.
    const item=itineraryItemSchema.parse({type:'restaurant',title:o.restaurantName,startDate:criteria.date,startTime:criteria.localTime,endDate:null,endTime:null,timeZone:criteria.timeZone,endTimeZone:null,
      location:o.location.label,url:o.source.url,notes:criteria.meal+' meal for '+criteria.adults+' adults.',openQuestion:'Confirm the table, menu, final cost and requirements directly before reserving.',status:'tentative',bookingNote:'',
      ...(o.location.precision==='exact'&&o.location.latitude!==null?{mapLocations:[{label:o.location.label||o.restaurantName,latitude:o.location.latitude,longitude:o.location.longitude}]}:{})});
    const saved=await dispatchItinerary(tx,'add_itinerary_item',{tripId:trip.id,expectedRevision:trip.itinerary_revision,item},userId);
    if(!('itemId' in saved))throw new DomainError('INTERNAL_ERROR','Unable to save this dining item. Retry the same request.');
    await tx.query('insert into dining_itinerary_links(selection_id,trip_id,decision_id,candidate_id,observation_id,item_id,created_by) values($1,$2,$3,$4,$5,$6,$7)',[selected.id,trip.id,decision.id,row.candidate_id,row.id,saved.itemId,userId]);
    result={itemId:saved.itemId,selectionId:selected.id,observationId:row.id,candidateId:row.candidate_id,itineraryRevision:saved.revision,booked:false};
  }else return fail('VALIDATION_ERROR','Unsupported dining operation');
  await tx.query('update decisions set revision=revision+1 where id=$1',[decision.id]);
  return {...result,decisionId:decision.id,revision:decision.revision+1,supplierTransactionMade:false};
}

export async function readDiningSummary(tx:Queryable,decisionId:string,userId:string){
  const decision=await ownedDining(tx,decisionId,userId),criteria=await diningCriteria(tx,decisionId);
  const s=(await tx.query('select id,observation_id,rationale,evaluation,created_at from selections where decision_id=$1 and superseded_at is null',[decisionId])).rows[0];
  const selected=s?await observation(tx,decisionId,s.observation_id):null;
  const links=(await tx.query(`select l.item_id as "itemId",l.selection_id as "selectionId",l.observation_id as "observationId",i.removed_at as "removedAt",i.payload->>'status' as status from dining_itinerary_links l join itinerary_items i on i.id=l.item_id where l.decision_id=$1 order by l.created_at,l.item_id`,[decisionId])).rows;
  return {criteria,candidateCount:(await tx.query('select count(*)::int n from candidates where decision_id=$1',[decisionId])).rows[0]!.n,
    selection:s?{id:s.id,observationId:s.observation_id,candidateId:selected!.candidate_id,rationale:s.rationale,evaluation:s.evaluation,observation:selected!.payload,criteria}:null,
    links,webPath:diningPath(decision.trip_id,decision.id)};
}
