import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import express from 'express';
import {embedded,migrate} from '../src/database.js';
import {Core} from '../src/core.js';
import {flaineTrip} from '../src/acceptance.js';
import {calendarExportRoutes} from '../src/calendar-export-web.js';
import {itineraryRoutes} from '../src/itinerary-web.js';
import {createApp} from '../src/app.js';
const key=()=>({idempotencyKey:randomUUID()});
test('calendar routes enforce ownership, exact selection, privacy, revisions, expiry and shared-access revocation',async()=>{
  const db=await embedded(),http=createServer(),owner=randomUUID(),other=randomUUID();let now=Date.now(),authActive=true;
  try{
    await migrate(db);const core=new Core(db,false);
    const trip=(await core.callFromWeb('create_trip',{...flaineTrip,...key()},owner)).tripId;
    const item={type:'activity',title:'Visit the mountain',startDate:'2026-12-19',startTime:null,endDate:null,endTime:null,timeZone:null,endTimeZone:null,
      location:'Flaine',url:null,notes:'Shared practical detail',openQuestion:'Weather?',status:'tentative',bookingNote:''};
    const a=await core.callFromWeb('add_itinerary_item',{...key(),tripId:trip,expectedRevision:1,item},owner);
    const b=await core.callFromWeb('add_itinerary_item',{...key(),tripId:trip,expectedRevision:2,item:{...item,title:'Dinner'}},owner);
    await db.query('update itinerary_items set payload=payload || $2::jsonb where trip_id=$1',[trip,JSON.stringify({bookingNote:'PRIVATE booking',futurePrivate:'PRIVATE future'})]);
    const link=await core.callFromWeb('create_itinerary_view_link',{...key(),tripId:trip,label:'Export test'},owner);
    const authenticate=async(header?:string)=>{if(!authActive||!['Bearer owner','Bearer other'].includes(header??''))throw Error('No direct session');return {userId:header==='Bearer owner'?owner:other};};
    await new Promise<void>(r=>http.listen(0,'127.0.0.1',r));const address=http.address();assert.ok(address&&typeof address!=='string');const origin='http://127.0.0.1:'+address.port;
    // Use an injected clock to verify expiry without waiting two minutes.
    const app=express();app.use(calendarExportRoutes({core,origin,authenticate,clock:()=>now}));
    http.on('request',app);
    const post=(body:unknown,token='owner',path='/itinerary-api/calendar-export',from=origin)=>fetch(origin+path,{method:'POST',
      headers:{Origin:from,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
    const args={tripId:trip,itemIds:[a.itemId],expectedRevision:3};
    assert.equal((await post(args,'bad')).status,401);
    assert.equal((await post(args,'other')).status,404);
    assert.equal((await post(args,'owner','/itinerary-api/calendar-export','https://evil.example')).status,403);
    assert.equal((await post({...args,expectedRevision:2})).status,409);
    for(const itemIds of [[],[a.itemId,a.itemId],[randomUUID()]])assert.equal((await post({...args,itemIds})).status,400);
    assert.equal((await post({...args,ownerId:other})).status,400);
    let response=await post(args);assert.equal(response.status,200);const single=await response.json();
    response=await fetch(origin+single.url);assert.equal(response.status,200);assert.match(response.headers.get('content-type')!,/^text\/calendar/);
    assert.match(response.headers.get('content-disposition')!,/^inline;/);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('referrer-policy'),'no-referrer');
    const body=(await response.text()).replace(/\r\n /g,'');assert.equal((body.match(/BEGIN:VEVENT/g)||[]).length,1);assert.ok(body.includes(item.title));assert.ok(!body.includes('SUMMARY:Dinner'));assert.ok(!body.includes('PRIVATE'));
    response=await fetch(origin+single.url+'?download=1');assert.match(response.headers.get('content-disposition')!,/^attachment;/);
    assert.equal((await core.callFromWeb('get_itinerary',{tripId:trip},owner)).revision,3);
    authActive=false;assert.equal((await fetch(origin+single.url)).status,404);authActive=true;
    const expires=await(await post(args)).json();now+=120001;assert.equal((await fetch(origin+expires.url)).status,404);
    const sharedArgs={token:link.token,itemIds:[a.itemId,b.itemId],expectedRevision:3};
    response=await post(sharedArgs,'bad','/itinerary-share/calendar-export');assert.equal(response.status,200);const shared=await response.json();
    response=await fetch(origin+shared.url);assert.equal(response.status,200);const sharedBody=await response.text();
    assert.equal((sharedBody.match(/BEGIN:VEVENT/g)||[]).length,2);assert.ok(!sharedBody.includes('PRIVATE'));
    assert.equal((await post({...sharedArgs,tripId:trip},'bad','/itinerary-share/calendar-export')).status,400);
    await core.callFromWeb('revoke_itinerary_access',{...key(),tripId:trip,inviteId:link.inviteId},owner);
    assert.equal((await fetch(origin+shared.url)).status,404);
    assert.equal((await post(sharedArgs,'bad','/itinerary-share/calendar-export')).status,404);
    // The specific export route must precede generic tool dispatch in the app.
    http.removeAllListeners('request');http.on('request',createApp({core,publicOrigin:origin,authenticate:async()=>{throw Error('No MCP');},itinerary:itineraryRoutes({core,origin,authenticate})}));
    response=await post(args);assert.equal(response.status,200);assert.equal((await fetch(origin+(await response.json()).url)).status,200);
  }finally{await new Promise<void>(r=>http.close(()=>r()));await db.close();}
});
