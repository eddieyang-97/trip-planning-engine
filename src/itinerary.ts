import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError, mutation, uuid } from './domain.js';
import type { Queryable } from './database.js';

const localTime=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable();
const zone=z.string().max(80).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}},'Use a valid time zone').nullable();
const link=z.string().max(2000).refine(value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}},'Use an HTTPS link').nullable();
export const itineraryItemSchema=z.strictObject({
  type:z.enum(['flight','accommodation','transfer','activity','restaurant','note']),title:z.string().trim().min(1).max(160),
  startDate:z.iso.date().nullable(),startTime:localTime,endDate:z.iso.date().nullable(),endTime:localTime,
  timeZone:zone,endTimeZone:zone,location:z.string().trim().max(250),url:link,
  notes:z.string().trim().max(4000),openQuestion:z.string().trim().max(1000),
  status:z.enum(['tentative','user_reported_booked']),bookingNote:z.string().trim().max(1000),
}).superRefine((item,ctx)=>{
  const issue=(message:string,path:string)=>ctx.addIssue({code:'custom',message,path:[path]});
  if(item.startTime&&!item.startDate)issue('A start time needs a date','startDate');
  if(item.endTime&&!item.endDate)issue('An end time needs a date','endDate');
  if(item.endDate&&!item.startDate)issue('An end date needs a start date','startDate');
  // Different zones can legitimately display an earlier local arrival; do not compare wall times across zones.
  if(item.startDate&&item.endDate&&item.timeZone===item.endTimeZone) {
    if(item.endDate<item.startDate||(item.endDate===item.startDate&&item.startTime&&item.endTime&&item.endTime<item.startTime))issue('End precedes start in the same time zone','endDate');
  }
  if(item.status==='user_reported_booked'&&!item.bookingNote)issue('Record how you know this was booked','bookingNote');
  if(item.status==='tentative'&&item.bookingNote)issue('Booking notes require a reported booking','bookingNote');
});
export type ItineraryItem=z.infer<typeof itineraryItemSchema>;
const edit={...mutation,tripId:uuid,expectedRevision:z.number().int().positive()};
export const itinerarySchemas={
  get_itinerary:z.strictObject({tripId:uuid}),
  add_itinerary_item:z.strictObject({...edit,item:itineraryItemSchema}),
  update_itinerary_item:z.strictObject({...edit,itemId:uuid,item:itineraryItemSchema}),
  remove_itinerary_item:z.strictObject({...edit,itemId:uuid}),
  move_itinerary_item:z.strictObject({...edit,itemId:uuid,direction:z.enum(['up','down'])}),
};
function fail(code:string,message:string):never{throw new DomainError(code,message);}
export async function dispatchItinerary(tx:Queryable,name:keyof typeof itinerarySchemas,a:any,userId:string) {
  const read=name==='get_itinerary';
  const trip=(await tx.query(`select * from trips where id=$1 and owner_id=$2 ${read?'':'for update'}`,[a.tripId,userId])).rows[0];
  if(!trip)fail('FORBIDDEN_OR_NOT_FOUND','Access denied or trip not found');
  if(read)return {trip,revision:trip.itinerary_revision,
    items:(await tx.query('select * from itinerary_items where trip_id=$1 and removed_at is null order by position,id',[a.tripId])).rows,
    history:(await tx.query('select * from itinerary_events where trip_id=$1 order by revision desc limit 50',[a.tripId])).rows};
  if(a.expectedRevision!==trip.itinerary_revision)fail('REVISION_CONFLICT','The plan changed. Reload it before saving your edit.');
  let before:any=null,after:any=null,itemId=a.itemId,action='';
  if(name==='add_itinerary_item') {
    const count=(await tx.query('select count(*)::int as n,coalesce(max(position),0)::int as last from itinerary_items where trip_id=$1',[a.tripId])).rows[0]!;
    if(count.n>=500)fail('BUDGET_EXCEEDED','This pilot supports 500 items per trip, including removed items.');
    itemId=randomUUID();after={payload:a.item,position:count.last+1};action='added';
    await tx.query('insert into itinerary_items(id,trip_id,payload,position) values($1,$2,$3,$4)',[itemId,a.tripId,JSON.stringify(a.item),after.position]);
  }else{
    const row=(await tx.query('select * from itinerary_items where id=$1 and trip_id=$2 and removed_at is null',[itemId,a.tripId])).rows[0];
    if(!row)fail('FORBIDDEN_OR_NOT_FOUND','Item not found in this trip');
    before={payload:row.payload,position:row.position};
    if(name==='update_itinerary_item') {
      action='edited';after={payload:a.item,position:row.position};
      await tx.query('update itinerary_items set payload=$2,updated_at=now() where id=$1',[itemId,JSON.stringify(a.item)]);
    }else if(name==='remove_itinerary_item') {
      action='removed';await tx.query('update itinerary_items set removed_at=now(),updated_at=now() where id=$1',[itemId]);
    }else{
      // Manual ordering only within one displayed date; changing date is an explicit edit.
      const peers=(await tx.query(`select id,position from itinerary_items where trip_id=$1 and removed_at is null
        and (payload->>'startDate') is not distinct from $2 order by position,id`,[a.tripId,row.payload.startDate])).rows;
      const index=peers.findIndex(p=>p.id===itemId),other=peers[index+(a.direction==='up'?-1:1)];
      if(!other)fail('VALIDATION_ERROR','Item is already at the edge of this day');
      action='moved';after={payload:row.payload,position:other.position,swappedWith:other.id};
      await tx.query('update itinerary_items set position=$2,updated_at=now() where id=$1',[itemId,other.position]);
      await tx.query('update itinerary_items set position=$2,updated_at=now() where id=$1',[other.id,row.position]);
    }
  }
  const revision=trip.itinerary_revision+1;
  await tx.query('insert into itinerary_events(id,trip_id,item_id,actor_id,action,before_payload,after_payload,revision) values($1,$2,$3,$4,$5,$6,$7,$8)',
    [randomUUID(),a.tripId,itemId,userId,action,before?JSON.stringify(before):null,after?JSON.stringify(after):null,revision]);
  await tx.query('update trips set itinerary_revision=$2 where id=$1',[a.tripId,revision]);
  return {itemId,revision,supplierTransactionMade:false};
}
