import {test,expect} from './fixture.mjs';
import {openDisclosure} from './navigation.mjs';

test('the itinerary loads when an older HTML page receives the newer expense script',async({page,context,app})=>{
  await context.route('**/*',route=>new URL(route.request().url()).origin===app.origin?route.continue():route.abort('blockedbyclient'));
  await page.route(url=>url.pathname==='/itinerary',async route=>{
    const response=await route.fetch();
    // The old HTML lacks these controls, while the bundle URL stays the same.
    const body=(await response.text()).replace(/id="expense-(currency|suggestions|summaries)"/g,'id="legacy-expense-$1"');
    await route.fulfill({response,body});
  },{times:1});
  const pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  async function openTrip(){
    await page.getByLabel('Local development token').fill(app.ownerToken);
    await page.getByRole('button',{name:'Open local trips',exact:true}).click();
    await expect(page.locator('#trip-title')).toContainText('Sharing browser fixture');
  }
  await page.goto(`${app.origin}/itinerary?trip=${app.tripId}`);
  expect(pageErrors).toEqual([]);
  await expect(page.locator('#expense-currency,#expense-suggestions,#expense-summaries')).toHaveCount(0);
  await openTrip();
  await expect(page.locator('#trip-expenses')).toBeHidden();
  expect(pageErrors).toEqual([]);

  await page.reload();
  await openTrip();
  await openDisclosure(page,'plan-more');
  await page.getByRole('button',{name:'Expenses',exact:true}).click();
  await expect(page.getByText('No expenses recorded yet.',{exact:true})).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('owner records a GBP split and a signed-in friend sees balances on a phone',async({page,context,app},testInfo)=>{
  await context.route('**/*',route=>new URL(route.request().url()).origin===app.origin?route.continue():route.abort('blockedbyclient'));
  const {tripId}=app;
  for(const [index,name] of ['Alex','Casey','Drew'].entries()){
    await app.call('manage_trip_traveler',{tripId,expectedRevision:2+index,change:{action:'add',name}});
  }
  const link=await app.call('create_itinerary_view_link',{tripId,label:'Account-free fixture'});
  async function openTrip(target,token){
    await target.goto(`${app.origin}/itinerary?trip=${tripId}`);
    await target.getByLabel('Local development token').fill(token);
    await target.getByRole('button',{name:'Open local trips',exact:true}).click();
    await expect(target.locator('#trip-title')).toBeVisible();
  }
  async function openExpenses(target){
    await openDisclosure(target,'plan-more');
    await target.getByRole('button',{name:'Expenses',exact:true}).click();
    await expect(target.getByRole('dialog',{name:'Trip expenses'})).toBeVisible();
  }
  await openTrip(page,app.ownerToken);
  await openExpenses(page);
  await page.getByRole('button',{name:'Add expense',exact:true}).click();
  await page.getByLabel('Description').fill('Fixture activity');
  await page.getByLabel('Date paid').fill('2027-01-02');
  await page.getByLabel('Amount', {exact:true}).fill('10.01');
  await page.getByLabel('Paid by').selectOption({label:'Alex'});
  await page.getByRole('checkbox',{name:'Drew',exact:true}).uncheck();
  await expect(page.locator('#expense-preview li')).toHaveCount(2);
  await expect(page.locator('#expense-preview')).toContainText('£5.01');
  await expect(page.locator('#expense-preview')).toContainText('£5.00');
  await page.screenshot({path:testInfo.outputPath('expense-preview-phone.png')});

  // The server commits the first request, but the browser loses its response.
  // Retrying the unchanged draft must use the same mutation key.
  let sent;
  await page.route('**/itinerary-api/save_trip_expense',async route=>{
    sent=route.request().postDataJSON();
    await route.fetch();
    await route.abort('failed');
  },{times:1});
  await page.getByRole('button',{name:'Save expense',exact:true}).click();
  await expect(page.locator('#expenses-error')).toContainText('did not respond');
  await page.getByRole('button',{name:'Refresh expenses',exact:true}).click();
  await expect(page.locator('#expense-recovery')).toBeVisible();
  await expect(page.getByLabel('Amount', {exact:true})).toHaveValue('10.01');
  const retry=page.waitForRequest(request=>request.url().endsWith('/itinerary-api/save_trip_expense'));
  await page.getByRole('button',{name:'Retry original save',exact:true}).click();
  expect((await retry).postDataJSON().idempotencyKey).toBe(sent.idempotencyKey);
  await expect(page.locator('#expense-list')).toContainText('Fixture activity · £10.01');
  await expect(page.locator('#expense-balances li')).toHaveCount(2);
  const persisted=await app.core.callFromWeb('get_trip_expenses',{tripId},app.owner);
  expect(persisted.expenses).toHaveLength(1);
  expect(persisted.history).toHaveLength(1);

  const friend=await context.newPage();
  await openTrip(friend,app.viewerToken);
  await openExpenses(friend);
  await expect(friend.locator('#expense-list')).toContainText('Fixture activity · £10.01');
  await expect(friend.locator('#expense-balances')).toContainText('Casey · Owes £5.');
  await expect(friend.getByRole('button',{name:'Add expense',exact:true})).toBeHidden();
  await expect(friend.locator('#expense-history')).toBeHidden();
  await friend.setViewportSize({width:320,height:800});
  expect(await friend.locator('#expenses-dialog').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  await friend.screenshot({path:testInfo.outputPath('expense-balances-phone.png')});

  await page.getByRole('button',{name:'Correct Fixture activity'}).click();
  await page.getByLabel('Amount', {exact:true}).fill('12');
  await page.getByRole('button',{name:'Save expense',exact:true}).click();
  await expect(page.locator('#expense-list')).toContainText('Fixture activity · £12.00');
  await page.getByText('Recent expense history').click();
  await expect(page.locator('#expense-history-list')).toContainText('Recorded · Fixture activity · £10.01');
  await expect(page.locator('#expense-history-list')).toContainText('Corrected · Fixture activity · £12.00');
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Void Fixture activity'}).click();
  await expect(page.locator('#expense-list')).toContainText('No expenses recorded yet.');
  await expect(page.locator('#expense-history-list')).toContainText('Voided · Fixture activity · £12.00');

  const anonymous=await context.newPage();
  await anonymous.goto(`${app.origin}/itinerary#view=${link.token}`);
  await expect(anonymous.locator('#shared-view-banner')).toBeVisible();
  await expect(anonymous.locator('#trip-expenses')).toBeHidden();
  expect(await anonymous.evaluate(async id=>(await fetch('/itinerary-api/get_trip_expenses',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tripId:id}),
  })).status,tripId)).toBe(401);
});

test('owner records a comma-decimal expense and a member sees separate suggested repayments',async({page,context,app},testInfo)=>{
  await context.route('**/*',route=>new URL(route.request().url()).origin===app.origin?route.continue():route.abort('blockedbyclient'));
  const {tripId}=app;
  const travelers=[];
  for(const [index,name] of ['Alex','Casey'].entries()){
    const {travelerId}=await app.call('manage_trip_traveler',{tripId,expectedRevision:2+index,change:{action:'add',name}});
    travelers.push(travelerId);
  }
  async function openExpenses(target,token){
    await target.goto(`${app.origin}/itinerary?trip=${tripId}`);
    await target.getByLabel('Local development token').fill(token);
    await target.getByRole('button',{name:'Open local trips',exact:true}).click();
    await expect(target.locator('#trip-title')).toBeVisible();
    await openDisclosure(target,'plan-more');
    await target.getByRole('button',{name:'Expenses',exact:true}).click();
  }
  await page.setViewportSize({width:1280,height:900});
  await openExpenses(page,app.ownerToken);
  await expect(page.getByText('No expenses recorded yet.',{exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Suggested repayments'})).toBeHidden();
  await app.call('save_trip_expense',{tripId,expectedRevision:0,expense:{
    title:'Fictional lodge',paidOn:'2027-01-01',payerId:travelers[0],currency:'GBP',amountMinor:2000,travelerIds:travelers,
  }});
  await page.getByRole('button',{name:'Refresh expenses'}).click();
  await expect(page.locator('#expense-list')).toContainText('Fictional lodge · £20.00');
  await page.getByRole('button',{name:'Add expense',exact:true}).click();
  const currency=page.getByRole('combobox',{name:'Currency',exact:true});
  const amount=page.getByLabel('Amount',{exact:true});
  await expect(currency).toHaveValue('GBP');
  await currency.selectOption('EUR');
  await page.getByLabel('Description').fill('Fictional dinner');
  await page.getByLabel('Date paid').fill('2027-01-02');
  await page.getByLabel('Paid by').selectOption({label:'Casey'});
  await amount.fill('20,02');
  await expect(page.locator('#expense-preview li').first()).toContainText('EUR 10.01');
  await page.getByRole('button',{name:'Save expense',exact:true}).click();
  const suggestions=page.locator('#expense-suggestions');
  await expect(suggestions.getByRole('listitem')).toHaveText(['Alex pays Casey · EUR 10.01','Casey pays Alex · £10.00']);
  const persisted=await app.core.callFromWeb('get_trip_expenses',{tripId,currencyAware:true},app.owner);
  expect(persisted.expenses.find(expense=>expense.currency==='EUR')).toMatchObject({amountMinor:2002});
  await page.screenshot({path:testInfo.outputPath('expense-currencies-desktop.png')});

  const friend=await context.newPage();
  await friend.setViewportSize({width:390,height:844});
  await openExpenses(friend,app.viewerToken);
  await expect(friend.locator('#expense-suggestions').getByRole('listitem')).toHaveText([
    'Alex pays Casey · EUR 10.01','Casey pays Alex · £10.00',
  ]);
  await expect(friend.locator('#expense-balances').getByRole('heading')).toHaveText(['EUR','GBP']);
  await expect(friend.getByRole('button',{name:'Add expense',exact:true})).toBeHidden();
  await expect(friend.locator('#expense-history')).toBeHidden();
  await friend.setViewportSize({width:320,height:800});
  expect(await friend.locator('#expenses-dialog').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  await friend.screenshot({path:testInfo.outputPath('expense-currencies-mobile.png')});

  await page.getByRole('button',{name:'Correct Fictional dinner'}).click();
  await expect(currency).toHaveValue('EUR');
  await expect(amount).toHaveValue('20.02');
  await currency.selectOption('JPY');
  const save=page.getByRole('button',{name:'Save expense',exact:true});
  await save.click();
  await expect(page.locator('#expenses-error')).toContainText('Enter a positive JPY amount as a whole number');
  await amount.fill('2000');
  await save.click();
  await expect(suggestions.getByRole('listitem')).toHaveText(['Casey pays Alex · £10.00','Alex pays Casey · JPY 1,000']);
  await page.getByText('Recent expense history').click();
  await expect(page.locator('#expense-history-list')).toContainText('Recorded · Fictional dinner · EUR 20.02');
  await expect(page.locator('#expense-history-list')).toContainText('Corrected · Fictional dinner · JPY 2,000');
  await friend.getByRole('button',{name:'Refresh expenses'}).click();
  await expect(friend.locator('#expense-suggestions').getByRole('heading')).toHaveText(['GBP','JPY']);
});

test('an uncertain correction can only be retried as the original operation',async({page,context,app})=>{
  await context.route('**/*',route=>new URL(route.request().url()).origin===app.origin?route.continue():route.abort('blockedbyclient'));
  const {tripId}=app;
  const {travelerId}=await app.call('manage_trip_traveler',{tripId,expectedRevision:2,change:{action:'add',name:'Alex'}});
  const expense={paidOn:'2027-01-01',payerId:travelerId,currency:'GBP',amountMinor:1000,travelerIds:[travelerId]};
  const lodge=await app.call('save_trip_expense',{tripId,expectedRevision:0,expense:{...expense,title:'Lodge'}});
  const activity=await app.call('save_trip_expense',{tripId,expectedRevision:1,expense:{...expense,title:'Activity'}});
  const read=()=>app.core.callFromWeb('get_trip_expenses',{tripId},app.owner);
  await page.goto(`${app.origin}/itinerary?trip=${tripId}`);
  await page.getByLabel('Local development token').fill(app.ownerToken);
  await page.getByRole('button',{name:'Open local trips',exact:true}).click();
  await expect(page.locator('#trip-title')).toBeVisible();
  await openDisclosure(page,'plan-more');
  await page.getByRole('button',{name:'Expenses',exact:true}).click();
  const save=page.getByRole('button',{name:'Save expense',exact:true});
  const correct=page.getByRole('button',{name:'Correct Lodge',exact:true});
  const voidActivity=page.getByRole('button',{name:'Void Activity',exact:true});
  const retry=page.getByRole('button',{name:'Retry original save',exact:true});
  const discard=page.getByRole('button',{name:'Discard retry and refresh',exact:true});
  const voidRequests=[];
  page.on('request',request=>{
    if(request.url().endsWith('/itinerary-api/void_trip_expense'))voidRequests.push(request.postDataJSON());
  });
  await correct.click();
  await page.getByLabel('Amount', {exact:true}).fill('11');
  await page.route('**/itinerary-api/save_trip_expense',route=>route.abort('failed'),{times:1});
  await save.click();
  await expect(discard).toBeVisible();
  await expect(page.locator('button[aria-label="Void Activity"]')).toBeDisabled();
  await expect(page.locator('button[aria-label="Correct Lodge"]')).toBeDisabled();
  await expect(page.locator('#expense-add')).toBeDisabled();
  await expect(save).toBeDisabled();
  await expect(page.locator('#expense-recovery')).toContainText('The last expense change may have been saved');
  expect(voidRequests).toEqual([]);
  expect((await read()).revision).toBe(2);

  await discard.click();
  await expect(voidActivity).toBeEnabled();
  page.once('dialog',dialog=>dialog.accept());
  await voidActivity.click();
  await expect(page.locator('#expenses-status')).toHaveText('Expense voided.');
  expect(voidRequests).toEqual([expect.objectContaining({expenseId:activity.expenseId,expectedRevision:2})]);
  const afterVoid=await read();
  expect(afterVoid.revision).toBe(3);
  expect(afterVoid.history.filter(event=>event.id===lodge.expenseId)).toEqual([
    expect.objectContaining({action:'recorded',amountMinor:1000}),
  ]);

  await correct.click();
  await page.getByLabel('Amount', {exact:true}).fill('12');
  let original;
  await page.route('**/itinerary-api/save_trip_expense',async route=>{
    original=route.request().postDataJSON();
    const result=await route.fetch();
    expect(result.ok()).toBe(true);
    await route.abort('failed');
  },{times:1});
  await save.click();
  await expect(retry).toBeVisible();
  // Closing and reopening the ledger must retain the original action and key.
  await page.keyboard.press('Escape');
  if(!await page.getByRole('button',{name:'Expenses',exact:true}).isVisible())await openDisclosure(page,'plan-more');
  await page.getByRole('button',{name:'Expenses',exact:true}).click();
  const retryRequest=page.waitForRequest(request=>request.url().endsWith('/itinerary-api/save_trip_expense'));
  await retry.click();
  expect((await retryRequest).postDataJSON()).toEqual(original);
  await expect(page.locator('#expense-list')).toContainText('Lodge · £12.00');
  const afterRetry=await read();
  expect(afterRetry.revision).toBe(4);
  expect(afterRetry.expenses).toEqual([expect.objectContaining({id:lodge.expenseId,amountMinor:1200})]);
  expect(afterRetry.history.filter(event=>event.action==='corrected')).toHaveLength(1);

  // A void can also commit before its response is lost. Its retry must use the same target and key.
  await page.route('**/itinerary-api/void_trip_expense',async route=>{
    const result=await route.fetch();
    expect(result.ok()).toBe(true);
    await route.abort('failed');
  },{times:1});
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Void Lodge',exact:true}).click();
  await page.getByRole('button',{name:'Retry original void',exact:true}).click();
  await expect(page.locator('#expense-list')).toContainText('No expenses recorded yet.');
  expect(voidRequests.at(-1)).toEqual(voidRequests.at(-2));
  expect(voidRequests.at(-1).expenseId).toBe(lodge.expenseId);
  expect((await read()).revision).toBe(5);
});

test('a stale expense draft survives refresh and a changed correction requires review',async({page,context,app})=>{
  await context.route('**/*',route=>new URL(route.request().url()).origin===app.origin?route.continue():route.abort('blockedbyclient'));
  const {tripId}=app;
  const travelers=[];
  for(const [index,name] of ['Alex','Casey','Drew'].entries()){
    const result=await app.call('manage_trip_traveler',{tripId,expectedRevision:2+index,change:{action:'add',name}});
    travelers.push(result.travelerId);
  }
  const fixture={title:'Expense from another tab',paidOn:'2027-01-01',payerId:travelers[0],currency:'GBP',amountMinor:900,travelerIds:[travelers[0]]};
  await page.goto(`${app.origin}/itinerary?trip=${tripId}`);
  await page.getByLabel('Local development token').fill(app.ownerToken);
  await page.getByRole('button',{name:'Open local trips',exact:true}).click();
  await expect(page.locator('#trip-title')).toBeVisible();
  await openDisclosure(page,'plan-more');
  await page.getByRole('button',{name:'Expenses',exact:true}).click();
  const save=page.getByRole('button',{name:'Save expense',exact:true});
  const refresh=page.getByRole('button',{name:'Refresh expenses',exact:true});
  await page.getByRole('button',{name:'Add expense',exact:true}).click();
  await page.getByLabel('Description').fill('Dinner draft');
  await page.getByLabel('Date paid').fill('2027-01-02');
  await page.getByLabel('Amount', {exact:true}).fill('42.25');
  await page.getByLabel('Paid by').selectOption({label:'Casey'});
  await page.getByRole('checkbox',{name:'Drew',exact:true}).uncheck();
  const other=await app.call('save_trip_expense',{tripId,expectedRevision:0,expense:fixture});
  await save.click();
  await expect(page.locator('#expenses-error')).toContainText('Expenses changed');
  await expect(save).toBeDisabled();
  await refresh.click();
  await expect(page.locator('#expenses-status')).toContainText('Review your draft before saving');
  await expect(page.getByLabel('Description')).toHaveValue('Dinner draft');
  await expect(page.getByLabel('Date paid')).toHaveValue('2027-01-02');
  await expect(page.getByLabel('Amount', {exact:true})).toHaveValue('42.25');
  await expect(page.getByLabel('Paid by')).toHaveValue(travelers[1]);
  await expect(page.getByRole('checkbox',{name:'Drew',exact:true})).not.toBeChecked();
  await save.click();
  await expect(page.locator('#expense-list')).toContainText('Dinner draft · £42.25');

  await page.getByRole('button',{name:'Correct Expense from another tab'}).click();
  await page.getByLabel('Amount', {exact:true}).fill('11');
  await app.call('save_trip_expense',{tripId,expenseId:other.expenseId,expectedRevision:2,
    expense:{...fixture,title:'Latest saved expense',amountMinor:1000,paidOn:'2027-01-03',payerId:travelers[1],travelerIds:[travelers[2]]}});
  await save.click();
  await expect(page.locator('#expenses-error')).toContainText('Expenses changed');
  await refresh.click();
  const review=page.locator('#expense-review');
  await expect(review).toContainText('Latest saved expense · £10.00');
  await expect(review).toContainText('2027-01-03 · Paid by Casey');
  await expect(review).toContainText('Drew · £10.00');
  await expect(page.getByLabel('Amount', {exact:true})).toHaveValue('11');
  await expect(save).toBeDisabled();
  const pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  let releaseRefresh;
  const holdRefresh=new Promise(resolve=>{releaseRefresh=resolve;});
  await page.route('**/itinerary-api/get_trip_expenses',async route=>{
    await holdRefresh;
    await route.continue();
  },{times:1});
  try{
    await refresh.click();
    await expect(page.locator('#expenses-status')).toHaveText('Loading expenses…');
    await expect(review.getByRole('button',{name:'Keep my draft'})).toBeHidden();
    await expect(save).toBeDisabled();
    await expect(page.getByLabel('Amount', {exact:true})).toHaveValue('11');
    await app.call('save_trip_expense',{tripId,expenseId:other.expenseId,expectedRevision:3,
      expense:{...fixture,title:'Updated during refresh',amountMinor:1050}});
  }finally{releaseRefresh();}
  await expect(review).toContainText('Updated during refresh · £10.50');
  await expect(save).toBeDisabled();
  await review.getByRole('button',{name:'Keep my draft'}).click();
  await save.click();
  await expect(page.locator('#expense-list')).toContainText('Expense from another tab · £11.00');

  await page.getByRole('button',{name:'Correct Expense from another tab'}).click();
  await page.getByLabel('Amount', {exact:true}).fill('12');
  await app.call('void_trip_expense',{tripId,expenseId:other.expenseId,expectedRevision:5});
  await refresh.click();
  await expect(review).toContainText('This expense was voided');
  await expect(page.getByLabel('Amount', {exact:true})).toHaveValue('12');
  await expect(save).toBeDisabled();
  const ledger=await app.core.callFromWeb('get_trip_expenses',{tripId},app.owner);
  expect(ledger.revision).toBe(6);
  expect(ledger.expenses.map(expense=>expense.title)).toEqual(['Dinner draft']);
  expect(pageErrors).toEqual([]);
});
