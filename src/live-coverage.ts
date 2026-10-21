import type {Criteria} from './domain.js';
import type {ProbeEvent} from './serpapi-probe.js';
import type {LiveProviderEvent,FlightValidationReason} from './flight-result-validation.js';

export interface LiveSearchPlan {
  version:1;
  mode:'combined_return'|'per_airport_one_way'|'legacy_combined';
  maximumProviderRequests:3;
  baseQueries:string[][];
  maximumReturnExpansions:number;
  omittedOrigins:string[];
  pairs:{origin:string;destination:string;outboundDate:string;returnDate:string|null}[];
}
export function liveSearchPlan(c:Criteria,legacy=false):LiveSearchPlan {
  const combined=!!c.inbound||legacy;
  return {version:1,mode:legacy?'legacy_combined':c.inbound?'combined_return':'per_airport_one_way',maximumProviderRequests:3,
    baseQueries:combined?[[...c.origins]]:c.origins.slice(0,3).map(origin=>[origin]),
    maximumReturnExpansions:c.inbound?2:0,omittedOrigins:combined?[]:c.origins.slice(3),
    pairs:c.origins.map(origin=>({origin,destination:c.destination,outboundDate:c.outbound,returnDate:c.inbound}))};
}
export interface LiveQueryScope {
  origins:string[];destination:string;outboundDate:string;returnDate:string|null;
  adults:number;currency:string;cabin:'economy';maxStops:number;fareSource:'SerpApi / Google Flights';
  selectedOrigin?:string;selectedDeparture?:string;parentAttempt?:number;
}
export type LiveAttemptEvent=LiveProviderEvent&{query?:LiveQueryScope};
export type LiveQueryRecord=LiveQueryScope&{attempt:number;stage:ProbeEvent['stage'];status:ProbeEvent['status'];resultValidation?:FlightValidationReason};

// Reconcile scope with the authoritative attempt ledger on every read, including
// reserved intents left by a crashed worker. No new provider request is implied.
export function projectLiveCoverage(coverage:any,attempts:{attempt:number;status:ProbeEvent['status'];diagnostic?:{resultValidation?:{reason:FlightValidationReason}}}[]=[]) {
  if(coverage?.plan?.version!==1||!Array.isArray(coverage.plan.pairs))return coverage;
  const queries:LiveQueryRecord[]=(coverage.queries??[]).map((q:LiveQueryRecord)=>{
    const attempt=attempts.find(a=>a.attempt===q.attempt),resultValidation=attempt?.diagnostic?.resultValidation?.reason??q.resultValidation;
    return {...q,status:attempt?.status??q.status,...(resultValidation?{resultValidation}:{})};
  });
  const pairs=coverage.plan.pairs.map((pair:LiveSearchPlan['pairs'][number])=>{
    const outbound=queries.filter(q=>q.stage==='outbound'&&q.origins.includes(pair.origin));
    const returning=queries.filter(q=>q.stage==='return'&&q.selectedOrigin===pair.origin);
    const status=(records:LiveQueryRecord[])=>records.some(q=>q.status==='outcome_unknown')?'outcome_unknown':records.some(q=>q.status==='reserved')?'reserved':records.some(q=>q.status==='success'&&!q.resultValidation)?(records.some(q=>q.status==='failed'||q.resultValidation)?'partially_queried':'queried'):records.some(q=>q.resultValidation)?'result_rejected':records.length?'failed':'not_attempted';
    const counts=coverage.pairCounts?.[pair.origin];
    return {...pair,outbound:{status:status(outbound),scope:outbound.length?(outbound[0]!.origins.length===1?'single_airport':'combined_airports'):null,
      attempts:outbound.map(q=>q.attempt),validItineraries:outbound.some(q=>q.status==='success'&&!q.resultValidation)?(counts?.outbound??null):null},
      return:{status:pair.returnDate?status(returning):'not_required',attempts:returning.map(q=>q.attempt),returnedDestinations:counts?.returnDestinations??[]},
      observationCount:counts?.observations??null,observationLimitReached:counts?.observationLimitReached??false,
      omissionReason:coverage.plan.omittedOrigins.includes(pair.origin)?'request_budget':!outbound.length?'not_attempted':pair.returnDate&&!returning.length?'return_not_expanded':null,
      fareSources:[...new Set([...outbound,...returning].map(q=>q.fareSource))],complete:false};
  });
  return {...coverage,queries,pairs,unattemptedAirports:pairs.filter((p:any)=>!p.outbound.attempts.length).map((p:any)=>p.origin),complete:false};
}
