import test from 'node:test';
import assert from 'node:assert/strict';
import {schemaVersion} from '../src/database.js';
import {verifyPostDeploy,productionOrigin} from '../scripts/post-deploy-smoke.js';

const sha='abcdef0123456789abcdef0123456789abcdef01';
const otherSha='fedcba9876543210fedcba9876543210fedcba98';

function fixture(overrides:{
  sha?:string;schema?:number;healthStatus?:number;
  mcpStatus?:number;accountStatus?:number;configStatus?:number;webMode?:string;
  failHealthOnce?:boolean;
}={}){
  const paths:string[]=[];
  let healthCalls=0;
  const send:typeof fetch=async(input,init)=>{
    assert.equal(init?.method,'GET');
    assert.equal(init?.redirect,'error');
    const url=new URL(input instanceof Request?input.url:String(input));
    assert.equal(url.origin,productionOrigin);
    paths.push(url.pathname);
    switch(url.pathname){
      case '/health': {
        healthCalls++;
        const status=overrides.failHealthOnce&&healthCalls===1?503:(overrides.healthStatus??200);
        return Response.json({status:status===200?'ok':'unavailable',
          deployment:{commit:overrides.sha??sha,schemaVersion:overrides.schema??schemaVersion}}, {status});
      }
      case '/mcp': return new Response('',{status:overrides.mcpStatus??401});
      case '/account': return new Response('account page',{status:overrides.accountStatus??200});
      case '/itinerary/config': return Response.json({mode:overrides.webMode??'hosted'},
        {status:overrides.configStatus??200});
      default:throw new Error('Unexpected request');
    }
  };
  return {send,paths};
}

test('manual smoke passes matching SHA/schema and four safe public GETs',async()=>{
  const f=fixture(),r=await verifyPostDeploy(sha,{send:f.send});
  assert.equal(r.ok,true);
  assert.equal(r.reason,'passed');
  assert.equal(r.expectedSchema,schemaVersion);
  assert.equal(r.observedSha,sha);
  assert.equal(r.observedSchema,schemaVersion);
  assert.equal(r.attempts,1);
  assert.deepEqual(f.paths,['/health','/mcp','/account','/itinerary/config']);
});

test('wrong live SHA fails without retry; observed commit is only a validated SHA',async()=>{
  const f=fixture({sha:otherSha});
  const r=await verifyPostDeploy(sha,{send:f.send,wait:async()=>{},retryDelayMs:0});
  assert.equal(r.ok,false);
  assert.equal(r.reason,'sha_mismatch');
  assert.equal(r.observedSha,otherSha);
  assert.deepEqual(f.paths,['/health']);
});

test('wrong schema fails without retry',async()=>{
  const f=fixture({schema:schemaVersion-1});
  const r=await verifyPostDeploy(sha,{send:f.send,wait:async()=>{},retryDelayMs:0});
  assert.equal(r.ok,false);
  assert.equal(r.reason,'schema_mismatch');
  assert.equal(r.observedSchema,schemaVersion-1);
  assert.equal(r.attempts,1);
});

test('temporary health 503 retries and then completes every check',async()=>{
  const f=fixture({failHealthOnce:true});
  const r=await verifyPostDeploy(sha,{send:f.send,wait:async()=>{},retryDelayMs:0});
  assert.equal(r.ok,true);
  assert.equal(r.attempts,2);
  assert.deepEqual(f.paths,['/health','/health','/mcp','/account','/itinerary/config']);
});

test('persistently unavailable production fails after bounded retries',async()=>{
  const f=fixture({healthStatus:503});
  const r=await verifyPostDeploy(sha,{send:f.send,wait:async()=>{},retryDelayMs:0});
  assert.equal(r.ok,false);
  assert.equal(r.reason,'temporarily_unavailable');
  assert.equal(r.attempts,3);
  assert.deepEqual(f.paths,['/health','/health','/health']);
});

test('unexpected MCP authentication response is a hard contract failure',async()=>{
  const f=fixture({mcpStatus:200});
  const r=await verifyPostDeploy(sha,{send:f.send,wait:async()=>{},retryDelayMs:0});
  assert.equal(r.ok,false);
  assert.equal(r.reason,'contract_failed');
  assert.equal(r.attempts,1);
  assert.equal(r.statuses['/mcp'],200);
});

test('non-hosted web mode fails without retry',async()=>{
  const f=fixture({webMode:'local'});
  const r=await verifyPostDeploy(sha,{send:f.send,wait:async()=>{},retryDelayMs:0});
  assert.equal(r.ok,false);
  assert.equal(r.reason,'contract_failed');
  assert.equal(r.attempts,1);
});

test('invalid expected SHA is rejected before any request',async()=>{
  const f=fixture();
  await assert.rejects(()=>verifyPostDeploy('main',{send:f.send}),/40-character/);
  assert.deepEqual(f.paths,[]);
});
