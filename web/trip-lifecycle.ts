type Context={id:string;name:string;archived:boolean;revision:number;role:'owner'|'editor'|'viewer'};
type Mutate=(operation:string,args:Record<string,unknown>)=>Promise<any>;
export function configureTripLifecycle(mutate:Mutate,changed:(action:string,id:string)=>Promise<void>,message:(text:string)=>void){
  const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
  const dialog=$<HTMLDialogElement>('lifecycle-dialog'),form=$<HTMLFormElement>('lifecycle-form'),name=$<HTMLInputElement>('lifecycle-name'),submit=$<HTMLButtonElement>('lifecycle-confirm');
  let context:Context|null=null,review:any=null,generation=0,busy=false;
  function clear(){generation++;review=null;dialog.close();$<HTMLDetailsElement>('trip-actions').open=false;form.reset();for(const id of ['lifecycle-title','lifecycle-trip','lifecycle-effects','lifecycle-counts','lifecycle-error'])$(id).textContent='';}
  function controls(){submit.disabled=busy||!review||(review.action==='delete'&&name.value!==review.trip.name);for(const id of ['archive-trip','restore-trip','delete-trip','leave-trip'])$<HTMLButtonElement>(id).disabled=busy;}
  async function archive(restore:boolean){if(!context||busy)return;const current=context,stamp=generation;busy=true;controls();
    try{await mutate(restore?'restore_trip':'archive_trip',{tripId:current.id,expectedRevision:current.revision});if(stamp!==generation)return;await changed(restore?'restore':'archive',current.id);message(restore?'Trip restored.':'Trip archived. Find it under Archived; sharing stays active.');}
    catch(error){if(stamp===generation)message(error instanceof Error?error.message:'Unable to change this trip.');}finally{busy=false;controls();}
  }
  async function prepare(action:'delete'|'leave'){
    if(!context||busy)return;clear();const stamp=generation,current=context;busy=true;controls();
    $('lifecycle-title').textContent=action==='delete'?'Delete trip permanently?':'Leave this trip?';$('lifecycle-trip').textContent=current.name;$('lifecycle-error').textContent='Loading the current trip for review…';submit.textContent=action==='delete'?'Delete permanently':'Leave trip';submit.className='danger';$('lifecycle-name-label').hidden=action!=='delete';name.required=action==='delete';dialog.showModal();
    try{const data=await mutate('prepare_trip_action',{tripId:current.id,action});if(stamp!==generation||!dialog.open)return;
      if(!data.confirmationToken)throw Error('This review expired. Close and review the trip again.');review=data;
      $('lifecycle-trip').textContent=`${data.trip.name} · ${data.trip.startDate} to ${data.trip.endDate} · Trip ID ${data.trip.id}`;
      $('lifecycle-effects').textContent=data.warning;
      $('lifecycle-counts').textContent=data.counts?`${data.counts.items} itinerary items (including removed items), ${data.counts.decisions} research decisions, ${data.counts.comments} comments, ${data.counts.members} active ${data.counts.members===1?'collaborator':'collaborators'} and ${data.counts.links} active invitations/view links. Your account profile and reusable policy notes stay in your account.`:'Your shared contributions stay with the trip. Other members keep their access.';
      $('lifecycle-error').textContent='';if(action==='delete')name.focus();
    }catch(error){if(stamp===generation)$('lifecycle-error').textContent=error instanceof Error?error.message:'Unable to review this trip.';}
    finally{busy=false;controls();}
  }
  $('archive-trip').onclick=()=>void archive(false);$('restore-trip').onclick=()=>void archive(true);
  $('delete-trip').onclick=()=>void prepare('delete');$('leave-trip').onclick=()=>void prepare('leave');name.oninput=controls;
  dialog.addEventListener('close',()=>{generation++;review=null;form.reset();controls();});
  form.onsubmit=event=>{event.preventDefault();if(busy||!review||submit.disabled)return;const current=review,stamp=generation;busy=true;controls();
    void(async()=>{try{await mutate(current.action==='delete'?'delete_trip':'leave_trip',{tripId:current.trip.id,expectedRevision:current.expectedRevision,confirmationToken:current.confirmationToken,confirmationName:current.action==='delete'?name.value:current.trip.name,confirmed:true});if(stamp!==generation)return;dialog.close();await changed(current.action,current.trip.id);message(current.action==='delete'?'Trip permanently deleted. No external booking was cancelled.':'You left the trip. Your shared contributions remain.');}
      catch(error){if(stamp===generation){$('lifecycle-error').textContent=error instanceof Error?error.message:'Unable to finish.';if(error&&typeof error==='object'&&'code'in error&&['REVISION_CONFLICT','CONFIRMATION_REQUIRED'].includes(String(error.code))){review=null;$('lifecycle-error').textContent+=' Close this dialog and review again.';}}}
      finally{busy=false;controls();}})();
  };
  return {update(next:Context|null,archived:boolean){if(context?.id!==next?.id)clear();context=next;$('trip-actions').hidden=!next;$('trip-archived').hidden=!archived;
    $('archive-trip').hidden=!next||next.role!=='owner'||next.archived;$('restore-trip').hidden=!next||next.role!=='owner'||!next.archived;$('delete-trip').hidden=!next||next.role!=='owner';$('leave-trip').hidden=!next||next.role==='owner';controls();},reset(){clear();context=null;$('trip-actions').hidden=true;$('trip-archived').hidden=true;}};
}
