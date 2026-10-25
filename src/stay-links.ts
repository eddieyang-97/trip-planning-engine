// Transport projection only: the origin is trusted service configuration, never
// a Host header or tool argument. Durable receipts keep relative navigation.
export function withStayWebUrls<T extends Record<string,any>>(result:T,publicOrigin:string):T{
  const origin=new URL(publicOrigin);
  if(origin.origin!==publicOrigin||!['http:','https:'].includes(origin.protocol))throw Error('Invalid public origin');
  const link=(value:any)=>{
    if(!value||typeof value.webPath!=='string'||!value.webPath.startsWith('/itinerary?'))return;
    const url=new URL(value.webPath,origin);
    if(url.origin===origin.origin&&url.pathname==='/itinerary')value.webUrl=url.href;
  };
  link(result);
  for(const decision of result.decisions??[]){link(decision);link(decision.stay);}
  for(const decision of result.stayResearch?.decisions??[])link(decision);
  for(const item of result.items??[])link(item.sourceLink);
  return result;
}
