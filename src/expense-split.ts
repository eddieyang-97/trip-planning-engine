export const maxExpenseMinor=100_000_000;

// Pin the ISO 4217 precision so browsers and servers interpret saved amounts identically.
export const expenseCurrencies={
  AED:2,AUD:2,BRL:2,CAD:2,CHF:2,CNY:2,CZK:2,DKK:2,EUR:2,GBP:2,
  HKD:2,HUF:2,IDR:2,INR:2,ISK:0,JPY:0,KRW:0,KWD:3,MXN:2,MYR:2,
  NOK:2,NZD:2,PLN:2,QAR:2,SAR:2,SEK:2,SGD:2,THB:2,TRY:2,TWD:2,
  USD:2,VND:0,ZAR:2,
} as const;
export type ExpenseCurrency=keyof typeof expenseCurrencies;
export const defaultExpenseCurrency='GBP' satisfies ExpenseCurrency;

export function parseExpenseAmount(value:string,currency:ExpenseCurrency){
  const match=/^(\d{1,9})(?:[.,](\d{1,3}))?$/.exec(value.trim());
  const digits=expenseCurrencies[currency];
  const fraction=match?.[2]??'';
  if(!match||fraction.length>digits)return null;
  const amountMinor=Number(match[1])*10**digits+Number(fraction.padEnd(digits,'0'));
  return amountMinor>0&&amountMinor<=maxExpenseMinor?amountMinor:null;
}

export type ExpenseShare={travelerId:string;amountMinor:number};

// Stable UUID order makes leftover minor units independent of name, UI order and retries.
// Callers validate the amount and require at least one distinct traveler.
export function equalShares(amountMinor:number,travelerIds:readonly string[]):ExpenseShare[]{
  const base=Math.floor(amountMinor/travelerIds.length);
  const extra=amountMinor%travelerIds.length;
  return [...travelerIds].sort().map((travelerId,index)=>({travelerId,amountMinor:base+(index<extra?1:0)}));
}

export type Balance={travelerId:string;paidMinor:number;shareMinor:number;balanceMinor:number};
export type Settlement={fromTravelerId:string;toTravelerId:string;amountMinor:number};

export function suggestSettlements(balances:readonly Balance[]):Settlement[]{
  const byAmount=(a:ExpenseShare,b:ExpenseShare)=>b.amountMinor-a.amountMinor||a.travelerId.localeCompare(b.travelerId);
  const debtors:ExpenseShare[]=[],creditors:ExpenseShare[]=[];
  for(const {travelerId,balanceMinor} of balances){
    if(balanceMinor<0)debtors.push({travelerId,amountMinor:-balanceMinor});
    if(balanceMinor>0)creditors.push({travelerId,amountMinor:balanceMinor});
  }
  debtors.sort(byAmount);
  creditors.sort(byAmount);
  const suggestions:Settlement[]=[];
  let from=0,to=0;
  // Each transfer clears at least one outstanding balance in this currency.
  while(from<debtors.length&&to<creditors.length){
    const debtor=debtors[from]!,creditor=creditors[to]!;
    const amountMinor=Math.min(debtor.amountMinor,creditor.amountMinor);
    suggestions.push({fromTravelerId:debtor.travelerId,toTravelerId:creditor.travelerId,amountMinor});
    debtor.amountMinor-=amountMinor;
    creditor.amountMinor-=amountMinor;
    if(debtor.amountMinor===0)from++;
    if(creditor.amountMinor===0)to++;
  }
  return suggestions;
}
