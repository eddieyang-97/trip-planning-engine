import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, request } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/app.js';
import { localActor, localAuthentication } from '../src/auth.js';
import { Core, runOneJob } from '../src/core.js';
import { embedded, migrate } from '../src/database.js';
import { flaineCriteria, flaineTrip } from '../src/acceptance.js';
import { FixtureProvider } from '../src/providers.js';

test('official MCP client: authentication, discovery, persisted Flaine flow and structured errors', async () => {
  const db = await embedded(); const http = createServer(); const client = new Client({ name: 'acceptance-test', version: '1.0' });
  try {
    await migrate(db);
    await db.query('insert into client_grants values($1,$2,$3,null)', [localActor.userId, localActor.clientId, ['read', 'write', 'search']]);
    await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
    const address = http.address(); assert.ok(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`;
    const token = randomBytes(32).toString('base64url');
    let databaseAvailable = true;
    http.on('request', createApp({ core: new Core(db, true), authenticate: localAuthentication(token), publicOrigin: origin,
      ready: async () => { if (!databaseAvailable) throw new Error('Private connection details must not leak'); await db.query('select 1'); } }));
    assert.equal((await fetch(`${origin}/health`)).status, 200);
    databaseAvailable = false;
    const unhealthy = await fetch(`${origin}/health`);
    assert.equal(unhealthy.status, 503);
    assert.deepEqual(await unhealthy.json(), { status: 'unavailable', liveSearch: false });
    databaseAvailable = true;
    assert.equal((await fetch(`${origin}/mcp`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`${origin}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, origin: 'https://untrusted.example' } })).status, 403);
    const reboundStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(`${origin}/health`, { headers: { Host: 'untrusted.example' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(reboundStatus, 403);
    assert.equal((await fetch(`${origin}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{' })).status, 400);
    await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    const tools = await client.listTools(); assert.equal(tools.tools.length, 14);
    assert.ok(tools.tools.every(t => t.inputSchema.type === 'object'));
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      assert.ok(!result.isError, JSON.stringify(result)); return result.structuredContent as Record<string, any>;
    };
    const t = await call('create_trip', { ...flaineTrip, idempotencyKey: randomUUID() });
    const d = await call('create_decision', { tripId: t.tripId, title: 'Flaine flights', criteria: flaineCriteria, idempotencyKey: randomUUID() });
    const r = await call('start_search', { decisionId: d.decisionId, expectedRevision: 1, criteriaVersion: 1, provider: 'fixture', idempotencyKey: randomUUID() });
    assert.equal(r.status, 'queued');
    await runOneJob(db, new FixtureProvider());
    const ready = await call('get_search_run', { runId: r.runId });
    assert.equal(ready.status, 'complete'); assert.equal(ready.observations.length, 3);
    const compared = await call('compare_candidates', { decisionId: d.decisionId, criteriaVersion: 1, observationIds: ready.observations.map((o: any) => o.id) });
    assert.equal(compared.results.filter((o: any) => o.eligibility === 'eligible').length, 1);
    const denied = await client.callTool({ name: 'get_trip', arguments: { tripId: randomUUID() } });
    assert.equal(denied.isError, true); assert.equal((denied.structuredContent as any).code, 'FORBIDDEN_OR_NOT_FOUND');
    const invalid = await client.callTool({ name: 'create_trip', arguments: { ...flaineTrip, idempotencyKey: randomUUID(), owner_id: randomUUID() } });
    assert.equal(invalid.isError, true);
    // Authorization is rechecked on every call even on an already connected MCP client.
    await db.query('update client_grants set revoked_at=now() where owner_id=$1', [localActor.userId]);
    const revoked = await client.callTool({ name: 'list_trips', arguments: {} }); assert.equal(revoked.isError, true);
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) => http.close(e => e ? reject(e) : resolve()));
    await db.close();
  }
});
