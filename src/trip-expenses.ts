import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {DomainError,mutation,uuid} from './domain.js';
import type {Queryable} from './database.js';
import {itineraryAccess} from './itinerary.js';
import {readTravelers,travelerIds,type Traveler} from './itinerary-travelers.js';
import {defaultExpenseCurrency,equalShares,expenseCurrencies,maxExpenseMinor,suggestSettlements,
  type Balance,type ExpenseCurrency,type ExpenseShare,type Settlement} from './expense-split.js';

const id=uuid.transform(value=>value.toLowerCase());
const expense=z.strictObject({
  title:z.string().trim().min(1).max(120),
  paidOn:z.iso.date(),
  payerId:id,
  currency:z.enum(Object.keys(expenseCurrencies) as ExpenseCurrency[]),
  amountMinor:z.number().int().min(1).max(maxExpenseMinor),
  travelerIds:travelerIds.refine(ids=>ids.length>0,'Choose at least one traveler for the split.'),
});
const edit={...mutation,tripId:uuid,expectedRevision:z.number().int().nonnegative()};
export const expenseSchemas={
  get_trip_expenses:z.strictObject({tripId:uuid,currencyAware:z.literal(true).optional()}),
  save_trip_expense:z.strictObject({...edit,expenseId:id.optional(),expense}),
  void_trip_expense:z.strictObject({...edit,expenseId:id}),
};
type Detail={title:string;paidOn:string;payerId:string;shares:ExpenseShare[]};
type Event={expense_id:string;revision:number;action:'recorded'|'corrected'|'voided';currency:ExpenseCurrency;amount_minor:number;detail:Detail;created_at:Date};
export type Expense=Detail&{id:string;currency:ExpenseCurrency;amountMinor:number;revision:number};
type CurrencySummary={currency:ExpenseCurrency;balances:Balance[];suggestions:Settlement[]};
export type ExpenseLedger={revision:number;owner:boolean;travelers:Traveler[];expenses:Expense[];currencySummaries:CurrencySummary[];
  history:(Expense&{action:Event['action'];createdAt:string})[]};

function fail(code:string,message:string):never{throw new DomainError(code,message);}
const projection='expense_id,revision,action,currency,amount_minor,detail,created_at';
const currentExpenses=`select distinct on (expense_id) ${projection} from trip_expense_events where trip_id=$1 order by expense_id,revision desc`;

function toExpense(row:Event):Expense{
  return {...row.detail,id:row.expense_id,currency:row.currency,amountMinor:row.amount_minor,revision:row.revision};
}

const zeroBalance=(travelerId:string):Balance=>({travelerId,paidMinor:0,shareMinor:0,balanceMinor:0});

function currencySummaries(expenses:Expense[],travelers:Traveler[]):CurrencySummary[]{
  const totals=new Map<ExpenseCurrency,Map<string,Balance>>();
  for(const entry of expenses){
    const group=totals.get(entry.currency)??new Map<string,Balance>();
    totals.set(entry.currency,group);
    const payer=group.get(entry.payerId)??zeroBalance(entry.payerId);
    payer.paidMinor+=entry.amountMinor;
    payer.balanceMinor+=entry.amountMinor;
    group.set(entry.payerId,payer);
    for(const {travelerId,amountMinor} of entry.shares){
      const traveler=group.get(travelerId)??zeroBalance(travelerId);
      traveler.shareMinor+=amountMinor;
      traveler.balanceMinor-=amountMinor;
      group.set(travelerId,traveler);
    }
  }
  return [...totals.keys()].sort().map(currency=>{
    const group=totals.get(currency)!;
    const balances=travelers.flatMap(({id})=>group.has(id)?[group.get(id)!]:[]);
    return {currency,balances,suggestions:suggestSettlements(balances)};
  });
}

export async function dispatchExpense(tx:Queryable,name:keyof typeof expenseSchemas,args:z.infer<(typeof expenseSchemas)[keyof typeof expenseSchemas]>,userId:string){
  const {tripId}=args,reading=name==='get_trip_expenses';
  const {role}=await itineraryAccess(tx,tripId,userId,!reading,false);
  const owner=role==='owner';
  const revision=(await tx.query<{revision:number}>('select revision from trip_expense_events where trip_id=$1 order by revision desc limit 1',[tripId])).rows[0]?.revision??0;
  if(reading){
    const travelers=await readTravelers(tx,tripId,owner);
    const current=(await tx.query<Event>(`select * from (${currentExpenses}) current where action<>'voided' order by detail->>'paidOn' desc,revision desc`,[tripId])).rows;
    const expenses=current.map(toExpense);
    const events=owner?(await tx.query<Event>(`select ${projection} from trip_expense_events where trip_id=$1 order by revision desc limit 30`,[tripId])).rows:[];
    const history=events.map(row=>({...toExpense(row),action:row.action,createdAt:new Date(row.created_at).toISOString()}));
    const ledger={revision,owner,travelers,expenses,history};
    const summaries=currencySummaries(expenses,travelers);
    if('currencyAware' in args&&args.currencyAware)return {...ledger,currencySummaries:summaries} satisfies ExpenseLedger;
    // An open GBP-only page would otherwise display foreign minor units as pounds.
    if(summaries.some(group=>group.currency!==defaultExpenseCurrency)||history.some(event=>event.currency!==defaultExpenseCurrency)){
      fail('VALIDATION_ERROR','Reload the itinerary page to view expenses in multiple currencies.');
    }
    const byTraveler=new Map(summaries[0]?.balances.map(balance=>[balance.travelerId,balance]));
    return {...ledger,balances:travelers.map(({id})=>byTraveler.get(id)??zeroBalance(id))};
  }
  if(!('expectedRevision' in args)||args.expectedRevision!==revision)fail('REVISION_CONFLICT','Expenses changed. Refresh the ledger and review the latest amounts before saving.');
  const existing=args.expenseId?(await tx.query<Event>(
    `select ${projection} from trip_expense_events where trip_id=$1 and expense_id=$2 order by revision desc limit 1`,[tripId,args.expenseId])).rows[0]:undefined;
  if(args.expenseId&&(!existing||existing.action==='voided'))fail('FORBIDDEN_OR_NOT_FOUND','This expense is unavailable.');
  const expenseId=args.expenseId??randomUUID();
  let next:{action:Event['action'];currency:ExpenseCurrency;amountMinor:number;detail:Detail};
  if('expense' in args){
    const {title,paidOn,payerId,currency,amountMinor,travelerIds:included}=args.expense;
    const roster=new Map((await readTravelers(tx,tripId,true)).map(person=>[person.id,person]));
    const payer=roster.get(payerId);
    const previousShares=new Set(existing?.detail.shares.map(share=>share.travelerId));
    if(!payer||payer.archived&&existing?.detail.payerId!==payerId||included.some(person=>!roster.has(person)||roster.get(person)!.archived&&!previousShares.has(person))){
      fail('VALIDATION_ERROR','Choose active travelers from this trip. An archived traveler can stay on an expense in their existing role.');
    }
    if(!existing){
      const count=(await tx.query<{n:number}>(`select count(*)::int as n from (${currentExpenses}) current where action<>'voided'`,[tripId])).rows[0]!.n;
      if(count>=500)fail('BUDGET_EXCEEDED','This trip supports up to 500 active expenses.');
    }
    next={action:existing?'corrected':'recorded',currency,amountMinor,detail:{title,paidOn,payerId,shares:equalShares(amountMinor,included)}};
  }else{
    if(!existing)fail('FORBIDDEN_OR_NOT_FOUND','This expense is unavailable.');
    next={action:'voided',currency:existing.currency,amountMinor:existing.amount_minor,detail:existing.detail};
  }
  await tx.query('insert into trip_expense_events(trip_id,revision,expense_id,actor_id,action,currency,amount_minor,detail) values($1,$2,$3,$4,$5,$6,$7,$8)',
    [tripId,revision+1,expenseId,userId,next.action,next.currency,next.amountMinor,JSON.stringify(next.detail)]);
  return {expenseId,revision:revision+1};
}
