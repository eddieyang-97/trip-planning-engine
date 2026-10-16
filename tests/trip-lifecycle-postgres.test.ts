import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {pooledDatabase,type Database} from '../src/database.js';
import {Core} from '../src/core.js';
import {flaineTrip} from '../src/acceptance.js';
const key=()=>({idempotencyKey:randomUUID()});
test('pooled PostgreSQL deletion serializes an already-started editor save and prevents a late write or retry',{
  skip:!process.env.TEST_POSTGRES_URL,timeout:30000,
},async()=>{
  const url=new URL(process.env.TEST_POSTGRES_URL!);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));assert.equal(url.search,'');
  const schema='test_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:url.href,max:1});let db:Database|undefined;
  try{
    await admin.query(`create schema ${schema}`);db=pooledDatabase(new pg.Pool({connectionString:url.href,max:4,options:`-c search_path=${schema}`,statement_timeout:10000}));
    for(const file of ['001_initial.sql','003_policy_notes.sql','004_itinerary.sql','005_live_search.sql','006_itinerary_sharing.sql','007_itinerary_editors.sql','008_itinerary_view_links.sql','009_itinerary_comments.sql','010_account_profiles.sql','011_trip_lifecycle.sql'])await db.execute(await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
    const core=new Core(db,false),owner=randomUUID(),editor=randomUUID(),tripId=(await core.callFromWeb('create_trip',{...flaineTrip,...key()},owner)).tripId;
    const invite=await core.callFromWeb('create_itinerary_invite',{...key(),tripId,label:'Editor',role:'editor'},owner);
    await core.callFromWeb('accept_itinerary_invite',{...key(),token:invite.token,displayName:'Friend'},editor);
    const review=await core.callFromWeb('prepare_trip_action',{...key(),tripId,action:'delete'},owner);
    let deleting!:()=>void,release!:()=>void,attempting!:()=>void;
    const atDelete=new Promise<void>(resolve=>deleting=resolve),mayCommit=new Promise<void>(resolve=>release=resolve),editorAttempt=new Promise<void>(resolve=>attempting=resolve);
    const deletingDb:Database={...db,transaction:(fn,options)=>db!.transaction(tx=>fn({...tx,query:async(sql,params)=>{
      const result=await tx.query(sql,params);if(sql==='delete from trips where id=$1'){deleting();await mayCommit;}return result as any;
    }}),options)};
    const editorDb:Database={...db,transaction:(fn,options)=>db!.transaction(tx=>fn({...tx,query:async(sql,params)=>{
      if(sql==='select * from trips where id=$1 for update')attempting();return tx.query(sql,params) as any;
    }}),options)};
    const deletion=new Core(deletingDb,false).callFromWeb('delete_trip',{...key(),tripId,expectedRevision:review.expectedRevision,confirmationToken:review.confirmationToken,confirmationName:review.trip.name,confirmed:true},owner);
    void deletion.catch(()=>deleting());await atDelete;
    const save={...key(),tripId,expectedRevision:1,item:{type:'note',title:'Late edit',startDate:null,startTime:null,endDate:null,endTime:null,timeZone:null,endTimeZone:null,location:'',url:null,notes:'',openQuestion:''}};
    const late=new Core(editorDb,false).callFromWeb('add_shared_itinerary_item',save,editor);void late.catch(()=>{});
    try{await editorAttempt;}finally{release();}
    assert.equal((await deletion).deleted,true);await assert.rejects(late,(e:any)=>e.code==='FORBIDDEN_OR_NOT_FOUND');
    await assert.rejects(core.callFromWeb('add_shared_itinerary_item',save,editor),(e:any)=>e.code==='FORBIDDEN_OR_NOT_FOUND');
    assert.equal((await db.query('select count(*)::int n from itinerary_items')).rows[0]!.n,0);
    assert.equal((await db.query('select count(*)::int n from trips')).rows[0]!.n,0);
  }finally{await db?.close();await admin.query(`drop schema if exists ${schema} cascade`);await admin.end();}
});
