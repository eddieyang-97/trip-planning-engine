import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { airportLocal } from '../src/airport-time.js';
import { criteriaSchema, evaluate, identity, offerSchema, type Offer, DomainError } from '../src/domain.js';
import { flaineCriteria, flaineTrip } from '../src/acceptance.js';
import { FixtureProvider } from '../src/providers.js';
import { Core } from '../src/core.js';
import { embedded, migrate } from '../src/database.js';

const sample=async()=>(await new FixtureProvider().search(flaineCriteria)).offers[1]!;
const verdict=(result:ReturnType<typeof evaluate>,name:string)=>result.checks.find(c=>c.constraint===name)!.verdict;
const key=()=>({idempotencyKey:randomUUID()});
test('known costs above budget fail even when other mandatory costs are unknown',async()=>{
  const offer=await sample(),criteria={...flaineCriteria,groupBudgetMinor:60000};
  const over=evaluate({...offer,snowboardTotalMinor:null},criteria);
  assert.equal(over.knownSubtotalMinor,62000);assert.equal(over.totalMinor,null);assert.equal(verdict(over,'budget'),'fail');assert.equal(over.eligibility,'ineligible');
  assert.equal(verdict(evaluate({...offer,priceMinor:60000,snowboardTotalMinor:null},criteria),'budget'),'unknown');
  assert.equal(verdict(evaluate({...offer,priceMinor:null,snowboardTotalMinor:61000},criteria),'budget'),'fail');
  const free=evaluate({...offer,priceMinor:0,snowboardTotalMinor:0},criteria);assert.equal(free.totalMinor,0);assert.equal(verdict(free,'budget'),'pass');
  const perPerson=evaluate({...offer,priceBasis:'per_person',priceMinor:15500,snowboardTotalMinor:null},criteria);assert.equal(perPerson.knownSubtotalMinor,62000);assert.equal(verdict(perPerson,'budget'),'fail');
});
test('budget lower bounds exclude wrong party/currency and retain exact integer overflow checks',async()=>{
  const offer={...await sample(),snowboardTotalMinor:null},criteria={...flaineCriteria,groupBudgetMinor:60000};
  for(const change of [{currency:'EUR'},{adults:1},{exactPartyQuoted:false},{priceBasis:'unknown' as const}]) {
    const result=evaluate({...offer,...change},criteria);assert.equal(result.knownSubtotalMinor,null);assert.equal(verdict(result,'budget'),'unknown');
  }
  const overflow=evaluate({...offer,priceBasis:'per_person',priceMinor:Number.MAX_SAFE_INTEGER},{...criteria,groupBudgetMinor:Number.MAX_SAFE_INTEGER});
  assert.equal(overflow.knownSubtotalMinor,null);assert.equal(overflow.knownSubtotalOverflow,true);assert.equal(verdict(overflow,'budget'),'fail');
});
test('cutoffs use airport-local instants instead of trusting the timestamp offset',async()=>{
  const offer=await sample();offer.outbound[0]!.departure='2026-12-18T18:30:00+01:00';
  const result=evaluate(offerSchema.parse(offer),{...flaineCriteria,earliestOutboundLocal:'18:00'});
  assert.equal(airportLocal(offer.outbound[0]!.departure,'LGW')!.time,'17:30');
  assert.equal(verdict(result,'departure_cutoff'),'fail');assert.equal(result.eligibility,'ineligible');
  assert.throws(()=>offerSchema.parse({...offer,outbound:[{...offer.outbound[0],departureTimeZone:'Europe/Paris'}]}));
});
test('UTC-normalized overnight flights keep local departure dates and stable identities',async()=>{
  const offer=await sample();
  offer.inbound=[{...offer.inbound[0]!,departure:'2026-12-19T23:30:00Z',arrival:'2026-12-20T01:00:00Z'}];
  const equivalent=structuredClone(offer);equivalent.inbound[0]!.departure='2026-12-20T00:30:00+01:00';
  assert.equal(verdict(evaluate(offer,flaineCriteria),'dates'),'pass');assert.equal(identity(offer),identity(equivalent));
  const wrongDay=structuredClone(offer);wrongDay.inbound[0]!.departure='2026-12-20T23:30:00Z';wrongDay.inbound[0]!.arrival='2026-12-21T01:00:00Z';
  assert.equal(verdict(evaluate(wrongDay,flaineCriteria),'dates'),'fail');assert.notEqual(identity(offer),identity(wrongDay));
});
test('daylight-saving transitions use IANA rules and unknown airports cannot pass time checks',async()=>{
  assert.equal(airportLocal('2026-03-29T00:30:00Z','LGW')!.time,'00:30');
  assert.equal(airportLocal('2026-03-29T01:30:00Z','LGW')!.time,'02:30');
  assert.equal(airportLocal('2026-10-25T00:30:00Z','LGW')!.time,'01:30');
  assert.equal(airportLocal('2026-10-25T01:30:00Z','LGW')!.time,'01:30');
  const offer=await sample();offer.outbound[0]!.origin='XYZ';offer.inbound.at(-1)!.destination='XYZ';
  const result=evaluate(offer,criteriaSchema.parse({...flaineCriteria,origins:['XYZ'],earliestOutboundLocal:'18:00'}));
  for(const check of ['airport_time_zones','dates','departure_cutoff'])assert.equal(verdict(result,check),'unknown');
  assert.equal(result.eligibility,'conditional');
});
test('conditional acknowledgement cannot select a known over-budget offer',async()=>{
  const db=await embedded(),actor={userId:randomUUID(),clientId:'regression'};
  try{
    await migrate(db);await db.query('insert into client_grants values($1,$2,$3,null)',[actor.userId,actor.clientId,['read','write']]);
    const core=new Core(db,false),trip=await core.call('create_trip',{...flaineTrip,...key()},actor);
    const d=await core.call('create_decision',{...key(),tripId:trip.tripId,title:'Budget regression',criteria:{...flaineCriteria,groupBudgetMinor:60000}},actor);
    const saved=await core.call('save_candidate',{...key(),decisionId:d.decisionId,expectedRevision:1,offer:{...await sample(),snowboardTotalMinor:null}},actor);
    await assert.rejects(core.call('select_candidate',{...key(),decisionId:d.decisionId,expectedRevision:2,observationId:saved.observationId,
      rationale:'Acknowledgment must not bypass budget',acknowledgeConditional:true},actor),e=>e instanceof DomainError&&e.code==='VALIDATION_ERROR');
    assert.equal((await core.call('get_trip',{tripId:trip.tripId},actor)).decisions[0].selections.length,0);
  }finally{await db.close();}
});
test('legacy identity reconciliation preserves IDs, disposition and immutable evidence; ambiguity stops',async()=>{
  const db=await embedded(),actor={userId:randomUUID(),clientId:'regression'};
  try{
    await migrate(db);await db.query('insert into client_grants values($1,$2,$3,null)',[actor.userId,actor.clientId,['read','write']]);
    const core=new Core(db,false),trip=await core.call('create_trip',{...flaineTrip,...key()},actor);
    const d=await core.call('create_decision',{...key(),tripId:trip.tripId,title:'Identity regression',criteria:flaineCriteria},actor);
    const offer=await sample();offer.inbound=[{...offer.inbound[0]!,departure:'2026-12-19T23:30:00Z',arrival:'2026-12-20T01:00:00Z'}];
    const candidateId=randomUUID(),observationId=randomUUID();
    await db.query('insert into candidates(id,decision_id,identity_key,disposition) values($1,$2,$3,$4)',[candidateId,d.decisionId,createHash('sha256').update('legacy').digest('hex'),'saved']);
    await db.query('insert into observations(id,decision_id,candidate_id,provenance,payload) values($1,$2,$3,$4,$5)',[observationId,d.decisionId,candidateId,'user_reported',JSON.stringify(offer)]);
    const equivalent:Offer=structuredClone(offer);equivalent.inbound[0]!.departure='2026-12-20T00:30:00+01:00';
    const result=await core.call('save_candidate',{...key(),decisionId:d.decisionId,expectedRevision:1,offer:equivalent},actor);
    assert.equal(result.candidateId,candidateId);
    assert.equal((await db.query('select disposition from candidates where id=$1',[candidateId])).rows[0]!.disposition,'saved');
    assert.deepEqual((await db.query('select payload from observations where id=$1',[observationId])).rows[0]!.payload,offer);
    assert.equal((await db.query('select payload from observations where id=$1',[result.observationId])).rows[0]!.payload.inbound[0].departureTimeZone,'Europe/Zurich');
    await db.query('update candidates set identity_key=$2 where id=$1',[candidateId,'legacy-a']);
    const duplicate=randomUUID();await db.query('insert into candidates(id,decision_id,identity_key) values($1,$2,$3)',[duplicate,d.decisionId,'legacy-b']);
    await db.query('insert into observations(id,decision_id,candidate_id,provenance,payload) values($1,$2,$3,$4,$5)',[randomUUID(),d.decisionId,duplicate,'user_reported',JSON.stringify(offer)]);
    await assert.rejects(core.call('save_candidate',{...key(),decisionId:d.decisionId,expectedRevision:2,offer:equivalent},actor),e=>e instanceof DomainError&&e.code==='IDENTITY_REVIEW_REQUIRED');
  }finally{await db.close();}
});
