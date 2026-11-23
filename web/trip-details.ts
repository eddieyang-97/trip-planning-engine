import {isTemporaryReadError} from './itinerary-read-response.js';

type Details = {name:string;destination:string};
type Trip = {id:string;payload:Details;lifecycle_revision?:number};
type Snapshot = Details & {tripId:string;expectedRevision:number};
type Request = Snapshot & {idempotencyKey:string};

export function configureTripDetails(options:{
  read:(tripId:string)=>Promise<Trip|null>;
  save:(request:Request)=>Promise<{unchanged:boolean}>;
  reload:(tripId:string)=>Promise<boolean>;
  message:(text:string)=>void;
}){
  // The itinerary can load markup and its script from different releases.
  if(!document.getElementById('trip-details-dialog'))return;
  const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
  const open=$<HTMLButtonElement>('edit-trip-details'),dialog=$<HTMLDialogElement>('trip-details-dialog');
  const form=$<HTMLFormElement>('trip-details-form'),name=$<HTMLInputElement>('trip-details-name');
  const destination=$<HTMLInputElement>('trip-details-destination'),error=$('trip-details-error');
  const save=$<HTMLButtonElement>('trip-details-save'),cancel=$<HTMLButtonElement>('trip-details-cancel');
  const refresh=$<HTMLButtonElement>('trip-details-refresh'),current=$('trip-details-current');
  const currentName=$('trip-details-current-name'),currentDestination=$('trip-details-current-destination');
  let snapshot:Snapshot|null=null;
  let edit:{base:Snapshot;pending?:Request;reviewRequired:boolean;busy:boolean}|null=null;

  function snapshotOf(trip:Trip|null):Snapshot|null{
    if(!trip||trip.lifecycle_revision===undefined)return null;
    const {name,destination}=trip.payload;
    return {tripId:trip.id,expectedRevision:trip.lifecycle_revision,name,destination};
  }
  function controls(){
    name.disabled=destination.disabled=!!(edit?.busy||edit?.pending);
    save.disabled=!!(edit?.busy||edit?.reviewRequired);
    cancel.disabled=refresh.disabled=!!edit?.busy;
    refresh.hidden=!edit?.reviewRequired;
    save.textContent=edit?.pending?'Retry save':'Save changes';
  }
  function dismiss(){
    edit=null;
    dialog.close();
    form.reset();
    error.textContent=currentName.textContent=currentDestination.textContent='';
    current.hidden=true;
    controls();
  }
  function unavailable(){
    snapshot=null;
    open.hidden=true;
    dismiss();
    options.message('This trip is unavailable. Refresh to see your trips.');
  }
  function denied(cause:unknown){
    return cause instanceof Error&&('code' in cause&&cause.code==='FORBIDDEN_OR_NOT_FOUND'||
      'status' in cause&&[403,404].includes(Number(cause.status)));
  }

  open.onclick=()=>{
    if(!snapshot)return;
    edit={base:snapshot,reviewRequired:false,busy:false};
    name.value=snapshot.name;
    destination.value=snapshot.destination;
    controls();
    dialog.showModal();
  };
  cancel.onclick=dismiss;
  dialog.oncancel=event=>{event.preventDefault();if(!edit?.busy)dismiss();};

  refresh.onclick=async()=>{
    const draft=edit;
    if(!draft||draft.busy)return;
    draft.busy=true;controls();
    try{
      const latest=snapshotOf(await options.read(draft.base.tripId));
      if(edit!==draft)return;
      if(!latest){unavailable();return;}
      draft.base=snapshot=latest;
      draft.reviewRequired=false;
      currentName.textContent=latest.name;
      currentDestination.textContent=latest.destination;
      current.hidden=false;
      error.textContent='Review your draft against the saved details before saving again.';
    }catch(cause){
      if(edit!==draft)return;
      if(denied(cause))unavailable();
      else error.textContent='Couldn’t load the current trip details. Try again.';
    }finally{draft.busy=false;controls();}
  };

  form.onsubmit=async event=>{
    event.preventDefault();
    const draft=edit;
    if(!draft||draft.busy||draft.reviewRequired)return;
    const request=draft.pending??{...draft.base,name:name.value.trim(),destination:destination.value.trim(),idempotencyKey:crypto.randomUUID()};
    if(!request.name||!request.destination){error.textContent='Enter a trip name and destination.';return;}
    draft.busy=true;error.textContent='';controls();
    try{
      const result=await options.save(request);
      if(edit!==draft)return;
      const refreshed=await options.reload(request.tripId).catch(()=>false);
      if(edit!==draft)return;
      dismiss();
      options.message(refreshed?(result.unchanged?'Trip details are unchanged.':'Trip details saved.'):'Trip details saved. Refresh to see the latest values.');
    }catch(cause){
      if(edit!==draft)return;
      if(denied(cause)){unavailable();return;}
      draft.pending=isTemporaryReadError(cause)?request:undefined;
      draft.reviewRequired=cause instanceof Error&&'code' in cause&&cause.code==='REVISION_CONFLICT';
      current.hidden=true;
      error.textContent=draft.pending?'The save could not be confirmed. Retry to check the same save.':
        cause instanceof Error?cause.message:'Couldn’t save trip details.';
    }finally{draft.busy=false;controls();}
  };

  return {update(trip:Trip|null){
    const next=snapshotOf(trip);
    if(snapshot?.tripId!==next?.tripId)dismiss();
    snapshot=next;
    open.hidden=!next;
  }};
}
