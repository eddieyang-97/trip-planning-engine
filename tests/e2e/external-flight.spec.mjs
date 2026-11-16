import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {test,expect} from '@playwright/test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createApp} from '../../dist/src/app.js';
import {Core,runOneJob} from '../../dist/src/core.js';
import {embedded,migrate} from '../../dist/src/database.js';
import {itineraryRoutes} from '../../dist/src/itinerary-web.js';
import {FixtureProvider} from '../../dist/src/providers.js';
import {externalFlightCriteria,externalFlightTrip,externalFlightOffer} from '../../dist/tests/fixtures/external-flight.js';

const key=()=>({idempotencyKey:randomUUID()});

test('assistant imports flight research, opens the comparison on web, and reads the selected evidence through fresh MCP',async({page,context})=>{
  const db=await embedded(),http=createServer(),clients=[];
  try{
    await migrate(db);
    const core=new Core(db,true,false);
    const actor={userId:randomUUID(),clientId:'fixture-flight-assistant'},token=randomUUID();
    await db.query('insert into client_grants values($1,$2,$3,null)',[actor.userId,actor.clientId,['read','write','search']]);
    await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
    const origin=`http://127.0.0.1:${http.address().port}`;
    const authenticate=async header=>{if(header===`Bearer ${token}`)return actor;throw Error('Unknown fixture identity');};
    http.on('request',createApp({core,publicOrigin:origin,authenticate,itinerary:itineraryRoutes({core,origin,local:true,authenticate})}));
    const connect=async()=>{
      const client=new Client({name:'external-flight-fixture',version:'1'});
      clients.push(client);
      await client.connect(new StreamableHTTPClientTransport(new URL('/mcp',origin),
        {requestInit:{headers:{Authorization:`Bearer ${token}`}}}));
      return client;
    };
    const client=await connect();
    const invoke=async(activeClient,name,args)=>{
      const result=await activeClient.callTool({name,arguments:args});
      expect(result.isError,JSON.stringify(result)).toBeFalsy();
      return result.structuredContent;
    };
    const call=(name,args)=>invoke(client,name,args);
    expect((await client.listTools()).tools.find(tool=>tool.name==='save_external_flight_offer')?.description).toContain('permission to store and redisplay');
    const {tripId}=await call('create_trip',{...key(),...externalFlightTrip});
    // The handoff must resolve the exact decision even when it is past the default web preview limit.
    for(let i=0;i<5;i++)await call('create_decision',{...key(),tripId,title:`Earlier decision ${i}`,criteria:externalFlightCriteria});
    const {decisionId,revision}=await call('create_decision',{...key(),tripId,title:'Fictional combined flight options',criteria:externalFlightCriteria});
    const run=await call('start_search',{...key(),decisionId,expectedRevision:revision,criteriaVersion:1,provider:'fixture'});
    await runOneJob(db,new FixtureProvider());
    const native=await call('get_search_run',{runId:run.runId});
    expect(native.observations).toHaveLength(3);
    const offer=externalFlightOffer(),args={...key(),decisionId,expectedRevision:run.revision,offer};
    const saved=await call('save_external_flight_offer',args);
    expect(saved.provenance).toBe('assistant_sourced_unverified');
    expect(saved.webUrl).toBe(`${origin}/itinerary?trip=${tripId}&flight=${decisionId}&view=details`);
    const nativeSameFlight=native.observations.find(row=>row.candidate_id===saved.candidateId);
    expect(nativeSameFlight).toBeDefined();
    const comparison=await call('compare_candidates',{decisionId,criteriaVersion:1,observationIds:[nativeSameFlight.id,saved.observationId]});
    expect(comparison.results).toEqual(expect.arrayContaining([
      expect.objectContaining({provenance:'synthetic',totalMinor:71000}),
      expect.objectContaining({provenance:saved.provenance,totalMinor:null,eligibility:'conditional',
        observedPrice:{amountMinor:42000,currency:'JPY',basis:'party',exactPartyQuoted:true},
        externalEvidence:expect.objectContaining({priceScope:'outbound',availability:'reported_available'})}),
    ]));
    const shortlisted=await call('set_candidate_disposition',{...key(),decisionId,expectedRevision:saved.revision,candidateId:saved.candidateId,disposition:'saved'});
    const selected=await call('select_candidate',{...key(),decisionId,expectedRevision:shortlisted.revision,observationId:saved.observationId,
      rationale:'Use this schedule if the whole-party fare and baggage check out.',acknowledgeConditional:true});
    expect(selected.booked).toBe(false);

    const externalRequests=[],pageErrors=[];
    page.on('pageerror',error=>pageErrors.push(error.message));
    await context.route('**/*',route=>{
      if(new URL(route.request().url()).origin===origin)return route.continue();
      externalRequests.push(route.request().url());return route.abort();
    });
    await page.goto(saved.webUrl);
    await page.getByLabel('Local development token').fill(token);
    await page.getByRole('button',{name:'Open local trips',exact:true}).click();
    const research=page.getByRole('region',{name:'Saved flight research'});
    await expect(research.getByRole('heading',{name:'Fictional combined flight options'})).toBeVisible();
    const external=research.getByRole('article').filter({hasText:'Assistant-sourced flight research'});
    await expect(external).toContainText('Shortlisted');
    await expect(external).toContainText('Selected in research');
    await external.locator('summary').click();
    for(const expected of ['Fictional Ticket Shop · via Fictional Connector','¥42,000','Outbound price',
      'Party fare · Exact-party basis reported','Full-party total unverified','Return baggage: Unknown','Checked bag fee unknown','Only one seller checked'])
      await expect(external).toContainText(expected);
    await expect(external.getByRole('link',{name:'Open reported seller handoff'})).toHaveAttribute('href',offer.sourceUrl);
    await expect(research.getByText('Synthetic example.',{exact:false}).first()).toBeVisible();
    await page.setViewportSize({width:1280,height:900});
    await expect(external.getByText('Only one seller checked',{exact:false})).toBeVisible();
    await external.getByRole('button',{name:'Review outbound for plan'}).click();
    const editor=page.getByRole('dialog',{name:'Review flight for your plan'});
    await expect(editor).toBeVisible();
    await expect(editor.locator('[name="url"]')).toHaveValue('');
    await editor.getByRole('button',{name:'Cancel',exact:true}).click();
    expect(externalRequests).toEqual([]);expect(pageErrors).toEqual([]);

    await client.close();
    const fresh=await connect();
    const read=await invoke(fresh,'get_decision',{decisionId});
    const pinned=read.selections[0];
    expect(read.webUrl).toBe(saved.webUrl);
    expect(read.observations).toHaveLength(4);
    expect(pinned.id).toBe(selected.selectionId);
    expect(pinned.observation).toMatchObject({id:saved.observationId,provenance:saved.provenance,disposition:'saved',
      payload:{...offer,priceMinor:null,priceBasis:'unknown',exactPartyQuoted:false,
        external:{...offer.external,reportedPrice:{amountMinor:42000,currency:'JPY',basis:'party',exactPartyQuoted:true}},
        outbound:[{...offer.outbound[0],arrival:'2026-12-18T20:10:00Z'}],
        inbound:[{...offer.inbound[0],departure:'2026-12-20T19:45:00Z'}]}});
    expect(pinned.evaluation).toEqual(selected.assessment);
    for(const table of ['booking_records','itinerary_items','provider_attempts','live_search_usage'])
      expect((await db.query(`select count(*)::int n from ${table}`)).rows[0].n).toBe(0);
  }finally{
    for(const client of clients)await client.close();
    http.closeAllConnections();
    await new Promise(resolve=>http.close(resolve));
    await db.close();
  }
});
