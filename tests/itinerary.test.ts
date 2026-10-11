import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { embedded, migrate } from '../src/database.js';
import { Core } from '../src/core.js';
import { flaineTrip } from '../src/acceptance.js';
import { itineraryItemSchema, type ItineraryItem } from '../src/itinerary.js';
import { itineraryRoutes } from '../src/itinerary-web.js';
import { createApp } from '../src/app.js';
import { DomainError } from '../src/domain.js';

const item:ItineraryItem={type:'accommodation',title:'An apartment, perhaps',startDate:'2026-12-18',startTime:null,
  endDate:'2026-12-20',endTime:null,timeZone:null,endTimeZone:null,location:'Flaine',url:'https://example.com/stay',
  notes:'User supplied note',openQuestion:'Late check-in?',status:'tentative',bookingNote:''};
const key=()=>({idempotencyKey:randomUUID()});
const code=(expected:string)=>(error:unknown)=>error instanceof DomainError&&error.code===expected;

test('itinerary validates optional times, safe links and explicit reported bookings',()=>{
  assert.equal(itineraryItemSchema.parse(item).startTime,null);
  for(const change of [{startDate:null,startTime:'20:00'},{timeZone:'invented/zone'},{url:'javascript:alert(1)'},
    {url:'https://user:secret@example.com'},{status:'user_reported_booked',bookingNote:''},{bookingNote:'Contradictory booking'},
    {endDate:'2026-12-17'},{title:'   '},{startTime:'25:30'}])assert.equal(itineraryItemSchema.safeParse({...item,...change}).success,false);
  assert.equal(itineraryItemSchema.parse({...item,status:'user_reported_booked',bookingNote:'I booked externally today.'}).status,'user_reported_booked');
});

test('web and MCP share private itinerary state, revisions, idempotency and removal history',async()=>{
  const db=await embedded(),owner=randomUUID(),other=randomUUID(),actor={userId:owner,clientId:'test'};
  try{
    await migrate(db);const core=new Core(db,false);
    await db.query('insert into client_grants values($1,$2,$3,null)',[owner,'test',['read','write']]);
    const trip=await core.callFromWeb('create_trip',{...flaineTrip,...key()},owner);
    const input={tripId:trip.tripId,expectedRevision:1,item,...key()};
    const created=await core.callFromWeb('add_itinerary_item',input,owner);
    assert.deepEqual(await core.call('add_itinerary_item',input,actor),created,'retry across surfaces returns one result');
    await assert.rejects(core.call('add_itinerary_item',{...input,item:{...item,title:'Changed'}},actor),code('IDEMPOTENCY_CONFLICT'));
    const first=await core.call('get_itinerary',{tripId:trip.tripId},actor);assert.equal(first.items.length,1);assert.equal(first.items[0].payload.startTime,null);
    await assert.rejects(core.callFromWeb('get_itinerary',{tripId:trip.tripId},other),code('FORBIDDEN_OR_NOT_FOUND'));
    await assert.rejects(core.callFromWeb('update_itinerary_item',{...key(),tripId:trip.tripId,itemId:created.itemId,expectedRevision:1,item},owner),code('REVISION_CONFLICT'));
    const updated=await core.call('update_itinerary_item',{...key(),tripId:trip.tripId,itemId:created.itemId,expectedRevision:2,
      item:{...item,status:'user_reported_booked',bookingNote:'Booked myself on 11 October.'}},actor);
    assert.equal(updated.supplierTransactionMade,false);
    const second=await core.callFromWeb('get_itinerary',{tripId:trip.tripId},owner);assert.equal(second.items[0].payload.status,'user_reported_booked');
    assert.equal(second.history[0].before_payload.payload.status,'tentative');
    await core.callFromWeb('remove_itinerary_item',{...key(),tripId:trip.tripId,itemId:created.itemId,expectedRevision:3},owner);
    const removed=await core.call('get_itinerary',{tripId:trip.tripId},actor);assert.equal(removed.items.length,0);assert.equal(removed.history.length,3);
    assert.equal(removed.history[0].before_payload.payload.status,'user_reported_booked');
    await db.query('update client_grants set revoked_at=now()');
    await assert.rejects(core.call('get_itinerary',{tripId:trip.tripId},actor),code('FORBIDDEN_OR_NOT_FOUND'));
    assert.equal((await core.callFromWeb('get_itinerary',{tripId:trip.tripId},owner)).revision,4,'revoking an assistant does not revoke owner direct access');
    await assert.rejects(core.callFromWeb('start_search',{},owner),code('FORBIDDEN_OR_NOT_FOUND'));
  }finally{await db.close();}
});

test('reorder stays within a date, and concurrent edits cannot overwrite one another',async()=>{
  const db=await embedded(),owner=randomUUID();
  try{
    await migrate(db);const core=new Core(db,false),trip=await core.callFromWeb('create_trip',{...flaineTrip,...key()},owner);
    const first=await core.callFromWeb('add_itinerary_item',{...key(),tripId:trip.tripId,expectedRevision:1,item},owner);
    const second=await core.callFromWeb('add_itinerary_item',{...key(),tripId:trip.tripId,expectedRevision:2,item:{...item,title:'Another stay'}},owner);
    await core.callFromWeb('move_itinerary_item',{...key(),tripId:trip.tripId,expectedRevision:3,itemId:second.itemId,direction:'up'},owner);
    assert.equal((await core.callFromWeb('get_itinerary',{tripId:trip.tripId},owner)).items[0].id,second.itemId);
    const outcomes=await Promise.allSettled([first,second].map(row=>core.callFromWeb('update_itinerary_item',{
      ...key(),tripId:trip.tripId,expectedRevision:4,itemId:row.itemId,item:{...item,title:'Concurrent edit'}},owner)));
    assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);
    const foreign=await core.callFromWeb('create_trip',{...flaineTrip,...key()},owner);
    await assert.rejects(core.callFromWeb('remove_itinerary_item',{...key(),tripId:foreign.tripId,expectedRevision:1,itemId:first.itemId},owner),code('FORBIDDEN_OR_NOT_FOUND'));
  }finally{await db.close();}
});

test('web routes require direct authentication and same-origin writes, reject caller owner fields and expose no private preview data',async()=>{
  const db=await embedded(),http=createServer(),owner=randomUUID(),other=randomUUID();
  try{
    await migrate(db);const core=new Core(db,false);
    await new Promise<void>(resolve=>http.listen(0,'127.0.0.1',resolve));const address=http.address();assert.ok(address&&typeof address!=='string');const origin=`http://127.0.0.1:${address.port}`;
    const authenticate=async(header?:string)=>{if(header!=='Bearer direct'&&header!=='Bearer other')throw Error('No direct session');return {userId:header==='Bearer direct'?owner:other};};
    http.on('request',createApp({core,authenticate:async()=>{throw Error('No MCP');},publicOrigin:origin,
      itinerary:itineraryRoutes({core,origin,authenticate,supabaseUrl:'https://auth.example',publishableKey:'sb_publishable_test'})}));
    const post=(operation:string,body:unknown,token='direct',from=origin)=>fetch(`${origin}/itinerary-api/${operation}`,{method:'POST',headers:{origin:from,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    const page=await fetch(`${origin}/itinerary?demo=1`);assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy')!,/frame-ancestors 'none'/);
    assert.equal((await post('list_trips',{},'assistant-token')).status,401);
    assert.equal((await post('create_trip',{...flaineTrip,...key()},'direct','https://evil.example')).status,403);
    assert.equal((await post('create_trip',{...flaineTrip,...key(),ownerId:other})).status,400);
    const trip=await(await post('create_trip',{...flaineTrip,...key()})).json();
    assert.equal((await post('get_itinerary',{tripId:trip.tripId},'other')).status,404);
    const data={...key(),tripId:trip.tripId,expectedRevision:1,item};
    assert.equal((await post('add_itinerary_item',data)).status,200);
    assert.equal((await post('add_itinerary_item',{...data,...key()})).status,409);
    assert.equal((await post('create_policy_note',{})).status,404);
    assert.equal((await db.query('select * from client_grants')).rows.length,0,'direct web does not fabricate assistant grants');
  }finally{await new Promise<void>(resolve=>http.close(()=>resolve()));await db.close();}
});
