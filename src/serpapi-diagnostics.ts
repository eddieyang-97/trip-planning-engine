// Never return free-form provider errors: they can echo URLs, keys or handoff tokens.
export function serpApiDiagnostic(body:Record<string,unknown>,httpStatus:number,apiKey:string) {
  const metadata=body.search_metadata&&typeof body.search_metadata==='object'
    ?body.search_metadata as Record<string,unknown>:{};
  const id=metadata.id;
  const searchId=typeof id==='string'&&/^[a-f0-9]{24,32}$/i.test(id)&&!id.includes(apiKey)&&apiKey
    ?id:null;
  const message=typeof body.error==='string'?body.error:'';
  let category:'no_results'|'quota_or_rate_limit'|'access_denied'|'invalid_parameters'|'upstream_failure'|'unclassified'='unclassified';
  if(httpStatus===429||/run out of searches|search limit|rate limit|quota exceeded/i.test(message))category='quota_or_rate_limit';
  else if(httpStatus===401||httpStatus===403||/invalid api key|not authorized|unauthorized/i.test(message))category='access_denied';
  else if(/hasn.t returned any results|no results (?:found|returned)|couldn.t find any results/i.test(message))category='no_results';
  else if(httpStatus===400||/missing.*(?:parameter|field)|invalid.*(?:parameter|date)|parameter.*(?:invalid|required)/i.test(message))category='invalid_parameters';
  else if(httpStatus>=500||/failed to fetch|failed to retrieve|temporarily unavailable/i.test(message))category='upstream_failure';
  return {httpStatus,category,searchId};
}
export type SerpApiDiagnostic=ReturnType<typeof serpApiDiagnostic>;
