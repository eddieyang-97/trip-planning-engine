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
    const tools = await client.listTools();
    for(const name of ['create_stay_decision','list_stay_decisions','get_stay_decision','get_stay_observation','save_stay_candidate','set_stay_disposition','compare_stays','select_stay_candidate','commit_stay_selection'])assert.ok(tools.tools.some(t=>t.name===name),name+' must be discoverable');
    for(const name of ['create_itinerary_invite','update_shared_itinerary_item'])assert.ok(!tools.tools.some(t=>t.name===name),name+' must stay web-only');
    assert.equal(tools.tools.find(t=>t.name==='delete_trip')!.annotations!.destructiveHint,true);
    assert.equal(tools.tools.find(t=>t.name==='leave_trip')!.annotations!.destructiveHint,true);
    assert.ok(tools.tools.find(t=>t.name==='prepare_trip_action'));
    assert.ok(tools.tools.every(t => t.inputSchema.type === 'object'));
    for(const name of ['add_itinerary_item','update_itinerary_item']){
      const itemSchema=tools.tools.find(t=>t.name===name)!.inputSchema.properties!.item as {properties:Record<string,unknown>};
      assert.ok(itemSchema.properties.mapLocations,'MCP discovery must expose saved map coordinates');
    }
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      assert.ok(!result.isError, JSON.stringify(result)); return result.structuredContent as Record<string, any>;
    };
    const t = await call('create_trip', { ...flaineTrip, idempotencyKey: randomUUID() });
    const plan=await call('get_itinerary',{tripId:t.tripId});assert.equal(plan.revision,1);assert.deepEqual(plan.items,[]);
    await call('add_itinerary_item',{tripId:t.tripId,expectedRevision:1,idempotencyKey:randomUUID(),item:{
      type:'note',title:'MCP itinerary note',startDate:null,startTime:null,endDate:null,endTime:null,timeZone:null,endTimeZone:null,
      location:'',url:null,notes:'Manual note',openQuestion:'',status:'tentative',bookingNote:'',
    }});
    assert.equal((await call('get_itinerary',{tripId:t.tripId})).items[0].payload.title,'MCP itinerary note');
    const manualPlan=await call('get_itinerary',{tripId:t.tripId}),savedItem=manualPlan.items[0];
    const pinned=await call('update_itinerary_item',{tripId:t.tripId,itemId:savedItem.id,expectedRevision:manualPlan.revision,idempotencyKey:randomUUID(),item:{...savedItem.payload,mapLocations:[{label:'Flaine — fictional pin',latitude:46.005,longitude:6.687}]}});
    assert.equal(pinned.mapLocationCount,1);
    const pinnedPlan=await call('get_itinerary',{tripId:t.tripId});assert.equal(pinnedPlan.items[0].payload.mapLocations[0].latitude,46.005);
    const {mapLocations,...legacyItem}=pinnedPlan.items[0].payload;
    const preserved=await call('update_itinerary_item',{tripId:t.tripId,itemId:savedItem.id,expectedRevision:pinnedPlan.revision,idempotencyKey:randomUUID(),item:{...legacyItem,notes:'Older client update'}});
    assert.equal(preserved.mapLocationCount,1,'cached clients cannot erase pins by omitting the new field');
    const cleared=await call('update_itinerary_item',{tripId:t.tripId,itemId:savedItem.id,expectedRevision:preserved.revision,idempotencyKey:randomUUID(),item:{...legacyItem,mapLocations:[]}});
    assert.equal(cleared.mapLocationCount,0);
    const comment=await call('add_itinerary_comment',{tripId:t.tripId,body:'Discuss through MCP',idempotencyKey:randomUUID()});
    assert.equal((await call('list_itinerary_comments',{tripId:t.tripId})).comments[0].body,'Discuss through MCP');
    await call('remove_itinerary_comment',{tripId:t.tripId,commentId:comment.commentId,idempotencyKey:randomUUID()});
    assert.equal((await call('list_itinerary_comments',{tripId:t.tripId})).comments[0].body,null);
    const policy = await call('create_policy_note', { idempotencyKey:randomUUID(),note:{
      airline:'Test Air',topic:'sports_equipment',summary:'TEST: check equipment with airline',
      applicability:'Synthetic test only',sourceUrl:'https://example.com/policy',
      verifiedAt:'2020-01-01T00:00:00Z',reviewAfter:'2020-02-01T00:00:00Z',
      effectiveFrom:null,effectiveTo:null,effectiveDateBasis:'unspecified',
    } });
    const savedPolicy = await call('get_policy_note',{noteId:policy.noteId,version:1});
    assert.equal(savedPolicy.reviewStatus,'review_due');
    const d = await call('create_decision', { tripId: t.tripId, title: 'Flaine flights', criteria: flaineCriteria, idempotencyKey: randomUUID() });
    const r = await call('start_search', { decisionId: d.decisionId, expectedRevision: 1, criteriaVersion: 1, provider: 'fixture', idempotencyKey: randomUUID() });
    assert.equal(r.status, 'queued');
    await runOneJob(db, new FixtureProvider());
    const ready = await call('get_search_run', { runId: r.runId });
    assert.equal(ready.status, 'complete'); assert.equal(ready.observations.length, 3);
    const compared = await call('compare_candidates', { decisionId: d.decisionId, criteriaVersion: 1, observationIds: ready.observations.map((o: any) => o.id),policyReferences:[{noteId:policy.noteId,version:1}] });
    assert.equal(compared.policyNotes[0].noteId,policy.noteId);
    assert.equal(compared.results.filter((o: any) => o.eligibility === 'eligible').length, 1);
    const denied = await client.callTool({ name: 'get_trip', arguments: { tripId: randomUUID() } });
    assert.equal(denied.isError, true); assert.equal((denied.structuredContent as any).code, 'FORBIDDEN_OR_NOT_FOUND');
    const invalid = await client.callTool({ name: 'create_trip', arguments: { ...flaineTrip, idempotencyKey: randomUUID(), owner_id: randomUUID() } });
    assert.equal(invalid.isError, true);
    const currentTrip=await call('get_trip',{tripId:t.tripId});
    await call('archive_trip',{tripId:t.tripId,expectedRevision:currentTrip.trip.lifecycle_revision,idempotencyKey:randomUUID()});
    assert.equal((await call('list_trips',{status:'archived'})).trips[0].id,t.tripId);
    const archivedTrip=await call('get_itinerary',{tripId:t.tripId});
    await call('restore_trip',{tripId:t.tripId,expectedRevision:archivedTrip.trip.lifecycle_revision,idempotencyKey:randomUUID()});
    const review=await call('prepare_trip_action',{tripId:t.tripId,action:'delete',idempotencyKey:randomUUID()});
    const deletion={tripId:t.tripId,expectedRevision:review.expectedRevision,confirmationToken:review.confirmationToken,confirmationName:review.trip.name,confirmed:true,idempotencyKey:randomUUID()};
    assert.equal((await call('delete_trip',deletion)).deleted,true);assert.equal((await call('delete_trip',deletion)).deleted,true);
    const gone=await client.callTool({name:'get_trip',arguments:{tripId:t.tripId}});assert.equal(gone.isError,true);
    assert.equal((await call('get_policy_note',{noteId:policy.noteId})).noteId,policy.noteId,'trip deletion retains reusable account policy notes');
    // Authorization is rechecked on every call even on an already connected MCP client.
    await db.query('update client_grants set revoked_at=now() where owner_id=$1', [localActor.userId]);
    const revoked = await client.callTool({ name: 'list_trips', arguments: {} }); assert.equal(revoked.isError, true);
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) => http.close(e => e ? reject(e) : resolve()));
    await db.close();
  }
});
