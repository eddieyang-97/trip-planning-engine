import {dayItems,overlaps,staysOn,type LayoutRow} from './itinerary-layout.js';
import {itemNames as names,itemIcons} from './itinerary-categories.js';
function el<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className=''){const n=document.createElement(tag);n.textContent=text;n.className=className;return n;}
function date(day:string){return new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(`${day}T12:00:00Z`));}
export function renderOverview(root:HTMLElement,rows:LayoutRow[],dates:string[],viewer:boolean,open:(row:LayoutRow)=>void,actions?:{edit:(row:LayoutRow)=>void;add:(day:string)=>void}){
  root.replaceChildren();
  root.append(el('p','Times are local to each place. Browse each day from morning to evening; card height does not indicate duration. Tap any item for details.','overview-explainer'));
  const knownOverlaps=overlaps(rows);
  function chip(row:LayoutRow,stayDay?:string){
    const i=row.payload,b=el('button','','overview-item');b.type='button';b.dataset.type=i.type;
    const time=i.startTime?`${i.startTime}${i.endTime?` → ${i.endDate&&i.endDate!==i.startDate?`${date(i.endDate)} `:''}${i.endTime}`:' · end not set'}`:i.startDate?'Time to confirm':'Date to confirm';
    const stay=stayDay?`${i.startDate===stayDay?'Check in':i.endDate===stayDay?'Check out':'Staying here'}${i.startDate===stayDay&&i.startTime?` · ${i.startTime}`:i.endDate===stayDay&&i.endTime?` · ${i.endTime}`:''}`:null;
    b.append(el('span',`${itemIcons[i.type]} ${names[i.type]} · ${stay??time}`,'overview-time'),el('strong',i.title));
    if(i.timeZone&&i.startTime&&!stayDay&&i.endTimeZone&&i.endTimeZone!==i.timeZone)b.append(el('span',`${i.timeZone} → ${i.endTimeZone}`,'overview-zone'));
    b.append(el('span',i.status==='tentative'?'Tentative':`✓ Booked · reported by ${viewer?'owner':'you'}`,`overview-status ${i.status==='tentative'?'':'booked'}`));
    if(knownOverlaps.has(row.id))b.append(el('span','Overlapping times · check details','overview-conflict'));
    b.onclick=()=>open(row);
    const entry=el('div','','overview-entry');entry.append(b);
    if(actions){const edit=el('button','Edit','overview-edit subtle');edit.type='button';edit.setAttribute('aria-label',`Edit ${i.title}`);edit.onclick=()=>actions.edit(row);entry.append(edit);}
    return entry;
  }
  function add(heading:HTMLElement,day:string){if(actions){const button=el('button','＋ Add','day-add subtle');button.type='button';button.setAttribute('aria-label',day==='unscheduled'?'Add unscheduled item':`Add item to ${date(day)}`);button.onclick=()=>actions.add(day);heading.append(button);}}
  const board=el('div','','calendar-board');board.style.setProperty('--calendar-days',String(dates.length));root.append(board);
  // Compact day-part rows align the days without suggesting event durations.
  const bands=[{name:'Overnight',from:0,to:6},{name:'Morning',from:6,to:12},{name:'Afternoon',from:12,to:18},{name:'Evening',from:18,to:24}].filter(band=>rows.some(r=>r.payload.type!=='accommodation'&&r.payload.startDate&&r.payload.startTime&&Number(r.payload.startTime.slice(0,2))>=band.from&&Number(r.payload.startTime.slice(0,2))<band.to));
  board.style.setProperty('--calendar-rows',String(bands.length+3));
  for(const day of dates){
    const section=el('section','','overview-day');section.id=`overview-day-${day}`;
    const heading=el('h3',date(day));add(heading,day);section.append(heading);
    const stays=el('div','','calendar-stays');stays.append(el('span','STAY','calendar-label'));
    const dayStays=staysOn(rows,day);stays.append(...(dayStays.length?dayStays.map(row=>chip(row,day)):[el('p','No stay added','calendar-empty')]));section.append(stays);
    const items=dayItems(rows,day),untimed=items.filter(r=>!r.payload.startTime);
    const loose=el('div','','calendar-untimed');loose.append(el('span','TIME TO CONFIRM','calendar-label'),...untimed.map(row=>chip(row)));if(!untimed.length)loose.append(el('p','No untimed items','calendar-empty'));section.append(loose);
    bands.forEach(band=>{const slot=el('div','','calendar-slot');slot.append(el('span',band.name,'calendar-hour'));const timed=items.filter(r=>r.payload.startTime&&Number(r.payload.startTime.slice(0,2))>=band.from&&Number(r.payload.startTime.slice(0,2))<band.to);if(!timed.length){slot.classList.add('calendar-slot-empty');slot.append(el('p','Nothing planned','calendar-empty'));}slot.append(...timed.map(row=>chip(row)));section.append(slot);});
    board.append(section);
  }
  const section=el('section','','overview-unscheduled');section.id='overview-day-unscheduled';const heading=el('h3','Unscheduled & alternatives');add(heading,'unscheduled');section.append(heading,el('p','Ideas without a date stay separate from the scheduled plan.','muted'));
  const ideas=el('div','','overview-ideas');ideas.append(...rows.filter(r=>!r.payload.startDate).sort((a,b)=>a.position-b.position).map(row=>chip(row)));section.append(ideas);
  if(!ideas.childElementCount)section.append(el('p','No unscheduled ideas.','muted'));root.append(section);
}
