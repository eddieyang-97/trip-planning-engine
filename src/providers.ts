import { offerSchema, type Criteria, type Offer } from './domain.js';

export interface FlightProvider {
  id: 'fixture';
  search(criteria: Criteria): Promise<{ offers: Offer[]; coverage: Record<string, unknown> }>;
}
/** Synthetic examples only. No historical Trip.com prices are presented as live. */
export class FixtureProvider implements FlightProvider {
  id = 'fixture' as const;
  async search(criteria: Criteria) {
    if (criteria.outbound !== '2026-12-18' || criteria.inbound !== '2026-12-20'
      || criteria.destination !== 'GVA' || !criteria.origins.includes('LGW')) {
      return { offers: [], coverage: { synthetic: true, complete: false, reason: 'Only the Flaine example is supplied' } };
    }
    const now = new Date();
    const offers = [
      { flight: 'TEST101', hour: '14:00', price: 48000, board: null, allowed: 'unknown' },
      { flight: 'TEST102', hour: '18:30', price: 62000, board: 9000, allowed: 'yes' },
      { flight: 'TEST103', hour: '19:00', price: 15000, board: null, allowed: 'unknown' },
    ].map((x, i) => offerSchema.parse({
      outbound: [{ operatingFlight: x.flight, origin: 'LGW', destination: 'GVA',
        departure: `2026-12-18T${x.hour}:00+00:00`,
        arrival: `2026-12-18T${i === 0 ? '16:40' : i === 1 ? '21:10' : '21:40'}:00+01:00` }],
      inbound: [{ operatingFlight: 'TEST201', origin: 'GVA', destination: 'LGW',
        departure: '2026-12-20T20:45:00+01:00', arrival: '2026-12-20T21:25:00+00:00' }],
      adults: criteria.adults, currency: 'GBP', priceMinor: x.price,
      priceBasis: i === 2 ? 'unknown' : 'party', exactPartyQuoted: i !== 2,
      snowboardAllowed: x.allowed, snowboardQuantity: i === 1 ? 1 : null,
      snowboardTotalMinor: x.board, seller: 'Synthetic test supplier', fare: 'Example economy',
      sourceUrl: 'https://example.com/synthetic-flight', observedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 3600000).toISOString(),
      notes: ['SYNTHETIC: not a real fare, availability claim or booking link.'],
    }));
    return { offers, coverage: { synthetic: true, complete: false, requestedAirports: criteria.origins,
      checkedAirports: ['LGW'], unknownCoverageAirports: criteria.origins.filter(a => a !== 'LGW') } };
  }
}
