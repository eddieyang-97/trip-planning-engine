import type {ItineraryItem} from './itinerary.js';

export type CalendarRow={id:string;payload:ItineraryItem;position:number};
export type CalendarPlan={trip:{id:string;payload:{name:string}};revision:number;items:CalendarRow[]};
type Schedule={start:string;end?:string;allDay:boolean};
export type CalendarChoice={row:CalendarRow;reason:string|null;schedule?:Schedule};
const formatters=new Map<string,Intl.DateTimeFormat>();
const day=86400000;
function localParts(instant:number,timeZone:string){
  let formatter=formatters.get(timeZone);
  if(!formatter){
    formatter=new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
    formatters.set(timeZone,formatter);
  }
  const parts=formatter.formatToParts(instant),part=(type:string)=>Number(parts.find(p=>p.type===type)!.value);
  const result=new Date(0);result.setUTCFullYear(part('year'),part('month')-1,part('day'));result.setUTCHours(part('hour'),part('minute'),part('second'),0);
  return result.getTime();
}
function validDate(value:string){
  return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number(value.slice(0,4))>0&&
    Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
}
function nextDate(value:string){return new Date(Date.parse(value+'T00:00:00Z')+day).toISOString().slice(0,10);}
function stamp(instant:number){return new Date(instant).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');}
// Resolve wall-clock times by testing possible offsets around the date. Reject
// both DST gaps and repeated local times rather than silently choosing an instant.
function instant(date:string,time:string,zone:string|null,label:string){
  if(!zone)throw Error('Add the '+label+' time zone before exporting.');
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error('Check the '+label+' time.');
  const wall=Date.parse(date+'T'+time+':00Z'),offsets=new Set<number>();
  try{for(let hours=-36;hours<=36;hours+=6){const sample=wall+hours*3600000;offsets.add(localParts(sample,zone)-sample);}}
  catch{throw Error('Check the '+label+' time zone.');}
  const matches=[...offsets].map(offset=>wall-offset).filter(candidate=>localParts(candidate,zone)===wall);
  if(matches.length===0)throw Error('The '+label+' time does not exist during the clock change. Edit this item first.');
  if(matches.length>1)throw Error('The '+label+' time occurs twice during the clock change. Edit this item first.');
  return matches[0]!;
}
export function calendarChoice(row:CalendarRow):CalendarChoice{
  const i=row.payload;
  try{
    if(!i.startDate)throw Error('Add a start date before exporting.');
    if(!validDate(i.startDate)||i.endDate&&!validDate(i.endDate))throw Error('Check the item dates before exporting.');
    if(i.endTime&&!i.endDate)throw Error('Add an end date before exporting.');
    if(!i.startTime){
      if(i.endTime)throw Error('Add a start time before exporting an item with an end time.');
      if(i.endDate&&i.endDate<i.startDate)throw Error('The end date precedes the start date.');
      if(i.type==='accommodation'&&i.endDate&&i.endDate<=i.startDate)throw Error('Checkout must be after the stay starts.');
      const end=i.endDate?(i.type==='accommodation'?i.endDate:nextDate(i.endDate)):nextDate(i.startDate);
      if(!validDate(end))throw Error('Check the end date before exporting.');
      return {row,reason:null,schedule:{start:i.startDate.replaceAll('-',''),end:end.replaceAll('-',''),allDay:true}};
    }
    const start=instant(i.startDate,i.startTime,i.timeZone,'start');
    let end:number|undefined;
    if(i.endDate&&!i.endTime)throw Error('Add an end time, or clear the end date, before exporting this timed item.');
    if(i.endTime){
      end=instant(i.endDate!,i.endTime,i.endTimeZone,'end');
      if(end<=start)throw Error('The end must be after the start when time zones are applied.');
    }
    return {row,reason:null,schedule:{start:stamp(start),...(end===undefined?{}:{end:stamp(end)}),allDay:false}};
  }catch(error){return {row,reason:error instanceof Error?error.message:'Check this item before exporting.'};}
}
export function calendarChoices(rows:CalendarRow[]){return rows.map(calendarChoice);}
function text(value:string){
  return value.replace(/\r\n|\r/g,'\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'')
    .replaceAll('\\','\\\\').replaceAll('\n','\\n').replaceAll(';','\\;').replaceAll(',','\\,');
}
// Fold by UTF-8 octets, never in the middle of a code point (RFC 5545).
function fold(value:string){
  const encoder=new TextEncoder();let line='',bytes=0;const result:string[]=[];
  for(const character of value){const size=encoder.encode(character).length;if(bytes+size>75){result.push(line);line=' ';bytes=1;}line+=character;bytes+=size;}
  result.push(line);return result.join('\r\n');
}
export function calendarFile(plan:CalendarPlan,itemIds:string[],now=new Date()){
  if(!itemIds.length||new Set(itemIds).size!==itemIds.length)throw Error('Select at least one item, without duplicates.');
  const rows=itemIds.map(id=>{const row=plan.items.find(r=>r.id===id);if(!row)throw Error('An item is no longer in this itinerary. Refresh and try again.');return row;});
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Trip Planning Workspace//Itinerary Export//EN','CALSCALE:GREGORIAN','X-WR-CALNAME:'+text(plan.trip.payload.name)];
  for(const row of rows){
    const choice=calendarChoice(row);if(!choice.schedule)throw Error(row.payload.title+': '+choice.reason);
    const i=row.payload,s=choice.schedule;
    const description=[i.status==='tentative'?'Tentative plan':'Booked — reported by trip owner',i.notes,
      i.openQuestion?'Still to figure out: '+i.openQuestion:'',
      s.allDay?'All-day entry; no local times recorded.':[
        'Start: '+i.startDate+' '+i.startTime+' '+i.timeZone,
        i.endTime?'End: '+i.endDate+' '+i.endTime+' '+i.endTimeZone:'End time not set; no duration supplied.'
      ].join('\n'),'Exported itinerary snapshot. Later edits do not update this event.'].filter(Boolean).join('\n\n');
    // UID is stable across individual/all/subset exports. It does not guarantee
    // client-side deduplication. No booking notes or other private data is read.
    lines.push('BEGIN:VEVENT','UID:'+text(row.id+'@trip-planning-workspace'),'DTSTAMP:'+stamp(now.getTime()),
      'SEQUENCE:'+Math.max(0,plan.revision),s.allDay?'DTSTART;VALUE=DATE:'+s.start:'DTSTART:'+s.start);
    if(s.end)lines.push((s.allDay?'DTEND;VALUE=DATE:':'DTEND:')+s.end);
    lines.push('SUMMARY:'+text(i.title),'DESCRIPTION:'+text(description),'STATUS:'+(i.status==='tentative'?'TENTATIVE':'CONFIRMED'));
    if(i.location)lines.push('LOCATION:'+text(i.location));
    if(i.url){
      const url=new URL(i.url);
      if(url.protocol!=='https:'||url.username||url.password)throw Error('Use an HTTPS item link without credentials.');
      lines.push('URL:'+url.href);
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n')+'\r\n';
}
