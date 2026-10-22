import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {auth,type OAuthClientProvider} from '@modelcontextprotocol/sdk/client/auth.js';
import type {OAuthClientInformationMixed,OAuthTokens} from '@modelcontextprotocol/sdk/shared/auth.js';
import {hostedAuthentication} from '../src/auth.js';
import {flaineCriteria,flaineTrip} from '../src/acceptance.js';

// One interactive official-SDK acceptance session. No passwords, tokens or PKCE verifier are saved.
const serverUrl='https://trip-planning-engine.onrender.com/mcp';
const issuer='https://boesckxmbghiobxpyuqc.supabase.co/auth/v1';
const redirectUrl='http://127.0.0.1:8732/callback';
const live=process.argv.includes('--live');
const metadataOnly=process.argv.includes('--metadata-only');
assert.ok(!(live&&metadataOnly),'--metadata-only cannot be combined with --live');
let phase='setup',information:OAuthClientInformationMixed|undefined,tokens:OAuthTokens|undefined,verifier='';
const state=randomBytes(32).toString('base64url');
let acceptCode!:(code:string)=>void,rejectCode!:(error:Error)=>void;
const callback=new Promise<string>((resolve,reject)=>{acceptCode=resolve;rejectCode=reject;});
// Attach a handler before discovery: a denied callback must not become an unhandled rejection.
void callback.catch(()=>undefined);
let consumed=false;
const http=createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  if(req.headers.host!=='127.0.0.1:8732'||req.method!=='GET'){res.writeHead(400).end();return;}
  const url=new URL(req.url??'/',redirectUrl);
  if(url.pathname==='/done'){res.writeHead(200,{'Content-Type':'text/plain'}).end('Authorization received. Return to Codex for the acceptance result.');return;}
  if(url.pathname!=='/callback'||consumed||url.searchParams.get('state')!==state){res.writeHead(400).end('Invalid authorization callback.');return;}
  const code=url.searchParams.get('code');
  consumed=true;
  if(code&&!url.searchParams.has('error'))acceptCode(code);else rejectCode(Error('Authorization denied'));
  // Remove the code from the visible URL before the browser is inspected.
  res.writeHead(303,{Location:'/done'}).end();
});
const provider:OAuthClientProvider={
  redirectUrl,
  clientMetadata:{client_name:'Travel hosted acceptance',redirect_uris:[redirectUrl],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none',scope:'openid'},
  state:()=>state,clientInformation:()=>information,
  saveClientInformation:value=>{assert.equal(value.issuer,issuer);information=value;},
  tokens:()=>tokens,saveTokens:value=>{assert.equal(value.issuer,issuer);tokens=value;},
  saveCodeVerifier:value=>{verifier=value;},codeVerifier:()=>verifier,
  redirectToAuthorization:url=>{
    assert.equal(url.origin,new URL(issuer).origin);assert.equal(url.pathname,'/auth/v1/oauth/authorize');
    assert.equal(url.searchParams.get('code_challenge_method'),'S256');
    console.log(`Open this authorization URL in Chrome:\n${url.href}`);
    console.log(live?'Approve read, write and the separate search option to run the bounded Flaine acceptance.':'Approve read access only. This mode makes no trip changes or provider searches.');
  },
};
const boundedFetch:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  assert.ok([new URL(serverUrl).origin,new URL(issuer).origin].includes(url.origin));
  const response=await fetch(input,{...init,redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(60_000),...(init?.signal?[init.signal]:[])])});
  if(!response.ok)console.error(JSON.stringify({phase,path:url.pathname,status:response.status}));
  return response;
};
const client=new Client({name:'travel-hosted-acceptance',version:'0.1.0'});
let timeout:ReturnType<typeof setTimeout>|undefined;
try{
  await new Promise<void>((resolve,reject)=>{http.once('error',reject);http.listen(8732,'127.0.0.1',resolve);});
  timeout=setTimeout(()=>rejectCode(Error('Authorization timeout')),10*60_000);
  phase='OAuth discovery and registration';
  assert.equal(await auth(provider,{serverUrl,scope:'openid',fetchFn:boundedFetch}),'REDIRECT');
  phase='user consent';const code=await callback;clearTimeout(timeout);
  phase='PKCE token exchange';assert.equal(await auth(provider,{serverUrl,authorizationCode:code,fetchFn:boundedFetch}),'AUTHORIZED');
  assert.ok(tokens&&information);
  phase='token verification';const actor=await hostedAuthentication(issuer,serverUrl)(`Bearer ${tokens.access_token}`);
  assert.equal(actor.clientId,information.client_id);
  console.log(JSON.stringify({oauth:'verified',issuer,audience:serverUrl,clientId:actor.clientId,grantVersionPresent:!!actor.grantVersion}));
  phase='MCP connection';
  await client.connect(new StreamableHTTPClientTransport(new URL(serverUrl),{fetch:boundedFetch,requestInit:{headers:{Authorization:`Bearer ${tokens.access_token}`}},reconnectionOptions:{maxRetries:0,maxReconnectionDelay:1000,initialReconnectionDelay:1000,reconnectionDelayGrowFactor:1}}));
  const call=async(name:string,args:Record<string,unknown>)=>{
    const result=await client.callTool({name,arguments:args});
    assert.ok(!result.isError,`Tool failed: ${name}`);assert.ok(result.structuredContent);
    return result.structuredContent as Record<string,any>;
  };
  phase='flight tool discovery';
  const tools=await client.listTools();
  for(const name of ['create_decision','update_decision_criteria']){
    const criteria=tools.tools.find(t=>t.name===name)?.inputSchema.properties?.criteria as any;
    assert.ok(criteria?.properties?.inbound?.anyOf?.some((v:any)=>v.type==='null'));
    assert.ok(criteria.properties.inbound.anyOf.some((v:any)=>v.type==='string'&&v.format==='date'));
    assert.ok(!criteria.required.includes('inbound'));
  }
  const searchDescription=tools.tools.find(t=>t.name==='start_search')?.description??'';
  assert.match(searchDescription,/1–6 origins/);assert.doesNotMatch(searchDescription,/Flaine|easyJet|18–20 Dec/);
  assert.match(tools.tools.find(t=>t.name==='get_decision')?.description??'',/saved rationale/);
  // Metadata diagnosis needs discovery only, without enumerating private trips.
  if(!metadataOnly)await call('list_trips',{});
  console.log(JSON.stringify({mcp:'connected',toolCount:tools.tools.length,flightMetadata:'current',
    clientCacheVerified:false,tripReadPerformed:!metadataOnly}));
  if(live){
    phase='Flaine trip and decision';
    const trip=await call('create_trip',{...flaineTrip,name:'Flaine snowboard weekend — hosted acceptance',idempotencyKey:'744ac34b-4a3f-49a9-aac4-4b4c6899dc11'});
    const decision=await call('create_decision',{tripId:trip.tripId,title:'Flaine flights — hosted acceptance',criteria:flaineCriteria,idempotencyKey:'68d1ec43-2df1-484f-9ec6-f10b0bfad0bc'});
    phase='bounded live admission';
    const input={decisionId:decision.decisionId,expectedRevision:1,criteriaVersion:1,provider:'live',idempotencyKey:'a5ba1ee3-3a25-49da-a8ae-4db78a8a8350'};
    const queued=await call('start_search',input);console.log(JSON.stringify({tripId:trip.tripId,decisionId:decision.decisionId,runId:queued.runId,status:queued.status}));
    // Identical retry must return the original run without another budget reservation.
    assert.equal((await call('start_search',input)).runId,queued.runId);
    phase='live run';let run=await call('get_search_run',{runId:queued.runId});const deadline=Date.now()+4*60_000;
    while(['queued','running'].includes(run.status)&&Date.now()<deadline){await delay(3000);run=await call('get_search_run',{runId:queued.runId});}
    console.log(JSON.stringify({runId:run.id,status:run.status,attempts:run.attempts.map((a:any)=>({attempt:a.attempt,stage:a.stage,status:a.status})),observations:run.observations.length,idempotentRetry:true}));
    assert.equal(run.status,'complete');assert.ok(run.attempts.length<=3);assert.ok(run.observations.length>0);
    for(const observation of run.observations){assert.equal(observation.provenance,'provider_reported');assert.equal(observation.payload.priceBasis,'unknown');assert.equal(observation.payload.exactPartyQuoted,false);}
    console.log('PASS: hosted live evidence persisted; price basis, snowboard costs and bookability remain unverified.');
  }
}catch{
  // SDK/provider errors can contain raw response bodies. Never print them.
  console.error(`Acceptance stopped during ${phase}. No supplier request is automatically retried.`);process.exitCode=1;
}finally{
  if(timeout)clearTimeout(timeout);await client.close().catch(()=>undefined);
  await new Promise<void>(resolve=>http.close(()=>resolve()));tokens=undefined;verifier='';
}
