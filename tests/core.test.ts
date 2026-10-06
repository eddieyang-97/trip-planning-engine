import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { flaineCriteria, flaineTrip } from '../src/acceptance.js';
import { Core, runOneJob } from '../src/core.js';
import { embedded, migrate, type Database } from '../src/database.js';
import { DomainError, evaluate, type Actor, type Offer } from '../src/domain.js';
import { FixtureProvider } from '../src/providers.js';

let db: Database;
let core: Core;
const provider = new FixtureProvider();
const key = () => ({ idempotencyKey: randomUUID() });
const errorCode = (code: string) => (e: unknown) => e instanceof DomainError && e.code === code;
before(async () => { db = await embedded(); await migrate(db); core = new Core(db, true); });
after(async () => { await db?.close(); });
async function actor(permissions = ['read', 'write', 'search']): Promise<Actor> {
  const a = { userId: randomUUID(), clientId: 'test-client' };
  await db.query('insert into client_grants values($1,$2,$3,null)', [a.userId, a.clientId, permissions]); return a;
}
async function decision() {
  const a = await actor();
  const t = await core.call('create_trip', { ...key(), ...flaineTrip }, a);
  const d = await core.call('create_decision', { ...key(), tripId: t.tripId, title: 'Flights', criteria: flaineCriteria }, a);
  return { a, t, d };
}
async function run(a: Actor, decisionId: string, revision: number) {
  const r = await core.call('start_search', { ...key(), decisionId, expectedRevision: revision, criteriaVersion: 1, provider: 'fixture' }, a);
  await runOneJob(db, provider);
  return core.call('get_search_run', { runId: r.runId }, a);
}

test('Flaine: full party, all airport coverage, unknown equipment and fare basis remain conditional', async () => {
  const { a, d } = await decision(); const r = await run(a, d.decisionId, 1);
  assert.equal(r.status, 'complete'); assert.equal(r.observations.length, 3);
  assert.equal(r.coverage.complete, false); assert.equal(r.coverage.unknownCoverageAirports.length, 5);
  const c = await core.call('compare_candidates', { decisionId: d.decisionId, criteriaVersion: 1, observationIds: r.observations.map((o: any) => o.id) }, a);
  assert.equal(c.results.filter((x: any) => x.totalMinor === null).length, 2);
  assert.equal(c.results.find((x: any) => x.totalMinor !== null).totalMinor, 71000);
  assert.ok(c.results.every((x: any) => x.provenance === 'synthetic'));
  const unknown = c.results.find((x: any) => x.totalMinor === null);
  assert.equal(unknown.eligibility, 'conditional'); assert.ok(unknown.score.upper > unknown.score.lower);
});

test('hard constraints fail independently of preference scores; currency and freshness are explicit', async () => {
  const { offers } = await provider.search(flaineCriteria);
  assert.equal(evaluate(offers[0]!, { ...flaineCriteria, earliestOutboundLocal: '18:00' }).eligibility, 'ineligible');
  assert.equal(evaluate({ ...offers[1]!, currency: 'EUR' }, flaineCriteria).totalMinor, null);
  assert.equal(evaluate({ ...offers[1]!, expiresAt: null }, flaineCriteria).eligibility, 'conditional');
  assert.equal(evaluate({ ...offers[1]!, priceBasis: 'per_person', priceMinor: 15500 }, flaineCriteria).totalMinor, 71000);
  assert.equal(evaluate({ ...offers[1]!, snowboardQuantity: 2 }, flaineCriteria).totalMinor, null);
});

test('ownership, read-only grants, revocation and client binding prevent cross-account access', async () => {
  const { a, t, d } = await decision(); const other = await actor();
  await assert.rejects(core.call('get_trip', { tripId: t.tripId }, other), errorCode('FORBIDDEN_OR_NOT_FOUND'));
  await assert.rejects(core.call('update_decision_criteria', { ...key(), decisionId: d.decisionId, expectedRevision: 1, criteria: flaineCriteria }, other), errorCode('FORBIDDEN_OR_NOT_FOUND'));
  const reader = await actor(['read']);
  await assert.rejects(core.call('create_trip', { ...key(), ...flaineTrip }, reader), errorCode('FORBIDDEN_OR_NOT_FOUND'));
  await assert.rejects(core.call('get_trip', { tripId: t.tripId }, { ...a, clientId: 'unapproved-client' }), errorCode('FORBIDDEN_OR_NOT_FOUND'));
  await db.query('update client_grants set revoked_at=now() where owner_id=$1', [a.userId]);
  await assert.rejects(core.call('get_trip', { tripId: t.tripId }, a), errorCode('FORBIDDEN_OR_NOT_FOUND'));
});

test('concurrent duplicate writes return one result; changed payload cannot reuse a key', async () => {
  const a = await actor(); const input = { ...key(), ...flaineTrip };
  const [first, second] = await Promise.all([core.call('create_trip', input, a), core.call('create_trip', input, a)]);
  assert.deepEqual(first, second);
  assert.equal((await core.call('list_trips', {}, a)).trips.length, 1);
  await assert.rejects(core.call('create_trip', { ...input, name: 'Changed' }, a), errorCode('IDEMPOTENCY_CONFLICT'));
});

test('criteria are immutable and stale revisions cannot overwrite a decision', async () => {
  const { a, d } = await decision(); const first = await run(a, d.decisionId, 1);
  await core.call('update_decision_criteria', { ...key(), decisionId: d.decisionId, expectedRevision: 2, criteria: { ...flaineCriteria, earliestOutboundLocal: '18:00' } }, a);
  await assert.rejects(core.call('update_decision_criteria', { ...key(), decisionId: d.decisionId, expectedRevision: 2, criteria: flaineCriteria }, a), errorCode('REVISION_CONFLICT'));
  const observationIds = first.observations.filter((o: any) => o.payload.outbound[0].operatingFlight === 'TEST101').map((o: any) => o.id);
  const old = await core.call('compare_candidates', { decisionId: d.decisionId, criteriaVersion: 1, observationIds }, a);
  const next = await core.call('compare_candidates', { decisionId: d.decisionId, criteriaVersion: 2, observationIds }, a);
  assert.equal(old.results[0].eligibility, 'conditional'); assert.equal(next.results[0].eligibility, 'ineligible');
});

test('selection requires conditional acknowledgment and cannot turn synthetic data into a booking', async () => {
  const { a, d, t } = await decision(); const r = await run(a, d.decisionId, 1);
  const observationId = r.observations.find((o: any) => o.payload.snowboardAllowed === 'unknown').id;
  const input = { ...key(), decisionId: d.decisionId, expectedRevision: 2, observationId, rationale: 'Resolve equipment first' };
  await assert.rejects(core.call('select_candidate', input, a), errorCode('VALIDATION_ERROR'));
  const selected = await core.call('select_candidate', { ...input, acknowledgeConditional: true }, a);
  assert.equal(selected.booked, false);
  await assert.rejects(core.call('record_booking', { ...key(), decisionId: d.decisionId, expectedRevision: 3, selectionId: selected.selectionId, bookedAt: new Date().toISOString(), note: 'Test' }, a), errorCode('VALIDATION_ERROR'));
  assert.equal((await core.call('get_trip', { tripId: t.tripId }, a)).decisions[0].bookings.length, 0);
});

test('manual evidence and booking reports remain explicitly user-reported', async () => {
  const { a, d } = await decision(); const offer = (await provider.search(flaineCriteria)).offers[1]!;
  const saved = await core.call('save_candidate', { ...key(), decisionId: d.decisionId, expectedRevision: 1, offer }, a);
  assert.equal(saved.provenance, 'user_reported');
  const evidence = await core.call('get_decision', { decisionId: d.decisionId }, a);
  assert.equal(evidence.observations[0].id, saved.observationId);
  const selected = await core.call('select_candidate', { ...key(), decisionId: d.decisionId, expectedRevision: 2, observationId: saved.observationId, rationale: 'User supplied offer' }, a);
  const booked = await core.call('record_booking', { ...key(), decisionId: d.decisionId, expectedRevision: 3, selectionId: selected.selectionId, bookedAt: new Date().toISOString(), note: 'User reports external booking; no payment details stored' }, a);
  assert.equal(booked.status, 'user_reported_booked'); assert.equal(booked.supplierTransactionMade, false);
});

test('repeat searches retain evidence and match candidates without claiming disappearance is sold out', async () => {
  const { a, d } = await decision(); const first = await run(a, d.decisionId, 1);
  const queued = await core.call('start_search', { ...key(), decisionId: d.decisionId, expectedRevision: 2, criteriaVersion: 1, provider: 'fixture' }, a);
  await runOneJob(db, { id: 'fixture', search: async c => {
    const result = await provider.search(c);
    return { ...result, offers: result.offers.filter(o => o.snowboardAllowed === 'yes').map(o => ({ ...o, priceMinor: o.priceMinor! + 1000 })) };
  } });
  const diff = await core.call('compare_search_runs', { previousRunId: first.id, currentRunId: queued.runId }, a);
  assert.equal(diff.notSeen.length, 2); assert.equal(diff.changes[0].priceDeltaMinor, 1000);
  assert.match(diff.warning, /not sold out/);
  assert.equal((await core.call('get_search_run', { runId: first.id }, a)).observations.length, 3);
});

test('expired fixture lease is recovered and provider failure leaves no partial observations', async () => {
  const { a, d } = await decision();
  const q = await core.call('start_search', { ...key(), decisionId: d.decisionId, expectedRevision: 1, criteriaVersion: 1, provider: 'fixture' }, a);
  await db.query("update search_runs set status='running',lease_until=now()-interval '1 second',generation=1 where id=$1", [q.runId]);
  await runOneJob(db, { id: 'fixture', search: async c => {
    const result = await provider.search(c); return { ...result, offers: [result.offers[0]!, {} as Offer] };
  } });
  const failed = await core.call('get_search_run', { runId: q.runId }, a);
  assert.equal(failed.status, 'failed'); assert.equal(failed.generation, 2); assert.equal(failed.observations.length, 0);
});

test('live search is unavailable and rolls back rather than producing a fake run', async () => {
  const { a, d } = await decision();
  await assert.rejects(core.call('start_search', { ...key(), decisionId: d.decisionId, expectedRevision: 1, criteriaVersion: 1, provider: 'live' }, a), errorCode('PROVIDER_ACCESS_REQUIRED'));
  assert.equal((await db.query('select id from search_runs where decision_id=$1', [d.decisionId])).rows.length, 0);
});

test('embedded PostgreSQL persists trips across close/reopen and migration is repeatable', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'travel-engine-test-')), 'db');
  const first = await embedded(path); let second: Database | undefined;
  const a = { userId: randomUUID(), clientId: 'restart-test' };
  try {
    await migrate(first);
    await first.query('insert into client_grants values($1,$2,$3,null)', [a.userId, a.clientId, ['read', 'write']]);
    await new Core(first, true).call('create_trip', { ...key(), ...flaineTrip }, a);
  } finally { await first.close(); }
  try {
    second = await embedded(path); await migrate(second);
    assert.equal((await new Core(second, true).call('list_trips', {}, a)).trips[0].payload.name, flaineTrip.name);
  } finally { await second?.close(); }
});
