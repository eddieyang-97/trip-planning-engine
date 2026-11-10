import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Queryable} from './database.js';
import {DomainError,uuid} from './domain.js';

const name=z.string().trim().min(1).max(60);
const travelerId=uuid.transform(value=>value.toLowerCase());
export const travelerChange=z.discriminatedUnion('action',[
  z.strictObject({action:z.literal('add'),name}),
  z.strictObject({action:z.literal('rename'),id:travelerId,name}),
  z.strictObject({action:z.literal('archive'),id:travelerId}),
  z.strictObject({action:z.literal('restore'),id:travelerId}),
]);
export const travelerIds=z.array(travelerId).max(30).refine(ids=>new Set(ids).size===ids.length,'Choose each traveler only once.');
export type Traveler={id:string;name:string;archived:boolean};

export async function readTravelers(tx:Queryable,tripId:string,owner:boolean):Promise<Traveler[]>{
  const rows=(await tx.query('select id,name,archived_at from trip_travelers where trip_id=$1 order by created_at,id',[tripId])).rows;
  return rows.map(row=>({id:row.id,name:!owner&&row.archived_at?'':row.name,archived:!!row.archived_at}));
}

export async function validateTravelers(tx:Queryable,tripId:string,ids:string[],previous:string[]=[]){
  if(!ids.length)return;
  const rows=(await tx.query('select id,archived_at from trip_travelers where trip_id=$1 and id=any($2::uuid[])',[tripId,ids])).rows;
  if(rows.length!==ids.length||rows.some(row=>row.archived_at&&!previous.includes(row.id))){
    throw new DomainError('VALIDATION_ERROR','Choose travelers from this trip. An archived traveler can only stay on an item they were already assigned to.');
  }
}

// Caller owns the trip lock, authorization and revision check.
export async function changeTraveler(tx:Queryable,tripId:string,revision:number,userId:string,change:z.infer<typeof travelerChange>){
  const id=change.action==='add'?randomUUID():change.id;
  const before=change.action==='add'?null:(await tx.query('select id,name,archived_at from trip_travelers where trip_id=$1 and id=$2',[tripId,id])).rows[0];
  let after;
  if(change.action==='add'){
    const count=(await tx.query('select count(*)::int as n from trip_travelers where trip_id=$1',[tripId])).rows[0]!.n;
    if(count>=30)throw new DomainError('BUDGET_EXCEEDED','This trip supports up to 30 traveler records, including archived travelers.');
    after=(await tx.query('insert into trip_travelers(id,trip_id,name) values($1,$2,$3) returning id,name,archived_at',[id,tripId,change.name])).rows[0];
  }else{
    if(!before)throw new DomainError('FORBIDDEN_OR_NOT_FOUND','Traveler not found in this trip.');
    if(change.action==='rename'){
      if(before.archived_at)throw new DomainError('VALIDATION_ERROR','Restore this traveler before renaming.');
      after=(await tx.query('update trip_travelers set name=$3 where trip_id=$1 and id=$2 returning id,name,archived_at',[tripId,id,change.name])).rows[0];
    }else{
      if(!!before.archived_at===(change.action==='archive'))throw new DomainError('VALIDATION_ERROR','This traveler already has that status.');
      const archivedAt=change.action==='archive'?'now()':'null';
      after=(await tx.query(`update trip_travelers set archived_at=${archivedAt} where trip_id=$1 and id=$2 returning id,name,archived_at`,[tripId,id])).rows[0];
    }
  }
  const actions={add:'traveler_added',rename:'traveler_renamed',archive:'traveler_archived',restore:'traveler_restored'};
  await tx.query('insert into itinerary_events(id,trip_id,actor_id,action,before_payload,after_payload,revision) values($1,$2,$3,$4,$5,$6,$7)',
    [randomUUID(),tripId,userId,actions[change.action],before?JSON.stringify(before):null,JSON.stringify(after),revision]);
  await tx.query('update trips set itinerary_revision=$2 where id=$1',[tripId,revision]);
  return {travelerId:id,revision};
}
