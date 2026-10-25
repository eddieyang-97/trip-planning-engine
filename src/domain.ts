import { z } from 'zod';
import { airportLocal, airportTimeZone, airportZoneVersion } from './airport-time.js';

export const uuid = z.uuid();
const date = z.iso.date();
const amount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const airport = z.string().regex(/^[A-Z]{3}$/);
export const mutation = { idempotencyKey: z.string().min(8).max(128) };
export const tripInput = z.strictObject({
  ...mutation, name: z.string().min(1).max(120), destination: z.string().min(1).max(120),
  startDate: date, endDate: date, adults: z.number().int().min(1).max(10),
}).refine(x => x.endDate >= x.startDate, 'End date precedes start date');
export const criteriaSchema = z.strictObject({
  origins: z.array(airport).min(1).max(6).refine(x => new Set(x).size === x.length, 'Duplicate airport'),
  destination: airport, outbound: date, inbound: date.nullable().default(null),
  adults: z.number().int().min(1).max(9), currency: z.literal('GBP'),
  maxStops: z.number().int().min(0).max(2),
  snowboardRequired: z.boolean(), snowboardQuantity: z.number().int().min(1).max(9).nullable(),
  earliestOutboundLocal: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  groupBudgetMinor: amount.nullable(),
  assumptions: z.array(z.string().min(1).max(300)).max(10),
  preferences: z.strictObject({
    costWeight: z.number().min(0).max(1),
    costBestMinor: amount, costWorstMinor: amount,
    durationBestMinutes: z.number().min(0), durationWorstMinutes: z.number().positive(),
  }).refine(x => x.costBestMinor < x.costWorstMinor && x.durationBestMinutes < x.durationWorstMinutes,
    'Preference anchors must have a nonzero ascending range'),
}).refine(x => x.inbound === null || x.inbound >= x.outbound, 'Return date precedes departure')
  .refine(x => !x.origins.includes(x.destination), 'Destination must differ from every origin');
export type Criteria = z.infer<typeof criteriaSchema>;

const segment = z.strictObject({
  operatingFlight: z.string().min(1).max(30), origin: airport, destination: airport,
  departure: z.iso.datetime({ offset: true }), arrival: z.iso.datetime({ offset: true }),
  departureTimeZone:z.string().nullable().optional(),arrivalTimeZone:z.string().nullable().optional(),
}).refine(x => Date.parse(x.arrival) > Date.parse(x.departure), 'Arrival must follow departure')
  .refine(x=>(x.departureTimeZone==null||x.departureTimeZone===airportTimeZone(x.origin))
    &&(x.arrivalTimeZone==null||x.arrivalTimeZone===airportTimeZone(x.destination)), 'Airport time zone is unsupported or does not match the reviewed catalogue');
const leg = z.array(segment).min(1).max(3).refine(items => items.every((s, i) => {
  const prev = items[i - 1];
  return !prev || (prev.destination === s.origin && Date.parse(prev.arrival) < Date.parse(s.departure));
}), 'Connections must join airports and move forward in time');
export const offerSchema = z.strictObject({
  outbound: leg, inbound: z.union([leg,z.array(segment).length(0)]).default([]),
  adults: z.number().int().min(1).max(9), currency: z.string().regex(/^[A-Z]{3}$/),
  priceMinor: amount.nullable(), priceBasis: z.enum(['party', 'per_person', 'unknown']),
  exactPartyQuoted: z.boolean(),
  snowboardAllowed: z.enum(['yes', 'no', 'unknown']),
  snowboardQuantity: z.number().int().positive().nullable(),
  // Additional price for the declared quantity across BOTH directions; zero only if evidenced.
  snowboardTotalMinor: amount.nullable(),
  seller: z.string().min(1).max(120), fare: z.string().min(1).max(120),
  sourceUrl: z.url().refine(s => new URL(s).protocol === 'https:', 'HTTPS source required'),
  observedAt: z.iso.datetime({ offset: true }), expiresAt: z.iso.datetime({ offset: true }).nullable(),
  notes: z.array(z.string().max(400)).max(10),
  // Optional additive evidence. Old snapshots remain valid and are never backfilled.
  discovery: z.strictObject({
    priceScope:z.enum(['one_way','round_trip']),supplierObservedAt:z.iso.datetime({offset:true}).nullable(),
    airlines:z.array(z.string().min(1).max(120)).max(6).default([]),
    baggage:z.strictObject({outbound:z.array(z.string().max(400)).max(10),inbound:z.array(z.string().max(400)).max(10)}),
    restrictions:z.array(z.string().max(400)).max(10),
  }).optional(),
}).refine(x => !x.discovery || (x.discovery.priceScope==='round_trip')===!!x.inbound.length, 'Discovery price scope must match the journey')
  .refine(x => x.expiresAt === null || Date.parse(x.expiresAt) > Date.parse(x.observedAt), 'Invalid expiry')
  .refine(x => !x.inbound.length || Date.parse(x.inbound[0]!.departure) > Date.parse(x.outbound.at(-1)!.arrival), 'Return must follow outbound arrival');
export type Offer = z.infer<typeof offerSchema>;
// Enrich newly stored evidence only; old immutable payloads remain untouched and can still be evaluated.
export function normalizeOfferTimes(offer:Offer):Offer {
  const normalize=(leg:Offer['outbound'])=>leg.map(s=>({...s,departureTimeZone:airportTimeZone(s.origin),arrivalTimeZone:airportTimeZone(s.destination)}));
  return {...offer,outbound:normalize(offer.outbound),inbound:normalize(offer.inbound)};
}
export type Provenance = 'synthetic' | 'user_reported' | 'provider_reported';
export type Permission = 'read' | 'write' | 'search';
export interface Actor { userId: string; clientId: string; grantVersion?: string }
export class DomainError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function identity(offer: Offer): string {
  return canonical(['airport-local-v2',[offer.outbound, offer.inbound].map(leg => leg.map(s =>
    [s.operatingFlight, s.origin, s.destination, airportLocal(s.departure,s.origin)?.date
      ?? `unresolved-zone:${new Date(s.departure).toISOString()}`]))]);
}
export function evaluate(offer: Offer, criteria: Criteria, now = new Date()) {
  const checks: { constraint: string; verdict: 'pass' | 'fail' | 'unknown'; reason: string }[] = [];
  const add = (constraint: string, value: boolean | null, reason: string) => checks.push({
    constraint, verdict: value === null ? 'unknown' : value ? 'pass' : 'fail', reason,
  });
  const out = offer.outbound[0]!, back = offer.inbound[0];
  const outLocal=airportLocal(out.departure,out.origin),backLocal=back?airportLocal(back.departure,back.origin):null;
  add('route', criteria.origins.includes(out.origin) && offer.outbound.at(-1)!.destination === criteria.destination
    && (criteria.inbound!==null?!!back&&back.origin===criteria.destination&&criteria.origins.includes(offer.inbound.at(-1)!.destination):!back), 'Exact airports and journey type');
  add('airport_time_zones',[...offer.outbound,...offer.inbound].every(s=>airportTimeZone(s.origin)&&airportTimeZone(s.destination))?true:null,'Reviewed airport time zones; unsupported mappings remain unknown');
  add('dates',(outLocal&&outLocal.date!==criteria.outbound)||(!back&&criteria.inbound!==null)||(back&&criteria.inbound===null)||(backLocal&&backLocal.date!==criteria.inbound)?false:
    outLocal&&(criteria.inbound===null||backLocal)?true:null,'Departure dates derived from the instant in each airport’s IANA zone');
  add('party', offer.adults === criteria.adults && offer.exactPartyQuoted ? true : offer.adults !== criteria.adults ? false : null, 'Quote must cover the full adult party');
  add('stops', Math.max(offer.outbound.length, offer.inbound.length) - 1 <= criteria.maxStops, 'Connections per direction');
  if (criteria.earliestOutboundLocal) add('departure_cutoff', outLocal?outLocal.time>=criteria.earliestOutboundLocal:null, 'Local time derived in the departure airport’s IANA zone');
  if (criteria.snowboardRequired) add('snowboard', offer.snowboardAllowed === 'no' ? false
    : offer.snowboardAllowed === 'unknown' || criteria.snowboardQuantity === null || offer.snowboardQuantity === null ? null
      : offer.snowboardQuantity >= criteria.snowboardQuantity, 'Carriage for required equipment quantity, both directions');
  const trustedBasis=offer.exactPartyQuoted&&offer.adults===criteria.adults&&offer.currency===criteria.currency;
  const base = trustedBasis&&offer.priceMinor!==null
    ? offer.priceBasis==='party'?BigInt(offer.priceMinor):offer.priceBasis==='per_person'?BigInt(offer.priceMinor)*BigInt(criteria.adults):null:null;
  const board = criteria.snowboardRequired ? (trustedBasis&&criteria.snowboardQuantity!==null&&offer.snowboardQuantity===criteria.snowboardQuantity
    &&offer.snowboardAllowed==='yes'&&offer.snowboardTotalMinor!==null?BigInt(offer.snowboardTotalMinor):null):0n;
  const known=[base,...(criteria.snowboardRequired?[board]:[])].filter((n):n is bigint=>n!==null);
  const subtotal=known.length?known.reduce((a,b)=>a+b,0n):null;
  const sum=base!==null&&board!==null?base+board:null;
  const safe=(n:bigint|null)=>n!==null&&n<=BigInt(Number.MAX_SAFE_INTEGER)?Number(n):null;
  const total=safe(sum),knownSubtotalMinor=safe(subtotal);
  add('complete_cost', total === null ? null : true, 'GBP party fare plus required snowboard price for the requested journey; ground transfers excluded');
  if (criteria.groupBudgetMinor !== null) add('budget', subtotal!==null&&subtotal>BigInt(criteria.groupBudgetMinor)?false:
    total===null?null:total<=criteria.groupBudgetMinor, 'Known exact-party costs above the cap fail even when mandatory costs are missing');
  add('freshness', offer.expiresAt === null ? null : Date.parse(offer.expiresAt) > now.getTime(), 'Supplier expiry required for a current quote');
  add('observation_time', Date.parse(offer.observedAt) <= now.getTime(), 'Future observations are invalid');
  const travelMinutes = [offer.outbound, offer.inbound].filter(leg=>leg.length).reduce((n, leg) => n
    + (Date.parse(leg.at(-1)!.arrival) - Date.parse(leg[0]!.departure)) / 60000, 0);
  const p = criteria.preferences;
  const utility = (n: number, best: number, worst: number) => Math.max(0, Math.min(1, (worst - n) / (worst - best)));
  const durationContribution = (1 - p.costWeight) * utility(travelMinutes, p.durationBestMinutes, p.durationWorstMinutes);
  const lower = durationContribution + (total === null ? 0 : p.costWeight * utility(total, p.costBestMinor, p.costWorstMinor));
  const eligibility: 'eligible' | 'conditional' | 'ineligible' = checks.some(x => x.verdict === 'fail') ? 'ineligible'
    : checks.some(x => x.verdict === 'unknown') ? 'conditional' : 'eligible';
  return { algorithmVersion: 'fixed-anchors-v3', airportZoneVersion,eligibility, checks,
    knownSubtotalMinor,knownSubtotalOverflow:subtotal!==null&&knownSubtotalMinor===null,
    totalMinor: total, currency: criteria.currency, travelMinutes,
    // An observed numeric price is useful for discussion, but cannot become a quoted total.
    observedPrice:{amountMinor:offer.priceMinor,currency:offer.currency,basis:offer.priceBasis,exactPartyQuoted:offer.exactPartyQuoted},
    schedule:{outbound:offer.outbound,inbound:offer.inbound,connections:offer.outbound.length-1+Math.max(0,offer.inbound.length-1)},
    restrictions:{snowboard:offer.snowboardAllowed,supplierExpiry:offer.expiresAt,discovery:offer.discovery??null},
    score: { lower: 100 * lower, upper: 100 * (lower + (total === null ? p.costWeight : 0)),
      knownWeight: total === null ? 1 - p.costWeight : 1 } };
}
