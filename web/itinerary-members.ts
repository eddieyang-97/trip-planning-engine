import {avatarElement,type PublicProfile} from './profile-display.js';
type Member=PublicProfile&{role:'owner'|'editor'|'viewer';isMe:boolean};
export function configureMembers(root:HTMLElement,api:(operation:string,input:unknown)=>Promise<any>){
  let generation=0;
  function reset(){generation++;root.replaceChildren();root.hidden=true;}
  async function load(tripId:string){
    const current=++generation;root.hidden=false;root.textContent='Loading trip members…';
    try{
      const data=await api('trip-members',{tripId});if(current!==generation)return;
      const heading=document.createElement('h3');heading.textContent='Trip members';
      const list=document.createElement('ul');list.className='member-roster';list.setAttribute('aria-label','Accepted trip members');
      for(const m of data.members as Member[]){const row=document.createElement('li'),copy=document.createElement('div'),name=document.createElement('strong'),detail=document.createElement('span');
        name.textContent=m.displayName+(m.isMe?' · you':'');detail.textContent=`${m.handle?'@'+m.handle+' · ':''}${m.role==='owner'?'Organizer':m.role==='editor'?'Editor':'Viewer'}`;copy.append(name,detail);row.append(avatarElement(m),copy);list.append(row);
      }
      const note=document.createElement('p');note.className='field-hint';note.textContent='Accepted members only. Pending invitations appear in the organizer’s Share trip controls.';root.replaceChildren(heading,list,note);
    }catch(error){if(current!==generation)return;root.replaceChildren();const text=document.createElement('p');text.textContent=error instanceof Error?error.message:'Unable to load members.';const retry=document.createElement('button');retry.type='button';retry.className='subtle';retry.textContent='Retry members';retry.onclick=()=>void load(tripId);root.append(text,retry);}
  }
  return {load,reset};
}
