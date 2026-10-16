import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {pooledDatabase,type Database} from '../src/database.js';
import {Core} from '../src/core.js';
import {flaineTrip} from '../src/acceptance.js';
import {DomainError} from '../src/domain.js';
import {readItineraryViewLink} from '../src/itinerary-view-links.js';

test('pooled PostgreSQL serializes invitation claims and denies revoked membership on a new connection',{
  skip:!process.env.TEST_POSTGRES_URL,timeout:30000,
},async()=>{
  const url=new URL(process.env.TEST_POSTGRES_URL!);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));assert.equal(url.search,'');
  const schema='test_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:url.href,max:1});let db:Database|undefined;
  try{
    await admin.query(`create schema ${schema}`);
    db=pooledDatabase(new pg.Pool({connectionString:url.href,max:4,options:`-c search_path=${schema}`,statement_timeout:10000}));
    for(const file of ['001_initial.sql','003_policy_notes.sql','004_itinerary.sql','005_live_search.sql','006_itinerary_sharing.sql','007_itinerary_editors.sql','008_itinerary_view_links.sql','009_itinerary_comments.sql','010_account_profiles.sql','011_trip_lifecycle.sql'])await db.execute(await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
    const core=new Core(db,false),owner=randomUUID(),a=randomUUID(),b=randomUUID(),key=()=>({idempotencyKey:randomUUID()});
    const trip=(await core.callFromWeb('create_trip',{...flaineTrip,...key()},owner)).tripId;
    const invite=await core.callFromWeb('create_itinerary_invite',{tripId:trip,label:'Concurrent fixture',...key()},owner);
    const outcomes=await Promise.allSettled([a,b].map(user=>core.callFromWeb('accept_itinerary_invite',{token:invite.token,displayName:'Friend',...key()},user)));
    assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.filter(r=>r.status==='rejected').length,1);
    const winner=outcomes[0]!.status==='fulfilled'?a:b;
    assert.equal((await core.callFromWeb('list_trips',{},winner)).trips.length,1);
    // Deliberately reverse order: acceptance must not resurrect a revoked invitation.
    let locked!:()=>void,release!:()=>void;
    const hasLock=new Promise<void>(r=>{locked=r;}),continueRevocation=new Promise<void>(r=>{release=r;});
    const revocation=db.transaction(async tx=>{
      await tx.query('select id from trips where id=$1 for update',[trip]);locked();await continueRevocation;
      await tx.query('update itinerary_invites set revoked_at=now() where id=$1',[invite.inviteId]);
      await tx.query('update itinerary_members set revoked_at=now() where invite_id=$1',[invite.inviteId]);
    });
    await hasLock;
    const reclaim=core.callFromWeb('accept_itinerary_invite',{token:invite.token,displayName:'Friend',...key()},winner);
    void reclaim.catch(()=>{});release();await revocation;
    const denied=(e:unknown)=>e instanceof DomainError&&e.code==='FORBIDDEN_OR_NOT_FOUND';
    await assert.rejects(reclaim,denied);
    await assert.rejects(core.callFromWeb('get_itinerary',{tripId:trip},winner),denied);
    assert.equal((await core.callFromWeb('list_trips',{},winner)).trips.length,0);
    const editing=await core.callFromWeb('create_itinerary_invite',{tripId:trip,label:'Editor race',role:'editor',...key()},owner);
    await core.callFromWeb('accept_itinerary_invite',{token:editing.token,displayName:'Editor',...key()},winner);
    const shared={type:'note',title:'Must not be saved after revocation',startDate:null,startTime:null,endDate:null,endTime:null,timeZone:null,endTimeZone:null,location:'',url:null,notes:'',openQuestion:''};
    const commentArgs={tripId:trip,body:'Editor discussion before revocation',...key()};
    await core.callFromWeb('add_itinerary_comment',commentArgs,winner);
    let editorLocked!:()=>void,releaseEditor!:()=>void;
    const editorHasLock=new Promise<void>(r=>{editorLocked=r;}),continueEditorRevocation=new Promise<void>(r=>{releaseEditor=r;});
    const revokeEditor=db.transaction(async tx=>{
      await tx.query('select id from trips where id=$1 for update',[trip]);editorLocked();await continueEditorRevocation;
      await tx.query('update itinerary_invites set revoked_at=now() where id=$1',[editing.inviteId]);
      await tx.query('update itinerary_members set revoked_at=now() where invite_id=$1',[editing.inviteId]);
    });
    await editorHasLock;
    const blockedWrite=core.callFromWeb('add_shared_itinerary_item',{tripId:trip,expectedRevision:1,item:shared,...key()},winner);
    const blockedComment=core.callFromWeb('add_itinerary_comment',{tripId:trip,body:'Must not save after revocation',...key()},winner);
    void blockedWrite.catch(()=>{});void blockedComment.catch(()=>{});releaseEditor();await revokeEditor;
    await assert.rejects(blockedComment,denied);
    await assert.rejects(core.callFromWeb('add_itinerary_comment',commentArgs,winner),denied);
    assert.equal((await core.callFromWeb('list_itinerary_comments',{tripId:trip},owner)).comments.length,1);
    await assert.rejects(blockedWrite,denied);
    assert.equal((await core.callFromWeb('get_itinerary',{tripId:trip},owner)).items.length,0);
    const viewLink=await core.callFromWeb('create_itinerary_view_link',{tripId:trip,label:'Anonymous pooled read',...key()},owner);
    assert.equal((await readItineraryViewLink(db,{token:viewLink.token})).trip.id,trip);
    await core.callFromWeb('revoke_itinerary_access',{tripId:trip,inviteId:viewLink.inviteId,...key()},owner);
    await assert.rejects(readItineraryViewLink(db,{token:viewLink.token}),denied,'fresh pooled anonymous read observes committed revocation');
  }finally{await db?.close();await admin.query(`drop schema if exists ${schema} cascade`);await admin.end();}
});
