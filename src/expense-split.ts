export const maxExpensePennies=100_000_000;

export function parsePounds(value:string){
  const match=/^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if(!match)return null;
  const pennies=Number(match[1])*100+Number((match[2]??'').padEnd(2,'0'));
  return pennies>0&&pennies<=maxExpensePennies?pennies:null;
}

export type ExpenseShare={travelerId:string;amountMinor:number};

// Stable UUID order makes the extra pennies independent of name, UI order and retries.
// Callers validate the amount and require at least one distinct traveler.
export function equalShares(amountMinor:number,travelerIds:readonly string[]):ExpenseShare[]{
  const base=Math.floor(amountMinor/travelerIds.length);
  const extra=amountMinor%travelerIds.length;
  return [...travelerIds].sort().map((travelerId,index)=>({travelerId,amountMinor:base+(index<extra?1:0)}));
}
