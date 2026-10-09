// Integration contracts for the hotel/dining spike. Not registered as live MCP tools.
import type { PlaceObservation } from './places.js';

export interface Money { currency:string; amountMinor:number }
export interface Occupancy { adults:number; childAges:number[] }
export interface SourceEvidence {
  provider:string; environment:'sandbox'|'production'|'connector'; sourceId:string; sourceUrl:string|null;
  fetchedAt:string; observedAt:string|null; expiresAt:string|null;
  evidenceKind:'directory'|'indicative'|'quoted'|'user_reported';
  attribution:{text:string;url:string}[];
  retention:{status:'unreviewed'|'approved';retainUntil:string|null;permittedFields:string[]};
}
export interface HotelSearch {
  destination:string;checkin:string;checkout:string;currency:string;
  // Two rooms for two adults are a different query from one apartment for four.
  roomOccupancies:Occupancy[];
  guestNationality:string|null; // Required by some providers. Never infer from origin airport or currency.
  constraints:{maximumFullStay:Money|null;freeCancellationUntil:string|null;requiredAmenities:string[]};
  preferences:{priority:('price'|'cancellation'|'location'|'room_quality')[]};
  assumptions:string[];
}
export interface HotelRateObservation {
  propertyId:string;propertyName:string;seller:string|null;offerId:string|null;ratePlanId:string|null;
  checkin:string;checkout:string;requestedOccupancies:Occupancy[];quotedOccupancies:Occupancy[]|null;
  rooms:{providerRoomId:string|null;name:string|null;bedsText:string|null;mealPlan:string|null;occupancy:Occupancy|null}[];
  price:{reported:Money|null;basis:'full_stay_all_rooms'|'per_night'|'per_room'|'unknown';
    mandatoryCharges:'included'|'excluded'|'partially_included'|'unknown';excludedCharges:Money|null;
    fullStayTotal:Money|null;paymentTiming:'now'|'at_property'|'split'|'unknown'};
  cancellation:{status:'refundable'|'nonrefundable'|'conditional'|'unknown';
    freeUntil:string|null;timeZone:string|null;penalties:{from:string;amount:Money|null;terms:string}[]};
  checkinWindow:{fromLocal:string|null;untilLocal:string|null;timeZone:string|null;lateArrivalConfirmed:boolean|null};
  availability:'reported_available'|'unavailable'|'unknown';
  evidence:SourceEvidence;
}
export interface SearchCoverage {
  complete:boolean;truncated:boolean;warnings:string[];requestedScope:string;returnedCount:number;
}
export interface HotelRateProvider {
  id:string;
  capabilities:{roomAllocation:boolean;fullStayBreakdown:boolean;cancellationTerms:boolean;externalBookingHandoff:boolean};
  search(input:HotelSearch):Promise<{observations:HotelRateObservation[];coverage:SearchCoverage}>;
}
export interface DiningSearch {
  destination:string;partySize:number;localDate:string;earliestLocalTime:string;latestLocalTime:string;timeZone:string;
  constraints:{dietaryRequirements:string[];maximumPerPerson:Money|null};
  preferences:{cuisines:string[];priority:('distance'|'price'|'cuisine')[]};assumptions:string[];
}
export interface RestaurantCandidate {
  id:string;discovery:PlaceObservation;
  bookingPage:{url:string;provider:string;checkedAt:string}|null;
  // A menu estimate is not a deposit or a confirmed booking price.
  menuEstimate:{perPerson:Money;sourceUrl:string;observedAt:string}|null;
  dietarySuitability:'confirmed_by_venue'|'reported'|'unknown';
}
export interface RestaurantAvailability {
  restaurantId:string;partySize:number;localDate:string;timeZone:string;
  status:'available'|'no_slots_returned'|'not_checked'|'unsupported'|'failed';
  slots:{startAt:string;durationMinutes:number|null;experience:string|null;deposit:Money|null;
    cancellationTerms:string|null;bookingUrl:string|null}[];
  evidence:SourceEvidence;
}
export interface RestaurantAvailabilityProvider {
  id:string;
  // Requires a separately approved inventory integration; discovery does not implement this.
  search(input:DiningSearch,restaurantId:string):Promise<RestaurantAvailability>;
}
