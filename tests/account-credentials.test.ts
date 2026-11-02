import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {SupabaseClient} from '@supabase/supabase-js';
import {AccountBoundary} from '../web/account-session.js';
import {CredentialGuard} from '../web/account-credentials.js';

function fixture(){
  let exchangeError=false,now=0,attempts=0,mutations=0,event:(name:string,session:any)=>void=()=>{};
  const user={id:'fixture-owner',email:'owner@example.test',email_confirmed_at:'2026-10-25',is_anonymous:false};
  const boundary=new AccountBoundary(user.id);
  const client={auth:{
    onAuthStateChange(fn:typeof event){event=fn;},
    exchangeCodeForSession:async()=>{event("SIGNED_IN",{user});return {data:{user,session:{user}},error:exchangeError?Error("private"):null};},
    getUser:async()=>({data:{user},error:null}),
    signInWithPassword:async(input:{email:string;password:string})=>{
      attempts++;assert.equal(input.email,user.email);
      if(input.password!=='fictional-current')return {data:{user:null,session:null},error:Error('PRIVATE diagnostic')};
      event('SIGNED_IN',{user});return {data:{user,session:{user}},error:null};
    },
  }} as unknown as SupabaseClient;
  const guard=new CredentialGuard(client,boundary,()=>now);
  return {guard,boundary,user,failExchange:()=>{exchangeError=true;},pending:()=>({email:user.email,userId:user.id,expiresAt:10*60_000}),event:(name:string,identity=user)=>event(name,{user:identity}),
    advance:()=>{now+=5*60_000;},counts:()=>({attempts,mutations}),
    change:async(password='',recovery=false)=>{await guard.authorize(password,recovery);mutations++;}};
}

test('restored/refresh sessions never authorize credential mutations; every ordinary change rechecks password',async()=>{
  const f=fixture();
  for(const event of ['INITIAL_SESSION','TOKEN_REFRESHED']){
    f.event(event);await assert.rejects(f.change('',true),/current password/);
  }
  await assert.rejects(f.change('wrong'),/could not be confirmed/);assert.deepEqual(f.counts(),{attempts:1,mutations:0});
  await f.change('fictional-current');await assert.rejects(f.change(),/current password/);
  assert.deepEqual(f.counts(),{attempts:2,mutations:1});
});

test('only a fresh recovery event permits one password update, never passkey enrollment or deletion',async()=>{
  const f=fixture();f.event('PASSWORD_RECOVERY');
  await f.change('',true);await assert.rejects(f.change('',true),/current password/);
  f.event('PASSWORD_RECOVERY');await assert.rejects(f.change(''),/current password/);
  f.event('PASSWORD_RECOVERY');f.advance();await assert.rejects(f.change('',true),/current password/);
  f.event('PASSWORD_RECOVERY');f.guard.reset();await assert.rejects(f.change('',true),/current password/);
  f.event('PASSWORD_RECOVERY');f.event('SIGNED_OUT');await assert.rejects(f.change('',true),/current password/);
  assert.deepEqual(f.counts(),{attempts:0,mutations:1});
});

test('recovery proof and password reauthentication cannot cross account boundaries',async()=>{
  const f=fixture();f.event('PASSWORD_RECOVERY');f.boundary.update('other-account');
  await assert.rejects(f.change('',true),/confirmed email account/);assert.equal(f.counts().mutations,0);
  const g=fixture();g.event('PASSWORD_RECOVERY',{...g.user,id:'other-account'});
  await assert.rejects(g.change('',true),/current password/);assert.equal(g.counts().mutations,0);
});


test('explicit email PKCE verification permits one passkey change, not a password change',async()=>{
  const f=fixture();assert.equal(await f.guard.completeEmailLink('code',undefined,f.pending()),true);
  f.event('TOKEN_REFRESHED');await f.change();await assert.rejects(f.change(),/current password/);
  await f.guard.completeEmailLink('code',undefined,f.pending());
  await assert.rejects(f.change('',true),/current password/);
  assert.equal(f.counts().mutations,1);
});

test('email proof rejects wrong identities, expires and is lost on reload/reset or sign-out',async()=>{
  const f=fixture();
  await assert.rejects(f.guard.completeEmailLink('code',undefined,{...f.pending(),userId:'other'}),/different account/);
  await assert.rejects(f.guard.completeEmailLink('code',undefined,{...f.pending(),email:'other@example.test'}),/different account/);
  for(const clear of [()=>f.advance(),()=>f.guard.reset(),()=>f.event('SIGNED_OUT')]){
    await f.guard.completeEmailLink('code',undefined,f.pending());clear();await assert.rejects(f.change(),/current password/);
  }
  assert.equal(await f.guard.completeEmailLink('code',undefined,{...f.pending(),expiresAt:0}),false);
  assert.equal(await f.guard.completeEmailLink('code',undefined,null),false);
  f.failExchange();await assert.rejects(f.guard.completeEmailLink('bad',undefined,f.pending()),/could not be verified/);
  await assert.rejects(f.change(),/current password/);assert.equal(f.counts().mutations,0);
});
