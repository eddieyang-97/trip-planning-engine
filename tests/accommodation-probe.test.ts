import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accommodationEvidence, accommodationQuery, runAccommodationProbe, stayDates, type StayMode, type StayProbeEvent } from '../src/accommodation-probe.js';
import { formatProbeReport } from '../src/serpapi-probe.js';

const key='invented-accommodation-key';
const account={account_status:'Active',plan_monthly_price:0,plan_searches_left:100,account_rate_limit_per_hour:20,this_hour_searches:0};
const property=(mode:StayMode)=>({name:'Invented stay',type:mode==='hotels'?'hotel':'vacation rental',
  property_token:`private-token-${mode}`,link:'https://example.com/stay?tracking=private',
  rate_per_night:{extracted_lowest:100},total_rate:{extracted_lowest:220,extracted_before_taxes_fees:200},
  essential_info:['Sleeps 4','2 bedrooms'],prices:[{source:'Example seller',total_rate:{extracted_lowest:230}}]});
const rental=()=>({name:'Invented apartment',listing_id:'123',link:'https://www.airbnb.co.uk/rooms/123?adults=4',
  ...stayDates,extracted_price:240,price:'£240',price_qualifier:'total',bedrooms:2,beds:3,bathrooms:1.5,
  price_breakdown:[{description:'Total',price:'£240'}],free_cancellation:true});
function response(url:URL):any {
  if(url.pathname==='/account.json')return account;
  const mode:StayMode=url.searchParams.get('engine')==='airbnb'?'airbnb':url.searchParams.has('vacation_rentals')?'rentals':'hotels';
  const echo={...accommodationQuery(mode),...(url.searchParams.has('property_token')?{property_token:url.searchParams.get('property_token')}:{})};
  return {search_metadata:{status:'Success'},search_parameters:echo,
    ...(mode==='airbnb'?{organic_results:[rental()]}:url.searchParams.has('property_token')?property(mode):{properties:[property(mode)]})};
}
test('accommodation probe covers three modes within five reserved requests and keeps quote gaps explicit',async()=>{
  const events:StayProbeEvent[]=[],requests:URL[]=[];
  const result=await runAccommodationProbe({apiKey:key,record:async event=>{events.push(event);},send:async(input,init)=>{
    const url=new URL(String(input));requests.push(url);
    assert.equal(url.origin,'https://serpapi.com');assert.equal(init?.redirect,'error');
    if(url.pathname==='/search.json') {
      assert.equal(events.at(-1)?.status,'reserved');assert.equal(url.searchParams.get('adults'),'4');
      assert.equal(url.searchParams.get('check_in_date'),'2026-12-18');
      assert.equal(url.searchParams.get('check_out_date'),'2026-12-20');
      assert.equal(url.searchParams.has('next_page_token'),false);
    }
    return Response.json(response(url));
  }});
  assert.equal(result.status,'completed');assert.equal(result.requestsAttempted,5);assert.equal(requests.length,6);
  assert.equal(result.verifiedLiveIntegration,false);assert.equal(result.coverage.complete,false);
  assert.deepEqual(result.results.map(x=>x.mode),['hotels','rentals','airbnb']);
  for(const group of result.results) {
    const item=group.observations[0]!;
    assert.equal(item.fullStayTotalMinor,null);assert.equal(item.exactPartyQuoted,false);
    assert.equal(item.roomAllocationVerified,false);assert.equal(item.availability,'unverified');assert.equal(item.expiresAt,null);
  }
  assert.equal(result.results[0]!.detail!.totalRate.reportedMinor,22000);
  assert.equal(result.results[2]!.observations[0]!.totalRate.reportedMinor,24000);
  assert.equal(result.results[2]!.observations[0]!.cancellationDeadline,null);
  const output=formatProbeReport(result,key);
  for(const secret of [key,'private-token-hotels','tracking=private'])assert.equal(output.includes(secret),false);
});
test('missing key or uncertain/paid quota prevents metered calls',async()=>{
  let calls=0;
  const missing=await runAccommodationProbe({apiKey:'',record:async()=>{},send:async()=>{calls++;return Response.json(account);}});
  assert.equal(missing.reason,'missing_api_key');assert.equal(calls,0);
  for(const change of [{plan_monthly_price:25},{plan_searches_left:4},{this_hour_searches:16},{plan_searches_left:null}]) {
    const result=await runAccommodationProbe({apiKey:key,record:async()=>{assert.fail('must not reserve search');},send:async()=>Response.json({...account,...change})});
    assert.equal(result.status,'blocked');assert.equal(result.requestsAttempted,0);
  }
});
test('context, detail identity and malformed-result mismatches stop without accepting invalid evidence',async()=>{
  for(const change of ['dates','party','mode','detail','shape'] as const) {
    const result=await runAccommodationProbe({apiKey:key,record:async()=>{},send:async(input)=>{
      const url=new URL(String(input)),body=response(url);
      if(url.pathname==='/search.json') {
        if(change==='dates')body.search_parameters.check_out_date='2026-12-21';
        if(change==='party')body.search_parameters.adults=2;
        if(change==='mode')body.search_parameters.vacation_rentals=true;
        if(change==='detail'&&url.searchParams.has('property_token'))body.property_token='unrelated-property';
        if(change==='shape')body.properties={};
      }
      return Response.json(body);
    }});
    assert.equal(result.status,'stopped');assert.equal(result.results[0]?.detail??null,null);
    assert.equal(result.requestsAttempted,change==='detail'?4:1);
  }
});
test('timeouts consume one attempt without retries and failures cannot leak credentials',async()=>{
  const events:StayProbeEvent[]=[];let calls=0;
  const result=await runAccommodationProbe({apiKey:key,record:async e=>{events.push(e);},send:async(input)=>{
    calls++;if(String(input).includes('/account.json'))return Response.json(account);throw Error(String(input));
  }});
  assert.equal(result.status,'outcome_unknown');assert.equal(calls,2);assert.equal(result.requestsAttempted,1);
  assert.deepEqual(events.map(e=>e.status),['reserved','outcome_unknown']);assert.equal(JSON.stringify(result).includes(key),false);
  const disk=await runAccommodationProbe({apiKey:key,record:async()=>{throw Error('disk failure');},send:async(input)=>{
    assert.ok(String(input).includes('/account.json'));return Response.json(account);
  }});
  assert.equal(disk.requestsAttempted,0);
});
test('Airbnb suggested dates cannot become prices for the requested stay and claims remain unverified',()=>{
  const item=accommodationEvidence({...rental(),check_out_date:'2026-12-23',beds:NaN,link:'javascript:alert(1)'},'airbnb');
  assert.equal(item.reportedDates!.match,false);assert.equal(item.totalRate.reportedMinor,null);
  assert.equal(item.totalRate.displayText,null);assert.equal(item.beds,null);assert.equal(item.sourceUrl,null);
  assert.equal(item.cancellationClaim,true);assert.equal(item.cancellationDeadline,null);
  assert.equal(accommodationEvidence({link:'https://user:secret@example.com'},'hotels').sourceUrl,null);
  assert.equal(accommodationEvidence({link:'https://serpapi.com/search?api_key=secret'},'hotels').sourceUrl,null);
});
test('empty results and missing tokens do not trigger extra queries; output and pagination are bounded',async()=>{
  const result=await runAccommodationProbe({apiKey:key,record:async()=>{},send:async(input)=>{
    const url=new URL(String(input)),body=response(url);
    if(url.pathname==='/search.json') {
      if(url.searchParams.get('engine')==='airbnb')body.organic_results=[];
      else body.properties=Array.from({length:15},()=>({...property('hotels'),property_token:null}));
      body.serpapi_pagination={next_page_token:'never-follow-me'};
    }
    return Response.json(body);
  }});
  assert.equal(result.status,'completed');assert.equal(result.requestsAttempted,3);
  assert.equal(result.results[0]!.observations.length,10);assert.equal(result.results[0]!.truncated,true);
  assert.equal(result.results[0]!.nextPageNotFetched,true);assert.equal(result.results[2]!.returnedCount,0);
});
test('property details returned directly by search avoid an unnecessary second detail request',async()=>{
  const result=await runAccommodationProbe({apiKey:key,record:async()=>{},send:async(input)=>{
    const url=new URL(String(input)),body=response(url);
    if(body.properties){Object.assign(body,body.properties[0]);delete body.properties;}
    return Response.json(body);
  }});
  assert.equal(result.requestsAttempted,3);assert.equal(result.results[0]!.detailStatus,'returned_by_search');
});
