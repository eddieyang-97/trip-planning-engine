import type {StayCriteria,StayObservation} from '../../src/stay-domain.js';
export function stayCriteria(adults=10):StayCriteria{return {checkIn:'2027-02-11',checkOut:'2027-02-14',adults,currency:'CHF',maximumTotalMinor:null,minimumSleepingPlaces:null};}
export function stayObservation(adults=10,kind:StayObservation['kind']='hotel_rooms'):StayObservation{return {
  propertyName:kind==='hotel_rooms'?'Fictional Matterhorn Hotel':'Fictional Alpine Chalet',configurationLabel:kind==='hotel_rooms'?`${adults/2} twin rooms`:'One whole home',kind,
  units:kind==='hotel_rooms'?[{name:'Twin room',count:adults/2,beds:[{type:'single',count:2,sleepingPlaces:1}]}]:[{name:'Entire chalet',count:1,beds:[{type:'single',count:adults,sleepingPlaces:1}]}],
  quotedAdults:adults,checkIn:'2027-02-11',checkOut:'2027-02-14',currency:'CHF',baseTotalMinor:kind==='hotel_rooms'?adults*30000:adults*27500,
  charges:kind==='hotel_rooms'?[{label:'Tourist tax included',kind:'tax',amountMinor:6000,includedInBase:true}]:[{label:'Cleaning',kind:'cleaning',amountMinor:20000,includedInBase:false},{label:'Tourist tax',kind:'tax',amountMinor:6000,includedInBase:false}],
  mandatoryChargesComplete:true,excludedCharges:[],refundableDeposit:{amountMinor:100000,terms:'Refundable after a satisfactory checkout inspection; held separately from stay cost.'},
  location:{label:'Fictional Zermatt village',precision:'approximate',latitude:46.02,longitude:7.75},checkInDetails:'Check in 16:00–20:00; notify property before late arrival.',
  cancellation:{terms:'Fully refundable until the stated deadline; afterwards full stay cost is payable.',freeUntil:'2027-02-01T18:00:00+01:00'},availability:'reported_available',
  source:{url:kind==='hotel_rooms'?'https://hotel.example/stay':'https://chalet.example/stay',label:'Fictional manually reviewed source',observedAt:'2026-10-01T12:00:00+01:00',kind:'sourced'},unknowns:[],
};}
