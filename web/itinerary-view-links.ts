import {readItineraryResponse,temporaryReadError} from './itinerary-read-response.js';
const storageKey='travel-shared-view';
const valid=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
export function viewLinkToken(){
  const fragment=new URLSearchParams(location.hash.slice(1));
  if(fragment.has('leave-view')){sessionStorage.removeItem(storageKey);history.replaceState(null,'',location.pathname+location.search);return null;}
  if(fragment.has('invite')){sessionStorage.removeItem(storageKey);return null;}
  if(fragment.has('view')){
    const incoming=fragment.get('view');history.replaceState(null,'',location.pathname+location.search);sessionStorage.removeItem(storageKey);
    if(fragment.getAll('view').length!==1||!valid(incoming))throw Error('This view link is incomplete. Ask the owner for a new link.');
    sessionStorage.setItem(storageKey,incoming);return incoming;
  }
  const saved=sessionStorage.getItem(storageKey);if(valid(saved))return saved;
  sessionStorage.removeItem(storageKey);return null;
}
export async function loadViewLink(token:string){
  let response:Response;
  try{response=await fetch('/itinerary-share/read',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',cache:'no-store',body:JSON.stringify({token}),signal:AbortSignal.timeout(60_000)});}
  catch{throw temporaryReadError('Unable to load this shared itinerary. Check your connection and try again.');}
  return readItineraryResponse(response,'Unable to load this shared itinerary. Try again, or ask the owner for a new link.');
}
