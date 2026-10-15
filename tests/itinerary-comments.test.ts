import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {embedded,migrate} from '../src/database.js';
import {Core} from '../src/core.js';
import {flaineTrip} from '../src/acceptance.js';
import {DomainError} from '../src/domain.js';
import {readItineraryViewLink} from '../src/itinerary-view-links.js';
const key=()=>({idempotencyKey:randomUUID()});
const denied=(e:unknown)=>e instanceof DomainError&&e.code==='FORBIDDEN_OR_NOT_FOUND';
async function fixture(){
  const db=await embedded();await migrate(db);const core=new Core(db,false),owner=randomUUID(),editor=randomUUID(),viewer=randomUUID();
  const trip=(await core.callFromWeb('create_trip',{...flaineTrip,...key()},owner)).tripId;
  const item=(await core.callFromWeb('add_itinerary_item',{tripId:trip,expectedRevision:1,...key(),item:{type:'note',title:'Example',startDate:null,startTime:null,endDate:null,endTime:null,timeZone:null,endTimeZone:null,location:'',url:null,notes:'',openQuestion:'',status:'tentative',bookingNote:''}},owner)).itemId;
  const invites:any[]=[];
  for(const [user,role] of [[editor,'editor'],[viewer,'viewer']] as const){
    const invite=await core.callFromWeb('create_itinerary_invite',{tripId:trip,role,label:'Test',...key()},owner);invites.push(invite);
    await core.callFromWeb('accept_itinerary_invite',{token:invite.token,displayName:'Friend',...key()},user);
  }
  return {db,core,owner,editor,viewer,trip,item,invites};
}
test('discussion enforces membership, moderation, private projection and cached retry revocation',async()=>{
  const f=await fixture();const {db,core,owner,editor,viewer,trip,item}=f;
  try{
    const args={tripId:trip,itemId:item,body:'<script>literal plain text</script>',...key()};
    const c=await core.callFromWeb('add_itinerary_comment',args,editor);
    assert.deepEqual(await core.callFromWeb('add_itinerary_comment',args,editor),c);
    const page=await core.callFromWeb('list_itinerary_comments',{tripId:trip},viewer);
    assert.equal(page.comments.length,1);assert.equal(page.comments[0].body,args.body);assert.equal(page.comments[0].authorName,'Friend');
    assert.equal(page.comments[0].canRemove,false);assert.equal(page.canComment,false);
    assert.ok(!JSON.stringify(page).includes(editor));assert.equal((await core.callFromWeb('get_itinerary',{tripId:trip},owner)).revision,2);
    for(const user of [viewer,randomUUID()])await assert.rejects(core.callFromWeb('add_itinerary_comment',{...args,...key()},user),denied);
    await assert.rejects(core.callFromWeb('list_itinerary_comments',{tripId:trip},randomUUID()),denied);
    const own=await core.callFromWeb('add_itinerary_comment',{tripId:trip,body:'Owner note',...key()},owner);
    await assert.rejects(core.callFromWeb('remove_itinerary_comment',{tripId:trip,commentId:own.commentId,...key()},editor),denied);
    await core.callFromWeb('remove_itinerary_comment',{tripId:trip,commentId:c.commentId,...key()},editor);
    const tombstone=(await core.callFromWeb('list_itinerary_comments',{tripId:trip},owner)).comments.find((x:any)=>x.id===c.commentId);
    assert.equal(tombstone.body,null);assert.equal(tombstone.canRemove,false);
    const link=await core.callFromWeb('create_itinerary_view_link',{tripId:trip,label:'Test',...key()},owner);
    const anonymous=await readItineraryViewLink(db,{token:link.token});assert.ok(!JSON.stringify(anonymous).includes('Owner note'));assert.equal((anonymous as any).comments,undefined);
    await core.callFromWeb('revoke_itinerary_access',{tripId:trip,inviteId:f.invites[0].inviteId,...key()},owner);
    await assert.rejects(core.callFromWeb('add_itinerary_comment',args,editor),denied);
    await assert.rejects(core.callFromWeb('list_itinerary_comments',{tripId:trip},editor),denied);
  }finally{await db.close();}
});
test('discussion pagination preserves timestamp precision, rejects foreign cursors and retains removed threads',async()=>{
  const {db,core,owner,trip,item}=await fixture();
  try{
    const ids:string[]=[];
    for(let i=0;i<5;i++){
      const {commentId}=await core.callFromWeb('add_itinerary_comment',{tripId:trip,itemId:item,body:`Comment ${i}`,...key()},owner);ids.push(commentId);
      await db.query("update itinerary_comments set created_at='2026-10-15 01:00:00.123450+00'::timestamptz + ($2::int * interval '1 microsecond') where id=$1",[commentId,i]);
    }
    const seen:string[]=[];let before:string|undefined;
    do{const p=await core.callFromWeb('list_itinerary_comments',{tripId:trip,itemId:item,limit:2,...(before?{before}:{})},owner);seen.push(...p.comments.map((c:any)=>c.id));before=p.nextBefore??undefined;}while(before);
    assert.equal(new Set(seen).size,5);assert.deepEqual(new Set(seen),new Set(ids));
    const general=await core.callFromWeb('add_itinerary_comment',{tripId:trip,body:'General',...key()},owner);
    await assert.rejects(core.callFromWeb('list_itinerary_comments',{tripId:trip,itemId:item,before:general.commentId},owner),denied);
    const foreign=(await core.callFromWeb('create_trip',{...flaineTrip,...key()},owner)).tripId;
    await assert.rejects(core.callFromWeb('add_itinerary_comment',{tripId:foreign,itemId:item,body:'Cross trip',...key()},owner),denied);
    await core.callFromWeb('remove_itinerary_item',{tripId:trip,itemId:item,expectedRevision:2,...key()},owner);
    const removed=await core.callFromWeb('list_itinerary_comments',{tripId:trip,itemId:item},owner);
    assert.equal(removed.comments.length,5);assert.equal(removed.thread.removed,true);assert.equal(removed.canComment,false);
    await assert.rejects(core.callFromWeb('add_itinerary_comment',{tripId:trip,itemId:item,body:'Removed',...key()},owner),denied);
  }finally{await db.close();}
});
test('assistant comments require grants and retain owner-only mutation scope; content and rate limits apply',async()=>{
  const {db,core,owner,editor,trip}=await fixture();
  try{
    const actor={userId:owner,clientId:'test'},peer={userId:editor,clientId:'test'};
    await assert.rejects(core.call('list_itinerary_comments',{tripId:trip},actor),denied);
    for(const user of [owner,editor])await db.query('insert into client_grants values($1,$2,$3,null)',[user,'test',['read','write']]);
    const c=await core.call('add_itinerary_comment',{tripId:trip,body:'Assistant note',...key()},actor);
    assert.equal((await core.call('list_itinerary_comments',{tripId:trip},peer)).comments[0].id,c.commentId);
    await assert.rejects(core.call('add_itinerary_comment',{tripId:trip,body:'Editor assistant',...key()},peer),denied);
    await core.call('remove_itinerary_comment',{tripId:trip,commentId:c.commentId,...key()},actor);
    assert.equal((await core.call('list_itinerary_comments',{tripId:trip},actor)).comments[0].body,null);
    for(const body of ['   ','a'.repeat(2001)])await assert.rejects(core.callFromWeb('add_itinerary_comment',{tripId:trip,body,...key()},owner));
    for(let i=1;i<20;i++)await core.callFromWeb('add_itinerary_comment',{tripId:trip,body:'Rate test',...key()},owner);
    await assert.rejects(core.callFromWeb('add_itinerary_comment',{tripId:trip,body:'Too many',...key()},owner),e=>e instanceof DomainError&&e.code==='LIMIT_REACHED');
  }finally{await db.close();}
});
