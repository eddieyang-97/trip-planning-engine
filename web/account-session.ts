import {createClient,type SupabaseClient} from '@supabase/supabase-js';

export const accountStorageKey='travel-account';
const migrationKey='travel-account-persistent-v1';
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
// Migrate once. A legacy tab must never restore a session after another tab signs out.
export function prepareAccountStorage(persistent:Store,legacy:Store){
  const flowIndexKey=`${accountStorageKey}-flows-code-verifier`;
  let flows:unknown;try{flows=JSON.parse(legacy.getItem(flowIndexKey)??'[]');}catch{}
  const flowKeys=Array.isArray(flows)?flows.filter((id):id is string=>typeof id==='string'&&/^[a-zA-Z0-9_-]{8,64}$/.test(id)).slice(-64).map(id=>`${accountStorageKey}-flow-${id}-code-verifier`):[];
  const keys=[accountStorageKey,`${accountStorageKey}-code-verifier`,`${accountStorageKey}-user`,flowIndexKey,...flowKeys];
  if(!persistent.getItem(migrationKey)){
    if(!persistent.getItem(accountStorageKey)){
      for(const key of keys){const value=legacy.getItem(key);if(value!==null)persistent.setItem(key,value);}
    }
    persistent.setItem(migrationKey,'1');
  }
  for(const key of keys)legacy.removeItem(key);
  return persistent;
}

// Every private response belongs to one account generation, including responses
// that were already in flight when another tab signed out or switched accounts.
export class AccountBoundary{
  generation=0;
  constructor(public userId:string|null=null){}
  update(userId:string|null){if(userId===this.userId)return false;this.userId=userId;this.generation++;return true;}
  check(generation:number){if(generation!==this.generation)throw Error('Your account changed. Reload to continue.');}
}
export function createAccountClient(config:{supabaseUrl:string;publishableKey:string}){
  let storage:Store;
  try{storage=prepareAccountStorage(localStorage,sessionStorage);}catch{throw Error('Allow this site to store sign-in data in your browser, then reload.');}
  return createClient(config.supabaseUrl,config.publishableKey,{
    global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.any([AbortSignal.timeout(20_000),...(init?.signal?[init.signal]:[])])})},
    auth:{storage,storageKey:accountStorageKey,flowType:'pkce',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true},
  });
}
export function watchAccount(client:SupabaseClient,boundary:AccountBoundary,clear:()=>void){
  let reloading=false;
  const changed=(id:string|null)=>{
    if(!boundary.update(id))return;
    clear(); // Synchronous: remove private DOM before scheduling navigation.
    if(!reloading){reloading=true;setTimeout(()=>location.reload(),0);}
  };
  client.auth.onAuthStateChange((_event,session)=>changed(session?.user.id??null));
  // Also covers browsers without BroadcastChannel and explicit storage clearing.
  window.addEventListener('storage',event=>{
    if(event.storageArea!==localStorage||event.key!==null&&event.key!==accountStorageKey)return;
    let id:string|null=null;
    try{id=event.newValue?JSON.parse(event.newValue).user?.id??null:null;}catch{}
    changed(id);
  });
  // Back/forward cache can resume a page that missed sign-out broadcasts.
  // Never show its private snapshot until the current session is checked again.
  window.addEventListener('pageshow',event=>{if(event.persisted&&boundary.userId!==null)changed(null);});
}
