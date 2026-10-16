import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Database} from './database.js';
import {DomainError} from './domain.js';
import {sharedItinerary} from './itinerary-public.js';

export const viewLinkReadSchema=z.strictObject({token:z.string().regex(/^[A-Za-z0-9_-]{43}$/)});
export async function readItineraryViewLink(db:Database,input:unknown){
  const {token}=viewLinkReadSchema.parse(input),hash=createHash('sha256').update(token).digest('hex');
  return db.transaction(async tx=>{
    const link=(await tx.query(`select trip_id,expires_at from itinerary_invites where token_hash=$1
      and access_mode='link' and role='viewer' and revoked_at is null
      and (expires_at is null or expires_at>now())`,[hash])).rows[0];
    if(!link)throw new DomainError('FORBIDDEN_OR_NOT_FOUND','This view link is unavailable. It may have expired or been revoked. Ask the owner for a new link.');
    const trip=(await tx.query('select id,payload,itinerary_revision,archived_at,lifecycle_revision from trips where id=$1',[link.trip_id])).rows[0];
    if(!trip)throw new DomainError('FORBIDDEN_OR_NOT_FOUND','This view link is unavailable. Ask the owner for a new link.');
    const items=(await tx.query('select id,position,payload from itinerary_items where trip_id=$1 and removed_at is null order by position,id',[trip.id])).rows;
    const plan=sharedItinerary(trip,items),{lifecycle_revision:_,...publicTrip}=plan.trip;
    return {...plan,trip:publicTrip,sharedLink:true,linkExpiresAt:link.expires_at};
  },{readOnly:true});
}
