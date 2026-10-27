import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {test as base,expect} from '@playwright/test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {embedded,migrate} from '../../dist/src/database.js';
import {Core} from '../../dist/src/core.js';
import {createApp} from '../../dist/src/app.js';
import {itineraryRoutes} from '../../dist/src/itinerary-web.js';
import {diningCriteria,diningObservation} from '../../dist/tests/fixtures/dining.js';

const test=base.extend({
  app:async({},use)=>{
    const db=await embedded(),http=createServer(),client=new Client({name:'isolated-dining-browser-client',version:'1'});
    try{
      await migrate(db);const core=new Core(db,false,false),owner=randomUUID(),ownerToken=randomUUID(),clientId='fictional-dining-browser';
      await db.query('insert into client_grants values($1,$2,$3,null)',[owner,clientId,['read','write']]);
      const authenticate=async header=>{if(header===`Bearer ${ownerToken}`)return {userId:owner,clientId};throw Error('Unknown fixture identity');};
      await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${http.address().port}`;
      http.on('request',createApp({core,publicOrigin:origin,authenticate,itinerary:itineraryRoutes({core,origin,local:true,authenticate})}));
      await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`),{requestInit:{headers:{authorization:`Bearer ${ownerToken}`,'x-forwarded-host':'outside.example'}}}));
      const tool=async(name,args)=>{const result=await client.callTool({name,arguments:args});assert.ok(!result.isError,JSON.stringify(result));return result.structuredContent;};
      const trip=await tool('create_trip',{idempotencyKey:randomUUID(),name:'Fictional Zermatt group dining — MCP to web',destination:'Fictional Zermatt',startDate:'2027-02-11',endDate:'2027-02-14',adults:10});
      const decision=await tool('create_dining_decision',{idempotencyKey:randomUUID(),tripId:trip.tripId,title:'Group restaurant shortlist',criteria:diningCriteria()});
      assert.equal(decision.webUrl,origin+decision.webPath);
      for(const name of ['get_dining_decision','compare_dining'])assert.equal((await tool(name,{decisionId:decision.decisionId})).webUrl,decision.webUrl);
      assert.equal((await tool('list_dining_decisions',{tripId:trip.tripId})).decisions[0].webUrl,decision.webUrl);
      const bistro=await tool('save_dining_candidate',{idempotencyKey:randomUUID(),decisionId:decision.decisionId,expectedRevision:1,observation:diningObservation()});
      const tavern=await tool('save_dining_candidate',{idempotencyKey:randomUUID(),decisionId:decision.decisionId,expectedRevision:2,observation:diningObservation(10,'tavern')});
      await tool('set_dining_disposition',{idempotencyKey:randomUUID(),decisionId:decision.decisionId,expectedRevision:3,candidateId:tavern.candidateId,disposition:'saved',rationale:'Menu suitable; cover charge needs confirmation.'});
      await use({db,origin,ownerToken,tool,tripId:trip.tripId,decisionId:decision.decisionId,bistro,tavern,webPath:decision.webPath,webUrl:decision.webUrl});
    }finally{await client.close();http.closeAllConnections();await new Promise(resolve=>http.close(resolve));await db.close();}
  },
});

test('MCP dining shortlist opens the same web comparison, reviews a tentative meal and preserves unknown inventory on reread',async({browser,app},testInfo)=>{
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),external=[],errors=[];
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin===app.origin)return route.continue();external.push(route.request().url());return route.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto(app.webUrl+'&view=details');await page.getByLabel('Local development token').fill(app.ownerToken);await page.getByRole('button',{name:'Open local trips',exact:true}).click();
    const research=page.locator('#dining-research');await expect(research).toContainText('Group restaurant shortlist');
    const comparison=page.getByRole('table',{name:'Group dining alternatives — reported evidence'});await expect(comparison).toContainText('Fictional Valley Bistro');await expect(comparison).toContainText('Fictional Mountain Tavern');await expect(comparison).toContainText('550.00');await expect(comparison).toContainText('Unknown — incomplete estimate');await expect(comparison).toContainText('Menu suitable; cover charge needs confirmation.');
    await expect(comparison.getByRole('link',{name:'Reported reservation page ↗'})).toHaveAttribute('href','https://dining.example/bistro/reservations');await expect(comparison.getByRole('link',{name:'Restaurant homepage ↗'})).toHaveAttribute('href','https://dining.example/tavern');
    const bistro=page.getByRole('article',{name:'Fictional Valley Bistro',exact:true});await bistro.getByText('Menu, costs and reservation evidence',{exact:true}).click();await expect(bistro).toContainText('2026-10-24T12:00:00Z');await expect(bistro).toContainText('Service:');await expect(bistro).toContainText('per person');await expect(bistro).toContainText('no live table check');await bistro.getByText('Menu, costs and reservation evidence',{exact:true}).click();
    await research.screenshot({path:testInfo.outputPath('dining-mobile.png')});await page.setViewportSize({width:1280,height:900});await research.screenshot({path:testInfo.outputPath('dining-desktop.png')});await page.setViewportSize({width:390,height:844});
    await page.getByRole('button',{name:'Add dining option',exact:true}).click();const capture=page.locator('#dining-option-dialog');await capture.getByLabel('Restaurant name',{exact:true}).fill('Fictional manual cafe');await capture.getByLabel('Source label',{exact:true}).fill('Private organizer note');await capture.getByRole('button',{name:'Save observation',exact:true}).click();await expect(capture).not.toBeVisible();await expect(research).toContainText('Fictional manual cafe');
    await bistro.getByRole('button',{name:'Review this option',exact:true}).click();const select=page.locator('#dining-select-dialog'),rationale='';await expect(select).toContainText('Table availability');await expect(select.getByLabel('Selection rationale (optional)',{exact:true})).toBeVisible();await expect(select.getByRole('checkbox')).toHaveCount(0);await select.getByRole('button',{name:'Select this observation',exact:true}).click();await expect(select).not.toBeVisible();
    await page.getByRole('region',{name:'Selected dining evidence'}).getByRole('button',{name:'Review tentative meal',exact:true}).click();const commit=page.locator('#dining-commit-dialog');await expect(commit).toContainText('No reservation is made');await commit.getByRole('button',{name:'Save tentative meal to itinerary',exact:true}).click();await expect(commit).not.toBeVisible();
    const saved=await app.tool('get_dining_decision',{decisionId:app.decisionId}),plan=await app.tool('get_itinerary',{tripId:app.tripId});expect(saved.candidates).toHaveLength(3);expect(saved.selection).toMatchObject({observationId:app.bistro.observationId,rationale});expect(saved.selection.observation).toEqual(diningObservation());expect(saved.selection.evaluation.eligibility).toBe('conditional');expect(saved.links).toHaveLength(1);expect(plan.items).toHaveLength(1);expect(plan.items[0].payload).toMatchObject({type:'restaurant',status:'tentative',startDate:'2027-02-12',startTime:'19:30',timeZone:'Europe/Rome',bookingNote:''});expect(plan.items[0].sourceLink).toMatchObject({decisionId:app.decisionId,observationId:app.bistro.observationId,selectionId:saved.selection.id,webUrl:app.webUrl});expect((await app.tool('get_trip',{tripId:app.tripId})).decisions[0].dining.webUrl).toBe(app.webUrl);await expect(page.locator('#timeline')).toContainText('Fictional Valley Bistro');await expect(page.locator('#timeline')).toContainText('Tentative');
    const current=saved.decision.revision;await app.tool('save_dining_candidate',{idempotencyKey:randomUUID(),decisionId:app.decisionId,expectedRevision:current,candidateId:app.bistro.candidateId,observation:{...diningObservation(),price:{amountMinor:6000,basis:'per_person',description:'Revisited menu estimate'}}});
    await page.getByRole('button',{name:'Refresh dining',exact:true}).click();await expect(research).toContainText('650.00');const fresh=await app.tool('get_dining_decision',{decisionId:app.decisionId});expect(fresh.selection.observationId).toBe(app.bistro.observationId);expect(fresh.selection.observation.price.amountMinor).toBe(5000);expect(fresh.selection.observation.availability).toBe('unknown');
    await page.getByRole('button',{name:'New dining comparison',exact:true}).click();const creation=page.locator('#dining-decision-dialog');await creation.getByLabel('Comparison title',{exact:true}).fill('Fictional web-only lunch');await creation.getByLabel('Meal',{exact:true}).selectOption('lunch');await creation.getByLabel('Meal time zone',{exact:true}).selectOption('Europe/Rome');await creation.getByRole('button',{name:'Create dining comparison',exact:true}).click();await expect(creation).not.toBeVisible();
    await page.getByRole('button',{name:'Add dining option',exact:true}).click();await capture.getByLabel('Restaurant name',{exact:true}).fill('Fictional fallback restaurant');await capture.getByLabel('Source label',{exact:true}).fill('Fictional manual source');await capture.getByRole('button',{name:'Save observation',exact:true}).click();await expect(capture).not.toBeVisible();const webId=new URL(page.url()).searchParams.get('dining');const fallback=await app.tool('get_dining_decision',{decisionId:webId});expect(fallback.criteria).toMatchObject({meal:'lunch',timeZone:'Europe/Rome'});expect(fallback.candidates[0].observations[0].payload.restaurantName).toBe('Fictional fallback restaurant');
    for(const table of ['dining_itinerary_links','itinerary_items','itinerary_events'])expect((await app.db.query('select count(*)::int n from '+table)).rows[0].n).toBe(1);for(const table of ['booking_records','search_runs'])expect((await app.db.query('select count(*)::int n from '+table)).rows[0].n).toBe(0);expect(external).toEqual([]);expect(errors).toEqual([]);
  }finally{await context.close();}
});
