import {randomUUID} from 'node:crypto';
import {Core,saveOffer} from '../../dist/src/core.js';
import {FixtureProvider} from '../../dist/src/providers.js';
import {flaineCriteria} from '../../dist/src/acceptance.js';
import {test,expect} from './fixture.mjs';

test('flight research keeps the schedule compact and discloses evidence and archive controls',async({page,context,app},testInfo)=>{
  const actor={userId:app.owner,clientId:'fixture-seed-only'},core=new Core(app.db,false,false);
  const call=(name,args)=>core.call(name,{idempotencyKey:randomUUID(),...args},actor);
  const criteria={...flaineCriteria,adults:6,outbound:'2027-03-04',inbound:'2027-03-08'};
  const decision=await call('create_decision',{tripId:app.tripId,title:'London ↔ Zurich (6 adults)',criteria});
  const offer={...(await new FixtureProvider().search(flaineCriteria)).offers[2],adults:6,
    seller:'Fictional research source',sourceUrl:'https://example.com/fictional-flight',
    outbound:[{origin:'LTN',destination:'ZRH',operatingFlight:'TEST2533',departure:'2027-03-04T17:45:00Z',arrival:'2027-03-04T19:25:00Z'}],
    inbound:[{origin:'ZRH',destination:'LTN',operatingFlight:'TEST2534',departure:'2027-03-08T19:10:00Z',arrival:'2027-03-08T21:00:00Z'}]};
  // Fictional persisted evidence only. No worker or supplier is contacted.
  await app.db.transaction(tx=>saveOffer(tx,decision.decisionId,offer,'provider_reported',null));
  await app.db.query("insert into search_runs(id,decision_id,criteria_version,provider,status,coverage) values($1,$2,1,'fixture','complete',$3)",
    [randomUUID(),decision.decisionId,JSON.stringify({complete:false,sample:'One combined airport query; no seller quotes or baggage inventory.'})]);
  await call('update_decision_criteria',{decisionId:decision.decisionId,expectedRevision:decision.revision,criteria:{...criteria,adults:5}});
  const snapshot=async()=>({
    mutations:(await app.db.query('select count(*)::int n from mutation_requests')).rows[0].n,
    items:(await app.db.query('select * from itinerary_items order by id')).rows,
    observations:(await app.db.query('select * from observations order by id')).rows,
  });
  const before=await snapshot(),externalRequests=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>{
    if(new URL(route.request().url()).origin===app.origin)return route.continue();
    externalRequests.push(route.request().url());return route.abort();
  });
  await page.goto(`${app.origin}/itinerary?trip=${app.tripId}&flight=${decision.decisionId}&view=details`);
  await page.getByLabel('Local development token').fill(app.ownerToken);
  await page.getByRole('button',{name:'Open local trips',exact:true}).click();
  const section=page.locator('.research-decision').filter({has:page.getByRole('heading',{name:'London ↔ Zurich (6 adults)'})});
  const card=section.getByRole('article'),search=section.locator('.research-search-details');
  await expect(section.locator('.research-notice')).toHaveText('Criteria changed since this search · Limited search coverage. Recheck before choosing.');
  await expect(section.getByRole('button',{name:'Archive decision',exact:true})).not.toBeVisible();
  await expect(section.getByText('One combined airport query',{exact:false})).not.toBeVisible();
  await expect(card.getByText('Built-in search',{exact:false})).not.toBeVisible();
  await expect(card.getByRole('table')).not.toBeVisible();
  await expect(card.getByRole('button',{name:'Review outbound'})).toBeVisible();
  for(const width of [390,1280]){
    await page.setViewportSize({width,height:900});
    await expect(card.getByText('LTN → ZRH',{exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const box=await section.boundingBox();expect(box.height).toBeLessThan(width===390?620:390);
    await section.screenshot({path:testInfo.outputPath(`research-${width}.png`)});
  }
  await page.setViewportSize({width:390,height:844});
  await card.getByText('Prices & sources · 1 record',{exact:true}).click();
  await expect(card.getByRole('table')).toBeVisible();
  await expect(card).toContainText('£150.00');
  await expect(card).toContainText('Basis unknown · Exact-party quote unverified');
  await expect(card).toContainText('Europe/London → Europe/Zurich');
  await expect(card.getByRole('link',{name:'Open research source'})).toHaveAttribute('href',offer.sourceUrl);
  await search.locator('summary').click();
  await expect(search).toContainText('criteria version 1');
  await expect(search.getByRole('button',{name:'Archive decision'})).toBeEnabled();
  await search.locator('summary').click();
  await card.getByRole('button',{name:'Review outbound'}).click();
  const editor=page.getByRole('dialog',{name:'Review flight for your plan'});
  await expect(editor).toBeVisible();
  await expect(editor.locator('[name="startTime"]')).toHaveValue('17:45');
  await editor.getByRole('button',{name:'Cancel',exact:true}).click();
  expect(await snapshot()).toEqual(before);
  expect(externalRequests).toEqual([]);expect(errors).toEqual([]);
});
