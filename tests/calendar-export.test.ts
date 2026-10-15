import assert from 'node:assert/strict';
import {test} from 'node:test';
import {calendarFile,calendarChoice,calendarChoices,type CalendarRow,type CalendarPlan} from '../src/calendar-export.js';
function row(id:string,patch:Partial<CalendarRow['payload']>={}):CalendarRow{
  return {id,position:1,payload:{type:'activity',title:id,startDate:'2026-12-18',startTime:'10:00',endDate:'2026-12-18',endTime:'11:00',
    timeZone:'Europe/London',endTimeZone:'Europe/London',location:'London',url:null,notes:'',openQuestion:'',status:'tentative',bookingNote:'PRIVATE BOOKING',...patch}};
}
function plan(items:CalendarRow[]):CalendarPlan{return {trip:{id:'trip',payload:{name:'Weekend'}},revision:7,items};}
const now=new Date('2026-10-15T08:00:00Z');
const unfold=(file:string)=>file.replace(/\r\n /g,'');

test('single, all and selected exports share stable event identity and preserve instants across zones',()=>{
  const flight=row('flight',{type:'flight',startDate:'2026-12-20',startTime:'12:35',timeZone:'Europe/Zurich',endTime:'13:15',endDate:'2026-12-20',endTimeZone:'Europe/London'});
  const meeting=row('meeting'),other=row('other'),p=plan([flight,meeting,other]);
  const single=unfold(calendarFile(p,['flight'],now)),all=unfold(calendarFile(p,p.items.map(r=>r.id),now)),subset=unfold(calendarFile(p,['flight','other'],now));
  assert.match(single,/DTSTART:20261220T113500Z\r\nDTEND:20261220T131500Z/);
  assert.equal((all.match(/BEGIN:VEVENT/g)||[]).length,3);assert.equal((subset.match(/BEGIN:VEVENT/g)||[]).length,2);
  assert.ok(!subset.includes('SUMMARY:meeting'));
  for(const file of [single,all,subset]){assert.match(file,/UID:flight@trip-planning-workspace/);assert.match(file,/SEQUENCE:7/);}
  assert.equal(p.revision,7);assert.equal(p.items.length,3);
});
test('date-only stays exclude checkout while other multi-day entries include their final date',()=>{
  const hotel=row('hotel',{type:'accommodation',startTime:null,endTime:null,endDate:'2026-12-20',timeZone:null,endTimeZone:null});
  const activity=row('festival',{startTime:null,endTime:null,endDate:'2026-12-20'});
  const oneDay=row('note',{startTime:null,endTime:null,endDate:null});
  assert.deepEqual(calendarChoice(hotel).schedule,{allDay:true,start:'20261218',end:'20261220'});
  assert.equal(calendarChoice(activity).schedule?.end,'20261221');
  assert.equal(calendarChoice(oneDay).schedule?.end,'20261219');
  assert.match(calendarFile(plan([hotel]),['hotel'],now),/DTSTART;VALUE=DATE:20261218\r\nDTEND;VALUE=DATE:20261220/);
});
test('DST gaps and repeated wall times are excluded; valid offsets and midnight crossings resolve accurately',()=>{
  const london=(date:string,time:string)=>row('dst',{startDate:date,startTime:time,endDate:null,endTime:null});
  assert.match(calendarChoice(london('2026-03-29','01:30')).reason!,/does not exist/);
  assert.match(calendarChoice(london('2026-10-25','01:30')).reason!,/occurs twice/);
  assert.equal(calendarChoice(london('2026-03-29','02:30')).schedule?.start,'20260329T013000Z');
  const overnight=row('overnight',{startTime:'23:30',endDate:'2026-12-19',endTime:'01:00'});
  assert.equal(calendarChoice(overnight).schedule?.end,'20261219T010000Z');
  const nepal=row('nepal',{timeZone:'Asia/Kathmandu',endTimeZone:'Asia/Kathmandu'});
  assert.equal(calendarChoice(nepal).schedule?.start,'20261218T041500Z');
});
test('missing dates and zones, partial schedules and invalid end instants are never guessed',()=>{
  const cases:Partial<CalendarRow['payload']>[]=[
    {startDate:null},{timeZone:null},{endTimeZone:null},{endDate:null},{startTime:null},{endTime:null},
    {endTime:'09:30'},{timeZone:'Fake/Zone'},{startDate:'2026-02-30'},
    {startTime:null,endTime:null,type:'accommodation',endDate:'2026-12-18'},
  ];
  for(const patch of cases){const r=row('incomplete',patch);assert.ok(calendarChoice(r).reason,JSON.stringify(patch));assert.throws(()=>calendarFile(plan([r]),['incomplete'],now));}
  const noEnd=row('start-only',{endDate:null,endTime:null});
  assert.equal(calendarChoice(noEnd).reason,null);
  const file=calendarFile(plan([noEnd]),['start-only'],now);assert.ok(!file.includes('DTEND'));assert.ok(!file.includes('DURATION'));
  assert.deepEqual(calendarChoices([row('good'),row('bad',{timeZone:null})]).map(c=>!!c.reason),[false,true]);
});
test('iCalendar escaping and UTF-8 folding preserve text without exporting private fields or injected properties',()=>{
  const title='Café 🏂; '+ '山'.repeat(80),r=row('unicode',{title,location:'First\r\nSecond',notes:'A, B; C\\D\nEND:VEVENT\nBEGIN:VALARM',openQuestion:'Which entrance?',url:'https://example.com/a?x=1&y=2',status:'user_reported_booked'});
  const file=calendarFile(plan([r]),['unicode'],now),plain=unfold(file);
  for(const line of file.split('\r\n'))assert.ok(Buffer.byteLength(line,'utf8')<=75);
  assert.ok(!plain.includes('\uFFFD'));assert.ok(!file.replaceAll('\r\n','').includes('\n'));
  assert.ok(plain.includes('SUMMARY:Café 🏂\\; '+'山'.repeat(80)));
  assert.ok(plain.includes('A\\, B\\; C\\\\D\\nEND:VEVENT\\nBEGIN:VALARM'));
  assert.equal(plain.split('\r\n').filter(l=>l==='END:VEVENT').length,1);
  assert.ok(!file.includes('PRIVATE'));assert.ok(!file.includes('\r\nBEGIN:VALARM'));
  assert.ok(plain.includes('STATUS:CONFIRMED'));assert.ok(plain.includes('Booked — reported by trip owner'));
  assert.ok(plain.includes('URL:https://example.com/a?x=1&y=2'));
});
test('empty, duplicated and foreign selections fail without silently exporting a different set',()=>{
  const p=plan([row('a')]);
  for(const ids of [[],['a','a'],['foreign']])assert.throws(()=>calendarFile(p,ids,now));
  assert.throws(()=>calendarFile(plan([row('bad',{url:'javascript:alert(1)'})]),['bad'],now));
});
