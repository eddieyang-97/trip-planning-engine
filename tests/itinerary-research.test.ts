import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {embedded,migrate} from '../src/database.js';
import {Core} from '../src/core.js';
import {flaineCriteria,flaineTrip} from '../src/acceptance.js';
import {FixtureProvider} from '../src/providers.js';
import {DomainError} from '../src/domain.js';
import {itineraryItemSchema} from '../src/itinerary.js';
import type {ItineraryObservation,ItineraryResearch} from '../src/itinerary-research.js';
import {draftResearchFlight,researchQuestions,safeResearchUrl} from '../web/itinerary-research.js';

test('itinerary research is owner-scoped, bounded, read-only and keeps an older selected/booked observation',async()=>{
  const db=await embedded();
  try{
    await migrate(db);const owner=randomUUID(),actor={userId:owner,clientId:'research-test'},core=new Core(db,false);
    await db.query('insert into client_grants values($1,$2,$3,null)',[owner,actor.clientId,['read','write']]);
    const trip=await core.call('create_trip',{...flaineTrip,idempotencyKey:randomUUID()},actor);
    const decision=await core.call('create_decision',{tripId:trip.tripId,title:'Flights',criteria:flaineCriteria,idempotencyKey:randomUUID()},actor);
    const base={...(await new FixtureProvider().search(flaineCriteria)).offers[2]!,seller:'Pinned seller',expiresAt:null};
    let revision=1;
    const save=async(offer:typeof base)=>{
      const result=await core.call('save_candidate',{decisionId:decision.decisionId,expectedRevision:revision,offer,idempotencyKey:randomUUID()},actor);revision=result.revision;return result;
    };
    const old=await save(base);
    const selection=await core.call('select_candidate',{decisionId:decision.decisionId,expectedRevision:revision,
      observationId:old.observationId,rationale:'Test selection with unresolved costs',acknowledgeConditional:true,idempotencyKey:randomUUID()},actor);revision=selection.revision;
    const booking=await core.call('record_booking',{decisionId:decision.decisionId,expectedRevision:revision,selectionId:selection.selectionId,
      bookedAt:'2026-01-01T00:00:00Z',note:'Test user report',idempotencyKey:randomUUID()},actor);revision=booking.revision;
    const current=await save({...base,priceMinor:42100});
    // Deterministic timestamps: do not rely on rapid writes having distinct milliseconds.
    await db.query("update observations set created_at='2026-01-01' where id=$1",[old.observationId]);
    await db.query("update observations set created_at='2026-01-02' where id=$1",[current.observationId]);
    for(let n=0;n<21;n++)await save({...base,seller:`Recent seller ${n}`,priceMinor:50000+n});
    const mutations=(await db.query('select count(*)::int as n from mutation_requests')).rows[0]!.n;
    const plan=await core.callFromWeb('get_itinerary',{tripId:trip.tripId},owner);
    const research=plan.research as ItineraryResearch,view=research.decisions[0]!;
    assert.equal(view.observationCount,22);assert.equal(view.observations.length,21);
    assert.equal(view.observations.find(o=>o.id===old.observationId)!.selected,true);
    assert.equal(view.observations.find(o=>o.id===old.observationId)!.bookingReported,true);
    assert.equal(view.observations.filter(o=>o.selected).length,1);
    assert.equal(plan.revision,1);assert.deepEqual(plan.items,[]);
    assert.equal((await db.query('select count(*)::int as n from mutation_requests')).rows[0]!.n,mutations);
    assert.equal((await db.query('select count(*)::int as n from search_runs')).rows[0]!.n,0);
    assert.ok(view.observations.every(o=>o.offer.priceBasis==='unknown'&&!o.offer.exactPartyQuoted));
    assert.equal('owner_id' in view,false);assert.equal('grant_version' in view,false);
    await assert.rejects(core.callFromWeb('get_itinerary',{tripId:trip.tripId},randomUUID()),error=>error instanceof DomainError&&error.code==='FORBIDDEN_OR_NOT_FOUND');
  }finally{await db.close();}
});

test('research flight drafts use airport-local dates, preserve uncertainty and never infer a booking',async()=>{
  const offer=(await new FixtureProvider().search(flaineCriteria)).offers[2]!;
  offer.inbound=[{...offer.inbound[0]!,departure:'2026-12-19T23:30:00Z',arrival:'2026-12-20T01:00:00Z'}];
  const observation:ItineraryObservation={id:randomUUID(),candidateId:randomUUID(),disposition:'neutral',
    provenance:'provider_reported',offer,selected:true,bookingReported:true};
  const item=itineraryItemSchema.parse(draftResearchFlight(observation,'inbound'));
  assert.equal(item.startDate,'2026-12-20');assert.equal(item.startTime,'00:30');assert.equal(item.timeZone,'Europe/Zurich');
  assert.equal(item.endTime,'01:00');assert.equal(item.endTimeZone,'Europe/London');
  assert.equal(item.status,'tentative');assert.equal(item.bookingNote,'');assert.match(item.openQuestion,/snowboard/);
  assert.match(item.notes,/not a booking/);assert.equal('priceMinor' in item,false);
  assert.equal(safeResearchUrl('https://user:secret@example.com'),null);assert.equal(safeResearchUrl('javascript:alert(1)'),null);
  assert.equal(safeResearchUrl('https://example.com/source'),'https://example.com/source');
  const research:ItineraryResearch={truncatedDecisions:false,decisions:[{id:randomUUID(),title:'Flights',criteriaVersion:1,criteria:flaineCriteria,
    latestRun:{id:randomUUID(),status:'complete',criteriaVersion:1,createdAt:offer.observedAt,coverage:{notRequestedAirports:['LHR','LTN']}},observations:[observation],observationCount:1}]};
  assert.ok(researchQuestions(research).some(q=>q.includes('unverified basis')));
  assert.ok(researchQuestions(research).some(q=>q.includes('LHR, LTN')));
});
