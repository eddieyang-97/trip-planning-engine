import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { flaineLocationQuery, OpenStreetMapDiscovery, requestOverpass, selectFlaineCenter } from '../src/places.js';

const args=process.argv.slice(2);
if(args.length===0) {
  console.log(JSON.stringify({mode:'plan_only',requests:0,liveRequestLimit:2,location:'Flaine',radiusMeters:2500,
    categories:['restaurants and cafes','hotels and other lodging'],apiKeyRequired:false,
    limitation:'Discovery only. No room prices, room inventory, opening confirmation or reservation slots.'},null,2));
}else if(args.length===1&&args[0]==='--live') {
  try {
    const center=selectFlaineCenter(await requestOverpass(flaineLocationQuery));
    const result=await new OpenStreetMapDiscovery().discover(center,2500);
    const directory=resolve('.data/places-probe');await mkdir(directory,{recursive:true});
    const path=resolve(directory,`flaine-${Date.now()}.json`);
    await writeFile(path,JSON.stringify({center,radiusMeters:2500,...result},null,2),{flag:'wx'});
    const categories=Object.fromEntries([...new Set(result.places.map(p=>p.category))].map(c=>[c,result.places.filter(p=>p.category===c).length]));
    console.log(JSON.stringify({status:'live_discovery_complete',requests:2,center,count:result.places.length,categories,
      coverage:result.coverage,attribution:result.attribution,evidencePath:path,
      examples:result.places.filter(p=>p.name).slice(0,6).map(p=>({name:p.name,category:p.category,sourceUrl:p.sourceUrl,availability:p.availability}))},null,2));
  }catch(error){console.error(error instanceof Error?error.message:'Discovery failed.');process.exitCode=1;}
}else{console.error('Use no arguments for the plan or --live for two read-only Overpass queries.');process.exitCode=1;}
