import {createHash,randomBytes} from 'node:crypto';
import {z} from 'zod';
import {DomainError,mutation,uuid,type Actor} from './domain.js';
import type {Queryable} from './database.js';
import {activeMember} from './itinerary-sharing.js';
const revision=z.number().int().positive();
const change={...mutation,tripId:uuid,expectedRevision:revision};
const confirmation={...change,confirmationToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/),confirmationName:z.string().min(1).max(120),confirmed:z.literal(true)};
export const lifecycleSchemas={
  archive_trip:z.strictObject(change),restore_trip:z.strictObject(change),
  prepare_trip_action:z.strictObject({...mutation,tripId:uuid,action:z.enum(['delete','leave'])}),
  delete_trip:z.strictObject(confirmation),leave_trip:z.strictObject(confirmation),
};
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const denied=():never=>{throw new DomainError('FORBIDDEN_OR_NOT_FOUND','This trip or action is unavailable.');};
export async function lockDecisionTrip(tx:Queryable,decisionId:string){
  const d=(await tx.query('select trip_id from decisions where id=$1',[decisionId])).rows[0];
  return d?(await tx.query('select * from trips where id=$1 for update',[d.trip_id])).rows[0]:undefined;
}
export async function dispatchLifecycle(tx:Queryable,name:keyof typeof lifecycleSchemas,a:any,actor:Actor){
  const trip=(await tx.query('select * from trips where id=$1 for update',[a.tripId])).rows[0]??denied();
  const owner=trip.owner_id===actor.userId,action=name==='prepare_trip_action'?a.action:name==='leave_trip'?'leave':'delete';
  if(action==='leave'&&(name==='prepare_trip_action'||name==='leave_trip')){if(owner||!await activeMember(tx,trip.id,actor.userId))denied();}
  else if(!owner)denied();
  if(name==='archive_trip'||name==='restore_trip'){
    if(a.expectedRevision!==trip.lifecycle_revision)throw new DomainError('REVISION_CONFLICT','The trip changed. Refresh it before changing its status.');
    const archived=name==='archive_trip';
    await tx.query('update trips set archived_at=$2,archived_by=$3 where id=$1',[trip.id,archived?new Date().toISOString():null,archived?actor.userId:null]);
    return {tripId:trip.id,archived,sharingPreserved:true};
  }
  if(name==='prepare_trip_action'){
    await tx.query('delete from trip_action_confirmations where trip_id=$1 and (expires_at<=now() or (user_id=$2 and client_id=$3))',[trip.id,actor.userId,actor.clientId]);
    const token=randomBytes(32).toString('base64url'),expiresAt=new Date(Date.now()+10*60_000).toISOString();
    await tx.query('insert into trip_action_confirmations values($1,$2,$3,$4,$5,$6,$7)',[digest(token),trip.id,actor.userId,actor.clientId,a.action,trip.lifecycle_revision,expiresAt]);
    const {name:tripName,startDate,endDate}=trip.payload;
    const counts=a.action==='delete'?(await tx.query(`select
      (select count(*)::int from itinerary_items where trip_id=$1) as items,
      (select count(*)::int from decisions where trip_id=$1) as decisions,
      (select count(*)::int from itinerary_comments where trip_id=$1) as comments,
      (select count(*)::int from itinerary_members where trip_id=$1 and revoked_at is null) as members,
      (select count(*)::int from itinerary_invites where trip_id=$1 and revoked_at is null) as links
    `,[trip.id])).rows[0]:undefined;
    return {trip:{id:trip.id,name:tripName,startDate,endDate},action:a.action,expectedRevision:trip.lifecycle_revision,counts,confirmationToken:token,expiresAt,
      confirmationRequired:true,warning:a.action==='delete'?'Permanently removes this trip, itinerary, research, booking records, discussion and private history. All sharing and pending calendar access stop. External reservations are not cancelled. Downloaded copies cannot be recalled. Provider backup purge timing is not guaranteed in this pilot.':'Leaves only your membership. The trip and shared contributions remain. Rejoining needs a fresh invitation. An independently held anonymous view link keeps its existing access.'};
  }
  const valid=(await tx.query(`select revision from trip_action_confirmations where token_hash=$1 and trip_id=$2 and user_id=$3 and client_id=$4 and action=$5 and expires_at>now()`,[digest(a.confirmationToken),trip.id,actor.userId,actor.clientId,action])).rows[0];
  if(!valid)throw new DomainError('CONFIRMATION_REQUIRED','Review this exact trip again to get a fresh confirmation.');
  if(a.expectedRevision!==trip.lifecycle_revision||valid.revision!==trip.lifecycle_revision)throw new DomainError('REVISION_CONFLICT','The trip changed after review. Review it again before confirming.');
  if(a.confirmationName!==trip.payload.name)throw new DomainError('CONFIRMATION_REQUIRED','Enter the exact trip name shown in the confirmation.');
  await tx.query('delete from trip_action_confirmations where token_hash=$1',[digest(a.confirmationToken)]);
  if(name==='leave_trip'){
    const member=await activeMember(tx,trip.id,actor.userId)??denied();
    await tx.query('update itinerary_members set revoked_at=now() where trip_id=$1 and user_id=$2 and revoked_at is null',[trip.id,actor.userId]);
    await tx.query('update itinerary_invites set revoked_at=coalesce(revoked_at,now()) where id=$1',[member.invite_id]);
    return {tripId:trip.id,left:true,sharedContentPreserved:true};
  }
  // Root lock serializes all trip edits and worker writes. Delete children in FK order.
  for(const table of ['itinerary_comments','itinerary_events','itinerary_members','itinerary_invites','itinerary_items'])await tx.query(`delete from ${table} where trip_id=$1`,[trip.id]);
  const decisionIds='select id from decisions where trip_id=$1',selectionIds=`select id from selections where decision_id in (${decisionIds})`;
  await tx.query(`delete from selection_policy_notes where selection_id in (${selectionIds})`,[trip.id]);
  await tx.query(`delete from booking_records where selection_id in (${selectionIds})`,[trip.id]);
  for(const table of ['selections','observations'])await tx.query(`delete from ${table} where decision_id in (${decisionIds})`,[trip.id]);
  await tx.query(`delete from provider_attempts where run_id in (select id from search_runs where decision_id in (${decisionIds}))`,[trip.id]);
  for(const table of ['search_runs','candidates','criteria_versions'])await tx.query(`delete from ${table} where decision_id in (${decisionIds})`,[trip.id]);
  await tx.query('delete from decisions where trip_id=$1',[trip.id]);
  await tx.query('delete from trip_action_confirmations where trip_id=$1',[trip.id]);
  await tx.query('update mutation_requests set response=null where trip_id=$1',[trip.id]);
  await tx.query('insert into trip_deletions(trip_id) values($1)',[trip.id]);
  await tx.query('delete from trips where id=$1',[trip.id]);
  return {tripId:trip.id,deleted:true,supplierTransactionMade:false};
}
