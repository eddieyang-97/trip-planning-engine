import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import pg from 'pg';
import {Core} from '../src/core.js';
import {embedded,migrate,pooledDatabase,type Database} from '../src/database.js';
import {DomainError,evaluate} from '../src/domain.js';
import {externalFlightCriteria,externalFlightOffer,externalFlightTrip} from './fixtures/external-flight.js';

const key=()=>({idempotencyKey:randomUUID()});
const hasCode=(code:string)=>(error:unknown)=>error instanceof DomainError&&error.code===code;

test('external flight ingestion keeps immutable evidence, rejects incompatible writes, and shares existing authorization and revisions',async()=>{
  const db=await embedded();
  try{
    await migrate(db);
    const core=new Core(db,false);
    const owner={userId:randomUUID(),clientId:'external-flight-owner'};
    const other={userId:randomUUID(),clientId:'external-flight-other'};
    const reader={userId:owner.userId,clientId:'external-flight-read-only'};
    for(const actor of [owner,other,reader])await db.query('insert into client_grants values($1,$2,$3,null)',
      [actor.userId,actor.clientId,actor===reader?['read']:['read','write']]);
    const trip=await core.call('create_trip',{...key(),...externalFlightTrip},owner);
    const {decisionId}=await core.call('create_decision',{...key(),tripId:trip.tripId,title:'Flight options',criteria:externalFlightCriteria},owner);
    const offer=externalFlightOffer();
    const args={...key(),decisionId,expectedRevision:1,offer};
    const save=(input:unknown,actor=owner)=>core.call('save_external_flight_offer',input,actor);
    await assert.rejects(save(args,other),hasCode('FORBIDDEN_OR_NOT_FOUND'));
    await assert.rejects(save(args,reader),hasCode('FORBIDDEN_OR_NOT_FOUND'));
    for(const invalid of [
      {...offer,adults:3},{...offer,inbound:[],external:{...offer.external,priceScope:'unknown'}},
      {...offer,outbound:[{...offer.outbound[0],origin:'MAN'}]},
      {...offer,outbound:[{...offer.outbound[0],departure:'2026-12-17T18:30:00Z'}]},
      {...offer,observedAt:'2099-10-01T09:00:00Z'},
    ])await assert.rejects(save({...args,offer:invalid}),hasCode('VALIDATION_ERROR'));
    for(const query of ['session_id=fictional-private','auth=fictional-private','authorization=Bearer%20fictional',
      '%61uth=fictional-private','route=LGW-GVA']){
      await assert.rejects(save({...args,offer:{...offer,sourceUrl:`https://seller.example/flight?${query}`}}),{name:'ZodError'});
    }
    for(const invalid of [
      {...offer,sourceUrl:'https://seller.example/flight#fictional-private'},
      {...offer,sourceUrl:'https://user:fictional-private@seller.example/flight'},
      {...offer,sourceUrl:'broken URL'},
      {...offer,sourceUrl:null},{...offer,external:{...offer.external,cabin:'invented'}},
      {...offer,inbound:[{...offer.inbound[0],departure:'2026-12-18T17:00:00Z'}]},
      {...offer,outbound:[{...offer.outbound[0],destination:'CDG'}, {...offer.outbound[0],origin:'AMS'}]},
    ])await assert.rejects(save({...args,offer:invalid}),{name:'ZodError'});
    assert.equal((await db.query('select count(*)::int as n from observations')).rows[0]!.n,0);

    const saved=await save(args);
    assert.equal(saved.provenance,'assistant_sourced_unverified');
    assert.deepEqual(await save(args),saved);
    await assert.rejects(save({...args,offer:{...offer,seller:'Different seller'}}),hasCode('IDEMPOTENCY_CONFLICT'));
    const replay=await save({...args,...key(),expectedRevision:saved.revision,offer:{...offer,observedAt:'2026-10-01T10:00:00+01:00',
      outbound:[{...offer.outbound[0],arrival:'2026-12-18T20:10:00Z'}]}});
    assert.equal(replay.observationId,saved.observationId);
    assert.equal(replay.reusedObservation,true);
    assert.equal(replay.revision,saved.revision);
    assert.equal((await db.query('select lifecycle_revision from trips where id=$1',[trip.tripId])).rows[0]!.lifecycle_revision,saved.lifecycleRevision);

    const changedAt={...offer,observedAt:'2026-10-02T09:00:00Z'};
    const changedFare={...offer,currency:'GBP',expiresAt:'2099-01-01T00:00:00Z',
      snowboardAllowed:'yes' as const,snowboardQuantity:1,snowboardTotalMinor:0,
      external:{...offer.external,restrictions:['Refund conditional']}};
    const race=await Promise.allSettled([changedAt,changedFare].map(changed=>save({...args,...key(),offer:changed,expectedRevision:saved.revision})));
    const winner=race.find(result=>result.status==='fulfilled');assert.ok(winner);
    const loser=race.find(result=>result.status==='rejected');assert.ok(loser);
    assert.ok(hasCode('REVISION_CONFLICT')(loser.reason));
    const later=await save({...args,...key(),offer:[changedAt,changedFare][race.indexOf(loser)],expectedRevision:winner.value.revision});
    const otherSeller=await save({...args,...key(),offer:{...offer,seller:'Fictional Second Seller',sourceUrl:null,
      external:{...offer.external,linkType:null}},expectedRevision:later.revision});
    const read=await core.call('get_decision',{decisionId},owner);
    assert.equal(read.observations.length,4);
    for(const row of read.observations){
      assert.equal(row.candidate_id,saved.candidateId);assert.equal(row.created_by,owner.userId);assert.equal(row.run_id,null);
    }
    assert.equal(read.observations.find((row:any)=>row.id===saved.observationId).payload.observedAt,offer.observedAt);
    const legacyCase=read.observations.find((row:any)=>row.payload.currency==='GBP');
    const {external,...legacyPayload}=legacyCase.payload;
    assert.deepEqual(external.reportedPrice,{amountMinor:42000,currency:'GBP',basis:'party',exactPartyQuoted:true});
    // Pre-017 readers ignore the external object and still evaluate the outer fields.
    // Prove this fixture would pass those checks if the reported price leaked into them.
    const legacyCriteria={...externalFlightCriteria,groupBudgetMinor:50000};
    const unsafePayload={...legacyPayload,priceMinor:42000,priceBasis:'party' as const,exactPartyQuoted:true};
    const unsafe=evaluate(unsafePayload,legacyCriteria);
    assert.equal(unsafe.totalMinor,42000);assert.equal(unsafe.eligibility,'eligible');
    const safe=evaluate(legacyPayload,legacyCriteria);
    assert.equal(safe.totalMinor,null);assert.equal(safe.knownSubtotalMinor,null);assert.equal(safe.eligibility,'conditional');
    assert.equal(safe.checks.find(check=>check.constraint==='budget')?.verdict,'unknown');
    await assert.rejects(db.query('update observations set payload=$2 where id=$1',
      [legacyCase.id,JSON.stringify({...unsafePayload,external})]),{code:'23514'});
    const comparison=await core.call('compare_candidates',{decisionId,criteriaVersion:1,observationIds:read.observations.map((row:any)=>row.id)},owner);
    for(const result of comparison.results){
      assert.equal(result.totalMinor,null);assert.equal(result.knownSubtotalMinor,null);assert.equal(result.eligibility,'conditional');
      assert.equal(result.checks.find((check:any)=>check.constraint==='snowboard').verdict,'unknown');
    }
    const invite=await core.callFromWeb('create_itinerary_invite',{...key(),tripId:trip.tripId,label:'Fixture viewer'},owner.userId);
    await core.callFromWeb('accept_itinerary_invite',{...key(),token:invite.token,displayName:'Fixture viewer'},other.userId);
    const web=await core.callFromWeb('get_itinerary',{tripId:trip.tripId,flightDecisionId:decisionId},other.userId);
    assert.deepEqual(web.research.decisions,[]);
    await assert.rejects(save({...args,...key(),expectedRevision:otherSeller.revision},other),hasCode('FORBIDDEN_OR_NOT_FOUND'));
    const archived=await core.call('archive_decision',{...key(),decisionId,expectedRevision:otherSeller.revision},owner);
    await assert.rejects(save({...args,...key(),expectedRevision:archived.revision}),hasCode('DECISION_ARCHIVED'));
    await db.query('update client_grants set revoked_at=now() where owner_id=$1 and client_id=$2',[owner.userId,owner.clientId]);
    await assert.rejects(save(args),hasCode('FORBIDDEN_OR_NOT_FOUND'));
    assert.equal((await db.query('select count(*)::int as n from observations')).rows[0]!.n,4);
  }finally{await db.close();}
});

test('PostgreSQL upgrades existing flight history and serializes competing external imports',{skip:!process.env.TEST_POSTGRES_URL,timeout:30000},async()=>{
  const url=new URL(process.env.TEST_POSTGRES_URL!);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
  assert.equal(url.search,'');
  const schema='external_flights_'+randomUUID().replaceAll('-','');
  const admin=new pg.Pool({connectionString:url.href,max:1});
  let db:Database|undefined;
  try{
    await admin.query(`create schema ${schema}`);
    db=pooledDatabase(new pg.Pool({connectionString:url.href,max:5,options:`-c search_path=${schema}`,statement_timeout:10000}));
    const migrations=new URL('../migrations/',import.meta.url);
    const files=(await readdir(migrations)).filter(file=>/^\d{3}_.*\.sql$/.test(file)).sort();
    // The OAuth hook lives in public and is outside this isolated schema.
    for(const file of files.filter(file=>file.slice(0,3)<'017'&&!file.startsWith('002')))
      await db.execute(await readFile(new URL(file,migrations),'utf8'));
    const core=new Core(db,false);
    const owner={userId:randomUUID(),clientId:'postgres-external-flight'};
    await db.query('insert into client_grants values($1,$2,$3,null)',[owner.userId,owner.clientId,['read','write']]);
    const {tripId}=await core.call('create_trip',{...key(),...externalFlightTrip},owner);
    const {decisionId}=await core.call('create_decision',{...key(),tripId,title:'Upgrade fixture',criteria:externalFlightCriteria},owner);
    const offer=externalFlightOffer(),{external,...manualOffer}=offer;
    const saved=await core.call('save_candidate',{...key(),decisionId,expectedRevision:1,offer:manualOffer},owner);
    const before=(await db.query('select * from observations where id=$1',[saved.observationId])).rows;
    await db.execute(await readFile(new URL('017_external_flight_evidence.sql',migrations),'utf8'));
    assert.deepEqual((await db.query('select * from observations where id=$1',[saved.observationId])).rows,before);

    const args={...key(),decisionId,expectedRevision:saved.revision,offer:{...offer,external}};
    const importOffer=(input:typeof args)=>core.call('save_external_flight_offer',input,owner);
    const results=await Promise.allSettled([importOffer(args),importOffer(args),importOffer({...args,...key(),offer:{...offer,seller:'Competing seller'}})]);
    const winners=results.filter(result=>result.status==='fulfilled');
    const losers=results.filter(result=>result.status==='rejected');
    // Either the idempotent pair wins together, or both stale retries lose to the other seller.
    assert.ok(winners.length===1||winners.length===2);
    for(const loss of losers)assert.ok(hasCode('REVISION_CONFLICT')(loss.reason));
    if(winners.length===2)assert.deepEqual(winners[0]!.value,winners[1]!.value);
    assert.deepEqual((await db.query('select id,candidate_id,created_by,run_id from observations where provenance=$1',['assistant_sourced_unverified'])).rows,
      [{id:winners[0]!.value.observationId,candidate_id:saved.candidateId,created_by:owner.userId,run_id:null}]);
    assert.equal((await db.query('select revision from decisions where id=$1',[decisionId])).rows[0]!.revision,3);
  }finally{
    await db?.close();
    await admin.query(`drop schema if exists ${schema} cascade`);
    await admin.end();
  }
});
