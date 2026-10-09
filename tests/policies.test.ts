import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Core } from '../src/core.js';
import { embedded, migrate, type Database } from '../src/database.js';
import { DomainError, type Actor } from '../src/domain.js';
import { policyNoteSchema, policyView, type PolicyNote } from '../src/policies.js';
import { flaineCriteria, flaineTrip } from '../src/acceptance.js';
import { FixtureProvider } from '../src/providers.js';

let db: Database, core: Core;
const key = () => ({idempotencyKey:randomUUID()});
const errorCode = (code:string) => (e:unknown) => e instanceof DomainError && e.code===code;
const note: PolicyNote = {
  airline:'Example Air',topic:'sports_equipment',summary:'TEST policy: snowboards under 20 kg; advertised fee 42 GBP per item per flight.',
  applicability:'Synthetic policy example only. Online direct bookings, one snowboard. No availability or price has been verified.',
  sourceUrl:'https://example.com/test-policy',verifiedAt:'2020-01-01T00:00:00Z',reviewAfter:'2020-02-01T00:00:00Z',
  effectiveFrom:null,effectiveTo:null,effectiveDateBasis:'unspecified',status:'active',
};
async function actor(): Promise<Actor> {
  const a={userId:randomUUID(),clientId:'policy-test'};
  await db.query('insert into client_grants values($1,$2,$3,null)',[a.userId,a.clientId,['read','write']]);
  return a;
}
before(async()=>{db=await embedded();await migrate(db);core=new Core(db,false);});
after(async()=>{await db?.close();});

test('policy notes are private, grant-checked, idempotent and append immutable versions',async()=>{
  const owner=await actor(),other=await actor(),input={...key(),note};
  const [first,retry]=await Promise.all([core.call('create_policy_note',input,owner),core.call('create_policy_note',input,owner)]);
  assert.deepEqual(first,retry);
  assert.equal((await core.call('list_policy_notes',{airline:'example air'},owner)).notes.length,1);
  assert.equal((await core.call('list_policy_notes',{},other)).notes.length,0);
  await assert.rejects(core.call('get_policy_note',{noteId:first.noteId},other),errorCode('FORBIDDEN_OR_NOT_FOUND'));
  await assert.rejects(core.call('update_policy_note',{...key(),noteId:first.noteId,expectedVersion:1,note},other),errorCode('FORBIDDEN_OR_NOT_FOUND'));
  await assert.rejects(core.call('create_policy_note',{...input,note:{...note,summary:'Changed payload'}},owner),errorCode('IDEMPOTENCY_CONFLICT'));
  const readonly={...owner,clientId:'readonly'};
  await db.query('insert into client_grants values($1,$2,$3,null)',[owner.userId,readonly.clientId,['read']]);
  assert.equal((await core.call('get_policy_note',{noteId:first.noteId},readonly)).version,1);
  await assert.rejects(core.call('create_policy_note',{...key(),note},readonly),errorCode('FORBIDDEN_OR_NOT_FOUND'));
  const updates=await Promise.allSettled([
    core.call('update_policy_note',{...key(),noteId:first.noteId,expectedVersion:1,note:{...note,summary:'Review A'}},owner),
    core.call('update_policy_note',{...key(),noteId:first.noteId,expectedVersion:1,note:{...note,summary:'Review B'}},owner),
  ]);
  assert.equal(updates.filter(r=>r.status==='fulfilled').length,1);
  const rejected=updates.find(r=>r.status==='rejected');assert.ok(rejected?.status==='rejected');assert.ok(errorCode('REVISION_CONFLICT')(rejected.reason));
  const old=await core.call('get_policy_note',{noteId:first.noteId,version:1},owner);
  assert.equal(old.note.summary,note.summary);assert.equal(old.isLatest,false);assert.equal(old.latestVersion,2);assert.equal(old.reviewStatus,'review_due');
  await db.query('update client_grants set revoked_at=now() where owner_id=$1',[owner.userId]);
  await assert.rejects(core.call('list_policy_notes',{},owner),errorCode('FORBIDDEN_OR_NOT_FOUND'));
});

test('policy dates and sources are validated; review due is a reminder rather than quote freshness',async()=>{
  for(const invalid of [
    {...note,reviewAfter:note.verifiedAt},
    {...note,effectiveFrom:'2026-12-20',effectiveTo:'2026-12-18'},
    {...note,sourceUrl:'http://example.com'},
    {...note,sourceUrl:'https://user:password@example.com'},
    {...note,sourceUrl:'javascript:alert(1)'},
  ])assert.equal(policyNoteSchema.safeParse(invalid).success,false);
  const owner=await actor();
  const future=new Date(Date.now()+86400000).toISOString(),later=new Date(Date.now()+172800000).toISOString();
  await assert.rejects(core.call('create_policy_note',{...key(),note:{...note,verifiedAt:future,reviewAfter:later}},owner),errorCode('VALIDATION_ERROR'));
  const row={id:randomUUID(),version:1,current_version:1,current_status:'active',payload:note};
  assert.equal(policyView(row,new Date('2020-01-31T23:59:59Z')).reviewStatus,'not_due');
  assert.equal(policyView(row,new Date(note.reviewAfter)).reviewStatus,'review_due');
  assert.match(policyView(row).warning,/not freshness guarantees/);
});

test('policy context cannot fill missing quote costs; selections keep pinned versions after updates',async()=>{
  const owner=await actor(),other=await actor();
  const saved=await core.call('create_policy_note',{...key(),note},owner);
  const foreign=await core.call('create_policy_note',{...key(),note},other);
  const trip=await core.call('create_trip',{...key(),...flaineTrip},owner);
  const decision=await core.call('create_decision',{...key(),tripId:trip.tripId,title:'Flights',criteria:flaineCriteria},owner);
  const offer=(await new FixtureProvider().search(flaineCriteria)).offers[0]!;
  const observation=await core.call('save_candidate',{...key(),decisionId:decision.decisionId,expectedRevision:1,offer},owner);
  const comparison={decisionId:decision.decisionId,criteriaVersion:1,observationIds:[observation.observationId]};
  const bare=await core.call('compare_candidates',comparison,owner);
  const refs=[{noteId:saved.noteId,version:1}];
  const contextual=await core.call('compare_candidates',{...comparison,policyReferences:refs},owner);
  assert.deepEqual(contextual.results,bare.results);
  assert.equal(contextual.results[0].totalMinor,null);assert.equal(contextual.results[0].eligibility,'conditional');
  assert.equal(contextual.policyNotes[0].reviewStatus,'review_due');
  await assert.rejects(core.call('compare_candidates',{...comparison,policyReferences:[{noteId:foreign.noteId,version:1}]},owner),errorCode('FORBIDDEN_OR_NOT_FOUND'));
  await assert.rejects(core.call('compare_candidates',{...comparison,policyReferences:[{noteId:saved.noteId,version:99}]},owner),errorCode('FORBIDDEN_OR_NOT_FOUND'));
  const select={...key(),decisionId:decision.decisionId,expectedRevision:2,observationId:observation.observationId,rationale:'Still needs a real equipment quote',policyReferences:refs};
  await assert.rejects(core.call('select_candidate',select,owner),errorCode('VALIDATION_ERROR'));
  const chosen=await core.call('select_candidate',{...select,acknowledgeConditional:true},owner);
  assert.equal(chosen.assessment.totalMinor,null);
  await core.call('update_policy_note',{...key(),noteId:saved.noteId,expectedVersion:1,note:{...note,summary:'Withdrawn after review',status:'withdrawn'}},owner);
  const persisted=await core.call('get_trip',{tripId:trip.tripId},owner);
  const pinned=persisted.decisions[0].selections[0].policyNotes[0];
  assert.equal(pinned.note.summary,note.summary);assert.equal(pinned.version,1);assert.equal(pinned.latestVersion,2);assert.equal(pinned.currentStatus,'withdrawn');
  const secondTrip=await core.call('create_trip',{...key(),...flaineTrip,name:'Another trip'},owner);
  assert.notEqual(secondTrip.tripId,trip.tripId);
  assert.equal((await core.call('list_policy_notes',{},owner)).notes.length,1,'notes belong to the account and can be reused across trips');
});

test('policy migration upgrades an existing version-2 database without changing trip records',async()=>{
  const previous=await embedded();
  try{
    await previous.execute(await readFile(new URL('../migrations/001_initial.sql',import.meta.url),'utf8'));
    await previous.execute(await readFile(new URL('../migrations/002_account_linking.sql',import.meta.url),'utf8'));
    await previous.execute('create table app_schema_migrations(version integer primary key); insert into app_schema_migrations values(1),(2)');
    const owner=randomUUID(),trip=randomUUID();
    await previous.query('insert into trips(id,owner_id,payload) values($1,$2,$3)',[trip,owner,JSON.stringify(flaineTrip)]);
    await migrate(previous);await migrate(previous);
    assert.deepEqual((await previous.query('select payload from trips where id=$1',[trip])).rows[0]!.payload,flaineTrip);
    assert.equal((await previous.query('select max(version) as version from app_schema_migrations')).rows[0]!.version,3);
  }finally{await previous.close();}
});
