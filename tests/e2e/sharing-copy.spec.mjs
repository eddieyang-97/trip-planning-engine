import {test,expect} from './fixture.mjs';

async function openSharing(page,app){
  await page.goto(`${app.origin}/itinerary?trip=${app.tripId}`);
  await page.getByLabel('Local development token').fill(app.ownerToken);
  await page.getByRole('button',{name:'Open local trips',exact:true}).click();
  await expect(page.locator('#refresh')).toBeEnabled();await page.locator('#share-trip').click();
  await expect(page.locator('#access-list')).toContainText('Fixture viewer');
}
test.beforeEach(async({context,app})=>{
  await context.route('**/*',route=>new URL(route.request().url()).origin===app.origin?route.continue():route.abort('blockedbyclient'));
});

test('generate copies real view/editor links from the original gesture; failures and closed dialogs copy nothing',async({page,context,app},info)=>{
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:app.origin});
  await page.addInitScript(()=>{
    const write=navigator.clipboard.write.bind(navigator.clipboard);
    window.copyGestures=[];window.copySettled=0;navigator.clipboard.write=items=>{window.copyGestures.push(navigator.userActivation.isActive);return write(items).then(value=>{window.copySettled++;return value;},error=>{window.copySettled++;throw error;});};
  });
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await openSharing(page,app);
  let ready,continueResponse;const heldResponse=new Promise(resolve=>{ready=resolve;}),continueGate=new Promise(resolve=>{continueResponse=resolve;});
  await page.evaluate(()=>navigator.clipboard.writeText('fictional pending sentinel'));
  await page.route('**/itinerary-api/create_itinerary_view_link',async route=>{const response=await route.fetch();ready();await continueGate;await route.fulfill({response});});
  for(const [role,fragment] of [['viewer','#view='],['editor','#invite=']]){
    await page.locator('#invite-role').selectOption(role);
    await page.locator('#create-invitation').click();
    if(role==='viewer'){
      await heldResponse;expect(await page.evaluate(()=>window.copyGestures)).toEqual([true]);
      expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('fictional pending sentinel');
      continueResponse();
    }
    await expect(page.locator('#share-error')).toHaveText('Copied. Send this link privately to your friend.');
    if(role==='viewer'){
      await page.locator('#share-error').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('copied-phone.png')});
      await page.setViewportSize({width:1280,height:900});await page.locator('#share-error').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('copied-desktop.png')});
      await page.setViewportSize({width:390,height:844});
    }
    const link=await page.locator('#invite-link').inputValue();expect(link).toContain(`${app.origin}/itinerary${fragment}`);
    expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(link);
    await page.evaluate(()=>navigator.clipboard.writeText('fictional manual-copy retry'));
    await page.locator('#copy-invite').click();
    expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(link);
    await expect(page.locator('#create-invitation')).toBeEnabled();
    if(role==='viewer')await page.unroute('**/itinerary-api/create_itinerary_view_link');
  }
  expect(await page.evaluate(()=>window.copyGestures)).toEqual([true,true]);
  expect((await app.db.query("select count(*)::int n from mutation_requests where operation in ('create_itinerary_invite','create_itinerary_view_link')")).rows[0].n).toBe(3); // fixture viewer + two generated links
  await page.locator('#invite-role').selectOption('viewer');
  await page.evaluate(()=>navigator.clipboard.writeText('fictional failure sentinel'));
  await page.route('**/itinerary-api/create_itinerary_view_link',route=>route.fulfill({status:503,json:{error:'Fictional creation failure'}}));
  await page.locator('#create-invitation').click();await expect(page.locator('#share-error')).toHaveText('Fictional creation failure');
  await expect(page.locator('#created-link')).toBeHidden();
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('fictional failure sentinel');
  await page.unroute('**/itinerary-api/create_itinerary_view_link');
  // The real server creates once, but a response arriving after Close must not
  // disclose its token or replace the clipboard. Access remains manageable later.
  let release,received;const held=new Promise(resolve=>{received=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  await page.route('**/itinerary-api/create_itinerary_view_link',async route=>{const response=await route.fetch();received();await gate;await route.fulfill({response});});
  await page.locator('#create-invitation').click();await held;
  await page.locator('#share-dialog [data-close]').click();release();
  await expect(page.locator('#share-dialog')).not.toBeVisible();
  await expect(page.locator('#invite-link')).toHaveValue('');
  await expect.poll(()=>page.evaluate(()=>window.copySettled)).toBe(4);
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('fictional failure sentinel');
  expect((await app.db.query("select count(*)::int n from mutation_requests where operation='create_itinerary_view_link'")).rows[0].n).toBe(2);
  expect(errors).toEqual([]);
});

test('blocked or unavailable clipboard keeps the created link selected and manual retry never regenerates it',async({page,app},info)=>{
  await page.addInitScript(()=>{
    window.clipboardMode='blocked';window.copiedLinks=[];
    Object.defineProperty(navigator,'clipboard',{configurable:true,get:()=>window.clipboardMode==='unavailable'?undefined:{write:()=>Promise.reject(new DOMException('Fixture clipboard denial','NotAllowedError')),writeText:async text=>{if(window.clipboardMode==='blocked')throw Error('Fixture denial');window.copiedLinks.push(text);}}});
  });
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await openSharing(page,app);
  for(const mode of ['blocked','unavailable']){
    await page.evaluate(value=>{window.clipboardMode=value;},mode);
    await page.locator('#create-invitation').click();
    await expect(page.locator('#share-error')).toContainText('Link created, but automatic copy was blocked.');
    await expect(page.locator('#share-error')).toBeInViewport();
    const link=await page.locator('#invite-link').inputValue();expect(link).toContain('#view=');
    expect(await page.locator('#invite-link').evaluate(input=>({focused:document.activeElement===input,selected:input.selectionStart===0&&input.selectionEnd===input.value.length}))).toEqual({focused:true,selected:true});
    await expect(page.locator('#create-invitation')).toBeEnabled();
    if(mode==='blocked')await page.screenshot({path:info.outputPath('copy-fallback-phone.png')});
    await page.locator('#copy-invite').click();await expect(page.locator('#share-error')).toHaveText('Select the link above and copy it manually.');
    await page.evaluate(()=>{window.clipboardMode='allowed';});await page.locator('#copy-invite').click();
    await expect(page.locator('#share-error')).toContainText('Copied.');expect(await page.evaluate(()=>window.copiedLinks.at(-1))).toBe(link);
  }
  expect((await app.db.query("select count(*)::int n from mutation_requests where operation='create_itinerary_view_link'")).rows[0].n).toBe(2);
  expect(errors).toEqual([]);
});
