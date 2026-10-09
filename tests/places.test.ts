import assert from 'node:assert/strict';
import { test } from 'node:test';
import { discoveryQuery, flaineLocationQuery, normalizePlaces, OpenStreetMapDiscovery, osmAttribution,
  overpassEndpoint, requestOverpass, selectFlaineCenter } from '../src/places.js';

const node={type:'node',id:1,lat:46.005,lon:6.69,timestamp:'2024-01-01T00:00:00Z',tags:{name:'Test restaurant',amenity:'restaurant',
  cuisine:'regional;french',opening_hours:'Mo-Su 12:00-22:00',reservation:'yes',website:'https://example.com'}};

test('place discovery preserves sources while hours and reservation tags never become available tables',()=>{
  const now=new Date('2026-10-09T12:00:00Z');
  const result=normalizePlaces({elements:[node,{...node,type:'way',id:2,center:{lat:46.006,lon:6.691},tags:{name:'Test hotel',tourism:'hotel'}}]},now);
  assert.equal(result.places.length,2);assert.equal(result.coverage.complete,false);
  for(const p of result.places){assert.equal(p.availability,'not_checked');assert.equal(p.quotedPrice,null);assert.deepEqual(p.attribution,osmAttribution);}
  assert.equal(result.places[0]!.openingHoursText,'Mo-Su 12:00-22:00');
  assert.deepEqual(result.places[0]!.cuisine,['regional','french']);
  assert.equal(result.places[0]!.sourceModifiedAt,'2024-01-01T00:00:00Z');
  assert.equal(result.places[0]!.observedAt,now.toISOString());
  assert.equal(result.places[1]!.locationKind,'geometry_center');
});

test('places reject partial-response warnings and discard unsupported geometry and unsafe links',()=>{
  assert.throws(()=>normalizePlaces({elements:[node],remark:'runtime error: timeout'}),/incomplete query/);
  const result=normalizePlaces({elements:[node,node,{...node,id:2,lat:999},
    {...node,id:3,tags:{amenity:'restaurant',website:'javascript:alert(1)'}},
    {...node,id:4,tags:{amenity:'restaurant',website:'https://user:password@example.com'}},
    {...node,id:5,tags:{amenity:'hospital'}}]});
  assert.equal(result.places.length,3);assert.equal(result.coverage.skippedElements,3);
  assert.equal(result.places[1]!.website,null);assert.equal(result.places[2]!.website,null);
  assert.equal(result.places[1]!.name,null,'missing names are not invented');
});

test('place result caps and query validation keep the small probe bounded',()=>{
  const result=normalizePlaces({elements:Array.from({length:101},(_,i)=>({...node,id:i+1}))});
  assert.equal(result.places.length,100);assert.equal(result.coverage.truncated,true);
  assert.equal(result.coverage.normalizedElements,101);
  assert.throws(()=>discoveryQuery({lat:46,lon:7},100000));
  assert.throws(()=>discoveryQuery({lat:NaN,lon:7},2500));
  assert.throws(()=>discoveryQuery({lat:46,lon:7},Number('2500);out;')));
  assert.match(discoveryQuery({lat:46.005,lon:6.69},2500),/around:2500,46.005,6.69/);
  assert.match(flaineLocationQuery,/45.5,6,46.5,7.5/);
});

test('Flaine lookup rejects missing and ambiguous matches',()=>{
  const location={...node,tags:{name:'Flaine',place:'village'}};
  assert.equal(selectFlaineCenter({elements:[location]}).lat,46.005);
  assert.throws(()=>selectFlaineCenter({elements:[]}),/missing or ambiguous/);
  assert.throws(()=>selectFlaineCenter({elements:[location,{...location,id:2}]}),/missing or ambiguous/);
});

test('Overpass discovery uses a fixed endpoint and never retries a failure',async()=>{
  let calls=0;
  await assert.rejects(requestOverpass(flaineLocationQuery,async()=>{calls++;return new Response('busy',{status:504});}),/HTTP 504/);
  assert.equal(calls,1);
  const provider=new OpenStreetMapDiscovery(async(url,init)=>{
    assert.equal(url,overpassEndpoint);assert.equal(init?.redirect,'error');assert.equal(init?.method,'POST');
    assert.ok(String(init?.body).includes('data='));return Response.json({elements:[node]});
  });
  assert.equal((await provider.discover({lat:46.005,lon:6.69},2500)).places.length,1);
});
