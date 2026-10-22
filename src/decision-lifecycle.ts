import {z} from 'zod';
import {mutation,uuid,DomainError} from './domain.js';
import type {Queryable} from './database.js';
const edit={...mutation,decisionId:uuid,expectedRevision:z.number().int().positive()};
export const decisionLifecycleSchemas={
  archive_decision:z.strictObject(edit),restore_decision:z.strictObject(edit),
  list_decisions:z.strictObject({tripId:uuid,status:z.enum(['active','archived','all']).default('active'),limit:z.number().int().min(1).max(50).default(20),offset:z.number().int().min(0).default(0)}),
};
export async function changeDecisionArchive(tx:Queryable,decision:any,archived:boolean,actorId:string){
  if(!!decision.archived_at===archived)throw new DomainError('REVISION_CONFLICT','The decision status changed. Reload it before changing it.');
  if(archived&&(await tx.query('select b.id from booking_records b join selections s on s.id=b.selection_id where s.decision_id=$1 limit 1',[decision.id])).rows.length)
    throw new DomainError('BOOKING_LINKED','This decision has a booking report and cannot be archived.');
  const row=(await tx.query('update decisions set archived_at=case when $2 then now() else null end,archived_by=case when $2 then $3::uuid else null end,revision=revision+1 where id=$1 returning *',[decision.id,archived,actorId])).rows[0]!;
  await tx.query('insert into decision_lifecycle_events(decision_id,revision,actor_id,action) values($1,$2,$3,$4)',[decision.id,row.revision,actorId,archived?'archive':'restore']);
  return {decisionId:decision.id,revision:row.revision,archived,archivedAt:row.archived_at?new Date(row.archived_at).toISOString():null,archivedBy:row.archived_by};
}
