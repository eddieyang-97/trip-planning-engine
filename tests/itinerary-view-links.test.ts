import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {embedded,migrate} from '../src/database.js';
import {Core} from '../src/core.js';
import {createApp} from '../src/app.js';
import {itineraryRoutes} from '../src/itinerary-web.js';
import {readItineraryViewLink} from '../src/itinerary-view-links.js';
import {flaineTrip} from '../src/acceptance.js';
import {DomainError} from '../src/domain.js';
const key=()=>({idempotencyKey:randomUUID()});
const denied=(e:unknown)=>e instanceof DomainError&&e.code==='FORBIDDEN_OR_NOT_FOUND';

test('view links are reusable read-only capabilities with allowlisted data and no membership or searches',async()=>{
  const db=await embedded(),owner=randomUUID(),visitor=randomUUID();
  try{
    await migrate(db);const core=new Core(db,false),trip=(await core.callFromWeb('create_trip',{...flaineTrip,...key()},owner)).tripId;
    const foreign=(await core.callFromWeb('create_trip',{...flaineTrip,name:'PRIVATE other trip',...key()},owner)).tripId;
    const item={type:'note',title:'Meet together',startDate:null,startTime:null,endDate:null,endTime:null,timeZone:null,endTimeZone:null,location:'',url:'https://example.com/meeting',notes:'Shared practical notes',openQuestion:'Which entrance?',status:'tentative',bookingNote:''};
    await core.callFromWeb('add_itinerary_item',{tripId:trip,expectedRevision:1,item,...key()},owner);
    // Future private fields must stay private even if they are added to stored payloads.
    await db.query(`update itinerary_items set payload=payload || $2::jsonb where trip_id=$1`,[trip,JSON.stringify({bookingNote:'PRIVATE booking',futurePrivate:'PRIVATE future field'})]);
    await db.query(`update trips set payload=payload || $2::jsonb where id=$1`,[trip,JSON.stringify({futurePrivate:'PRIVATE trip field'})]);
    const args={tripId:trip,label:'Friends',...key()},link=await core.callFromWeb('create_itinerary_view_link',args,owner);
    assert.match(link.token,/^[A-Za-z0-9_-]{43}$/);assert.equal(link.expiresAt,null);
    const before=JSON.stringify((await db.query('select * from mutation_requests order by key')).rows);
    for(let n=0;n<2;n++){
      const plan=await readItineraryViewLink(db,{token:link.token});
      assert.equal(plan.trip.id,trip);assert.notEqual(plan.trip.id,foreign);assert.equal(plan.role,'viewer');assert.equal(plan.revision,2);assert.equal(plan.sharedLink,true);
      assert.equal(plan.items[0]!.payload.notes,item.notes);assert.equal(plan.items[0]!.payload.bookingNote,'');
      assert.deepEqual(plan.history,[]);assert.deepEqual(plan.research.decisions,[]);
      assert.ok(!JSON.stringify(plan).includes('PRIVATE'));assert.ok(!JSON.stringify(plan).includes(owner));
    }
    assert.equal((await db.query('select count(*)::int n from itinerary_members')).rows[0]!.n,0);
    assert.equal((await db.query('select count(*)::int n from search_runs')).rows[0]!.n,0);
    assert.equal(JSON.stringify((await db.query('select * from mutation_requests order by key')).rows),before);
    const stored=JSON.stringify((await db.query('select * from itinerary_invites')).rows)+before;
    assert.ok(!stored.includes(link.token),'only the credential hash persists');
    const retry=await core.callFromWeb('create_itinerary_view_link',args,owner);assert.equal(retry.inviteId,link.inviteId);assert.equal(retry.token,undefined);assert.equal(retry.linkAvailable,false);
    await assert.rejects(core.callFromWeb('get_itinerary',{tripId:trip},visitor),denied);
    await assert.rejects(core.callFromWeb('accept_itinerary_invite',{token:link.token,displayName:'Visitor',...key()},visitor),denied);
    await assert.rejects(core.callFromWeb('get_itinerary_invite',{token:link.token},visitor),denied);
    await assert.rejects(core.callFromWeb('create_itinerary_view_link',{tripId:trip,label:'Onward',...key()},visitor),denied);
    const actor={userId:owner,clientId:'assistant'};await db.query('insert into client_grants values($1,$2,$3,null)',[owner,actor.clientId,['read','write']]);
    await assert.rejects(core.call('create_itinerary_view_link',{tripId:trip,label:'Assistant',...key()},actor),denied);
    const editor=await core.callFromWeb('create_itinerary_invite',{tripId:trip,label:'Editor',role:'editor',...key()},owner);
    await core.callFromWeb('accept_itinerary_invite',{token:editor.token,displayName:'Visitor',...key()},visitor);
    await assert.rejects(core.callFromWeb('create_itinerary_view_link',{tripId:trip,label:'Onward',...key()},visitor),denied);
    await assert.rejects(readItineraryViewLink(db,{token:editor.token}),denied,'account invitation is not an anonymous view credential');
    await core.callFromWeb('revoke_itinerary_access',{tripId:trip,inviteId:link.inviteId,...key()},owner);
    await assert.rejects(readItineraryViewLink(db,{token:link.token}),denied);
    assert.equal((await core.callFromWeb('get_itinerary',{tripId:trip},visitor)).role,'editor','revoking a view link does not revoke separate editor membership');
  }finally{await db.close();}
});

test('expiry is optional and enforced; anonymous reads cannot choose a trip or use legacy invitations',async()=>{
  const db=await embedded(),owner=randomUUID();
  try{
    await migrate(db);const core=new Core(db,false),trip=(await core.callFromWeb('create_trip',{...flaineTrip,...key()},owner)).tripId;
    const legacy=await core.callFromWeb('create_itinerary_invite',{tripId:trip,label:'Old viewer',...key()},owner);
    await assert.rejects(readItineraryViewLink(db,{token:legacy.token}),denied);
    for(const days of [7,30,90]){
      const link=await core.callFromWeb('create_itinerary_view_link',{tripId:trip,label:'Timed',expiresInDays:days,...key()},owner);
      assert.ok(Math.abs(new Date(link.expiresAt).getTime()-Date.now()-days*86400000)<5000);
      await readItineraryViewLink(db,{token:link.token});
      await db.query("update itinerary_invites set expires_at=now()-interval '1 second' where id=$1",[link.inviteId]);
      await assert.rejects(readItineraryViewLink(db,{token:link.token}),denied);
    }
    const link=await core.callFromWeb('create_itinerary_view_link',{tripId:trip,label:'No expiry',...key()},owner);
    for(const input of [{},{token:'bad'},{token:link.token,tripId:randomUUID()},{token:link.token,operation:'get_trip'},{token:link.token,ownerId:owner}])await assert.rejects(readItineraryViewLink(db,input));
    await assert.rejects(readItineraryViewLink(db,{token:'a'.repeat(43)}),denied);
    for(const expiresInDays of [0,1,365,-7])await assert.rejects(core.callFromWeb('create_itinerary_view_link',{tripId:trip,label:'Bad expiry',expiresInDays,...key()},owner));
    await assert.rejects(db.query("update itinerary_invites set role='editor' where id=$1",[link.inviteId]));
    await assert.rejects(db.query('update itinerary_invites set accepted_by=$2,accepted_at=now() where id=$1',[link.inviteId,randomUUID()]));
  }finally{await db.close();}
});

test('migration preserves existing account invitation boundaries and expiry',async()=>{
  const db=await embedded(),trip=randomUUID(),owner=randomUUID(),invite=randomUUID();
  try{
    for(const file of ['001_initial.sql','004_itinerary.sql','006_itinerary_sharing.sql','007_itinerary_editors.sql'])await db.execute(await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
    await db.query('insert into trips(id,owner_id,payload) values($1,$2,$3)',[trip,owner,JSON.stringify(flaineTrip)]);
    await db.query("insert into itinerary_invites(id,trip_id,token_hash,label,role) values($1,$2,$3,'Existing editor','editor')",[invite,trip,'legacy-hash']);
    const expiry=(await db.query('select expires_at from itinerary_invites')).rows[0]!.expires_at;
    await db.execute(await readFile(new URL('../migrations/008_itinerary_view_links.sql',import.meta.url),'utf8'));
    const row=(await db.query('select * from itinerary_invites')).rows[0]!;
    assert.equal(row.access_mode,'account');assert.equal(row.role,'editor');assert.deepEqual(row.expires_at,expiry);
    await assert.rejects(db.query('update itinerary_invites set expires_at=null where id=$1',[invite]));
  }finally{await db.close();}
});

test('fixed anonymous HTTP route works during auth failure, rejects dispatch and never authorizes private APIs',async()=>{
  const db=await embedded(),http=createServer(),owner=randomUUID();
  try{
    await migrate(db);const core=new Core(db,false),trip=(await core.callFromWeb('create_trip',{...flaineTrip,...key()},owner)).tripId;
    const link=await core.callFromWeb('create_itinerary_view_link',{tripId:trip,label:'HTTP test',...key()},owner);
    await new Promise<void>(r=>http.listen(0,'127.0.0.1',r));const address=http.address();assert.ok(address&&typeof address!=='string');const origin=`http://127.0.0.1:${address.port}`;
    const unavailable=async()=>{throw Error('Auth unavailable');};
    http.on('request',createApp({core,authenticate:unavailable,publicOrigin:origin,itinerary:itineraryRoutes({core,origin,authenticate:unavailable})}));
    const read=(body:unknown,headers:Record<string,string>={Origin:origin})=>fetch(origin+'/itinerary-share/read',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
    let response=await read({token:link.token});assert.equal(response.status,200);assert.equal((await response.json() as any).trip.id,trip);
    assert.equal(response.headers.get('cache-control'),'no-store');assert.match(response.headers.get('x-robots-tag')!,/noindex/);assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.equal(response.headers.get('access-control-allow-origin'),null);
    assert.equal((await fetch(origin+'/itinerary-share/read')).status,405);
    assert.equal((await read({token:link.token},{})).status,403);
    assert.equal((await read({token:link.token},{Origin:'https://other.example'})).status,403);
    assert.equal((await read({token:link.token,tripId:randomUUID()})).status,400);
    assert.equal((await read({token:link.token,operation:'remove_itinerary_item'})).status,400);
    response=await fetch(origin+'/itinerary-share/read',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{"token":"SECRET malformed'});
    assert.equal(response.status,400);assert.ok(!(await response.text()).includes('SECRET'));
    assert.equal((await read({token:'x'.repeat(3000)})).status,413);
    for(const path of ['/itinerary-api/get_itinerary','/itinerary-api/create_itinerary_view_link','/mcp']){
      response=await fetch(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:`Bearer ${link.token}`},body:JSON.stringify({tripId:trip})});assert.equal(response.status,401);
    }
    await core.callFromWeb('revoke_itinerary_access',{tripId:trip,inviteId:link.inviteId,...key()},owner);
    response=await read({token:link.token});assert.equal(response.status,404);assert.ok(!(await response.text()).toLowerCase().includes('sign in'));
    for(let n=0;n<120;n++)response=await read({token:'z'.repeat(43)});
    assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'60');
  }finally{await new Promise<void>((r,j)=>http.close(e=>e?j(e):r()));await db.close();}
});
