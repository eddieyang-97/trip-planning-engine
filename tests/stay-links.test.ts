import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withStayWebUrls} from '../src/stay-links.js';

test('absolute stay handoffs use only the configured public origin across summary and itinerary projections',()=>{
  const path='/itinerary?trip=fictional-trip&stay=fictional-decision',origin='https://travel.example';
  const result=withStayWebUrls({webPath:path,decisions:[{webPath:path},{stay:{webPath:path}}],stayResearch:{decisions:[{webPath:path}]},items:[{sourceLink:{webPath:path}}]},origin);
  for(const value of [result,result.decisions[0],result.decisions[1]!.stay,result.stayResearch.decisions[0],result.items[0]!.sourceLink])assert.equal((value as Record<string,any>).webUrl,origin+path);
  const hostile=withStayWebUrls({webPath:'//outside.example/itinerary?trip=fictional',webUrl:undefined},origin);assert.equal(hostile.webUrl,undefined);
  assert.throws(()=>withStayWebUrls({webPath:path},'https://travel.example/'));
});

test('dining handoffs cover direct/list/trip/owner-itinerary projections with the configured origin',()=>{
  const path='/itinerary?trip=fictional&dining=fictional',origin='https://travel.example';
  const result=withStayWebUrls({webPath:path,decisions:[{dining:{webPath:path}}],diningResearch:{decisions:[{webPath:path}]},items:[{sourceLink:{webPath:path}}]},origin);
  for(const value of [result,result.decisions[0]!.dining,result.diningResearch.decisions[0],result.items[0]!.sourceLink])assert.equal((value as Record<string,any>).webUrl,origin+path);
});
