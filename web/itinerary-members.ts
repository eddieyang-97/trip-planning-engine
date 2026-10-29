import {avatarElement,type PublicProfile} from './profile-display.js';
type Member=PublicProfile&{role:'owner'|'editor'|'viewer';isMe:boolean};
export function configureMembers(root:HTMLElement,api:(operation:string,input:unknown)=>Promise<any>){
  let generation=0,activeTrip='',expanded=false;
  function reset(){generation++;activeTrip='';expanded=false;root.replaceChildren();root.hidden=true;}
  async function load(tripId:string){
    if(activeTrip!==tripId){activeTrip=tripId;expanded=matchMedia('(min-width:701px)').matches;}
    const current=++generation;root.hidden=false;root.textContent='Loading trip members…';
    try{
      const data=await api('trip-members',{tripId});if(current!==generation)return;
      const details=document.createElement('details'),heading=document.createElement('summary'),avatars=document.createElement('span');
      heading.textContent=`${data.members.length} trip ${data.members.length===1?'member':'members'}`;avatars.className='member-preview';
      for(const member of (data.members as Member[]).slice(0,3))avatars.append(avatarElement(member));heading.append(avatars);
      details.open=expanded;details.ontoggle=()=>{if(current===generation)expanded=details.open;};
      const list=document.createElement('ul');list.className='member-roster';list.setAttribute('aria-label','Accepted trip members');
      for(const m of data.members as Member[]){const row=document.createElement('li'),copy=document.createElement('div'),name=document.createElement('strong'),detail=document.createElement('span');
        name.textContent=m.displayName+(m.isMe?' · you':'');detail.textContent=m.role==='owner'?'Organizer':m.role==='editor'?'Editor':'Viewer';copy.append(name,detail);row.append(avatarElement(m),copy);list.append(row);
      }
      const note=document.createElement('p');note.className='field-hint';note.textContent='Accepted members only. Pending invitations appear in the organizer’s Share trip controls.';details.append(heading,list,note);root.replaceChildren(details);
    }catch(error){if(current!==generation)return;root.replaceChildren();const text=document.createElement('p');text.textContent=error instanceof Error?error.message:'Unable to load members.';const retry=document.createElement('button');retry.type='button';retry.className='subtle';retry.textContent='Retry members';retry.onclick=()=>void load(tripId);root.append(text,retry);}
  }
  return {load,reset};
}
