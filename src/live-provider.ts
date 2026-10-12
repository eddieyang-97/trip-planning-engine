import {airportLocal} from './airport-time.js';
import {DomainError,offerSchema,type Criteria,type Offer} from './domain.js';
import {runSerpApiProbe,type ProbeEvent} from './serpapi-probe.js';

export function validateLiveCriteria(c:Criteria) {
  if(c.outbound!=='2026-12-18'||c.inbound!=='2026-12-20'||c.adults!==4||c.destination!=='GVA'||!c.origins.includes('LGW'))
    throw new DomainError('UNSUPPORTED_SEARCH','The live pilot supports 18–20 Dec 2026, four adults, and LGW–GVA only. Other allowed London airports are not searched.');
}
// Invert a source wall time only when exactly one instant matches the reviewed zone.
// DST gaps/overlaps and unsupported airports must not create invented instants.
export function airportInstant(local:string,airport:string):string|null {
  if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(local))return null;
  const nominal=Date.parse(local.replace(' ','T')+':00Z');if(!Number.isFinite(nominal))return null;
  const matches:string[]=[];
  for(let offset=-14*60;offset<=14*60;offset+=15) {
    const instant=new Date(nominal-offset*60000).toISOString(),value=airportLocal(instant,airport);
    if(value&&`${value.date} ${value.time}`===local)matches.push(instant);
  }
  return matches.length===1?matches[0]!:null;
}
export class SerpApiFlightProvider {
  constructor(private readonly apiKey:string,private readonly send:typeof fetch=fetch){}
  async search(c:Criteria,record:(event:ProbeEvent)=>Promise<void>) {
    validateLiveCriteria(c);
    const report=await runSerpApiProbe({apiKey:this.apiKey,send:this.send,cycles:1,record});
    const offers:Offer[]=[];
    for(const cycle of report.cycles) {
      const legs=cycle.selectedFlights.map((leg:any[])=>leg.map(s=>({operatingFlight:s.flightNumber,origin:s.origin,destination:s.destination,
        departure:airportInstant(s.departureLocal??'',s.origin),arrival:airportInstant(s.arrivalLocal??'',s.destination)})));
      for(const option of cycle.options) {
        const parsed=offerSchema.safeParse({outbound:legs[0],inbound:legs[1],adults:c.adults,currency:'GBP',
          priceMinor:option.reportedPriceMinor,priceBasis:'unknown',exactPartyQuoted:false,
          snowboardAllowed:'unknown',snowboardQuantity:null,snowboardTotalMinor:null,
          seller:option.seller,fare:option.fare??'Unspecified fare',sourceUrl:cycle.researchUrl??'https://www.google.com/travel/flights',
          observedAt:cycle.fetchedAt,expiresAt:null,notes:[
            'Live SerpApi / Google Flights observation; supplier quote and price basis unverified.',
            'Four adults requested. No snowboard carriage or equipment price confirmed.',
            'Provider-reported flight numbers; operating carrier and fare conditions unverified.',
            'Research page only; seller handoffs, bookings and passenger data submission are not performed.',
          ]});
        if(parsed.success&&!JSON.stringify(parsed.data).includes(this.apiKey)
          &&!JSON.stringify(parsed.data).includes(encodeURIComponent(this.apiKey)))offers.push(parsed.data);
      }
    }
    return {offers,report};
  }
}
export type LiveFlightProvider=Pick<SerpApiFlightProvider,'search'>;
