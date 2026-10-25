import type {StayObservation} from './stay-domain.js';

const label=(value:string)=>value.trim().replace(/\s+/g,' ').toLowerCase();
// Preserve property/rate/date query parameters. Only known tracking parameters
// can be discarded without assuming two listings are the same. Keep fragments:
// a client-rendered listing can put its property identifier in the hash route.
export function stayListingUrl(value:string|null):string|null{
  if(!value)return null;
  const url=new URL(value);
  for(const key of [...url.searchParams.keys()])if(/^utm_/i.test(key)||['gclid','fbclid','msclkid'].includes(key.toLowerCase()))url.searchParams.delete(key);
  url.searchParams.sort();return url.href;
}
export function sameStayConfiguration(previous:StayObservation,next:StayObservation):boolean{
  const listing=stayListingUrl(previous.source.url);
  if(!listing||listing!==stayListingUrl(next.source.url))return false;
  if(previous.kind!==next.kind||label(previous.propertyName)!==label(next.propertyName)||label(previous.configurationLabel)!==label(next.configurationLabel))return false;
  // Known location contradictions need deliberate reconciliation too. Unknown
  // or approximate coordinates are never a property identifier on their own.
  if(previous.location.label&&next.location.label&&label(previous.location.label)!==label(next.location.label))return false;
  if(previous.location.precision==='exact'&&next.location.precision==='exact'&&(previous.location.latitude!==next.location.latitude||previous.location.longitude!==next.location.longitude))return false;
  return true;
}
