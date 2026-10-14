import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ItineraryItem } from '../src/itinerary.js';
import type {ItineraryResearch} from '../src/itinerary-research.js';
import {renderResearch,researchQuestions} from './itinerary-research.js';
import {configureSharing,openInvitation,pendingInvitation} from './itinerary-sharing.js';

type Row={id:string;payload:ItineraryItem;position:number};
type Trip={id:string;role?:'owner'|'viewer';payload:{name:string;destination:string;startDate:string;endDate:string;adults:number}};
type Plan={trip:Trip;role?:'owner'|'viewer';revision:number;items:Row[];history:any[];research?:ItineraryResearch};
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const demo=new URL(location.href).searchParams.get('demo')==='1';
let trips:Trip[]=[],plan:Plan|null=null,client:SupabaseClient|null=null,localToken='',editing:Row|null=null,removing:Row|null=null;
let pending:{signature:string;key:string}|null=null;
let loading=false;
const names:Record<ItineraryItem['type'],string>={flight:'Flight',accommodation:'Stay',transfer:'Transfer',activity:'Activity',restaurant:'Food & drink',note:'Note'};
const icons:Record<ItineraryItem['type'],string>={flight:'↗',accommodation:'⌂',transfer:'⇄',activity:'◇',restaurant:'♧',note:'≡'};
const blank:ItineraryItem={type:'activity',title:'',startDate:null,startTime:null,endDate:null,endTime:null,timeZone:null,endTimeZone:null,
  location:'',url:null,notes:'',openQuestion:'',status:'tentative',bookingNote:''};
function node<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className=''){
  const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;
}
function button(text:string,action:()=>void,className=''){const b=node('button',text,className);b.type='button';b.onclick=action;return b;}
function date(value:string,options:Intl.DateTimeFormatOptions={day:'numeric',month:'short'}){
  return new Intl.DateTimeFormat('en-GB',{...options,timeZone:'UTC'}).format(new Date(`${value}T12:00:00Z`));
}
function message(text:string){$('status').textContent=text;}
function errorText(error:unknown){return error instanceof Error?error.message:'Unable to finish. Please try again.';}
function showPlan(id:string){void loadPlan(id).catch(error=>message(errorText(error)));}
async function api(operation:string,input:unknown){
  let token=localToken;
  if(client){const {data:{session},error}=await client.auth.getSession();if(error||!session)throw Error('Sign in to your travel account again.');token=session.access_token;}
  let response:Response;
  try{response=await fetch(`/itinerary-api/${operation}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(input),signal:AbortSignal.timeout(60_000)});}
  catch{throw Error('The itinerary service did not respond. Refresh to check saved changes before trying again.');}
  let result:any;try{result=await response.json();}catch{throw Error('Unable to read the itinerary response. Refresh to check saved changes.');}
  if(!response.ok)throw Object.assign(Error(result.error??'Unable to finish. Please try again.'),{code:result.code});return result;
}
async function mutate(operation:string,args:Record<string,unknown>){
  const signature=JSON.stringify([operation,args]);
  if(!pending||pending.signature!==signature)pending={signature,key:crypto.randomUUID()};
  const result=await api(operation,{...args,idempotencyKey:pending.key});pending=null;return result;
}
async function loadTrips(selectId?:string){
  if(!demo){
    trips=[];
    // Retrieve all pages rather than silently hiding older trips.
    for(let offset=0;;offset+=50){const page=await api('list_trips',{limit:50,offset});trips.push(...page.trips);if(page.trips.length<50)break;}
  }
  $('workspace').hidden=false;$('access').hidden=true;
  const requested=selectId??new URL(location.href).searchParams.get('trip');
  const available=requested&&trips.some(trip=>trip.id===requested);
  if(selectId&&!available){plan=null;render();throw Error('This itinerary is unavailable. Its access may have been revoked.');}
  const id=available?requested:trips[0]?.id;
  render();
  if(id){await loadPlan(id);}else{plan=null;render();message('');}
  if(requested&&!available)message('The requested trip is not available in this account. Choose one of your trips, or create a new one.');
}
async function loadPlan(id:string){
  if(loading)return;loading=true;message('Loading your itinerary…');
  try{
    if(!demo)plan=await api('get_itinerary',{tripId:id});
    const url=new URL(location.href);url.searchParams.set('trip',id);history.replaceState(null,'',url);
    render();message('');
  }catch(error){plan=null;
    if(error&&typeof error==='object'&&'code' in error&&error.code==='FORBIDDEN_OR_NOT_FOUND')trips=trips.filter(t=>t.id!==id);
    render();message(errorText(error));throw error;}finally{loading=false;}
}
function allDates(){
  if(!plan)return [];
  const dates=new Set(plan.items.map(i=>i.payload.startDate).filter((d):d is string=>!!d));
  const start=new Date(`${plan.trip.payload.startDate}T12:00:00Z`),end=plan.trip.payload.endDate;
  // Long trips show their populated dates plus the first 60 days, with an explicit notice.
  for(let n=0;n<60;n++){const day=start.toISOString().slice(0,10);if(day>end)break;dates.add(day);start.setUTCDate(start.getUTCDate()+1);}
  return [...dates].sort();
}
function render(){
  $('trip-list').replaceChildren(...trips.map(t=>{
    const b=button(t.payload.name,()=>showPlan(t.id),`trip-choice ${plan?.trip.id===t.id?'active':''}`);
    b.append(node('span',`${t.payload.destination} · ${date(t.payload.startDate)}${t.role==='viewer'?' · Shared, view only':''}`));if(plan?.trip.id===t.id)b.setAttribute('aria-current','page');return b;
  }));
  $('empty-trips').hidden=!!plan||trips.length>0;$('trip-view').hidden=!plan;if(!plan)return;
  const p=plan.trip.payload,booked=plan.items.filter(i=>i.payload.status==='user_reported_booked').length,unscheduled=plan.items.filter(i=>!i.payload.startDate).length;
  const viewer=plan.role==='viewer';
  $('add-item').hidden=viewer;$('share-trip').hidden=viewer||demo;$('history-section').hidden=viewer;
  $('people-detail').textContent=viewer?'Shared with you. You can view this itinerary; the trip owner controls edits and access.':'Invite a friend to view this trip. Invitations are private, apply to one trip and can be revoked.';
  $('booking-detail').textContent='Bookings are reported by the trip owner. Adding a plan never makes a reservation.';
  if(viewer)$('plan-empty').textContent='The owner has not added any items yet. Refresh later to see their plan.';
  else $('plan-empty').textContent='Your itinerary has no saved items yet. Review a flight above, or add a stay, transfer or activity. Saving research does not automatically add it to your plan.';
  $('trip-title').textContent=p.name;$('trip-destination').textContent=p.destination;
  $('trip-meta').replaceChildren(node('span',`${date(p.startDate)} – ${date(p.endDate,{day:'numeric',month:'short',year:'numeric'})}`),node('span',`${p.adults} adults${demo?' · assumed':''}`),node('span',viewer?'Shared · view only':'Your itinerary'));
  $('progress').replaceChildren(...[[`${plan.items.length}`,'items in the plan'],[`${booked}`,'bookings reported'],[`${unscheduled}`,'without a date']].map(([count,label])=>{const row=node('div','','progress-row');row.append(node('span',label!),node('strong',count!));return row;}));
  renderResearch($('research'),plan.research,item=>{
    const existing=plan!.items.find(row=>row.payload.type==='flight'&&row.payload.startDate===item.startDate
      &&row.payload.startTime===item.startTime&&row.payload.endDate===item.endDate&&row.payload.endTime===item.endTime&&row.payload.location===item.location);
    openItem(existing??null,existing?undefined:item);
  },plan.items.length===0);
  $('plan-empty').hidden=plan.items.length>0;
  const questions=plan.items.filter(i=>i.payload.openQuestion);
  const researchOpen=researchQuestions(plan.research);
  $('questions').replaceChildren(...questions.map(i=>{const q=node('div','','question-mini');q.append(node('strong',i.payload.title),node('span',i.payload.openQuestion));return q;}),
    ...researchOpen.map(text=>node('p',text,'question-mini')),...(questions.length||researchOpen.length?[]:[node('p','No open questions recorded. Add one to any item as you plan.','muted')]));
  $('history').replaceChildren(...(plan.history.length?plan.history.map(h=>{const el=node('div',`${h.action[0].toUpperCase()+h.action.slice(1)}: ${(h.after_payload??h.before_payload)?.payload?.title??'Item'}`,'history-event');el.append(node('span',new Date(h.created_at).toLocaleString('en-GB')));return el;}):[node('p','Your saved changes will appear here.','muted')]));
  const dates=allDates();$('timeline').replaceChildren();$('day-nav').replaceChildren();
  if((Date.parse(p.endDate)-Date.parse(p.startDate))/86400000>=60)$('timeline').append(node('p','Showing the first 60 days and all dates with saved items.','muted'));
  for(const day of [...dates,'unscheduled']){
    const group=plan.items.filter(i=>day==='unscheduled'?!i.payload.startDate:i.payload.startDate===day).sort((a,b)=>a.position-b.position);
    const section=node('section','','day');section.id=`day-${day}`;
    const nav=node('a',day==='unscheduled'?`Unscheduled${unscheduled?` (${unscheduled})`:''}`:date(day,{weekday:'short',day:'numeric',month:'short'}));nav.href=`#${section.id}`;$('day-nav').append(nav);
    const heading=node('div','','day-heading'),copy=node('div');heading.append(node('span',day==='unscheduled'?'…':day.slice(8),'day-number'));
    copy.append(node('h3',day==='unscheduled'?'Unscheduled':date(day,{weekday:'long'})),node('p',day==='unscheduled'?'Good ideas, waiting for their moment':date(day,{day:'numeric',month:'long',year:'numeric'})));heading.append(copy);section.append(heading);
    if(!group.length)section.append(node('p',viewer?'No items planned here yet.':day==='unscheduled'?'Everything has a date. New ideas can live here until you’re ready.':'A little breathing room. Add something when you’re ready.','empty-day'));
    for(const [index,row]of group.entries())section.append(card(row,index,group.length));
    $('timeline').append(section);
  }
}
function card(row:Row,index:number,count:number){
  const item=row.payload,el=node('article','','item'),top=node('div','','item-top'),copy=node('div');
  top.append(node('span',icons[item.type],'item-icon'));copy.append(node('span',names[item.type],'item-type'),node('h3',item.title));top.append(copy);el.append(top);
  const detail=node('div','','item-details');detail.append(node('span',item.status==='tentative'?'Tentative':plan?.role==='viewer'?'Booked · reported by owner':'Booked · reported by you',`badge ${item.status==='tentative'?'':'booked'}`));
  if(item.startTime)detail.append(node('p',`${item.startTime} · ${item.timeZone??'time zone not set'}`));
  else detail.append(node('p',item.startDate?'Time not set':'Date and time not set'));
  if(item.endDate)detail.append(node('p',`Until ${date(item.endDate)}${item.endTime?` at ${item.endTime} · ${item.endTimeZone??'time zone not set'}`:''}`));
  if(item.location)detail.append(node('p',item.location));if(item.notes)detail.append(node('p',item.notes,'notes'));
  if(item.bookingNote)detail.append(node('p',`Booking note: ${item.bookingNote}`,'notes'));
  if(item.openQuestion)detail.append(node('p',item.openQuestion,'question'));el.append(detail);
  const actions=node('div','','item-actions');
  if(item.url){const a=node('a','Open useful link ↗');a.href=item.url;a.target='_blank';a.rel='noopener noreferrer';actions.append(a);}
  if(plan?.role!=='viewer'){
  actions.append(button('Edit',()=>openItem(row)),button('Remove',()=>{removing=row;$('remove-title').textContent=item.title;$('remove-error').textContent='';$<HTMLDialogElement>('remove-dialog').showModal();}));
  for(const direction of ['up','down'] as const){const b=button(direction==='up'?'↑':'↓',()=>void move(row,direction));b.setAttribute('aria-label',`Move ${item.title} ${direction}`);b.disabled=direction==='up'?index===0:index===count-1;actions.append(b);}
  }
  el.append(actions);return el;
}
function bookingField(){const booked=$<HTMLSelectElement>('item-status').value==='user_reported_booked';$('booking-label').hidden=!booked;($<HTMLFormElement>('item-form').elements.namedItem('bookingNote') as HTMLTextAreaElement).required=booked;}
function openItem(row:Row|null,draft?:ItineraryItem){
  editing=row;pending=null;const form=$<HTMLFormElement>('item-form');form.reset();
  const payload=row?.payload??draft??blank;
  for(const [key,value]of Object.entries(payload)){const field=form.elements.namedItem(key) as HTMLInputElement|null;if(field)field.value=value??'';}
  $('editor-title').textContent=row?'Edit this item':draft?'Review flight for your plan':'Add to the plan';$('research-draft').hidden=!draft;$('item-error').textContent='';bookingField();$<HTMLDialogElement>('item-dialog').showModal();
}
async function withForm(form:HTMLFormElement,errorId:string,work:()=>Promise<void>){
  const b=form.querySelector<HTMLButtonElement>('button[type=submit]')!;b.disabled=true;$(errorId).textContent='';
  try{await work();}catch(error){$(errorId).textContent=errorText(error);}finally{b.disabled=false;}
}
function demoChange(action:string,id:string,payload?:ItineraryItem){
  const previous=plan!.items.find(i=>i.id===id);const before=previous?{payload:previous.payload}:null;
  if(action==='added')plan!.items.push({id,payload:payload!,position:Math.max(0,...plan!.items.map(i=>i.position))+1});
  if(action==='edited')previous!.payload=payload!;
  if(action==='removed')plan!.items=plan!.items.filter(i=>i.id!==id);
  plan!.revision++;plan!.history.unshift({action,before_payload:before,after_payload:payload?{payload}:null,created_at:new Date().toISOString()});render();
}
$<HTMLFormElement>('item-form').onsubmit=event=>{
  event.preventDefault();const form=event.currentTarget as HTMLFormElement;
  void withForm(form,'item-error',async()=>{
    const fields=Object.fromEntries(new FormData(form)),item={...fields} as unknown as ItineraryItem;
    for(const field of ['startDate','startTime','endDate','endTime','timeZone','endTimeZone','url'] as const)item[field]=String(fields[field]??'').trim()||null;
    if(item.status==='tentative')item.bookingNote='';
    // Server is authoritative. Demo uses these small checks without importing backend dependencies.
    if(item.startTime&&!item.startDate||item.endTime&&!item.endDate)throw Error('Add a date for each time, or leave the time empty.');
    if(item.status==='user_reported_booked'&&!item.bookingNote.trim())throw Error('Add a booking note.');
    if(item.url){const url=new URL(item.url);if(url.protocol!=='https:'||url.username||url.password)throw Error('Use an HTTPS link without credentials.');}
    if(demo)demoChange(editing?'edited':'added',editing?.id??crypto.randomUUID(),item);
    else{await mutate(editing?'update_itinerary_item':'add_itinerary_item',{tripId:plan!.trip.id,expectedRevision:plan!.revision,...(editing?{itemId:editing.id}:{}),item});await loadPlan(plan!.trip.id);}
    $<HTMLDialogElement>('item-dialog').close();message(demo?'Example updated. Reloading restores the demo.':'Saved to your itinerary.');
  });
};
$<HTMLFormElement>('remove-form').onsubmit=event=>{event.preventDefault();void withForm(event.currentTarget as HTMLFormElement,'remove-error',async()=>{
  if(demo)demoChange('removed',removing!.id);else{await mutate('remove_itinerary_item',{tripId:plan!.trip.id,itemId:removing!.id,expectedRevision:plan!.revision});await loadPlan(plan!.trip.id);}
  $<HTMLDialogElement>('remove-dialog').close();message('Removed from the plan. No reservation was cancelled.');
});};
async function move(row:Row,direction:'up'|'down'){
  if(loading)return;loading=true;
  try{
    if(demo){const peers=plan!.items.filter(i=>i.payload.startDate===row.payload.startDate).sort((a,b)=>a.position-b.position),other=peers[peers.indexOf(row)+(direction==='up'?-1:1)];if(other)[row.position,other.position]=[other.position,row.position];render();}
    else{await mutate('move_itinerary_item',{tripId:plan!.trip.id,itemId:row.id,direction,expectedRevision:plan!.revision});loading=false;await loadPlan(plan!.trip.id);}
  }catch(error){message(errorText(error));}finally{loading=false;}
}
function newTrip(){pending=null;$<HTMLFormElement>('trip-form').reset();$('trip-error').textContent='';$<HTMLDialogElement>('trip-dialog').showModal();}
$('new-trip').onclick=newTrip;$('first-trip').onclick=newTrip;$('add-item').onclick=()=>openItem(null);
$('refresh').onclick=()=>{if(demo)location.reload();else if(plan)showPlan(plan.trip.id);else void loadTrips().catch(e=>message(errorText(e)));};
$('item-status').onchange=bookingField;
$<HTMLFormElement>('trip-form').onsubmit=event=>{event.preventDefault();const form=event.currentTarget as HTMLFormElement;void withForm(form,'trip-error',async()=>{
  const fields=Object.fromEntries(new FormData(form));if(String(fields.endDate)<String(fields.startDate))throw Error('End date must follow start date.');
  const result=await mutate('create_trip',{...fields,adults:Number(fields.adults)});await loadTrips(result.tripId);$<HTMLDialogElement>('trip-dialog').close();
});};
for(const b of document.querySelectorAll<HTMLButtonElement>('[data-close]'))b.onclick=()=>$(b.dataset.close!) instanceof HTMLDialogElement&&$<HTMLDialogElement>(b.dataset.close!).close();
function setupDemo(){
  $('demo-banner').hidden=false;$('new-trip').hidden=true;
  const trip:Trip={id:'flaine-demo',payload:{name:'A weekend in Flaine',destination:'Flaine, French Alps',startDate:'2026-12-18',endDate:'2026-12-20',adults:4}};
  trips=[trip];
  const demoItems:Partial<ItineraryItem>[]=[
    {type:'flight',title:'London → the mountains',startDate:'2026-12-18',location:'London → Geneva (provisional)',notes:'Compare all London airports. Include snowboard carriage in the decision.',openQuestion:'Choose a flight and confirm the full party + snowboard cost.'},
    {type:'transfer',title:'Onward to Flaine',startDate:'2026-12-18',location:'Geneva → Flaine',openQuestion:'Can the transfer meet our flight, especially if arrival is late?'},
    {type:'accommodation',title:'A base for the weekend',startDate:'2026-12-18',endDate:'2026-12-20',location:'Flaine',notes:'An apartment or chalet for four, or two hotel rooms. Configuration still to decide.',openQuestion:'Confirm sleeping arrangements and late check-in.'},
    {type:'activity',title:'A day on the mountain',startDate:'2026-12-19',location:'Flaine',notes:'Leave the day open for snowboarding. Lift passes and conditions to check.'},
    {type:'restaurant',title:'Dinner, somewhere cosy',startDate:'2026-12-19',notes:'Find a place the whole group likes. Nothing reserved.'},
    {type:'flight',title:'One more run, then home',startDate:'2026-12-20',location:'Flaine → London',openQuestion:'Work backwards from the return flight to allow enough transfer time.'},
    {type:'note',title:'Before we go',notes:'Check snowboard bag dimensions, travel documents and equipment plans.'},
  ];
  plan={trip,revision:1,items:demoItems.map((item,index)=>({id:`demo-${index}`,position:index+1,payload:{...blank,...item}})),history:[]};
  $('workspace').hidden=false;render();
}
async function initialize(){
    if(demo){setupDemo();message('');return;}
  const invitation=pendingInvitation();
  if(invitation){$('access').querySelector('h1')!.textContent='You’ve been invited to a trip.';$('access').querySelectorAll('p')[1]!.textContent='Sign in or create an account to review the invitation. No AI assistant or API keys needed.';}
  const response=await fetch('/itinerary/config',{signal:AbortSignal.timeout(60_000)});if(!response.ok)throw Error('Unable to load the itinerary.');const config=await response.json();
  if(config.mode==='hosted'){
    client=createClient(config.supabaseUrl,config.publishableKey,{auth:{storage:sessionStorage,storageKey:'travel-account',flowType:'pkce',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    const {data:{session}}=await client.auth.getSession();if(session){if(await openInvitation(api,mutate,id=>loadTrips(id))){message('');return;}await loadTrips();return;}
  }
  $('access').hidden=false;message('');
  if(config.mode==='local'){$('local-login').hidden=false;$('hosted-access').hidden=true;
    $<HTMLFormElement>('local-login').onsubmit=event=>{event.preventDefault();localToken=$<HTMLInputElement>('local-token').value;$<HTMLInputElement>('local-token').value='';void (async()=>{if(await openInvitation(api,mutate,id=>loadTrips(id))){message('');return;}await loadTrips();})().catch(e=>message(errorText(e)));};
  }else if(config.mode==='unavailable')message('Account sign-in is not configured yet. You can explore the demo.');
}
configureSharing(api,mutate,()=>plan?.role==='viewer'?null:plan?.trip.id??null);
window.addEventListener('focus',()=>{if(plan?.role==='viewer'&&!loading)showPlan(plan.trip.id);});
void initialize().catch(error=>{message(errorText(error));if($('workspace').hidden)$('access').hidden=false;});
