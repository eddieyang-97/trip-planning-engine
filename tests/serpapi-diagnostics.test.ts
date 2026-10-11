import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serpApiDiagnostic} from '../src/serpapi-diagnostics.js';
import {runAccommodationProbe} from '../src/accommodation-probe.js';
import {runSerpApiProbe} from '../src/serpapi-probe.js';

test('provider diagnostics classify errors without copying secrets or arbitrary text',()=>{
  const key='abcdef0123456789abcdef01',id='1234567890abcdef12345678';
  const result=serpApiDiagnostic({error:`Google hasn't returned any results for this query. https://example.com/?api_key=${key}&token=private`,search_metadata:{id}},200,key);
  assert.deepEqual(result,{httpStatus:200,category:'no_results',searchId:id});
  assert.equal(serpApiDiagnostic({search_metadata:{id:key}},200,key).searchId,null);
  assert.equal(serpApiDiagnostic({search_metadata:{id:'https://example.com/private'}},200,key).searchId,null);
  assert.equal(serpApiDiagnostic({error:'arbitrary confidential message'},200,key).category,'unclassified');
  assert.equal(serpApiDiagnostic({},429,key).category,'quota_or_rate_limit');
  assert.equal(serpApiDiagnostic({},403,key).category,'access_denied');
});

test('both probes record safe diagnostics, stop after one failure and suppress non-JSON error bodies',async()=>{
  const account={account_status:'Active',plan_monthly_price:0,plan_searches_left:100,account_rate_limit_per_hour:20,this_hour_searches:0};
  for(const runner of [runAccommodationProbe,runSerpApiProbe])for(const mode of ['json','html'] as const) {
    const events:unknown[]=[];let requests=0;
    const report=await runner({apiKey:'private-key',record:async event=>{events.push(event);},send:async input=>{
      if(String(input).includes('/account.json'))return Response.json(account);
      requests++;
      return mode==='json'?Response.json({error:"Google hasn't returned any results for this query. private-key",search_metadata:{id:'1234567890abcdef12345678'}})
        :new Response('<html>private-key</html>',{status:503});
    }});
    assert.equal(requests,1);assert.equal(report.requestsAttempted,1);
    assert.equal(report.status,mode==='json'?'stopped':'outcome_unknown');
    assert.equal('diagnostic' in report&&report.diagnostic?.category,mode==='json'?'no_results':'upstream_failure');
    assert.equal(JSON.stringify({report,events}).includes('private-key'),false);
    assert.equal(events.length,2);
  }
});
