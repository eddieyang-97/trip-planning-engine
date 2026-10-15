import {timezoneCountries} from './timezone-data.js';

export type TimezoneChoice={id:string;label:string;search:string};
const aliases:Record<string,string>={
  'Europe/Rome':'Turin Torino Alba Barbaresco Milan Milano Venice Florence',
  'Europe/Zurich':'Geneva Bern Basel', 'Europe/Paris':'Flaine Chamonix Lyon Nice',
  'Europe/London':'UK Britain Edinburgh Manchester Gatwick Heathrow Luton Stansted',
  'Asia/Shanghai':'Beijing Shenzhen Guangzhou', 'Asia/Tokyo':'Osaka Kyoto',
  'America/New_York':'Washington Boston Miami', 'America/Los_Angeles':'San Francisco Seattle Las Vegas',
};
const normalize=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replaceAll('_',' ');
const city=(id:string)=>id.split('/').at(-1)!.replaceAll('_',' ');
export function timezoneChoices():TimezoneChoice[]{
  const countries=new Intl.DisplayNames(['en'],{type:'region'}),choices=new Map<string,TimezoneChoice>();
  for(const [id,country] of timezoneCountries){
    // Retain country-specific aliases (e.g. Rome), rather than relabelling them
    // as another city's canonical zone. Filter names this browser cannot use.
    try{new Intl.DateTimeFormat('en',{timeZone:id});}catch{continue;}
    const label=`${city(id)} — ${countries.of(country)??country}`;
    choices.set(id,{id,label,search:normalize(`${label} ${id} ${country} ${aliases[id]??''}`)});
  }
  for(const id of [...Intl.supportedValuesOf('timeZone'),'UTC'])if(!choices.has(id)){
    const label=id==='UTC'?'UTC — Coordinated Universal Time':`${city(id)} — ${id.split('/')[0]}`;
    choices.set(id,{id,label,search:normalize(`${label} ${id}`)});
  }
  return [...choices.values()].sort((a,b)=>a.label.localeCompare(b.label,'en'));
}
export function searchTimezones(choices:TimezoneChoice[],query:string){
  const words=normalize(query.trim()).split(/\s+/).filter(Boolean);
  return choices.filter(choice=>words.every(word=>choice.search.includes(word)));
}
export function savedTimezoneChoice(choices:TimezoneChoice[],id:string):TimezoneChoice{
  // A saved identifier can be newer than the visitor's ICU data. Preserve it
  // unchanged when editing another field; the server still validates writes.
  const exact=choices.find(choice=>choice.id===id);if(exact)return exact;
  try{
    const canonical=new Intl.DateTimeFormat('en',{timeZone:id}).resolvedOptions().timeZone;
    const match=choices.find(choice=>choice.id===canonical);if(match)return {...match,id};
  }catch{}
  return {id,label:id,search:normalize(id)};
}
