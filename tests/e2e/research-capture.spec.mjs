import {randomUUID} from 'node:crypto';
import {Core} from '../../dist/src/core.js';
import {stayCriteria,stayObservation} from '../../dist/tests/fixtures/stays.js';
import {diningCriteria,diningObservation} from '../../dist/tests/fixtures/dining.js';
import {test,expect} from './fixture.mjs';
import {openDisclosure} from './navigation.mjs';

const call=(app,name,args)=>new Core(app.db,false,false).callFromWeb(name,/^get_/.test(name)?args:{idempotencyKey:randomUUID(),...args},app.owner);
async function seed(app,kind){
  const stay=kind==='stay',criteria=stay?{...stayCriteria(2),checkIn:'2027-01-01',checkOut:'2027-01-02'}:{...diningCriteria(2),date:'2027-01-01'};
  const decision=await call(app,stay?'create_stay_decision':'create_dining_decision',{tripId:app.tripId,title:`Fictional ${kind} capture`,criteria});
  return {...decision,criteria,observation:stay?{...stayObservation(2),checkIn:'2027-01-01',checkOut:'2027-01-02'}:{...diningObservation(2),date:'2027-01-01'}};
}
async function open(page,app,kind,decision){
  await page.goto(`${app.origin}/itinerary?trip=${app.tripId}&${kind}=${decision.decisionId}`);
  await page.getByLabel('Local development token').fill(app.ownerToken);
  await page.getByRole('button',{name:'Open local trips',exact:true}).click();
  await expect(page.locator(`#${kind}-research summary`).first()).toContainText(`Fictional ${kind} capture`);
  await expect(page.locator('#refresh')).toBeEnabled();
}
async function actionsVisible(page,dialog){
  const box=await dialog.getByRole('button',{name:'Save observation',exact:true}).boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(page.viewportSize().height);
  expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
}
test.beforeEach(async({context,app})=>{
  await context.route('**/*',route=>new URL(route.request().url()).origin===app.origin?route.continue():route.abort('blockedbyclient'));
});

for(const kind of ['stay','dining'])test(`${kind} capture: minimal idea, explicit comparison defaults and unknown quote basis`,async({page,app},info)=>{
  const data=await seed(app,kind),stay=kind==='stay';
  await open(page,app,kind,data);await page.getByRole('button',{name:stay?'Add lodging option':'Add dining option',exact:true}).click();
  const dialog=page.locator(`#${kind}-option-dialog`);
  await expect(dialog.locator('.research-capture-section[open]')).toHaveCount(0);
  await expect(dialog.locator('.capture-context')).toContainText('2 adults');
  await expect(dialog.locator('.capture-context')).toContainText(data.criteria.currency);
  await expect(dialog.locator('.capture-context')).toContainText(stay?data.criteria.checkIn:data.criteria.date);
  const controls=await dialog.locator('input:not([type=hidden]),textarea,select').evaluateAll(nodes=>nodes.filter(node=>node.checkVisibility()).length);
  expect(controls).toBeLessThanOrEqual(stay?7:6);
  await dialog.getByLabel(stay?'Property name':'Restaurant name',{exact:true}).fill(`Fictional minimal ${kind}`);
  if(stay)await dialog.getByLabel('Configuration name',{exact:true}).fill('Room allocation unconfirmed');
  await dialog.getByLabel('Source label',{exact:true}).fill('Fictional organizer note');
  await dialog.getByLabel('Source URL',{exact:true}).fill('https://example.com/fictional-idea');
  await actionsVisible(page,dialog);await page.screenshot({path:info.outputPath(`${kind}-minimal-phone.png`)});
  await page.setViewportSize({width:320,height:568});await actionsVisible(page,dialog);
  await page.setViewportSize({width:1280,height:900});await actionsVisible(page,dialog);
  await page.screenshot({path:info.outputPath(`${kind}-minimal-desktop.png`)});
  await dialog.getByRole('button',{name:'Save observation',exact:true}).click();await expect(dialog).not.toBeVisible();
  const saved=await call(app,`get_${kind}_decision`,{decisionId:data.decisionId}),o=saved.candidates[0].observations[0].payload;
  expect(o).toMatchObject({quotedAdults:null,currency:data.criteria.currency,charges:[],mandatoryChargesComplete:false,availability:'unknown',source:{kind:'manual',url:'https://example.com/fictional-idea',label:'Fictional organizer note'}});
  if(stay)expect(o).toMatchObject({checkIn:data.criteria.checkIn,checkOut:data.criteria.checkOut,baseTotalMinor:null,units:[],refundableDeposit:null});
  else expect(o).toMatchObject({date:data.criteria.date,meal:data.criteria.meal,price:{amountMinor:null,basis:'unknown',description:''},menu:{summary:'',url:null,observedAt:null},reservation:{url:null,kind:'unknown'},dietary:[{requirement:'Vegetarian',status:'unknown',details:''}]});
  expect(saved.results[0]).toMatchObject({totalMinor:null,eligibility:'conditional'});
  expect(saved.selection).toBeNull();expect(saved.links).toHaveLength(0);
  expect((await app.db.query("select count(*)::int n from mutation_requests where operation=$1",[`save_${kind}_candidate`])).rows[0].n).toBe(1);
  // Capture never alters the existing itinerary or starts a supplier run.
  expect((await app.db.query('select itinerary_revision from trips where id=$1',[app.tripId])).rows[0].itinerary_revision).toBe(2);
  expect((await app.db.query('select count(*)::int n from search_runs')).rows[0].n).toBe(0);
});

for(const kind of ['stay','dining'])test(`${kind} capture: populated sections reopen, collapsed evidence survives failure and save`,async({page,app},info)=>{
  const data=await seed(app,kind),stay=kind==='stay';
  if(stay)data.observation.cancellation.freeUntil='2026-12-25T18:12:37+01:00';
  else {data.observation.menu.observedAt='2026-10-24T12:15:39.456Z';data.observation.reservation.observedAt='2026-10-24T12:19:42+01:00';}
  const first=await call(app,`save_${kind}_candidate`,{decisionId:data.decisionId,expectedRevision:1,observation:data.observation});
  await open(page,app,kind,data);
  const name=stay?data.observation.propertyName:data.observation.restaurantName;
  await page.getByRole('article',{name,exact:true}).getByRole('button',{name:'Add new observation',exact:true}).click();
  const dialog=page.locator(`#${kind}-option-dialog`);
  await expect(dialog.locator('.research-capture-section:not([open])')).toHaveCount(0);
  await expect(dialog.getByLabel(stay?'Unit name':'Menu summary',{exact:true})).toHaveValue(stay?'Twin room':data.observation.menu.summary);
  await page.setViewportSize({width:1280,height:900});await actionsVisible(page,dialog);
  await page.screenshot({path:info.outputPath(`${kind}-populated-desktop.png`)});
  const sections=dialog.locator('.research-capture-section>summary');for(let n=0;n<await sections.count();n++)await sections.nth(n).click();
  await dialog.getByLabel('Source label',{exact:true}).fill('Fictional rechecked source');
  let attempts=0;
  await page.route(`**/itinerary-api/save_${kind}_candidate`,async route=>{attempts++;if(attempts===1)await route.fulfill({status:503,json:{error:'Fictional capture outage'}});else await route.continue();});
  await dialog.getByRole('button',{name:'Save observation',exact:true}).click();
  await expect(dialog.locator('[role=alert]')).toHaveText('Fictional capture outage');await expect(dialog).toBeVisible();
  expect((await call(app,`get_${kind}_decision`,{decisionId:data.decisionId})).candidates[0].observationCount).toBe(1);
  await dialog.getByRole('button',{name:'Save observation',exact:true}).click();await expect(dialog).not.toBeVisible();
  const saved=await call(app,`get_${kind}_decision`,{decisionId:data.decisionId}),candidate=saved.candidates[0],later=candidate.observations[0].payload;
  expect(candidate.id).toBe(first.candidateId);expect(candidate.observationCount).toBe(2);
  expect(candidate.observations.find(o=>o.id===first.observationId).payload).toEqual(data.observation);
  const expected={...data.observation,source:{...data.observation.source,label:'Fictional rechecked source',observedAt:later.source.observedAt}};
  expect(later).toEqual(expected);
  expect(saved.decision.revision).toBe(3);expect(saved.selection).toBeNull();expect(saved.links).toHaveLength(0);
  expect((await app.db.query("select count(*)::int n from mutation_requests where operation=$1",[`save_${kind}_candidate`])).rows[0].n).toBe(2);
});

test('a required field inside a collapsed research section opens for correction without a write',async({page,app})=>{
  const data=await seed(app,'stay');await open(page,app,'stay',data);
  await page.getByRole('button',{name:'Add lodging option',exact:true}).click();const dialog=page.locator('#stay-option-dialog');
  await dialog.getByLabel('Property name',{exact:true}).fill('Fictional incomplete room');
  await dialog.getByLabel('Configuration name',{exact:true}).fill('Proposed room');
  await dialog.getByLabel('Source label',{exact:true}).fill('Fictional note');
  await openDisclosure(page,'stay-capture-layout');await dialog.getByRole('button',{name:'Add room / unit',exact:true}).click();
  await page.locator('#stay-capture-layout>summary').click();await dialog.getByRole('button',{name:'Save observation',exact:true}).click();
  await expect(page.locator('#stay-capture-layout')).toHaveAttribute('open','');await expect(dialog.getByLabel('Unit name',{exact:true})).toBeFocused();
  expect((await call(app,'get_stay_decision',{decisionId:data.decisionId})).candidates).toHaveLength(0);
  expect((await app.db.query("select count(*)::int n from mutation_requests where operation='save_stay_candidate'")).rows[0].n).toBe(0);
});
