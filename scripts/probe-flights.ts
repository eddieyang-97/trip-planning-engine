import { mkdir, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { formatProbeReport, probeLimit, probeQuery, runSerpApiProbe } from '../src/serpapi-probe.js';

const arguments_=process.argv.slice(2);
if(arguments_.length===0) {
  console.log(JSON.stringify({mode:'plan_only',networkRequests:0,query:probeQuery,maximumSearchRequests:probeLimit,
    flow:['Free-plan/quota check','Outbound → selected return → seller options','Repeat the same pair once'],
    next:'Set SERPAPI_API_KEY in ignored .env, then run npm run probe:flights -- --live. Do not paste keys in chat.'},null,2));
} else if(arguments_.length!==1||arguments_[0]!=='--live') {
  console.error('Use no arguments for the plan, or --live for the bounded capability test.');process.exitCode=1;
} else if(!process.env.SERPAPI_API_KEY?.trim()) {
  console.error('SERPAPI_API_KEY is missing. Add it to the ignored .env file; no network requests were made.');process.exitCode=1;
} else {
  // Exclusive creation prevents concurrent or accidental reruns. Do not auto-delete on errors.
  const directory=resolve('.data/provider-probe');await mkdir(directory,{recursive:true});
  let ledger;
  try{ledger=await open(resolve(directory,'serpapi-attempts.jsonl'),'wx',0o600);}
  catch{console.error('Probe ledger already exists or cannot be created. Inspect the previous run before explicitly authorizing another six requests.');process.exitCode=1;}
  if(ledger)try {
    const report=await runSerpApiProbe({apiKey:process.env.SERPAPI_API_KEY,record:async event=>{
      await ledger.writeFile(JSON.stringify({...event,recordedAt:new Date().toISOString()})+'\n');await ledger.sync();
    }});
    // No raw responses, prices, API keys, tokens or account details are saved to the ledger or database.
    console.log(formatProbeReport(report,process.env.SERPAPI_API_KEY));
    if(report.status!=='completed')process.exitCode=1;
  }finally{await ledger.close();}
}
