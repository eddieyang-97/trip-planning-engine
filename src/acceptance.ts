import { criteriaSchema } from './domain.js';

/** Confirmed: 2026, four travelers, snowboard, all London airports. Other choices are explicit assumptions. */
export const flaineCriteria = criteriaSchema.parse({
  origins: ['LHR', 'LGW', 'LTN', 'STN', 'LCY', 'SEN'], destination: 'GVA',
  outbound: '2026-12-18', inbound: '2026-12-20', adults: 4, currency: 'GBP',
  maxStops: 2, snowboardRequired: true, snowboardQuantity: 1,
  earliestOutboundLocal: null, groupBudgetMinor: null,
  assumptions: ['Four adults; traveler ages unconfirmed', 'One snowboard for the party; quantity, weight and dimensions unconfirmed',
    'Geneva is a provisional gateway; transfers to Flaine remain unresolved',
    'Up to two connections per direction is a prototype limit, not a confirmed preference',
    'Cost weight and utility anchors are demonstration preferences; confirm before relying on rank'],
  preferences: { costWeight: 0.7, costBestMinor: 40000, costWorstMinor: 120000, durationBestMinutes: 180, durationWorstMinutes: 720 },
});
export const flaineTrip = {
  name: 'Flaine snowboard weekend', destination: 'Flaine, France',
  startDate: '2026-12-18', endDate: '2026-12-20', adults: 4,
};
