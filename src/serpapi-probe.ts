// Standalone capability probe. This is deliberately not a production FlightProvider.
export const probeQuery = Object.freeze({ engine:'google_flights',departure_id:'LGW',arrival_id:'GVA',
  outbound_date:'2026-12-18',return_date:'2026-12-20',adults:'4',currency:'GBP',type:'1',
  travel_class:'1',hl:'en',gl:'uk',stops:'1',no_cache:'true' });
export const probeLimit = 6;
type Json = Record<string, any>;
type Stage = 'outbound' | 'return' | 'booking';
export interface ProbeEvent { cycle: number; stage: Stage; attempt: number; status: 'reserved' | 'success' | 'failed' | 'outcome_unknown' }
interface ProbeOptions {
  apiKey: string;
  send?: typeof fetch;
  // Called before every potentially metered request and after its response.
  record: (event: ProbeEvent) => Promise<void>;
}
class ProbeStop extends Error {
  constructor(readonly reason: string,readonly outcome: 'blocked' | 'stopped' | 'outcome_unknown' = 'stopped') { super(reason); }
}
const object = (value:unknown): Json => value && typeof value==='object' && !Array.isArray(value) ? value as Json : {};
const array = (value:unknown): Json[] => Array.isArray(value) ? value.map(object) : [];
const text = (value:unknown): string | null => typeof value==='string' ? value.slice(0,500) : null;
const texts = (value:unknown): string[] => Array.isArray(value) ? value.filter((v):v is string=>typeof v==='string').slice(0,20).map(v=>v.slice(0,500)) : [];

export function reportedMinor(value:unknown): number | null {
  if(typeof value!=='number'||!Number.isFinite(value)||value<0)return null;
  const match=/^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if(!match)return null;
  const amount=BigInt(match[1]!)*100n+BigInt((match[2]??'').padEnd(2,'0'));
  return amount<=BigInt(Number.MAX_SAFE_INTEGER)?Number(amount):null;
}
function legSummary(result:Json) {
  return array(result.flights).map(f=>({ airline:text(f.airline),flightNumber:text(f.flight_number),
    origin:text(object(f.departure_airport).id),destination:text(object(f.arrival_airport).id),
    departureLocal:text(object(f.departure_airport).time),arrivalLocal:text(object(f.arrival_airport).time),
    travelClass:text(f.travel_class) }));
}
function legKey(result:Json) { return JSON.stringify(legSummary(result)); }
function matchingDirectLeg(result:Json,stage:'outbound'|'return') {
  const flights=legSummary(result),f=flights[0];
  const outbound=stage==='outbound';
  return flights.length===1 && !!f && /^easyjet\b/i.test(f.airline??'') && !!f.flightNumber
    && f.origin===(outbound?'LGW':'GVA') && f.destination===(outbound?'GVA':'LGW')
    && f.departureLocal?.startsWith(outbound?probeQuery.outbound_date:probeQuery.return_date)
    && /^economy$/i.test(f.travelClass??'') && !!f.arrivalLocal;
}
function selectLeg(response:Json,stage:'outbound'|'return',previous?:string) {
  const field=stage==='outbound'?'departure_token':'booking_token';
  const matches=[...array(response.best_flights),...array(response.other_flights)]
    .filter(r=>matchingDirectLeg(r,stage)&&typeof r[field]==='string'&&r[field].length>0&&r[field].length<=30000)
    .sort((a,b)=>legKey(a).localeCompare(legKey(b)));
  const selected=previous?matches.find(r=>legKey(r)===previous):matches[0];
  if(!selected)throw new ProbeStop(previous?`previous_${stage}_not_returned`:`no_matching_easyjet_${stage}_with_token`);
  return selected;
}
function handoff(value:unknown) {
  const request=object(value);
  try {
    const url=new URL(request.url);
    if(url.protocol!=='https:'||url.username||url.password)return {status:'invalid',method:null,host:null};
    return {status:'not_tested',method:request.post_data?'POST':'GET',host:url.hostname};
  }catch{return {status:'missing',method:null,host:null};}
}
function researchUrl(value:unknown): string | null {
  try{const url=new URL(String(value));return url.protocol==='https:'&&url.hostname==='www.google.com'
    &&url.pathname==='/travel/flights'&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
export function bookingEvidence(response:Json,outbound:Json,inbound:Json) {
  const selected=array(response.selected_flights);
  if(selected.length!==2||legKey(selected[0]!)!==legKey(outbound)||legKey(selected[1]!)!==legKey(inbound)) {
    throw new ProbeStop('booking_itinerary_does_not_match_selected_pair');
  }
  const options=array(response.booking_options);
  if(!options.length)throw new ProbeStop('no_booking_options_returned');
  return {
    selectedFlights:selected.map(legSummary),
    supplierCreatedAt:text(object(response.search_metadata).created_at),
    fetchedAt:new Date().toISOString(),researchUrl:researchUrl(object(response.search_metadata).google_flights_url),
    rawOptionCount:options.length,optionsTruncated:options.length>10,
    baggageText:{together:texts(object(response.baggage_prices).together),departing:texts(object(response.baggage_prices).departing),returning:texts(object(response.baggage_prices).returning)},
    options:options.slice(0,10).map(option=>{
      const together=object(option.together);
      return { seller:text(together.book_with),fare:text(together.option_title),marketedAs:texts(together.marketed_as),
        separateTickets:typeof option.separate_tickets==='boolean'?option.separate_tickets:null,
        reportedPriceMinor:reportedMinor(together.price),currency:'GBP',priceBasis:'unverified',
        baggageText:texts(together.baggage_prices),conditions:texts(together.extensions),handoff:handoff(together.booking_request) };
    }),
    exactPartyQuoted:false,partyPriceVerification:'Manual comparison with the labeled seller total is still required.',
    snowboardAvailability:'unverified',snowboardTotalMinor:null,expiresAt:null,
  };
}

export async function runSerpApiProbe(options:ProbeOptions) {
  let attempts=0;
  const cycles:Json[]=[];
  const send=options.send??fetch;
  const baseReport={query:probeQuery,maximumSearchRequests:probeLimit,
    assumptions:['Four adults; traveler ages are unconfirmed.','Nonstop LGW–GVA only for this initial probe.','One snowboard remains an assumption; this API probe does not verify its carriage.'],
    coverage:{complete:false,requestedAirports:['LGW'],notRequestedAirports:['LHR','LTN','STN','LCY','SEN']},
    warning:'Provider observations are unverified research evidence. No supplier hold, complete party price, snowboard availability, booking or production integration is established.'};
  async function get(path:string,parameters:Record<string,string>) {
    const url=new URL(path,'https://serpapi.com');
    for(const [name,value]of Object.entries(parameters))url.searchParams.set(name,value);
    url.searchParams.set('api_key',options.apiKey);
    // Never expose fetch errors: they can include a URL containing the key.
    let response:Response;
    try{response=await send(url,{redirect:'error',signal:AbortSignal.timeout(30000)});}
    catch{throw new ProbeStop('network_outcome_unknown','outcome_unknown');}
    if(!response.ok)throw new ProbeStop(`provider_http_${response.status}`,response.status>=500?'outcome_unknown':'stopped');
    let body:Json;
    try{body=object(await response.json());}catch{throw new ProbeStop('unreadable_provider_response','outcome_unknown');}
    if(body.error)throw new ProbeStop('provider_reported_error');
    return body;
  }
  async function search(cycle:number,stage:Stage,tokens:Record<string,string>={}) {
    if(attempts>=probeLimit)throw new ProbeStop('request_limit_reached');
    const event={cycle,stage,attempt:attempts+1};
    await options.record({...event,status:'reserved'}); // Fail before spending if the ledger cannot be written.
    attempts++;
    let result:Json;
    try {
      result=await get('/search.json',{...probeQuery,...tokens});
      if(object(result.search_metadata).status!=='Success')throw new ProbeStop('search_not_complete','outcome_unknown');
      for(const name of ['engine','departure_id','arrival_id','outbound_date','return_date','adults','currency','type','travel_class'] as const) {
        if(String(object(result.search_parameters)[name])!==probeQuery[name])throw new ProbeStop('request_echo_missing_or_mismatched');
      }
    }catch(error){
      await options.record({...event,status:error instanceof ProbeStop&&error.outcome==='outcome_unknown'?'outcome_unknown':'failed'});
      throw error;
    }
    await options.record({...event,status:'success'});
    return result;
  }
  try {
    if(!options.apiKey.trim())throw new ProbeStop('missing_api_key','blocked');
    const account=await get('/account.json',{});
    // The probe is approved for Free credits only. Never buy credits or enable an overage.
    if(account.account_status!=='Active'||account.plan_monthly_price!==0)throw new ProbeStop('active_zero_cost_plan_required','blocked');
    if(!Number.isInteger(account.plan_searches_left)||account.plan_searches_left<probeLimit)throw new ProbeStop('insufficient_included_credits','blocked');
    if(!Number.isInteger(account.account_rate_limit_per_hour)||!Number.isInteger(account.this_hour_searches)
      ||account.account_rate_limit_per_hour-account.this_hour_searches<probeLimit)throw new ProbeStop('insufficient_hourly_capacity','blocked');
    let previousOutbound:string|undefined,previousInbound:string|undefined;
    for(const cycle of [1,2]) {
      const outbound=selectLeg(await search(cycle,'outbound'),'outbound',previousOutbound);
      const inbound=selectLeg(await search(cycle,'return',{departure_token:outbound.departure_token}),'return',previousInbound);
      const booking=await search(cycle,'booking',{booking_token:inbound.booking_token});
      cycles.push({cycle,...bookingEvidence(booking,outbound,inbound)});
      previousOutbound=legKey(outbound);previousInbound=legKey(inbound);
    }
    return {...baseReport,status:'completed',reason:'two_same_itinerary_observations_captured',requestsAttempted:attempts,cycles,
      verifiedLiveIntegration:false,comparison:'Same flight pair requested twice; price basis, fare equivalence and seller handoff still require manual validation. No confirmed price delta calculated.'};
  }catch(error) {
    return {...baseReport,status:error instanceof ProbeStop?error.outcome:'stopped',reason:error instanceof ProbeStop?error.reason:'probe_failed',requestsAttempted:attempts,cycles,verifiedLiveIntegration:false};
  }
}

export function formatProbeReport(report:unknown,apiKey:string) {
  // Whitelisted output only; also redact a credential if a provider echoes it inside text.
  const json=JSON.stringify(report,null,2);
  return apiKey?json.split(apiKey).join('[REDACTED]'):json;
}
