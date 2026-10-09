import { z } from 'zod';

const point = z.object({lat:z.number().min(-90).max(90),lon:z.number().min(-180).max(180)});
const element = z.object({type:z.enum(['node','way','relation']),id:z.number().int().positive().safe(),
  lat:z.number().optional(),lon:z.number().optional(),center:point.optional(),
  timestamp:z.string().optional(),tags:z.record(z.string(),z.string()).default({})});
const responseSchema=z.object({elements:z.array(element).max(10000),remark:z.string().optional(),
  osm3s:z.object({timestamp_osm_base:z.string().optional()}).optional()});
export const osmAttribution={text:'© OpenStreetMap contributors',url:'https://www.openstreetmap.org/copyright',
  license:'ODbL-1.0',licenseUrl:'https://opendatacommons.org/licenses/odbl/1-0/'};
export const overpassEndpoint='https://overpass.private.coffee/api/interpreter';
export interface PlaceObservation {
  provider:'openstreetmap';sourceId:string;sourceUrl:string;name:string|null;
  category:'restaurant'|'cafe'|'bar'|'pub'|'fast_food'|'hotel'|'apartment'|'guest_house'|'hostel';
  latitude:number;longitude:number;locationKind:'mapped_point'|'geometry_center';
  cuisine:string[];openingHoursText:string|null;website:string|null;
  observedAt:string;sourceModifiedAt:string|null;
  availability:'not_checked';quotedPrice:null;attribution:typeof osmAttribution;
}
export interface DiscoveryResult {
  places:PlaceObservation[];provider:'openstreetmap';fetchedAt:string;sourceBaseTime:string|null;
  coverage:{complete:false;returnedElements:number;normalizedElements:number;skippedElements:number;truncated:boolean;warning:string};
  attribution:typeof osmAttribution;
}
export interface PlaceDiscoveryProvider {
  id:string;
  discover(center:{lat:number;lon:number},radiusMeters:number):Promise<DiscoveryResult>;
}
function website(value:string|undefined) {
  if(!value)return null;
  try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
function category(tags:Record<string,string>):PlaceObservation['category']|null {
  if(['restaurant','cafe','bar','pub','fast_food'].includes(tags.amenity??''))return tags.amenity as PlaceObservation['category'];
  if(['hotel','apartment','guest_house','hostel'].includes(tags.tourism??''))return tags.tourism as PlaceObservation['category'];
  return null;
}
export function normalizePlaces(raw:unknown,now=new Date()):DiscoveryResult {
  const data=responseSchema.parse(raw);
  // Overpass can return HTTP 200 with partial results and a timeout remark.
  if(data.remark)throw new Error('Overpass reported an incomplete query; do not treat it as successful coverage.');
  const seen=new Set<string>();let skipped=0;
  const places:PlaceObservation[]=[];
  for(const item of data.elements) {
    const sourceId=`${item.type}/${item.id}`,kind=category(item.tags);
    const location=point.safeParse(item.type==='node'?{lat:item.lat,lon:item.lon}:item.center);
    if(!kind||!location.success||seen.has(sourceId)){skipped++;continue;}
    seen.add(sourceId);
    places.push({provider:'openstreetmap',sourceId,sourceUrl:`https://www.openstreetmap.org/${sourceId}`,
      name:item.tags.name?.slice(0,250)??null,category:kind,latitude:location.data.lat,longitude:location.data.lon,
      locationKind:item.type==='node'?'mapped_point':'geometry_center',
      cuisine:(item.tags.cuisine??'').split(';').map(x=>x.trim()).filter(Boolean).slice(0,20),
      openingHoursText:item.tags.opening_hours?.slice(0,1000)??null,
      website:website(item.tags.website??item.tags['contact:website']),observedAt:now.toISOString(),
      sourceModifiedAt:item.timestamp??null,availability:'not_checked',quotedPrice:null,attribution:osmAttribution});
  }
  places.sort((a,b)=>a.sourceId.localeCompare(b.sourceId));
  return {provider:'openstreetmap',places:places.slice(0,100),fetchedAt:now.toISOString(),
    sourceBaseTime:data.osm3s?.timestamp_osm_base??null,attribution:osmAttribution,
    coverage:{complete:false,returnedElements:data.elements.length,normalizedElements:places.length,skippedElements:skipped,
      truncated:places.length>100,warning:'Community map coverage may be incomplete or stale. Map hours, reservation tags and hotel locations do not prove opening, table availability or room availability for travel dates. Coordinates are not walking routes.'}};
}
export function discoveryQuery(center:{lat:number;lon:number},radiusMeters:number) {
  const p=point.parse(center),radius=z.number().int().min(100).max(5000).parse(radiusMeters);
  return `[out:json][timeout:20];(nwr(around:${radius},${p.lat},${p.lon})["amenity"~"^(restaurant|cafe|bar|pub|fast_food)$"];nwr(around:${radius},${p.lat},${p.lon})["tourism"~"^(hotel|apartment|guest_house|hostel)$"];);out center meta;`;
}
// Restrict name resolution to the northern French Alps rather than searching worldwide.
export const flaineLocationQuery='[out:json][timeout:20];nwr(45.5,6,46.5,7.5)["name"="Flaine"]["place"~"^(hamlet|village|town|locality)$"];out center;';
export function selectFlaineCenter(raw:unknown) {
  const data=responseSchema.parse(raw);
  if(data.remark)throw new Error('Flaine location lookup returned a provider warning.');
  const matches=data.elements.filter(e=>e.tags.name==='Flaine'&&['hamlet','village','town','locality'].includes(e.tags.place??''));
  if(matches.length!==1)throw new Error('Flaine location is missing or ambiguous; choose a verified center before querying nearby places.');
  const item=matches[0]!;
  return {...point.parse(item.type==='node'?{lat:item.lat,lon:item.lon}:item.center),sourceUrl:`https://www.openstreetmap.org/${item.type}/${item.id}`};
}
export async function requestOverpass(query:string,send=fetch):Promise<unknown> {
  let response:Response;
  try{response=await send(overpassEndpoint,{method:'POST',redirect:'error',
    signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/x-www-form-urlencoded',
      'User-Agent':'TravelResearchPilot/0.1 (+https://github.com/eddieyang-97/trip-planning-engine)'},
    body:new URLSearchParams({data:query})});}catch{throw new Error('Overpass request failed; no automatic retry was made.');}
  if(!response.ok)throw new Error(`Overpass returned HTTP ${response.status}; stop before retrying.`);
  const body=await response.text();
  if(body.length>2_000_000)throw new Error('Overpass response exceeded the small-probe limit.');
  try{return JSON.parse(body);}catch{throw new Error('Overpass did not return readable JSON.');}
}
export class OpenStreetMapDiscovery implements PlaceDiscoveryProvider {
  readonly id='openstreetmap';
  constructor(private readonly send=fetch){}
  async discover(center:{lat:number;lon:number},radiusMeters:number) {
    return normalizePlaces(await requestOverpass(discoveryQuery(center,radiusMeters),this.send));
  }
}
