import {test,expect} from './fixture.mjs';
import {openDisclosure} from './navigation.mjs';

async function signIn(page,app,token=app.ownerToken){
  await page.goto(`${app.origin}/itinerary?trip=${app.tripId}&view=details`);
  await page.locator('#local-token').fill(token);
  await page.locator('#local-login button').click();
  await expect(page.locator('#trip-title')).toHaveText('Sharing browser fixture — fictional');
}

async function openEditor(page,width){
  await openDisclosure(page,width>700?'trip-actions':'plan-more');
  await page.getByRole('button',{name:'Edit trip details'}).click();
  return page.getByRole('dialog',{name:'Edit trip details'});
}

test('older itinerary markup works with the trip details script',async({page,context,app})=>{
  await context.route('**/*',route=>new URL(route.request().url()).origin===app.origin?route.continue():route.abort());
  await page.route(url=>url.pathname==='/itinerary',async route=>{
    const response=await route.fetch();
    const body=(await response.text()).replace(/<button id="edit-trip-details"[^>]*>.*?<\/button>/,'')
      .replace(/<dialog id="trip-details-dialog"[\s\S]*?<\/dialog>/,'');
    await route.fulfill({response,body});
  },{times:1});
  await signIn(page,app);
  await expect(page.locator('#edit-trip-details,#trip-details-dialog')).toHaveCount(0);
});

test('archived trip details can be updated in place on a phone',async({page,context,app})=>{
  await page.setViewportSize({width:390,height:844});
  await context.route('**/*',route=>new URL(route.request().url()).origin===app.origin?route.continue():route.abort());
  const plan=()=>app.core.callFromWeb('get_itinerary',{tripId:app.tripId},app.owner);
  await app.call('archive_trip',{tripId:app.tripId,expectedRevision:(await plan()).trip.lifecycle_revision});
  await signIn(page,app);
  const url=page.url(),before=await plan();
  let dialog=await openEditor(page,390);
  await expect(dialog.getByLabel('Trip name')).toHaveValue(before.trip.payload.name);
  await dialog.getByLabel('Trip name').fill('Discard this draft');
  await dialog.getByRole('button',{name:'Cancel'}).click();
  expect((await plan()).trip).toEqual(before.trip);

  dialog=await openEditor(page,390);
  await dialog.getByLabel('Trip name').fill('  Updated mountain trip  ');
  await dialog.getByLabel('Display destination').fill('  Alpine valley  ');
  await dialog.getByRole('button',{name:'Save changes'}).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#trip-title')).toHaveText('Updated mountain trip');
  await expect(page.locator('#trip-destination')).toHaveText('Alpine valley');
  await expect(page.locator('#trip-archived')).toBeVisible();
  await expect(page).toHaveURL(url);
  await openDisclosure(page,'trip-switcher');
  await expect(page.locator('.trip-choice.active')).toContainText('Updated mountain trip');
  await expect(page.locator('.trip-choice.active')).toContainText('Alpine valley');
  const after=await plan();
  expect(after.items).toEqual(before.items);
  expect(after.trip.archived_at).toEqual(before.trip.archived_at);
  expect(after.trip.lifecycle_revision).toBe(before.trip.lifecycle_revision+1);

  dialog=await openEditor(page,390);
  await expect(dialog.getByLabel('Trip name')).toHaveValue('Updated mountain trip');
  await expect(dialog.getByLabel('Display destination')).toHaveValue('Alpine valley');
  await dialog.getByRole('button',{name:'Save changes'}).click();
  await expect(dialog).toBeHidden();
  expect((await plan()).trip.lifecycle_revision).toBe(after.trip.lifecycle_revision);
});

test('trip details reject a stale desktop draft and retry a lost response without replaying the edit',async({page,context,app})=>{
  await page.setViewportSize({width:1280,height:900});
  await context.route('**/*',route=>new URL(route.request().url()).origin===app.origin?route.continue():route.abort());
  await signIn(page,app);
  const plan=()=>app.core.callFromWeb('get_itinerary',{tripId:app.tripId},app.owner);
  const change=async(name,destination)=>
    app.call('update_trip',{tripId:app.tripId,expectedRevision:(await plan()).trip.lifecycle_revision,name,destination});
  const viewer=await context.newPage();
  await signIn(viewer,app,app.viewerToken);
  await expect(viewer.locator('#edit-trip-details')).toBeHidden();
  await viewer.close();

  await change('Name from another session','Original display destination');
  // Discussion advances this tab's lifecycle clock without reloading its labels.
  await page.locator('#trip-discussion').click();
  await page.locator('#comment-body').fill('Advance the lifecycle revision in this tab.');
  await page.locator('#comment-form button[type="submit"]').click();
  await expect(page.getByText('Advance the lifecycle revision in this tab.',{exact:true})).toBeVisible();
  await page.locator('#discussion-close').click();
  const dialog=await openEditor(page,1280);
  const name=dialog.getByLabel('Trip name'),destination=dialog.getByLabel('Display destination');
  const save=dialog.getByRole('button',{name:'Save changes'});
  await destination.fill('Draft destination');
  await save.click();
  await expect(dialog.getByRole('alert')).toContainText('Trip details may have changed');
  await expect(save).toBeDisabled();
  expect((await plan()).trip.payload.name).toBe('Name from another session');
  await dialog.getByRole('button',{name:'Review current details'}).click();
  await expect(dialog.locator('#trip-details-current-name')).toHaveText('Name from another session');
  await expect(destination).toHaveValue('Draft destination');
  await name.fill('Name from another session');

  let originalRequest;
  await page.route('**/itinerary-api/update_trip',async route=>{
    originalRequest=route.request().postDataJSON();
    const response=await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort();
  },{times:1});
  await save.click();
  const retry=dialog.getByRole('button',{name:'Retry save'});
  await expect(retry).toBeVisible();
  await expect(destination).toBeDisabled();
  expect((await plan()).trip.payload.destination).toBe('Draft destination');
  const newer=await change('Latest name','Latest destination');
  const retried=page.waitForRequest(request=>request.url().endsWith('/itinerary-api/update_trip'));
  await retry.click();
  expect((await retried).postDataJSON()).toEqual(originalRequest);
  await expect(dialog).toBeHidden();
  await expect(page.locator('#trip-title')).toHaveText('Latest name');
  await expect(page.locator('#trip-destination')).toHaveText('Latest destination');
  expect((await plan()).trip.lifecycle_revision).toBe(newer.lifecycleRevision);
});
