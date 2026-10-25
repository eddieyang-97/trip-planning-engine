import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {pooledDatabase,type Database} from '../src/database.js';
import {Core} from '../src/core.js';
import {stayCriteria,stayObservation} from './fixtures/stays.js';
const key=()=>({idempotencyKey:randomUUID()});
const gate=()=>{let release!:()=>void;const promise=new Promise<void>(r=>release=r);return {release,promise};};

test('pooled PostgreSQL simultaneous stay commits serialize on the trip and persist one linked tentative item',{
  skip:!process.env.TEST_POSTGRES_URL,timeout:30000,
},async()=>{
  const url=new URL(process.env.TEST_POSTGRES_URL!);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));assert.equal(url.search,'');
  const schema='stay_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:url.href,max:1});let db:Database|undefined;
  try{
    await admin.query(`create schema ${schema}`);db=pooledDatabase(new pg.Pool({connectionString:url.href,max:4,options:`-c search_path=${schema}`,statement_timeout:10000}));
    for(const file of ['001_initial.sql','003_policy_notes.sql','004_itinerary.sql','005_live_search.sql','006_itinerary_sharing.sql','007_itinerary_editors.sql','008_itinerary_view_links.sql','009_itinerary_comments.sql','010_account_profiles.sql','011_trip_lifecycle.sql','012_decision_archive.sql','013_stay_comparison.sql'])await db.execute(await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
    const core=new Core(db,false),owner={userId:randomUUID(),clientId:'postgres-stay'};
    await db.query('insert into client_grants values($1,$2,$3,null)',[owner.userId,owner.clientId,['read','write']]);
    const tripId=(await core.call('create_trip',{...key(),name:'Fictional Zermatt PostgreSQL test',destination:'Fictional Zermatt',startDate:'2027-02-11',endDate:'2027-02-14',adults:10},owner)).tripId;
    const decisionId=(await core.call('create_stay_decision',{...key(),tripId,title:'Fictional concurrent stay',criteria:stayCriteria()},owner)).decisionId;
    const observed=await core.call('save_stay_candidate',{...key(),decisionId,expectedRevision:1,observation:stayObservation()},owner);
    const selected=await core.call('select_stay_candidate',{...key(),decisionId,expectedRevision:2,observationId:observed.observationId,rationale:'Controlled concurrent fixture'},owner);
    const inserted=gate(),release=gate(),attempted=gate(),underlying=db;
    const holdingDb:Database={...db,transaction:(fn,options)=>underlying.transaction(tx=>fn({...tx,query:async(sql,params)=>{
      const result=await tx.query(sql,params);if(sql.startsWith('insert into stay_itinerary_links')){inserted.release();await release.promise;}return result as any;
    }}),options)};
    const racingDb:Database={...db,transaction:(fn,options)=>underlying.transaction(tx=>fn({...tx,query:async(sql,params)=>{
      if(sql==='select * from trips where id=$1 for update')attempted.release();return tx.query(sql,params) as any;
    }}),options)};
    const args={...key(),decisionId,expectedRevision:3,expectedItineraryRevision:1,selectionId:selected.selectionId};
    const first=new Core(holdingDb,false).call('commit_stay_selection',args,owner);void first.catch(()=>inserted.release());await inserted.promise;
    const rival=new Core(racingDb,false).callFromWeb('commit_stay_selection',{...args,...key()},owner.userId);void rival.catch(()=>{});
    try{await attempted.promise;}finally{release.release();}
    const saved=await first;await assert.rejects(rival,(e:any)=>e.code==='REVISION_CONFLICT');
    const cached=await Promise.all([core.call('commit_stay_selection',args,owner),core.callFromWeb('commit_stay_selection',args,owner.userId)]);assert.deepEqual(cached[0],saved);assert.deepEqual(cached[1],saved);
    const plan=await core.call('get_itinerary',{tripId},owner);assert.equal(plan.revision,2);assert.equal(plan.items.length,1);assert.equal(plan.items[0].id,saved.itemId);assert.equal(plan.items[0].payload.status,'tentative');
    assert.equal(plan.items[0].sourceLink.selectionId,selected.selectionId);assert.equal(plan.items[0].sourceLink.observationId,observed.observationId);
    for(const table of ['stay_itinerary_links','itinerary_items','itinerary_events'])assert.equal((await db.query(`select count(*)::int n from ${table}`)).rows[0]!.n,1,table);
    assert.equal((await db.query("select count(*)::int n from mutation_requests where operation='commit_stay_selection'")).rows[0]!.n,1,'failed racing write rolls back its mutation cache');
    assert.equal((await db.query('select count(*)::int n from booking_records')).rows[0]!.n,0);assert.equal((await db.query('select count(*)::int n from search_runs')).rows[0]!.n,0);
    const other=(await core.call('create_trip',{...key(),name:'Other fictional trip',destination:'Elsewhere',startDate:'2027-02-11',endDate:'2027-02-14',adults:10},owner)).tripId;
    await assert.rejects(db.query('update stay_itinerary_links set trip_id=$2 where selection_id=$1',[selected.selectionId,other]),(e:any)=>e.code==='23503','database rejects cross-trip linkage');
  }finally{await db?.close();await admin.query(`drop schema if exists ${schema} cascade`);await admin.end();}
});
