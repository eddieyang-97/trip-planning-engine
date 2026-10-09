import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bookingEvidence, formatProbeReport, probeQuery, reportedMinor, runSerpApiProbe, type ProbeEvent } from '../src/serpapi-probe.js';

const secret='test-private-key-not-a-real-credential';
const account={account_status:'Active',plan_monthly_price:0,plan_searches_left:250,account_rate_limit_per_hour:50,this_hour_searches:0,
  api_key:secret,account_email:'private@example.com'};
const leg=(returning=false)=>({ flights:[{airline:'easyJet',flight_number:returning?'TEST U2 2':'TEST U2 1',travel_class:'Economy',
  departure_airport:{id:returning?'GVA':'LGW',time:returning?'2026-12-20 18:00':'2026-12-18 17:00'},
  arrival_airport:{id:returning?'LGW':'GVA',time:returning?'2026-12-20 19:00':'2026-12-18 20:00'}}],
  ...(returning?{booking_token:'test-booking-token'}:{departure_token:'test-departure-token'}) });
const booking=()=>({selected_flights:[leg(),leg(true)],booking_options:[{together:{book_with:'easyJet',option_title:'Test fare',price:97.99,
  baggage_prices:['Carry-on information only'],booking_request:{url:'https://www.google.com/travel/clk/f',post_data:'private-handoff-data'}}}],
  baggage_prices:{together:['Carry-on information only']}});
function successfulResponse(url:URL) {
  if(url.pathname==='/account.json')return account;
  const stage=url.searchParams.has('booking_token')?booking():url.searchParams.has('departure_token')?{other_flights:[leg(true)]}:{best_flights:[leg()]};
  return {search_metadata:{status:'Success',created_at:'2026-10-09 10:00:00 UTC'},search_parameters:{...probeQuery},...stage};
}

test('six-search probe uses bound selection tokens, fixed dates/party and two observations without confirming prices',async()=>{
  const requests:URL[]=[],events:ProbeEvent[]=[];
  const report=await runSerpApiProbe({apiKey:secret,record:async e=>{events.push(e);},send:async(input,init)=>{
    const url=new URL(String(input));requests.push(url);assert.equal(url.origin,'https://serpapi.com');assert.equal(init?.redirect,'error');
    if(url.pathname==='/search.json') {
      assert.equal(events.at(-1)?.status,'reserved','reserve before any search is sent');
      for(const [key,value]of Object.entries(probeQuery))assert.equal(url.searchParams.get(key),value);
      assert.equal(url.searchParams.has('bags'),false,'carry-on count is not snowboard count');
      assert.equal(url.searchParams.has('async'),false);
      if(requests.length===3||requests.length===6)assert.equal(url.searchParams.get('departure_token'),'test-departure-token');
      if(requests.length===4||requests.length===7)assert.equal(url.searchParams.get('booking_token'),'test-booking-token');
    }
    return Response.json(successfulResponse(url));
  }});
  assert.equal(report.status,'completed');assert.equal(report.requestsAttempted,6);assert.equal(requests.length,7);
  assert.equal(report.cycles.length,2);assert.equal(report.verifiedLiveIntegration,false);
  assert.equal(report.cycles[0]!.options[0].reportedPriceMinor,9799);
  assert.equal(report.cycles[0]!.options[0].priceBasis,'unverified');assert.equal(report.cycles[0]!.exactPartyQuoted,false);
  assert.equal(report.cycles[0]!.snowboardTotalMinor,null);assert.equal(report.cycles[0]!.expiresAt,null);
  assert.equal(report.cycles[0]!.options[0].handoff.method,'POST');
  assert.deepEqual(report.coverage.notRequestedAirports,['LHR','LTN','STN','LCY','SEN']);
  const output=formatProbeReport(report,secret);
  for(const value of [secret,'private@example.com','test-booking-token','private-handoff-data'])assert.equal(output.includes(value),false);
  assert.equal(events.filter(e=>e.status==='reserved').length,6);
});

test('missing key, paid plan, low credits and hourly limit stop before flight requests',async()=>{
  let calls=0;
  const absent=await runSerpApiProbe({apiKey:'',record:async()=>{},send:async()=>{calls++;return Response.json(account);}});
  assert.equal(absent.reason,'missing_api_key');assert.equal(calls,0);
  for(const change of [{plan_monthly_price:25},{plan_searches_left:5},{this_hour_searches:45},{plan_monthly_price:undefined}]) {
    let searches=0;
    const result=await runSerpApiProbe({apiKey:secret,record:async()=>{searches++;},send:async()=>Response.json({...account,...change})});
    assert.equal(result.status,'blocked');assert.equal(searches,0);
  }
});

test('a timeout is outcome_unknown, consumes one reserved attempt and is never retried',async()=>{
  const events:ProbeEvent[]=[];let calls=0;
  const result=await runSerpApiProbe({apiKey:secret,record:async e=>{events.push(e);},send:async(input)=>{
    calls++;if(String(input).includes('/account.json'))return Response.json(account);
    throw new Error(`Fetch failed for secret URL ${String(input)}`);
  }});
  assert.equal(result.status,'outcome_unknown');assert.equal(result.requestsAttempted,1);assert.equal(calls,2);
  assert.deepEqual(events.map(e=>e.status),['reserved','outcome_unknown']);
  assert.equal(formatProbeReport(result,secret).includes(secret),false);
});

test('request echo and itinerary mismatches stop without manufacturing valid observations',async()=>{
  for(const change of ['party','pair','empty'] as const) {
    const result=await runSerpApiProbe({apiKey:secret,record:async()=>{},send:async(input)=>{
      const url=new URL(String(input)),body:any=successfulResponse(url);
      if(url.pathname==='/search.json') {
        if(change==='party')body.search_parameters={...probeQuery,adults:1};
        if(change==='empty'&&!url.searchParams.has('departure_token'))body.best_flights=[];
        if(change==='pair'&&url.searchParams.has('booking_token'))body.selected_flights[1].flights[0].flight_number='WRONG FLIGHT';
      }
      return Response.json(body);
    }});
    assert.equal(result.status,'stopped');assert.equal(result.cycles.length,0);assert.equal(result.verifiedLiveIntegration,false);
  }
});

test('repeat searches follow the original pair and stop if it is not returned',async()=>{
  let searches=0;
  const result=await runSerpApiProbe({apiKey:secret,record:async()=>{},send:async(input)=>{
    const url=new URL(String(input)),body:any=successfulResponse(url);
    if(url.pathname==='/search.json'&&++searches===4)body.best_flights[0].flights[0].flight_number='DIFFERENT FLIGHT';
    return Response.json(body);
  }});
  assert.equal(result.reason,'previous_outbound_not_returned');assert.equal(result.requestsAttempted,4);assert.equal(result.cycles.length,1);
});

test('ledger write failure prevents spending; provider errors never expose raw messages',async()=>{
  let calls=0;
  const result=await runSerpApiProbe({apiKey:secret,record:async()=>{throw Error('disk failure');},send:async()=>{calls++;return Response.json(account);}});
  assert.equal(calls,1);assert.equal(result.requestsAttempted,0);
  const rejected=await runSerpApiProbe({apiKey:secret,record:async()=>{},send:async(input)=>
    Response.json(String(input).includes('/account.json')?account:{error:`Bad request ${secret}`})});
  assert.equal(rejected.reason,'provider_reported_error');assert.equal(JSON.stringify(rejected).includes(secret),false);
});

test('money and output handling preserve unknowns and redact credential echoes',()=>{
  assert.equal(reportedMinor(97.99),9799);assert.equal(reportedMinor(100),10000);
  for(const value of [null,'97.99',-1,1.001,NaN,Infinity,Number.MAX_SAFE_INTEGER])assert.equal(reportedMinor(value),null);
  const result=bookingEvidence({...booking(),booking_options:[{together:{book_with:secret,booking_request:{url:'http://unsafe.example'}}}]},leg(),leg(true));
  assert.equal(result.options[0]!.reportedPriceMinor,null);assert.equal(result.options[0]!.handoff.status,'invalid');
  assert.equal(formatProbeReport(result,secret).includes(secret),false);
});
