import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {pooledDatabase,type Database} from '../src/database.js';
import {Core} from '../src/core.js';
import {flaineCriteria,flaineTrip} from '../src/acceptance.js';

test('pooled PostgreSQL serializes live admission across different owners and connections',{
  skip:!process.env.TEST_POSTGRES_URL,timeout:30000,
},async()=>{
  const url=new URL(process.env.TEST_POSTGRES_URL!);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));assert.equal(url.search,'');
  const schema='test_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:url.href,max:1});
  let db:Database|undefined;
  try {
    await admin.query(`create schema ${schema}`);
    db=pooledDatabase(new pg.Pool({connectionString:url.href,max:8,options:`-c search_path=${schema}`,statement_timeout:10000}));
    // Admission uses these real migrations; do not install the public OAuth hook in test DBs.
    for(const file of ['001_initial.sql','005_live_search.sql'])await db.execute(await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
    const core=new Core(db,false,true),requests=[];
    for(let n=0;n<6;n++) {
      const actor={userId:randomUUID(),clientId:'pilot'};
      await db.query('insert into client_grants values($1,$2,$3,null)',[actor.userId,actor.clientId,['read','write','search']]);
      const trip=await core.call('create_trip',{...flaineTrip,idempotencyKey:randomUUID()},actor);
      const decision=await core.call('create_decision',{tripId:trip.tripId,title:'Flights',criteria:flaineCriteria,idempotencyKey:randomUUID()},actor);
      requests.push({actor,args:{decisionId:decision.decisionId,expectedRevision:1,criteriaVersion:1,provider:'live',idempotencyKey:randomUUID()}});
    }
    const results=await Promise.allSettled(requests.map(r=>core.call('start_search',r.args,r.actor)));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,4);
    for(const r of results)if(r.status==='rejected')assert.equal(r.reason.code,'BUDGET_EXCEEDED');
    assert.equal((await db.query('select sum(reserved_requests)::int as n from search_runs')).rows[0]!.n,12);
    const i=results.findIndex(r=>r.status==='fulfilled'),first=results[i];
    const retried=await core.call('start_search',requests[i]!.args,requests[i]!.actor);
    assert.equal(retried.runId,first?.status==='fulfilled'?first.value.runId:null);
    assert.equal((await db.query('select count(*)::int as n from search_runs')).rows[0]!.n,4);
  }finally {
    await db?.close();await admin.query(`drop schema if exists ${schema} cascade`);await admin.end();
  }
});
