type Comment={id:string;itemId:string|null;itemTitle:string|null;itemRemoved:boolean;body:string|null;authorName:string;authorRole:string;isMine:boolean;canRemove:boolean;createdAt:string;deletedAt:string|null};
type Page={comments:Comment[];nextBefore:string|null;canComment:boolean;thread:{title:string;removed:boolean}|null};
type Context={tripId:string;allowed:boolean};
export function configureDiscussion(options:{context:()=>Context|null;api:(operation:string,input:unknown)=>Promise<any>}){
  const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
  const dialog=$<HTMLDialogElement>('discussion-dialog'),form=$<HTMLFormElement>('comment-form'),body=$<HTMLTextAreaElement>('comment-body');
  let tripId='',itemId:string|null=null,comments:Comment[]=[],next:string|null=null,generation=0,busy=false;
  let pending:{signature:string;key:string}|null=null;
  function node(tag:string,text:string,className=''){const el=document.createElement(tag);el.textContent=text;el.className=className;return el;}
  function error(e:unknown){$('discussion-error').textContent=e instanceof Error?e.message:'Unable to load discussion.';}
  function draw(){
    $('comment-list').replaceChildren(...comments.map(c=>{
      const el=node('article','','discussion-comment'),meta=node('p',`${c.authorRole==='owner'?'Trip organizer':c.authorName+' · editor'}${c.isMine?' · you':''} · ${new Date(c.createdAt).toLocaleString('en-GB')}`,'comment-meta');
      el.append(meta);
      if(c.itemId&&!itemId)el.append(node('p',`${c.itemTitle??'Itinerary item'}${c.itemRemoved?' · removed from plan':''}`,'comment-context'));
      el.append(node('p',c.body??'Comment removed',c.body===null?'muted':'comment-text'));
      if(c.canRemove){const remove=node('button','Remove comment','subtle') as HTMLButtonElement;remove.type='button';remove.disabled=busy;remove.onclick=()=>void change('remove_itinerary_comment',{commentId:c.id});el.append(remove);}
      return el;
    }));
    $('discussion-empty').hidden=comments.length>0;$('comments-earlier').hidden=!next;
  }
  async function refresh(earlier=false){
    const version=++generation,activeTrip=tripId;
    $('discussion-error').textContent='';
    try{
      const page:Page=await options.api('list_itinerary_comments',{tripId:activeTrip,...(itemId?{itemId}:{}),...(earlier&&next?{before:next}:{}),limit:20});
      if(version!==generation||!dialog.open)return;
      comments=earlier?[...page.comments,...comments]:page.comments;next=page.nextBefore;
      $('discussion-title').textContent=page.thread?.title??'Trip discussion';
      $('discussion-scope').textContent=page.thread?.removed?'This item was removed from the plan. Its discussion stays available.':itemId?'Discussion for this itinerary item.':'Recent comments from across the trip. Load earlier to see more.';
      form.hidden=!page.canComment;$('discussion-readonly').hidden=page.canComment;
      $('discussion-readonly').textContent=page.thread?.removed?'This thread is read only because the item was removed.':'You can read discussion. Posting requires editor access.';draw();
    }catch(e){if(version!==generation)return;comments=[];next=null;form.hidden=true;draw();error(e);}
  }
  async function change(operation:string,args:Record<string,unknown>){
    if(busy)return;busy=true;$<HTMLButtonElement>('discussion-close').disabled=true;form.querySelector('button')!.disabled=true;$('discussion-error').textContent='';
    const signature=JSON.stringify([operation,tripId,args]);if(!pending||pending.signature!==signature)pending={signature,key:crypto.randomUUID()};
    try{await options.api(operation,{tripId,...args,idempotencyKey:pending.key});pending=null;if(operation==='add_itinerary_comment')body.value='';await refresh();}
    catch(e){error(e);}finally{busy=false;$<HTMLButtonElement>('discussion-close').disabled=false;form.querySelector('button')!.disabled=false;draw();}
  }
  async function open(target:string|null=null){
    const context=options.context();if(busy||!context?.allowed)return;
    tripId=context.tripId;itemId=target;comments=[];next=null;body.value='';pending=null;
    $('discussion-title').textContent='Discussion';$('discussion-scope').textContent='Loading…';$('discussion-readonly').hidden=true;form.hidden=true;draw();
    dialog.showModal();await refresh();
  }
  form.onsubmit=e=>{e.preventDefault();if(body.reportValidity())void change('add_itinerary_comment',{itemId,body:body.value});};
  $('discussion-refresh').onclick=()=>{if(!busy)void refresh();};$('comments-earlier').onclick=()=>{if(!busy)void refresh(true);};
  $('discussion-close').onclick=()=>dialog.close();
  dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});dialog.addEventListener('close',()=>{generation++;comments=[];draw();});
  window.addEventListener('focus',()=>{if(dialog.open&&!busy)void refresh();});
  return {open,reset(){const context=options.context();$('trip-discussion').hidden=!context?.allowed;if(dialog.open&&(!context?.allowed||context.tripId!==tripId)){generation++;dialog.close();body.value='';}}};
}
