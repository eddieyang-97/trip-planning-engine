import assert from 'node:assert/strict';
import {appendFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {schemaVersion} from '../src/database.js';
import {smokeRelease} from './smoke-release.js';

export const productionOrigin='https://trip-planning-engine.onrender.com';
const paths=['/health','/mcp','/account','/itinerary/config'] as const;
const shaPattern=/^[a-f0-9]{40}$/;
const deadlineMs=5*60_000;

class TemporaryHttpFailure extends Error {}

export type SmokeOutcome={
  ok:boolean;
  expectedSha:string;
  observedSha:string|null;
  expectedSchema:number;
  observedSchema:number|null;
  attempts:number;
  statuses:Record<string,number>;
  reason:'passed'|'sha_mismatch'|'schema_mismatch'|'health_not_ready'|'contract_failed'|'temporarily_unavailable';
};

export async function verifyPostDeploy(expectedSha:string, options:{
  send?:typeof fetch;
  wait?:(ms:number)=>Promise<void>;
  maxAttempts?:number;
  retryDelayMs?:number;
}={}):Promise<SmokeOutcome>{
  assert.match(expectedSha,shaPattern,'Expected release must be a full lowercase 40-character Git SHA');
  const {send=fetch,wait=ms=>delay(ms),maxAttempts=3,retryDelayMs=15_000}=options;
  assert.ok(Number.isInteger(maxAttempts)&&maxAttempts>=1&&maxAttempts<=3);
  assert.ok(Number.isInteger(retryDelayMs)&&retryDelayMs>=0&&retryDelayMs<=30_000);
  const end=Date.now()+deadlineMs;
  let observedSha:string|null=null,observedSchema:number|null=null;
  const statuses:Record<string,number>={};
  let reason:SmokeOutcome['reason']='temporarily_unavailable';
  let attempts=0;
  for(let attempt=1;attempt<=maxAttempts;attempt++){
    attempts=attempt;
    const monitoredSend:typeof fetch=async(input,init)=>{
      const url=new URL(input instanceof Request?input.url:String(input));
      if(url.origin!==productionOrigin||!paths.includes(url.pathname as typeof paths[number]))
        throw new Error('Unapproved smoke destination');
      const remaining=end-Date.now();
      if(remaining<=0)throw new TemporaryHttpFailure('Deadline expired');
      const signal=AbortSignal.any([
        ...(init?.signal?[init.signal]:[]),
        AbortSignal.timeout(Math.min(60_000,remaining)),
      ]);
      const response=await send(input,{...init,signal});
      statuses[url.pathname]=response.status;
      if(url.pathname==='/health'&&response.status===200){
        // Capture only explicitly public, validated release metadata for the Actions summary.
        const info=await response.clone().json().catch(()=>null) as
          {deployment?:{commit?:unknown;schemaVersion?:unknown}}|null;
        const commit=info?.deployment?.commit,version=info?.deployment?.schemaVersion;
        observedSha=typeof commit==='string'&&shaPattern.test(commit)?commit:null;
        observedSchema=typeof version==='number'&&Number.isInteger(version)?version:null;
      }
      if(response.status>=500&&response.status<=599)throw new TemporaryHttpFailure('Temporary server error');
      return response;
    };
    try{
      await smokeRelease(productionOrigin,expectedSha,monitoredSend);
      return {ok:true,expectedSha,observedSha,expectedSchema:schemaVersion,
        observedSchema,attempts,statuses,reason:'passed'};
    }catch(error){
      const retryable=error instanceof TemporaryHttpFailure||
        error instanceof TypeError||
        (error instanceof Error&&['TimeoutError','AbortError'].includes(error.name));
      if(!retryable){
        reason=error instanceof assert.AssertionError&&error.message.includes('Running commit')
          ?'sha_mismatch'
          :error instanceof assert.AssertionError&&error.message.includes('Schema readiness')
          ?'schema_mismatch'
          :error instanceof assert.AssertionError&&error.message.includes('Health not ready')
          ?'health_not_ready':'contract_failed';
        break;
      }
      reason='temporarily_unavailable';
      if(attempt===maxAttempts||Date.now()+retryDelayMs>=end)break;
      await wait(retryDelayMs);
    }
  }
  return {ok:false,expectedSha,observedSha,expectedSchema:schemaVersion,
    observedSchema,attempts,statuses,reason};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const expectedSha=process.argv[2]??'';
    const result=await verifyPostDeploy(expectedSha);
    const status=result.ok?'PASS':'FAIL';
    const summary=[
      '## Production release smoke — '+status,
      '',
      '| Check | Observed |',
      '| --- | --- |',
      '| Expected commit | `'+result.expectedSha+'` |',
      '| Served commit | `'+(result.observedSha??'not observed')+'` |',
      '| Schema | '+(result.observedSchema??'not observed')+' (expected '+result.expectedSchema+') |',
      '| Endpoint statuses | '+paths.map(p=>p+': '+(result.statuses[p]??'not checked')).join('; ')+' |',
      '| Attempts | '+result.attempts+' |',
      '| Result | '+result.reason+' |',
      '',
      'This is an unauthenticated, public GET-only smoke test; it does not verify user sessions, supplier data or bookings.',
    ].join('\n')+'\n';
    if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,summary);
    console.log(JSON.stringify(result));
    if(!result.ok)process.exitCode=1;
  }catch{
    // Do not print arbitrary error bodies, caller-controlled strings or secrets.
    console.error('Production smoke could not run: supply a valid 40-character release SHA and inspect the workflow configuration.');
    process.exitCode=1;
  }
}
