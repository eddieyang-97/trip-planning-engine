import type {DiningCriteria,DiningObservation} from '../../src/dining-domain.js';
export const diningCriteria=(adults=10):DiningCriteria=>({date:'2027-02-12',meal:'dinner',adults,currency:'EUR',localTime:'19:30',timeZone:'Europe/Rome',maximumTotalMinor:100000,dietaryRequirements:['Vegetarian']});
export function diningObservation(adults=10,variant:'bistro'|'tavern'='bistro'):DiningObservation{
  const observedAt='2026-10-24T12:00:00Z',bistro=variant==='bistro';
  return {restaurantName:bistro?'Fictional Valley Bistro':'Fictional Mountain Tavern',date:'2027-02-12',meal:'dinner',quotedAdults:adults,currency:'EUR',
    menu:{summary:'Fictional three-course group menu, vegetarian option reported',url:'https://dining.example/'+variant+'/menu',observedAt},
    price:{amountMinor:bistro?5000:4500,basis:'per_person',description:'Expected three-course menu per adult, drinks excluded'},
    charges:[{label:'Service',amountMinor:500,basis:'per_person',includedInBase:false}],mandatoryChargesComplete:bistro,excludedCharges:bistro?[]:['Cover charge unconfirmed'],
    groupSuitability:{status:'reported_suitable',details:'Fictional written group menu supports ten adults seated together'},
    dietary:[{requirement:'Vegetarian',status:'reported_supported',details:'Vegetarian alternative in the fictional menu; confirm directly'}],
    location:{label:'Fictional village centre',precision:'approximate',latitude:null,longitude:null},
    reservation:{url:'https://dining.example/'+variant+(bistro?'/reservations':''),kind:bistro?'reservation_page':'homepage',sourceLabel:'Fictional reported venue page',observedAt},
    availability:'unknown',availabilityDetails:'No live inventory checked',source:{url:'https://dining.example/'+variant,label:'Fictional manually sourced restaurant page',observedAt,kind:'sourced'},unknowns:[]};
}
