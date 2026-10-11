// Diagnostic only: no database writes, bookings, pagination or production provider registration.
import { reportedMinor } from './serpapi-probe.js';

type Json = Record<string, unknown>;
export type StayMode = 'hotels'|'rentals'|'airbnb';
export interface StayProbeEvent { mode:StayMode;stage:'search'|'detail';attempt:number;status:'reserved'|'success'|'failed'|'outcome_unknown' }
export const accommodationProbeLimit=5;
export const stayDates=Object.freeze({check_in_date:'2026-12-18',check_out_date:'2026-12-20'});
export function accommodationQuery(mode:StayMode):Record<string,string> {
  const common={q:'Flaine, France',...stayDates,adults:'4',currency:'GBP',no_cache:'true'};
  return mode==='airbnb'?{...common,engine:'airbnb',airbnb_domain:'airbnb.co.uk'}:
    {...common,engine:'google_hotels',hl:'en',gl:'uk',...(mode==='rentals'?{vacation_rentals:'true'}:{})};
}
const object=(v:unknown):Json=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Json:{};
const objects=(v:unknown):Json[]=>Array.isArray(v)?v.map(object):[];
const string=(v:unknown):string|null=>typeof v==='string'?v.slice(0,400):null;
const strings=(v:unknown):string[]=>Array.isArray(v)?v.filter((x):x is string=>typeof x==='string').slice(0,15).map(x=>x.slice(0,400)):[];
const count=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
function safeLink(v:unknown):string|null {
  if(typeof v!=='string'||v.length>4000)return null;
  try{const url=new URL(v);if(url.protocol!=='https:'||url.username||url.password||url.hostname==='serpapi.com'||url.hostname.endsWith('.serpapi.com'))return null;
    // Keep a reviewable property page, but omit query tokens and tracking data.
    return url.origin+url.pathname;
  }catch{return null;}
}
function rates(value:unknown) {
  const rate=object(value);
  return {reportedMinor:reportedMinor(rate.extracted_lowest),displayText:string(rate.lowest),
    beforeTaxesMinor:reportedMinor(rate.extracted_before_taxes_fees)};
}
export function accommodationEvidence(raw:unknown,mode:StayMode) {
  const item=object(raw),isAirbnb=mode==='airbnb';
  const dateMatch=isAirbnb?item.check_in_date===stayDates.check_in_date&&item.check_out_date===stayDates.check_out_date:null;
  const total=isAirbnb?{reportedMinor:dateMatch?reportedMinor(item.extracted_price):null,
    displayText:dateMatch?string(item.price):null,beforeTaxesMinor:null}:rates(item.total_rate);
  return {
    fetchedAt:new Date().toISOString(),
    name:string(item.name),typeText:string(item.type??item.title),sourceUrl:safeLink(item.link),
    listingId:isAirbnb?string(item.listing_id):null,
    reportedDates:isAirbnb?{checkin:string(item.check_in_date),checkout:string(item.check_out_date),match:dateMatch}:null,
    totalRate:total,nightlyRate:isAirbnb?null:rates(item.rate_per_night),
    priceQualifier:isAirbnb?string(item.price_qualifier):'provider total_rate field; allocation unverified',
    // Descriptive text only: breakdowns may contain subtotals, totals, discounts and duplicate fees.
    breakdownText:isAirbnb?objects(item.price_breakdown).slice(0,15).map(x=>({description:string(x.description),price:string(x.price)})):[],
    priceDisclaimers:strings(item.price_disclaimers),
    layoutText:strings(isAirbnb?item.details:item.essential_info),
    bedrooms:count(item.bedrooms),beds:count(item.beds),bathrooms:count(item.bathrooms),
    checkinTimeText:string(item.check_in_time),checkoutTimeText:string(item.check_out_time),
    cancellationClaim:typeof item.free_cancellation==='boolean'?item.free_cancellation:null,
    cancellationDeadline:null,lateArrivalConfirmed:null,securityDeposit:null,
    sellers:objects(item.prices).slice(0,10).map(p=>({name:string(p.source),sourceUrl:safeLink(p.link),
      totalRate:rates(p.total_rate),nightlyRate:rates(p.rate_per_night)})),
    fullStayTotalMinor:null,exactPartyQuoted:false,roomAllocationVerified:false,
    mandatoryCharges:'unknown',availability:'unverified',expiresAt:null,
  };
}
class Stop extends Error {
  constructor(readonly reason:string,readonly outcome:'blocked'|'stopped'|'outcome_unknown'='stopped'){super(reason);}
}
function validToken(value:unknown):value is string {return typeof value==='string'&&value.length>0&&value.length<=30000;}
export async function runAccommodationProbe(options:{apiKey:string;send?:typeof fetch;record:(event:StayProbeEvent)=>Promise<void>}) {
  const send=options.send??fetch;let attempts=0;
  const results:{mode:StayMode;supplierCreatedAt:string|null;returnedCount:number;truncated:boolean;nextPageNotFetched:boolean;
    observations:ReturnType<typeof accommodationEvidence>[];detail:ReturnType<typeof accommodationEvidence>|null;detailStatus:string}[]=[];
  const base={maximumSearchRequests:accommodationProbeLimit,
    queries:(['hotels','rentals','airbnb'] as const).map(mode=>({mode,query:accommodationQuery(mode)})),
    assumptions:['Four adults; ages are unconfirmed.','No bedroom, bed or room-count requirement is assumed.'],
    coverage:{complete:false,hotelTwoRoomAllocation:'unsupported_by_this_probe',airbnbSource:'third_party_serpapi_search',
      warning:'First pages only; destination membership, exact party/unit allocation, final charges and seller availability require verification.'},
    verifiedLiveIntegration:false};
  async function get(path:string,parameters:Record<string,string>) {
    const url=new URL(path,'https://serpapi.com');
    for(const [key,value]of Object.entries(parameters))url.searchParams.set(key,value);
    url.searchParams.set('api_key',options.apiKey);
    let response:Response;
    try{response=await send(url,{redirect:'error',signal:AbortSignal.timeout(30000)});}
    catch{throw new Stop('network_outcome_unknown','outcome_unknown');}
    if(!response.ok)throw new Stop(`provider_http_${response.status}`,response.status>=500?'outcome_unknown':'stopped');
    let body:Json;
    try{body=object(await response.json());}catch{throw new Stop('unreadable_provider_response','outcome_unknown');}
    if(body.error)throw new Stop('provider_reported_error');
    return body;
  }
  async function search(mode:StayMode,token?:string) {
    if(attempts>=accommodationProbeLimit)throw new Stop('request_limit_reached');
    const stage=token?'detail':'search',event={mode,stage,attempt:attempts+1} as const;
    await options.record({...event,status:'reserved'});attempts++;
    try {
      const query=accommodationQuery(mode);
      const body=await get('/search.json',{...query,...(token?{property_token:token}:{})});
      if(object(body.search_metadata).status!=='Success')throw new Stop('search_not_complete','outcome_unknown');
      const echo=object(body.search_parameters);
      for(const [key,value]of Object.entries(query)) {
        if(key!=='no_cache'&&String(echo[key])!==value)throw new Stop('request_echo_missing_or_mismatched');
      }
      if(mode==='hotels'&&(echo.vacation_rentals===true||echo.vacation_rentals==='true'))throw new Stop('request_echo_missing_or_mismatched');
      if(token&&(echo.property_token!==token||body.property_token!==token))throw new Stop('detail_property_mismatch');
      await options.record({...event,status:'success'});
      return body;
    }catch(error){
      await options.record({...event,status:error instanceof Stop&&error.outcome==='outcome_unknown'?'outcome_unknown':'failed'});
      throw error;
    }
  }
  try {
    if(!options.apiKey.trim())throw new Stop('missing_api_key','blocked');
    const account=await get('/account.json',{});
    if(account.account_status!=='Active'||account.plan_monthly_price!==0)throw new Stop('active_zero_cost_plan_required','blocked');
    if(!Number.isInteger(account.plan_searches_left)||Number(account.plan_searches_left)<accommodationProbeLimit)throw new Stop('insufficient_included_credits','blocked');
    if(!Number.isInteger(account.account_rate_limit_per_hour)||!Number.isInteger(account.this_hour_searches)
      ||Number(account.account_rate_limit_per_hour)-Number(account.this_hour_searches)<accommodationProbeLimit)throw new Stop('insufficient_hourly_capacity','blocked');
    // Capture all three search modes first, then spend at most two requests on Google property details.
    const selected:{mode:StayMode;token:string;index:number}[]=[];
    for(const mode of ['hotels','rentals','airbnb'] as const) {
      const body=await search(mode),field=mode==='airbnb'?'organic_results':'properties';
      const direct=mode!=='airbnb'&&validToken(body.property_token)&&typeof body.name==='string';
      if(!direct&&!Array.isArray(body[field]))throw new Stop('result_collection_missing');
      const items=direct?[body]:objects(body[field]);
      results.push({mode,supplierCreatedAt:string(object(body.search_metadata).created_at),returnedCount:items.length,truncated:items.length>10,
        nextPageNotFetched:!!object(body.serpapi_pagination).next_page_token,
        observations:items.slice(0,10).map(item=>accommodationEvidence(item,mode)),
        detail:direct?accommodationEvidence(body,mode):null,detailStatus:direct?'returned_by_search':mode==='airbnb'?'not_supported_by_probe':'no_property_token'});
      const candidate=items.slice(0,10).find(item=>validToken(item.property_token));
      if(mode!=='airbnb'&&!direct&&candidate)selected.push({mode,token:candidate.property_token as string,index:results.length-1});
    }
    for(const selectedProperty of selected) {
      const detail=await search(selectedProperty.mode,selectedProperty.token);
      results[selectedProperty.index]!.detail=accommodationEvidence(detail,selectedProperty.mode);
      results[selectedProperty.index]!.detailStatus='captured';
    }
    return {...base,status:'completed',reason:'bounded_responses_captured',requestsAttempted:attempts,results};
  }catch(error){return {...base,status:error instanceof Stop?error.outcome:'stopped',
    reason:error instanceof Stop?error.reason:'probe_failed',requestsAttempted:attempts,results};}
}
