import {airportLocal,airportTimeZone} from './airport-time.js';
import {DomainError,offerSchema,criteriaSchema,canonical,evaluate,type Criteria,type Offer} from './domain.js';
import {reportedMinor} from './serpapi-probe.js';
import {setImmediate as yieldToEventLoop} from 'node:timers/promises';
import {validateFlightEcho,type FlightValidationReason} from './flight-result-validation.js';
import {liveSearchPlan,projectLiveCoverage,type LiveSearchPlan,type LiveAttemptEvent,type LiveQueryRecord} from './live-coverage.js';
import {serpApiDiagnostic,type SerpApiDiagnostic} from './serpapi-diagnostics.js';

export const liveRequestLimit=3,liveObservationLimit=20;
export function validateLiveCriteria(c:Criteria,now=new Date()) {
  criteriaSchema.parse(c);
  const unsupported=[...c.origins,c.destination].filter(code=>!airportTimeZone(code));
  if(unsupported.length)throw new DomainError('UNSUPPORTED_AIRPORT',`No unambiguous airport time zone for: ${unsupported.join(', ')}. Use airport IATA codes, not city codes.`);
  if(c.outbound<=now.toISOString().slice(0,10))throw new DomainError('UNSUPPORTED_SEARCH','Departure must be a future calendar date.');
}
export function liveQuery(c:Criteria):Record<string,string> {
  return {engine:'google_flights',departure_id:c.origins.join(','),arrival_id:c.destination,
    outbound_date:c.outbound,...(c.inbound?{return_date:c.inbound}:{}),adults:String(c.adults),currency:c.currency,
    type:c.inbound?'1':'2',travel_class:'1',hl:'en',gl:'uk',stops:String(c.maxStops+1),no_cache:'true'};
}
// Invert source wall time only when exactly one instant matches the catalogue zone.
export function airportInstant(local:string,airport:string):string|null {
  if(!airportTimeZone(airport)||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(local))return null;
  const nominal=Date.parse(local.replace(' ','T')+':00Z');if(!Number.isFinite(nominal))return null;
  // Probe both sides of future IANA transitions (including half-hour changes
  // and date-line jumps), then round-trip only the distinct observed offsets.
  const offsets=new Set<number>(),matches:string[]=[];
  for(const hours of [-36,0,36]){
    const sample=nominal+hours*3600000,value=airportLocal(new Date(sample).toISOString(),airport)!;
    offsets.add(Date.parse(`${value.date}T${value.time}:00Z`)-sample);
  }
  for(const offset of offsets) {
    const instant=new Date(nominal-offset).toISOString(),value=airportLocal(instant,airport);
    if(value&&`${value.date} ${value.time}`===local)matches.push(instant);
  }
  return matches.length===1?matches[0]!:null;
}
type Json=Record<string,any>;
const object=(v:unknown):Json=>v&&typeof v==='object'&&!Array.isArray(v)?v as Json:{};
const rows=(v:unknown):Json[]=>Array.isArray(v)?v.map(object):[];
const texts=(v:unknown):string[]=>Array.isArray(v)?v.filter((s):s is string=>typeof s==='string').slice(0,10).map(s=>s.slice(0,400)):[];
class SearchStop extends Error {
  constructor(readonly reason:string,readonly uncertain=false,readonly diagnostic?:SerpApiDiagnostic){super(reason);}
}
class ResultRejected extends SearchStop {constructor(){super('result_validation_failed');}}
function sourceTime(body:Json):string|null {
  const value=body.search_metadata?.created_at;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T| )\d{2}:\d{2}:\d{2}(?:\.\d+)?(?: UTC|Z|[+-]\d{2}:\d{2})$/.test(value))return null;
  const time=Date.parse(value.replace(' UTC','Z').replace(' ','T'));
  return Number.isFinite(time)&&time<=Date.now()?new Date(time).toISOString():null;
}
function sourceUrl(body:Json):string {
  try{const url=new URL(body.search_metadata?.google_flights_url);if(url.protocol==='https:'&&url.hostname==='www.google.com'&&url.pathname==='/travel/flights'&&!url.username&&!url.password)return url.href;}catch{}
  return 'https://www.google.com/travel/flights';
}
function segments(result:Json):Offer['outbound']|null {
  const flights=rows(result.flights);if(!flights.length||flights.length>3)return null;
  return flights.map(f=>({operatingFlight:typeof f.flight_number==='string'?f.flight_number:'',
    origin:f.departure_airport?.id,destination:f.arrival_airport?.id,
    departure:airportInstant(f.departure_airport?.time??'',f.departure_airport?.id),
    arrival:airportInstant(f.arrival_airport?.time??'',f.arrival_airport?.id)})) as Offer['outbound'];
}
function baggage(result:Json):string[]{return [...texts(result.baggage_prices),...texts(result.extensions),...rows(result.flights).flatMap(f=>texts(f.extensions))].slice(0,10);}
function restrictions(result:Json):string[]{return [...texts(result.extensions),...(result.separate_tickets===true?['Separate tickets reported; connections and baggage require verification.']:[])].slice(0,10);}
function normalized(c:Criteria,out:Json,back:Json|null,body:Json):Offer|null {
  const outbound=segments(out),inbound=back?segments(back):[];
  if(!outbound||!inbound)return null;
  const parsed=offerSchema.safeParse({outbound,inbound,adults:c.adults,currency:c.currency,
    priceMinor:reportedMinor((back??out).price),priceBasis:'unknown',exactPartyQuoted:false,
    snowboardAllowed:'unknown',snowboardQuantity:null,snowboardTotalMinor:null,
    seller:'Google Flights (seller unverified)',fare:'Economy (fare family unverified)',sourceUrl:sourceUrl(body),
    observedAt:new Date().toISOString(),expiresAt:null,
    discovery:{priceScope:c.inbound?'round_trip':'one_way',supplierObservedAt:sourceTime(body),
      airlines:[...new Set([...rows(out.flights),...rows(back?.flights)].map(f=>f.airline).filter((name):name is string=>typeof name==='string'&&name.length>0).map(name=>name.slice(0,120)))].slice(0,6),
      baggage:{outbound:baggage(out),inbound:back?baggage(back):[]},restrictions:[...restrictions(out),...(back?restrictions(back):[])].slice(0,10)},
    notes:[`${c.adults} adults requested. Observed price basis, supplier availability and fare family unverified.`,
      'Snowboard carriage and costs unknown. Baggage text is source context, not quoted ancillary inventory.',
      'Provider-reported flight numbers; operating carrier unverified. Research source only, not a seller booking link.']});
  if(!parsed.success)return null;
  if(evaluate(parsed.data,c).checks.some(check=>['route','dates','stops','departure_cutoff'].includes(check.constraint)&&check.verdict!=='pass'))return null;
  if([...rows(out.flights),...rows(back?.flights)].some(f=>!/^economy$/i.test(f.travel_class??'')))return null;
  return parsed.data;
}

export class SerpApiFlightProvider {
  constructor(private readonly apiKey:string,private readonly send:typeof fetch=fetch){}
  async search(c:Criteria,record:(event:LiveAttemptEvent)=>Promise<void>,savedPlan?:LiveSearchPlan) {
    validateLiveCriteria(c);
    const plan=savedPlan??liveSearchPlan(c);
    if(![liveSearchPlan(c),liveSearchPlan(c,true)].some(p=>canonical(p)===canonical(plan)))throw new DomainError('UNSUPPORTED_SEARCH','Saved search plan is incompatible; no requests sent.');
    const query=liveQuery(c),offers:Offer[]=[],expanded:string[]=[],seen=new Set<string>();
    const queries:LiveQueryRecord[]=[],pairCounts=Object.fromEntries(c.origins.map(origin=>[origin,{outbound:0,observations:0,returnDestinations:[] as string[],observationLimitReached:false}]));
    let attempts=0,outboundCount=0,rejected=0,expandableCount=0,scanTruncated=false,observationTruncated=false,status='completed',reason='discovery_complete';
    let initialSucceeded=false,expansionFailures=0,baseFailures=0;
    const resultValidationFailures:{attempt:number;stage:string;reason:FlightValidationReason}[]=[],echoOmissions:{attempt:number;fields:string[]}[]=[];
    const returnedAirports=new Set<string>();
    const clean=(value:unknown)=>!JSON.stringify(value).includes(this.apiKey)&&!JSON.stringify(value).includes(encodeURIComponent(this.apiKey));
    const get=async(path:string,params:Record<string,string>):Promise<Json>=>{
      const url=new URL(path,'https://serpapi.com');for(const [k,v]of Object.entries(params))url.searchParams.set(k,v);url.searchParams.set('api_key',this.apiKey);
      let response:Response,body:Json;
      try{response=await this.send(url,{redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw new SearchStop('network_outcome_unknown',true);}
      try{body=object(await response.json());}catch{throw new SearchStop('unreadable_provider_response',true);}
      if(!response.ok||body.error)throw new SearchStop(`provider_${response.status}`,response.status>=500,serpApiDiagnostic(body,response.status,this.apiKey));
      return body;
    };
    const search=async(stage:'outbound'|'return',origins:string[],token?:string,selected?:Json,parentAttempt?:number)=>{
      if(attempts>=liveRequestLimit)throw new SearchStop('request_limit_reached');
      const event={cycle:1,stage,attempt:attempts+1,query:{origins:[...origins],destination:c.destination,
        outboundDate:c.outbound,returnDate:c.inbound,adults:c.adults,currency:c.currency,cabin:'economy' as const,maxStops:c.maxStops,
        fareSource:'SerpApi / Google Flights' as const,...(selected?{selectedOrigin:selected.flights[0].departure_airport.id as string,
          selectedDeparture:canonical(segments(selected)),parentAttempt}:{} )}};
      await record({...event,status:'reserved'});attempts++;
      const entry:LiveQueryRecord={...event.query,attempt:event.attempt,stage,status:'reserved'};queries.push(entry);
      try{
        const params:Record<string,string>={...query,departure_id:origins.join(','),...(token?{departure_token:token}:{})};
        const body=await get('/search.json',params);
        if(body.search_metadata?.status!=='Success')throw new SearchStop('search_not_complete',true);
        const selectedFlights=rows(body.selected_flights),selectedMatches=!!selected&&selectedFlights.length===1&&canonical(segments(selectedFlights[0]!))===canonical(segments(selected));
        const validation=validateFlightEcho(params,object(body.search_parameters),selectedMatches);
        const issue=selected&&selectedFlights.length&&!selectedMatches?'selected_departure_mismatch':validation.reason;
        // Keep supplier completion separate from result usability.
        await record({...event,status:'success',...(issue?{resultValidation:issue}:{})});entry.status='success';
        if(validation.omitted.length)echoOmissions.push({attempt:event.attempt,fields:validation.omitted});
        if(issue){entry.resultValidation=issue;resultValidationFailures.push({attempt:event.attempt,stage,reason:issue});throw new ResultRejected();}
        return body;
      }catch(error){
        if(error instanceof ResultRejected)throw error;
        entry.status=error instanceof SearchStop&&!error.uncertain?'failed':'outcome_unknown';
        await record({...event,status:entry.status,
          ...(error instanceof SearchStop&&error.diagnostic?{diagnostic:error.diagnostic}:{})});
        throw error;
      }
    };
    const collect=(out:Json,back:Json|null,body:Json,origins:string[])=>{
      const offer=normalized({...c,origins},out,back,body);if(!offer||!clean(offer)){rejected++;return;}
      const key=canonical([offer.outbound,offer.inbound]);if(seen.has(key))return;
      if(offers.length>=liveObservationLimit)return;
      seen.add(key);offers.push(offer);returnedAirports.add(offer.outbound[0]!.origin);pairCounts[offer.outbound[0]!.origin]!.observations++;
      const destination=offer.inbound.at(-1)?.destination,destinations=pairCounts[offer.outbound[0]!.origin]!.returnDestinations;
      if(destination&&!destinations.includes(destination))destinations.push(destination);
    };
    try{
      if(!this.apiKey.trim())throw new SearchStop('missing_api_key');
      const account=await get('/account.json',{});
      if(account.account_status!=='Active'||account.plan_monthly_price!==0)throw new SearchStop('active_zero_cost_plan_required');
      if(!Number.isInteger(account.plan_searches_left)||account.plan_searches_left<liveRequestLimit)throw new SearchStop('insufficient_included_credits');
      if(!Number.isInteger(account.account_rate_limit_per_hour)||!Number.isInteger(account.this_hour_searches)||account.account_rate_limit_per_hour-account.this_hour_searches<liveRequestLimit)throw new SearchStop('insufficient_hourly_capacity');
      for(const [baseIndex,origins] of plan.baseQueries.entries()){
        let first:Json;
        try{first=await search('outbound',origins);initialSucceeded=true;}
        catch(error){baseFailures++;if(!(error instanceof SearchStop)||error.uncertain)throw error;continue;}
        const parentAttempt=attempts;
        const candidates=[...rows(first.best_flights),...rows(first.other_flights)];outboundCount+=candidates.length;scanTruncated||=candidates.length>200;
        const valid:Json[]=[],outboundKeys=new Map<Json,string>();
        for(const [index,out] of candidates.slice(0,200).entries()){
          if(index%8===0)await yieldToEventLoop();
          const offer=normalized({...c,origins,inbound:null},out,null,first);
          if(!offer||!clean(offer)){rejected++;continue;}pairCounts[offer.outbound[0]!.origin]!.outbound++;
          valid.push(out);outboundKeys.set(out,canonical(offer.outbound));
        }
        valid.sort((a,b)=>(reportedMinor(a.price)??Infinity)-(reportedMinor(b.price)??Infinity)||outboundKeys.get(a)!.localeCompare(outboundKeys.get(b)!));
        if(!c.inbound){
          // Reserve observation capacity for each planned airport, even when the
          // first supplier response contains many more options than later ones.
          const limit=Math.floor(liveObservationLimit/plan.baseQueries.length)+(baseIndex<liveObservationLimit%plan.baseQueries.length?1:0),before=offers.length;
          for(const [index,out] of valid.entries()){if(index%8===0)await yieldToEventLoop();collect(out,null,first,origins);if(offers.length-before>=limit){if(index+1<valid.length){observationTruncated=true;pairCounts[origins[0]!]!.observationLimitReached=true;}break;}}
        }
        else{
          const departures=new Set<string>(),distinct=valid.filter(out=>{const key=outboundKeys.get(out)!;if(departures.has(key))return false;departures.add(key);return true;});
          const chosen:Json[]=[];
          const hasToken=(out:Json)=>typeof out.departure_token==='string'&&out.departure_token.length>0&&out.departure_token.length<=30000;
          expandableCount=distinct.filter(hasToken).length;
          // Prefer different requested origins before spending both slots at one airport.
          for(const out of distinct){if(chosen.length===2)break;if(!chosen.some(v=>v.flights[0].departure_airport.id===out.flights[0].departure_airport.id)&&hasToken(out))chosen.push(out);}
          for(const out of distinct){if(chosen.length===2)break;if(!chosen.includes(out)&&hasToken(out))chosen.push(out);}
          for(const out of chosen){
            try{
              const response=await search('return',origins,out.departure_token,out,parentAttempt);
              expanded.push(canonical(segments(out)));
              const returning=[...rows(response.best_flights),...rows(response.other_flights)];scanTruncated||=returning.length>200;
              const before=offers.length;
              for(const [index,back] of returning.slice(0,200).entries()){if(index%8===0)await yieldToEventLoop();collect(out,back,response,origins);if(offers.length-before>=10){if(index+1<returning.length){observationTruncated=true;pairCounts[out.flights[0].departure_airport.id]!.observationLimitReached=true;}break;}}
            }catch(error){expansionFailures++;if(!(error instanceof SearchStop)||error.uncertain)throw error;}
          }
        }
      }
      if(baseFailures){reason=initialSucceeded?'partial_airport_query_failure':'all_airport_queries_failed';if(!initialSucceeded)status='stopped';}
      else if(plan.omittedOrigins.length)reason='airport_query_budget_exhausted';
      if(expansionFailures)reason='partial_return_expansion_failure';
      else if(c.inbound&&!expanded.length&&outboundCount)reason='no_expandable_departures';
      if(resultValidationFailures.length){reason=offers.length?'partial_result_validation_failure':'result_validation_failed';if(!offers.length)status='stopped';}
    }catch(error){status=error instanceof SearchStop&&!error.uncertain?'stopped':'outcome_unknown';reason=error instanceof SearchStop?error.reason:'ledger_or_worker_failure';}
    return {offers,report:{status,reason,requestsAttempted:attempts,coverage:projectLiveCoverage({complete:false,plan,queries,pairCounts,
      requestedAirports:c.origins,queriedAirports:[...new Set(queries.filter(q=>q.stage==='outbound'&&q.status==='success'&&!q.resultValidation).flatMap(q=>q.origins))],returnedAirports:[...returnedAirports],
      notRequestedAirports:plan.omittedOrigins,unknownCoverageAirports:c.origins.filter(code=>!returnedAirports.has(code)),
      query:c.inbound?query:null,initialQuerySucceeded:initialSucceeded,outboundResults:outboundCount,expandedOutboundCount:expanded.length,
      expandedDepartures:expanded.map(value=>JSON.parse(value)),unexpandedOutboundCount:Math.max(0,expandableCount-expanded.length),
      scanTruncated,
      baseQueryFailures:baseFailures,expansionFailures,resultValidationFailures,echoOmissions,rejectedResults:rejected,expansionLimit:plan.maximumReturnExpansions,observationLimit:liveObservationLimit,
      observationTruncated,resultLimitReached:offers.length===liveObservationLimit||observationTruncated,
      sample:plan.mode==='legacy_combined'?'Legacy combined airport query; no isolated airport sweep.':c.inbound?'One combined airport query; up to two outbound return expansions. No isolated return sweep, seller quotes or baggage inventory.':'Up to three individual origin queries in saved order. Remaining airports omitted for budget; no seller quotes or baggage inventory.',
      priceBasisVerified:false,snowboardVerified:false})}};
  }
}
export type LiveFlightProvider=Pick<SerpApiFlightProvider,'search'>;
