import { randomUUID } from 'node:crypto';
import { flaineCriteria, flaineTrip } from '../src/acceptance.js';
import { localActor } from '../src/auth.js';
import { Core, runOneJob } from '../src/core.js';
import { embedded, migrate } from '../src/database.js';
import { FixtureProvider } from '../src/providers.js';

const db = await embedded();
try {
  await migrate(db);
  await db.query('insert into client_grants values($1,$2,$3,null)', [localActor.userId, localActor.clientId, ['read', 'write', 'search']]);
  const core = new Core(db, true);
  const trip = await core.call('create_trip', { ...flaineTrip, idempotencyKey: randomUUID() }, localActor);
  const decision = await core.call('create_decision', { tripId: trip.tripId, title: 'Flights to Flaine', criteria: flaineCriteria, idempotencyKey: randomUUID() }, localActor);
  const run = await core.call('start_search', { decisionId: decision.decisionId, expectedRevision: 1, criteriaVersion: 1, provider: 'fixture', idempotencyKey: randomUUID() }, localActor);
  await runOneJob(db, new FixtureProvider());
  const evidence = await core.call('get_search_run', { runId: run.runId }, localActor);
  const comparison = await core.call('compare_candidates', { decisionId: decision.decisionId, criteriaVersion: 1, observationIds: evidence.observations.map((o: any) => o.id) }, localActor);
  console.log(JSON.stringify({ notice: 'SYNTHETIC ACCEPTANCE DEMO — no live search or booking', trip: flaineTrip,
    assumptions: flaineCriteria.assumptions, coverage: evidence.coverage, comparison }, null, 2));
} finally { await db.close(); }
