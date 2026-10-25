import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import express from 'express';
import {createLocalJWKSet,exportJWK,generateKeyPair,SignJWT} from 'jose';
import {test,expect} from '@playwright/test';
import {embedded,migrate} from '../../dist/src/database.js';
import {Core} from '../../dist/src/core.js';
import {createApp} from '../../dist/src/app.js';
import {accountRoutes,supabaseAccounts} from '../../dist/src/accounts.js';
import {itineraryRoutes} from '../../dist/src/itinerary-web.js';

// Fake Supabase protocol only: real built frontend, SDK, virtual WebAuthn device,
// signed JWT validation, account/consent routes and isolated persisted trip/grants.
// This does not implement or certify Supabase's credential signature verification.
async function fixture(enabled=true){
  const db=await embedded(),http=createServer();await migrate(db);
  await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
  const origin=`http://localhost:${http.address().port}`,issuer=`${origin}/auth/v1`;
  const {publicKey,privateKey}=await generateKeyPair('ES256'),jwk=await exportJWK(publicKey);jwk.kid='fixture';
  const users=['owner','other','unconfirmed'].map(name=>({id:randomUUID(),email:`${name}@example.test`,
    email_confirmed_at:name==='unconfirmed'?null:'2026-10-25T00:00:00Z',aud:'authenticated',role:'authenticated',
    created_at:'2026-10-25T00:00:00Z',is_anonymous:false,app_metadata:{},user_metadata:{}}));
  const sessions=new Map(),keys=new Map(),challenges=new Map(),client=randomUUID();
  let refreshes=0,registrations=0,deletions=0,recoveries=0,passwordUpdates=0,registrationOptions=0,failOptions=null;
  let recovery;
  const issue=async(user,method='password')=>{
    const token=await new SignJWT({sub:user.id,role:'authenticated',session_id:randomUUID(),amr:[{method}]})
      .setProtectedHeader({alg:'ES256',kid:'fixture'}).setIssuer(issuer).setAudience('authenticated').setIssuedAt().setExpirationTime('1h').sign(privateKey);
    sessions.set(token,user);
    return {access_token:token,refresh_token:`fixture-${user.id}`,expires_in:3600,token_type:'bearer',user};
  };
  const auth=express.Router();auth.use(express.json());
  auth.use((req,res,next)=>{res.setHeader('X-Supabase-Api-Version','2024-01-01');next();});
  const current=req=>sessions.get(req.headers.authorization?.replace('Bearer ',''));
  auth.post('/token',async(req,res)=>{
    let user;
    if(req.query.grant_type==='pkce'){
      if(req.body.auth_code!=='fictional-recovery'||createHash('sha256').update(req.body.code_verifier).digest('base64url')!==recovery?.code_challenge)return res.sendStatus(400);
      user=users.find(u=>u.email===recovery.email);
    }
    else if(req.query.grant_type==='refresh_token'){refreshes++;user=users.find(u=>req.body.refresh_token===`fixture-${u.id}`);}
    else user=users.find(u=>u.email===req.body.email&&req.body.password==='Fictional-password-123');
    if(!user)return res.status(400).json({code:'invalid_credentials',msg:'Invalid fixture credentials'});
    if(!user.email_confirmed_at)return res.status(400).json({code:'email_not_confirmed',msg:'Confirm email'});
    res.json(await issue(user,req.query.grant_type==='pkce'?'recovery':req.query.grant_type==='refresh_token'?'refresh':'password'));
  });
  auth.get('/user',(req,res)=>{const user=current(req);res.status(user?200:401).json(user??{msg:'No fixture session'});});
  auth.put('/user',(req,res)=>{if(!current(req))return res.sendStatus(401);passwordUpdates++;res.json(current(req));});
  auth.post('/recover',(req,res)=>{recoveries++;recovery=req.body;res.json({});});
  auth.post('/logout',(_req,res)=>res.sendStatus(204));
  auth.get('/passkeys',(req,res)=>res.json([...keys.values()].filter(k=>k.owner===current(req)?.id).map(k=>k.metadata)));
  auth.delete('/passkeys/:id',(req,res)=>{if(keys.get(req.params.id)?.owner!==current(req)?.id)return res.sendStatus(404);keys.delete(req.params.id);deletions++;res.sendStatus(204);});
  auth.post('/passkeys/:action/options',(req,res)=>{
    if(failOptions)return res.status(400).json({code:failOptions,msg:'Fictional failure'});
    const user=current(req),registration=req.params.action==='registration';
    if(registration)registrationOptions++;
    if(registration&&!user?.email_confirmed_at)return res.status(400).json({code:'email_not_confirmed',msg:'Confirm email'});
    const challenge=randomBytes(32).toString('base64url'),id=randomUUID();challenges.set(id,{challenge,user,registration});
    res.json({challenge_id:id,expires_at:Math.floor(Date.now()/1000)+60,options:registration?{
      challenge,rp:{id:'localhost',name:'Fictional Trip Planner'},user:{id:Buffer.from(user.id).toString('base64url'),name:user.email,displayName:'Fixture'},
      pubKeyCredParams:[{type:'public-key',alg:-7}],authenticatorSelection:{residentKey:'required',userVerification:'required'},timeout:10000,
    }:{challenge,rpId:'localhost',userVerification:'required',timeout:10000}});
  });
  auth.post('/passkeys/:action/verify',async(req,res)=>{
    const challenge=challenges.get(req.body.challenge_id);challenges.delete(req.body.challenge_id);
    const credential=req.body.credential,data=JSON.parse(Buffer.from(credential.response.clientDataJSON,'base64url').toString());
    if(!challenge||data.challenge!==challenge.challenge||data.origin!==origin||data.type!==(challenge.registration?'webauthn.create':'webauthn.get'))
      return res.status(400).json({code:'webauthn_verification_failed',msg:'Invalid fixture ceremony'});
    if(challenge.registration){
      const metadata={id:randomUUID(),friendly_name:'Fictional security key',created_at:new Date().toISOString()};
      keys.set(metadata.id,{metadata,credentialId:credential.id,owner:challenge.user.id});registrations++;return res.json(metadata);
    }
    const key=[...keys.values()].find(k=>k.credentialId===credential.id);
    if(!key)return res.status(400).json({code:'webauthn_credential_not_found',msg:'Missing fixture credential'});
    res.json(await issue(users.find(u=>u.id===key.owner),'passkey'));
  });
  auth.get('/oauth/authorizations/:id',(req,res)=>res.json({authorization_id:req.params.id,user:current(req),client:{id:client,name:'Fictional assistant'},redirect_uri:`${origin}/callback`,scope:'openid email'}));
  auth.post('/oauth/authorizations/:id/consent',(_req,res)=>res.json({redirect_url:`${origin}/callback?code=fictional&state=fixture-pkce`}));
  auth.delete('/user/oauth/grants',(_req,res)=>res.json({}));
  const provider=supabaseAccounts(issuer,'sb_publishable_fixture',createLocalJWKSet({keys:[jwk]}));
  const core=new Core(db,false,false);
  const {tripId}=await core.callFromWeb('create_trip',{idempotencyKey:randomUUID(),name:'Owner fictional passkey trip',destination:'Fixture',startDate:'2027-01-01',endDate:'2027-01-02',adults:1},users[0].id);
  await db.query('insert into oauth_resource values(true,$1)',[`${origin}/mcp`]);
  const app=express();app.use('/auth/v1',auth);
  app.get('/callback',(_req,res)=>res.send('Fictional OAuth callback'));
  app.use(createApp({core,publicOrigin:origin,authenticate:async()=>{throw Error('No fixture MCP token');},
    accounts:accountRoutes({db,provider,origin,issuer,publishableKey:'sb_publishable_fixture',passkeys:enabled}),
    itinerary:itineraryRoutes({core,origin,authenticate:provider.authenticate,supabaseUrl:origin,publishableKey:'sb_publishable_fixture'}),
  }));http.on('request',app);
  return {origin,db,core,tripId,users,client,keys,
    counts:()=>({refreshes,registrations,deletions,recoveries,passwordUpdates,registrationOptions}),fail:code=>{failOptions=code;},
    ageSessions:()=>{for(const user of sessions.values())user.last_sign_in_at=new Date(Date.now()-48*60*60_000).toISOString();},
    close:async()=>{http.closeAllConnections();await new Promise(resolve=>http.close(resolve));await db.close();}};
}

test('optional passkeys: password enrollment, virtual-device login, same trips, consent and recovery',async({page,context})=>{
  const app=await fixture(),external=[];
  await context.route('**/*',route=>new URL(route.request().url()).origin===app.origin?route.continue():(external.push(route.request().url()),route.abort()));
  const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
  const login=async(email='owner@example.test')=>{
    await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill('Fictional-password-123');
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
  };
  try{
    await page.goto(`${app.origin}/account`);
    await login('unconfirmed@example.test');await expect(page.locator('#status')).toContainText('Confirm');
    await expect(page.locator('#passkey-settings')).toBeHidden();expect(app.counts().registrations).toBe(0);
    await login();await expect(page.locator('#identity')).toHaveText('owner@example.test');
    // A valid long-lived/restored session alone must not send credential writes,
    // even though this fake provider deliberately permits them without step-up.
    app.ageSessions();await page.reload();await expect(page.locator('#identity')).toHaveText('owner@example.test');
    await page.getByRole('button',{name:'Register a passkey',exact:true}).click();
    await expect(page.locator('#passkey-status')).toContainText('current password');expect(app.counts().registrationOptions).toBe(0);
    await page.getByLabel('Current password for passkey changes',{exact:true}).fill('Wrong-fictional-password');
    await page.getByRole('button',{name:'Register a passkey',exact:true}).click();
    await expect(page.locator('#passkey-status')).toContainText('could not be confirmed');expect(app.counts().registrationOptions).toBe(0);
    await expect(page.locator('#passkey-password')).toHaveValue('');
    await page.getByText('Password and recovery',{exact:true}).click();
    await page.getByLabel('New password',{exact:true}).fill('Fictional-blocked-password');
    await page.getByRole('button',{name:'Set new password',exact:true}).click();
    await expect(page.locator('#status')).toContainText('Enter your current password');expect(app.counts().passwordUpdates).toBe(0);
    await page.getByLabel('Current password',{exact:true}).fill('Wrong-fictional-password');
    await page.getByLabel('New password',{exact:true}).fill('Fictional-blocked-password');
    await page.getByRole('button',{name:'Set new password',exact:true}).click();
    await expect(page.locator('#status')).toContainText('Enter your current password');expect(app.counts().passwordUpdates).toBe(0);
    await expect(page.locator('#current-password')).toHaveValue('');
    await page.getByText('Password and recovery',{exact:true}).click();
    await page.evaluate(()=>{
      window.fixtureCreate=navigator.credentials.create.bind(navigator.credentials);
      navigator.credentials.create=()=>Promise.reject(new DOMException('Fictional cancellation','NotAllowedError'));
    });
    await page.getByLabel('Current password for passkey changes',{exact:true}).fill('Fictional-password-123');
    await page.getByRole('button',{name:'Register a passkey',exact:true}).click();
    await expect(page.locator('#passkey-status')).toContainText('cancelled or timed out');expect(app.counts().registrations).toBe(0);
    await page.evaluate(()=>{navigator.credentials.create=window.fixtureCreate;delete window.fixtureCreate;});
    // A failed list must not block the existing signed-in account or consent.
    await page.route('**/auth/v1/passkeys',route=>route.fulfill({status:503,json:{msg:'Fictional network failure'}}));
    await page.getByRole('button',{name:'Reload passkeys'}).click();await expect(page.locator('#passkey-status')).toContainText('Check your connection');
    await expect(page.locator('#account')).toBeVisible();await page.unroute('**/auth/v1/passkeys');
    await page.getByLabel('Current password for passkey changes',{exact:true}).fill('Fictional-password-123');
    await page.getByRole('button',{name:'Register a passkey',exact:true}).click();
    await expect(page.locator('#passkey-status')).toContainText('Passkey registered');expect(app.counts().registrations).toBe(1);
    await page.getByRole('button',{name:'Sign out / switch account'}).click();
    await expect(page.locator('#signin')).toBeVisible();
    await page.getByRole('button',{name:'Continue with passkey'}).click();
    await expect(page.locator('#identity')).toHaveText('owner@example.test');
    const storage=await page.evaluate(()=>JSON.parse(localStorage.getItem('travel-account')));
    expect(storage.user.id).toBe(app.users[0].id);
    const isolated=await context.browser().newContext({serviceWorkers:'block'});
    try{
      await isolated.route('**/*',route=>new URL(route.request().url()).origin===app.origin?route.continue():route.abort());
      const other=await isolated.newPage();await other.goto(`${app.origin}/account`);
      await other.getByLabel('Email',{exact:true}).fill('other@example.test');await other.getByLabel('Password',{exact:true}).fill('Fictional-password-123');
      await other.getByRole('button',{name:'Sign in',exact:true}).click();await expect(other.locator('#identity')).toHaveText('other@example.test');
      await expect(other.locator('#passkey-list')).toHaveText('No passkeys registered.');expect(app.keys.size).toBe(1);
      await other.goto(`${app.origin}/itinerary`);await expect(other.locator('#workspace')).toBeVisible();
      await expect(other.locator('#trip-list')).not.toContainText('Owner fictional passkey trip');
      const denied=await other.evaluate(async tripId=>{
        const s=JSON.parse(localStorage.getItem('travel-account'));
        return (await fetch('/itinerary-api/get_itinerary',{method:'POST',headers:{authorization:`Bearer ${s.access_token}`,'content-type':'application/json'},body:JSON.stringify({tripId})})).status;
      },app.tripId);expect(denied).toBe(404);
    }finally{await isolated.close();}
    await page.goto(`${app.origin}/itinerary`);
    await expect(page.locator('body')).toContainText('Owner fictional passkey trip');
    // Refresh uses the same storage/client configuration as password sessions.
    await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('travel-account'));s.expires_at=1;localStorage.setItem('travel-account',JSON.stringify(s));});
    await page.goto(`${app.origin}/oauth/consent?authorization_id=fixture-auth`);
    await expect(page.locator('#consent')).toBeVisible();expect(app.counts().refreshes).toBe(1);
    await expect(page.locator('#allow-write')).not.toBeChecked();await expect(page.locator('#search-option')).toBeHidden();
    await page.getByRole('button',{name:'Approve connection',exact:true}).click();await expect(page).toHaveURL(/callback\?code=fictional&state=fixture-pkce/);
    const grant=(await app.db.query('select * from client_grants where owner_id=$1 and client_id=$2',[app.users[0].id,app.client])).rows[0];
    expect(grant.permissions).toEqual(['read']);
    const actor={userId:app.users[0].id,clientId:app.client};
    expect(JSON.stringify(await app.core.call('get_trip',{tripId:app.tripId},actor))).toContain('Owner fictional passkey trip');
    await expect(app.core.call('create_trip',{idempotencyKey:randomUUID(),name:'Forbidden',destination:'Fixture',startDate:'2027-01-01',endDate:'2027-01-02',adults:1},actor)).rejects.toThrow();
    await page.goto(`${app.origin}/account`);await page.getByRole('button',{name:'Revoke access',exact:true}).click();
    await expect(page.locator('#status')).toContainText(/Access revoked|Travel access is revoked/);
    await expect(app.core.call('get_trip',{tripId:app.tripId},actor)).rejects.toThrow();
    // Cancelled removal sends no mutation; confirmed removal is read back.
    page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Remove Fictional security key'}).click();expect(app.counts().deletions).toBe(0);
    page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Remove Fictional security key'}).click();
    await expect(page.locator('#passkey-status')).toContainText('current password');expect(app.counts().deletions).toBe(0);expect(app.keys.size).toBe(1);
    await page.getByLabel('Current password for passkey changes',{exact:true}).fill('Fictional-password-123');
    page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Remove Fictional security key'}).click();
    await expect(page.locator('#passkey-status')).toContainText('Passkey removed');expect(app.counts().deletions).toBe(1);expect(app.keys.size).toBe(0);
    await page.getByText('Password and recovery',{exact:true}).click();await page.getByLabel('New password',{exact:true}).fill('Fictional-new-password');
    await page.getByLabel('Current password',{exact:true}).fill('Fictional-password-123');
    await page.getByRole('button',{name:'Set new password',exact:true}).click();await expect(page.locator('#status')).toContainText('Password updated');expect(app.counts().passwordUpdates).toBe(1);
    const second=await context.newPage();await second.goto(`${app.origin}/account`);await expect(second.locator('#identity')).toHaveText('owner@example.test');
    await page.getByRole('button',{name:'Sign out / switch account'}).click();await expect(second.locator('#account')).toBeHidden();await second.close();
    await page.getByLabel('Email',{exact:true}).fill('owner@example.test');await page.getByRole('button',{name:'Forgot password'}).click();
    await expect(page.locator('#status')).toContainText('recovery email has been requested');expect(app.counts().recoveries).toBe(1);
    await page.goto(`${app.origin}/account?code=fictional-recovery`);
    await expect(page.locator('#identity')).toHaveText('owner@example.test');
    await page.getByText('Password and recovery',{exact:true}).click();await page.getByLabel('New password',{exact:true}).fill('Fictional-recovered-password');
    await page.getByRole('button',{name:'Set new password',exact:true}).click();await expect(page.locator('#status')).toContainText('Password updated');expect(app.counts().passwordUpdates).toBe(2);
    // The recovered persisted session cannot reuse the one-time recovery proof.
    await page.reload();await expect(page.locator('#identity')).toHaveText('owner@example.test');
    await page.getByText('Password and recovery',{exact:true}).click();await page.getByLabel('New password',{exact:true}).fill('Fictional-blocked-password');
    await page.getByRole('button',{name:'Set new password',exact:true}).click();
    await expect(page.locator('#status')).toContainText('Enter your current password');expect(app.counts().passwordUpdates).toBe(2);
    await page.getByRole('button',{name:'Sign out / switch account'}).click();await expect(page.locator('#signin')).toBeVisible();
    for(const code of ['webauthn_challenge_expired','webauthn_credential_not_found','passkey_disabled']){
      app.fail(code);await page.getByRole('button',{name:'Continue with passkey'}).click();
      await expect(page.locator('#status')).toContainText(code==='webauthn_challenge_expired'?'expired':code==='webauthn_credential_not_found'?'No matching passkey':'unavailable');
      await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeEnabled();
    }
    app.fail(null);await login('other@example.test');await expect(page.locator('#identity')).toHaveText('other@example.test');
    await expect(page.locator('#passkey-list')).toHaveText('No passkeys registered.');
    await page.goto(`${app.origin}/itinerary`);await expect(page.locator('#workspace')).toBeVisible();await expect(page.locator('#trip-list')).not.toContainText('Owner fictional passkey trip');
    expect(external).toEqual([]);
  }finally{await app.close();}
});

test('disabled pilot and unsupported browser retain password sign-in',async({page,context})=>{
  const app=await fixture(false);
  await context.route('**/*',route=>new URL(route.request().url()).origin===app.origin?route.continue():route.abort());
  try{
    await page.goto(`${app.origin}/account`);await expect(page.locator('#signin')).toBeVisible();await expect(page.locator('#passkey-signin')).toBeHidden();
    await page.route('**/account/config',async route=>{const response=await route.fetch();await route.fulfill({json:{...await response.json(),passkeys:true}});});
    await page.addInitScript(()=>{Object.defineProperty(window,'PublicKeyCredential',{value:undefined});});
    await page.reload();await expect(page.getByRole('button',{name:'Continue with passkey'})).toBeDisabled();
    await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeEnabled();
    await expect(page.locator('#passkey-login-hint')).toContainText('unsupported');
  }finally{await app.close();}
});
