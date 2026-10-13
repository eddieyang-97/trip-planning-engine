import { createClient } from '@supabase/supabase-js';
import { accountAuthError, signupReceivedMessage } from './account-errors.js';
const el = <T extends HTMLElement = HTMLElement>(id:string) => document.getElementById(id) as T;
const status = (text:string) => { el('status').textContent=text; };
async function initialize() {
const authorization = new URL(location.href).searchParams.get('authorization_id');
const configResponse = await fetch('/account/config',{signal:AbortSignal.timeout(60_000)});
if (!configResponse.ok) throw new Error('Account configuration unavailable');
const config = await configResponse.json();
const liveSearch=config.liveSearch===true;
el('pilot-notice').textContent=liveSearch?'Live flight research is available for the Flaine pilot: four adults, 18–20 Dec 2026, one direct easyJet Gatwick–Geneva pair. Other London airports, snowboard costs and bookable totals remain unverified. Booking is unavailable.':'This pilot saves research and manual evidence. Live search and booking are unavailable.';
el('search-option').hidden=!liveSearch;
el('search-scope').textContent=liveSearch?'Searches sample one Gatwick–Geneva flight pair for four adults, 18–20 Dec 2026. Each run uses up to three provider requests; at most two runs per account per day, subject to shared limits. Prices and snowboard costs remain unverified.':'Live search is unavailable.';
el<HTMLInputElement>('allow-write').onchange=()=>{
  const search=el<HTMLInputElement>('allow-search');search.disabled=!liveSearch||!el<HTMLInputElement>('allow-write').checked;
  if(search.disabled)search.checked=false;
};
const supabase = createClient(config.supabaseUrl, config.publishableKey, { global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.any([AbortSignal.timeout(20_000),...(init?.signal?[init.signal]:[])])})}, auth:{ storage:sessionStorage, storageKey:'travel-account', flowType:'pkce', persistSession:true, autoRefreshToken:true, detectSessionInUrl:true } });
let requestId:string|undefined;
async function api(path:string, body?:unknown) {
  const { data:{session},error } = await supabase.auth.getSession();
  if(error)throw new Error(accountAuthError(error,'signin'));
  if (!session) throw new Error('Sign in to your travel account.');
  let response:Response;try{response = await fetch(`/account/api/${path}`, { method:body===undefined?'GET':'POST',signal:AbortSignal.timeout(20_000),
    headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)}) });}catch{throw new Error('Unable to reach the travel app. Check your connection and try again later.');}
  let result;try{result=await response.json();}catch{throw new Error('The travel app returned an unexpected response. Try again later.');}
  if(!response.ok) throw new Error(result.error??'Please try again.');return result;
}
async function busy(button:HTMLButtonElement, work:()=>Promise<void>) {
  const loginButtons=button.closest('#login-form')?.querySelectorAll<HTMLButtonElement>('button')??[];
  for(const control of loginButtons)control.disabled=true;
  button.disabled=true;status('');try{await work();}catch(error){status(error instanceof Error?error.message:'Please try again.');}finally{button.disabled=false;for(const control of loginButtons)control.disabled=false;}
}
function validateEmail(){const field=el<HTMLInputElement>('email');field.value=field.value.trim();if(!field.validity.valid){status('Enter a valid email address above.');field.focus();return false;}return true;}
function validatePassword(signup:boolean){const field=el<HTMLInputElement>('password');if(!field.value||(signup&&field.value.length<8)||!field.validity.valid){status(signup?'Enter a password of at least eight characters to create an account.':'Enter your password to sign in.');field.focus();return false;}return true;}
function authFailure(error:unknown,action:'signup'|'signin'|'resend'){return accountAuthError(error&&typeof error==='object'?error as {code?:string;name?:string;status?:number}:{},action);}
function redirect(value:string) { location.assign(value); }
async function connections() {
  const data=await api('connections'),list=el('connection-list');list.replaceChildren();
  if(!data.connections.length){list.textContent='No assistants connected yet. Add the server address in your assistant to begin.';return;}
  for(const c of data.connections){const card=document.createElement('div');card.className='connection';
    const title=document.createElement('strong');title.textContent=c.client_name;
    const detail=document.createElement('p');detail.className='small';detail.textContent=`${c.client_id} · ${c.revoked_at?'Revoked':c.permissions.join(', ')}`;
    const button=document.createElement('button');button.className='secondary';button.textContent=c.revoked_at?'Retry revocation':'Revoke access';
    button.onclick=()=>busy(button,async()=>{const result=await api('revoke',{clientId:c.client_id});await connections();status(result.providerRevoked?'Access revoked.':result.message);});
    card.append(title,detail,button);list.append(card);
  }
}
async function render() {
  requestId=undefined;el('consent').hidden=true;
  const {data:{session}}=await supabase.auth.getSession();
  // Keep sign-in reachable until the server verifies this session. Failed identity checks
  // must not leave an empty account panel with no way to sign in again.
  for(const id of ['account','connections'])el(id).hidden=true;
  el('signin').hidden=false;
  if(!session){status('');return;}
  const me=await api('me');el('identity').textContent=me.email;el('account-id').textContent=`Account ID: ${me.userId}`;el('mcp-url').textContent=config.mcpUrl;
  for(const id of ['account','connections'])el(id).hidden=false;el('signin').hidden=true;
  await connections();
  if(authorization){const details=await api('authorization',{authorization_id:authorization});
    if(details.redirectUrl){redirect(details.redirectUrl);return;}
    requestId=details.requestId;el('client-name').textContent=`Connect ${details.clientName}?`;el('client-id').textContent=details.clientId;
    el('client-redirect').textContent=details.redirectUri;el('client-scopes').textContent=details.scope||'None';el<HTMLInputElement>('allow-write').checked=false;el<HTMLInputElement>('allow-search').checked=false;el<HTMLInputElement>('allow-search').disabled=true;el('consent').hidden=false;
  }
  status('');
}
el<HTMLFormElement>('login-form').onsubmit=event=>{event.preventDefault();const button=el('login-form').querySelector<HTMLButtonElement>('button[type=submit]')!;
  if(!validateEmail()||!validatePassword(false))return;
  void busy(button,async()=>{status('Signing in…');let result;try{result=await supabase.auth.signInWithPassword({email:el<HTMLInputElement>('email').value,password:el<HTMLInputElement>('password').value});}catch(error){throw new Error(authFailure(error,'signin'));}finally{el<HTMLInputElement>('password').value='';}if(result.error)throw new Error(accountAuthError(result.error,'signin'));await render();});};
el<HTMLButtonElement>('signup').onclick=()=>busy(el('signup'),async()=>{
  if(!validateEmail()||!validatePassword(true))return;
  status('Creating your account…');
  let result;try{result=await supabase.auth.signUp({email:el<HTMLInputElement>('email').value,password:el<HTMLInputElement>('password').value,options:{emailRedirectTo:`${location.origin}/account`}});}catch(error){throw new Error(authFailure(error,'signup'));}finally{el<HTMLInputElement>('password').value='';}
  if(result.error)throw new Error(accountAuthError(result.error,'signup'));
  if(result.data.session){await render();return;}status(signupReceivedMessage);
});
el<HTMLButtonElement>('resend').onclick=()=>busy(el('resend'),async()=>{
  if(!validateEmail())return;status('Requesting confirmation email…');
  let result;try{result=await supabase.auth.resend({type:'signup',email:el<HTMLInputElement>('email').value,options:{emailRedirectTo:`${location.origin}/account`}});}catch(error){throw new Error(authFailure(error,'resend'));}
  if(result.error)throw new Error(accountAuthError(result.error,'resend'));
  status('If this address has an unconfirmed account, a confirmation email has been requested. Check your inbox and spam folder. If already confirmed, use Sign in.');
});
el<HTMLButtonElement>('signout').onclick=()=>busy(el('signout'),async()=>{await supabase.auth.signOut({scope:'local'});await render();});
for(const action of ['approve','deny'] as const)el<HTMLButtonElement>(action).onclick=()=>busy(el(action),async()=>{
  if(!requestId)throw new Error('Restart the connection from your assistant.');
  el<HTMLButtonElement>(action==='approve'?'deny':'approve').disabled=true;
  try{const permissions=action==='deny'?[]:['read'];if(action==='approve'&&el<HTMLInputElement>('allow-write').checked){permissions.push('write');if(liveSearch&&el<HTMLInputElement>('allow-search').checked)permissions.push('search');}const result=await api('consent',{requestId,action,permissions});redirect(result.redirectUrl);}
  finally{el<HTMLButtonElement>(action==='approve'?'deny':'approve').disabled=false;}
});
try{const {error}=await supabase.auth.initialize();if(error)throw new Error(accountAuthError(error,'signin'));await render();}catch(error){
  status(error instanceof Error?error.message:'Unable to load your account.');
  for(const id of ['account','connections','consent'])el(id).hidden=true;
  el('signin').hidden=false;
}
}
void initialize().catch(()=>status('Unable to load sign-in. Reload the page to try again.'));
