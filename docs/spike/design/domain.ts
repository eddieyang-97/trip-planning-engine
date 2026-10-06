/** Design interfaces, not application scaffolding. Validate all inputs at runtime. */
export type ID = string;
export type ISODate = string; // YYYY-MM-DD; calendar-valid
export type Instant = string; // RFC3339 with offset
export type Currency = string; // validated ISO4217
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export interface Money { minorUnits: number; currency: Currency } // safe integer >= 0
export interface Party { adults: number; children: number; infants: number }
export interface Trip {
  id: ID; ownerId: ID; name: string; destination: string;
  startDate: ISODate; endDate: ISODate; party: Party; revision: number;
}
export interface Decision {
  id: ID; tripId: ID; kind: 'flight'; title: string;
  revision: number; currentCriteriaVersion: number;
}
export type Constraint =
  | { id: string; kind: 'origins'; airports: string[] }
  | { id: string; kind: 'destination'; airport: string }
  | { id: string; kind: 'dates'; outbound: ISODate; inbound: ISODate }
  | { id: string; kind: 'party'; value: Party }
  | { id: string; kind: 'max_stops'; value: number }
  | { id: string; kind: 'group_budget'; value: Money }
  | { id: string; kind: 'time_window'; leg: 'outbound' | 'inbound';
      event: 'departure' | 'arrival'; earliest: Instant | null; latest: Instant | null }
  | { id: string; kind: 'equipment'; equipment: 'snowboard'; quantity: number;
      weightKgPerItem: number | null; dimensionsCm: [number, number, number] | null;
      legs: ('outbound' | 'inbound')[] }
  | { id: string; kind: 'onward_transfer'; leg: 'outbound' | 'inbound';
      destination: string; minimumBufferMinutes: number | null };
export type Metric = 'group_cost' | 'travel_minutes' | 'usable_destination_minutes';
export interface Preference {
  metric: Metric; weight: number; direction: 'minimize' | 'maximize';
  bestAnchor: number; worstAnchor: number; unit: 'minor_GBP' | 'minutes';
}
export interface Assumption { key: string; value: Json; confirmed: boolean; reason: string }
export interface CriteriaVersion {
  decisionId: ID; version: number; schemaVersion: 1; createdAt: Instant;
  constraints: Constraint[]; preferences: Preference[]; assumptions: Assumption[];
  queryCurrency: Currency; market: string; cabin: 'economy';
}
export interface Candidate {
  id: ID; decisionId: ID; identityKey: string; identityVersion: number;
  identityConfidence: 'operating_flights' | 'provider_scoped';
  disposition: 'neutral' | 'saved' | 'rejected'; dispositionReason: string | null;
  revision: number;
}
export interface FlightSegment {
  candidateId: ID; direction: 'outbound' | 'inbound'; ordinal: number;
  origin: string; destination: string; departureLocalDate: ISODate;
  operatingCarrier: string | null; operatingFlightNumber: string | null;
  providerIdentity: string | null;
}
export interface SegmentObservation {
  observationId: ID; direction: 'outbound' | 'inbound'; ordinal: number;
  scheduledDeparture: Instant; scheduledArrival: Instant;
  departureTimezone: string; arrivalTimezone: string; // IANA identifiers
  marketingCarrier: string | null; marketingFlightNumber: string | null;
}
export type RunStatus = 'queued' | 'running' | 'complete' | 'partial' | 'failed' | 'cancelled';
export interface SearchRun {
  id: ID; decisionId: ID; criteriaVersion: number; status: RunStatus;
  createdAt: Instant; finishedAt: Instant | null;
  freshnessMode: 'allow_cache' | 'refresh'; queryVersion: string;
  idempotencyKey: string; requestHash: string;
  maxRequests: number; reservedRequests: number;
  coverage: { requestedAirports: string[]; checkedAirports: string[];
    unavailableAirports: string[]; unknownCoverageAirports: string[];
    unsupportedConstraints: string[]; truncated: boolean };
}
export interface ProviderAttempt {
  id: ID; runId: ID; provider: string; adapterVersion: string; requestHash: string;
  providerRequestId: string | null; ordinal: number;
  status: 'reserved' | 'sent' | 'complete' | 'failed' | 'outcome_unknown';
  requestedAt: Instant | null; completedAt: Instant | null;
}
export interface OfferObservation {
  id: ID; candidateId: ID; decisionId: ID; runId: ID | null;
  provider: string; providerOfferId: string | null; seller: string | null;
  fareIdentity: string | null; party: Party; cabin: 'economy';
  retrievedAt: Instant; sourceObservedAt: Instant | null; expiresAt: Instant | null;
  freshness: 'live_response' | 'provider_cache' | 'manual' | 'unknown';
  price: Money | null; priceBasis: 'party' | 'per_person' | 'unknown';
  comparableGroupTotal: Money | null;
  completeness: 'complete' | 'partial' | 'unknown';
  bookingUrl: string | null; availability: 'quoted' | 'unavailable' | 'unknown';
  retainUntil: Instant | null; rightsProfileId: string;
}
export interface PriceComponent {
  id: ID; observationId: ID;
  kind: 'fare_and_tax' | 'snowboard' | 'checked_bag' | 'seat' | 'transfer' | 'other';
  coverageKey: string; // stable description of party/leg/items covered, prevents overlap
  amount: Money | null; basis: 'party' | 'per_person' | 'per_item' | 'unknown';
  quantity: number | null; direction: 'outbound' | 'inbound' | 'both';
  treatment: 'included' | 'additional' | 'unknown';
  provenance: 'provider' | 'user_reported' | 'estimate'; evidenceId: ID | null;
}
export interface Evidence {
  id: ID; observationId: ID; field: string; value: Json;
  sourceUrl: string | null; sourceType: 'provider' | 'user_reported' | 'policy_page';
  observedAt: Instant | null; retrievedAt: Instant;
  expiresAt: Instant | null; retainUntil: Instant | null;
  attribution: string | null; status: 'available' | 'expired' | 'redacted';
}
export interface ConstraintResult {
  constraintId: string; verdict: 'pass' | 'fail' | 'unknown';
  reason: string; evidenceIds: ID[];
}
export interface Evaluation {
  observationId: ID; decisionId: ID; criteriaVersion: number; algorithmVersion: string;
  evaluatedAt: Instant; eligibility: 'eligible' | 'conditional' | 'ineligible';
  checks: ConstraintResult[];
  metrics: { metric: Metric; value: number | null; utility: number | null;
    weight: number; evidenceIds: ID[] }[];
  score: { lower: number; upper: number; knownWeight: number } | null;
}
export interface Selection {
  id: ID; decisionId: ID; observationId: ID; criteriaVersion: number;
  rationale: string; unresolvedConditions: string[]; selectedAt: Instant;
  supersededAt: Instant | null;
}
export interface BookingRecord {
  id: ID; selectionId: ID; reportedBy: ID; recordedAt: Instant; bookedAt: Instant;
  amount: Money | null; status: 'user_reported_booked' | 'user_reported_cancelled';
  referenceSummary: string | null; // no passport, payment card, or full confirmation needed
}
export type ErrorCode = 'UNAUTHENTICATED' | 'FORBIDDEN_OR_NOT_FOUND' | 'VALIDATION_ERROR'
  | 'REVISION_CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'BUDGET_EXCEEDED'
  | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_ACCESS_REQUIRED' | 'OUTCOME_UNKNOWN' | 'EVIDENCE_EXPIRED';
export type Result<T> = { schemaVersion: 1; ok: true; data: T; asOf: Instant }
  | { schemaVersion: 1; ok: false; error: { code: ErrorCode; message: string;
      retryable: boolean; nextAction: string | null }; asOf: Instant };
export interface Mutation { idempotencyKey: string }
export interface RevisionMutation extends Mutation { expectedRevision: number }
export interface StartSearchInput extends RevisionMutation {
  decisionId: ID; criteriaVersion: number; freshness: 'allow_cache' | 'refresh';
}
export type StartSearchOutput = Result<{ runId: ID; status: RunStatus }>;
