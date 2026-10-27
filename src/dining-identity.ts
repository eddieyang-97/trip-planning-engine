import type {DiningObservation} from './dining-domain.js';
// The existing URL normalizer preserves identity-bearing query/hash routes.
import {stayListingUrl} from './stay-identity.js';
export const diningSourceUrl=stayListingUrl;
const label=(value:string)=>value.trim().replace(/\s+/g,' ').toLowerCase();
export function sameRestaurant(previous:DiningObservation,next:DiningObservation){
  const source=diningSourceUrl(previous.source.url);
  if(!source||source!==diningSourceUrl(next.source.url)||label(previous.restaurantName)!==label(next.restaurantName))return false;
  if(previous.location.label&&next.location.label&&label(previous.location.label)!==label(next.location.label))return false;
  return !(previous.location.precision==='exact'&&next.location.precision==='exact'&&(previous.location.latitude!==next.location.latitude||previous.location.longitude!==next.location.longitude));
}
