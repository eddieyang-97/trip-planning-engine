import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {AccountBoundary,accountStorageKey,prepareAccountStorage,watchAccount} from '../web/account-session.js';
const store=()=>{const values=new Map<string,string>();return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};};

test('auth migration preserves the authoritative account and never resurrects a signed-out legacy tab',()=>{
  const persistent=store(),tab=store(),staleTab=store();
  tab.setItem(accountStorageKey,'legacy-session');tab.setItem(`${accountStorageKey}-code-verifier`,'verifier');tab.setItem('travel-pending-invitation','tab-only-invite');
  tab.setItem(`${accountStorageKey}-flows-code-verifier`,'["pending_flow_123"]');tab.setItem(`${accountStorageKey}-flow-pending_flow_123-code-verifier`,'flow-verifier');
  staleTab.setItem(accountStorageKey,'stale-session');
  prepareAccountStorage(persistent,tab);
  assert.equal(persistent.getItem(accountStorageKey),'legacy-session');assert.equal(persistent.getItem(`${accountStorageKey}-code-verifier`),'verifier');
  assert.equal(persistent.getItem(`${accountStorageKey}-flow-pending_flow_123-code-verifier`),'flow-verifier');
  assert.equal(tab.getItem(accountStorageKey),null);assert.equal(tab.getItem('travel-pending-invitation'),'tab-only-invite');assert.equal(persistent.getItem('travel-pending-invitation'),null);
  persistent.removeItem(accountStorageKey);prepareAccountStorage(persistent,staleTab);assert.equal(persistent.getItem(accountStorageKey),null);assert.equal(staleTab.getItem(accountStorageKey),null);
  const otherBrowser=store();prepareAccountStorage(otherBrowser,store());assert.equal(otherBrowser.getItem(accountStorageKey),null);
  const existing=store(),legacy=store();existing.setItem(accountStorageKey,'current-account');legacy.setItem(accountStorageKey,'different-account');prepareAccountStorage(existing,legacy);assert.equal(existing.getItem(accountStorageKey),'current-account');
  assert.throws(()=>prepareAccountStorage({getItem(){throw Error('storage blocked');},setItem(){},removeItem(){}},store()),/storage blocked/);
});

test('account generations reject in-flight private responses on sign-out and account switch, but allow token refresh',()=>{
  const boundary=new AccountBoundary('first'),generation=boundary.generation;
  assert.equal(boundary.update('first'),false);boundary.check(generation);
  assert.equal(boundary.update(null),true);assert.throws(()=>boundary.check(generation),/account changed/);
  const signedOut=boundary.generation;boundary.update('second');assert.throws(()=>boundary.check(signedOut),/account changed/);boundary.check(boundary.generation);
});

test('auth watchers clear private UI synchronously for cross-tab changes and cached-page restore, with reload outside the auth callback',async()=>{
  const originals=new Map(['window','localStorage','location'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  let reloads=0,clears=0;const storage=store(),listeners=new Map<string,(event:any)=>void>();let authChanged:(event:string,session:{user:{id:string}}|null)=>void=()=>{};
  const fake={auth:{onAuthStateChange(callback:typeof authChanged){authChanged=callback;}}} as unknown as SupabaseClient;
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});
  Object.defineProperty(globalThis,'window',{configurable:true,value:{addEventListener:(type:string,callback:(event:any)=>void)=>listeners.set(type,callback)}});
  Object.defineProperty(globalThis,'location',{configurable:true,value:{reload:()=>{reloads++;}}});
  const flush=()=>new Promise(resolve=>setTimeout(resolve,5));
  try{
    const boundary=new AccountBoundary('first');watchAccount(fake,boundary,()=>{clears++;});
    authChanged('TOKEN_REFRESHED',{user:{id:'first'}});assert.equal(clears,0);
    authChanged('SIGNED_OUT',null);assert.equal(clears,1);assert.equal(reloads,0);assert.equal(boundary.userId,null);await flush();assert.equal(reloads,1);
    const next=new AccountBoundary('first');watchAccount(fake,next,()=>{clears++;});
    listeners.get('storage')!({storageArea:storage,key:'travel-pending-invitation',newValue:null});assert.equal(clears,1);
    listeners.get('storage')!({storageArea:storage,key:accountStorageKey,newValue:JSON.stringify({user:{id:'second'}})});assert.equal(clears,2);assert.equal(next.userId,'second');await flush();
    const resumed=new AccountBoundary('second');watchAccount(fake,resumed,()=>{clears++;});
    listeners.get('pageshow')!({persisted:false});assert.equal(clears,2);
    listeners.get('pageshow')!({persisted:true});assert.equal(clears,3);assert.equal(resumed.userId,null);await flush();assert.equal(reloads,3);
  }finally{for(const [key,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}}
});

test('Supabase sessions survive new clients, refresh expired JWTs, clear on sign-out/revocation and remain browser-isolated',async()=>{
  const storage=store();let refreshes=0,revoked=false;
  const user={id:'00000000-0000-4000-8000-000000000001',email:'fixture@example.test',aud:'authenticated',role:'authenticated',created_at:'2026-01-01T00:00:00Z',app_metadata:{},user_metadata:{}};
  const session=()=>({access_token:`${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.fixture`,refresh_token:'fictional-refresh',token_type:'bearer',expires_in:3600,user});
  const clients:SupabaseClient[]=[];
  const client=(storageOverride=storage)=>{
    const c=createClient('https://fixture.invalid','fixture-public-key',{auth:{storage:storageOverride,storageKey:accountStorageKey,persistSession:true,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(input)=>{
      const url=new URL(String(input));assert.equal(url.hostname,'fixture.invalid');
      if(url.pathname.endsWith('/token')){if(url.searchParams.get('grant_type')==='refresh_token'){refreshes++;if(revoked)return Response.json({code:'refresh_token_not_found',msg:'Session revoked'},{status:400});}return Response.json(session());}
      if(url.pathname.endsWith('/logout'))return new Response(null,{status:204});
      if(url.pathname.endsWith('/user'))return Response.json(user);
      throw Error(`Unexpected fixture path: ${url.pathname}`);
    }}});clients.push(c);return c;
  };
  try{
    const first=client();assert.equal((await first.auth.signInWithPassword({email:user.email,password:'fictional-test-input'})).error,null);
    const reopened=client();assert.equal((await reopened.auth.getSession()).data.session?.user.id,user.id);assert.equal(refreshes,0);
    assert.equal((await client(store()).auth.getSession()).data.session,null);
    const saved=JSON.parse(storage.getItem(accountStorageKey)!);storage.setItem(accountStorageKey,JSON.stringify({...saved,expires_at:1}));
    const refreshed=client();assert.ok((await refreshed.auth.getSession()).data.session);assert.equal(refreshes,1);
    assert.equal((await refreshed.auth.signOut({scope:'local'})).error,null);assert.equal((await reopened.auth.getSession()).data.session,null);assert.equal(storage.getItem(accountStorageKey),null);
    await first.auth.signInWithPassword({email:user.email,password:'fictional-test-input'});
    const expiring=JSON.parse(storage.getItem(accountStorageKey)!);storage.setItem(accountStorageKey,JSON.stringify({...expiring,expires_at:1}));revoked=true;
    assert.equal((await client().auth.getSession()).data.session,null);assert.equal(storage.getItem(accountStorageKey),null);
  }finally{for(const c of clients){c.auth.stopAutoRefresh();await c.auth.dispose();}}
});
