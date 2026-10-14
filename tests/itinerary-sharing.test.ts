import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {embedded,migrate} from '../src/database.js';
import {Core} from '../src/core.js';
import {flaineTrip} from '../src/acceptance.js';
import {DomainError} from '../src/domain.js';
import type {ItineraryItem} from '../src/itinerary.js';

const key=()=>({idempotencyKey:randomUUID()});
const denied=(e:unknown)=>e instanceof DomainError&&e.code==='FORBIDDEN_OR_NOT_FOUND';
const item:ItineraryItem={type:'accommodation',title:'Shared stay',startDate:'2026-12-18',endDate:'2026-12-20',startTime:null,endTime:null,
  timeZone:null,endTimeZone:null,location:'Flaine',url:null,notes:'Meet at reception',openQuestion:'Late arrival?',status:'user_reported_booked',bookingNote:'PRIVATE confirmation reference'};

test('one-trip invitations reveal credentials once; viewer sees only manual plan and cannot edit, research or invite',async()=>{
  const db=await embedded(),owner=randomUUID(),viewer=randomUUID(),stranger=randomUUID();
  try{
    await migrate(db);const core=new Core(db,false),trip=(await core.callFromWeb('create_trip',{...flaineTrip,...key()},owner)).tripId;
    const other=(await core.callFromWeb('create_trip',{...flaineTrip,...key()},owner)).tripId;
    const added=await core.callFromWeb('add_itinerary_item',{tripId:trip,expectedRevision:1,item,...key()},owner);
    const args={tripId:trip,label:'Friend',...key()},invite=await core.callFromWeb('create_itinerary_invite',args,owner);
    assert.match(invite.token,/^[A-Za-z0-9_-]{43}$/);
    const stored=JSON.stringify((await db.query('select * from itinerary_invites')).rows)+JSON.stringify((await db.query('select * from mutation_requests')).rows);
    assert.ok(!stored.includes(invite.token),'raw credentials never persist');
    const retry=await core.callFromWeb('create_itinerary_invite',args,owner);assert.equal(retry.linkAvailable,false);assert.equal(retry.token,undefined);assert.equal(retry.inviteId,invite.inviteId);
    assert.equal((await core.callFromWeb('get_itinerary_invite',{token:invite.token},viewer)).trip.id,trip);
    await assert.rejects(core.callFromWeb('get_itinerary',{tripId:trip},viewer),denied);
    const accept={token:invite.token,displayName:'Alex',...key()};
    await core.callFromWeb('accept_itinerary_invite',accept,viewer);
    await core.callFromWeb('accept_itinerary_invite',accept,viewer);
    await assert.rejects(core.callFromWeb('accept_itinerary_invite',{...accept,...key()},stranger),denied);
    await assert.rejects(core.callFromWeb('get_itinerary_invite',{token:invite.token},owner),denied);
    const plan=await core.callFromWeb('get_itinerary',{tripId:trip},viewer);
    assert.equal(plan.role,'viewer');assert.equal(plan.items[0].payload.notes,item.notes);assert.equal(plan.items[0].payload.status,item.status);
    assert.equal(plan.items[0].payload.bookingNote,'');assert.equal(plan.trip.owner_id,undefined);assert.deepEqual(plan.history,[]);assert.deepEqual(plan.research.decisions,[]);
    assert.ok(!JSON.stringify(plan).includes('PRIVATE'));
    assert.equal((await core.callFromWeb('get_itinerary',{tripId:trip},owner)).items[0].payload.bookingNote,item.bookingNote);
    const list=await core.callFromWeb('list_trips',{},viewer);assert.equal(list.trips.length,1);assert.equal(list.trips[0].id,trip);assert.equal(list.trips[0].role,'viewer');assert.equal(list.trips[0].owner_id,undefined);
    await assert.rejects(core.callFromWeb('get_itinerary',{tripId:other},viewer),denied);
    for(const operation of ['add_itinerary_item','update_itinerary_item','remove_itinerary_item','move_itinerary_item'] as const){
      const args=operation==='add_itinerary_item'?{item}:operation==='update_itinerary_item'?{item,itemId:added.itemId}:operation==='move_itinerary_item'?{itemId:added.itemId,direction:'up'}:{itemId:added.itemId};
      await assert.rejects(core.callFromWeb(operation,{tripId:trip,expectedRevision:2,...args,...key()},viewer),denied);
    }
    await assert.rejects(core.callFromWeb('create_itinerary_invite',{tripId:trip,label:'Onward',...key()},viewer),denied);
    await assert.rejects(core.callFromWeb('list_itinerary_access',{tripId:trip},viewer),denied);
    const actor={userId:viewer,clientId:'assistant'};await db.query('insert into client_grants values($1,$2,$3,null)',[viewer,actor.clientId,['read','write']]);
    assert.equal((await core.call('get_itinerary',{tripId:trip},actor)).role,'viewer');
    const ownerActor={userId:owner,clientId:'owner-assistant'};
    await db.query('insert into client_grants values($1,$2,$3,null)',[owner,ownerActor.clientId,['read','write']]);
    await assert.rejects(core.call('create_itinerary_invite',{tripId:trip,label:'Assistant grant must not expand',...key()},ownerActor),denied);
    await assert.rejects(core.call('get_trip',{tripId:trip},actor),denied);
    await assert.rejects(core.call('add_itinerary_item',{tripId:trip,expectedRevision:2,item,...key()},actor),denied);
    await core.callFromWeb('revoke_itinerary_access',{tripId:trip,inviteId:invite.inviteId,...key()},owner);
    await assert.rejects(core.callFromWeb('get_itinerary',{tripId:trip},viewer),denied);
    await assert.rejects(core.call('get_itinerary',{tripId:trip},actor),denied);
    await assert.rejects(core.callFromWeb('accept_itinerary_invite',accept,viewer),denied,'cached acceptance cannot restore access');
    assert.deepEqual((await core.callFromWeb('list_trips',{},viewer)).trips,[]);
    assert.equal((await core.callFromWeb('get_itinerary',{tripId:trip},owner)).role,'owner');
  }finally{await db.close();}
});

test('expired, revoked and concurrently claimed invitations do not grant access; fresh invitation can regrant',async()=>{
  const db=await embedded(),owner=randomUUID(),a=randomUUID(),b=randomUUID();
  try{
    await migrate(db);const core=new Core(db,false),trip=(await core.callFromWeb('create_trip',{...flaineTrip,...key()},owner)).tripId;
    const create=()=>core.callFromWeb('create_itinerary_invite',{tripId:trip,label:'',...key()},owner);
    const expired=await create();await db.query("update itinerary_invites set expires_at=now()-interval '1 second' where id=$1",[expired.inviteId]);
    await assert.rejects(core.callFromWeb('accept_itinerary_invite',{token:expired.token,displayName:'A',...key()},a),denied);
    const revoked=await create();await core.callFromWeb('revoke_itinerary_access',{tripId:trip,inviteId:revoked.inviteId,...key()},owner);
    await assert.rejects(core.callFromWeb('accept_itinerary_invite',{token:revoked.token,displayName:'A',...key()},a),denied);
    const invite=await create(),outcomes=await Promise.allSettled([a,b].map(user=>core.callFromWeb('accept_itinerary_invite',{token:invite.token,displayName:'Friend',...key()},user)));
    assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
    assert.equal((await db.query('select * from itinerary_members where revoked_at is null')).rows.length,1);
    const winner=outcomes[0]!.status==='fulfilled'?a:b;
    await core.callFromWeb('revoke_itinerary_access',{tripId:trip,inviteId:invite.inviteId,...key()},owner);
    const fresh=await create();await core.callFromWeb('accept_itinerary_invite',{token:fresh.token,displayName:'Friend',...key()},winner);
    assert.equal((await core.callFromWeb('get_itinerary',{tripId:trip},winner)).role,'viewer');
    const foreign=(await core.callFromWeb('create_trip',{...flaineTrip,...key()},owner)).tripId;
    await assert.rejects(core.callFromWeb('revoke_itinerary_access',{tripId:foreign,inviteId:fresh.inviteId,...key()},owner),denied);
  }finally{await db.close();}
});
