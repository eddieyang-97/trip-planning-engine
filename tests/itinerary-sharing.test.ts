import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {embedded,migrate} from '../src/database.js';
import {Core} from '../src/core.js';
import {flaineTrip} from '../src/acceptance.js';
import {DomainError} from '../src/domain.js';
import type {ItineraryItem} from '../src/itinerary.js';

const key=()=>({idempotencyKey:randomUUID()});
const denied=(e:unknown)=>e instanceof DomainError&&e.code==='FORBIDDEN_OR_NOT_FOUND';
const item:ItineraryItem={type:'accommodation',title:'Shared stay',startDate:'2026-12-18',endDate:'2026-12-20',startTime:null,endTime:null,
  timeZone:null,endTimeZone:null,location:'Flaine',url:null,notes:'Meet at reception',openQuestion:'Late arrival?',status:'user_reported_booked',bookingNote:'PRIVATE confirmation reference'};
const {status:_status,bookingNote:_note,...sharedItem}=item;

test('editor migration keeps existing invitations and memberships view-only',async()=>{
  const db=await embedded(),trip=randomUUID(),owner=randomUUID(),viewer=randomUUID(),invite=randomUUID();
  try{
    for(const file of ['001_initial.sql','004_itinerary.sql','006_itinerary_sharing.sql'])await db.execute(await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
    await db.query('insert into trips(id,owner_id,payload) values($1,$2,$3)',[trip,owner,JSON.stringify(flaineTrip)]);
    await db.query('insert into itinerary_invites(id,trip_id,token_hash,label,accepted_by,accepted_at) values($1,$2,$3,$4,$5,now())',[invite,trip,'old-hash','Existing friend',viewer]);
    await db.query('insert into itinerary_members(id,trip_id,user_id,display_name,invite_id) values($1,$2,$3,$4,$5)',[randomUUID(),trip,viewer,'Friend',invite]);
    await db.execute(await readFile(new URL('../migrations/007_itinerary_editors.sql',import.meta.url),'utf8'));
    assert.equal((await db.query('select role from itinerary_invites where id=$1',[invite])).rows[0]!.role,'viewer');
    assert.equal((await db.query('select role from itinerary_members where invite_id=$1',[invite])).rows[0]!.role,'viewer');
  }finally{await db.close();}
});

test('editor web writes preserve private booking state, record authorship and stop after downgrade or revocation',async()=>{
  const db=await embedded(),owner=randomUUID(),editor=randomUUID(),stranger=randomUUID();
  try{
    await migrate(db);const core=new Core(db,false),trip=(await core.callFromWeb('create_trip',{...flaineTrip,...key()},owner)).tripId;
    const foreign=(await core.callFromWeb('create_trip',{...flaineTrip,...key()},owner)).tripId;
    const saved=await core.callFromWeb('add_itinerary_item',{tripId:trip,expectedRevision:1,item,...key()},owner);
    const invite=await core.callFromWeb('create_itinerary_invite',{tripId:trip,label:'Editor',role:'editor',...key()},owner);
    assert.equal((await core.callFromWeb('get_itinerary_invite',{token:invite.token},editor)).role,'editor');
    const acceptance={token:invite.token,displayName:'Alex',...key()};
    await core.callFromWeb('accept_itinerary_invite',acceptance,editor);
    assert.equal((await core.callFromWeb('list_trips',{},editor)).trips[0].role,'editor');
    const plan=await core.callFromWeb('get_itinerary',{tripId:trip},editor);
    assert.equal(plan.role,'editor');assert.ok(!JSON.stringify(plan).includes('PRIVATE'));assert.deepEqual(plan.history,[]);assert.deepEqual(plan.research.decisions,[]);assert.equal(plan.trip.owner_id,undefined);
    const edit={tripId:trip,itemId:saved.itemId,expectedRevision:2,item:{...sharedItem,notes:'Updated by Alex'},...key()};
    assert.equal((await core.callFromWeb('update_shared_itinerary_item',edit,editor)).revision,3);
    assert.equal((await core.callFromWeb('update_shared_itinerary_item',edit,editor)).revision,3,'authorized identical retry is idempotent');
    const owned=await core.callFromWeb('get_itinerary',{tripId:trip},owner);
    assert.equal(owned.items[0].payload.bookingNote,item.bookingNote);assert.equal(owned.items[0].payload.status,item.status);assert.equal(owned.items[0].payload.notes,'Updated by Alex');assert.equal(owned.history[0].actor_id,editor);
    await assert.rejects(core.callFromWeb('update_shared_itinerary_item',{...edit,...key(),expectedRevision:3,item:{...sharedItem,status:'tentative'}},editor));
    await assert.rejects(core.callFromWeb('update_shared_itinerary_item',{...edit,...key(),expectedRevision:3,item:{...sharedItem,bookingNote:'injection'}},editor));
    for(const operation of ['add_itinerary_item','update_itinerary_item'] as const)await assert.rejects(core.callFromWeb(operation,{tripId:trip,expectedRevision:3,...(operation==='update_itinerary_item'?{itemId:saved.itemId}:{}),item,...key()},editor),denied);
    await assert.rejects(core.callFromWeb('add_shared_itinerary_item',{tripId:trip,expectedRevision:3,item:sharedItem,...key()},stranger),denied);
    await assert.rejects(core.callFromWeb('update_shared_itinerary_item',{...edit,...key(),tripId:foreign,expectedRevision:1},editor),denied);
    await assert.rejects(core.callFromWeb('create_itinerary_invite',{tripId:trip,label:'Onward',role:'editor',...key()},editor),denied);
    await assert.rejects(core.callFromWeb('list_itinerary_access',{tripId:trip},editor),denied);
    const added=await core.callFromWeb('add_shared_itinerary_item',{tripId:trip,expectedRevision:3,item:{...sharedItem,title:'New shared idea'},...key()},editor);
    let current=await core.callFromWeb('get_itinerary',{tripId:trip},owner);
    assert.equal(current.items[1].payload.status,'tentative');assert.equal(current.items[1].payload.bookingNote,'');
    await core.callFromWeb('move_itinerary_item',{tripId:trip,itemId:added.itemId,direction:'up',expectedRevision:4,...key()},editor);
    await core.callFromWeb('remove_itinerary_item',{tripId:trip,itemId:added.itemId,expectedRevision:5,...key()},editor);
    const actor={userId:editor,clientId:'editor-assistant'};await db.query('insert into client_grants values($1,$2,$3,null)',[editor,actor.clientId,['read','write']]);
    assert.equal((await core.call('get_itinerary',{tripId:trip},actor)).role,'editor');
    await assert.rejects(core.call('update_shared_itinerary_item',{...edit,...key(),expectedRevision:6},actor),denied);
    await assert.rejects(core.call('remove_itinerary_item',{tripId:trip,itemId:saved.itemId,expectedRevision:6,...key()},actor),denied);
    // A newly accepted invitation replaces the old membership, including its role.
    const downgrade=await core.callFromWeb('create_itinerary_invite',{tripId:trip,label:'Viewer now',...key()},owner);
    await core.callFromWeb('accept_itinerary_invite',{token:downgrade.token,displayName:'Alex',...key()},editor);
    assert.equal((await core.callFromWeb('get_itinerary',{tripId:trip},editor)).role,'viewer');
    await assert.rejects(core.callFromWeb('update_shared_itinerary_item',edit,editor),denied,'cached edit cannot bypass downgrade');
    await assert.rejects(core.callFromWeb('accept_itinerary_invite',acceptance,editor),denied,'old editor invitation cannot restore role');
    const upgraded=await core.callFromWeb('create_itinerary_invite',{tripId:trip,label:'Editor again',role:'editor',...key()},owner);
    await core.callFromWeb('accept_itinerary_invite',{token:upgraded.token,displayName:'Alex',...key()},editor);
    await core.callFromWeb('revoke_itinerary_access',{tripId:trip,inviteId:upgraded.inviteId,...key()},owner);
    await assert.rejects(core.callFromWeb('update_shared_itinerary_item',edit,editor),denied,'cached edit cannot bypass revocation');
    await assert.rejects(core.callFromWeb('get_itinerary',{tripId:trip},editor),denied);
    current=await core.callFromWeb('get_itinerary',{tripId:trip},owner);assert.equal(current.revision,6);assert.equal(current.items[0].payload.bookingNote,item.bookingNote);
  }finally{await db.close();}
});

test('owner and editor edits share one revision and cannot silently overwrite each other',async()=>{
  const db=await embedded(),owner=randomUUID(),editor=randomUUID();
  try{
    await migrate(db);const core=new Core(db,false),trip=(await core.callFromWeb('create_trip',{...flaineTrip,...key()},owner)).tripId;
    const saved=await core.callFromWeb('add_itinerary_item',{tripId:trip,expectedRevision:1,item,...key()},owner);
    const invite=await core.callFromWeb('create_itinerary_invite',{tripId:trip,label:'',role:'editor',...key()},owner);
    await core.callFromWeb('accept_itinerary_invite',{token:invite.token,displayName:'Editor',...key()},editor);
    const outcomes=await Promise.allSettled([
      core.callFromWeb('update_itinerary_item',{tripId:trip,itemId:saved.itemId,expectedRevision:2,item:{...item,title:'Owner change'},...key()},owner),
      core.callFromWeb('update_shared_itinerary_item',{tripId:trip,itemId:saved.itemId,expectedRevision:2,item:{...sharedItem,title:'Editor change'},...key()},editor),
    ]);
    assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
    const failed=outcomes.find(r=>r.status==='rejected') as PromiseRejectedResult;assert.equal(failed.reason.code,'REVISION_CONFLICT');
    const plan=await core.callFromWeb('get_itinerary',{tripId:trip},owner);assert.equal(plan.revision,3);assert.equal(plan.history.length,2);assert.equal(plan.items[0].payload.bookingNote,item.bookingNote);
  }finally{await db.close();}
});

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
