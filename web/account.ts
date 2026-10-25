import {AccountBoundary,createAccountClient,watchAccount} from './account-session.js';
import { accountAuthError, signupReceivedMessage } from './account-errors.js';
import {configureProfile} from './account-profile.js';
import {configurePasskeys,passkeyError,supportsPasskeys} from './account-passkeys.js';
const el = <T extends HTMLElement = HTMLElement>(id:string) => document.getElementById(id) as T;
const status = (text:string) => { el('status').textContent=text; };
async function initialize() {
const authorization = new URL(location.href).searchParams.get('authorization_id');
const returnToItinerary=new URL(location.href).searchParams.get('returnTo')==='itinerary';
if(returnToItinerary&&!authorization){
  document.querySelector('h1')!.textContent='Your trip starts here.';
  document.querySelector('.intro')!.textContent='Sign in or create a travel account to open your itinerary. You do not need an AI assistant or any developer setup.';
  el('signin').querySelector('p')!.textContent='Create an account with your own email and password. Confirm your email, then return to this tab and sign in to continue your invitation.';
  el('pilot-notice').hidden=true;
}
const configResponse = await fetch('/account/config',{signal:AbortSignal.timeout(60_000)});
if (!configResponse.ok) throw new Error('Account configuration unavailable');
const config = await configResponse.json();
const liveSearch=config.liveSearch===true;
el('pilot-notice').textContent=liveSearch?'Live flight research supports bounded economy/GBP one-way and return searches for future dates, 1–6 origin airports, one destination and 1–9 adults. Coverage is partial; baggage costs, party-price basis and bookability may be unknown. Booking is unavailable.':'This pilot saves research and manual evidence. Live search and booking are unavailable.';
el('search-option').hidden=!liveSearch;
el('search-scope').textContent=liveSearch?'Each run uses at most three provider requests: up to three origin queries for one-way, or one combined-origin query plus at most two return expansions. At most two runs per account in a rolling 24 hours, subject to shared limits. This is partial coverage, not a complete airport sweep or a verified bookable party fare; baggage may remain unknown.':'Live search is unavailable.';
el<HTMLInputElement>('allow-write').onchange=()=>{
  const search=el<HTMLInputElement>('allow-search');search.disabled=!liveSearch||!el<HTMLInputElement>('allow-write').checked;
  if(search.disabled)search.checked=false;
};
const supabase=createAccountClient(config),boundary=new AccountBoundary();
let requestId:string|undefined;
const profileEditor=configureProfile(api);
const passkeys=configurePasskeys(supabase,boundary,config.passkeys===true);
el('passkey-signin').hidden=config.passkeys!==true;
el<HTMLButtonElement>('passkey-login').disabled=!supportsPasskeys();
if(!supportsPasskeys())el('passkey-login-hint').textContent='Passkeys are unsupported in this browser or connection. Use email and password to sign in.';
function clearPrivate(){
  profileEditor.reset();
  passkeys.reset();el<HTMLInputElement>('new-password').value='';
  requestId=undefined;
  for(const id of ['account','connections','consent'])el(id).hidden=true;
  for(const id of ['identity','account-id','connection-list','client-name','client-id','client-redirect','client-scopes'])el(id).replaceChildren();
  el<HTMLInputElement>('password').value='';el('signin').hidden=false;
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
  for(const control of loginButtons)control.disabled=true;
  button.disabled=true;button.setAttribute('aria-busy','true');status('');try{await work();}catch(error){status(error instanceof Error?error.message:'Please try again.');}finally{button.removeAttribute('aria-busy');button.disabled=false;for(const control of loginButtons)control.disabled=false;el<HTMLButtonElement>('passkey-login').disabled=!supportsPasskeys();}
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
  const me=await api('me');
  if(returnToItinerary&&!authorization){location.replace('/itinerary');return;}
  el('identity').textContent=me.email;el('account-id').textContent=`Account ID: ${me.userId}`;el('mcp-url').textContent=config.mcpUrl;
  for(const id of ['account','connections'])el(id).hidden=false;el('signin').hidden=true;
  await profileEditor.load();
  await passkeys.load();
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
el<HTMLButtonElement>('passkey-login').onclick=()=>busy(el('passkey-login'),async()=>{
  if(config.passkeys!==true||!supportsPasskeys())throw Error('Passkeys are unavailable. Use email and password.');
  status('Follow your device prompt to sign in…');
  let result;try{result=await supabase.auth.signInWithPasskey();}catch(error){throw Error(passkeyError(error));}
  if(result.error)throw Error(passkeyError(result.error));
  await render();
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
    const generation=boundary.generation,password=el<HTMLInputElement>('new-password');
    try{
      const {data,error}=await supabase.auth.getUser();boundary.check(generation);
      if(error||!data.user?.email_confirmed_at||data.user.is_anonymous||data.user.id!==boundary.userId)throw Error('Sign in with your confirmed email account first.');
      const result=await supabase.auth.updateUser({password:password.value});boundary.check(generation);
      if(result.error)throw Error('Unable to set your password. Request a new recovery email or sign in again, then retry.');
      status('Password updated. Keep it safe for recovery.');
    }catch{throw Error('Unable to set your password. Request a new recovery email or sign in again, then retry.');}
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
  const {data:{session}}=await supabase.auth.getSession();boundary.update(session?.user.id??null);watchAccount(supabase,boundary,clearPrivate);await render();}catch(error){
  status(error instanceof Error?error.message:'Unable to load your account.');
  for(const id of ['account','connections','consent'])el(id).hidden=true;
  el('signin').hidden=false;
}
}
void initialize().catch(()=>status('Unable to load sign-in. Reload the page to try again.'));
