import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {pooledDatabase,type Database} from '../src/database.js';
import {Core} from '../src/core.js';
import {flaineCriteria,flaineTrip} from '../src/acceptance.js';
import {FixtureProvider} from '../src/providers.js';
const key=()=>({idempotencyKey:randomUUID()});
const gate=()=>{let release!:()=>void;const promise=new Promise<void>(r=>release=r);return {release,promise};};
// Real independent PostgreSQL connections, confined to a disposable loopback schema.
test('PostgreSQL decision transitions serialize retries, opposite actions and both booking/archive orders',{
  skip:!process.env.TEST_POSTGRES_URL,timeout:30000,
},async()=>{
  const url=new URL(process.env.TEST_POSTGRES_URL!);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));assert.equal(url.search,'');
  const schema='archive_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:url.href,max:1});let db:Database|undefined;
  try{
    await admin.query(`create schema ${schema}`);db=pooledDatabase(new pg.Pool({connectionString:url.href,max:5,options:`-c search_path=${schema}`,statement_timeout:10000}));
    for(const file of ['001_initial.sql','003_policy_notes.sql','004_itinerary.sql','005_live_search.sql','006_itinerary_sharing.sql','007_itinerary_editors.sql','008_itinerary_view_links.sql','009_itinerary_comments.sql','010_account_profiles.sql','011_trip_lifecycle.sql','012_decision_archive.sql','013_stay_comparison.sql'])await db.execute(await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
    const core=new Core(db,false),owner={userId:randomUUID(),clientId:'postgres-archive'};
    await db.query('insert into client_grants values($1,$2,$3,null)',[owner.userId,owner.clientId,['read','write']]);
    const tripId=(await core.call('create_trip',{...flaineTrip,...key()},owner)).tripId;
    const newDecision=async(title:string)=>(await core.call('create_decision',{...key(),tripId,title,criteria:flaineCriteria},owner)).decisionId;
    const decisionId=await newDecision('Retries');
    const args={...key(),decisionId,expectedRevision:1};
    const duplicated=await Promise.all([core.call('archive_decision',args,owner),core.callFromWeb('archive_decision',args,owner.userId)]);assert.deepEqual(duplicated[0],duplicated[1]);
    assert.equal((await db.query('select count(*)::int n from decision_lifecycle_events')).rows[0]!.n,1);
    const restore={...key(),decisionId,expectedRevision:2};await core.call('restore_decision',restore,owner);
    const transitions=await Promise.allSettled([core.call('archive_decision',{...key(),decisionId,expectedRevision:3},owner),core.call('restore_decision',{...key(),decisionId,expectedRevision:3},owner)]);
    assert.equal(transitions.filter(r=>r.status==='fulfilled').length,1);for(const r of transitions)if(r.status==='rejected')assert.equal(r.reason.code,'REVISION_CONFLICT');
    await assert.rejects(core.call('restore_decision',restore,owner),(e:any)=>e.code==='REVISION_CONFLICT');
    assert.deepEqual((await db.query('select revision,action from decision_lifecycle_events where decision_id=$1 order by revision',[decisionId])).rows,[{revision:2,action:'archive'},{revision:3,action:'restore'},{revision:4,action:'archive'}]);
    const underlying=db;
    for(const bookingFirst of [false,true]){
      const id=await newDecision(bookingFirst?'Booking first':'Archive first'),offer=(await new FixtureProvider().search(flaineCriteria)).offers[2]!;
      const saved=await core.call('save_candidate',{...key(),decisionId:id,expectedRevision:1,offer},owner);
      const selected=await core.call('select_candidate',{...key(),decisionId:id,expectedRevision:2,observationId:saved.observationId,rationale:'Fictional conditional choice',acknowledgeConditional:true},owner);
      const entered=gate(),mayCommit=gate(),waiting=gate();
      const held:Database={...db,transaction:(fn,options)=>underlying.transaction(tx=>fn({...tx,query:async(sql,params)=>{
        const result=await tx.query(sql,params);if(bookingFirst?sql.startsWith('insert into booking_records'):sql.startsWith('update decisions set archived_at')){entered.release();await mayCommit.promise;}return result as any;
      }}),options)};
      const contender:Database={...db,transaction:(fn,options)=>underlying.transaction(tx=>fn({...tx,query:async(sql,params)=>{
        if(sql==='select * from trips where id=$1 for update')waiting.release();return tx.query(sql,params) as any;
      }}),options)};
      const book=(c:Core)=>c.call('record_booking',{...key(),decisionId:id,expectedRevision:3,selectionId:selected.selectionId,bookedAt:'2026-01-01T00:00:00Z',note:'Fictional external booking report'},owner);
      const archive=(c:Core)=>c.call('archive_decision',{...key(),decisionId:id,expectedRevision:bookingFirst?4:3},owner);
      const first=bookingFirst?book(new Core(held,false)):archive(new Core(held,false));void first.catch(()=>entered.release());await entered.promise;
      const second=bookingFirst?archive(new Core(contender,false)):book(new Core(contender,false));void second.catch(()=>{});
      try{await waiting.promise;}finally{mayCommit.release();}
      await first;await assert.rejects(second,(e:any)=>e.code===(bookingFirst?'BOOKING_LINKED':'REVISION_CONFLICT'));
      const row:Record<string,any>=(await db.query('select archived_at,revision from decisions where id=$1',[id])).rows[0]!;assert.equal(!!row.archived_at,!bookingFirst);assert.equal(row.revision,4);
      assert.equal((await db.query('select count(*)::int n from booking_records where selection_id=$1',[selected.selectionId])).rows[0]!.n,bookingFirst?1:0);
      assert.equal((await db.query('select count(*)::int n from decision_lifecycle_events where decision_id=$1',[id])).rows[0]!.n,bookingFirst?0:1);
    }
  }finally{await db?.close();await admin.query(`drop schema if exists ${schema} cascade`);await admin.end();}
});
