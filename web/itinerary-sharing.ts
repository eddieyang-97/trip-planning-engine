type Api=(operation:string,input:unknown)=>Promise<any>;
type Mutate=(operation:string,input:Record<string,unknown>)=>Promise<any>;
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const storageKey='travel-pending-invitation';
const valid=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
const errorText=(error:unknown)=>error instanceof Error?error.message:'Unable to finish. Try again.';

// A URL fragment does not reach server access logs. Keep it in this tab only while
// navigating to sign-in; neither analytics nor external scripts run on these pages.
export function pendingInvitation(){
  const fragment=new URLSearchParams(location.hash.slice(1)),incoming=fragment.get('invite');
  if(incoming!==null){
    if(valid(incoming))sessionStorage.setItem(storageKey,JSON.stringify({token:incoming,at:Date.now()}));
    else sessionStorage.removeItem(storageKey);
    history.replaceState(null,'',location.pathname+location.search);
    if(!valid(incoming))throw Error('This invitation link is incomplete. Ask the trip owner for a new link.');
  }
  try{const saved=JSON.parse(sessionStorage.getItem(storageKey)??'null');
    if(saved&&valid(saved.token)&&Date.now()-saved.at<7*86400000&&saved.at<=Date.now())return saved.token as string;
  }catch{}
  sessionStorage.removeItem(storageKey);return null;
}
export async function openInvitation(api:Api,mutate:Mutate,joined:(id:string)=>Promise<void>){
  const token=pendingInvitation();if(!token)return false;
  $('workspace').hidden=true;$('access').hidden=true;$('invitation').hidden=false;
  $('invitation-error').textContent='';$('invitation-form').hidden=true;
  try{
    const preview=await api('get_itinerary_invite',{token}),p=preview.trip.payload;
    $('invitation-title').textContent=p.name;
    $('invitation-detail').textContent=`${p.destination} · ${p.startDate} to ${p.endDate} · ${p.adults} adults`;
    $('invitation-form').hidden=false;
    $('join-invitation').textContent=preview.alreadyJoined?'Open shared itinerary':'Join view-only itinerary';
    $<HTMLInputElement>('viewer-name').required=!preview.alreadyJoined;
    $('viewer-name-label').hidden=preview.alreadyJoined;
    $<HTMLFormElement>('invitation-form').onsubmit=event=>{
      event.preventDefault();const button=$<HTMLButtonElement>('join-invitation');button.disabled=true;
      void (async()=>{try{
        const result=preview.alreadyJoined?{tripId:preview.trip.id}:await mutate('accept_itinerary_invite',{token,displayName:$<HTMLInputElement>('viewer-name').value});
        // Fetching the itinerary checks current membership even for an already joined link.
        await joined(result.tripId);sessionStorage.removeItem(storageKey);$('invitation').hidden=true;
      }catch(error){$('invitation-error').textContent=errorText(error);}finally{button.disabled=false;}})();
    };
  }catch(error){$('invitation-title').textContent='Invitation unavailable';$('invitation-detail').textContent='Ask the trip owner to send a fresh invitation.';$('invitation-error').textContent=errorText(error);}
  return true;
}
export function configureSharing(api:Api,mutate:Mutate,tripId:()=>string|null){
  $('dismiss-invitation').onclick=event=>{event.preventDefault();sessionStorage.removeItem(storageKey);location.assign('/itinerary');};
  let currentTrip:string|null=null,link='';
  async function refresh(){
    const data=await api('list_itinerary_access',{tripId:currentTrip}),list=$('access-list');list.replaceChildren();
    if(!data.invites.length){list.textContent='Only you can view this itinerary. Create an invitation when you’re ready.';return;}
    for(const invite of data.invites){
      const row=document.createElement('div');row.className='access-row';
      const title=document.createElement('strong');title.textContent=invite.display_name??invite.label??'Invitation';if(!title.textContent)title.textContent='Invitation';
      const detail=document.createElement('p');detail.className='muted';
      const expired=new Date(invite.expires_at).getTime()<=Date.now();
      detail.textContent=invite.revoked_at?'Revoked':invite.accepted_at?'Joined · can view this itinerary':expired?'Expired · cannot be used':`Pending · expires ${new Date(invite.expires_at).toLocaleDateString('en-GB')}`;
      row.append(title,detail);
      if(!invite.revoked_at&&(!expired||invite.accepted_at)){
        const b=document.createElement('button');b.type='button';b.className='subtle';b.textContent=invite.accepted_at?'Revoke viewer access':'Revoke invitation';
        b.onclick=()=>{b.disabled=true;void (async()=>{try{await mutate('revoke_itinerary_access',{tripId:currentTrip,inviteId:invite.id});link='';$('created-link').hidden=true;await refresh();}
          catch(error){$('share-error').textContent=errorText(error);}finally{b.disabled=false;}})();};row.append(b);
      }
      list.append(row);
    }
  }
  $('share-trip').onclick=()=>{
    currentTrip=tripId();if(!currentTrip)return;
    link='';$('created-link').hidden=true;$('share-error').textContent='';$<HTMLFormElement>('invite-form').reset();
    $('access-list').textContent='Loading access…';$<HTMLDialogElement>('share-dialog').showModal();
    void refresh().catch(error=>{$('share-error').textContent=errorText(error);});
  };
  $<HTMLFormElement>('invite-form').onsubmit=event=>{
    event.preventDefault();const button=$<HTMLButtonElement>('create-invitation');button.disabled=true;$('share-error').textContent='';
    void (async()=>{try{
      const result=await mutate('create_itinerary_invite',{tripId:currentTrip,label:$<HTMLInputElement>('invite-label').value});
      if(!result.token)throw Error('The link cannot be recovered after a lost response. Revoke the new pending invitation below, then create a fresh one.');
      link=`${location.origin}/itinerary#invite=${result.token}`;$<HTMLInputElement>('invite-link').value=link;$('created-link').hidden=false;
      $('link-details').textContent=`One person can use this link before ${new Date(result.expiresAt).toLocaleDateString('en-GB')}. Copy it now; it is shown only here.`;
      await refresh();
    }catch(error){$('share-error').textContent=errorText(error);await refresh().catch(()=>{});}finally{button.disabled=false;}})();
  };
  $('copy-invite').onclick=()=>{void navigator.clipboard.writeText(link).then(()=>{$('share-error').textContent='Copied. Send this link privately to your friend.';}).catch(()=>{$('share-error').textContent='Select the link above and copy it manually.';$<HTMLInputElement>('invite-link').select();});};
}
