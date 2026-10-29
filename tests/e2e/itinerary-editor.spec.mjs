import {randomUUID} from 'node:crypto';
import {Core} from '../../dist/src/core.js';
import {test,expect,privateNote,originalTitle} from './fixture.mjs';
import {openDisclosure} from './navigation.mjs';

const call=(app,name,args,user=app.owner)=>new Core(app.db,false,false).callFromWeb(name,name==='get_itinerary'?args:{idempotencyKey:randomUUID(),...args},user);
const plan=app=>call(app,'get_itinerary',{tripId:app.tripId});
async function openTrip(page,app,token=app.ownerToken){
  await page.goto(`${app.origin}/itinerary?trip=${app.tripId}`);
  await page.getByLabel('Local development token').fill(token);
  await page.getByRole('button',{name:'Open local trips',exact:true}).click();
  await expect(page.locator('#refresh')).toBeEnabled();
}
const save=page=>page.locator('#item-dialog').getByRole('button',{name:'Save to itinerary',exact:true}).click();
const close=page=>page.getByRole('button',{name:'Close item editor',exact:true}).click();
const field=(page,name)=>page.locator(`#item-form [name="${name}"]`);
async function visibleSave(page){
  const box=await page.locator('#item-form button[type=submit]').boundingBox();
  expect(box).not.toBeNull();expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(page.viewportSize().height);
  expect(await page.locator('#item-dialog').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
}
test.beforeEach(async({context,app})=>{
  await context.route('**/*',route=>new URL(route.request().url()).origin===app.origin?route.continue():route.abort('blockedbyclient'));
});

test('contextual Add saves the chosen day, keeps unknowns empty and supports unscheduled ideas',async({page,app},info)=>{
  await openTrip(page,app);
  await page.locator('#overview-day-2027-01-02 .day-add').click();
  await expect(field(page,'startDate')).toHaveValue('2027-01-02');
  for(const id of ['item-schedule','item-notes','item-booking','map-place-editor'])await expect(page.locator(`#${id}`)).not.toHaveAttribute('open');
  await expect(page.locator('#research-draft')).toBeHidden();
  await visibleSave(page);
  await page.screenshot({path:info.outputPath('simple-editor-phone.png')});
  await field(page,'title').fill('Fictional village walk');await field(page,'startTime').fill('10:30');
  await save(page);await expect(page.locator('#item-dialog')).not.toBeVisible();
  let saved=await plan(app),walk=saved.items.find(row=>row.payload.title==='Fictional village walk');
  expect(walk.payload).toEqual({type:'activity',title:'Fictional village walk',startDate:'2027-01-02',startTime:'10:30',endDate:null,endTime:null,timeZone:null,endTimeZone:null,location:'',url:null,mapLocations:[],notes:'',openQuestion:'',status:'tentative',bookingNote:''});
  await page.locator('#day-nav a[data-day="2027-01-02"]').click();await page.locator('#add-item').click();
  await expect(field(page,'startDate')).toHaveValue('2027-01-02');await close(page);
  await page.locator('#overview-day-unscheduled .day-add').click();
  await expect(field(page,'startDate')).toHaveValue('');await expect(field(page,'startTime')).toHaveValue('');
  await field(page,'title').fill('Fictional dinner idea');await save(page);await expect(page.locator('#item-dialog')).not.toBeVisible();
  saved=await plan(app);expect(saved.items.find(row=>row.payload.title==='Fictional dinner idea').payload.startDate).toBeNull();
  await page.locator('#view-details').click();await page.locator('#day-2027-01-01 .day-add').click();
  await expect(field(page,'startDate')).toHaveValue('2027-01-01');await field(page,'startDate').fill('');
  await field(page,'title').fill('Another unscheduled idea');await save(page);await expect(page.locator('#item-dialog')).not.toBeVisible();
  saved=await plan(app);expect(saved.items.find(row=>row.payload.title==='Another unscheduled idea').payload.startDate).toBeNull();
  expect(saved.revision).toBe(5);expect(saved.history).toHaveLength(4);
  expect((await app.db.query("select count(*)::int n from mutation_requests where trip_id=$1 and operation='add_itinerary_item'",[app.tripId])).rows[0].n).toBe(4);
});

test('direct overview Edit retains original dates and all collapsed schedule, pin, note and booking values',async({page,app},info)=>{
  const before=await plan(app),base=before.items[0].payload;
  const flight={...base,type:'flight',title:'Fictional westbound flight',startDate:'2027-01-01',startTime:'14:00',endDate:'2027-01-01',endTime:'11:00',timeZone:'Europe/London',endTimeZone:'America/New_York',url:'https://example.com/fictional-flight',notes:'Fictional meeting point',openQuestion:'Equipment fee unknown',mapLocations:[{label:'Fictional departure',latitude:51.5,longitude:-0.1},{label:'Fictional arrival',latitude:40.7,longitude:-74}]};
  const added=await call(app,'add_itinerary_item',{tripId:app.tripId,expectedRevision:before.revision,item:flight});
  await openTrip(page,app);
  // The checkout-day reference edits the original stay, not the displayed day.
  await page.locator('#overview-day-2027-01-02').getByRole('button',{name:`Edit ${originalTitle}`,exact:true}).click();
  await expect(field(page,'startDate')).toHaveValue('2027-01-01');await close(page);
  await page.getByRole('button',{name:`Edit ${flight.title}`,exact:true}).click();
  await expect(page.locator('#view-overview')).toHaveAttribute('aria-pressed','true');
  for(const id of ['item-schedule','item-notes','item-booking','map-place-editor'])await expect(page.locator(`#${id}`)).toHaveAttribute('open','');
  await expect(field(page,'timeZone')).toHaveValue('Europe/London');await expect(field(page,'endTimeZone')).toHaveValue('America/New_York');
  await visibleSave(page);
  await page.setViewportSize({width:1280,height:900});await visibleSave(page);
  await page.screenshot({path:info.outputPath('populated-editor-desktop.png')});
  for(const id of ['item-schedule','item-notes','item-booking','map-place-editor'])await page.locator(`#${id}>summary`).click();
  await field(page,'title').fill('Fictional flight, revised title');await save(page);await expect(page.locator('#item-dialog')).not.toBeVisible();
  const saved=await plan(app);expect(saved.items.find(row=>row.id===added.itemId).payload).toEqual({...flight,title:'Fictional flight, revised title'});
  expect(saved.revision).toBe(4);expect(saved.history).toHaveLength(3);
  expect(saved.history[0].action).toBe('edited');expect(saved.history[0].actor_id).toBe(app.owner);
  expect((await app.db.query("select count(*)::int n from mutation_requests where trip_id=$1 and operation='update_itinerary_item'",[app.tripId])).rows[0].n).toBe(1);
});

test('collapsed validation is reachable and copying a timezone is explicit',async({page,app})=>{
  await openTrip(page,app);await page.locator('#overview-day-2027-01-01 .day-add').click();
  await field(page,'title').fill('Fictional draft');
  await openDisclosure(page,'item-notes');await field(page,'url').fill('invalid link');
  await page.locator('#item-notes>summary').click();await save(page);
  await expect(page.locator('#item-notes')).toHaveAttribute('open','');await expect(field(page,'url')).toBeFocused();
  await field(page,'url').fill('');await openDisclosure(page,'item-schedule');
  await page.locator('#start-zone').fill('not a timezone');await page.locator('#item-schedule>summary').click();await save(page);
  await expect(page.locator('#item-schedule')).toHaveAttribute('open','');await expect(page.locator('#item-error')).toContainText('Choose a start timezone');
  await page.locator('#start-zone').fill('Europe/London');await page.locator('#same-item-zone').click();
  await expect(field(page,'timeZone')).toHaveValue('Europe/London');await expect(field(page,'endTimeZone')).toHaveValue('Europe/London');
  await page.locator('#start-zone').fill('Europe/Rome');await page.locator('#start-zone').press('Tab');
  await expect(field(page,'timeZone')).toHaveValue('Europe/Rome');await expect(field(page,'endTimeZone')).toHaveValue('Europe/London');
  await page.locator('#end-zone').press('Escape');
  await page.locator('#same-item-zone').click();await expect(field(page,'endTimeZone')).toHaveValue('Europe/Rome');
  await expect(field(page,'startDate')).toHaveValue('2027-01-01');await expect(field(page,'endDate')).toHaveValue('');
  await openDisclosure(page,'item-booking');await field(page,'status').selectOption('user_reported_booked');
  await page.locator('#item-booking>summary').click();await save(page);
  await expect(page.locator('#item-booking')).toHaveAttribute('open','');await expect(field(page,'bookingNote')).toBeFocused();
  await close(page);expect((await plan(app)).revision).toBe(2);
  await page.setViewportSize({width:320,height:568});await page.locator('#add-item').click();
  await visibleSave(page);await openDisclosure(page,'item-schedule');await visibleSave(page);await close(page);
});

test('editor can use contextual actions without changing private booking facts; viewers have no actions',async({page,app})=>{
  await openTrip(page,app,app.viewerToken);
  await expect(page.locator('#overview .day-add,#overview .overview-edit')).toHaveCount(0);
  await page.locator('#view-details').click();await expect(page.locator('#timeline .day-add')).toHaveCount(0);
  await call(app,'revoke_itinerary_access',{tripId:app.tripId,inviteId:app.inviteId});
  const invite=await call(app,'create_itinerary_invite',{tripId:app.tripId,label:'Fictional editor',role:'editor'});
  await call(app,'accept_itinerary_invite',{token:invite.token,displayName:'Fictional editor'},app.viewer);
  await openTrip(page,app,app.viewerToken);
  await page.locator('#overview-day-2027-01-02').getByRole('button',{name:`Edit ${originalTitle}`,exact:true}).click();
  await expect(page.locator('#item-booking')).toBeHidden();await expect(field(page,'status')).toBeDisabled();await expect(field(page,'bookingNote')).toBeDisabled();
  await expect(page.locator('body')).not.toContainText(privateNote);await expect(field(page,'startDate')).toHaveValue('2027-01-01');
  await field(page,'title').fill('Fictional stay updated by friend');await page.locator('#item-schedule>summary').click();await page.locator('#item-notes>summary').click();
  await save(page);await expect(page.locator('#item-dialog')).not.toBeVisible();
  let saved=await plan(app);expect(saved.items[0].payload).toMatchObject({title:'Fictional stay updated by friend',startDate:'2027-01-01',endDate:'2027-01-02',status:'user_reported_booked',bookingNote:privateNote,notes:'Arrival time to confirm.'});
  expect(saved.history[0].actor_id).toBe(app.viewer);
  await page.locator('#overview-day-2027-01-02 .day-add').click();await field(page,'title').fill('Friend’s fictional walk');await save(page);await expect(page.locator('#item-dialog')).not.toBeVisible();
  saved=await plan(app);expect(saved.items[1].payload).toMatchObject({startDate:'2027-01-02',status:'tentative',bookingNote:''});
  expect(saved.revision).toBe(4);expect(saved.history).toHaveLength(3);
  const link=await call(app,'create_itinerary_view_link',{tripId:app.tripId,label:'Fictional read-only link'});
  await page.goto(`${app.origin}/itinerary#view=${link.token}`);await expect(page.locator('#trip-view')).toBeVisible();
  await expect(page.locator('#overview .day-add,#overview .overview-edit')).toHaveCount(0);await expect(page.locator('body')).not.toContainText(privateNote);
});
