import type {ItineraryItem} from '../src/itinerary.js';
export const categories={
  accommodation:{label:'Accommodation',icon:'⌂',colour:'#6366F1'},
  dining:{label:'Restaurants & bars',icon:'🍴',colour:'#F59E0B'},
  activity:{label:'Activities',icon:'◇',colour:'#16A34A'},
  transport:{label:'Transport',icon:'⇄',colour:'#0284C7'},
  note:{label:'Notes',icon:'≡',colour:'#64748B'},
} as const;
export const itemCategory:Record<ItineraryItem['type'],keyof typeof categories>={flight:'transport',transfer:'transport',accommodation:'accommodation',restaurant:'dining',activity:'activity',note:'note'};
export const itemNames={flight:'Flight',accommodation:'Stay',transfer:'Transfer',activity:'Activity',restaurant:'Food & drink',note:'Note'};
export const itemIcons={flight:'↗',accommodation:'⌂',transfer:'⇄',activity:'◇',restaurant:'🍴',note:'≡'};
