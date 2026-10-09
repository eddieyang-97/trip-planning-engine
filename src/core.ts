import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { canonical, criteriaSchema, DomainError, evaluate, identity, mutation, offerSchema,
  tripInput, uuid, type Actor, type Criteria, type Offer, type Permission, type Provenance } from './domain.js';
import type { Database, Queryable } from './database.js';
import type { FlightProvider } from './providers.js';
import { dispatchPolicy, policySchemas, policyReferencesSchema, readPolicyReferences } from './policies.js';

const edit = { ...mutation, decisionId: uuid, expectedRevision: z.number().int().positive() };
export const schemas = {
  ...policySchemas,
  list_trips: z.strictObject({ limit: z.number().int().min(1).max(50).default(20), offset: z.number().int().min(0).default(0) }),
  create_trip: tripInput,
  get_trip: z.strictObject({ tripId: uuid }),
  get_decision: z.strictObject({ decisionId: uuid, limit: z.number().int().min(1).max(50).default(20), offset: z.number().int().min(0).default(0) }),
  create_decision: z.strictObject({ ...mutation, tripId: uuid, title: z.string().min(1).max(120), criteria: criteriaSchema }),
  update_decision_criteria: z.strictObject({ ...edit, criteria: criteriaSchema }),
  start_search: z.strictObject({ ...edit, criteriaVersion: z.number().int().positive(), provider: z.enum(['fixture', 'live']) }),
  get_search_run: z.strictObject({ runId: uuid }),
  save_candidate: z.strictObject({ ...edit, offer: offerSchema }),
  compare_candidates: z.strictObject({ decisionId: uuid, observationIds: z.array(uuid).min(1).max(20), criteriaVersion: z.number().int().positive(), policyReferences: policyReferencesSchema }),
  compare_search_runs: z.strictObject({ previousRunId: uuid, currentRunId: uuid }),
  set_candidate_disposition: z.strictObject({ ...edit, candidateId: uuid, disposition: z.enum(['neutral', 'saved', 'rejected']) }),
  select_candidate: z.strictObject({ ...edit, observationId: uuid, rationale: z.string().min(1).max(2000), acknowledgeConditional: z.boolean().default(false), policyReferences: policyReferencesSchema }),
  record_booking: z.strictObject({ ...edit, selectionId: uuid, bookedAt: z.iso.datetime({ offset: true }), note: z.string().min(1).max(1000) }),
};
export type ToolName = keyof typeof schemas;
const reads = new Set<ToolName>(['list_policy_notes', 'get_policy_note', 'list_trips', 'get_trip', 'get_decision', 'get_search_run', 'compare_candidates', 'compare_search_runs']);
export const isRead = (name: ToolName) => reads.has(name);
function fail(code: string, message: string): never { throw new DomainError(code, message); }

async function grant(tx: Queryable, actor: Actor, permission: Permission) {
  const result = await tx.query('select permissions from client_grants where owner_id=$1 and client_id=$2 and revoked_at is null', [actor.userId, actor.clientId]);
  if (!result.rows[0]?.permissions.includes(permission)) fail('FORBIDDEN_OR_NOT_FOUND', 'Access denied or resource not found');
  if (actor.grantVersion) {
    const version = await tx.query('select grant_version from oauth_connections where owner_id=$1 and client_id=$2', [actor.userId, actor.clientId]);
    if (version.rows[0]?.grant_version !== actor.grantVersion) fail('FORBIDDEN_OR_NOT_FOUND', 'Access denied or resource not found');
  }
}
async function ownedTrip(tx: Queryable, actor: Actor, tripId: string) {
  const result = await tx.query('select * from trips where id=$1 and owner_id=$2', [tripId, actor.userId]);
  return result.rows[0] ?? fail('FORBIDDEN_OR_NOT_FOUND', 'Access denied or resource not found');
}
async function ownedDecision(tx: Queryable, actor: Actor, id: string, lock = false) {
  const result = await tx.query(`select d.* from decisions d join trips t on t.id=d.trip_id
    where d.id=$1 and t.owner_id=$2 ${lock ? 'for update of d' : ''}`, [id, actor.userId]);
  return result.rows[0] ?? fail('FORBIDDEN_OR_NOT_FOUND', 'Access denied or resource not found');
}
async function criteria(tx: Queryable, decisionId: string, version?: number): Promise<{ version: number; payload: Criteria }> {
  const result = await tx.query(`select * from criteria_versions where decision_id=$1
    ${version ? 'and version=$2' : ''} order by version desc limit 1`, version ? [decisionId, version] : [decisionId]);
  return result.rows[0] as { version: number; payload: Criteria } ?? fail('FORBIDDEN_OR_NOT_FOUND', 'Criteria not found');
}
async function saveOffer(tx: Queryable, decisionId: string, offer: Offer, provenance: Provenance, runId: string | null) {
  const key = createHash('sha256').update(identity(offer)).digest('hex');
  await tx.query('insert into candidates(id,decision_id,identity_key) values($1,$2,$3) on conflict(decision_id,identity_key) do nothing', [randomUUID(), decisionId, key]);
  const candidateId = (await tx.query('select id from candidates where decision_id=$1 and identity_key=$2', [decisionId, key])).rows[0]!.id;
  const observationId = randomUUID();
  await tx.query('insert into observations(id,decision_id,candidate_id,run_id,provenance,payload) values($1,$2,$3,$4,$5,$6)',
    [observationId, decisionId, candidateId, runId, provenance, JSON.stringify(offer)]);
  return { candidateId, observationId, provenance };
}

export class Core {
  constructor(readonly db: Database, readonly fixtureEnabled: boolean) {}
  async call(name: ToolName, input: unknown, actor: Actor): Promise<Record<string, any>> {
    const args = schemas[name].parse(input) as any;
    return this.db.transaction(async tx => {
      await grant(tx, actor, isRead(name) ? 'read' : 'write');
      if (name === 'start_search') await grant(tx, actor, 'search');
      const work = () => this.dispatch(tx, name, args, actor);
      if (isRead(name)) return work();
      const hash = createHash('sha256').update(canonical(args)).digest('hex');
      const inserted = await tx.query(`insert into mutation_requests(owner_id,operation,key,request_hash)
        values($1,$2,$3,$4) on conflict do nothing returning key`, [actor.userId, name, args.idempotencyKey, hash]);
      if (!inserted.rows.length) {
        const old = (await tx.query('select * from mutation_requests where owner_id=$1 and operation=$2 and key=$3', [actor.userId, name, args.idempotencyKey])).rows[0]!;
        if (old.request_hash !== hash) fail('IDEMPOTENCY_CONFLICT', 'Key was already used with different inputs');
        return old.response;
      }
      const result = await work();
      await tx.query('update mutation_requests set response=$4 where owner_id=$1 and operation=$2 and key=$3', [actor.userId, name, args.idempotencyKey, JSON.stringify(result)]);
      return result;
    });
  }
  private async run(tx: Queryable, actor: Actor, id: string): Promise<Record<string, any> & { observations: Record<string, any>[] }> {
    const row = (await tx.query(`select r.* from search_runs r join decisions d on r.decision_id=d.id
      join trips t on d.trip_id=t.id where r.id=$1 and t.owner_id=$2`, [id, actor.userId])).rows[0];
    if (!row) fail('FORBIDDEN_OR_NOT_FOUND', 'Access denied or resource not found');
    const observations = (await tx.query('select o.*,c.disposition from observations o join candidates c on c.id=o.candidate_id where o.run_id=$1 order by o.id', [id])).rows;
    return { ...row, observations };
  }
  private async dispatch(tx: Queryable, name: ToolName, a: any, actor: Actor): Promise<Record<string, any>> {
    if (Object.hasOwn(policySchemas,name)) return dispatchPolicy(tx,name as keyof typeof policySchemas,a,actor.userId);
    if (name === 'list_trips') return { trips: (await tx.query('select * from trips where owner_id=$1 order by created_at,id limit $2 offset $3', [actor.userId, a.limit, a.offset])).rows };
    if (name === 'create_trip') {
      const { idempotencyKey: _, ...payload } = a;
      const id = randomUUID();
      await tx.query('insert into trips(id,owner_id,payload) values($1,$2,$3)', [id, actor.userId, JSON.stringify(payload)]);
      return { tripId: id, ...payload };
    }
    if (name === 'get_trip') {
      const trip = await ownedTrip(tx, actor, a.tripId);
      const decisions = (await tx.query('select * from decisions where trip_id=$1 order by id', [a.tripId])).rows;
      for (const d of decisions) {
        d.criteria = await criteria(tx, d.id);
        d.selections = (await tx.query('select * from selections where decision_id=$1 and superseded_at is null', [d.id])).rows;
        for (const selection of d.selections) {
          const refs = (await tx.query('select note_id as "noteId",version from selection_policy_notes where selection_id=$1 order by note_id',[selection.id])).rows;
          selection.policyNotes = await readPolicyReferences(tx,actor.userId,refs as {noteId:string;version:number}[]);
        }
        d.bookings = (await tx.query('select b.* from booking_records b join selections s on b.selection_id=s.id where s.decision_id=$1', [d.id])).rows;
      }
      return { trip, decisions };
    }
    if (name === 'get_search_run') return this.run(tx, actor, a.runId);
    if (name === 'create_decision') {
      await ownedTrip(tx, actor, a.tripId);
      const id = randomUUID();
      await tx.query('insert into decisions(id,trip_id,title) values($1,$2,$3)', [id, a.tripId, a.title]);
      await tx.query('insert into criteria_versions values($1,1,$2)', [id, JSON.stringify(a.criteria)]);
      return { decisionId: id, revision: 1, criteriaVersion: 1 };
    }
    if (name === 'compare_search_runs') {
      const old = await this.run(tx, actor, a.previousRunId), current = await this.run(tx, actor, a.currentRunId);
      if (old.decision_id !== current.decision_id) fail('VALIDATION_ERROR', 'Runs must belong to the same decision');
      if (old.status !== 'complete' || current.status !== 'complete') fail('VALIDATION_ERROR', 'Both runs must finish before comparison');
      const criteriaChanged = old.criteria_version !== current.criteria_version;
      const basis = await criteria(tx, old.decision_id, old.criteria_version);
      const matchKey = (o: any) => canonical([o.candidate_id, o.payload.seller, o.payload.fare, o.payload.adults,
        o.payload.currency, o.payload.priceBasis, o.payload.exactPartyQuoted, o.payload.snowboardQuantity, o.payload.snowboardAllowed]);
      const previous = new Map<string, any>(old.observations.map((o: any) => [matchKey(o), o]));
      const seen = new Set<string>();
      const changes = current.observations.map((o: any) => {
        const key = matchKey(o); seen.add(key); const prior = previous.get(key);
        const total = (v: Offer) => criteriaChanged ? null : evaluate(v, basis.payload).totalMinor;
        const before = prior ? total(prior.payload) : null, after = total(o.payload);
        return { candidateId: o.candidate_id, observationId: o.id,
          change: prior ? 'seen_again' : 'new_or_changed_basis',
          priceDeltaMinor: before !== null && after !== null ? after - before : null,
          scheduleChanged: prior ? canonical([prior.payload.outbound, prior.payload.inbound]) !== canonical([o.payload.outbound, o.payload.inbound]) : null };
      });
      return { criteriaChanged, changes,
        notSeen: [...previous].filter(([key]) => !seen.has(key)).map(([, o]) => o.candidate_id),
        warning: 'Not seen is not sold out. Synthetic runs do not establish market price changes.' };
    }
    const decision = await ownedDecision(tx, actor, a.decisionId, !isRead(name));
    const active = await criteria(tx, decision.id);
    if (name === 'get_decision') return { decision, criteria: active,
      observations: (await tx.query(`select o.*,c.disposition from observations o join candidates c on c.id=o.candidate_id
        where o.decision_id=$1 order by o.created_at desc,o.id limit $2 offset $3`, [decision.id, a.limit, a.offset])).rows,
      pagination: { limit: a.limit, offset: a.offset },
      recentRuns: (await tx.query('select * from search_runs where decision_id=$1 order by created_at desc,id limit 20', [decision.id])).rows };
    if (!isRead(name) && a.expectedRevision !== decision.revision) fail('REVISION_CONFLICT', 'Reload the decision before changing it');
    if (name === 'compare_candidates') {
      const version = await criteria(tx, decision.id, a.criteriaVersion);
      const policyNotes = await readPolicyReferences(tx,actor.userId,a.policyReferences);
      const results = [];
      for (const id of a.observationIds) {
        const row = (await tx.query('select o.*,c.disposition from observations o join candidates c on c.id=o.candidate_id where o.id=$1 and o.decision_id=$2', [id, decision.id])).rows[0];
        if (!row) fail('FORBIDDEN_OR_NOT_FOUND', 'Access denied or resource not found');
        results.push({ observationId: id, candidateId: row.candidate_id, provenance: row.provenance,
          disposition: row.disposition, ...evaluate(row.payload, version.payload) });
      }
      const order = { eligible: 0, conditional: 1, ineligible: 2 };
      results.sort((a, b) => order[a.eligibility] - order[b.eligibility] || b.score.lower - a.score.lower || a.observationId.localeCompare(b.observationId));
      return { criteriaVersion: version.version, results, policyNotes,
        ordering: 'Eligibility first, then conservative score bound descending. Overlapping score intervals do not establish a winner.',
        assumptions: version.payload.assumptions,
        warning: 'Flight/equipment comparison only; transfer feasibility is unresolved. Synthetic examples are not bookable.' };
    }
    let result: Record<string, any>;
    if (name === 'update_decision_criteria') {
      await tx.query('insert into criteria_versions values($1,$2,$3)', [decision.id, active.version + 1, JSON.stringify(a.criteria)]);
      result = { criteriaVersion: active.version + 1 };
    } else if (name === 'start_search') {
      if (a.provider === 'live') fail('PROVIDER_ACCESS_REQUIRED', 'Live search is not implemented in this scaffold; no provider request was made');
      if (!this.fixtureEnabled) fail('PROVIDER_ACCESS_REQUIRED', 'Synthetic provider is disabled in hosted mode');
      if (a.criteriaVersion !== active.version) fail('REVISION_CONFLICT', 'Start a new run using the current criteria version');
      const pending = (await tx.query("select count(*)::int as n from search_runs where decision_id=$1 and status in ('queued','running')", [decision.id])).rows[0]!.n;
      if (pending >= 3) fail('BUDGET_EXCEEDED', 'This decision already has three unfinished searches');
      const id = randomUUID();
      await tx.query("insert into search_runs(id,decision_id,criteria_version,provider,status) values($1,$2,$3,'fixture','queued')", [id, decision.id, active.version]);
      result = { runId: id, status: 'queued', provenance: 'synthetic' };
    } else if (name === 'save_candidate') {
      result = await saveOffer(tx, decision.id, a.offer, 'user_reported', null);
    } else if (name === 'set_candidate_disposition') {
      const updated = await tx.query('update candidates set disposition=$3 where id=$1 and decision_id=$2 returning id', [a.candidateId, decision.id, a.disposition]);
      if (!updated.rows.length) fail('FORBIDDEN_OR_NOT_FOUND', 'Access denied or resource not found');
      result = { candidateId: a.candidateId, disposition: a.disposition };
    } else if (name === 'select_candidate') {
      const policyNotes = await readPolicyReferences(tx,actor.userId,a.policyReferences);
      const offer = (await tx.query('select * from observations where id=$1 and decision_id=$2', [a.observationId, decision.id])).rows[0];
      if (!offer) fail('FORBIDDEN_OR_NOT_FOUND', 'Access denied or resource not found');
      const assessment = evaluate(offer.payload, active.payload);
      if (assessment.eligibility === 'ineligible') fail('VALIDATION_ERROR', 'Known constraint failure; change criteria explicitly first');
      if (assessment.eligibility === 'conditional' && !a.acknowledgeConditional) fail('VALIDATION_ERROR', 'Acknowledge unresolved conditions before selecting');
      await tx.query('update selections set superseded_at=now() where decision_id=$1 and superseded_at is null', [decision.id]);
      const id = randomUUID();
      await tx.query('insert into selections(id,decision_id,observation_id,criteria_version,rationale,evaluation) values($1,$2,$3,$4,$5,$6)',
        [id, decision.id, offer.id, active.version, a.rationale, JSON.stringify(assessment)]);
      for (const ref of a.policyReferences) {
        await tx.query('insert into selection_policy_notes(selection_id,note_id,version) values($1,$2,$3)',[id,ref.noteId,ref.version]);
      }
      result = { selectionId: id, provenance: offer.provenance, booked: false, assessment, policyNotes };
    } else if (name === 'record_booking') {
      const selection = (await tx.query('select s.id,o.provenance from selections s join observations o on o.id=s.observation_id where s.id=$1 and s.decision_id=$2', [a.selectionId, decision.id])).rows[0];
      if (!selection) fail('FORBIDDEN_OR_NOT_FOUND', 'Access denied or resource not found');
      if (selection.provenance === 'synthetic') fail('VALIDATION_ERROR', 'A synthetic example cannot be recorded as booked');
      if (Date.parse(a.bookedAt) > Date.now()) fail('VALIDATION_ERROR', 'Booking report cannot be in the future');
      const id = randomUUID();
      await tx.query("insert into booking_records values($1,$2,$3,$4,'user_reported_booked')", [id, a.selectionId, a.bookedAt, a.note]);
      result = { bookingRecordId: id, status: 'user_reported_booked', supplierTransactionMade: false };
    } else return fail('VALIDATION_ERROR', 'Unsupported operation');
    await tx.query('update decisions set revision=revision+1 where id=$1', [decision.id]);
    return { ...result, revision: decision.revision + 1 };
  }
}

export async function runOneJob(db: Database, provider: FlightProvider) {
  const job = await db.transaction<{ id: string; decision_id: string; generation: number; criteria: Criteria } | null>(async tx => {
    // A fixture is safe to re-run after a crash. This MUST NOT be reused for paid providers.
    const row = (await tx.query(`select * from search_runs where provider='fixture' and
      (status='queued' or (status='running' and lease_until < now())) order by created_at
      limit 1 for update skip locked`)).rows[0];
    if (!row) return null;
    await tx.query("update search_runs set status='running',generation=generation+1,lease_until=now()+interval '30 seconds' where id=$1", [row.id]);
    return { id: row.id, decision_id: row.decision_id, generation: row.generation + 1, criteria: (await criteria(tx, row.decision_id, row.criteria_version)).payload };
  });
  if (!job) return false;
  try {
    const result = await provider.search(job.criteria);
    await db.transaction(async tx => {
      const valid = (await tx.query("select id from search_runs where id=$1 and generation=$2 and status='running' for update", [job.id, job.generation])).rows[0];
      if (!valid) return;
      for (const offer of result.offers.slice(0, 20)) await saveOffer(tx, job.decision_id, offerSchema.parse(offer), 'synthetic', job.id);
      await tx.query("update search_runs set status='complete',finished_at=now(),lease_until=null,coverage=$2 where id=$1", [job.id, JSON.stringify(result.coverage)]);
    });
  } catch {
    await db.query("update search_runs set status='failed',error_code='PROVIDER_UNAVAILABLE',finished_at=now(),lease_until=null where id=$1 and generation=$2 and status='running'", [job.id, job.generation]);
  }
  return true;
}
