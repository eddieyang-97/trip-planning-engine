import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import type {Request} from 'express';
import {embedded,migrate} from '../src/database.js';
import {Core} from '../src/core.js';
import {createApp} from '../src/app.js';
import {itineraryRoutes} from '../src/itinerary-web.js';
import {publicRequestLimits} from '../src/public-request-limits.js';
import {flaineTrip} from '../src/acceptance.js';
const key=()=>({idempotencyKey:randomUUID()});
const caller=(ip:string)=>({ip} as Request);

test('public admission bounds callers, global attempts, authorized use and memory; windows recover',()=>{
  let now=0;
  const limits=publicRequestLimits(2,4,2,()=>now);
  assert.equal(limits.attempt(caller('a')),true);assert.equal(limits.attempt(caller('a')),true);
  for(let i=0;i<120;i++)assert.equal(limits.attempt(caller('a')),false);
  assert.equal(limits.attempt(caller('b')),true,'rejected attempts do not consume global capacity');
  assert.equal(limits.authorize(),true);assert.equal(limits.authorize(),true);assert.equal(limits.authorize(),false);
  assert.equal(limits.attempt(caller('c')),true);assert.equal(limits.attempt(caller('d')),false);
  now=60_000;assert.equal(limits.attempt(caller('a')),true);assert.equal(limits.authorize(),true);
  const bounded=publicRequestLimits(2,3000,3000,()=>now);
  for(let i=0;i<1024;i++)assert.equal(bounded.attempt(caller(String(i))),true);
  assert.equal(bounded.attempt(caller('new')),false,'new callers cannot evict/reset existing counters');
  assert.equal(bounded.attempt(caller('0')),true);assert.equal(bounded.attempt(caller('0')),false);
  now+=60_000;assert.equal(bounded.attempt(caller('new')),true,'expired identities are reclaimed');
});

test('invalid public traffic cannot exhaust a separate viewer/exporter; proxy spoofing, revocation and ceilings remain enforced',async()=>{
  const db=await embedded(),http=createServer(),owner=randomUUID();let now=Date.now(),authCalls=0;
  try{
    await migrate(db);const core=new Core(db,false);
    const tripId=(await core.callFromWeb('create_trip',{...flaineTrip,...key()},owner)).tripId;
    const {itemId}=await core.callFromWeb('add_itinerary_item',{tripId,expectedRevision:1,...key(),item:{type:'activity',title:'Fictional walk',startDate:'2026-12-19',startTime:null,endDate:null,endTime:null,timeZone:null,endTimeZone:null,location:'',url:null,notes:'',openQuestion:'',status:'tentative',bookingNote:''}},owner);
    const link=await core.callFromWeb('create_itinerary_view_link',{tripId,label:'Fixture',...key()},owner);
    const before=(await db.query('select count(*)::int n from mutation_requests')).rows[0]!.n;
    await new Promise<void>(r=>http.listen(0,'127.0.0.1',r));const address=http.address();assert.ok(address&&typeof address!=='string');const origin=`http://127.0.0.1:${address.port}`;
    const authenticate=async(header?:string)=>{authCalls++;if(header!=='Bearer fixture')throw Error('Unauthorized');return {userId:owner,clientId:'fixture'};};
    const mount=(trust:string[])=>{http.removeAllListeners('request');http.on('request',createApp({core,publicOrigin:origin,authenticate,trustedProxyAddresses:trust,itinerary:itineraryRoutes({core,origin,authenticate,clock:()=>now})}));};
    mount(['127.0.0.1']); // Only this fixture's loopback reverse proxy is trusted.
    const post=(path:string,body:unknown,ip:string,authorization='',from=origin)=>fetch(origin+path,{method:'POST',headers:{Origin:from,Authorization:authorization,'Content-Type':'application/json','X-Forwarded-For':ip},body:JSON.stringify(body)});
    const read=(token:string,ip:string)=>post('/itinerary-share/read',{token},ip);
    for(let i=0;i<120;i++){
      const response=await read('a'.repeat(43),`198.51.100.${i%200+1}, 192.0.2.1`);
      assert.equal(response.status,i<30?404:429,'forged leftmost addresses cannot rotate the real caller');
    }
    assert.equal((await read(link.token,'192.0.2.2')).status,200);
    const direct={tripId,itemIds:[itemId],expectedRevision:2},shared={token:link.token,itemIds:[itemId],expectedRevision:2};
    for(let i=0;i<60;i++)assert.equal((await post('/itinerary-api/calendar-export',direct,'192.0.2.1')).status,i<30?401:429);
    assert.equal(authCalls,30,'blocked traffic never reaches authentication');
    const exported=await post('/itinerary-share/calendar-export',shared,'192.0.2.2');assert.equal(exported.status,200);
    const ticket=await exported.json();assert.equal((await fetch(origin+ticket.url)).status,200);
    assert.equal((await post('/itinerary-api/calendar-export',direct,'192.0.2.3','Bearer fixture')).status,200);
    assert.equal((await post('/itinerary-share/read',{token:link.token},'192.0.2.2','','https://evil.example')).status,403);
    assert.equal((await db.query('select count(*)::int n from mutation_requests')).rows[0]!.n,before,'public reads and exports never mutate durable state');
    // Valid traffic still meets the original process-wide limits.
    now+=60_000;
    for(let i=0;i<120;i++)assert.equal((await read(link.token,`192.0.2.${10+Math.floor(i/30)}`)).status,200);
    assert.equal((await read(link.token,'192.0.2.20')).status,429);
    for(let i=0;i<60;i++)assert.equal((await post('/itinerary-share/calendar-export',shared,`192.0.2.${10+Math.floor(i/30)}`)).status,200);
    assert.equal((await post('/itinerary-share/calendar-export',shared,'192.0.2.20')).status,429);
    await core.callFromWeb('revoke_itinerary_access',{tripId,inviteId:link.inviteId,...key()},owner);
    assert.equal((await fetch(origin+ticket.url)).status,404);
    now+=60_000;assert.equal((await read(link.token,'192.0.2.2')).status,404);
    assert.equal((await post('/itinerary-share/calendar-export',shared,'192.0.2.2')).status,404);
    // With no trusted ingress, all forwarded identities are ignored.
    mount([]);
    for(let i=0;i<31;i++)assert.equal((await read('b'.repeat(43),`192.0.2.${i+1}`)).status,i<30?404:429);
  }finally{await new Promise<void>(r=>http.close(()=>r()));await db.close();}
});
