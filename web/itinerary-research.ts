import {airportLocal} from '../src/airport-time.js';
import type {ItineraryItem} from '../src/itinerary.js';
import type {ItineraryObservation,ItineraryResearch,ItineraryResearchDecision} from '../src/itinerary-research.js';

const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className='')=>{
  const node=document.createElement(tag);node.textContent=text;node.className=className;return node;
};
const stamp=(instant:string)=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Europe/London'}).format(new Date(instant));
export function safeResearchUrl(value:string):string|null {
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
export function researchQuestions(research:ItineraryResearch|undefined):string[] {
  const questions=new Set<string>();
  for(const decision of research?.decisions??[]) {
    for(const assumption of decision.criteria.assumptions)questions.add(assumption);
    if(decision.observations.some(o=>o.offer.priceBasis==='unknown'||!o.offer.exactPartyQuoted))questions.add('Confirm the fare total for the whole party. Recorded prices have an unverified basis.');
    if(decision.criteria.snowboardRequired&&decision.observations.some(o=>o.offer.snowboardAllowed!=='yes'||o.offer.snowboardTotalMinor===null))questions.add('Confirm snowboard carriage and the extra cost in both directions.');
    const omitted=decision.latestRun?.coverage.notRequestedAirports;
    if(Array.isArray(omitted)&&omitted.length)questions.add(`Other permitted airports have not been searched: ${omitted.join(', ')}.`);
  }
  return [...questions];
}
export function draftResearchFlight(observation:ItineraryObservation,direction:'outbound'|'inbound'):ItineraryItem {
  const leg=observation.offer[direction],first=leg[0]!,last=leg.at(-1)!;
  const start=airportLocal(first.departure,first.origin),end=airportLocal(last.arrival,last.destination);
  return {type:'flight',title:`${first.origin} → ${last.destination} · ${leg.map(s=>s.operatingFlight).join(' / ')}`,
    startDate:start?.date??null,startTime:start?.time??null,timeZone:start?.timeZone??null,
    endDate:end?.date??null,endTime:end?.time??null,endTimeZone:end?.timeZone??null,
    location:`${first.origin} → ${last.destination}`,url:safeResearchUrl(observation.offer.sourceUrl),
    status:'tentative',bookingNote:'',
    notes:`Copied from saved flight research (${stamp(observation.offer.observedAt)} London time). Schedule is unverified; recheck before travel. This is not a booking.`,
    openQuestion:'Confirm the full-party fare, snowboard carriage/costs and transfers. Recheck supplier availability and flight times.'};
}
function legSummary(observation:ItineraryObservation,direction:'outbound'|'inbound') {
  const leg=observation.offer[direction],first=leg[0]!,last=leg.at(-1)!;
  const start=airportLocal(first.departure,first.origin),end=airportLocal(last.arrival,last.destination);
  const row=el('div','','research-leg');
  row.append(el('span',direction==='outbound'?'Outbound':'Return','item-type'),
    el('strong',`${first.origin} → ${last.destination}`),
    el('span',start&&end?`${start.date} · ${start.time} → ${end.time}${end.date!==start.date?` (${end.date})`:''}`:'Local schedule unresolved'),
    el('small',`${leg.map(s=>s.operatingFlight).join(' / ')} · ${leg.length===1?'Direct':`${leg.length-1} connection(s)`}`),
    el('small',`${start?.timeZone??'Departure zone unknown'} → ${end?.timeZone??'Arrival zone unknown'}`));
  return row;
}
function researchCard(observations:ItineraryObservation[],onDraft:(item:ItineraryItem)=>void) {
  const sample=observations[0]!,card=el('article','','research-card');
  const selected=observations.find(o=>o.selected),booked=observations.find(o=>o.bookingReported);
  card.append(el('span',booked?'Booking reported in research':selected?'Selected in research':'Saved research · not a booking','badge'));
  if(selected)card.append(el('p',`Selected evidence: ${selected.offer.seller}. Selection does not make a booking.`,'muted'));
  if(booked)card.append(el('p',`Booking reported for ${booked.offer.seller}. This remains separate from your manual itinerary.`,'muted'));
  if(sample.provenance==='synthetic')card.append(el('p','Synthetic example. This is not a live flight or bookable offer.','question'));
  if(sample.disposition==='rejected')card.append(el('p','Rejected in your research.','muted'));
  const legs=el('div','','research-legs');legs.append(legSummary(sample,'outbound'),legSummary(sample,'inbound'));card.append(legs);
  card.append(el('p','Saved research is not a held fare. Copy a flight into your plan only after reviewing it.','muted'));
  const detail=el('details','','seller-details'),summary=el('summary',`${observations.length} saved seller observation${observations.length===1?'':'s'} · view recorded prices`);
  detail.append(summary,el('p','Amounts are recorded evidence. Read the basis beside each price; unknown values cannot establish a whole-party total.','muted'));
  const table=el('table','','seller-table'),head=el('thead'),tr=el('tr');
  for(const title of ['Seller','Recorded amount','Basis / verification','Saved']){const th=el('th',title);th.scope='col';tr.append(th);}head.append(tr);table.append(head);
  const body=el('tbody');
  for(const observation of [...observations].sort((a,b)=>a.offer.seller.localeCompare(b.offer.seller)||b.offer.observedAt.localeCompare(a.offer.observedAt))) {
    const offer=observation.offer,row=el('tr');
    const amount=offer.priceMinor===null?'Unknown':new Intl.NumberFormat('en-GB',{style:'currency',currency:offer.currency}).format(offer.priceMinor/100);
    row.append(el('td',offer.seller),el('td',amount),el('td',`${offer.priceBasis==='unknown'?'Basis unknown':offer.priceBasis==='party'?'Party fare':'Per person'} · ${offer.exactPartyQuoted?'Exact-party basis reported; availability unverified':'Exact-party quote unverified'}`),el('td',`${stamp(offer.observedAt)} UK`));body.append(row);
  }
  table.append(body);detail.append(table);card.append(detail);
  const actions=el('div','','research-actions');
  const url=safeResearchUrl(sample.offer.sourceUrl);
  if(url){const link=el('a','Open research source ↗');link.href=url;link.target='_blank';link.rel='noopener noreferrer';actions.append(link);}
  if(sample.provenance!=='synthetic'&&sample.disposition!=='rejected')for(const direction of ['outbound','inbound'] as const) {
    const button=el('button',direction==='outbound'?'Review outbound for plan':'Review return for plan','subtle');button.type='button';
    button.onclick=()=>onDraft(draftResearchFlight(sample,direction));actions.append(button);
  }
  card.append(actions);return card;
}
function decisionView(decision:ItineraryResearchDecision,onDraft:(item:ItineraryItem)=>void) {
  const section=el('section','','research-decision');section.append(el('h3',decision.title));
  const coverage=decision.latestRun?.coverage;
  if(decision.latestRun){section.append(el('p',`Latest search: ${decision.latestRun.status} · ${stamp(decision.latestRun.createdAt)} UK · criteria version ${decision.latestRun.criteriaVersion}`,'muted'));
    if(decision.latestRun.criteriaVersion!==decision.criteriaVersion)section.append(el('p','Your criteria changed after this search. Recheck the evidence against your current requirements.','question'));
    if(typeof coverage?.sample==='string')section.append(el('p',coverage.sample,'muted'));
    if(coverage?.complete===false)section.append(el('p','Coverage is incomplete. Other permitted airports, equipment costs and bookable totals may still need research.','question'));
  }
  const groups=new Map<string,ItineraryObservation[]>();
  for(const observation of decision.observations){
    const key=JSON.stringify([observation.candidateId,observation.offer.outbound,observation.offer.inbound,observation.provenance]);
    const group=groups.get(key)??[];group.push(observation);groups.set(key,group);
  }
  for(const observations of groups.values())section.append(researchCard(observations,onDraft));
  if(!groups.size)section.append(el('p','No saved flight observations yet. You can still add your own plans below.','muted'));
  if(decision.observationCount>20)section.append(el('p','Showing up to 20 recent seller/fare observations, plus pinned selections and booking reports. Older evidence remains available through your assistant.','muted'));
  if(decision.pinnedEvidenceTruncated)section.append(el('p','Showing up to 20 pinned selections and booking reports. Use your assistant to inspect the remaining records.','muted'));
  return section;
}
export function renderResearch(target:HTMLElement,research:ItineraryResearch|undefined,onDraft:(item:ItineraryItem)=>void,expanded=true) {
  target.replaceChildren();target.hidden=!research?.decisions.length;if(target.hidden)return;
  const disclosure=el('details'),summary=el('summary','','research-heading');disclosure.open=expanded;
  summary.append(el('span','FROM YOUR SAVED RESEARCH','eyebrow'),el('span','Flight options, ready to review','research-title'));
  disclosure.append(summary,el('p','These observations are separate from your itinerary. Reviewing a flight opens an editable draft; it is saved as tentative only when you choose Save.','muted'));
  for(const decision of research!.decisions)disclosure.append(decisionView(decision,onDraft));
  if(research!.truncatedDecisions)disclosure.append(el('p','Showing the first five decisions by title. Use your assistant for the remaining saved research.','muted'));
  target.append(disclosure);
}
