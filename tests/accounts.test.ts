import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { accountRoutes, supabaseAccounts, type AccountProvider } from '../src/accounts.js';
import { createApp } from '../src/app.js';
import { Core } from '../src/core.js';
import { embedded, migrate } from '../src/database.js';
import { flaineTrip } from '../src/acceptance.js';
import { DomainError } from '../src/domain.js';

test('account management accepts only verified direct sessions, never assistant tokens', async () => {
  const {publicKey,privateKey}=await generateKeyPair('ES256'),jwk=await exportJWK(publicKey);jwk.kid='account';
  const userId=randomUUID(),issuer='https://auth.example/auth/v1';let calls=0;
  const provider=supabaseAccounts(issuer,'sb_publishable_test',createLocalJWKSet({keys:[jwk]}),async()=>{calls++;return Response.json({id:userId,email:'test@example.com',email_confirmed_at:'2026-10-09T00:00:00Z'});});
  const make=(claims:Record<string,unknown>={})=>new SignJWT({sub:userId,iss:issuer,aud:'authenticated',role:'authenticated',session_id:randomUUID(),iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+60,...claims}).setProtectedHeader({alg:'ES256',kid:'account'}).sign(privateKey);
  assert.equal((await provider.authenticate(`Bearer ${await make()}`)).userId,userId);
  assert.equal((await provider.authenticate(`Bearer ${await make({amr:[{method:'passkey',timestamp:Math.floor(Date.now()/1000)}]})}`)).userId,userId);
  assert.equal(calls,2);
  for(const claims of [{client_id:randomUUID()},{aud:'https://travel.example/mcp'},{role:'service_role'},{is_anonymous:true},{session_id:undefined},{iss:'https://other.example'},{exp:1}])await assert.rejects(provider.authenticate(`Bearer ${await make(claims)}`));
  assert.equal(calls,2,'invalid tokens must not reach the identity provider');
});

test('consent binds account, client and permissions; denial/revocation/reconnection fail closed',async()=>{
  const db=await embedded(),http=createServer(),owner=randomUUID(),other=randomUUID(),client=randomUUID();
  let denyProvider=false,approvalCalls=0,invalidRedirect=false,wrongIdentity=false;
  const provider:AccountProvider={authenticate:async h=>{if(h!=='Bearer owner'&&h!=='Bearer other')throw Error('no');return {userId:h==='Bearer owner'?owner:other,email:'test@example.com',token:h};},request:async(identity,path,method,body:any)=>{
    if(denyProvider)throw Error('provider down');
    if(method==='DELETE')return {};
    if(path.endsWith('/consent')){approvalCalls++;return {redirect_url:invalidRedirect?'https://wrong.example/callback':`https://client.example/callback?${body.action==='approve'?'code=secret':'error=access_denied'}&state=xyz`};}
    return {authorization_id:'auth-test',user:{id:wrongIdentity?other:identity.userId},client:{id:client,name:'Test assistant'},redirect_uri:'https://client.example/callback',scope:'openid email'};
  }};
  try{
    await migrate(db);await migrate(db);
    await db.query('insert into oauth_resource values(true,$1)',['https://travel.example/mcp']);
    await new Promise<void>(r=>http.listen(0,'127.0.0.1',r));const address=http.address();assert.ok(address&&typeof address!=='string');const origin=`http://127.0.0.1:${address.port}`;
    const core=new Core(db,false);
    http.on('request',createApp({core,authenticate:async()=>{throw Error('no MCP token');},publicOrigin:origin,accounts:accountRoutes({db,provider,origin,issuer:'https://auth.example/auth/v1',publishableKey:'sb_publishable_test'})}));
    const post=(path:string,body:unknown,who='owner',from=origin)=>fetch(`${origin}/account/api/${path}`,{method:'POST',headers:{authorization:`Bearer ${who}`,origin:from,'content-type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await fetch(`${origin}/account/api/connections`)).status,401);
    assert.equal((await post('authorization',{authorization_id:'auth-test'},'owner','https://evil.example')).status,403);
    const page=await fetch(`${origin}/account`);assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy')!,/frame-ancestors 'none'/);
    const pending=await (await post('authorization',{authorization_id:'auth-test'})).json();
    assert.equal((await post('consent',{requestId:pending.requestId,action:'approve',permissions:['read'],clientId:randomUUID()})).status,400);
    assert.equal((await post('consent',{requestId:pending.requestId,action:'approve',permissions:['read']},'other')).status,409);
    assert.equal(approvalCalls,0);
    assert.equal((await post('consent',{requestId:pending.requestId,action:'deny'})).status,200);
    assert.equal((await db.query('select * from client_grants')).rows.length,0);
    wrongIdentity=true;
    assert.equal((await post('authorization',{authorization_id:'auth-test'})).status,502);
    wrongIdentity=false;
    const expiring=await (await post('authorization',{authorization_id:'auth-test'})).json();
    await db.query("update oauth_consent_requests set expires_at=now()-interval '1 second' where id=$1",[expiring.requestId]);
    const beforeExpiry=approvalCalls;
    assert.equal((await post('consent',{requestId:expiring.requestId,action:'approve',permissions:['read']})).status,409);
    assert.equal(approvalCalls,beforeExpiry,'expired requests never reach the provider');
    const failed=await (await post('authorization',{authorization_id:'auth-test'})).json();
    denyProvider=true;
    assert.equal((await post('consent',{requestId:failed.requestId,action:'approve',permissions:['read']})).status,502);
    denyProvider=false;invalidRedirect=true;
    assert.equal((await post('consent',{requestId:failed.requestId,action:'approve',permissions:['read']})).status,502);
    invalidRedirect=false;
    assert.equal((await db.query('select * from client_grants')).rows.length,0,'failed approval cannot create permissions');
    assert.equal((await post('consent',{requestId:failed.requestId,action:'approve',permissions:['read','search']})).status,400);
    const beforeSearch=approvalCalls;
    assert.equal((await post('consent',{requestId:failed.requestId,action:'approve',permissions:['read','write','search']})).status,400);
    assert.equal(approvalCalls,beforeSearch,'disabled search cannot approve upstream or create a grant');
    assert.equal((await (await fetch(`${origin}/account/config`)).json()).liveSearch,false);
    assert.equal((await (await fetch(`${origin}/account/config`)).json()).passkeys,false);
    const approve=async()=>{const p=await (await post('authorization',{authorization_id:'auth-test'})).json();const r=await post('consent',{requestId:p.requestId,action:'approve',permissions:['read']});assert.equal(r.status,200);return p;};
    const approved=await approve();assert.equal((await post('consent',{requestId:approved.requestId,action:'approve',permissions:['read']})).status,409);
    const hook=async(user=owner)=> (await db.query(`select travel_access_token_hook($1::jsonb) as result`,[JSON.stringify({user_id:user,client_id:client,claims:{sub:user,client_id:client,aud:'authenticated',role:'authenticated'}})])).rows[0]!.result.claims;
    const claims=await hook();assert.equal(claims.aud,'https://travel.example/mcp');assert.ok(claims.travel_grant_version);
    assert.equal((await hook(other)).aud,'authenticated');
    const actor={userId:owner,clientId:client,grantVersion:claims.travel_grant_version};
    await core.call('list_trips',{},actor);
    await assert.rejects(core.call('create_trip',{idempotencyKey:randomUUID(),...flaineTrip},actor),e=>e instanceof DomainError&&e.code==='FORBIDDEN_OR_NOT_FOUND');
    assert.equal((await post('revoke',{clientId:client},'other')).status,404);
    denyProvider=true;const revoked=await(await post('revoke',{clientId:client})).json();assert.deepEqual(revoked.revoked,true);assert.equal(revoked.providerRevoked,false);
    await assert.rejects(core.call('list_trips',{},actor));assert.equal((await hook()).travel_grant_version,undefined);
    denyProvider=false;await approve();await assert.rejects(core.call('list_trips',{},actor),'old token stays invalid after reconnection');
    await core.call('list_trips',{},{...actor,grantVersion:(await hook()).travel_grant_version});
    const browser=(await db.query(`select travel_access_token_hook($1::jsonb) as result`,[JSON.stringify({claims:{sub:owner,aud:'authenticated'}})])).rows[0]!.result.claims;assert.equal(browser.aud,'authenticated');
  }finally{await new Promise<void>(r=>http.close(()=>r()));await db.close();}
});

test('enabled live search requires separate consent and write access; reconnect rotates the grant',async()=>{
  const db=await embedded(),http=createServer(),owner=randomUUID(),client=randomUUID();let approvals=0;
  const provider:AccountProvider={authenticate:async()=>({userId:owner,email:'test@example.com',token:'direct'}),request:async(_identity,path)=>{
    if(path.endsWith('/consent')){approvals++;return {redirect_url:'https://client.example/callback?code=test'};}
    return {authorization_id:'live-test',user:{id:owner},client:{id:client,name:'Live assistant'},redirect_uri:'https://client.example/callback',scope:'openid'};
  }};
  try{
    await migrate(db);await db.query('insert into oauth_resource values(true,$1)',['https://travel.example/mcp']);
    await new Promise<void>(r=>http.listen(0,'127.0.0.1',r));const address=http.address();assert.ok(address&&typeof address!=='string');const origin=`http://127.0.0.1:${address.port}`;
    const core=new Core(db,false,true);
    http.on('request',createApp({core,authenticate:async()=>{throw Error('no');},publicOrigin:origin,accounts:accountRoutes({db,provider,origin,issuer:'https://auth.example/auth/v1',publishableKey:'sb_publishable_test',liveSearch:true})}));
    const post=(path:string,body:unknown)=>fetch(`${origin}/account/api/${path}`,{method:'POST',headers:{authorization:'Bearer direct',origin,'content-type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await(await fetch(`${origin}/account/config`)).json()).liveSearch,true);
    const pending=await(await post('authorization',{authorization_id:'live-test'})).json();
    assert.equal((await post('consent',{requestId:pending.requestId,action:'approve',permissions:['read','search']})).status,400);assert.equal(approvals,0);
    assert.equal((await post('consent',{requestId:pending.requestId,action:'approve',permissions:['read','write']})).status,200);
    const before=(await db.query('select * from oauth_connections')).rows[0]!;
    assert.deepEqual((await db.query('select permissions from client_grants')).rows[0]!.permissions,['read','write'],'writes do not imply search');
    const next=await(await post('authorization',{authorization_id:'live-test'})).json();
    assert.equal((await post('consent',{requestId:next.requestId,action:'approve',permissions:['read','write','search']})).status,200);
    assert.deepEqual((await db.query('select permissions from client_grants')).rows[0]!.permissions,['read','write','search']);
    const after=(await db.query('select * from oauth_connections')).rows[0]!;assert.notEqual(after.grant_version,before.grant_version);
    await assert.rejects(core.call('list_trips',{},{userId:owner,clientId:client,grantVersion:before.grant_version}));
    await core.call('list_trips',{},{userId:owner,clientId:client,grantVersion:after.grant_version});
  }finally{await new Promise<void>(r=>http.close(()=>r()));await db.close();}
});
