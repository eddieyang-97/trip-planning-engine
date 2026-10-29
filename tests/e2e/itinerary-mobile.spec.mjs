import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Core} from '../../dist/src/core.js';
import {flaineCriteria} from '../../dist/src/acceptance.js';
import {stayCriteria,stayObservation} from '../../dist/tests/fixtures/stays.js';
import {diningCriteria,diningObservation} from '../../dist/tests/fixtures/dining.js';
import {test,expect,privateNote,privateResearch,originalTitle} from './fixture.mjs';
import {openDisclosure} from './navigation.mjs';

async function openTrip(page,app,tripId=app.tripId,token=app.ownerToken,query=''){
  await page.goto(`${app.origin}/itinerary?trip=${tripId}${query}`);
  await page.getByLabel('Local development token').fill(token);
  await page.getByRole('button',{name:'Open local trips',exact:true}).click();
  await expect(page.locator('#trip-view')).toBeVisible();
  await expect(page.locator('#refresh')).toBeEnabled();
}
function fixtureCall(app){const core=new Core(app.db,false,false);return (name,args,user=app.owner)=>core.callFromWeb(name,name==='get_itinerary'?args:{idempotencyKey:randomUUID(),...args},user);}
async function seedResearchTrip(app){
  const call=fixtureCall(app),name='A fictional mountain weekend with friends, scenic walks, a shared chalet and plenty of time for long dinners together';
  const {tripId}=await call('create_trip',{name,destination:'Fictional Alpine village, northern Italy',startDate:'2027-01-01',endDate:'2027-01-02',adults:2});
  const base=(await call('get_itinerary',{tripId:app.tripId})).items[0].payload;
  await call('add_itinerary_item',{tripId,expectedRevision:1,item:{...base,title:'Fictional weekend chalet'}});
  await call('add_itinerary_item',{tripId,expectedRevision:2,item:{...base,type:'activity',title:'A walk through the fictional village',startDate:'2027-01-02',startTime:'10:00',endDate:'2027-01-02',endTime:'11:00',timeZone:'Europe/Rome',endTimeZone:'Europe/Rome',status:'tentative',bookingNote:''}});
  const invite=await call('create_itinerary_invite',{tripId,label:'Fictional friend',role:'viewer'});
  await call('accept_itinerary_invite',{token:invite.token,displayName:'Fictional friend'},app.viewer);
  const stays=await call('create_stay_decision',{tripId,title:'Weekend stay choices',criteria:{...stayCriteria(2),checkIn:'2027-01-01',checkOut:'2027-01-02'}});
  await call('save_stay_candidate',{decisionId:stays.decisionId,expectedRevision:1,observation:{...stayObservation(2),checkIn:'2027-01-01',checkOut:'2027-01-02'}});
  const dining=await call('create_dining_decision',{tripId,title:'Weekend dinner choices',criteria:{...diningCriteria(2),date:'2027-01-01'}});
  await call('save_dining_candidate',{decisionId:dining.decisionId,expectedRevision:1,observation:{...diningObservation(2),date:'2027-01-01'}});
  await new Core(app.db,false,false).call('create_decision',{tripId,title:'Fictional flights',criteria:{...flaineCriteria,outbound:'2027-01-01',inbound:'2027-01-02',adults:2},idempotencyKey:randomUUID()},{userId:app.owner,clientId:'fixture-seed-only'});
  return {tripId,name,stays,dining,call};
}
async function snapshot(app){return {
  trips:(await app.db.query('select * from trips order by id')).rows,
  items:(await app.db.query('select * from itinerary_items order by id')).rows,
  history:(await app.db.query('select * from itinerary_events order by id')).rows,
  writes:(await app.db.query('select * from mutation_requests order by owner_id,operation,key')).rows,
};}

test.beforeEach(async({context,app})=>{
  await context.route('**/*',route=>new URL(route.request().url()).origin===app.origin?route.continue():route.abort('blockedbyclient'));
});

test('phone itinerary first: long title, populated research, compact members and reachable actions',async({page,app},testInfo)=>{
  const data=await seedResearchTrip(app),before=await snapshot(app),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await openTrip(page,app,data.tripId);
  await expect(page.locator('#trip-title')).toHaveText(data.name);
  await expect(page.locator('#trip-members summary')).toContainText('2 trip members');
  await expect(page.locator('#research-summary')).toHaveText('Flights · Stays · Dining');
  await expect(page.locator('#trip-switcher')).not.toHaveAttribute('open');
  await expect(page.locator('#trip-members details')).not.toHaveAttribute('open');
  await expect(page.locator('#research-panel')).not.toHaveAttribute('open');
  await expect(page.locator('#plan-more')).not.toHaveAttribute('open');
  const first=page.locator('#overview-day-2027-01-01');
  const top=await first.evaluate(node=>node.getBoundingClientRect().top+scrollY);
  await testInfo.attach('phone-first-day-position',{body:JSON.stringify({viewport:page.viewportSize(),firstDayTop:top}),contentType:'application/json'});
  expect(top).toBeLessThan(760);
  await page.screenshot({path:testInfo.outputPath('itinerary-phone.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('#add-item').click();await expect(page.locator('#item-dialog')).toBeVisible();
  await page.getByRole('button',{name:'Close item editor',exact:true}).click();
  await page.locator('#share-trip').click();await expect(page.locator('#share-dialog')).toBeVisible();
  await page.locator('#share-dialog [data-close]').click();
  await openDisclosure(page,'plan-more');await expect(page.locator('#export-calendar')).toBeVisible();
  await page.locator('#export-calendar').click();await expect(page.locator('#calendar-dialog')).toBeVisible();
  await page.locator('#calendar-dialog [data-close]').first().click();
  await expect(page.locator('#plan-more > summary')).toBeFocused();
  await openDisclosure(page,'plan-more');await page.keyboard.press('Escape');
  await expect(page.locator('#plan-more')).not.toHaveAttribute('open');
  await openDisclosure(page,'research-panel');
  await expect(page.locator('#stay-research summary').first()).toContainText('Weekend stay choices · 1 option');
  await expect(page.locator('#dining-research summary').first()).toContainText('Weekend dinner choices · 1 option');
  await page.locator('#research-panel > summary').click();
  await page.locator('#trip-members summary').click();
  await expect(page.locator('#trip-members details')).toHaveAttribute('open','');
  await openDisclosure(page,'plan-more');await page.locator('#refresh').click();
  await expect(page.locator('#plan-more')).not.toHaveAttribute('open');
  await expect(page.locator('#trip-members .member-roster')).toBeVisible();
  await expect(page.locator('#trip-members details')).toHaveAttribute('open','');
  await page.locator('#trip-members summary').click();
  await page.locator('#view-details').click();
  await page.locator('#day-nav a[data-day="2027-01-02"]').click();
  await expect(page.locator('#day-nav a[aria-current]')).toHaveAttribute('data-day','2027-01-02');
  expect(await page.locator('#plan-navigation').evaluate(node=>Math.abs(node.getBoundingClientRect().top))).toBeLessThan(2);
  await page.setViewportSize({width:320,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.locator('#add-item')).toBeVisible();await expect(page.locator('#share-trip')).toBeVisible();
  await page.setViewportSize({width:768,height:900});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.setViewportSize({width:1280,height:900});
  await expect(page.locator('#trip-switcher')).toHaveAttribute('open','');
  await expect(page.locator('#refresh')).toBeVisible();
  await expect(page.locator('#research-panel')).toHaveAttribute('open','');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:testInfo.outputPath('itinerary-desktop.png'),fullPage:true});
  assert.deepEqual(await snapshot(app),before,'layout, navigation and opening actions must not change durable trip state');
  expect(errors).toEqual([]);
});

test('research stays discoverable on a first trip and opens directly from comparison links',async({page,app})=>{
  const data=await seedResearchTrip(app);
  for(const [parameter,id,root] of [['stay',data.stays.decisionId,'stay-research'],['dining',data.dining.decisionId,'dining-research']]){
    await openTrip(page,app,data.tripId,app.ownerToken,`&${parameter}=${id}`);
    await expect(page.locator('#research-panel')).toHaveAttribute('open','');
    await expect(page.locator(`#${root}>details`)).toHaveAttribute('open','');
    await expect(page.locator(`#${root} article`).first()).toBeVisible();
  }
  const empty=await data.call('create_trip',{name:'First fictional trip',destination:'Undecided plans',startDate:'2027-01-01',endDate:'2027-01-02',adults:2});
  await openTrip(page,app,empty.tripId);
  await expect(page.locator('#plan-empty')).toContainText('Add your first item');
  await expect(page.locator('#research-summary')).toHaveText('Add options');
  await expect(page.locator('#stay-research')).toBeHidden();await expect(page.locator('#dining-research')).toBeHidden();
  await openDisclosure(page,'research-panel');await openDisclosure(page,'add-research');
  await page.locator('#add-stay-research').click();await expect(page.locator('#stay-decision-dialog')).toBeVisible();
  await page.goto(`${app.origin}/itinerary?demo=1`);
  await expect(page.locator('#overview')).toBeVisible();
  await expect(page.locator('#trip-switcher')).toBeHidden();
  await page.setViewportSize({width:1280,height:900});
  expect(await page.locator('.trip-content').evaluate(node=>node.getBoundingClientRect().width)).toBeGreaterThan(1000);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('research load errors open the summary instead of disappearing behind it',async({page,app})=>{
  await page.route('**/itinerary-api/list_stay_decisions',route=>route.fulfill({status:503,json:{error:'Fictional lodging outage'}}));
  await openTrip(page,app);
  await expect(page.locator('#research-panel')).toHaveAttribute('open','');
  await expect(page.locator('#stay-error')).toBeVisible();
  await expect(page.locator('#stay-error')).toHaveText('Fictional lodging outage');
  await expect(page.locator('#overview')).toContainText(originalTitle);
});

test('an account with no trips can create its first itinerary through the phone workspace',async({page,app})=>{
  const call=fixtureCall(app);
  await call('revoke_itinerary_access',{tripId:app.tripId,inviteId:app.inviteId});
  await page.goto(`${app.origin}/itinerary`);
  await page.getByLabel('Local development token').fill(app.viewerToken);
  await page.getByRole('button',{name:'Open local trips',exact:true}).click();
  await expect(page.locator('#empty-trips')).toBeVisible();
  await page.locator('#first-trip').click();
  const dialog=page.locator('#trip-dialog');
  await dialog.getByLabel('Trip name',{exact:true}).fill('My first fictional trip');
  await dialog.getByLabel('Destination',{exact:true}).fill('Fictional coast');
  await dialog.getByLabel('Start date',{exact:true}).fill('2027-03-01');
  await dialog.getByLabel('End date',{exact:true}).fill('2027-03-02');
  await dialog.getByRole('button',{name:'Create trip',exact:true}).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('#trip-title')).toHaveText('My first fictional trip');
  await expect(page.locator('#plan-empty')).toContainText('Add your first item');
  await expect(page.locator('#add-item')).toBeVisible();await expect(page.locator('#research-summary')).toHaveText('Add options');
  const id=new URL(page.url()).searchParams.get('trip');
  const saved=await call('get_itinerary',{tripId:id},app.viewer);
  expect(saved.items).toEqual([]);expect(saved.history).toEqual([]);
  expect((await app.db.query("select count(*)::int n from mutation_requests where owner_id=$1 and operation='create_trip'",[app.viewer])).rows[0].n).toBe(1);
});

test('compact shared itineraries retain viewer/editor/anonymous permissions',async({page,app},testInfo)=>{
  const call=fixtureCall(app);
  await openTrip(page,app,app.tripId,app.viewerToken);
  await expect(page.locator('#add-item')).toBeHidden();await expect(page.locator('#share-trip')).toBeHidden();
  await expect(page.locator('#research-panel')).toBeHidden();await expect(page.locator('#trip-members summary')).toContainText('2 trip members');
  await expect(page.locator('body')).not.toContainText(privateNote);await expect(page.locator('body')).not.toContainText(privateResearch);
  await page.screenshot({path:testInfo.outputPath('itinerary-viewer-phone.png'),fullPage:true});
  await call('revoke_itinerary_access',{tripId:app.tripId,inviteId:app.inviteId});
  const editor=await call('create_itinerary_invite',{tripId:app.tripId,label:'Fictional editor',role:'editor'});
  await call('accept_itinerary_invite',{token:editor.token,displayName:'Fictional editor'},app.viewer);
  await openTrip(page,app,app.tripId,app.viewerToken);
  await expect(page.locator('#add-item')).toBeVisible();await expect(page.locator('#share-trip')).toBeHidden();
  await expect(page.locator('#research-panel')).toBeHidden();
  const before=await snapshot(app),plan=await call('get_itinerary',{tripId:app.tripId});
  await call('remove_itinerary_item',{tripId:app.tripId,itemId:app.itemId,expectedRevision:plan.revision});
  await openDisclosure(page,'plan-more');await page.locator('#refresh').click();
  await expect(page.locator('#plan-empty')).toHaveText('Add your first item to start building the shared plan.');
  // Only the explicit fixture removal changes history, never responsive layout.
  expect((await snapshot(app)).history).toHaveLength(before.history.length+1);
  await openDisclosure(page,'plan-more');await openDisclosure(page,'trip-actions');
  await expect(page.locator('#leave-trip')).toBeVisible();await expect(page.locator('#delete-trip')).toBeHidden();
  const link=await call('create_itinerary_view_link',{tripId:app.tripId,label:'Fictional mobile view link'});
  await page.goto(`${app.origin}/itinerary#view=${link.token}`);
  await expect(page.locator('#trip-view')).toBeVisible();
  await expect(page.locator('#trip-switcher')).toBeHidden();await expect(page.locator('#trip-members')).toBeHidden();
  await expect(page.locator('#research-panel')).toBeHidden();await expect(page.locator('#add-item')).toBeHidden();
  await expect(page.locator('body')).not.toContainText(privateNote);await expect(page.locator('body')).not.toContainText('Fictional editor');
});
