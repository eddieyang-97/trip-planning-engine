import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {z} from 'zod';
import {DomainError} from './domain.js';
import type {Database,Queryable} from './database.js';
import {activeMember} from './itinerary-sharing.js';

const revision=z.number().int().min(0).max(2_147_483_646);
export const profileInput=z.strictObject({expectedRevision:revision,
  // Retained for older clients; names alone configure a profile in the web app.
  handle:z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{2,23}$/,'Use 3–24 letters, numbers or underscores, starting with a letter.').optional(),
  displayName:z.string().trim().min(1).max(60).refine(s=>!/[\p{Cc}\p{Cf}]/u.test(s),'Use a name without control characters.'),
});
export const profileRevision=revision;
const conflict=()=>new DomainError('REVISION_CONFLICT','Your profile changed in another tab. Reload your profile before saving again.');
function project(row:Record<string,any>|undefined){
  return {handle:row?.handle??null,displayName:row?.display_name||'',revision:row?.revision??0,avatarVersion:row?.avatar_version??null,
    avatarDataUrl:row?.avatar_bytes?`data:image/webp;base64,${Buffer.from(row.avatar_bytes).toString('base64')}`:null};
}
export async function readProfile(tx:Queryable,userId:string){return project((await tx.query('select * from account_profiles where user_id=$1',[userId])).rows[0]);}
async function locked(tx:Queryable,userId:string,expectedRevision:number){
  await tx.query('insert into account_profiles(user_id) values($1) on conflict do nothing',[userId]);
  const row=(await tx.query('select revision from account_profiles where user_id=$1 for update',[userId])).rows[0]!;
  if(row.revision!==expectedRevision)throw conflict();
}
export async function saveProfile(db:Database,userId:string,input:unknown){
  const a=profileInput.parse(input);
  try{return await db.transaction(async tx=>{
    await locked(tx,userId,a.expectedRevision);
    await tx.query('update account_profiles set handle=coalesce($2,handle),display_name=$3,revision=revision+1,updated_at=now() where user_id=$1',[userId,a.handle??null,a.displayName]);
    return readProfile(tx,userId);
  });}catch(error:any){if(error.code==='23505')throw new DomainError('HANDLE_TAKEN','That handle is already in use. Try another.');throw error;}
}
let processing=0;
export async function normalizeAvatar(bytes:Buffer,mime:string){
  if(!['image/jpeg','image/png','image/webp'].includes(mime)||bytes.length>2*1024*1024||!bytes.length)throw new DomainError('INVALID_AVATAR','Choose a JPEG, PNG or WebP image smaller than 2 MB.');
  // Check the binary signature before asking the decoder to inspect the image.
  const format=bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff?'jpeg':bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'webp':null;
  if(!format||mime!==`image/${format}`)throw new DomainError('INVALID_AVATAR','This file is not a supported photo. Choose a JPEG, PNG or WebP image.');
  if(processing>=2)throw new DomainError('RATE_LIMITED','Photo processing is busy. Try again in a moment.');
  processing++;
  try{
    const image=sharp(bytes,{limitInputPixels:16_000_000,failOn:'warning'}).timeout({seconds:5});
    const metadata=await image.metadata();
    if(metadata.format!==format||(metadata.pages??1)>1)throw Error('Invalid photo');
    const avatar=await image.rotate().resize(256,256,{fit:'cover',position:'centre'}).webp({quality:72,effort:2}).toBuffer();
    if(avatar.length>24576)throw Error('Photo too complex');
    return avatar; // Re-encoding drops original EXIF/GPS and embedded metadata.
  }catch{throw new DomainError('INVALID_AVATAR','Unable to process that photo. Try a smaller, still JPEG, PNG or WebP image.');}
  finally{processing--;}
}
export async function saveAvatar(db:Database,userId:string,expectedRevision:number,bytes:Buffer|null){
  return db.transaction(async tx=>{
    await locked(tx,userId,profileRevision.parse(expectedRevision));
    await tx.query('update account_profiles set avatar_bytes=$2,avatar_version=$3,revision=revision+1,updated_at=now() where user_id=$1',[userId,bytes,bytes?randomUUID():null]);
    return readProfile(tx,userId);
  });
}
export async function readTripRoster(tx:Queryable,tripId:string,userId:string){
  const trip=(await tx.query('select owner_id from trips where id=$1',[tripId])).rows[0];
  if(!trip||trip.owner_id!==userId&&!await activeMember(tx,tripId,userId))throw new DomainError('FORBIDDEN_OR_NOT_FOUND','Access denied or trip not found');
  const rows=(await tx.query(`select p.*,m.user_id as member_id,m.display_name as member_name,m.role from
    (select $2::uuid as user_id,'Trip organizer'::text as display_name,'owner'::text as role,0 as ordering
     union all select user_id,display_name,role,1 from itinerary_members where trip_id=$1 and revoked_at is null) m
    left join account_profiles p on p.user_id=m.user_id order by m.ordering,m.display_name,m.user_id limit 21`,[tripId,trip.owner_id])).rows;
  return {members:rows.map(row=>{const p=project(row);return {handle:p.handle,displayName:p.displayName||row.member_name,avatarDataUrl:p.avatarDataUrl,role:row.role,isMe:row.member_id===userId};})};
}
