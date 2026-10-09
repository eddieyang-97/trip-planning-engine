import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError, mutation, uuid } from './domain.js';
import type { Queryable } from './database.js';

const timestamp = z.iso.datetime({ offset: true });
export const policyNoteSchema = z.strictObject({
  airline: z.string().trim().min(1).max(120),
  topic: z.enum(['sports_equipment', 'cabin_baggage', 'hold_baggage', 'check_in', 'other']),
  summary: z.string().trim().min(1).max(2000),
  applicability: z.string().trim().min(1).max(1000),
  sourceUrl: z.url().max(2000).refine(value => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  }, 'An HTTPS source without credentials is required'),
  verifiedAt: timestamp,
  reviewAfter: timestamp,
  effectiveFrom: z.iso.date().nullable(), effectiveTo: z.iso.date().nullable(),
  effectiveDateBasis: z.enum(['travel_date', 'booking_date', 'unspecified']),
  status: z.enum(['active', 'withdrawn']).default('active'),
}).refine(p => Date.parse(p.reviewAfter) > Date.parse(p.verifiedAt), 'Review date must follow verification')
  .refine(p => !p.effectiveFrom || !p.effectiveTo || p.effectiveTo >= p.effectiveFrom, 'Invalid effective date range');
export type PolicyNote = z.infer<typeof policyNoteSchema>;
export const policyReferenceSchema = z.strictObject({ noteId: uuid, version: z.number().int().positive() });
export const policyReferencesSchema = z.array(policyReferenceSchema).max(10)
  .refine(refs => new Set(refs.map(r => r.noteId)).size === refs.length, 'Reference each note only once').default([]);
const pagination = { limit: z.number().int().min(1).max(50).default(20), offset: z.number().int().min(0).default(0) };
export const policySchemas = {
  create_policy_note: z.strictObject({ ...mutation, note: policyNoteSchema }),
  update_policy_note: z.strictObject({ ...mutation, noteId: uuid, expectedVersion: z.number().int().positive(), note: policyNoteSchema }),
  get_policy_note: z.strictObject({ noteId: uuid, version: z.number().int().positive().optional() }),
  list_policy_notes: z.strictObject({ airline: z.string().trim().min(1).max(120).optional(), ...pagination }),
};
export const policyWarning = 'Manually curated reference notes, not airline-verified offers. Review dates are reminders, not freshness guarantees. Check applicability and current booking terms; notes never fill missing quote prices or prove equipment availability.';

export function policyView(row: Record<string, any>, now = new Date()) {
  return { noteId: row.id, version: row.version, latestVersion: row.current_version,
    isLatest: row.version === row.current_version, currentStatus: row.current_status,
    provenance: 'manually_curated' as const, note: row.payload,
    reviewStatus: Date.parse(row.payload.reviewAfter) <= now.getTime() ? 'review_due' : 'not_due',
    checkedAt: now.toISOString(), warning: policyWarning };
}
export async function readPolicyNote(tx: Queryable, owner: string, noteId: string, version?: number) {
  const row = (await tx.query(`select n.id,n.current_version,v.version,v.payload,current.payload->>'status' as current_status
    from policy_notes n join policy_note_versions v on v.note_id=n.id and v.version=coalesce($3,n.current_version)
    join policy_note_versions current on current.note_id=n.id and current.version=n.current_version
    where n.id=$1 and n.owner_id=$2`, [noteId,owner,version ?? null])).rows[0];
  if (!row) throw new DomainError('FORBIDDEN_OR_NOT_FOUND', 'Access denied or policy note not found');
  return policyView(row);
}
export async function readPolicyReferences(tx: Queryable, owner: string, refs: z.infer<typeof policyReferencesSchema>) {
  const notes = [];
  for (const ref of refs) notes.push(await readPolicyNote(tx,owner,ref.noteId,ref.version));
  return notes;
}
// Called only inside Core's authenticated, permission-checked, idempotent transaction.
export async function dispatchPolicy(tx: Queryable, name: keyof typeof policySchemas, a: any, owner: string) {
  if (name === 'get_policy_note') return readPolicyNote(tx,owner,a.noteId,a.version);
  if (name === 'list_policy_notes') {
    const rows = (await tx.query(`select n.id,n.current_version,v.version,v.payload,v.payload->>'status' as current_status
      from policy_notes n join policy_note_versions v on v.note_id=n.id and v.version=n.current_version
      where n.owner_id=$1 and ($2::text is null or lower(v.payload->>'airline')=lower($2))
      order by n.created_at,n.id limit $3 offset $4`,[owner,a.airline ?? null,a.limit,a.offset])).rows;
    return { notes:rows.map(row=>policyView(row)),pagination:{limit:a.limit,offset:a.offset},warning:policyWarning };
  }
  if (Date.parse(a.note.verifiedAt) > Date.now()) throw new DomainError('VALIDATION_ERROR','Verification cannot be in the future');
  let id = a.noteId, version = 1;
  if (name === 'create_policy_note') {
    id = randomUUID();
    await tx.query('insert into policy_notes(id,owner_id) values($1,$2)',[id,owner]);
  } else {
    const current = (await tx.query('select current_version from policy_notes where id=$1 and owner_id=$2 for update',[id,owner])).rows[0];
    if (!current) throw new DomainError('FORBIDDEN_OR_NOT_FOUND','Access denied or policy note not found');
    if (current.current_version !== a.expectedVersion) throw new DomainError('REVISION_CONFLICT','Reload the policy note before updating it');
    version = current.current_version + 1;
    await tx.query('update policy_notes set current_version=$2 where id=$1',[id,version]);
  }
  await tx.query('insert into policy_note_versions(note_id,version,payload) values($1,$2,$3)',[id,version,JSON.stringify(a.note)]);
  return { noteId:id,version,provenance:'manually_curated',warning:policyWarning };
}
