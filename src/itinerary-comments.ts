import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {DomainError,mutation,uuid} from './domain.js';
import type {Queryable} from './database.js';
import {itineraryAccess} from './itinerary.js';

export const commentSchemas={
  list_itinerary_comments:z.strictObject({tripId:uuid,itemId:uuid.optional(),before:uuid.optional(),limit:z.number().int().min(1).max(50).default(20)}),
  add_itinerary_comment:z.strictObject({...mutation,tripId:uuid,itemId:uuid.nullable().default(null),body:z.string().trim().min(1).max(2000)}),
  remove_itinerary_comment:z.strictObject({...mutation,tripId:uuid,commentId:uuid}),
};
function deny():never{throw new DomainError('FORBIDDEN_OR_NOT_FOUND','Access denied or discussion not found');}
export async function dispatchComments(tx:Queryable,name:keyof typeof commentSchemas,a:any,userId:string,fromWeb:boolean){
  const read=name==='list_itinerary_comments';
  const {role}=await itineraryAccess(tx,a.tripId,userId,!read,fromWeb);
  if(read){
    let thread:any=null;
    if(a.itemId){
      const item=(await tx.query('select payload,removed_at from itinerary_items where trip_id=$1 and id=$2',[a.tripId,a.itemId])).rows[0];
      if(!item)deny();thread={title:item.payload.title,removed:!!item.removed_at};
    }
    const params:unknown[]=[a.tripId];let filter='c.trip_id=$1';
    if(a.itemId){params.push(a.itemId);filter+=` and c.item_id=$${params.length}`;}
    if(a.before){
      const cursor=(await tx.query('select created_at,item_id from itinerary_comments where trip_id=$1 and id=$2',[a.tripId,a.before])).rows[0];
      if(!cursor||a.itemId&&cursor.item_id!==a.itemId)deny();
      params.push(a.before);filter+=` and (c.created_at,c.id)<(select created_at,id from itinerary_comments where trip_id=$1 and id=$${params.length})`;
    }
    params.push(a.limit+1);
    const rows=(await tx.query(`select c.*,i.payload->>'title' as item_title,i.removed_at as item_removed from itinerary_comments c
      left join itinerary_items i on i.id=c.item_id and i.trip_id=c.trip_id where ${filter}
      order by c.created_at desc,c.id desc limit $${params.length}`,params)).rows;
    const page=rows.slice(0,a.limit),nextBefore=rows.length>a.limit?page.at(-1)!.id:null;
    return {comments:page.reverse().map(c=>({id:c.id,itemId:c.item_id,itemTitle:c.item_title,itemRemoved:!!c.item_removed,
      body:c.deleted_at?null:c.body,authorName:c.author_label,authorRole:c.author_role,isMine:c.author_id===userId,
      canRemove:!c.deleted_at&&(role==='owner'||role==='editor'&&c.author_id===userId),createdAt:c.created_at,deletedAt:c.deleted_at})),
      nextBefore,canComment:role!=='viewer'&&!thread?.removed,thread};
  }
  if(name==='remove_itinerary_comment'){
    const c=(await tx.query('select author_id from itinerary_comments where trip_id=$1 and id=$2',[a.tripId,a.commentId])).rows[0];
    if(!c||role!=='owner'&&c.author_id!==userId)deny();
    await tx.query('update itinerary_comments set deleted_at=coalesce(deleted_at,now()),deleted_by=coalesce(deleted_by,$3) where trip_id=$1 and id=$2',[a.tripId,a.commentId,userId]);
    return {commentId:a.commentId,removed:true};
  }
  if(a.itemId){
    if(!(await tx.query('select id from itinerary_items where trip_id=$1 and id=$2 and removed_at is null',[a.tripId,a.itemId])).rows.length)deny();
  }
  const counts=(await tx.query(`select count(*)::int as total,count(*) filter(where author_id=$2 and created_at>now()-interval '10 minutes')::int as recent
    from itinerary_comments where trip_id=$1`,[a.tripId,userId])).rows[0]!;
  if(counts.total>=2000)throw new DomainError('LIMIT_REACHED','This trip has reached its discussion limit.');
  if(counts.recent>=20)throw new DomainError('LIMIT_REACHED','Too many comments. Try again in ten minutes.');
  const label=role==='owner'?'Trip organizer':(await tx.query('select display_name from itinerary_members where trip_id=$1 and user_id=$2 and revoked_at is null',[a.tripId,userId])).rows[0]?.display_name;
  if(!label)deny();
  const id=randomUUID();
  await tx.query('insert into itinerary_comments(id,trip_id,item_id,author_id,author_label,author_role,body) values($1,$2,$3,$4,$5,$6,$7)',[id,a.tripId,a.itemId,userId,label,role,a.body]);
  return {commentId:id};
}
