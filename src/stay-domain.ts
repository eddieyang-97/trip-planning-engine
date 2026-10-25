import {z} from 'zod';
import {mutation,uuid} from './domain.js';

const money=z.number().int().min(0).max(1_000_000_000_000);
const text=(max:number)=>z.string().trim().max(max);
const https=z.string().max(2000).refine(value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}},'Use an HTTPS source link');
const dates={checkIn:z.iso.date(),checkOut:z.iso.date()};
const validDates=(value:{checkIn:string;checkOut:string})=>value.checkOut>value.checkIn;
export const stayCriteriaSchema=z.strictObject({...dates,adults:z.number().int().min(1).max(10),currency:z.string().regex(/^[A-Z]{3}$/),
  maximumTotalMinor:money.nullable(),minimumSleepingPlaces:z.number().int().min(1).max(50).nullable()}).refine(validDates,'Check-out must follow check-in');
export const stayObservationSchema=z.strictObject({
  propertyName:text(160).min(1),configurationLabel:text(160).min(1),kind:z.enum(['hotel_rooms','entire_home']),
  units:z.array(z.strictObject({name:text(120).min(1),count:z.number().int().min(1).max(20),
    beds:z.array(z.strictObject({type:z.enum(['single','double','bunk','sofa_bed','other']),count:z.number().int().min(1).max(20),sleepingPlaces:z.number().int().min(1).max(10).nullable()})).max(20)})).min(1).max(20),
  quotedAdults:z.number().int().min(1).max(50).nullable(),...dates,currency:z.string().regex(/^[A-Z]{3}$/),baseTotalMinor:money.nullable(),
  charges:z.array(z.strictObject({label:text(120).min(1),kind:z.enum(['tax','cleaning','linen','other']),amountMinor:money.nullable(),includedInBase:z.boolean().nullable()})).max(30),
  mandatoryChargesComplete:z.boolean(),excludedCharges:z.array(text(300).min(1)).max(20),
  refundableDeposit:z.strictObject({amountMinor:money.nullable(),terms:text(1000)}).nullable(),
  location:z.strictObject({label:text(250),precision:z.enum(['exact','approximate','unknown']),latitude:z.number().finite().min(-85).max(85).nullable(),longitude:z.number().finite().min(-180).max(180).nullable()}),
  checkInDetails:text(1000),cancellation:z.strictObject({terms:text(2000),freeUntil:z.iso.datetime({offset:true}).nullable()}),
  availability:z.enum(['reported_available','unavailable','unknown']),
  source:z.strictObject({url:https.nullable(),label:text(160).min(1),observedAt:z.iso.datetime({offset:true}),kind:z.enum(['manual','sourced'])}),unknowns:z.array(text(300).min(1)).max(30),
}).superRefine((o,ctx)=>{
  if(!validDates(o))ctx.addIssue({code:'custom',message:'Check-out must follow check-in',path:['checkOut']});
  if(o.kind==='entire_home'&&(o.units.length!==1||o.units[0]!.count!==1))ctx.addIssue({code:'custom',message:'An entire home is one unit; describe its beds inside that unit',path:['units']});
  if((o.location.latitude===null)!==(o.location.longitude===null))ctx.addIssue({code:'custom',message:'Supply both coordinates or neither',path:['location']});
  if(o.location.precision==='exact'&&o.location.latitude===null)ctx.addIssue({code:'custom',message:'An exact location needs coordinates',path:['location']});
  if(o.source.kind==='sourced'&&!o.source.url)ctx.addIssue({code:'custom',message:'Sourced evidence needs its source link',path:['source','url']});
  if(Date.parse(o.source.observedAt)>Date.now()+300_000)ctx.addIssue({code:'custom',message:'Observation time cannot be in the future',path:['source','observedAt']});
});
export type StayCriteria=z.infer<typeof stayCriteriaSchema>;
export type StayObservation=z.infer<typeof stayObservationSchema>;
const edit={...mutation,decisionId:uuid,expectedRevision:z.number().int().positive()};
export const staySchemas={
  create_stay_decision:z.strictObject({...mutation,tripId:uuid,title:text(120).min(1),criteria:stayCriteriaSchema}),
  list_stay_decisions:z.strictObject({tripId:uuid}),
  get_stay_decision:z.strictObject({decisionId:uuid}),
  get_stay_observation:z.strictObject({decisionId:uuid,observationId:uuid}),
  save_stay_candidate:z.strictObject({...edit,candidateId:uuid.optional(),observation:stayObservationSchema,
    identityReview:z.strictObject({priorObservationId:uuid,confirmedSameConfiguration:z.literal(true),reason:text(1000).min(1)}).optional()}),
  set_stay_disposition:z.strictObject({...edit,candidateId:uuid,disposition:z.enum(['neutral','saved','rejected']),rationale:text(2000)}),
  compare_stays:z.strictObject({decisionId:uuid}),
  select_stay_candidate:z.strictObject({...edit,observationId:uuid,rationale:text(2000).min(1),acknowledgeUnknowns:z.boolean().default(false)}),
  commit_stay_selection:z.strictObject({...edit,expectedItineraryRevision:z.number().int().positive(),selectionId:uuid}),
};
export type StayToolName=keyof typeof staySchemas;
export const stayReads=new Set<StayToolName>(['list_stay_decisions','get_stay_decision','get_stay_observation','compare_stays']);
export interface StayAssessment {
  knownSubtotalMinor:number|null;totalMinor:number|null;sleepingPlaces:number|null;bedCount:number|null;nights:number;
  eligibility:'eligible'|'conditional'|'ineligible';checks:{name:string;status:'pass'|'fail'|'unknown';detail:string}[];unknowns:string[];
}
export function evaluateStay(o:StayObservation,c:StayCriteria):StayAssessment{
  const checks:StayAssessment['checks']=[],unknowns=[...o.unknowns];
  const add=(name:string,pass:boolean|null,detail:string)=>{checks.push({name,status:pass===null?'unknown':pass?'pass':'fail',detail});if(pass===null)unknowns.push(detail);};
  const sameDates=o.checkIn===c.checkIn&&o.checkOut===c.checkOut,sameParty=o.quotedAdults===c.adults,sameCurrency=o.currency===c.currency;
  add('dates',sameDates,'Quote must cover the exact check-in and check-out dates');
  add('party',o.quotedAdults===null?null:sameParty,'Quote must cover the whole adult party');
  add('currency',sameCurrency,'Compare amounts only in the decision currency; no conversion is inferred');
  const additionalKnown=o.charges.filter(f=>f.includedInBase===false&&f.amountMinor!==null).map(f=>f.amountMinor!);
  const knownParts=[...(o.baseTotalMinor===null?[]:[o.baseTotalMinor]),...additionalKnown];
  const knownSubtotalMinor=knownParts.length?knownParts.reduce((sum,value)=>sum+value,0):null;
  const complete=o.baseTotalMinor!==null&&o.mandatoryChargesComplete&&o.excludedCharges.length===0&&o.charges.every(f=>f.includedInBase===true||f.includedInBase===false&&f.amountMinor!==null);
  const totalMinor=complete&&sameDates&&sameParty&&sameCurrency?knownSubtotalMinor:null;
  add('total',totalMinor===null?null:true,'Whole-stay, all-unit mandatory total is not fully established');
  if(c.maximumTotalMinor!==null){
    const trustedBasis=sameDates&&sameParty&&sameCurrency;
    add('budget',trustedBasis&&knownSubtotalMinor!==null&&knownSubtotalMinor>c.maximumTotalMinor?false:totalMinor===null?null:totalMinor<=c.maximumTotalMinor,'Known exact-party costs above the budget fail even when mandatory costs are missing');
  }
  let sleepingPlaces:number|null=0,bedCount:number|null=0;
  for(const unit of o.units){if(!unit.beds.length){sleepingPlaces=null;bedCount=null;continue;}for(const bed of unit.beds){if(bedCount!==null)bedCount+=unit.count*bed.count;if(bed.sleepingPlaces===null)sleepingPlaces=null;else if(sleepingPlaces!==null)sleepingPlaces+=unit.count*bed.count*bed.sleepingPlaces;}}
  add('sleeping_capacity',sleepingPlaces===null?null:sleepingPlaces>=Math.max(c.adults,c.minimumSleepingPlaces??0),'Actual supplied sleeping places must cover the party; bed types alone do not establish capacity');
  add('availability',o.availability==='unknown'?null:o.availability==='reported_available','Availability is a dated report, never supplier verification');
  add('cancellation',o.cancellation.terms?true:null,'Cancellation/refund terms are unknown');
  add('check_in',o.checkInDetails?true:null,'Check-in constraints are unknown');
  if(!o.refundableDeposit||o.refundableDeposit.amountMinor===null)unknowns.push('Refundable deposit cash exposure is unknown');
  if(o.location.precision==='unknown')unknowns.push('Location precision is unknown');
  for(const charge of o.excludedCharges)unknowns.push(`Excluded or unresolved charge: ${charge}`);
  const eligibility=checks.some(c=>c.status==='fail')?'ineligible':checks.some(c=>c.status==='unknown')||unknowns.length?'conditional':'eligible';
  return {knownSubtotalMinor,totalMinor,sleepingPlaces,bedCount,nights:(Date.parse(o.checkOut)-Date.parse(o.checkIn))/86_400_000,eligibility,checks,unknowns:[...new Set(unknowns)]};
}
