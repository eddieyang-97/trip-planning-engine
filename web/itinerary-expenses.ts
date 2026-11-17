import {defaultExpenseCurrency,equalShares,expenseCurrencies,maxExpenseMinor,parseExpenseAmount,
  type ExpenseCurrency,type ExpenseShare} from '../src/expense-split.js';
import type {Expense,ExpenseLedger} from '../src/trip-expenses.js';
import type {Traveler} from '../src/itinerary-travelers.js';
import {isTemporaryReadError} from './itinerary-read-response.js';

const currencies=Object.keys(expenseCurrencies) as ExpenseCurrency[];
const formatters=new Map(currencies.map(currency=>{
  const digits=expenseCurrencies[currency];
  return [currency,new Intl.NumberFormat('en-GB',{style:'currency',currency,
    currencyDisplay:currency===defaultExpenseCurrency?'symbol':'code',
    minimumFractionDigits:digits,maximumFractionDigits:digits})];
}));
const majorAmount=(amountMinor:number,currency:ExpenseCurrency)=>amountMinor/10**expenseCurrencies[currency];
const money=(amountMinor:number,currency:ExpenseCurrency)=>formatters.get(currency)!.format(majorAmount(amountMinor,currency));
const get=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const errorText=(error:unknown)=>error instanceof Error?error.message:'Unable to load trip expenses.';
type ExpenseMutation={
  name:'save_trip_expense'|'void_trip_expense';
  args:Record<string,unknown>;
};
function element<K extends keyof HTMLElementTagNameMap>(tag:K,value=''){
  const node=document.createElement(tag);
  node.textContent=value;
  return node;
}

export function configureExpenses(transport:{
  read:(tripId:string)=>Promise<ExpenseLedger>;
  mutate:(name:ExpenseMutation['name'],args:ExpenseMutation['args'])=>Promise<unknown>;
}){
  const launch=get<HTMLButtonElement>('trip-expenses');
  const dialog=get<HTMLDialogElement>('expenses-dialog');
  const form=get<HTMLFormElement>('expense-form');
  const close=get<HTMLButtonElement>('expenses-close');
  const refresh=get<HTMLButtonElement>('expenses-refresh');
  const add=get<HTMLButtonElement>('expense-add');
  const submit=get<HTMLButtonElement>('expense-save');
  const title=get<HTMLInputElement>('expense-title');
  const date=get<HTMLInputElement>('expense-date');
  const currencyField=get<HTMLSelectElement>('expense-currency');
  const amount=get<HTMLInputElement>('expense-amount');
  const payer=get<HTMLSelectElement>('expense-payer');
  const choices=get('expense-travelers');
  const preview=get('expense-preview');
  const list=get('expense-list');
  const balances=get('expense-balances');
  const suggestions=get('expense-suggestions');
  const summaries=get('expense-summaries');
  const history=get<HTMLDetailsElement>('expense-history');
  const status=get('expenses-status');
  const error=get('expenses-error');
  const review=get('expense-review');
  const recovery=get('expense-recovery');
  const retry=get<HTMLButtonElement>('expense-retry');
  const discard=get<HTMLButtonElement>('expense-discard-retry');
  const cancel=get<HTMLButtonElement>('expense-cancel');
  let tripId:string|null=null,ledger:ExpenseLedger|null=null,editing:Expense|null=null;
  let sequence=0,saving=false,needsRefresh=false,needsReview=false;
  let uncertainMutation:ExpenseMutation|null=null;
  for(const code of currencies)currencyField.add(new Option(code,code,code===defaultExpenseCurrency,code===defaultExpenseCurrency));
  const selectedCurrency=()=>currencyField.value as ExpenseCurrency;

  function updateControls(){
    close.disabled=saving;
    refresh.disabled=saving;
    const blocked=saving||uncertainMutation!==null;
    submit.disabled=blocked||!ledger||needsRefresh||needsReview;
    cancel.disabled=blocked;
    add.disabled=blocked;
    recovery.hidden=uncertainMutation===null;
    retry.disabled=saving;
    discard.disabled=saving;
    retry.textContent=uncertainMutation?.name==='void_trip_expense'?'Retry original void':'Retry original save';
    for(const button of list.querySelectorAll('button'))button.disabled=blocked;
    for(const field of form.querySelectorAll<HTMLInputElement|HTMLSelectElement>('input,select')){
      field.disabled=blocked;
    }
  }
  function reportError(message:string){
    error.textContent=message;
    if(!form.hidden)error.scrollIntoView({block:'nearest'});
  }
  function label(person:Traveler){
    const roster=ledger!.travelers;
    const ordinal=roster.indexOf(person)+1;
    if(!person.name)return `Archived traveler (${ordinal})`;
    const duplicate=roster.some(other=>other!==person&&other.name.toLowerCase()===person.name.toLowerCase());
    return `${person.name}${duplicate?` (${ordinal})`:''}${person.archived?' · archived':''}`;
  }
  function travelerName(id:string){
    const person=ledger?.travelers.find(row=>row.id===id);
    return person?label(person):'Traveler';
  }
  function shareList(shares:ExpenseShare[],currency:ExpenseCurrency){
    const items=element('ul');
    for(const share of shares)items.append(element('li',`${travelerName(share.travelerId)} · ${money(share.amountMinor,currency)}`));
    return items;
  }
  function action(text:string,run:()=>void){
    const button=element('button',text);
    button.type='button';button.className='subtle';button.onclick=run;
    return button;
  }
  function clearForm(){
    editing=null;
    needsRefresh=false;
    needsReview=false;
    uncertainMutation=null;
    form.reset();
    form.hidden=true;
    payer.replaceChildren();
    choices.replaceChildren();
    preview.replaceChildren();
    review.replaceChildren();
  }
  function reviewLatest(){
    review.replaceChildren();
    needsReview=false;
    if(!editing||!ledger)return;
    const reviewedLedger=ledger;
    const latest=ledger.expenses.find(expense=>expense.id===editing?.id);
    if(latest?.revision===editing.revision)return;
    needsReview=true;
    if(!latest){
      review.append(element('p','This expense was voided. You can review your draft, then cancel the correction.'));
      return;
    }
    const accept=action('Keep my draft',()=>{
      if(ledger!==reviewedLedger)return;
      editing=latest;
      renderPeople(payer.value,new Set(included()));
      updatePreview();
      reviewLatest();
      updateControls();
      status.textContent='Draft kept. Review the form and save when ready.';
      title.focus();
    });
    review.append(element('h4','This expense changed. Review the latest saved version.'),element('p',`${latest.title} · ${money(latest.amountMinor,latest.currency)}`),
      element('p',`${latest.paidOn} · Paid by ${travelerName(latest.payerId)}`),shareList(latest.shares,latest.currency),accept);
  }
  function renderSummaries(groups:ExpenseLedger['currencySummaries']){
    for(const {currency,balances:rows,suggestions:transfers} of groups){
      const balanceList=element('ul');
      for(const balance of rows){
        const row=element('li');
        let summary='No balance';
        if(balance.balanceMinor>0)summary=`Gets back ${money(balance.balanceMinor,currency)}`;
        if(balance.balanceMinor<0)summary=`Owes ${money(-balance.balanceMinor,currency)}`;
        row.append(element('strong',`${travelerName(balance.travelerId)} · ${summary}`),
          element('small',`Paid ${money(balance.paidMinor,currency)} · Share ${money(balance.shareMinor,currency)}`));
        balanceList.append(row);
      }
      balances.append(element('h4',currency),balanceList);

      const transferList=element('ul');
      for(const {fromTravelerId,toTravelerId,amountMinor} of transfers){
        transferList.append(element('li',`${travelerName(fromTravelerId)} pays ${travelerName(toTravelerId)} · ${money(amountMinor,currency)}`));
      }
      suggestions.append(element('h4',currency),transfers.length?transferList:element('p','No repayment suggested.'));
    }
  }
  function render(){
    const roster=ledger?.travelers??[];
    add.hidden=!ledger?.owner||!roster.some(person=>!person.archived);
    get('expense-roster-hint').hidden=!ledger?.owner||!add.hidden;
    list.replaceChildren();
    balances.replaceChildren();
    suggestions.replaceChildren();
    summaries.hidden=!ledger?.currencySummaries.length;
    get('expense-history-list').replaceChildren();
    history.hidden=!ledger?.history.length;
    if(!ledger)return;
    renderSummaries(ledger.currencySummaries);
    if(!ledger.expenses.length)list.append(element('p','No expenses recorded yet.'));
    for(const expense of ledger.expenses){
      const row=element('div'),details=element('details');
      row.className='expense-entry';
      details.append(element('summary',`${expense.title} · ${money(expense.amountMinor,expense.currency)}`),
        element('p',`${expense.paidOn} · Paid by ${travelerName(expense.payerId)}`),shareList(expense.shares,expense.currency));
      row.append(details);
      if(ledger.owner){
        const edit=action('Correct',()=>openForm(expense)),voidButton=action('Void',()=>{
          if(saving||uncertainMutation||needsRefresh||!window.confirm(`Void “${expense.title}”? It will stop counting towards balances and stay in the expense history.`))return;
          startMutation('void_trip_expense',{expenseId:expense.id});
        });
        edit.setAttribute('aria-label',`Correct ${expense.title}`);
        voidButton.setAttribute('aria-label',`Void ${expense.title}`);
        row.append(edit,voidButton);
      }
      list.append(row);
    }
    for(const event of ledger.history){
      const details=element('details');
      details.append(element('summary',`${event.action[0]!.toUpperCase()+event.action.slice(1)} · ${event.title} · ${money(event.amountMinor,event.currency)}`),
        element('p',`${new Date(event.createdAt).toLocaleString('en-GB')} · Paid by ${travelerName(event.payerId)}`),shareList(event.shares,event.currency));
      get('expense-history-list').append(details);
    }
  }
  async function load(){
    if(!tripId)return;
    const request=++sequence;
    ledger=null;
    reviewLatest();
    render();
    updateControls();
    refresh.disabled=true;
    error.textContent='';
    status.textContent='Loading expenses…';
    try{
      const result=await transport.read(tripId);
      if(sequence!==request)return;
      ledger=result;
      needsRefresh=false;
      status.textContent='';
      render();
      if(!form.hidden&&!uncertainMutation){
        renderPeople(payer.value,new Set(included()));
        updatePreview();
        reviewLatest();
        if(!needsReview)status.textContent='Expenses refreshed. Review your draft before saving.';
      }
    }catch(cause){
      if(sequence===request){
        if(cause instanceof Error&&'status' in cause&&(cause.status===403||cause.status===404))clearForm();
        status.textContent='';reportError(errorText(cause));
      }
    }finally{if(sequence===request)updateControls();}
  }
  const included=()=>[...choices.querySelectorAll<HTMLInputElement>('input:checked')].map(input=>input.value);
  function updatePreview(){
    const currency=selectedCurrency();
    const amountMinor=parseExpenseAmount(amount.value,currency),ids=included();
    amount.placeholder=(0).toFixed(expenseCurrencies[currency]);
    preview.replaceChildren();
    if(amountMinor!==null&&ids.length)preview.append(element('p','Each traveler’s share'),shareList(equalShares(amountMinor,ids),currency));
  }
  function renderPeople(payerId:string,selected:Set<string>){
    const payers=ledger!.travelers.filter(person=>!person.archived||person.id===payerId||person.id===editing?.payerId);
    payer.replaceChildren(new Option('Choose a traveler',''),...payers.map(person=>new Option(label(person),person.id)));
    payer.value=payerId;
    choices.replaceChildren();
    for(const person of ledger!.travelers){
      if(person.archived&&!selected.has(person.id)&&!editing?.shares.some(share=>share.travelerId===person.id))continue;
      const row=element('label'),input=element('input');
      input.type='checkbox';input.value=person.id;input.checked=selected.has(person.id);
      row.append(input,element('span',label(person)));
      choices.append(row);
    }
  }
  function openForm(expense?:Expense){
    if(saving||uncertainMutation||!ledger?.owner)return;
    clearForm();
    editing=expense??null;
    const selected=new Set(expense?.shares.map(share=>share.travelerId)??ledger.travelers.filter(person=>!person.archived).map(person=>person.id));
    renderPeople(expense?.payerId??'',selected);
    if(expense){
      title.value=expense.title;
      date.value=expense.paidOn;
      currencyField.value=expense.currency;
      amount.value=majorAmount(expense.amountMinor,expense.currency).toFixed(expenseCurrencies[expense.currency]);
    }
    get('expense-editor-title').textContent=expense?'Correct expense':'Add expense';
    error.textContent='';
    form.hidden=false;
    updateControls();
    updatePreview();
    title.focus();
  }
  function startMutation(name:ExpenseMutation['name'],payload:Record<string,unknown>){
    if(!tripId||saving||uncertainMutation||!ledger?.owner||needsRefresh||needsReview)return;
    void sendMutation({name,args:{...payload,tripId,expectedRevision:ledger.revision,idempotencyKey:crypto.randomUUID()}});
  }
  async function sendMutation(mutation:ExpenseMutation){
    if(saving)return;
    const request=sequence;
    saving=true;
    updateControls();
    error.textContent='';
    try{
      await transport.mutate(mutation.name,mutation.args);
      if(sequence!==request)return;
      clearForm();
      await load();
      if(ledger&&dialog.open)status.textContent=mutation.name==='void_trip_expense'?'Expense voided.':'Expense saved.';
    }catch(cause){
      if(sequence!==request)return;
      uncertainMutation=isTemporaryReadError(cause)?mutation:null;
      needsRefresh=cause instanceof Error&&'code' in cause&&cause.code==='REVISION_CONFLICT';
      reportError(errorText(cause));
    }finally{saving=false;updateControls();}
  }
  launch.onclick=()=>{dialog.showModal();void load();};
  close.onclick=()=>dialog.close();
  refresh.onclick=()=>{void load();};
  add.onclick=()=>openForm();
  cancel.onclick=()=>{if(!saving&&!uncertainMutation){clearForm();add.focus();}};
  retry.onclick=()=>{if(uncertainMutation)void sendMutation(uncertainMutation);};
  discard.onclick=()=>{
    if(saving||!uncertainMutation)return;
    clearForm();
    void load();
  };
  amount.oninput=updatePreview;
  currencyField.onchange=updatePreview;
  choices.onchange=updatePreview;
  form.onsubmit=event=>{
    event.preventDefault();
    if(saving||uncertainMutation)return;
    const currency=selectedCurrency();
    const amountMinor=parseExpenseAmount(amount.value,currency),travelerIds=included();
    if(amountMinor===null){
      const digits=expenseCurrencies[currency];
      const precision=digits?` with up to ${digits} decimal places`:' as a whole number';
      reportError(`Enter a positive ${currency} amount${precision}, up to ${money(maxExpenseMinor,currency)}.`);
      return;
    }
    if(!travelerIds.length){reportError('Choose at least one traveler for the split.');return;}
    const expense={title:title.value,paidOn:date.value,payerId:payer.value,currency,amountMinor,travelerIds};
    startMutation('save_trip_expense',{...(editing?{expenseId:editing.id}:{}),expense});
  };
  dialog.addEventListener('cancel',event=>{if(saving)event.preventDefault();});
  dialog.addEventListener('close',()=>{
    if(dialog.open)return;
    sequence++;ledger=null;
    if(!uncertainMutation)clearForm();
    render();
    history.open=false;status.textContent='';error.textContent='';
  });
  return {update(nextTripId:string|null){
    launch.hidden=!nextTripId;
    if(nextTripId===tripId)return;
    tripId=nextTripId;sequence++;ledger=null;clearForm();render();
    if(dialog.open)dialog.close();
  }};
}
