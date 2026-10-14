import assert from 'node:assert/strict';
import {test} from 'node:test';
import {itineraryItemSchema} from '../src/itinerary.js';
import {dayItems,staysOn,overlaps,type LayoutRow} from '../web/itinerary-layout.js';
function row(id:string,patch:Record<string,unknown>={},position=1):LayoutRow{return {id,position,payload:itineraryItemSchema.parse({type:'activity',title:id,startDate:'2026-11-14',startTime:'10:00',endDate:'2026-11-14',endTime:'12:00',timeZone:'Europe/Rome',endTimeZone:'Europe/Rome',location:'',url:null,notes:'',openQuestion:'',status:'tentative',bookingNote:'',...patch})};}
test('calendar keeps multi-day stays through checkout and untimed ideas out of timed ordering',()=>{
  const stay=row('stay',{type:'accommodation',startDate:'2026-11-13',endDate:'2026-11-15'});
  const rows=[row('later',{startTime:'19:30',endTime:'20:30'}),row('unknown',{startTime:null}),stay,row('early',{startTime:'09:00'}),row('alternative',{startDate:null,startTime:null,endDate:null,endTime:null})];
  assert.deepEqual(staysOn(rows,'2026-11-14').map(r=>r.id),['stay']);
  assert.deepEqual(staysOn(rows,'2026-11-15').map(r=>r.id),['stay']);
  assert.deepEqual(staysOn(rows,'2026-11-16'),[]);
  assert.deepEqual(dayItems(rows,'2026-11-14').map(r=>r.id),['early','later','unknown']);
  assert.equal(stay.payload.startDate,'2026-11-13');
});
test('overlap warnings require known same-clock intervals and never guess missing ends',()=>{
  const a=row('a'),b=row('b',{startTime:'11:30',endTime:'13:00'}),adjacent=row('adjacent',{startTime:'13:00',endTime:'14:00'});
  assert.deepEqual([...overlaps([a,b,adjacent])].sort(),['a','b']);
  for(const patch of [{endTime:null},{timeZone:null},{timeZone:'Europe/London'},{endTimeZone:'Europe/London'},{endDate:'2026-11-15'}])assert.deepEqual([...overlaps([a,row('unknown',patch)])],[]);
});
