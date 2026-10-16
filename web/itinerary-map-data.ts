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

// Cluster distinct saved locations in projected pixels, after grouping stops
// at the same place. Counts represent locations, not activities or sequence.
export function clusterMapGroups(groups:ReturnType<typeof groupMapEntries>,project:(latitude:number,longitude:number)=>{x:number;y:number},radius=56){
  const clusters:{groups:typeof groups;point:{x:number;y:number}}[]=[],cells=new Map<string,number[]>();
  const points=groups.map(group=>({group,point:project(group[0]!.place.latitude,group[0]!.place.longitude)}))
    .sort((a,b)=>a.point.x-b.point.x||a.point.y-b.point.y);
  for(const {group,point} of points){
    const x=Math.floor(point.x/radius),y=Math.floor(point.y/radius);let match=-1,distance=radius*radius;
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const index of cells.get(`${x+dx},${y+dy}`)??[]){
      const anchor=clusters[index]!.point,d=(anchor.x-point.x)**2+(anchor.y-point.y)**2;
      if(d<=distance){match=index;distance=d;}
    }
    if(match>=0)clusters[match]!.groups.push(group);
    else{const index=clusters.push({groups:[group],point})-1,key=`${x},${y}`;cells.set(key,[...(cells.get(key)??[]),index]);}
  }
  return clusters.map(c=>c.groups);
}
