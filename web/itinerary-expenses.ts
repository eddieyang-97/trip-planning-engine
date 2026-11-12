import {equalShares,parsePounds,type ExpenseShare} from '../src/expense-split.js';
import type {Expense,ExpenseLedger} from '../src/trip-expenses.js';
import type {Traveler} from '../src/itinerary-travelers.js';
import {isTemporaryReadError} from './itinerary-read-response.js';

const gbp=new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'});
const money=(pennies:number)=>gbp.format(pennies/100);
const get=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const errorText=(error:unknown)=>error instanceof Error?error.message:'Unable to load trip expenses.';
function element<K extends keyof HTMLElementTagNameMap>(tag:K,value=''){
  const node=document.createElement(tag);
  node.textContent=value;
  return node;
}

export function configureExpenses(transport:{
  read:(tripId:string)=>Promise<ExpenseLedger>;
  mutate:(name:'save_trip_expense'|'void_trip_expense',args:Record<string,unknown>)=>Promise<unknown>;
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
  const amount=get<HTMLInputElement>('expense-amount');
  const payer=get<HTMLSelectElement>('expense-payer');
  const choices=get('expense-travelers');
  const preview=get('expense-preview');
  const list=get('expense-list');
  const balances=get('expense-balances');
  const history=get<HTMLDetailsElement>('expense-history');
  const status=get('expenses-status');
  const error=get('expenses-error');
  const review=get('expense-review');
  let tripId:string|null=null,ledger:ExpenseLedger|null=null,editing:Expense|null=null;
  let sequence=0,saving=false,needsRefresh=false,needsReview=false;
  let uncertainSave:Record<string,unknown>|null=null;

  function updateControls(){
    close.disabled=saving;
    refresh.disabled=saving;
    submit.disabled=saving||(!uncertainSave&&(!ledger||needsRefresh||needsReview));
    for(const field of form.querySelectorAll<HTMLInputElement|HTMLSelectElement>('input,select')){
      field.disabled=saving||!!uncertainSave;
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
  function shareList(shares:ExpenseShare[]){
    const items=element('ul');
    for(const share of shares)items.append(element('li',`${travelerName(share.travelerId)} · ${money(share.amountMinor)}`));
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
    uncertainSave=null;
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
    review.append(element('h4','This expense changed. Review the latest saved version.'),element('p',`${latest.title} · ${money(latest.amountMinor)}`),
      element('p',`${latest.paidOn} · Paid by ${travelerName(latest.payerId)}`),shareList(latest.shares),accept);
  }
  function render(){
    const roster=ledger?.travelers??[];
    add.hidden=!ledger?.owner||!roster.some(person=>!person.archived);
    get('expense-roster-hint').hidden=!ledger?.owner||!add.hidden;
    list.replaceChildren();
    balances.replaceChildren();
    get('expense-history-list').replaceChildren();
    history.hidden=!ledger?.history.length;
    if(!ledger)return;
    const used=new Set(ledger.expenses.flatMap(expense=>[expense.payerId,...expense.shares.map(share=>share.travelerId)]));
    for(const balance of ledger.balances){
      if(!used.has(balance.travelerId))continue;
      const row=element('li');
      const summary=balance.balanceMinor>0?`Gets back ${money(balance.balanceMinor)}`:balance.balanceMinor<0?`Owes ${money(-balance.balanceMinor)}`:'Settled';
      row.append(element('strong',`${travelerName(balance.travelerId)} · ${summary}`),element('small',`Paid ${money(balance.paidMinor)} · Share ${money(balance.shareMinor)}`));
      balances.append(row);
    }
    if(!ledger.expenses.length)list.append(element('p','No expenses recorded yet.'));
    for(const expense of ledger.expenses){
      const row=element('div'),details=element('details');
      row.className='expense-entry';
      details.append(element('summary',`${expense.title} · ${money(expense.amountMinor)}`),
        element('p',`${expense.paidOn} · Paid by ${travelerName(expense.payerId)}`),shareList(expense.shares));
      row.append(details);
      if(ledger.owner){
        const edit=action('Correct',()=>openForm(expense)),voidButton=action('Void',()=>{
          if(saving||!window.confirm(`Void “${expense.title}”? It will stop counting towards balances and stay in the expense history.`))return;
          void save('void_trip_expense',{expenseId:expense.id});
        });
        edit.setAttribute('aria-label',`Correct ${expense.title}`);
        voidButton.setAttribute('aria-label',`Void ${expense.title}`);
        row.append(edit,voidButton);
      }
      list.append(row);
    }
    for(const event of ledger.history){
      const details=element('details');
      details.append(element('summary',`${event.action[0]!.toUpperCase()+event.action.slice(1)} · ${event.title} · ${money(event.amountMinor)}`),
        element('p',`${new Date(event.createdAt).toLocaleString('en-GB')} · Paid by ${travelerName(event.payerId)}`),shareList(event.shares));
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
      if(!form.hidden&&!uncertainSave){
        renderPeople(payer.value,new Set(included()));
        updatePreview();
        reviewLatest();
        if(!needsReview)status.textContent='Expenses refreshed. Review your draft before saving.';
      }else if(uncertainSave){
        status.textContent='Retry the previous save to check its outcome. Your draft is still here.';
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
    const pennies=parsePounds(amount.value),ids=included();
    preview.replaceChildren();
    if(pennies!==null&&ids.length)preview.append(element('p','Each traveler’s share'),shareList(equalShares(pennies,ids)));
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
    if(saving||!ledger?.owner)return;
    clearForm();
    editing=expense??null;
    const selected=new Set(expense?.shares.map(share=>share.travelerId)??ledger.travelers.filter(person=>!person.archived).map(person=>person.id));
    renderPeople(expense?.payerId??'',selected);
    if(expense){title.value=expense.title;date.value=expense.paidOn;amount.value=(expense.amountMinor/100).toFixed(2);}
    get('expense-editor-title').textContent=expense?'Correct expense':'Add expense';
    error.textContent='';
    form.hidden=false;
    updateControls();
    updatePreview();
    title.focus();
  }
  async function save(name:'save_trip_expense'|'void_trip_expense',payload:Record<string,unknown>){
    if(!tripId||saving)return;
    if(!uncertainSave&&(!ledger||needsRefresh||needsReview))return;
    const request=sequence;
    const args=uncertainSave??{...payload,tripId,expectedRevision:ledger!.revision};
    saving=true;
    updateControls();
    error.textContent='';
    try{
      await transport.mutate(name,args);
      if(sequence!==request)return;
      clearForm();
      await load();
      if(ledger&&dialog.open)status.textContent=name==='void_trip_expense'?'Expense voided.':'Expense saved.';
    }catch(cause){
      if(sequence!==request)return;
      uncertainSave=name==='save_trip_expense'&&isTemporaryReadError(cause)?args:null;
      needsRefresh=cause instanceof Error&&'code' in cause&&cause.code==='REVISION_CONFLICT';
      reportError(errorText(cause));
    }finally{saving=false;updateControls();}
  }
  launch.onclick=()=>{dialog.showModal();void load();};
  close.onclick=()=>dialog.close();
  refresh.onclick=()=>{void load();};
  add.onclick=()=>openForm();
  get('expense-cancel').onclick=()=>{if(!saving){clearForm();add.focus();}};
  amount.oninput=updatePreview;
  choices.onchange=updatePreview;
  form.onsubmit=event=>{
    event.preventDefault();
    if(uncertainSave){void save('save_trip_expense',{});return;}
    const amountMinor=parsePounds(amount.value),travelerIds=included();
    if(amountMinor===null){reportError('Enter a positive amount in pounds with up to two decimal places.');return;}
    if(!travelerIds.length){reportError('Choose at least one traveler for the split.');return;}
    const expense={title:title.value,paidOn:date.value,payerId:payer.value,currency:'GBP',amountMinor,travelerIds};
    void save('save_trip_expense',{...(editing?{expenseId:editing.id}:{}),expense});
  };
  dialog.addEventListener('cancel',event=>{if(saving)event.preventDefault();});
  dialog.addEventListener('close',()=>{
    if(dialog.open)return;
    sequence++;ledger=null;clearForm();render();
    history.open=false;status.textContent='';error.textContent='';
  });
  return {update(nextTripId:string|null){
    launch.hidden=!nextTripId;
    if(nextTripId===tripId)return;
    tripId=nextTripId;sequence++;ledger=null;clearForm();render();
    if(dialog.open)dialog.close();
  }};
}
