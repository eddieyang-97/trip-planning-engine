import type {LayoutRow} from './itinerary-layout.js';
export function mapDayItems(rows:LayoutRow[],day:string){
  return rows.filter(({payload:i})=>day==='all'||(day==='unscheduled'?!i.startDate:!!i.startDate&&i.startDate<=day&&(i.endDate??i.startDate)>=day))
    .sort((a,b)=>(a.payload.startDate??'9999').localeCompare(b.payload.startDate??'9999')||(a.payload.startTime??'99').localeCompare(b.payload.startTime??'99')||a.position-b.position);
}
export function mapEntries(rows:LayoutRow[]){
  return rows.flatMap((row,index)=>(row.payload.mapLocations??[]).filter(p=>Number.isFinite(p.latitude)&&Math.abs(p.latitude)<=85&&Number.isFinite(p.longitude)&&Math.abs(p.longitude)<=180)
    .map((place,stop)=>({row,place,number:index+1,stop})));
}
export function groupMapEntries(entries:ReturnType<typeof mapEntries>){
  const groups=new Map<string,typeof entries>();
  for(const entry of entries){const key=`${entry.place.latitude.toFixed(5)},${entry.place.longitude.toFixed(5)}`;groups.set(key,[...(groups.get(key)??[]),entry]);}
  return [...groups.values()];
}
