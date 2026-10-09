// Integration contracts for the accommodation/dining spike. Not registered as live MCP tools.
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
// Airbnb/Booking.com/Vrbo are distribution channels, not property types.
export type AccommodationType = 'hotel'|'aparthotel'|'apartment'|'chalet'|'house'|'villa'|'hostel'|'guest_house'|'other'|'unknown';
export type StayArrangement =
  | {kind:'rooms';roomOccupancies:Occupancy[]}
  | {kind:'entire_place'}
  | {kind:'flexible'};
export interface AccommodationSearch {
  destination:string;checkin:string;checkout:string;currency:string;
  party:Occupancy;
  // Run alternatives separately for the same party; do not require two rooms in a single apartment.
  // Runtime validation must require each rooms allocation to sum to the party.
  arrangements:StayArrangement[];
  guestNationality:string|null; // Required by some providers. Never infer from origin airport or currency.
  constraints:{maximumFullStay:Money|null;freeCancellationUntil:string|null;requiredAmenities:string[];
    allowedTypes:AccommodationType[];minimumBedrooms:number|null;minimumSeparateBeds:number|null;
    minimumBathrooms:number|null;requiredArrivalAt:string|null};
  preferences:{priority:('price'|'cancellation'|'location'|'sleeping_layout'|'kitchen'|'ski_access')[]};
  assumptions:string[];
}
export interface AccommodationRateObservation {
  propertyId:string;propertyName:string;seller:string|null;offerId:string|null;ratePlanId:string|null;
  propertyType:AccommodationType;bookingUrl:string|null;
  checkin:string;checkout:string;requestedParty:Occupancy;quotedParty:Occupancy|null;
  requestedArrangement:StayArrangement;quotedArrangement:StayArrangement|null;
  // Units are bookable rooms or an entire rental. Bedrooms/beds describe the supplied layout.
  units:{providerUnitId:string|null;kind:'room'|'entire_place'|'unknown';name:string|null;
    bedrooms:number|null;bathrooms:number|null;
    beds:{type:'single'|'double'|'bunk'|'sofa_bed'|'other';count:number}[]|null;
    bedsText:string|null;mealPlan:string|null;occupancy:Occupancy|null}[];
  location:{latitude:number;longitude:number;precision:'exact'|'approximate'|'unknown'}|null;
  minimumStayNights:number|null;
  amenities:{kitchen:boolean|null;snowboardStorage:boolean|null;skiInSkiOut:boolean|null};
  price:{reported:Money|null;basis:'full_stay_all_units'|'per_night'|'per_unit'|'unknown';
    mandatoryCharges:'included'|'excluded'|'partially_included'|'unknown';excludedCharges:Money|null;
    // Breakdown items can already be included: never add them all to the reported total.
    charges:{kind:'cleaning'|'service'|'tax'|'linen'|'other';amount:Money|null;
      includedInReported:boolean|null;mandatory:boolean|null}[];
    fullStayTotal:Money|null;paymentTiming:'now'|'at_property'|'split'|'unknown'};
  // Refundable security deposits are cash exposure, not automatically part of stay cost.
  securityDeposit:{required:boolean|null;amount:Money|null;refundable:boolean|null;terms:string|null};
  cancellation:{status:'refundable'|'nonrefundable'|'conditional'|'unknown';
    freeUntil:string|null;timeZone:string|null;penalties:{from:string;amount:Money|null;terms:string}[]};
  checkinWindow:{fromLocal:string|null;untilLocal:string|null;timeZone:string|null;lateArrivalConfirmed:boolean|null};
  availability:'reported_available'|'unavailable'|'unknown';
  evidence:SourceEvidence;
}
export interface SearchCoverage {
  complete:boolean;truncated:boolean;warnings:string[];requestedScope:string;returnedCount:number;
}
export interface AccommodationRateProvider {
  id:string;
  capabilities:{roomAllocation:boolean;entirePlaceSearch:boolean;fullStayBreakdown:boolean;
    cancellationTerms:boolean;externalBookingHandoff:boolean};
  search(input:AccommodationSearch):Promise<{observations:AccommodationRateObservation[];coverage:SearchCoverage}>;
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
