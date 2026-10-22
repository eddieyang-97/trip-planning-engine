import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { embedded, migrate, pooledDatabase, type Database } from '../src/database.js';
import { Core } from '../src/core.js';
import { flaineTrip } from '../src/acceptance.js';

test('core reads enter a read-only repeatable-read transaction; subsequent writes remain writable',async()=>{
  const db=await embedded();
  try{
    await migrate(db);const owner=randomUUID();let settings:any;
    const instrumented:Database={...db,transaction:(fn,options)=>db.transaction(async tx=>{
      settings=(await tx.query('select current_setting(\'transaction_isolation\') as isolation,current_setting(\'transaction_read_only\') as read_only')).rows[0];
      return fn(tx);
    },options)};
    const core=new Core(instrumented,false);
    await core.callFromWeb('list_trips',{},owner);
    assert.equal(settings.isolation,'repeatable read');assert.equal(settings.read_only,'on');
    await core.callFromWeb('create_trip',{...flaineTrip,idempotencyKey:randomUUID()},owner);
    assert.equal(settings.read_only,'off');
    await assert.rejects(db.transaction(tx=>tx.query('insert into trips(id,owner_id,payload) values($1,$2,$3)',[randomUUID(),owner,'{}']),{readOnly:true}));
  }finally{await db.close();}
});

// Opt-in integration test: never uses DATABASE_URL or a hosted/Supabase database.
// CI provisions a disposable local PostgreSQL service and sets TEST_POSTGRES_URL.
test('pooled PostgreSQL returns one itinerary snapshot across a controlled concurrent commit',{
  skip:!process.env.TEST_POSTGRES_URL,timeout:30000,
},async()=>{
  const url=new URL(process.env.TEST_POSTGRES_URL!);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname),'Only an explicitly configured loopback test database is allowed');
  assert.equal(url.search,'','Test URL must not inject connection options');
  const schema='test_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:url.href,max:1});
  let db:Database|undefined;
  try{
    await admin.query(`create schema ${schema}`);
    db=pooledDatabase(new pg.Pool({connectionString:url.href,max:3,options:`-c search_path=${schema}`,statement_timeout:10000}));
    // Only the actual migrations needed here. OAuth migration 002 explicitly targets public;
    // do not create or replace a public auth hook in a user-supplied test database.
    for(const file of ['001_initial.sql','003_policy_notes.sql','004_itinerary.sql','005_live_search.sql','006_itinerary_sharing.sql','007_itinerary_editors.sql','008_itinerary_view_links.sql','009_itinerary_comments.sql','010_account_profiles.sql','011_trip_lifecycle.sql','012_decision_archive.sql'])await db.execute(await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
    const core=new Core(db,false),owner=randomUUID();
    const trip=await core.callFromWeb('create_trip',{...flaineTrip,idempotencyKey:randomUUID()},owner);
    let sawRevision!:()=>void,releaseRead!:()=>void;
    const readStarted=new Promise<void>(resolve=>{sawRevision=resolve;}),readMayContinue=new Promise<void>(resolve=>{releaseRead=resolve;});
    let pause=true;
    const reader:Database={...db,transaction:(fn,options)=>db!.transaction(tx=>fn({...tx,query:async(sql,params)=>{
      const result=await tx.query(sql,params);
      if(pause&&sql.startsWith('select * from trips where')){pause=false;sawRevision();await readMayContinue;}
      return result as any;
    }}),options)};
    const pending=new Core(reader,false).callFromWeb('get_itinerary',{tripId:trip.tripId},owner);
    void pending.catch(()=>sawRevision());
    try{
      await readStarted;
      await core.callFromWeb('add_itinerary_item',{idempotencyKey:randomUUID(),tripId:trip.tripId,expectedRevision:1,item:{
        type:'note',title:'Concurrent new item',startDate:null,startTime:null,endDate:null,endTime:null,timeZone:null,endTimeZone:null,
        location:'',url:null,notes:'',openQuestion:'',status:'tentative',bookingNote:'',
      }},owner);
    }finally{releaseRead();}
    const before=await pending;assert.equal(before.revision,1);assert.equal(before.items.length,0);assert.equal(before.history.length,0);
    const after=await core.callFromWeb('get_itinerary',{tripId:trip.tripId},owner);
    assert.equal(after.revision,2);assert.equal(after.items.length,1);assert.equal(after.history.length,1);
  }finally{
    await db?.close();
    // schema is a fixed prefix plus locally generated UUID hex; never taken from an input URL.
    await admin.query(`drop schema if exists ${schema} cascade`);await admin.end();
  }
});
