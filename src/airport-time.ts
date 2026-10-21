import {airportZones,catalogueRevision} from './airport-zones.js';
// Preserve the original reviewed mappings; expand via a pinned, licensed catalogue.
export const airportZoneVersion=`iata-${catalogueRevision.slice(0,7)}`;
const zones:Readonly<Record<string,string>>=Object.freeze({...airportZones,
  LHR:'Europe/London',LGW:'Europe/London',LTN:'Europe/London',STN:'Europe/London',LCY:'Europe/London',SEN:'Europe/London',
  GVA:'Europe/Zurich',
});
export function airportTimeZone(code:string):string|null{return zones[code]??null;}
export function airportLocal(instant:string,code:string):{date:string;time:string;timeZone:string}|null {
  const timeZone=airportTimeZone(code);if(!timeZone)return null;
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
    .formatToParts(new Date(instant));
  const value=(name:string)=>parts.find(p=>p.type===name)!.value;
  return {date:`${value('year')}-${value('month')}-${value('day')}`,time:`${value('hour')}:${value('minute')}`,timeZone};
}
