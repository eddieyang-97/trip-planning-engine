import type { CriteriaVersion, FlightSegment, ID, Instant, Json, Money,
  OfferObservation, PriceComponent, SegmentObservation, Evidence } from './domain';

/** Server-owned adapter contract. No arbitrary URL/credentials from assistant inputs. */
export interface ProviderCapabilities {
  id: string; adapterVersion: string;
  exactPartySearch: boolean; roundTrip: boolean; multiOrigin: boolean;
  scheduledTimes: boolean; checkedBagDetail: boolean; sportsEquipmentDetail: boolean;
  reprice: boolean; poll: boolean; reconcileRequest: boolean;
  booking: 'none' | 'external_link' | 'api'; // v1 exposes no purchase method
  maximumAdults: number; rightsProfileId: string;
}
export interface RightsProfile {
  id: string; reviewedAt: Instant | null;
  status: 'unreviewed' | 'pilot_permitted' | 'production_permitted' | 'denied';
  contractReference: string; allowedUses: ('private_research' | 'mcp_display' | 'web_display')[];
  persistentFields: string[]; attribution: string | null;
  rawPayloadRetentionSeconds: number; normalizedRetentionSeconds: number | null;
  // null means policy-specific, not automatically unlimited
}
export interface SearchContext {
  runId: ID; attemptId: ID; normalizedRequestHash: string;
  deadline: Instant; signal: AbortSignal;
  freshnessMode: 'allow_cache' | 'refresh'; remainingRequests: number;
}
export interface ProviderQuote {
  candidateIdentity: { key: string; version: number; confidence: 'operating_flights' | 'provider_scoped' };
  segments: Omit<FlightSegment, 'candidateId'>[];
  schedule: Omit<SegmentObservation, 'observationId'>[];
  observation: Omit<OfferObservation, 'id' | 'candidateId' | 'decisionId' | 'runId'>;
  components: Omit<PriceComponent, 'id' | 'observationId' | 'evidenceId'>[];
  evidence: Omit<Evidence, 'id' | 'observationId'>[];
}
export interface ProviderBatch {
  quotes: ProviderQuote[]; complete: boolean; nextCursor: string | null;
  requestedAirports: string[]; checkedAirports: string[];
  unsupportedConstraints: string[]; warnings: string[];
  sourceResponseAt: Instant | null; rawPayload: Json | null;
  rawRetainUntil: Instant | null;
}
export type ProviderReply =
  | { state: 'pending'; providerRequestId: string; pollAfterMs: number }
  | { state: 'complete'; providerRequestId: string | null; batch: ProviderBatch }
  | { state: 'failed'; code: 'access' | 'rate_limit' | 'unsupported' | 'unavailable'; retryAfterMs: number | null }
  | { state: 'outcome_unknown'; providerRequestId: string | null };
export interface FlightProvider {
  capabilities: ProviderCapabilities;
  estimate(criteria: CriteriaVersion): { maximumRequests: number; cost: Money | null };
  search(criteria: CriteriaVersion, context: SearchContext): Promise<ProviderReply>;
  poll?(providerRequestId: string, cursor: string | null, context: SearchContext): Promise<ProviderReply>;
  reprice?(providerOfferId: string, context: SearchContext): Promise<ProviderReply>;
  reconcile?(requestHash: string, providerRequestId: string | null, context: SearchContext): Promise<ProviderReply>;
}

/** All budget authorization, tenancy, leases and persistence live above adapters.
 * An adapter normalizes supplier meaning; it must not invent missing price/bag facts.
 * Provider-native filters are an optimization; core constraints are always rechecked.
 * Expand return/booking tokens within the reserved run budget and persist progress.
 * Raw content is stored only when its reviewed rights profile permits it.
 */
