import {test,expect} from './fixture.mjs';
import {openDisclosure} from './navigation.mjs';

test('a signed-in friend can find their own return among ten travelers on a phone',async({page,context,app},testInfo)=>{
  await context.route('**/*',route=>new URL(route.request().url()).origin===app.origin?route.continue():route.abort('blockedbyclient'));
  const {tripId}=await app.call('create_trip',{name:'Fictional forest weekend',destination:'Fictional holiday village',startDate:'2027-01-08',endDate:'2027-01-11',adults:10});
  const invite=await app.call('create_itinerary_invite',{tripId,label:'Fixture friend',role:'viewer'});
  await app.call('accept_itinerary_invite',{token:invite.token,displayName:'Fixture friend'},app.viewer);
  const view=await app.call('create_itinerary_view_link',{tripId,label:'Fixture link'});
  let revision=1;
  const people=[];
  for(const name of ['Alex','Casey','Drew','Emery','Finn','Harper','Indy','Jess','Kai']){
    const result=await app.call('manage_trip_traveler',{tripId,expectedRevision:revision,change:{action:'add',name}});
    revision=result.revision;people.push(result.travelerId);
  }
  const item={type:'transfer',startTime:null,endDate:null,endTime:null,timeZone:null,endTimeZone:null,
    location:'',url:null,notes:'',openQuestion:'',status:'tentative',bookingNote:''};
  for(const [title,startDate,travelerIds] of [
    ['Arrival together','2027-01-08',undefined],
    ['Sunday return','2027-01-10',people.slice(0,5)],
    ['Monday return','2027-01-11',people.slice(5)],
  ]){
    const saved=await app.call('add_itinerary_item',{tripId,expectedRevision:revision,item:{...item,title,startDate,travelerIds}});
    revision=saved.revision;
  }
  async function signIn(target,token){
    await target.goto(`${app.origin}/itinerary?trip=${tripId}`);
    await target.getByLabel('Local development token').fill(token);
    await target.getByRole('button',{name:'Open local trips',exact:true}).click();
    await expect(target.getByRole('heading',{name:'Fictional forest weekend'})).toBeVisible();
  }
  await signIn(page,app.ownerToken);
  await openDisclosure(page,'plan-more');
  await openDisclosure(page,'trip-actions');
  await page.getByRole('button',{name:'Manage travelers'}).click();
  await page.getByLabel('Traveler name').fill('Alex');
  await page.getByRole('button',{name:'Add traveler',exact:true}).click();
  await expect(page.locator('#traveler-list li')).toHaveCount(10);
  await expect(page.getByRole('button',{name:'Rename Alex (10)',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close travelers'}).click();
  await page.getByRole('button',{name:'Edit Monday return',exact:true}).click();
  await page.getByRole('checkbox',{name:'Alex (10)',exact:true}).check();
  await page.getByRole('button',{name:'Save to itinerary',exact:true}).click();
  await expect(page.locator('#item-dialog')).toBeHidden();
  const plan=await app.core.callFromWeb('get_itinerary',{tripId},app.owner);
  const alices=plan.travelers.filter(row=>row.name==='Alex');
  expect(alices).toHaveLength(2);
  expect(plan.items.find(row=>row.payload.title==='Monday return').payload.travelerIds).toContain(alices[1].id);
  expect(plan.items.find(row=>row.payload.title==='Sunday return').payload.travelerIds).not.toContain(alices[1].id);
  expect(plan.revision).toBe(revision+2);

  const viewer=await context.newPage();
  await signIn(viewer,app.viewerToken);
  const filter=viewer.getByLabel('Show itinerary for');
  await expect(filter.locator('option')).toHaveCount(11);
  await filter.selectOption({label:'Alex (10)'});
  await expect(viewer.locator('#overview')).toContainText('Monday return');
  await expect(viewer.locator('#overview')).toContainText('Arrival together');
  await expect(viewer.locator('#overview')).not.toContainText('Sunday return');
  await viewer.getByRole('button',{name:'Details',exact:true}).click();
  await expect(viewer.locator('#timeline')).toContainText('Monday return');
  await expect(viewer.locator('#timeline')).not.toContainText('Sunday return');
  await filter.selectOption({label:'Alex (1)'});
  await expect(viewer.locator('#timeline')).toContainText('Sunday return');
  await expect(viewer.locator('#timeline')).not.toContainText('Monday return');
  await expect(viewer.locator('#manage-travelers')).toBeHidden();
  expect(await viewer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await viewer.screenshot({path:testInfo.outputPath('traveler-phone.png'),fullPage:true});
  await page.setViewportSize({width:1280,height:900});
  await page.getByLabel('Show itinerary for').selectOption({label:'Alex (10)'});
  await expect(page.locator('#overview')).toContainText('Monday return');
  await page.screenshot({path:testInfo.outputPath('traveler-desktop.png'),fullPage:true});

  const anonymous=await context.newPage();
  await anonymous.goto(`${app.origin}/itinerary#view=${view.token}`);
  await expect(anonymous.locator('#shared-view-banner')).toBeVisible();
  await expect(anonymous.locator('#overview')).toContainText('Monday return');
  await expect(anonymous.getByLabel('Show itinerary for')).toBeHidden();
  await expect(anonymous.locator('#overview')).not.toContainText('Alex');
  expect((await app.core.callFromWeb('get_itinerary',{tripId},app.owner)).revision).toBe(plan.revision);
});
