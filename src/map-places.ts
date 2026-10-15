import {z} from 'zod';
import {DomainError,uuid} from './domain.js';
export type MapLocation={label:string;latitude:number;longitude:number};
export const placeSearchSchema=z.strictObject({tripId:uuid,query:z.string().trim().min(3).max(200)});
// Explicit, authenticated searches only. This provider is replaceable without changing saved pins.
export class MapPlaces {
  private cache=new Map<string,{expires:number;places:MapLocation[]}>();
  private window=0;private requests=0;private last=-Infinity;
  private users=new Map<string,{since:number;count:number}>();
  constructor(private endpoint=process.env.MAP_SEARCH_URL??'https://photon.komoot.io/api/',private request:typeof fetch=fetch,private clock=Date.now){}
  async search(query:string,user:string):Promise<MapLocation[]>{
    const now=this.clock();
    if(now-this.window>=60_000){this.window=now;this.requests=0;this.users.clear();}
    if(this.requests>=60)throw new DomainError('RATE_LIMITED','Too many place searches. Try again in a minute.');
    const quota=this.users.get(user)??{since:now,count:0};this.users.set(user,quota);this.requests++;
    if(++quota.count>10)throw new DomainError('RATE_LIMITED','Too many place searches. Try again in a minute.');
    const key=query.toLocaleLowerCase('en');const cached=this.cache.get(key);
    if(cached&&cached.expires>now)return cached.places;
    if(now-this.last<1100)throw new DomainError('RATE_LIMITED','Please wait a moment before searching again.');
    this.last=now;
    const url=new URL(this.endpoint);if(url.protocol!=='https:')throw Error('Map search requires HTTPS');
    url.searchParams.set('q',query);url.searchParams.set('limit','5');url.searchParams.set('lang','en');
    try{
      const response=await this.request(url,{headers:{Accept:'application/json','User-Agent':'TripPlanningWorkspace/0.1 (+https://github.com/eddieyang-97/trip-planning-engine)'},signal:AbortSignal.timeout(8000),redirect:'error'});
      if(!response.ok||!response.body)throw Error('Provider unavailable');
      const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
      try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>65536)throw Error('Response too large');chunks.push(value);}}finally{await reader.cancel();}
      const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!Array.isArray(result?.features))throw Error('Invalid place response');
      const places:MapLocation[]=[];
      for(const feature of result.features.slice(0,5)){
        const [longitude,latitude]=feature.geometry?.type==='Point'?feature.geometry.coordinates??[]:[];
        if(!Number.isFinite(latitude)||Math.abs(latitude)>85||!Number.isFinite(longitude)||Math.abs(longitude)>180)continue;
        const p=feature.properties??{};
        const label=[...new Set([p.name,[p.housenumber,p.street].filter(v=>typeof v==='string').join(' '),p.city??p.district,p.state,p.country].filter(v=>typeof v==='string'&&v.trim()).map(v=>v.trim()))].join(', ').slice(0,250);
        if(label&&!places.some(p=>p.latitude===latitude&&p.longitude===longitude&&p.label===label))places.push({label,latitude,longitude});
      }
      if(this.cache.size>=200)this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key,{expires:now+86_400_000,places});return places;
    }catch{throw new DomainError('PROVIDER_UNAVAILABLE','Place search is unavailable. Try again later; your saved pins are unchanged.');}
  }
}
