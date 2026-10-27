import {z} from 'zod';
import {mutation,uuid} from './domain.js';

const money=z.number().int().min(0).max(1_000_000_000_000),text=(max:number)=>z.string().trim().max(max);
const https=z.string().max(2000).refine(value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}},'Use an HTTPS link');
const timestamp=z.iso.datetime({offset:true}).refine(value=>Date.parse(value)<=Date.now()+300_000,'Observation time cannot be in the future');
const meal=z.enum(['breakfast','lunch','dinner','other']);
const basis=z.enum(['per_person','whole_party','unknown']);
export const diningCriteriaSchema=z.strictObject({date:z.iso.date(),meal,adults:z.number().int().min(1).max(10),currency:z.string().regex(/^[A-Z]{3}$/),
  localTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),timeZone:z.string().max(80).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}},'Use a valid IANA time zone').nullable(),
  maximumTotalMinor:money.nullable(),dietaryRequirements:z.array(text(120).min(1)).max(20)});
export const diningObservationSchema=z.strictObject({
  restaurantName:text(160).min(1),date:z.iso.date(),meal,quotedAdults:z.number().int().min(1).max(50).nullable(),currency:z.string().regex(/^[A-Z]{3}$/),
  menu:z.strictObject({summary:text(2000),url:https.nullable(),observedAt:timestamp.nullable()}),
  price:z.strictObject({amountMinor:money.nullable(),basis,description:text(1000)}),
  charges:z.array(z.strictObject({label:text(120).min(1),amountMinor:money.nullable(),basis,includedInBase:z.boolean().nullable()})).max(30),
  mandatoryChargesComplete:z.boolean(),excludedCharges:z.array(text(300).min(1)).max(20),
  groupSuitability:z.strictObject({status:z.enum(['reported_suitable','unsuitable','unknown']),details:text(1000)}),
  dietary:z.array(z.strictObject({requirement:text(120).min(1),status:z.enum(['reported_supported','unsupported','unknown']),details:text(1000)})).max(20),
  location:z.strictObject({label:text(250),precision:z.enum(['exact','approximate','unknown']),latitude:z.number().finite().min(-85).max(85).nullable(),longitude:z.number().finite().min(-180).max(180).nullable()}),
  reservation:z.strictObject({url:https.nullable(),kind:z.enum(['reservation_page','homepage','unknown']),sourceLabel:text(160),observedAt:timestamp.nullable()}),
  availability:z.enum(['reported_available','unavailable','unknown']),availabilityDetails:text(1000),
  source:z.strictObject({url:https.nullable(),label:text(160).min(1),observedAt:timestamp,kind:z.enum(['manual','sourced'])}),unknowns:z.array(text(300).min(1)).max(30),
}).superRefine((o,ctx)=>{
  const issue=(message:string,path:string[])=>ctx.addIssue({code:'custom',message,path});
  if((o.location.latitude===null)!==(o.location.longitude===null))issue('Supply both coordinates or neither',['location']);
  if(o.location.precision==='exact'&&o.location.latitude===null)issue('An exact location needs coordinates',['location']);
  if(o.source.kind==='sourced'&&!o.source.url)issue('Sourced evidence needs its source link',['source','url']);
  if((o.menu.summary||o.menu.url)&&!o.menu.observedAt)issue('Record when the menu was observed',['menu','observedAt']);
  if(o.reservation.kind!=='unknown'&&(!o.reservation.url||!o.reservation.sourceLabel||!o.reservation.observedAt))issue('A reported reservation page or homepage needs its URL, source and observation time',['reservation']);
  if(o.groupSuitability.status!=='unknown'&&!o.groupSuitability.details)issue('Explain the reported group suitability',['groupSuitability','details']);
  for(const d of o.dietary)if(d.status!=='unknown'&&!d.details)issue('Explain the dietary report; it is not a safety guarantee',['dietary']);
  if(o.availability!=='unknown'&&!o.availabilityDetails)issue('Explain the dated availability report; a booking link alone is not availability',['availabilityDetails']);
  const seen=new Set<string>();for(const d of o.dietary){const key=d.requirement.toLowerCase();if(seen.has(key))issue('Record each dietary requirement once',['dietary']);seen.add(key);}
});
export type DiningCriteria=z.infer<typeof diningCriteriaSchema>;
export type DiningObservation=z.infer<typeof diningObservationSchema>;
const edit={...mutation,decisionId:uuid,expectedRevision:z.number().int().positive()};
export const diningSchemas={
  create_dining_decision:z.strictObject({...mutation,tripId:uuid,title:text(120).min(1),criteria:diningCriteriaSchema}),
  list_dining_decisions:z.strictObject({tripId:uuid}),get_dining_decision:z.strictObject({decisionId:uuid}),get_dining_observation:z.strictObject({decisionId:uuid,observationId:uuid}),
  save_dining_candidate:z.strictObject({...edit,candidateId:uuid.optional(),observation:diningObservationSchema,identityReview:z.strictObject({priorObservationId:uuid,confirmedSameRestaurant:z.literal(true),reason:text(1000).min(1)}).optional()}),
  set_dining_disposition:z.strictObject({...edit,candidateId:uuid,disposition:z.enum(['neutral','saved','rejected']),rationale:text(2000)}),
  compare_dining:z.strictObject({decisionId:uuid}),select_dining_candidate:z.strictObject({...edit,observationId:uuid,rationale:text(2000).default(''),acknowledgeUnknowns:z.boolean().optional()}),
  commit_dining_selection:z.strictObject({...edit,expectedItineraryRevision:z.number().int().positive(),selectionId:uuid}),
};
export type DiningToolName=keyof typeof diningSchemas;
export const diningReads=new Set<DiningToolName>(['list_dining_decisions','get_dining_decision','get_dining_observation','compare_dining']);
export interface DiningAssessment {knownSubtotalMinor:number|null;totalMinor:number|null;eligibility:'eligible'|'conditional'|'ineligible';checks:{name:string;status:'pass'|'fail'|'unknown';detail:string}[];unknowns:string[]}
export function evaluateDining(o:DiningObservation,c:DiningCriteria):DiningAssessment{
  const checks:DiningAssessment['checks']=[],unknowns=[...o.unknowns];
  const add=(name:string,pass:boolean|null,detail:string)=>{checks.push({name,status:pass===null?'unknown':pass?'pass':'fail',detail});if(pass===null)unknowns.push(detail);};
  const sameDate=o.date===c.date&&o.meal===c.meal,sameParty=o.quotedAdults===c.adults,sameCurrency=o.currency===c.currency;
  add('date_meal',sameDate,'Evidence must cover the exact date and meal');add('party',o.quotedAdults===null?null:sameParty,'Evidence must cover the whole adult party');add('currency',sameCurrency,'No currency conversion is inferred');
  const whole=(value:number|null,basis:string)=>value===null?null:basis==='whole_party'?value:basis==='per_person'&&o.quotedAdults!==null?value*o.quotedAdults:null;
  const base=whole(o.price.amountMinor,o.price.basis),parts=[base,...o.charges.filter(f=>f.includedInBase===false).map(f=>whole(f.amountMinor,f.basis))].filter((n):n is number=>n!==null);
  const knownSubtotalMinor=parts.length?parts.reduce((sum,n)=>sum+n,0):null;
  const complete=base!==null&&o.mandatoryChargesComplete&&!o.excludedCharges.length&&o.charges.every(f=>f.includedInBase===true||f.includedInBase===false&&whole(f.amountMinor,f.basis)!==null);
  const totalMinor=complete&&sameDate&&sameParty&&sameCurrency?knownSubtotalMinor:null;
  add('total',totalMinor===null?null:true,totalMinor===null?'Expected whole-party meal cost, including mandatory service and fees, is incomplete':'Expected whole-party meal cost includes recorded mandatory service and fees');
  if(c.maximumTotalMinor!==null){const over=sameDate&&sameParty&&sameCurrency&&knownSubtotalMinor!==null&&knownSubtotalMinor>c.maximumTotalMinor;add('budget',over?false:totalMinor===null?null:totalMinor<=c.maximumTotalMinor,over?'Known group costs exceed the budget':totalMinor===null?'Budget fit is unknown until mandatory group costs are complete':'Reported group estimate is within budget');}
  add('group_fit',o.groupSuitability.status==='unsuitable'?false:o.groupSuitability.status==='unknown'||!o.groupSuitability.details?null:true,'Group seating/suitability is a dated report; unknown fit needs review');
  for(const requirement of c.dietaryRequirements){const match=o.dietary.find(d=>d.requirement.toLowerCase()===requirement.toLowerCase());add('dietary',match?.status==='unsupported'?false:!match||match.status==='unknown'||!match.details?null:true,`Dietary requirement: ${requirement} — confirm directly with the restaurant; this is not a safety guarantee`);}
  add('menu',o.menu.summary&&o.menu.observedAt?true:null,o.menu.summary&&o.menu.observedAt?'Menu and its observation time are recorded':'Menu summary or its observation time is unknown');
  add('availability',o.availability==='unknown'?null:o.availability==='reported_available','Table availability is unverified; a reservation page does not prove a table exists');
  if(o.reservation.kind!=='reservation_page')unknowns.push('No reported reservation page; homepage/unknown links do not establish a booking route');
  if(!c.localTime)unknowns.push('Meal time is not set');if(c.localTime&&!c.timeZone)unknowns.push('Meal time zone is not set');
  if(o.location.precision==='unknown')unknowns.push('Location precision is unknown');
  for(const charge of o.excludedCharges)unknowns.push(`Excluded or unresolved charge: ${charge}`);
  return {knownSubtotalMinor,totalMinor,eligibility:checks.some(c=>c.status==='fail')?'ineligible':checks.some(c=>c.status==='unknown')||unknowns.length?'conditional':'eligible',checks,unknowns:[...new Set(unknowns)]};
}
