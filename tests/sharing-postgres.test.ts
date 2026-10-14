import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {pooledDatabase,type Database} from '../src/database.js';
import {Core} from '../src/core.js';
import {flaineTrip} from '../src/acceptance.js';
import {DomainError} from '../src/domain.js';

test('pooled PostgreSQL serializes invitation claims and denies revoked membership on a new connection',{
  skip:!process.env.TEST_POSTGRES_URL,timeout:30000,
},async()=>{
  const url=new URL(process.env.TEST_POSTGRES_URL!);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));assert.equal(url.search,'');
  const schema='test_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:url.href,max:1});let db:Database|undefined;
  try{
    await admin.query(`create schema ${schema}`);
    db=pooledDatabase(new pg.Pool({connectionString:url.href,max:4,options:`-c search_path=${schema}`,statement_timeout:10000}));
    for(const file of ['001_initial.sql','004_itinerary.sql','006_itinerary_sharing.sql'])await db.execute(await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
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
  }finally{await db?.close();await admin.query(`drop schema if exists ${schema} cascade`);await admin.end();}
});
