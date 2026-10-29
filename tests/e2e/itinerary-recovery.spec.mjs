import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDisclosure} from './navigation.mjs';
import {test,expect,originalTitle,privateNote,privateResearch} from './fixture.mjs';

async function signIn(page,app,token=app.ownerToken,tripId=app.tripId){
  await page.goto(`${app.origin}/itinerary?trip=${tripId}&view=details`);
  await page.getByLabel('Local development token').fill(token);
  await page.getByRole('button',{name:'Open local trips',exact:true}).click();
}
async function persisted(app){
  const result={};
  for(const table of ['trips','itinerary_items','itinerary_events','mutation_requests','search_runs'])
    result[table]=(await app.db.query(`select * from ${table} order by ${table==='mutation_requests'?'owner_id,operation,key':'id'}`)).rows;
  return result;
}

test('initial trip-list failure can retry without another sign-in',async({page,context,app})=>{
  await context.route('**/*',route=>new URL(route.request().url()).origin===app.origin?route.continue():route.abort());
  const before=await persisted(app);
  let fail=true;
  await page.route('**/itinerary-api/list_trips',route=>fail?route.fulfill({status:503,json:{error:'Temporary failure'}}):route.continue());
  await signIn(page,app);
  await expect(page.locator('#plan-recovery-title')).toHaveText('Unable to load your trips');
  await expect(page.locator('#retry-plan')).toBeEnabled();
  fail=false;
  await page.locator('#retry-plan').click();
  await expect(page.locator('#trip-title')).toHaveText('Sharing browser fixture — fictional');
  await expect(page.locator('#plan-recovery')).toBeHidden();
  assert.deepEqual(await persisted(app),before);
});

for(const failure of ['server','network']){
  test(`archived-trip deep link preserves its target after a ${failure} probe failure`,async({page,context,app})=>{
    await context.route('**/*',route=>new URL(route.request().url()).origin===app.origin?route.continue():route.abort());
    const headers={Origin:app.origin,Authorization:`Bearer ${app.ownerToken}`};
    const active=await page.request.post(`${app.origin}/itinerary-api/create_trip`,{headers,data:{
      name:'Unrelated active trip',destination:'Elsewhere',startDate:'2027-02-01',endDate:'2027-02-02',adults:2,idempotencyKey:randomUUID(),
    }});
    expect(active.ok()).toBe(true);
    const {tripId:activeId}=await active.json();
    const current=await page.request.post(`${app.origin}/itinerary-api/get_itinerary`,{headers,data:{tripId:app.tripId}});
    expect(current.ok()).toBe(true);
    const {trip}=await current.json();
    const archived=await page.request.post(`${app.origin}/itinerary-api/archive_trip`,{headers,data:{tripId:app.tripId,expectedRevision:trip.lifecycle_revision,idempotencyKey:randomUUID()}});
    expect(archived.ok()).toBe(true);
    const before=await persisted(app),requests=[];
    let fail=true;
    await page.route('**/itinerary-api/get_itinerary',route=>{
      const id=route.request().postDataJSON().tripId;requests.push(id);
      if(fail&&id===app.tripId)return failure==='network'?route.abort('failed'):route.fulfill({status:503,contentType:'text/html',body:'Temporarily unavailable'});
      return route.continue();
    });
    await signIn(page,app);
    await expect(page.locator('#plan-recovery-title')).toHaveText('Unable to load your trips');
    await expect(page.locator('#trip-view')).toBeHidden();
    expect(requests).toEqual([app.tripId]);
    await expect(page).toHaveURL(new RegExp(`trip=${app.tripId}`));
    fail=false;
    await page.locator('#retry-plan').click();
    await expect(page.locator('#trip-title')).toHaveText('Sharing browser fixture — fictional');
    await expect(page.locator('#trip-filter')).toHaveValue('archived');
    await expect(page.locator('#trip-archived')).toBeVisible();
    await expect(page.locator('#plan-recovery')).toBeHidden();
    await expect(page.locator(`#item-${app.itemId}`)).toContainText(originalTitle);
    expect(requests).not.toContain(activeId);
    assert.deepEqual(await persisted(app),before,'lookup/retry must preserve archive state, items and history');
  });
}

test('a genuinely unavailable deep link keeps the existing explicit fallback message',async({page,context,app})=>{
  await context.route('**/*',route=>new URL(route.request().url()).origin===app.origin?route.continue():route.abort());
  const before=await persisted(app),missing=randomUUID();
  const denied=page.waitForResponse(response=>response.url().endsWith('/itinerary-api/get_itinerary')&&response.request().postDataJSON().tripId===missing);
  await signIn(page,app,app.ownerToken,missing);
  expect((await denied).status()).toBe(404);
  await expect(page.locator('#trip-title')).toHaveText('Sharing browser fixture — fictional');
  await expect(page.locator('#status')).toContainText('The requested trip is not available in this account.');
  await expect(page.locator('#plan-recovery')).toBeHidden();
  assert.deepEqual(await persisted(app),before);
});

for(const status of [403,404]){
  test(`trip-list denial ${status} after creation clears the prior private view and dialog`,async({page,context,app})=>{
    await context.route('**/*',route=>new URL(route.request().url()).origin===app.origin?route.continue():route.abort());
    await signIn(page,app);
    await expect(page.locator(`#item-${app.itemId}`)).toContainText(privateNote);
    await expect(page.locator('#refresh')).toBeEnabled();
    const before=await persisted(app),lists=[],creates=[];
    // Creating another trip reloads the list while the previous plan is loaded.
    // Commit the real creation, then deny only the follow-up list read.
    await page.route('**/itinerary-api/list_trips',route=>{
      lists.push(route.request().postDataJSON());
      return route.fulfill({status,contentType:'text/html',body:'Access denied'});
    });
    await page.route('**/itinerary-api/create_trip',route=>{creates.push(route.request().postDataJSON());return route.continue();});
    await openDisclosure(page,'trip-switcher');
    await page.locator('#new-trip').click();
    const dialog=page.locator('#trip-dialog');
    await dialog.getByLabel('Trip name',{exact:true}).fill('New fictional trip');
    await dialog.getByLabel('Destination',{exact:true}).fill('Elsewhere');
    await dialog.getByLabel('Start date',{exact:true}).fill('2027-02-01');
    await dialog.getByLabel('End date',{exact:true}).fill('2027-02-02');
    const created=page.waitForResponse(response=>response.url().endsWith('/itinerary-api/create_trip'));
    await dialog.getByRole('button',{name:'Create trip',exact:true}).click();
    expect((await created).ok()).toBe(true);
    await expect(page.locator('#trip-view')).toBeHidden();
    await expect(dialog).not.toBeVisible();
    await expect(dialog.getByLabel('Trip name',{exact:true})).toHaveValue('');
    await expect(page.locator('#trip-list')).toBeEmpty();
    await expect(page.locator('#timeline')).toBeEmpty();
    await expect(page.locator('#plan-recovery')).toBeHidden();
    await expect(page.locator('body')).not.toContainText(privateNote);
    await expect(page.locator('body')).not.toContainText(privateResearch);
    expect(lists).toHaveLength(1);expect(creates).toHaveLength(1);
    const after=await persisted(app);
    assert.deepEqual(after.itinerary_items,before.itinerary_items);
    assert.deepEqual(after.itinerary_events,before.itinerary_events);
    expect(after.trips).toHaveLength(before.trips.length+1);
    expect(after.mutation_requests).toHaveLength(before.mutation_requests.length+1);
    expect(after.search_runs).toHaveLength(0);
  });
}

for(const viewport of [{width:390,height:844},{width:1280,height:900}]){
  test(`itinerary read recovery at ${viewport.width}px: initial retry, stale refresh and correct-trip recovery`,async({page,context,app})=>{
    await page.setViewportSize(viewport);
    await context.route('**/*',route=>new URL(route.request().url()).origin===app.origin?route.continue():route.abort());
    const before=await persisted(app),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    let failure='server';
    const requested=[];
    await page.route('**/itinerary-api/get_itinerary',async route=>{
      requested.push(route.request().postDataJSON().tripId);
      if(failure==='server')return route.fulfill({status:503,contentType:'text/html',body:'Temporarily unavailable'});
      if(failure==='network')return route.abort('failed');
      return route.continue();
    });
    await signIn(page,app);
    await expect(page.locator('#plan-recovery-title')).toHaveText('Unable to load your itinerary');
    await expect(page.locator('#trip-view')).toBeHidden();
    await expect(page.locator('#retry-plan')).toBeEnabled();
    failure='';
    await page.locator('#retry-plan').click();
    await expect(page.locator('#trip-title')).toHaveText('Sharing browser fixture — fictional');
    await expect(page.locator(`#item-${app.itemId}`)).toContainText(originalTitle);
    await expect(page.locator('#plan-recovery')).toBeHidden();
    // Let the real comparison reads finish before triggering the next refresh.
    await expect(page.locator('#stay-research')).toBeHidden();
    await expect(page.locator('#dining-research')).toBeHidden();
    for(const kind of ['network','server']){
      failure=kind;
      await openDisclosure(page,'plan-more');
      await page.getByRole('button',{name:'Refresh',exact:true}).click();
      await expect(page.locator('#plan-recovery-title')).toHaveText('Showing your last-loaded itinerary');
      await expect(page.locator('#plan-recovery-detail')).toContainText('Last loaded at');
      await expect(page.locator(`#item-${app.itemId}`)).toContainText(originalTitle);
      await openDisclosure(page,'plan-more');
      await expect(page.locator('#refresh')).toBeVisible();
      failure='';
      await page.locator('#retry-plan').click();
      await expect(page.locator('#plan-recovery')).toBeHidden();
    }
    expect(requested.every(id=>id===app.tripId)).toBe(true);
    assert.deepEqual(await persisted(app),before,'reads and retry must not mutate durable state');
    expect(errors).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
}

test('switching trips never presents the previous trip as a failed-load snapshot',async({page,context,app})=>{
  await context.route('**/*',route=>new URL(route.request().url()).origin===app.origin?route.continue():route.abort());
  const created=await page.request.post(`${app.origin}/itinerary-api/create_trip`,{headers:{Origin:app.origin,Authorization:`Bearer ${app.ownerToken}`},data:{
    name:'Second fictional trip',destination:'Elsewhere',startDate:'2027-02-01',endDate:'2027-02-02',adults:2,idempotencyKey:randomUUID(),
  }});
  expect(created.ok()).toBe(true);
  const {tripId}=await created.json();
  await signIn(page,app);
  await expect(page.locator('#refresh')).toBeEnabled();
  let fail=true;
  await page.route('**/itinerary-api/get_itinerary',route=>fail?route.fulfill({status:503,json:{error:'Temporary failure'}}):route.continue());
  await openDisclosure(page,'trip-switcher');
  await page.locator('#trip-list').getByRole('button',{name:/Second fictional trip/}).click();
  await expect(page.locator('#plan-recovery-title')).toHaveText('Unable to load your itinerary');
  await expect(page.locator('#trip-view')).toBeHidden();
  await expect(page.locator('#timeline')).toBeEmpty();
  await expect(page.locator('body')).not.toContainText(privateNote);
  await expect(page.locator('body')).not.toContainText(privateResearch);
  fail=false;
  await page.locator('#retry-plan').click();
  await expect(page.locator('#trip-title')).toHaveText('Second fictional trip');
  await expect(page).toHaveURL(new RegExp(`trip=${tripId}`));
});

for(const status of [401,403,404]){
  test(`refresh denial ${status} clears private content even with a non-JSON body`,async({page,context,app})=>{
    await context.route('**/*',route=>new URL(route.request().url()).origin===app.origin?route.continue():route.abort());
    await signIn(page,app);
    await expect(page.locator(`#item-${app.itemId}`)).toContainText(privateNote);
    await page.locator(`#item-${app.itemId}`).getByRole('button',{name:'Edit',exact:true}).click();
    await expect(page.locator('#item-dialog')).toBeVisible();
    // Trigger refresh programmatically while a private dialog is open to check
    // that a denial also clears its form and closes it.
    await page.route('**/itinerary-api/get_itinerary',route=>route.fulfill({status,contentType:'text/html',body:'Access denied'}));
    await page.locator('#refresh').evaluate(button=>button.click());
    await expect(page.locator('#trip-view')).toBeHidden();
    await expect(page.locator('#item-dialog')).not.toBeVisible();
    await expect(page.locator('#item-form').getByLabel('Title',{exact:true})).toHaveValue('');
    await expect(page.locator('#timeline')).toBeEmpty();
    await expect(page.locator('#plan-recovery')).toBeHidden();
    await expect(page.locator('body')).not.toContainText(privateNote);
    await expect(page.locator('body')).not.toContainText(privateResearch);
  });
}

test('anonymous shared view recovers temporary reads and clears on real revocation',async({page,context,app})=>{
  await context.route('**/*',route=>new URL(route.request().url()).origin===app.origin?route.continue():route.abort());
  const result=await page.request.post(`${app.origin}/itinerary-api/create_itinerary_view_link`,{headers:{Origin:app.origin,Authorization:`Bearer ${app.ownerToken}`},data:{tripId:app.tripId,label:'Fictional recovery test',idempotencyKey:randomUUID()}});
  expect(result.ok()).toBe(true);
  const link=await result.json();
  let fail=true;
  await page.route('**/itinerary-share/read',route=>fail?route.fulfill({status:503,json:{error:'Temporary failure'}}):route.continue());
  await page.goto(`${app.origin}/itinerary?view=details#view=${link.token}`);
  await expect(page.locator('#plan-recovery-title')).toHaveText('Unable to load your itinerary');
  await expect(page.locator('#shared-unavailable')).toBeHidden();
  fail=false;
  await page.locator('#retry-plan').click();
  await expect(page.locator(`#item-${app.itemId}`)).toContainText(originalTitle);
  fail=true;
  await openDisclosure(page,'plan-more');
  await page.locator('#refresh').click();
  await expect(page.locator('#plan-recovery-title')).toHaveText('Showing your last-loaded itinerary');
  await expect(page.locator('#trip-view')).toBeVisible();
  fail=false;
  const revoked=await page.request.post(`${app.origin}/itinerary-api/revoke_itinerary_access`,{headers:{Origin:app.origin,Authorization:`Bearer ${app.ownerToken}`},data:{tripId:app.tripId,inviteId:link.inviteId,idempotencyKey:randomUUID()}});
  expect(revoked.ok()).toBe(true);
  await page.locator('#retry-plan').click();
  await expect(page.locator('#shared-unavailable')).toBeVisible();
  await expect(page.locator('#trip-view')).toBeHidden();
  await expect(page.locator('#timeline')).toBeEmpty();
  await expect(page.locator('#plan-recovery')).toBeHidden();
  await expect(page.locator('body')).not.toContainText(privateNote);
});
