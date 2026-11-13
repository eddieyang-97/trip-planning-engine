import {test,expect} from './fixture.mjs';
import {openDisclosure} from './navigation.mjs';

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
  await page.getByLabel('Amount (£)').fill('10.01');
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
  await expect(page.locator('#expenses-status')).toContainText('Retry the previous save');
  await expect(page.getByLabel('Amount (£)')).toHaveValue('10.01');
  const retry=page.waitForRequest(request=>request.url().endsWith('/itinerary-api/save_trip_expense'));
  await page.getByRole('button',{name:'Save expense',exact:true}).click();
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
  await page.getByLabel('Amount (£)').fill('12');
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
  await page.getByLabel('Amount (£)').fill('42.25');
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
  await expect(page.getByLabel('Amount (£)')).toHaveValue('42.25');
  await expect(page.getByLabel('Paid by')).toHaveValue(travelers[1]);
  await expect(page.getByRole('checkbox',{name:'Drew',exact:true})).not.toBeChecked();
  await save.click();
  await expect(page.locator('#expense-list')).toContainText('Dinner draft · £42.25');

  await page.getByRole('button',{name:'Correct Expense from another tab'}).click();
  await page.getByLabel('Amount (£)').fill('11');
  await app.call('save_trip_expense',{tripId,expenseId:other.expenseId,expectedRevision:2,
    expense:{...fixture,title:'Latest saved expense',amountMinor:1000,paidOn:'2027-01-03',payerId:travelers[1],travelerIds:[travelers[2]]}});
  await save.click();
  await expect(page.locator('#expenses-error')).toContainText('Expenses changed');
  await refresh.click();
  const review=page.locator('#expense-review');
  await expect(review).toContainText('Latest saved expense · £10.00');
  await expect(review).toContainText('2027-01-03 · Paid by Casey');
  await expect(review).toContainText('Drew · £10.00');
  await expect(page.getByLabel('Amount (£)')).toHaveValue('11');
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
    await expect(page.getByLabel('Amount (£)')).toHaveValue('11');
    await app.call('save_trip_expense',{tripId,expenseId:other.expenseId,expectedRevision:3,
      expense:{...fixture,title:'Updated during refresh',amountMinor:1050}});
  }finally{releaseRefresh();}
  await expect(review).toContainText('Updated during refresh · £10.50');
  await expect(save).toBeDisabled();
  await review.getByRole('button',{name:'Keep my draft'}).click();
  await save.click();
  await expect(page.locator('#expense-list')).toContainText('Expense from another tab · £11.00');

  await page.getByRole('button',{name:'Correct Expense from another tab'}).click();
  await page.getByLabel('Amount (£)').fill('12');
  await app.call('void_trip_expense',{tripId,expenseId:other.expenseId,expectedRevision:5});
  await refresh.click();
  await expect(review).toContainText('This expense was voided');
  await expect(page.getByLabel('Amount (£)')).toHaveValue('12');
  await expect(save).toBeDisabled();
  const ledger=await app.core.callFromWeb('get_trip_expenses',{tripId},app.owner);
  expect(ledger.revision).toBe(6);
  expect(ledger.expenses.map(expense=>expense.title)).toEqual(['Dinner draft']);
  expect(pageErrors).toEqual([]);
});
