import {airportLocal} from '../src/airport-time.js';
import type {ItineraryItem} from '../src/itinerary.js';
import type {ItineraryObservation,ItineraryResearch,ItineraryResearchDecision} from '../src/itinerary-research.js';

const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className='')=>{
  const node=document.createElement(tag);node.textContent=text;node.className=className;return node;
};
const stamp=(instant:string)=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Europe/London'}).format(new Date(instant));
export function safeResearchUrl(value:string|null):string|null {
  if(!value)return null;
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
export function researchQuestions(research:ItineraryResearch|undefined):string[] {
  const questions=new Set<string>();
  for(const decision of research?.decisions??[]) {
    for(const assumption of decision.criteria.assumptions)questions.add(assumption);
    if(decision.observations.some(o=>'external' in o.offer||o.offer.priceBasis==='unknown'||!o.offer.exactPartyQuoted))questions.add('Confirm the fare total for the whole party. Recorded prices have an unverified basis.');
    if(decision.criteria.snowboardRequired&&decision.observations.some(o=>o.offer.snowboardAllowed!=='yes'||o.offer.snowboardTotalMinor===null))questions.add('Confirm snowboard carriage and the extra cost in both directions.');
    const omitted=decision.latestRun?.coverage.notRequestedAirports;
    if(Array.isArray(omitted)&&omitted.length)questions.add(`Other permitted airports have not been searched: ${omitted.join(', ')}.`);
  }
  return [...questions];
}
export function draftResearchFlight(observation:ItineraryObservation,direction:'outbound'|'inbound'):ItineraryItem {
  if(!observation.offer[direction].length)throw new Error('This journey has no return leg');
  const leg=observation.offer[direction],first=leg[0]!,last=leg.at(-1)!;
  const start=airportLocal(first.departure,first.origin),end=airportLocal(last.arrival,last.destination);
  return {type:'flight',title:`${first.origin} → ${last.destination} · ${leg.map(s=>s.operatingFlight).join(' / ')}`,
    startDate:start?.date??null,startTime:start?.time??null,timeZone:start?.timeZone??null,
    endDate:end?.date??null,endTime:end?.time??null,endTimeZone:end?.timeZone??null,
    location:`${first.origin} → ${last.destination}`,url:'external' in observation.offer?null:safeResearchUrl(observation.offer.sourceUrl),
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
    el('small',`${leg.map(s=>s.airline?`${s.airline} ${s.operatingFlight}`:s.operatingFlight).join(' / ')} · ${leg.length===1?'Direct':`${leg.length-1} connection(s)`}`),
    el('small',`${start?.timeZone??'Departure zone unknown'} → ${end?.timeZone??'Arrival zone unknown'}`));
  return row;
}
function evidenceLink(value:string|null,label:string){
  const url=safeResearchUrl(value);
  if(!url)return null;
  const link=el('a',label);link.href=url;link.target='_blank';link.rel='noopener noreferrer';return link;
}
function externalDetails(offer:Extract<ItineraryObservation['offer'],{external:unknown}>) {
  const evidence=offer.external;
  const availability={unknown:'Availability unknown',reported_available:'Reported available · unverified',reported_unavailable:'Reported unavailable'};
  const scope={outbound:'Outbound price',inbound:'Return-leg price',round_trip:'Round-trip price',unknown:'Price scope unknown'};
  const details=el('div');
  details.append(el('p',`${offer.fare} · ${evidence.cabin==='unknown'?'Cabin unknown':evidence.cabin.replaceAll('_',' ')} · ${offer.adults} adults requested`),
    el('p',`${scope[evidence.priceScope]} · ${availability[evidence.availability]}. Full-party total unverified.`),
    el('p',`Outbound baggage: ${evidence.baggage.outbound.join(' · ')||'Unknown'}`));
  if(offer.inbound.length)details.append(el('p',`Return baggage: ${evidence.baggage.inbound.join(' · ')||'Unknown'}`));
  if(evidence.restrictions.length)details.append(el('p',`Restrictions: ${evidence.restrictions.join(' · ')}`));
  details.append(el('p',`Fees to verify: ${evidence.unresolvedFees.join(' · ')||'Unknown'}`),
    el('p',`Coverage: ${evidence.coverageLimitations.join(' · ')||'Unknown'}`));
  const link=evidenceLink(offer.sourceUrl,evidence.linkType==='seller_handoff'?'Open reported seller handoff ↗':'Open research source ↗');
  if(link)details.append(link);
  return details;
}
function researchCard(observations:ItineraryObservation[],onDraft:(item:ItineraryItem)=>void) {
  const sample=observations[0]!,card=el('article','','research-card');
  const selected=observations.find(o=>o.selected),booked=observations.find(o=>o.bookingReported);
  card.append(el('span',booked?'Booking reported in research':selected?'Selected in research':'Saved research · not a booking','badge'));
  if(selected)card.append(el('p',`Selected evidence: ${selected.offer.seller}. Selection does not make a booking.`,'muted'));
  if(booked)card.append(el('p',`Booking reported for ${booked.offer.seller}. This remains separate from your manual itinerary.`,'muted'));
  if(sample.provenance==='synthetic')card.append(el('p','Synthetic example. This is not a live flight or bookable offer.','question'));
  if(sample.provenance==='assistant_sourced_unverified')card.append(el('p','Assistant-sourced flight research · Fare and availability unverified','question'));
  if(sample.provenance==='provider_reported')card.append(el('p','Built-in search · Provider-reported evidence','muted'));
  if(sample.disposition==='saved')card.append(el('p','Shortlisted','muted'));
  if(sample.disposition==='rejected')card.append(el('p','Rejected in your research.','muted'));
  const legs=el('div','','research-legs');legs.append(legSummary(sample,'outbound'));if(sample.offer.inbound.length)legs.append(legSummary(sample,'inbound'));card.append(legs);
  card.append(el('p','Saved research is not a held fare. Copy a flight into your plan only after reviewing it.','muted'));
  const detail=el('details','','seller-details'),summary=el('summary',`${observations.length} saved seller observation${observations.length===1?'':'s'} · view recorded prices`);
  detail.append(summary,el('p','Amounts are recorded evidence. Read the basis beside each price; unknown values cannot establish a whole-party total.','muted'));
  const table=el('table','','seller-table'),head=el('thead'),tr=el('tr');
  for(const title of ['Seller','Recorded amount','Basis / verification','Saved']){const th=el('th',title);th.scope='col';tr.append(th);}head.append(tr);table.append(head);
  const body=el('tbody');
  for(const observation of [...observations].sort((a,b)=>a.offer.seller.localeCompare(b.offer.seller)||b.offer.observedAt.localeCompare(a.offer.observedAt))) {
    const offer=observation.offer,row=el('tr');
    const external='external' in offer?offer.external:null;
    const price=external?.reportedPrice??{amountMinor:offer.priceMinor,currency:offer.currency,basis:offer.priceBasis,exactPartyQuoted:offer.exactPartyQuoted};
    const formatter=new Intl.NumberFormat('en-GB',{style:'currency',currency:price.currency});
    const amount=price.amountMinor===null?'Unknown':formatter.format(price.amountMinor/10**(formatter.resolvedOptions().maximumFractionDigits??2));
    const basis=el('td',`${price.basis==='unknown'?'Basis unknown':price.basis==='party'?'Party fare':'Per person'} · ${price.exactPartyQuoted?'Exact-party basis reported; availability unverified':'Exact-party quote unverified'}`);
    if('external' in offer)basis.append(externalDetails(offer));
    row.append(el('td',external?`${offer.seller} · via ${external.source}`:offer.seller),el('td',amount),basis,el('td',`${stamp(offer.observedAt)} UK`));body.append(row);
  }
  table.append(body);detail.append(table);card.append(detail);
  const actions=el('div','','research-actions');
  const source='external' in sample.offer?null:evidenceLink(sample.offer.sourceUrl,'Open research source ↗');
  if(source)actions.append(source);
  if(sample.provenance!=='synthetic'&&sample.disposition!=='rejected')for(const direction of ['outbound','inbound'] as const) {
    if(!sample.offer[direction].length)continue;
    const button=el('button',direction==='outbound'?'Review outbound for plan':'Review return for plan','subtle');button.type='button';
    button.onclick=()=>onDraft(draftResearchFlight(sample,direction));actions.append(button);
  }
  card.append(actions);return card;
}
function decisionView(decision:ItineraryResearchDecision,onDraft:(item:ItineraryItem)=>void,lifecycle?:ResearchLifecycle) {
  const section=el('section','','research-decision');section.append(el('h3',decision.title));
  if(lifecycle&&decision.revision){
    const archive=el('button','Archive decision','subtle');archive.type='button';archive.disabled=!!decision.bookingLinked;
    archive.onclick=()=>{archive.disabled=true;void lifecycle.change(decision.id,decision.revision!,true).catch(error=>{archive.disabled=false;lifecycle.error(error);});};
    section.append(archive,el('p',decision.bookingLinked?'This decision has a booking report and cannot be archived.':'Archive hides this research from active views. Evidence is kept; admitted searches continue and supplier allowance is unchanged.','muted'));
  }
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
export interface ResearchLifecycle {
  change:(id:string,revision:number,archive:boolean)=>Promise<void>;
  list:(offset:number)=>Promise<{decisions:{id:string;title:string;revision:number;archived_at:string}[];pagination:{hasMore:boolean}}>;
  error:(error:unknown)=>void;
}
export function renderResearch(target:HTMLElement,research:ItineraryResearch|undefined,onDraft:(item:ItineraryItem)=>void,expanded=true,lifecycle?:ResearchLifecycle) {
  target.replaceChildren();target.hidden=!research?.decisions.length&&!research?.archivedCount;if(target.hidden)return;
  const disclosure=el('details'),summary=el('summary','','research-heading');disclosure.open=expanded;
  summary.append(el('span','FROM YOUR SAVED RESEARCH','eyebrow'),el('span',research?.decisions.length?'Flight options, ready to review':'Archived research','research-title'));
  disclosure.append(summary,el('p','These observations are separate from your itinerary. Reviewing a flight opens an editable draft; it is saved as tentative only when you choose Save.','muted'));
  for(const decision of research!.decisions)disclosure.append(decisionView(decision,onDraft,lifecycle));
  if(research!.truncatedDecisions)disclosure.append(el('p','Showing the first five decisions by title. Use your assistant for the remaining saved research.','muted'));
  if(lifecycle&&research?.archivedCount){
    const archived=el('details'),heading=el('summary',`Archived research (${research.archivedCount})`),content=el('div');
    archived.append(heading,content);let loaded=false;
    const load=async(offset:number)=>{
      content.textContent='Loading archived research…';
      try{const page=await lifecycle.list(offset);content.replaceChildren();
        for(const row of page.decisions){const card=el('section','','research-decision');card.append(el('h3',row.title),el('p',`Archived · ${new Date(row.archived_at).toLocaleString('en-GB')} · evidence and rationale retained`,'muted'));
          const restore=el('button','Restore decision','subtle');restore.type='button';restore.onclick=()=>{restore.disabled=true;void lifecycle.change(row.id,row.revision,false).catch(error=>{restore.disabled=false;lifecycle.error(error);});};card.append(restore);content.append(card);}
        for(const [label,next] of [['Previous',offset-20],['Next',offset+20]] as const){if(next<0||(label==='Next'&&!page.pagination.hasMore))continue;const b=el('button',label,'subtle');b.type='button';b.onclick=()=>void load(next);content.append(b);}
        if(!page.decisions.length)content.append(el('p','No archived decisions.'));
      }catch(error){loaded=false;content.textContent='Unable to load archived research. Close and reopen to retry.';lifecycle.error(error);}
    };
    archived.ontoggle=()=>{if(archived.open&&!loaded){loaded=true;void load(0);}};disclosure.append(archived);
  }
  target.append(disclosure);
}
