import { createClient } from '@supabase/supabase-js';
const el = <T extends HTMLElement = HTMLElement>(id:string) => document.getElementById(id) as T;
const status = (text:string) => { el('status').textContent=text; };
async function initialize() {
const authorization = new URL(location.href).searchParams.get('authorization_id');
const configResponse = await fetch('/account/config');
if (!configResponse.ok) throw new Error('Account configuration unavailable');
const config = await configResponse.json();
const supabase = createClient(config.supabaseUrl, config.publishableKey, { auth:{ storage:sessionStorage, storageKey:'travel-account', flowType:'pkce', persistSession:true, autoRefreshToken:true, detectSessionInUrl:true } });
let requestId:string|undefined;
async function api(path:string, body?:unknown) {
  const { data:{session},error } = await supabase.auth.getSession();
  if (error || !session) throw new Error('Sign in to your travel account.');
  const response = await fetch(`/account/api/${path}`, { method:body===undefined?'GET':'POST',
    headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)}) });
  const result=await response.json(); if(!response.ok) throw new Error(result.error??'Please try again.');return result;
}
async function busy(button:HTMLButtonElement, work:()=>Promise<void>) {
  button.disabled=true;status('');try{await work();}catch(error){status(error instanceof Error?error.message:'Please try again.');}finally{button.disabled=false;}
}
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
  for(const id of ['account','connections'])el(id).hidden=!session;
  el('signin').hidden=!!session;
  if(!session){status('');return;}
  const me=await api('me');el('identity').textContent=me.email;el('account-id').textContent=`Account ID: ${me.userId}`;el('mcp-url').textContent=config.mcpUrl;
  await connections();
  if(authorization){const details=await api('authorization',{authorization_id:authorization});
    if(details.redirectUrl){redirect(details.redirectUrl);return;}
    requestId=details.requestId;el('client-name').textContent=`Connect ${details.clientName}?`;el('client-id').textContent=details.clientId;
    el('client-redirect').textContent=details.redirectUri;el('client-scopes').textContent=details.scope||'None';el<HTMLInputElement>('allow-write').checked=false;el('consent').hidden=false;
  }
  status('');
}
el<HTMLFormElement>('login-form').onsubmit=event=>{event.preventDefault();const button=el('login-form').querySelector<HTMLButtonElement>('button[type=submit]')!;
  void busy(button,async()=>{const {error}=await supabase.auth.signInWithPassword({email:el<HTMLInputElement>('email').value.trim(),password:el<HTMLInputElement>('password').value});el<HTMLInputElement>('password').value='';if(error)throw new Error('Sign-in failed. Check your email, password and email confirmation.');await render();});};
el<HTMLButtonElement>('signup').onclick=()=>busy(el('signup'),async()=>{
  if(!el<HTMLFormElement>('login-form').reportValidity())return;
  const {error}=await supabase.auth.signUp({email:el<HTMLInputElement>('email').value.trim(),password:el<HTMLInputElement>('password').value,options:{emailRedirectTo:`${location.origin}/account`}});
  el<HTMLInputElement>('password').value='';if(error)throw new Error('Unable to create the account. Check the details or try again later.');
  status('Check your email to confirm your account, then return here to sign in. If you already have an account, use Sign in.');
});
el<HTMLButtonElement>('signout').onclick=()=>busy(el('signout'),async()=>{await supabase.auth.signOut({scope:'local'});await render();});
for(const action of ['approve','deny'] as const)el<HTMLButtonElement>(action).onclick=()=>busy(el(action),async()=>{
  if(!requestId)throw new Error('Restart the connection from your assistant.');
  el<HTMLButtonElement>(action==='approve'?'deny':'approve').disabled=true;
  try{const permissions=action==='deny'?[]:el<HTMLInputElement>('allow-write').checked?['read','write']:['read'];const result=await api('consent',{requestId,action,permissions});redirect(result.redirectUrl);}
  finally{el<HTMLButtonElement>(action==='approve'?'deny':'approve').disabled=false;}
});
try{await render();}catch(error){
  status(error instanceof Error?error.message:'Unable to load your account.');
  for(const id of ['account','connections','consent'])el(id).hidden=true;
  el('signin').hidden=false;
}
}
void initialize().catch(()=>status('Unable to load sign-in. Reload the page to try again.'));
