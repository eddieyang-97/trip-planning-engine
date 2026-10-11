// Deliberately bounded to the accepted Flaine route. Extend only with reviewed airport mappings.
// IANA zone names: https://data.iana.org/time-zones/tzdb/zone1970.tab
export const airportZoneVersion='flaine-airports-v1';
const zones:Readonly<Record<string,string>>=Object.freeze({
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
