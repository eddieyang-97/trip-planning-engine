import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {schemaVersion} from '../src/database.js';

// Public, read-only checks only. Authenticated acceptance is a separate authorized session.
export async function smokeRelease(origin:string,commit:string,send:typeof fetch=fetch) {
  const url=new URL(origin);
  assert.equal(url.origin,origin,'Use an HTTPS origin without a path');
  assert.equal(url.protocol,'https:');assert.match(commit,/^[a-f0-9]{40}$/);
  const get=(path:string)=>send(origin+path,{method:'GET',redirect:'error',signal:AbortSignal.timeout(60000)});
  const health=await get('/health');assert.equal(health.status,200,'Health not ready');
  const body=await health.json();assert.equal(body.status,'ok');
  assert.equal(body.deployment?.commit,commit,'Running commit does not match the release');
  assert.equal(body.deployment?.schemaVersion,schemaVersion,'Schema readiness version does not match');
  const mcp=await get('/mcp');assert.equal(mcp.status,401,'MCP must require authentication');
  const account=await get('/account');assert.equal(account.status,200,'Account page unavailable');
  const config=await get('/itinerary/config');assert.equal(config.status,200);
  assert.equal((await config.json()).mode,'hosted','Hosted web configuration required');
  return {commit,schemaVersion,health:200,mcpUnauthenticated:401,account:200,webMode:'hosted'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try {
    const [origin,commit]=process.argv.slice(2);assert.ok(origin&&commit,'Supply origin and full expected SHA');
    console.log(JSON.stringify(await smokeRelease(origin,commit)));
  }catch{
    // Never print remote bodies, credentials, request URLs or raw errors.
    console.error('Release smoke failed: verify health, expected SHA/schema, authentication and web readiness.');
    process.exitCode=1;
  }
}
