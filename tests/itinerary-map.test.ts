import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import express from 'express';
import {MapPlaces} from '../src/map-places.js';
import {itineraryItemSchema,type ItineraryItem} from '../src/itinerary.js';
import {embedded,migrate} from '../src/database.js';
import {Core} from '../src/core.js';
import {itineraryRoutes} from '../src/itinerary-web.js';
import {readItineraryViewLink} from '../src/itinerary-view-links.js';
import {flaineTrip} from '../src/acceptance.js';
import {mapDayItems,mapEntries,groupMapEntries} from '../web/itinerary-map-data.js';
import {categories,itemCategory} from '../web/itinerary-categories.js';
import {verifyMapSave} from '../web/itinerary-save-verification.js';
const key=()=>({idempotencyKey:randomUUID()});
const pin={label:'Flaine resort centre',latitude:46.005,longitude:6.687};
const item:ItineraryItem={type:'accommodation',title:'Example stay',location:'Flaine',mapLocations:[pin],startDate:'2026-12-18',endDate:'2026-12-20',startTime:null,endTime:null,timeZone:null,endTimeZone:null,url:null,notes:'Shared',openQuestion:'',status:'user_reported_booked',bookingNote:'PRIVATE booking'};

test('co-located map groups retain every category and pin; save confirmation checks counts and read-back coordinates',()=>{
  const rows=['accommodation','restaurant','activity','flight','transfer','note'].map((type,index)=>({id:String(index),position:index,payload:{...item,type:type as ItineraryItem['type']}}));
  const groups=groupMapEntries(mapEntries(rows));assert.equal(groups.length,1);assert.equal(groups[0]!.length,6);
  assert.deepEqual([...new Set(groups[0]!.map(e=>itemCategory[e.row.payload.type]))],['accommodation','dining','activity','transport','note']);
  assert.deepEqual(Object.values(categories).map(c=>c.colour),['#6366F1','#F59E0B','#16A34A','#0284C7','#64748B']);
  verifyMapSave([pin],{mapLocationCount:1},[{longitude:pin.longitude,latitude:pin.latitude,label:pin.label}]);verifyMapSave([],{mapLocationCount:0},[]);
  assert.throws(()=>verifyMapSave([pin],{mapLocationCount:0},[pin]),/did not match/);
  assert.throws(()=>verifyMapSave([pin],{mapLocationCount:1},[{...pin,latitude:45}]),/did not match/);
  assert.throws(()=>verifyMapSave([pin],{mapLocationCount:1},[]),/did not match/);
});

test('map pins validate coordinates and remain optional for existing items',()=>{
  const {mapLocations,...legacy}=item;assert.ok(itineraryItemSchema.safeParse(legacy).success);
  for(const mapLocations of [[{...pin,latitude:86}],[{...pin,longitude:181}],[{...pin,latitude:NaN}],[{...pin,extra:'private'}],[pin,pin,pin]])assert.equal(itineraryItemSchema.safeParse({...item,mapLocations}).success,false);
  assert.ok(itineraryItemSchema.safeParse({...item,mapLocations:[pin,{...pin,latitude:0,longitude:0}]}).success);
});

test('map filters include spanning stays and transfers, keep ideas separate and number consistently',()=>{
  const rows=[{id:'stay',position:1,payload:item},{id:'transfer',position:2,payload:{...item,type:'transfer' as const,startDate:'2026-12-18',endDate:'2026-12-19',mapLocations:[pin,{...pin,label:'Geneva',latitude:46.23,longitude:6.1}]}},{id:'idea',position:3,payload:{...item,startDate:null,endDate:null,mapLocations:[]}}];
  assert.deepEqual(mapDayItems(rows,'2026-12-19').map(r=>r.id),['stay','transfer']);
  assert.deepEqual(mapDayItems(rows,'2026-12-20').map(r=>r.id),['stay']);
  assert.deepEqual(mapDayItems(rows,'unscheduled').map(r=>r.id),['idea']);
  assert.equal(mapDayItems(rows,'all').length,3);
  assert.deepEqual(mapEntries(mapDayItems(rows,'all')).map(e=>e.number),[1,2,2]);
});

test('place search bounds responses, projects public place fields, caches and limits provider calls',async()=>{
  let now=100_000,calls=0;let requested='';
  const provider=new MapPlaces('https://places.example/api/',async input=>{calls++;requested=String(input);return Response.json({features:[
    {geometry:{type:'Point',coordinates:[6.687,46.005]},properties:{name:'Flaine',city:'Flaine',country:'France',secret:'not returned'}},
    {geometry:{type:'Point',coordinates:[999,46]},properties:{name:'Bad'}},
  ]});},()=>now);
  const found=await provider.search('Flaine','owner');assert.deepEqual(found,[{...pin,label:'Flaine, France'}]);assert.ok(requested.includes('q=Flaine'));assert.ok(!JSON.stringify(found).includes('secret'));
  assert.deepEqual(await provider.search('flaine','owner'),found);assert.equal(calls,1);
  await assert.rejects(provider.search('Geneva','owner'),/wait a moment/);assert.equal(calls,1);
  now+=1101;await provider.search('Geneva','owner');assert.equal(calls,2);
  for(let n=0;n<6;n++)await provider.search('Flaine','owner');
  await assert.rejects(provider.search('Flaine','owner'),/Too many/);
  const broken=new MapPlaces('https://places.example',async()=>new Response('x'.repeat(65537)),()=>now);
  await assert.rejects(broken.search('Flaine','owner'),/unavailable/);
});

test('saved pins work across owner, editor and anonymous reads; search enforces direct auth, membership, origin and revocation',async()=>{
  const db=await embedded(),http=createServer(),owner=randomUUID(),editor=randomUUID(),viewer=randomUUID(),stranger=randomUUID();let calls=0;
  try{
    await migrate(db);const core=new Core(db,false),trip=(await core.callFromWeb('create_trip',{...flaineTrip,...key()},owner)).tripId;
    const saved=await core.callFromWeb('add_itinerary_item',{...key(),tripId:trip,expectedRevision:1,item},owner);
    const invite=await core.callFromWeb('create_itinerary_invite',{...key(),tripId:trip,label:'Map editor',role:'editor'},owner);
    await core.callFromWeb('accept_itinerary_invite',{...key(),token:invite.token,displayName:'Map editor'},editor);
    const viewerInvite=await core.callFromWeb('create_itinerary_invite',{...key(),tripId:trip,label:'Map viewer',role:'viewer'},owner);
    await core.callFromWeb('accept_itinerary_invite',{...key(),token:viewerInvite.token,displayName:'Map viewer'},viewer);
    const {status,bookingNote,...shared}=item;
    await core.callFromWeb('update_shared_itinerary_item',{...key(),tripId:trip,itemId:saved.itemId,expectedRevision:2,item:{...shared,mapLocations:[{...pin,label:'Confirmed place'}]}},editor);
    const link=await core.callFromWeb('create_itinerary_view_link',{...key(),tripId:trip,label:'Map view'},owner);
    await db.query('update itinerary_items set payload=jsonb_set(payload,\'{mapLocations,0,futurePrivate}\',\'"PRIVATE map metadata"\'::jsonb) where id=$1',[saved.itemId]);
    const publicPlan=await readItineraryViewLink(db,{token:link.token});
    assert.equal(publicPlan.items[0]!.payload.mapLocations[0].label,'Confirmed place');assert.ok(!JSON.stringify(publicPlan).includes('PRIVATE'));
    const owned=await core.callFromWeb('get_itinerary',{tripId:trip},owner);assert.equal(owned.items[0].payload.bookingNote,'PRIVATE booking');
    await new Promise<void>(r=>http.listen(0,'127.0.0.1',r));const address=http.address();assert.ok(address&&typeof address!=='string');const origin=`http://127.0.0.1:${address.port}`;
    const authenticate=async(header?:string)=>{const user=header?.replace('Bearer ','');if(!([owner,editor,viewer,stranger] as string[]).includes(user??''))throw Error();return {userId:user!};};
    const places=new MapPlaces('https://places.example',async()=>{calls++;return Response.json({features:[]});});
    const app=express();app.use(itineraryRoutes({core,origin,authenticate,mapPlaces:places}));http.on('request',app);
    const post=(user:string,body:unknown={tripId:trip,query:'Flaine'},from=origin)=>fetch(origin+'/itinerary-api/place-search',{method:'POST',headers:{Origin:from,Authorization:'Bearer '+user,'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await post('bad')).status,401);assert.equal((await post(stranger)).status,404);assert.equal((await post(viewer)).status,404);
    assert.equal((await post(owner,undefined,'https://evil.example')).status,403);assert.equal((await post(owner,{tripId:trip,query:'Flaine',url:'https://evil.example'})).status,400);assert.equal(calls,0);
    assert.equal((await post(editor)).status,200);assert.equal(calls,1);
    await core.callFromWeb('revoke_itinerary_access',{...key(),tripId:trip,inviteId:invite.inviteId},owner);
    assert.equal((await post(editor)).status,404);assert.equal(calls,1,'revoked editor cannot reuse cached lookup');
    const html=await fetch(origin+'/itinerary');assert.match(html.headers.get('content-security-policy')!,/img-src 'self' https:\/\/tile.openstreetmap.org/);
    assert.equal(html.headers.get('referrer-policy'),'no-referrer');
    assert.equal((await fetch(origin+'/assets/leaflet.css')).status,200);
  }finally{await new Promise<void>(r=>http.close(()=>r()));await db.close();}
});
