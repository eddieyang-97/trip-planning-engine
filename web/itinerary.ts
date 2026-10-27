import type {SupabaseClient} from '@supabase/supabase-js';
import {AccountBoundary,createAccountClient,watchAccount} from './account-session.js';
import {itemNames as names,itemIcons as icons} from './itinerary-categories.js';
import {verifyMapSave} from './itinerary-save-verification.js';
import type { ItineraryItem } from '../src/itinerary.js';
import type {ItineraryResearch} from '../src/itinerary-research.js';
import {renderResearch,researchQuestions} from './itinerary-research.js';
import {configureSharing,openInvitation,pendingInvitation} from './itinerary-sharing.js';
import {renderOverview} from './itinerary-overview.js';
import {viewLinkToken,loadViewLink} from './itinerary-view-links.js';
import {configureCalendarExport} from './itinerary-calendar.js';
import {configureTimezonePickers} from './timezone-picker.js';
import {configureDiscussion} from './itinerary-comments.js';
import {configureMap} from './itinerary-map.js';
import {configureMapEditor} from './itinerary-map-editor.js';
import {configureMembers} from './itinerary-members.js';
import {configureTripLifecycle} from './trip-lifecycle.js';
import {configureDiningComparison} from './dining-comparison.js';
import {configureStayComparison} from './stay-comparison.js';

type Row={id:string;payload:ItineraryItem;position:number;sourceLink?:{decisionId:string;webPath:string}};
type Trip={id:string;owner_id?:string;role?:'owner'|'viewer'|'editor';archived_at?:string|null;lifecycle_revision?:number;payload:{name:string;destination:string;startDate:string;endDate:string;adults:number}};
type Plan={trip:Trip;role?:'owner'|'viewer'|'editor';revision:number;items:Row[];history:any[];research?:ItineraryResearch};
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const timezonePickers=configureTimezonePickers($<HTMLFormElement>('item-form'));
const demo=new URL(location.href).searchParams.get('demo')==='1';
let trips:Trip[]=[],plan:Plan|null=null,client:SupabaseClient|null=null,localToken='',editing:Row|null=null,removing:Row|null=null;
let pending:{signature:string;key:string}|null=null;
let loading=false,listing=false;
let anonymousToken:string|null=null,anonymousView=false;
let tripStatus:'active'|'archived'|'all'='active';
const accountBoundary=new AccountBoundary();
function clearPrivate(){
  if(anonymousView)return;
  trips=[];plan=null;editing=null;removing=null;pending=null;collapsed.clear();
  tripLifecycle.reset();
  stayComparison.reset();diningComparison.reset();
  tripStatus='active';$<HTMLSelectElement>('trip-filter').value='active';
  for(const dialog of document.querySelectorAll<HTMLDialogElement>('dialog'))if(dialog.open)dialog.close();
  for(const form of document.querySelectorAll<HTMLFormElement>('dialog form'))form.reset();
  mapEditor.set([]);timezonePickers.setValues(blank);
  for(const id of ['trip-title','trip-destination','trip-meta','progress','research','questions','history','day-nav','invitation-detail','invitation-title','remove-title','access-list','link-details','calendar-trip','calendar-items','comment-list','discussion-scope'])document.getElementById(id)?.replaceChildren();
  $<HTMLInputElement>('invite-link').value='';$('created-link').hidden=true;
  $('invitation').hidden=true;$('workspace').hidden=true;$('access').hidden=false;render();
}
type View='overview'|'details'|'map';
const initialView=new URL(location.href).searchParams.get('view');
let view:View=initialView==='details'||initialView==='map'?initialView:'overview',mapDay='all';
let activeDay='',scrollFrame=0;
const collapsed=new Set<string>();
function dayTarget(day:string){return document.getElementById(`${view==='overview'?'overview-day':'day'}-${day}`);}
function markDay(day:string){
  if($('day-nav').querySelector<HTMLAnchorElement>('[aria-current]')?.dataset.day===day){activeDay=day;return;}
  activeDay=day;
  for(const link of $('day-nav').querySelectorAll<HTMLAnchorElement>('a')){
    if(link.dataset.day===day){link.setAttribute('aria-current','date');
      const nav=$('day-nav');if(link.offsetLeft<nav.scrollLeft||link.offsetLeft+link.offsetWidth>nav.scrollLeft+nav.clientWidth)nav.scrollTo({left:link.offsetLeft-12});
    }else link.removeAttribute('aria-current');
  }
}
function jumpDay(day:string){if(view==='map'){mapDay=day;itineraryMap.show(day);$('map-all-days').setAttribute('aria-pressed','false');markDay(day);return;}markDay(day);dayTarget(day)?.scrollIntoView({block:'start'});}
function setView(next:View,jump=true){
  view=next;$('overview').hidden=view!=='overview';$('details-layout').hidden=view!=='details';
  $('map-view').hidden=view!=='map';$('map-all-days').hidden=view!=='map';$('view-map').setAttribute('aria-pressed',String(view==='map'));
  if(view==='map'){itineraryMap.show(mapDay);if(mapDay==='all'){for(const a of $('day-nav').querySelectorAll('a'))a.removeAttribute('aria-current');}else markDay(mapDay);}else itineraryMap.hide();
  $('map-all-days').setAttribute('aria-pressed',String(mapDay==='all'));
  $('view-overview').setAttribute('aria-pressed',String(view==='overview'));$('view-details').setAttribute('aria-pressed',String(view==='details'));
  const url=new URL(location.href);url.searchParams.set('view',view);history.replaceState(null,'',url);
  for(const link of $('day-nav').querySelectorAll<HTMLAnchorElement>('a'))link.href=view==='map'?'#map-view':`#${view==='overview'?'overview-day':'day'}-${link.dataset.day}`;
  if(jump&&activeDay&&view!=='map')jumpDay(activeDay);
}
function trackDay(){
  scrollFrame=0;if(!plan||$('trip-view').hidden||view==='map')return;
  const boundary=$('plan-navigation').getBoundingClientRect().bottom+24;
  const sections=[...(view==='overview'?$('overview'):$('timeline')).querySelectorAll<HTMLElement>(view==='overview'?'.overview-day,.overview-unscheduled':'.day')];
  // Side-by-side calendar columns share their vertical position; preserve the
  // chosen day there. On phones they become a vertically scrolling agenda.
  if(view==='overview'&&matchMedia('(min-width:701px)').matches)return;
  let current=sections[0];for(const section of sections){if(section.getBoundingClientRect().top<=boundary)current=section;else break;}
  if(current)markDay(current.id.replace(view==='overview'?'overview-day-':'day-',''));
}
window.addEventListener('scroll',()=>{if(!scrollFrame)scrollFrame=requestAnimationFrame(trackDay);},{passive:true});
new ResizeObserver(()=>document.documentElement.style.setProperty('--plan-nav-height',`${$('plan-navigation').getBoundingClientRect().height+16}px`)).observe($('plan-navigation'));
$('view-overview').onclick=()=>setView('overview');$('view-details').onclick=()=>setView('details');
$('view-map').onclick=()=>setView('map');
$('map-all-days').onclick=()=>{mapDay='all';setView('map',false);};
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
  const generation=accountBoundary.generation;
  let token=localToken;
  if(client){const {data:{session},error}=await client.auth.getSession();if(error||!session){accountBoundary.update(null);clearPrivate();throw Error('Sign in to your travel account again.');}token=session.access_token;}
  accountBoundary.check(generation);
  let response:Response;
  try{response=await fetch(`/itinerary-api/${operation}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(input),signal:AbortSignal.timeout(60_000)});}
  catch{throw Error('The itinerary service did not respond. Refresh to check saved changes before trying again.');}
  let result:any;try{result=await response.json();}catch{throw Error('Unable to read the itinerary response. Refresh to check saved changes.');}
  accountBoundary.check(generation);
  if(response.status===401){accountBoundary.update(null);clearPrivate();}
  if(!response.ok)throw Object.assign(Error(result.error??'Unable to finish. Please try again.'),{code:result.code});return result;
}
async function mutate(operation:string,args:Record<string,unknown>){
  const signature=JSON.stringify([operation,args]);
  if(!pending||pending.signature!==signature)pending={signature,key:crypto.randomUUID()};
  const result=await api(operation,{...args,idempotencyKey:pending.key});pending=null;return result;
}
async function loadTrips(selectId?:string){
  listing=true;$<HTMLSelectElement>('trip-filter').disabled=true;
  try{
  const generation=accountBoundary.generation;
  if(!demo){
    const collected:Trip[]=[];
    // Retrieve all pages rather than silently hiding older trips.
    for(let offset=0;;offset+=50){const page=await api('list_trips',{status:tripStatus,limit:50,offset});accountBoundary.check(generation);collected.push(...page.trips);if(page.trips.length<50)break;}
    trips=collected;
  }
  $('workspace').hidden=false;$('access').hidden=true;
  const requested=selectId??new URL(location.href).searchParams.get('trip');
  const available=requested&&trips.some(trip=>trip.id===requested);
  if(requested&&!available&&!demo){
    try{const opened=await api('get_itinerary',{tripId:requested});accountBoundary.check(generation);const status=opened.trip.archived_at?'archived':'active';
      if(tripStatus!=='all'&&tripStatus!==status){tripStatus=status;$<HTMLSelectElement>('trip-filter').value=tripStatus;return await loadTrips(requested);}}
    catch(error){accountBoundary.check(generation);}
  }
  if(selectId&&!available){plan=null;render();throw Error('This itinerary is unavailable. Its access may have been revoked.');}
  const id=available?requested:trips[0]?.id;
  render();
  if(id){await loadPlan(id);}else{plan=null;render();message('');}
  if(requested&&!available)message('The requested trip is not available in this account. Choose one of your trips, or create a new one.');
  }finally{listing=false;$<HTMLSelectElement>('trip-filter').disabled=loading;}
}
async function loadPlan(id:string){
  if(loading)return;loading=true;$<HTMLSelectElement>('trip-filter').disabled=true;message('Loading your itinerary…');
  try{
    if(!demo){
      if(anonymousView&&!anonymousToken)throw Error('This view link is incomplete. Ask the owner for a new link.');
      plan=anonymousView?await loadViewLink(anonymousToken!):await api('get_itinerary',{tripId:id});
    }
    if(anonymousView){trips=[{...plan!.trip,role:'viewer'}];$('shared-unavailable').hidden=true;}
    const url=new URL(location.href);url.searchParams.set('trip',plan!.trip.id);history.replaceState(null,'',url);
    render();message('');
    if(!demo&&!anonymousView&&plan!.role!=='viewer'&&plan!.role!=='editor'){await stayComparison.refresh();await diningComparison.refresh();}
  }catch(error){plan=null;
    if(anonymousView){trips=[];$('shared-unavailable').hidden=false;}
    if(error&&typeof error==='object'&&'code' in error&&error.code==='FORBIDDEN_OR_NOT_FOUND')trips=trips.filter(t=>t.id!==id);
    render();message(errorText(error));throw error;}finally{loading=false;$<HTMLSelectElement>('trip-filter').disabled=listing;}
}
function allDates(){
  if(!plan)return [];
  const dates=new Set(plan.items.map(i=>i.payload.startDate).filter((d):d is string=>!!d));
  const start=new Date(`${plan.trip.payload.startDate}T12:00:00Z`),end=plan.trip.payload.endDate;
  // Long trips show their populated dates plus the first 60 days, with an explicit notice.
  for(let n=0;n<60;n++){const day=start.toISOString().slice(0,10);if(day>end)break;dates.add(day);start.setUTCDate(start.getUTCDate()+1);}
  return [...dates].sort();
}
const discussion=configureDiscussion({context:()=>plan?{tripId:plan.trip.id,allowed:!anonymousView&&!demo}:null,api});
const members=configureMembers($('trip-members'),api);
const diningComparison=configureDiningComparison($('dining-research'),{api,mutate,reload:loadPlan,message});
const stayComparison=configureStayComparison($('stay-research'),{api,mutate,reload:loadPlan,message});
const tripLifecycle=configureTripLifecycle(mutate,async(action,id)=>{
  plan=null;const url=new URL(location.href);url.searchParams.delete('trip');history.replaceState(null,'',url);render();
  if(action==='archive'||action==='restore')tripStatus='active';$<HTMLSelectElement>('trip-filter').value=tripStatus;
  await loadTrips(action==='restore'?id:undefined);
},message);
$<HTMLSelectElement>('trip-filter').onchange=()=>{
  tripStatus=$<HTMLSelectElement>('trip-filter').value as typeof tripStatus;plan=null;
  const url=new URL(location.href);url.searchParams.delete('trip');history.replaceState(null,'',url);render();void loadTrips().catch(error=>message(errorText(error)));
};
function openDetail(row:Row){
  collapsed.delete(`${plan!.trip.id}:${row.id}`);const detail=$<HTMLDetailsElement>(`item-${row.id}`);detail.open=true;
  activeDay=row.payload.startDate??'unscheduled';setView('details',false);markDay(activeDay);detail.scrollIntoView({block:'start'});detail.querySelector('summary')?.focus({preventScroll:true});
}
const itineraryMap=configureMap($('map-view'),openDetail,row=>{openItem(row);$<HTMLDetailsElement>('map-place-editor').open=true;mapEditor.focus(row.payload.location||row.payload.title);});
const mapEditor=configureMapEditor($('map-place-editor'),async query=>{
  if(demo)throw Error('Place search is available in your saved trips. The demo already includes example pins.');
  if(!plan)throw Error('Open a trip first.');return (await api('place-search',{tripId:plan.trip.id,query})).places;
});
$('item-dialog').addEventListener('close',()=>mapEditor.cancel());
$('trip-discussion').onclick=()=>void discussion.open();
$('add-stay-research').onclick=()=>{($('add-research') as HTMLDetailsElement).open=false;stayComparison.openCreate();};
$('add-dining-research').onclick=()=>{($('add-research') as HTMLDetailsElement).open=false;diningComparison.openCreate();};
function render(){
  members.reset();
  discussion.reset();
  calendarExport.reset();
  $('add-research').hidden=!(plan&&!demo&&!anonymousView&&plan.role!=='viewer'&&plan.role!=='editor');
  if($('add-research').hidden)($('add-research') as HTMLDetailsElement).open=false;
  diningComparison.update(plan&&!demo&&!anonymousView&&plan.role!=='viewer'&&plan.role!=='editor'?{tripId:plan.trip.id,revision:plan.revision,name:plan.trip.payload.name,checkIn:plan.trip.payload.startDate,checkOut:plan.trip.payload.endDate,adults:plan.trip.payload.adults}:null);
  stayComparison.update(plan&&!demo&&!anonymousView&&plan.role!=='viewer'&&plan.role!=='editor'?{tripId:plan.trip.id,revision:plan.revision,name:plan.trip.payload.name,checkIn:plan.trip.payload.startDate,checkOut:plan.trip.payload.endDate,adults:plan.trip.payload.adults}:null);
  $('trip-filter').parentElement!.hidden=demo||anonymousView;
  tripLifecycle.update(plan&&!demo&&!anonymousView?{id:plan.trip.id,name:plan.trip.payload.name,archived:!!plan.trip.archived_at,revision:plan.trip.lifecycle_revision??1,role:plan.role??'owner'}:null,!!plan?.trip.archived_at);
  $('trip-list').replaceChildren(...trips.map(t=>{
    const b=button(t.payload.name,()=>showPlan(t.id),`trip-choice ${plan?.trip.id===t.id?'active':''}`);
    b.append(node('span',`${t.payload.destination} · ${date(t.payload.startDate)}${t.archived_at?' · Archived':''}${t.role==='viewer'?' · Shared, view only':t.role==='editor'?' · Shared, can edit':''}`));if(plan?.trip.id===t.id)b.setAttribute('aria-current','page');return b;
  }));
  $('empty-trips').hidden=anonymousView||!!plan||trips.length>0;$('trip-view').hidden=!plan;
  $('empty-trip-title').textContent=tripStatus==='archived'?'No archived trips':'Where are you heading?';
  $('empty-trip-copy').textContent=tripStatus==='archived'?'Choose Active to return to your current plans. Archived trips keep their content and shared access.':'Create a trip, then add the pieces as you decide. Unknown details can wait.';
  $('first-trip').hidden=tripStatus==='archived';
  if(!plan){$('timeline').replaceChildren();$('overview').replaceChildren();itineraryMap.reset();return;}
  const p=plan.trip.payload,booked=plan.items.filter(i=>i.payload.status==='user_reported_booked').length,unscheduled=plan.items.filter(i=>!i.payload.startDate).length;
  if(!anonymousView&&!demo)void members.load(plan.trip.id);
  const viewer=plan.role==='viewer',editor=plan.role==='editor',shared=viewer||editor;
  $('add-item').hidden=viewer;$('share-trip').hidden=shared||demo;$('history-section').hidden=shared;
  $('people-detail').textContent=anonymousView?'Anyone with this view link can read the shared itinerary. The owner can revoke the link. Editing requires an editor invitation and sign-in.':editor?'Shared with you. You can add, edit, remove and reorder itinerary items. The owner manages booking status, private notes and invitations.':viewer?'Shared with you. You can view this itinerary; the trip owner controls edits and access.':'Share an account-free view link, or invite a friend to edit with their own account.';
  $('booking-detail').textContent='Bookings are reported by the trip owner. Adding a plan never makes a reservation.';
  if(viewer)$('plan-empty').textContent='The owner has not added any items yet. Refresh later to see their plan.';
  else $('plan-empty').textContent='Your itinerary has no saved items yet. Review a flight above, or add a stay, transfer or activity. Saving research does not automatically add it to your plan.';
  $('trip-title').textContent=p.name;$('trip-destination').textContent=p.destination;
  $('trip-meta').replaceChildren(node('span',`${date(p.startDate)} – ${date(p.endDate,{day:'numeric',month:'short',year:'numeric'})}`),node('span',`${p.adults} adults${demo?' · assumed':''}`),node('span',editor?'Shared · can edit':viewer?'Shared · view only':'Your itinerary'));
  $('progress').replaceChildren(...[[`${plan.items.length}`,'items in the plan'],[`${booked}`,'bookings reported'],[`${unscheduled}`,'without a date']].map(([count,label])=>{const row=node('div','','progress-row');row.append(node('span',label!),node('strong',count!));return row;}));
  renderResearch($('research'),plan.research,item=>{
    const existing=plan!.items.find(row=>row.payload.type==='flight'&&row.payload.startDate===item.startDate
      &&row.payload.startTime===item.startTime&&row.payload.endDate===item.endDate&&row.payload.endTime===item.endTime&&row.payload.location===item.location);
    openItem(existing??null,existing?undefined:item);
  },plan.items.length===0,!demo&&!anonymousView&&!shared?{
    list:offset=>api('list_decisions',{tripId:plan!.trip.id,status:'archived',limit:20,offset}),
    change:async(id,revision,archive)=>{
      const tripId=plan!.trip.id;
      try{await mutate(archive?'archive_decision':'restore_decision',{decisionId:id,expectedRevision:revision});
        if(plan?.trip.id===tripId)await loadPlan(tripId);
      }catch(error){if(plan?.trip.id===tripId)await loadPlan(tripId);throw error;}
    },error:error=>message(errorText(error)),
  }:undefined);
  $('plan-empty').hidden=plan.items.length>0;
  const questions=plan.items.filter(i=>i.payload.openQuestion);
  const researchOpen=researchQuestions(plan.research);
  $('questions').replaceChildren(...questions.map(i=>{const q=node('div','','question-mini');q.append(node('strong',i.payload.title),node('span',i.payload.openQuestion));return q;}),
    ...researchOpen.map(text=>node('p',text,'question-mini')),...(questions.length||researchOpen.length?[]:[node('p','No open questions recorded. Add one to any item as you plan.','muted')]));
  $('history').replaceChildren(...(plan.history.length?plan.history.map(h=>{const el=node('div',`${h.action[0].toUpperCase()+h.action.slice(1)}: ${(h.after_payload??h.before_payload)?.payload?.title??'Item'}`,'history-event');el.append(node('span',`${h.actor_id===plan!.trip.owner_id?'You':'Collaborator'} · ${new Date(h.created_at).toLocaleString('en-GB')}`));return el;}):[node('p','Your saved changes will appear here.','muted')]));
  const dates=allDates();$('timeline').replaceChildren();$('day-nav').replaceChildren();
  if(![...dates,'unscheduled'].includes(activeDay))activeDay=dates[0]??'unscheduled';
  if((Date.parse(p.endDate)-Date.parse(p.startDate))/86400000>=60)$('timeline').append(node('p','Showing the first 60 days and all dates with saved items.','muted'));
  for(const day of [...dates,'unscheduled']){
    const group=plan.items.filter(i=>day==='unscheduled'?!i.payload.startDate:i.payload.startDate===day).sort((a,b)=>a.position-b.position);
    const section=node('section','','day');section.id=`day-${day}`;
    const nav=node('a',day==='unscheduled'?`Ideas${unscheduled?` (${unscheduled})`:''}`:date(day,{weekday:'short',day:'numeric',month:'short'}));nav.dataset.day=day;nav.href=`#${section.id}`;nav.onclick=event=>{event.preventDefault();jumpDay(day);};$('day-nav').append(nav);
    const heading=node('div','','day-heading'),copy=node('div');heading.append(node('span',day==='unscheduled'?'…':day.slice(8),'day-number'));
    copy.append(node('h3',day==='unscheduled'?'Unscheduled':date(day,{weekday:'long'})),node('p',day==='unscheduled'?'Good ideas, waiting for their moment':date(day,{day:'numeric',month:'long',year:'numeric'})));heading.append(copy);section.append(heading);
    if(!group.length)section.append(node('p',viewer?'No items planned here yet.':day==='unscheduled'?'Everything has a date. New ideas can live here until you’re ready.':'A little breathing room. Add something when you’re ready.','empty-day'));
    for(const [index,row]of group.entries())section.append(card(row,index,group.length));
    $('timeline').append(section);
  }
  renderOverview($('overview'),plan.items,dates,shared,openDetail);
  itineraryMap.update(plan.items,!viewer);setView(view,false);if(view!=='map')markDay(activeDay);
}
function card(row:Row,index:number,count:number){
  const item=row.payload,el=node('details','','item'),top=node('summary','','item-top'),copy=node('div','','item-copy');
  el.dataset.type=item.type;el.id=`item-${row.id}`;const key=`${plan!.trip.id}:${row.id}`;el.open=!collapsed.has(key);el.ontoggle=()=>{if(el.open)collapsed.delete(key);else collapsed.add(key);};
  top.append(node('span',icons[item.type],'item-icon'));copy.append(node('span',`${names[item.type]} · ${item.startTime??'Time to confirm'}`,'item-type'),node('h3',item.title));
  copy.append(node('span',item.status==='tentative'?'Tentative':plan?.role==='viewer'||plan?.role==='editor'?'✓ Booked · reported by owner':'✓ Booked · reported by you',`badge ${item.status==='tentative'?'':'booked'}`));
  top.append(copy,node('span','⌄','item-chevron'));el.append(top);
  const detail=node('div','','item-details');
  if(item.startTime)detail.append(node('p',`${item.startTime} · ${item.timeZone??'time zone not set'}`));
  else detail.append(node('p',item.startDate?'Time not set':'Date and time not set'));
  if(item.endDate)detail.append(node('p',`Until ${date(item.endDate)}${item.endTime?` at ${item.endTime} · ${item.endTimeZone??'time zone not set'}`:''}`));
  if(item.location)detail.append(node('p',item.location));if(item.notes)detail.append(node('p',item.notes,'notes'));
  if(item.bookingNote)detail.append(node('p',`Booking note: ${item.bookingNote}`,'notes'));
  if(row.sourceLink){const source=node('a',row.payload.type==='restaurant'?'Review saved dining evidence':'Review saved lodging evidence');source.href=row.sourceLink.webPath;detail.append(source);}
  if(item.openQuestion)detail.append(node('p',item.openQuestion,'question'));el.append(detail);
  const actions=node('div','','item-actions');
  if(!anonymousView&&!demo)actions.append(button('Comments',()=>void discussion.open(row.id)));
  actions.append(button('Add to calendar',()=>calendarExport.open(row.id)));
  if(item.url){const a=node('a','Open useful link ↗');a.href=item.url;a.target='_blank';a.rel='noopener noreferrer';actions.append(a);}
  if(plan?.role!=='viewer'){
  actions.append(button('Edit',()=>openItem(row)),button('Remove',()=>{removing=row;$('remove-title').textContent=item.title;$('remove-error').textContent='';$<HTMLDialogElement>('remove-dialog').showModal();}));
  for(const direction of ['up','down'] as const){const b=button(direction==='up'?'↑':'↓',()=>void move(row,direction));b.setAttribute('aria-label',`Move ${item.title} ${direction}`);b.disabled=direction==='up'?index===0:index===count-1;actions.append(b);}
  }
  el.append(actions);return el;
}
function bookingField(){const editor=plan?.role==='editor',status=$<HTMLSelectElement>('item-status');
  status.disabled=editor;$('status-label').hidden=editor;$('editor-booking-hint').hidden=!editor;
  const field=$<HTMLFormElement>('item-form').elements.namedItem('bookingNote') as HTMLTextAreaElement;
  field.disabled=editor;field.required=!editor&&status.value==='user_reported_booked';$('booking-label').hidden=editor||status.value!=='user_reported_booked';}
function openItem(row:Row|null,draft?:ItineraryItem){
  editing=row;pending=null;const form=$<HTMLFormElement>('item-form');form.reset();
  const payload=row?.payload??draft??blank;
  for(const [key,value]of Object.entries(payload)){const field=form.elements.namedItem(key) as HTMLInputElement|null;if(field&&!Array.isArray(value))field.value=value??'';}
  timezonePickers.setValues(payload);
  mapEditor.set(payload.mapLocations);$<HTMLDetailsElement>('map-place-editor').open=!!payload.mapLocations?.length;
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
    timezonePickers.validate();
    const editor=plan?.role==='editor',fields=Object.fromEntries(new FormData(form)),item={...fields} as unknown as ItineraryItem;
    item.mapLocations=mapEditor.values();
    for(const field of ['startDate','startTime','endDate','endTime','timeZone','endTimeZone','url'] as const)item[field]=String(fields[field]??'').trim()||null;
    if(item.status==='tentative')item.bookingNote='';
    // Server is authoritative. Demo uses these small checks without importing backend dependencies.
    if(item.startTime&&!item.startDate||item.endTime&&!item.endDate)throw Error('Add a date for each time, or leave the time empty.');
    if(!editor&&item.status==='user_reported_booked'&&!item.bookingNote.trim())throw Error('Add a booking note.');
    if(item.url){const url=new URL(item.url);if(url.protocol!=='https:'||url.username||url.password)throw Error('Use an HTTPS link without credentials.');}
    if(demo)demoChange(editing?'edited':'added',editing?.id??crypto.randomUUID(),item);
    else{const operation=editor?(editing?'update_shared_itinerary_item':'add_shared_itinerary_item'):(editing?'update_itinerary_item':'add_itinerary_item');
      const tripId=plan!.trip.id,result=await mutate(operation,{tripId,expectedRevision:plan!.revision,...(editing?{itemId:editing.id}:{}),item});await loadPlan(tripId);
      const saved=plan?.items.find(row=>row.id===result.itemId)?.payload.mapLocations??[];
      verifyMapSave(item.mapLocations!,result,saved);}
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
$('refresh').onclick=()=>{if(demo)location.reload();else if(plan||anonymousView)showPlan(plan?.trip.id??'');else void loadTrips().catch(e=>message(errorText(e)));};
$('retry-shared-view').onclick=()=>showPlan(plan?.trip.id??'');
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
  const geneva={label:'Geneva Airport — example endpoint',latitude:46.2381,longitude:6.109};
  const flaine={label:'Flaine — example resort centre',latitude:46.005,longitude:6.687};
  demoItems[0]!.mapLocations=[geneva];demoItems[1]!.mapLocations=[geneva,flaine];demoItems[2]!.mapLocations=[flaine];demoItems[3]!.mapLocations=[flaine];
  plan={trip,revision:1,items:demoItems.map((item,index)=>({id:`demo-${index}`,position:index+1,payload:{...blank,...item}})),history:[]};
  $('workspace').hidden=false;render();
}
async function initialize(){
    if(demo){setupDemo();message('');return;}
  try{anonymousToken=viewLinkToken();}catch(error){anonymousView=true;document.body.classList.add('anonymous-view');$('shared-view-banner').hidden=false;$('shared-unavailable').hidden=false;message(errorText(error));return;}
  if(anonymousToken){
    anonymousView=true;document.body.classList.add('anonymous-view');$('shared-view-banner').hidden=false;$('workspace').hidden=false;$('access').hidden=true;
    await loadPlan('');return;
  }
  const invitation=pendingInvitation();
  if(invitation){$('access').querySelector('h1')!.textContent='You’ve been invited to a trip.';$('access').querySelectorAll('p')[1]!.textContent='Sign in or create an account to review the invitation. No AI assistant or API keys needed.';}
  const response=await fetch('/itinerary/config',{signal:AbortSignal.timeout(60_000)});if(!response.ok)throw Error('Unable to load the itinerary.');const config=await response.json();
  if(config.mode==='hosted'){
    client=createAccountClient(config);
    const {data:{session},error}=await client.auth.getSession();if(error)throw Error('Unable to restore sign-in. Open Your account to sign in again.');
    accountBoundary.update(session?.user.id??null);watchAccount(client,accountBoundary,clearPrivate);
    if(session){if(await openInvitation(api,mutate,id=>loadTrips(id))){message('');return;}await loadTrips();return;}
  }
  $('access').hidden=false;message('');
  if(config.mode==='local'){$('local-login').hidden=false;$('hosted-access').hidden=true;
    $<HTMLFormElement>('local-login').onsubmit=event=>{event.preventDefault();localToken=$<HTMLInputElement>('local-token').value;$<HTMLInputElement>('local-token').value='';void (async()=>{if(await openInvitation(api,mutate,id=>loadTrips(id))){message('');return;}await loadTrips();})().catch(e=>message(errorText(e)));};
  }else if(config.mode==='unavailable')message('Account sign-in is not configured yet. You can explore the demo.');
}
configureSharing(api,mutate,()=>plan?.role==='viewer'||plan?.role==='editor'?null:plan?.trip.id??null);
// A second sharing URL pasted into this tab can be a fragment-only navigation.
// Reinitialize its credential instead of leaving the previous trip on screen.
window.addEventListener('hashchange',()=>{
  const fragment=new URLSearchParams(location.hash.slice(1));
  if(['view','invite','leave-view'].some(key=>fragment.has(key)))location.reload();
});
window.addEventListener('focus',()=>{if(!plan||loading||document.querySelector('dialog[open]'))return;
  if(plan.role==='viewer'||plan.role==='editor')showPlan(plan.trip.id);
  else if(!demo&&!anonymousView)void members.load(plan.trip.id);
});
const calendarExport=configureCalendarExport({getPlan:()=>plan,demo,prepare:async(p,itemIds)=>{
  const body={itemIds,expectedRevision:p.revision};
  if(!anonymousView)return api('calendar-export',{...body,tripId:p.trip.id});
  if(!anonymousToken)throw Error('This view link is unavailable. Ask the owner for a new link.');
  const response=await fetch('/itinerary-share/calendar-export',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',cache:'no-store',
    body:JSON.stringify({...body,token:anonymousToken}),signal:AbortSignal.timeout(60_000)});
  const result=await response.json();if(!response.ok)throw Error(result.error??'Unable to export the shared itinerary.');return result;
}});
void initialize().catch(error=>{message(errorText(error));if(!anonymousView&&$('workspace').hidden)$('access').hidden=false;});
