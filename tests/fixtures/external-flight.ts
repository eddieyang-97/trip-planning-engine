import {flaineCriteria, flaineTrip} from '../../src/acceptance.js';
import type {ExternalFlightOffer} from '../../src/domain.js';

export const externalFlightTrip={...flaineTrip,name:'Fictional flight research'};
export const externalFlightCriteria={...flaineCriteria,earliestOutboundLocal:null};
export function externalFlightOffer():ExternalFlightOffer {
  return {
    outbound:[{operatingFlight:'TEST102',airline:'Fictional Air',origin:'LGW',destination:'GVA',
      departure:'2026-12-18T18:30:00Z',arrival:'2026-12-18T21:10:00+01:00'}],
    inbound:[{operatingFlight:'TEST201',airline:'Fictional Air',origin:'GVA',destination:'LGW',
      departure:'2026-12-20T20:45:00+01:00',arrival:'2026-12-20T21:25:00Z'}],
    adults:4,currency:'JPY',priceMinor:42000,priceBasis:'party',exactPartyQuoted:true,
    snowboardAllowed:'unknown',snowboardQuantity:null,snowboardTotalMinor:null,
    seller:'Fictional Ticket Shop',fare:'Example Saver',sourceUrl:'https://seller.example/flights/lgw-gva',
    observedAt:'2026-10-01T09:00:00Z',expiresAt:null,notes:[],
    external:{source:'Fictional Connector',linkType:'seller_handoff',cabin:'economy',priceScope:'outbound',availability:'reported_available',
      baggage:{outbound:['One cabin bag reported'],inbound:[]},restrictions:['Non-refundable fare reported'],
      unresolvedFees:['Checked bag fee unknown'],coverageLimitations:['Only one seller checked']},
  };
}
