import type {ProbeEvent} from './serpapi-probe.js';

export type FlightValidationReason='request_echo_missing_or_mismatched'|'selected_departure_mismatch'|'selection_binding_missing';
export type LiveProviderEvent=ProbeEvent&{resultValidation?:FlightValidationReason};

// Public SerpApi examples omit defaults and encode numeric parameters as numbers.
// Required non-default party/currency evidence is never inferred from the request.
export function validateFlightEcho(expected:Record<string,string>,actual:Record<string,unknown>,selectedMatches:boolean) {
  const omitted:string[]=[];
  const reject=()=>({reason:'request_echo_missing_or_mismatched' as FlightValidationReason,omitted});
  const airportSet=(value:unknown)=>typeof value==='string'?value.split(',').map(s=>s.trim().toUpperCase()).sort().join(','):null;
  for(const name of ['engine','departure_id','arrival_id','outbound_date','currency',...(expected.return_date?['return_date']:[])]){
    const value=actual[name];if(typeof value!=='string')return reject();
    if(name==='departure_id'||name==='arrival_id'){if(airportSet(value)!==airportSet(expected[name]))return reject();}
    else if((name==='currency'?value.trim().toUpperCase():value)!==expected[name])return reject();
  }
  if(!expected.return_date&&actual.return_date!=null)return reject();
  for(const [name,fallback] of [['type','1'],['adults','1'],['travel_class','1'],['children','0'],['infants_in_seat','0'],['infants_on_lap','0']] as const){
    const value=actual[name],wanted=expected[name]??fallback;
    if(value===undefined){if(wanted!==fallback)return reject();omitted.push(name);}
    else if(!['string','number'].includes(typeof value)||!/^\d+$/.test(String(value))||Number(value)!==Number(wanted))return reject();
  }
  // Missing stops can be checked against every normalized itinerary. An explicit
  // contradictory filter still rejects the response instead of relaxing scope.
  if(actual.stops===undefined)omitted.push('stops');
  else if(!['string','number'].includes(typeof actual.stops)||!/^\d+$/.test(String(actual.stops))||Number(actual.stops)!==Number(expected.stops))return reject();
  if(expected.departure_token){
    if(actual.departure_token===undefined){
      omitted.push('departure_token');
      if(!selectedMatches)return {reason:'selection_binding_missing' as FlightValidationReason,omitted};
    }else if(actual.departure_token!==expected.departure_token)return reject();
  }else if(actual.departure_token!==undefined)return reject();
  return {reason:null,omitted};
}
