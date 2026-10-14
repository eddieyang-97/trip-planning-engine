import type {ItineraryItem} from '../src/itinerary.js';
export type LayoutRow={id:string;payload:ItineraryItem;position:number};
export function minutes(time:string){const [h,m]=time.split(':').map(Number);return h!*60+m!;}
// A stay remains visible on its checkout date; it is not a second booking.
export function staysOn(rows:LayoutRow[],day:string){return rows.filter(({payload:i})=>i.type==='accommodation'&&i.startDate&&i.startDate<=day&&(i.endDate??i.startDate)>=day);}
export function dayItems(rows:LayoutRow[],day:string){return rows.filter(({payload:i})=>i.startDate===day&&i.type!=='accommodation').sort((a,b)=>{
  const x=a.payload.startTime,y=b.payload.startTime;
  return x&&y?x.localeCompare(y)||a.position-b.position:x?-1:y?1:a.position-b.position;
});}
// Only compare intervals whose local clock is known to be the same. Adjacent
// events are not overlaps, and unknown ends never receive a guessed duration.
export function overlaps(rows:LayoutRow[]){
  const result=new Set<string>();
  for(let a=0;a<rows.length;a++)for(let b=a+1;b<rows.length;b++){
    const x=rows[a]!.payload,y=rows[b]!.payload;
    if(!x.startDate||x.startDate!==y.startDate||!x.startTime||!y.startTime||!x.endTime||!y.endTime||!x.timeZone||x.timeZone!==y.timeZone)continue;
    if(x.endDate!==x.startDate||y.endDate!==y.startDate||x.endTimeZone&&x.endTimeZone!==x.timeZone||y.endTimeZone&&y.endTimeZone!==y.timeZone)continue;
    if(minutes(x.startTime)>=minutes(x.endTime)||minutes(y.startTime)>=minutes(y.endTime))continue;
    if(minutes(x.startTime)<minutes(y.endTime)&&minutes(y.startTime)<minutes(x.endTime)){result.add(rows[a]!.id);result.add(rows[b]!.id);}
  }
  return result;
}
