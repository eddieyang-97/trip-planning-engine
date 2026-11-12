import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {Core,type ToolName} from '../src/core.js';
import {embedded,migrate} from '../src/database.js';
import {DomainError} from '../src/domain.js';
import {readItineraryViewLink} from '../src/itinerary-view-links.js';

const denied=(code:string)=>(error:unknown)=>error instanceof DomainError&&error.code===code;
const trip={name:'Fictional forest weekend',destination:'Fictional village',startDate:'2027-01-08',endDate:'2027-01-11',adults:10};
const item={type:'transfer',title:'Sunday return',startDate:'2027-01-10',startTime:null,endDate:null,endTime:null,
  timeZone:null,endTimeZone:null,location:'',url:null,notes:'',openQuestion:'',status:'tentative',bookingNote:''};

test('traveler IDs survive rename, archive and older-client edits with role-specific projections',async()=>{
  const db=await embedded(),owner=randomUUID(),editor=randomUUID(),actor={userId:owner,clientId:'fictional-assistant'};
  const core=new Core(db,false),write=(name:ToolName,args:Record<string,unknown>,user=owner)=>core.callFromWeb(name,{idempotencyKey:randomUUID(),...args},user);
  try{
    await migrate(db);
    await db.query('insert into client_grants(owner_id,client_id,permissions) values($1,$2,$3)',[owner,actor.clientId,['read','write']]);
    await db.query('insert into client_grants(owner_id,client_id,permissions) values($1,$2,$3)',[editor,actor.clientId,['read']]);
    const {tripId}=await write('create_trip',trip),other=await write('create_trip',trip);
    const roster=(change:Record<string,unknown>,expectedRevision:number,extra={})=>write('manage_trip_traveler',{tripId,change,expectedRevision,...extra});
    const add={idempotencyKey:randomUUID()};
    const a=await roster({action:'add',name:'Alex'},1,add);
    assert.deepEqual(await roster({action:'add',name:'Alex'},1,add),a);
    const b=await roster({action:'add',name:'Alex'},2);
    assert.notEqual(a.travelerId,b.travelerId);
    const foreign=await write('manage_trip_traveler',{tripId:other.tripId,expectedRevision:1,change:{action:'add',name:'Unrelated'}});
    await assert.rejects(write('add_itinerary_item',{tripId,expectedRevision:3,item:{...item,travelerIds:[foreign.travelerId]}}),denied('VALIDATION_ERROR'));
    const outbound=await write('add_itinerary_item',{tripId,expectedRevision:3,item:{...item,travelerIds:[a.travelerId.toUpperCase()]}});
    await assert.rejects(roster({action:'rename',id:a.travelerId,name:'Alex North'},3),denied('REVISION_CONFLICT'));
    await roster({action:'rename',id:a.travelerId,name:'Alex North'},4);
    await roster({action:'archive',id:a.travelerId},5);
    await assert.rejects(write('add_itinerary_item',{tripId,expectedRevision:6,item:{...item,travelerIds:[a.travelerId]}}),denied('VALIDATION_ERROR'));
    const legacyEdit={tripId,itemId:outbound.itemId,expectedRevision:6,item:{...item,title:'Revised Sunday return'},idempotencyKey:randomUUID()};
    await core.call('update_itinerary_item',legacyEdit,actor);
    const owned=await core.call('get_itinerary',{tripId},actor);
    assert.deepEqual(owned.travelers.find((r:{id:string})=>r.id===a.travelerId),{id:a.travelerId,name:'Alex North',archived:true});
    assert.deepEqual(owned.items[0].payload.travelerIds,[a.travelerId]);
    assert.deepEqual(owned.history.map((row:{action:string})=>row.action),['edited','traveler_archived','traveler_renamed','added','traveler_added','traveler_added']);
    assert.deepEqual(owned.history[0].before_payload.payload.travelerIds,[a.travelerId]);
    await assert.rejects(core.call('manage_trip_traveler',{tripId},actor),denied('FORBIDDEN_OR_NOT_FOUND'));
    await assert.rejects(core.callFromWeb('get_itinerary',{tripId},editor),denied('FORBIDDEN_OR_NOT_FOUND'));
    const invite=await write('create_itinerary_invite',{tripId,label:'Editor',role:'editor'});
    await write('accept_itinerary_invite',{token:invite.token,displayName:'Editor'},editor);
    await assert.rejects(write('manage_trip_traveler',{tripId,expectedRevision:7,change:{action:'restore',id:a.travelerId}},editor),denied('FORBIDDEN_OR_NOT_FOUND'));
    const shared=await core.call('get_itinerary',{tripId},{...actor,userId:editor});
    assert.deepEqual(shared.travelers.find((r:{id:string})=>r.id===a.travelerId),{id:a.travelerId,name:'',archived:true});
    assert.deepEqual(shared.items[0].payload.travelerIds,[a.travelerId]);
    assert.deepEqual(shared.history,[]);
    const view=await write('create_itinerary_view_link',{tripId,label:'Anonymous'});
    const anonymous=await readItineraryViewLink(db,{token:view.token});
    assert.equal('travelers' in anonymous,false);
    assert.equal('travelerIds' in anonymous.items[0]!.payload,false);
    const {status,bookingNote,...editable}=item;
    await write('update_shared_itinerary_item',{tripId,itemId:outbound.itemId,expectedRevision:7,item:{...editable,travelerIds:[]}},editor);
    assert.deepEqual((await core.call('get_itinerary',{tripId},actor)).items[0].payload.travelerIds,[]);
    await write('revoke_itinerary_access',{tripId,inviteId:invite.inviteId});
    await assert.rejects(core.call('get_itinerary',{tripId},{...actor,userId:editor}),denied('FORBIDDEN_OR_NOT_FOUND'));
    const review=await write('prepare_trip_action',{tripId,action:'delete'});
    await write('delete_trip',{tripId,expectedRevision:review.expectedRevision,confirmationToken:review.confirmationToken,confirmationName:trip.name,confirmed:true});
    assert.equal((await db.query('select id from trip_travelers where trip_id=$1',[tripId])).rows.length,0);
    assert.equal((await db.query('select id from itinerary_events where trip_id=$1',[tripId])).rows.length,0);
  }finally{await db.close();}
});
