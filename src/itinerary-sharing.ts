import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {DomainError,mutation,uuid} from './domain.js';
import type {Queryable} from './database.js';

const token=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const sharingSchemas={
  create_itinerary_view_link:z.strictObject({...mutation,tripId:uuid,label:z.string().trim().max(80),expiresInDays:z.union([z.literal(7),z.literal(30),z.literal(90),z.null()]).default(null)}),
  create_itinerary_invite:z.strictObject({...mutation,tripId:uuid,label:z.string().trim().max(80),role:z.enum(['viewer','editor']).default('viewer')}),
  get_itinerary_invite:z.strictObject({token}),
  accept_itinerary_invite:z.strictObject({...mutation,token,displayName:z.string().trim().min(1).max(60)}),
  list_itinerary_access:z.strictObject({tripId:uuid}),
  revoke_itinerary_access:z.strictObject({...mutation,tripId:uuid,inviteId:uuid}),
};
const denied=():never=>{throw new DomainError('FORBIDDEN_OR_NOT_FOUND','This invitation or itinerary is unavailable. It may have expired or been revoked.');};
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
async function owned(tx:Queryable,tripId:string,userId:string,lock=false){
  return (await tx.query(`select * from trips where id=$1 and owner_id=$2 ${lock?'for update':''}`,[tripId,userId])).rows[0]??denied();
}
export async function activeMember(tx:Queryable,tripId:string,userId:string){
  return (await tx.query('select role,invite_id from itinerary_members where trip_id=$1 and user_id=$2 and revoked_at is null',[tripId,userId])).rows[0] as {role:'viewer'|'editor';invite_id:string}|undefined;
}
async function invitation(tx:Queryable,value:string,userId:string,lock=false){
  const invite=(await tx.query('select * from itinerary_invites where token_hash=$1',[digest(value)])).rows[0]??denied();
  // Trip first, then invitation: the same lock order as owner revocation and creation.
  const trip=(await tx.query(`select * from trips where id=$1 ${lock?'for update':''}`,[invite.trip_id])).rows[0]??denied();
  const current=lock?(await tx.query('select * from itinerary_invites where id=$1 for update',[invite.id])).rows[0]!:invite;
  if(current.access_mode!=='account'||current.revoked_at||trip.owner_id===userId)denied();
  if(current.accepted_by){
    if(current.accepted_by!==userId||(await activeMember(tx,trip.id,userId))?.invite_id!==current.id)denied();
  }else if(new Date(current.expires_at).getTime()<=Date.now())denied();
  return {invite:current,trip};
}
export async function dispatchSharing(tx:Queryable,name:keyof typeof sharingSchemas,a:any,userId:string){
  if(name==='get_itinerary_invite'||name==='accept_itinerary_invite'){
    const {invite,trip}=await invitation(tx,a.token,userId,name==='accept_itinerary_invite');
    if(name==='get_itinerary_invite')return {trip:{id:trip.id,payload:trip.payload},role:invite.role,alreadyJoined:!!invite.accepted_by,expiresAt:invite.expires_at};
    if(!invite.accepted_by){
      const count=(await tx.query('select count(*)::int n from itinerary_members where trip_id=$1 and revoked_at is null',[trip.id])).rows[0]!.n;
      const previous=await activeMember(tx,trip.id,userId);
      if(count>=20&&!previous)throw new DomainError('BUDGET_EXCEEDED','This itinerary already has 20 collaborators.');
      if(previous)await tx.query('update itinerary_invites set revoked_at=coalesce(revoked_at,now()) where id=$1',[previous.invite_id]);
      await tx.query(`insert into itinerary_members(id,trip_id,user_id,display_name,invite_id,role) values($1,$2,$3,$4,$5,$6)
        on conflict(trip_id,user_id) do update set display_name=$4,invite_id=$5,role=$6,joined_at=now(),revoked_at=null`,[randomUUID(),trip.id,userId,a.displayName,invite.id,invite.role]);
      await tx.query('update itinerary_invites set accepted_by=$2,accepted_at=now() where id=$1',[invite.id,userId]);
    }
    return {tripId:trip.id,role:invite.role};
  }
  await owned(tx,a.tripId,userId,name!=='list_itinerary_access');
  if(name==='list_itinerary_access')return {invites:(await tx.query(`select i.id,i.label,i.role,i.access_mode,i.created_at,i.expires_at,i.accepted_at,i.revoked_at,
    coalesce(nullif(p.display_name,''),m.display_name) as display_name,p.handle from itinerary_invites i left join itinerary_members m on m.invite_id=i.id
    left join account_profiles p on p.user_id=m.user_id
    where i.trip_id=$1 order by i.created_at desc,i.id limit 100`,[a.tripId])).rows};
  if(name==='revoke_itinerary_access'){
    if(!(await tx.query('select id from itinerary_invites where id=$1 and trip_id=$2',[a.inviteId,a.tripId])).rows.length)denied();
    await tx.query('update itinerary_invites set revoked_at=coalesce(revoked_at,now()) where id=$1',[a.inviteId]);
    await tx.query('update itinerary_members set revoked_at=coalesce(revoked_at,now()) where invite_id=$1',[a.inviteId]);
    return {revoked:true};
  }
  const count=(await tx.query(`select count(*)::int n,count(*) filter(where revoked_at is null and accepted_at is null and (expires_at is null or expires_at>now()))::int active
    from itinerary_invites where trip_id=$1`,[a.tripId])).rows[0]!;
  if(count.n>=100||count.active>=10)throw new DomainError('BUDGET_EXCEEDED','Invitation limit reached. Revoke unused links; this pilot supports 100 invitations per trip.');
  const raw=randomBytes(32).toString('base64url'),id=randomUUID();
  if(name==='create_itinerary_view_link'){
    const expiry=a.expiresInDays===null?null:new Date(Date.now()+a.expiresInDays*86400000).toISOString();
    const row=(await tx.query(`insert into itinerary_invites(id,trip_id,token_hash,label,role,access_mode,expires_at)
      values($1,$2,$3,$4,'viewer','link',$5) returning expires_at`,[id,a.tripId,digest(raw),a.label,expiry])).rows[0]!;
    return {inviteId:id,token:raw,role:'viewer',accessMode:'link',expiresAt:row.expires_at,linkAvailable:true};
  }
  const row=(await tx.query('insert into itinerary_invites(id,trip_id,token_hash,label,role) values($1,$2,$3,$4,$5) returning expires_at',[id,a.tripId,digest(raw),a.label,a.role])).rows[0]!;
  return {inviteId:id,token:raw,role:a.role,expiresAt:row.expires_at,linkAvailable:true};
}
