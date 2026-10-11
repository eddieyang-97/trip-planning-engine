import { mkdir, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { accommodationProbeLimit, accommodationQuery, runAccommodationProbe } from '../src/accommodation-probe.js';
import { formatProbeReport } from '../src/serpapi-probe.js';

const args=process.argv.slice(2),apiKey=process.env.SERPAPI_API_KEY??'';
if(args.length===0) {
  console.log(JSON.stringify({mode:'plan_only',networkRequests:0,maximumSearchRequests:accommodationProbeLimit,
    queries:(['hotels','rentals','airbnb'] as const).map(mode=>({mode,query:accommodationQuery(mode)})),
    flow:['Free-plan/quota check','Three first-page searches','At most one Google property detail per hotel/rental mode'],
    limitation:'No proven two-room allocation, complete party price, final availability or booking.',
    next:'Set SERPAPI_API_KEY in ignored .env, then run npm run probe:accommodation -- --live.'},null,2));
}else if(args.length!==1||args[0]!=='--live') {
  console.error('Use no arguments for the plan or --live for the bounded accommodation probe.');process.exitCode=1;
}else if(!apiKey.trim()) {
  console.error('SERPAPI_API_KEY is missing. No network requests were made.');process.exitCode=1;
}else {
  const directory=resolve('.data/provider-probe');await mkdir(directory,{recursive:true});
  let ledger;
  try{ledger=await open(resolve(directory,'accommodation-attempts.jsonl'),'wx',0o600);}
  catch{console.error('Accommodation ledger exists or cannot be created. Inspect the previous attempt before authorizing another budget.');process.exitCode=1;}
  if(ledger)try {
    const report=await runAccommodationProbe({apiKey,record:async event=>{
      await ledger.writeFile(JSON.stringify({...event,recordedAt:new Date().toISOString()})+'\n');await ledger.sync();
    }});
    console.log(formatProbeReport(report,apiKey));
    if(report.status!=='completed')process.exitCode=1;
  }finally{await ledger.close();}
}
