import {AccountBoundary,createAccountClient,watchAccount} from './account-session.js';
import { accountAuthError, signupReceivedMessage } from './account-errors.js';
import {configureProfile} from './account-profile.js';
import {configurePasskeys,passkeyError,supportsPasskeys} from './account-passkeys.js';
import {CredentialGuard} from './account-credentials.js';
import {configureAccountEntry} from './account-entry.js';
const el = <T extends HTMLElement = HTMLElement>(id:string) => document.getElementById(id) as T;
const status = (text:string) => { el('status').textContent=text; };
async function initialize() {
let authorization = new URL(location.href).searchParams.get('authorization_id');
let returnToItinerary=new URL(location.href).searchParams.get('returnTo')==='itinerary';
if(returnToItinerary&&!authorization){
  el('entry-context').textContent='Sign in or create an account to continue to your itinerary.';
  el('entry-context').hidden=false;
  el('pilot-notice').hidden=true;
}else if(authorization){
  el('entry-context').textContent='Sign in to review your assistant’s connection request.';
  el('entry-context').hidden=false;
}
const configResponse = await fetch('/account/config',{signal:AbortSignal.timeout(60_000)});
if (!configResponse.ok) throw new Error('Account configuration unavailable');
const config = await configResponse.json();
const entry=configureAccountEntry(config.passkeys===true,supportsPasskeys());
entry.showAccount(false);
const liveSearch=config.liveSearch===true;
el('pilot-notice').textContent=liveSearch?'Live flight research supports bounded economy/GBP one-way and return searches for future dates, 1–6 origin airports, one destination and 1–9 adults. Coverage is partial; baggage costs, party-price basis and bookability may be unknown. Booking is unavailable.':'This pilot saves research and manual evidence. Live search and booking are unavailable.';
el('search-option').hidden=!liveSearch;
el('search-scope').textContent=liveSearch?'Each run uses at most three provider requests: up to three origin queries for one-way, or one combined-origin query plus at most two return expansions. At most two runs per account in a rolling 24 hours, subject to shared limits. This is partial coverage, not a complete airport sweep or a verified bookable party fare; baggage may remain unknown.':'Live search is unavailable.';
el<HTMLInputElement>('allow-write').onchange=()=>{
  const search=el<HTMLInputElement>('allow-search');search.disabled=!liveSearch||!el<HTMLInputElement>('allow-write').checked;
  if(search.disabled)search.checked=false;
};
// Handle PKCE explicitly so only a successful exchange can approve an email step-up.
const supabase=createAccountClient(config,false),boundary=new AccountBoundary();
const credentials=new CredentialGuard(supabase,boundary);
const emailRequestKey='travel-account-email-request';
let emailPurpose:'signup'|'signin'|'manage'|undefined;
async function requestEmail(email:string,purpose:'signup'|'signin'|'manage'){
  const create=purpose==='signup';
  if(create&&config.passkeys!==true)throw Error('Passkey signup is unavailable. Use email and password.');
  const generation=boundary.generation,userId=boundary.userId;
  if(userId){const {data,error}=await supabase.auth.getUser();boundary.check(generation);
    if(error||data.user?.id!==userId||data.user.email?.toLowerCase()!==email.toLowerCase())throw Error('Your account changed. Sign in again.');}
  credentials.reset();el<HTMLInputElement>('password').value='';el<HTMLInputElement>('passkey-password').value='';
  const pending={email,userId,expiresAt:Date.now()+10*60_000,purpose,authorization,returnToItinerary};
  localStorage.setItem(emailRequestKey,JSON.stringify(pending));
  try{const {error}=await supabase.auth.signInWithOtp({email,options:{shouldCreateUser:create,emailRedirectTo:`${location.origin}/account`}});if(error)throw error;}
  catch{localStorage.removeItem(emailRequestKey);throw Error('Unable to request an email link. Wait a moment, then try again.');}
  status('If this address can receive access, a verification link has been requested. Open the newest email link in this browser within ten minutes. No password is needed.');
}
let requestId:string|undefined;
const profileEditor=configureProfile(api);
const passkeys=configurePasskeys(supabase,boundary,config.passkeys===true,credentials);
el<HTMLButtonElement>('passkey-login').disabled=!supportsPasskeys();
el<HTMLButtonElement>('passkey-signup').disabled=!supportsPasskeys();
function clearPrivate(){
  emailPurpose=undefined;localStorage.removeItem(emailRequestKey);
  profileEditor.reset();
  credentials.reset();passkeys.reset();el<HTMLInputElement>('new-password').value='';el<HTMLInputElement>('current-password').value='';
  requestId=undefined;
  for(const id of ['account','connections','consent'])el(id).hidden=true;
  for(const id of ['identity','account-id','connection-list','client-name','client-id','client-redirect','client-scopes'])el(id).replaceChildren();
  entry.reset();entry.showAccount(false);
}
async function api(path:string, body?:unknown,photo?:{blob:Blob;revision:number}) {
  const generation=boundary.generation;
  const { data:{session},error } = await supabase.auth.getSession();
  boundary.check(generation);
  if(error)throw new Error(accountAuthError(error,'signin'));
  if (!session){boundary.update(null);clearPrivate();throw new Error('Sign in to your travel account.');}
  let response:Response;try{response = await fetch(`/account/api/${path}`, { method:body===undefined&&!photo?'GET':'POST',signal:AbortSignal.timeout(20_000),
    headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':photo?photo.blob.type:'application/json',...(photo?{'X-Profile-Revision':String(photo.revision)}:{})},
    ...(photo?{body:photo.blob}:body===undefined?{}:{body:JSON.stringify(body)}) });}catch{throw new Error('Unable to reach the travel app. Check your connection and try again later.');}
  let result;try{result=await response.json();}catch{throw new Error('The travel app returned an unexpected response. Try again later.');}
  boundary.check(generation);
  if(response.status===401){boundary.update(null);clearPrivate();}
  if(!response.ok) throw new Error(result.error??'Please try again.');return result;
}
async function busy(button:HTMLButtonElement, work:()=>Promise<void>) {
  const loginButtons=button.closest('#login-form')?.querySelectorAll<HTMLButtonElement>('button')??[];
  const controls=new Map([...loginButtons,button].map(control=>[control,control.disabled]));
  for(const control of controls.keys())control.disabled=true;
  button.setAttribute('aria-busy','true');status('');try{await work();}catch(error){status(error instanceof Error?error.message:'Please try again.');}finally{button.removeAttribute('aria-busy');for(const [control,disabled] of controls)control.disabled=disabled;}
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
  entry.showAccount(false);
  if(!session){status('');return;}
  const me=await api('me');
  if(returnToItinerary&&!authorization&&emailPurpose!=='signup'&&emailPurpose!=='manage'){location.replace('/itinerary');return;}
  el('identity').textContent=me.email;el('account-id').textContent=`Account ID: ${me.userId}`;el('mcp-url').textContent=config.mcpUrl;
  for(const id of ['account','connections'])el(id).hidden=false;entry.showAccount(true);
  await profileEditor.load();
  await passkeys.load();
  await connections();
  if(authorization){const details=await api('authorization',{authorization_id:authorization});
    if(details.redirectUrl){redirect(details.redirectUrl);return;}
    requestId=details.requestId;el('client-name').textContent=`Connect ${details.clientName}?`;el('client-id').textContent=details.clientId;
    el('client-redirect').textContent=details.redirectUri;el('client-scopes').textContent=details.scope||'None';el<HTMLInputElement>('allow-write').checked=false;el<HTMLInputElement>('allow-search').checked=false;el<HTMLInputElement>('allow-search').disabled=true;el('consent').hidden=false;
  }
  status(emailPurpose==='signup'?'Email verified. Choose Register a passkey below to finish creating your passkey. If cancelled, verify by email again to retry.':emailPurpose?'Email verified. You can register or remove one passkey within five minutes.':'');
}
el<HTMLFormElement>('login-form').onsubmit=event=>{event.preventDefault();const button=entry.action();
  if(button.disabled)return;
  if(button.id!=='password-login'){button.click();return;}
  if(!validateEmail()||!validatePassword(false))return;
  void busy(button,async()=>{status('Signing in…');let result;try{result=await supabase.auth.signInWithPassword({email:el<HTMLInputElement>('email').value,password:el<HTMLInputElement>('password').value});}catch(error){throw new Error(authFailure(error,'signin'));}finally{el<HTMLInputElement>('password').value='';}if(result.error)throw new Error(accountAuthError(result.error,'signin'));await render();});};
el<HTMLButtonElement>('signup').onclick=()=>busy(el('signup'),async()=>{
  if(!validateEmail()||!validatePassword(true))return;
  status('Creating your account…');
  let result;try{result=await supabase.auth.signUp({email:el<HTMLInputElement>('email').value,password:el<HTMLInputElement>('password').value,options:{emailRedirectTo:`${location.origin}/account`}});}catch(error){throw new Error(authFailure(error,'signup'));}finally{el<HTMLInputElement>('password').value='';}
  if(result.error)throw new Error(accountAuthError(result.error,'signup'));
  if(result.data.session){await render();return;}status(signupReceivedMessage);entry.confirmationRequested();
});
el<HTMLButtonElement>('resend').onclick=()=>busy(el('resend'),async()=>{
  if(!validateEmail())return;status('Requesting confirmation email…');
  let result;try{result=await supabase.auth.resend({type:'signup',email:el<HTMLInputElement>('email').value,options:{emailRedirectTo:`${location.origin}/account`}});}catch(error){throw new Error(authFailure(error,'resend'));}
  if(result.error)throw new Error(accountAuthError(result.error,'resend'));
  status('If this address has an unconfirmed account, a confirmation email has been requested. Check your inbox and spam folder. If already confirmed, use Sign in.');
});
el<HTMLButtonElement>('passkey-login').onclick=()=>busy(el('passkey-login'),async()=>{
  if(config.passkeys!==true||!supportsPasskeys())throw Error('Passkeys are unavailable. Use email and password.');
  status('Follow your device prompt to sign in…');
  let result;try{result=await supabase.auth.signInWithPasskey();}catch(error){throw Error(passkeyError(error));}
  if(result.error)throw Error(passkeyError(result.error));
  await render();
});
el<HTMLButtonElement>('passkey-signup').onclick=()=>busy(el('passkey-signup'),async()=>{
  if(!supportsPasskeys())throw Error('This browser cannot create passkeys. Use email and password.');
  if(validateEmail())await requestEmail(el<HTMLInputElement>('email').value,'signup');
});
el<HTMLButtonElement>('email-login').onclick=()=>busy(el('email-login'),async()=>{
  if(validateEmail())await requestEmail(el<HTMLInputElement>('email').value,'signin');
});
el<HTMLButtonElement>('passkey-email').onclick=()=>busy(el('passkey-email'),async()=>{
  const {data,error}=await supabase.auth.getUser();
  if(error||!data.user?.email)throw Error('Sign in again before requesting verification.');
  await requestEmail(data.user.email,'manage');
});
el<HTMLButtonElement>('reset-password').onclick=()=>busy(el('reset-password'),async()=>{
  if(!validateEmail())return;
  try{const {error}=await supabase.auth.resetPasswordForEmail(el<HTMLInputElement>('email').value,{redirectTo:`${location.origin}/account`});if(error)throw error;}
  catch{throw Error('Unable to request recovery. Check your connection and try again later.');}
  status('If this email has an account, a password recovery email has been requested. Open it in this browser, then set a new password under Password and recovery.');
});
el<HTMLFormElement>('password-form').onsubmit=event=>{
  event.preventDefault();const button=el('password-form').querySelector<HTMLButtonElement>('button')!;
  void busy(button,async()=>{
    const generation=boundary.generation,password=el<HTMLInputElement>('new-password'),current=el<HTMLInputElement>('current-password');
    const currentPassword=current.value;current.value='';
    try{
      const proof=await credentials.authorize(currentPassword,true);boundary.check(generation);
      const result=await supabase.auth.updateUser({password:password.value,...proof});boundary.check(generation);
      if(result.error)throw Error('Unable to set your password. Request a new recovery email or sign in again, then retry.');
      status('Password updated. Keep it safe for recovery.');
    }catch{throw Error('Unable to set your password. Enter your current password or request a new recovery email, then retry.');}
    finally{password.value='';}
  });
};
el<HTMLButtonElement>('signout').onclick=()=>busy(el('signout'),async()=>{clearPrivate();const {error}=await supabase.auth.signOut({scope:'local'});if(error)throw Error('Sign-out could not finish. Check your connection and retry sign-out from Your account.');await render();});
for(const action of ['approve','deny'] as const)el<HTMLButtonElement>(action).onclick=()=>busy(el(action),async()=>{
  if(!requestId)throw new Error('Restart the connection from your assistant.');
  el<HTMLButtonElement>(action==='approve'?'deny':'approve').disabled=true;
  try{const permissions=action==='deny'?[]:['read'];if(action==='approve'&&el<HTMLInputElement>('allow-write').checked){permissions.push('write');if(liveSearch&&el<HTMLInputElement>('allow-search').checked)permissions.push('search');}const result=await api('consent',{requestId,action,permissions});redirect(result.redirectUrl);}
  finally{el<HTMLButtonElement>(action==='approve'?'deny':'approve').disabled=false;}
});
try{const {error}=await supabase.auth.initialize();if(error)throw new Error(accountAuthError(error,'signin'));
  const callback=new URL(location.href),code=callback.searchParams.get('code');
  if(callback.searchParams.has('error')||callback.searchParams.has('error_code')){
    localStorage.removeItem(emailRequestKey);credentials.reset();
    for(const key of ['error','error_code','error_description','code','sb_flow_id'])callback.searchParams.delete(key);
    history.replaceState(null,'',callback);
    throw Error('This email link expired or could not be verified. Request a new link in this browser.');
  }
  if(code){
    let pending=null;try{pending=JSON.parse(localStorage.getItem(emailRequestKey)??'null');}catch{}
    localStorage.removeItem(emailRequestKey);
    // Pending UI intent alone never grants proof; the SDK verifies the PKCE code.
    if(!pending||typeof pending.email!=='string'||typeof pending.expiresAt!=='number'||!(pending.userId===null||typeof pending.userId==='string'))pending=null;
    const flowId=callback.searchParams.get('sb_flow_id')??undefined;
    callback.searchParams.delete('code');callback.searchParams.delete('sb_flow_id');history.replaceState(null,'',callback);
    const verified=await credentials.completeEmailLink(code,flowId,pending);
    if(verified&&pending){emailPurpose=['signup','signin','manage'].includes(pending.purpose)?pending.purpose:undefined;authorization=typeof pending.authorization==='string'?pending.authorization:null;returnToItinerary=pending.returnToItinerary===true;
      if(authorization)callback.searchParams.set('authorization_id',authorization);
      if(returnToItinerary)callback.searchParams.set('returnTo','itinerary');
      history.replaceState(null,'',callback);
    }
  }
  const {data:{session}}=await supabase.auth.getSession();boundary.update(session?.user.id??null);watchAccount(supabase,boundary,clearPrivate);await render();}catch(error){
  status(error instanceof Error?error.message:'Unable to load your account.');
  for(const id of ['account','connections','consent'])el(id).hidden=true;
  entry.showAccount(false);
}
}
void initialize().catch(()=>{el('signin').hidden=false;el('login-form').hidden=true;status('Unable to load sign-in. Reload the page to try again.');});
