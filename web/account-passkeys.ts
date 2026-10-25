import type {SupabaseClient} from '@supabase/supabase-js';
import type {AccountBoundary} from './account-session.js';
import type {CredentialGuard} from './account-credentials.js';

export function supportsPasskeys(){
  return globalThis.isSecureContext===true&&typeof PublicKeyCredential!=='undefined'&&
    typeof navigator.credentials?.create==='function'&&typeof navigator.credentials?.get==='function';
}
export function passkeyError(error:unknown):string {
  const e=error&&typeof error==='object'?error as {code?:string;name?:string;cause?:{name?:string}}:{};
  const code=e.code??'',name=e.cause?.name??e.name;
  if(name==='NotAllowedError'||name==='AbortError'||code==='ERROR_CEREMONY_ABORTED')
    return 'Passkey request cancelled or timed out. Try again, or sign in with your email and password.';
  if(code==='email_not_confirmed'||code==='phone_not_confirmed')return 'Confirm your email before using passkeys. Email and password sign-in is still available.';
  if(code==='webauthn_challenge_expired'||code==='webauthn_challenge_not_found')return 'The passkey request expired. Start again to get a new request.';
  if(code==='webauthn_credential_not_found')return 'No matching passkey was found. Use your email and password, then register a passkey on this device.';
  if(code==='webauthn_credential_exists')return 'This passkey is already registered. Reload your passkeys.';
  if(code==='too_many_passkeys')return 'Your account has reached its passkey limit. Remove an unused key before adding another.';
  if(code==='passkey_disabled')return 'Passkeys are unavailable for this pilot. Use your email and password.';
  return 'Unable to complete the passkey request. Check your connection, then reload passkeys before retrying. Email and password sign-in remains available.';
}

export function configurePasskeys(client:SupabaseClient,boundary:AccountBoundary,enabled:boolean,credentials:CredentialGuard){
  const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
  const panel=el('passkey-settings'),list=el('passkey-list'),message=el('passkey-status');
  const supported=supportsPasskeys();let pending=false,controller:AbortController|undefined;
  function reset(){controller?.abort();panel.hidden=true;list.replaceChildren();message.textContent='';el<HTMLInputElement>('passkey-password').value='';}
  async function confirmed(generation:number){
    const input=el<HTMLInputElement>('passkey-password'),password=input.value;input.value='';
    await credentials.authorize(password);boundary.check(generation);
  }
  async function load(){
    if(!enabled||!boundary.userId)return;
    const generation=boundary.generation;
    panel.hidden=false;el<HTMLButtonElement>('passkey-register').disabled=!supported||pending;
    el('passkey-support').hidden=supported;
    list.replaceChildren();
    let result;try{result=await client.auth.passkey.list();}catch(error){throw Error(passkeyError(error));}
    boundary.check(generation);const {data,error}=result;
    if(error)throw Error(passkeyError(error));
    message.textContent='';
    if(!data?.length){list.textContent='No passkeys registered.';return [];}
    for(const key of data){
      const row=document.createElement('div'),name=document.createElement('p'),remove=document.createElement('button');
      name.textContent=`${key.friendly_name||'Passkey'} · Added ${new Date(key.created_at).toLocaleDateString()}`;
      remove.type='button';remove.className='secondary';remove.textContent=`Remove ${key.friendly_name||'passkey'}`;
      remove.disabled=pending;
      remove.onclick=()=>{
        if(!confirm('Remove this passkey? Make sure you can sign in with your email and password or recover access through your confirmed email. Other passkeys and assistant connections remain available.'))return;
        void run(async generation=>{
          await confirmed(generation);
          let result;try{result=await client.auth.passkey.delete({passkeyId:key.id});}catch(error){throw Error(passkeyError(error));}
          const {error}=result;boundary.check(generation);
          if(error)throw Error(passkeyError(error));
          const keys=await load();
          if(keys?.some(saved=>saved.id===key.id))throw Error('Removal was not confirmed. Reload passkeys before retrying.');
          return 'Passkey removed. Your password and email recovery remain available.';
        });
      };
      row.append(name,remove);list.append(row);
    }
    return data;
  }
  async function run(work:(generation:number)=>Promise<string>){
    if(pending)return;
    pending=true;const generation=boundary.generation;message.textContent='Working…';
    panel.setAttribute('aria-busy','true');
    panel.querySelectorAll('button').forEach(button=>button.disabled=true);
    try{const result=await work(generation);boundary.check(generation);message.textContent=result;}
    catch(error){if(boundary.generation===generation)message.textContent=error instanceof Error?error.message:passkeyError(error);}
    finally{pending=false;panel.removeAttribute('aria-busy');if(boundary.generation===generation){panel.querySelectorAll('button').forEach(button=>button.disabled=false);el<HTMLButtonElement>('passkey-register').disabled=!supported;}}
  }
  el<HTMLButtonElement>('passkey-register').onclick=()=>void run(async generation=>{
    await confirmed(generation);
    controller=new AbortController();
    let result;try{result=await client.auth.registerPasskey({options:{signal:controller.signal}});}catch(error){throw Error(passkeyError(error));}
    boundary.check(generation);if(result.error)throw Error(passkeyError(result.error));
    const keys=await load();
    if(!keys?.some(key=>key.id===result.data?.id))throw Error('Registration was not confirmed. Reload passkeys before retrying.');
    return 'Passkey registered. Keep your password and access to your confirmed email for recovery.';
  });
  el<HTMLButtonElement>('passkey-reload').onclick=()=>void run(async()=>{await load();return 'Passkey list refreshed.';});
  return {reset,load:async()=>{const generation=boundary.generation;try{await load();}catch(error){if(boundary.generation===generation)message.textContent=error instanceof Error?error.message:passkeyError(error);}}};
}
