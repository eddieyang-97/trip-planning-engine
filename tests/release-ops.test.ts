import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {startSearchWorker} from '../src/search-worker.js';
import {deploymentCommit} from '../src/config.js';
import {createApp} from '../src/app.js';
import {Core,saveOffer} from '../src/core.js';
import {embedded,migrate,schemaVersion} from '../src/database.js';
import {runOneLiveJob} from '../src/live-search.js';
import {SerpApiFlightProvider} from '../src/live-provider.js';
import {flaineCriteria,flaineTrip} from '../src/acceptance.js';
import {smokeRelease} from '../scripts/smoke-release.js';

const sha='a'.repeat(40),key=()=>({idempotencyKey:randomUUID()});
function gate(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};}

test('shutdown drains a journaled provider attempt, does not claim queued work, and persists without replay',async()=>{
  const db=await embedded(),entered=gate(),release=gate();let requests=0;
  let worker:ReturnType<typeof startSearchWorker>|undefined;
  try{
    await migrate(db);const actor={userId:randomUUID(),clientId:'isolated-ops-test'},core=new Core(db,false,true);
    await db.query('insert into client_grants values($1,$2,$3,null)',[actor.userId,actor.clientId,['read','write','search']]);
    const trip=await core.call('create_trip',{...flaineTrip,...key()},actor);
    const d=await core.call('create_decision',{...key(),tripId:trip.tripId,title:'Fictional drain test',criteria:flaineCriteria},actor);
    const first=await core.call('start_search',{...key(),decisionId:d.decisionId,expectedRevision:1,criteriaVersion:1,provider:'live'},actor);
    const queued=await core.call('start_search',{...key(),decisionId:d.decisionId,expectedRevision:2,criteriaVersion:1,provider:'live'},actor);
    const provider=new SerpApiFlightProvider('fictional-key',async input=>{
      if(new URL(String(input)).pathname==='/account.json')return Response.json({account_status:'Active',plan_monthly_price:0,
        plan_searches_left:100,account_rate_limit_per_hour:100,this_hour_searches:0});
      requests++;
      assert.equal((await db.query('select status from provider_attempts where run_id=$1',[first.runId])).rows[0]!.status,'reserved');
      entered.resolve();await release.promise;
      // An empty result is a completed observation scope, not fabricated flight inventory.
      const url=new URL(String(input));return Response.json({search_metadata:{status:'Success'},search_parameters:Object.fromEntries(url.searchParams),best_flights:[]});
    });
    worker=startSearchWorker(async()=>{await runOneLiveJob(db,provider,saveOffer);},()=>assert.fail('worker failed'),5);
    await entered.promise;
    let drained=false;const stopped=worker.stop().then(()=>{drained=true;});
    await delay(25);assert.equal(drained,false);assert.equal(requests,1);
    release.resolve();await stopped;await worker.stop();await delay(25);
    const fresh=new Core(db,false,true);
    assert.equal((await fresh.call('get_search_run',{runId:first.runId},actor)).status,'complete');
    assert.equal((await fresh.call('get_search_run',{runId:queued.runId},actor)).status,'queued');
    assert.equal((await db.query('select count(*)::int as n from provider_attempts')).rows[0]!.n,1);
    assert.equal((await db.query('select count(*)::int as n from observations')).rows[0]!.n,0);
    assert.equal(requests,1,'stopped scheduler never claims another queued run');
  }finally{release.resolve();await worker?.stop();await db.close();}
});

test('worker serializes ticks, reports safe failures and stopping is idempotent',async()=>{
  const entered=gate(),release=gate(),reported=gate();let calls=0,errors=0;
  const worker=startSearchWorker(async()=>{calls++;entered.resolve();await release.promise;throw Error('private diagnostics');},()=>{errors++;reported.resolve();},5);
  try{await entered.promise;await delay(25);assert.equal(calls,1);const stopped=worker.stop();assert.equal(worker.stop(),stopped);
    release.resolve();await reported.promise;await stopped;await delay(15);assert.equal(calls,1);assert.equal(errors,1);
  }finally{release.resolve();await worker.stop();}
});

test('public health exposes only validated commit and ready schema metadata; DB errors remain private',async()=>{
  assert.equal(deploymentCommit({RENDER_GIT_COMMIT:sha.toUpperCase()}),sha);
  for(const value of [undefined,'short','token-secret','https://private.example',sha+'\n'])assert.equal(deploymentCommit({RENDER_GIT_COMMIT:value}),null);
  const db=await embedded(),http=createServer();let ready=true;
  try{
    await new Promise<void>(r=>http.listen(0,'127.0.0.1',r));const address=http.address();assert.ok(address&&typeof address!=='string');
    const origin=`http://127.0.0.1:${address.port}`;
    http.on('request',createApp({core:new Core(db,false),publicOrigin:origin,authenticate:async()=>{throw Error('Unauthorized');},
      deployment:{commit:sha,schemaVersion},ready:async()=>{if(!ready)throw Error('private DB detail');}}));
    const r=await fetch(origin+'/health');assert.equal(r.status,200);
    assert.deepEqual(await r.json(),{status:'ok',liveSearch:false,deployment:{commit:sha,schemaVersion}});
    ready=false;const failed=await fetch(origin+'/health');assert.equal(failed.status,503);
    assert.deepEqual(await failed.json(),{status:'unavailable',liveSearch:false});
  }finally{await new Promise<void>(r=>http.close(()=>r()));await db.close();}
});

test('release smoke fails closed on wrong SHA/schema, unhealthy DB, auth regression, redirects or local web mode',async()=>{
  for(const mode of ['ok','sha','schema','health','auth','redirect','local'] as const){
    const calls:{path:string;method:string|undefined;redirect:RequestRedirect|undefined}[]=[];
    const send:typeof fetch=async(input,init)=>{
      const path=new URL(String(input)).pathname;calls.push({path,method:init?.method,redirect:init?.redirect});
      if(path==='/health')return Response.json({status:'ok',deployment:{commit:mode==='sha'?'b'.repeat(40):sha,schemaVersion:mode==='schema'?0:schemaVersion}},{status:mode==='health'?503:200});
      if(path==='/mcp')return new Response(null,{status:mode==='auth'?200:mode==='redirect'?302:401});
      if(path==='/itinerary/config')return Response.json({mode:mode==='local'?'local':'hosted'});
      return new Response('Account',{status:200});
    };
    if(mode==='ok'){assert.equal((await smokeRelease('https://example.com',sha,send)).commit,sha);assert.equal(calls.length,4);}
    else await assert.rejects(smokeRelease('https://example.com',sha,send));
    assert.ok(calls.every(c=>c.method==='GET'&&c.redirect==='error'));
    assert.ok(calls.every(c=>['/health','/mcp','/account','/itinerary/config'].includes(c.path)));
  }
  await assert.rejects(smokeRelease('https://example.com/path',sha,async()=>assert.fail('must not send')));
  await assert.rejects(smokeRelease('http://example.com',sha,async()=>assert.fail('must not send')));
});
