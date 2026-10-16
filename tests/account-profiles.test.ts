import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import sharp from 'sharp';
import {embedded,migrate} from '../src/database.js';
import {Core} from '../src/core.js';
import {createApp} from '../src/app.js';
import {accountRoutes,type AccountProvider} from '../src/accounts.js';
import {itineraryRoutes} from '../src/itinerary-web.js';
import {normalizeAvatar,readProfile,saveProfile} from '../src/account-profiles.js';
import {flaineTrip} from '../src/acceptance.js';
import {initials} from '../web/profile-display.js';
const key=()=>({idempotencyKey:randomUUID()});

test('display names need no handle or uniqueness; revisions and legacy handles preserve account identity',async()=>{
  const db=await embedded(),a=randomUUID(),b=randomUUID();try{
    await migrate(db);assert.equal((await readProfile(db,a)).revision,0);
    const first=await saveProfile(db,a,{expectedRevision:0,displayName:' Alex Owner '});assert.equal(first.handle,null);assert.equal(first.displayName,'Alex Owner');
    const duplicate=await saveProfile(db,b,{expectedRevision:0,displayName:'Alex Owner'});assert.equal(duplicate.displayName,first.displayName);assert.equal(duplicate.handle,null);
    const legacy=await saveProfile(db,a,{expectedRevision:1,handle:'  ALEx_1 ',displayName:'Alex Owner'});assert.equal(legacy.handle,'alex_1');
    const edits=await Promise.allSettled(['Renamed','Other name'].map(displayName=>saveProfile(db,a,{expectedRevision:2,displayName})));assert.equal(edits.filter(e=>e.status==='fulfilled').length,1);
    const renamed=await readProfile(db,a);assert.equal(renamed.revision,3);assert.equal(renamed.handle,'alex_1');
    await assert.rejects(saveProfile(db,b,{expectedRevision:1,handle:'ALEX_1',displayName:'Friend'}),/already in use/);assert.equal((await readProfile(db,b)).revision,1);
    for(const handle of ['ab','two words','1start','a'.repeat(25)])await assert.rejects(saveProfile(db,b,{expectedRevision:1,handle,displayName:'Friend'}));
    await assert.rejects(saveProfile(db,b,{expectedRevision:1,displayName:'Invisible\u202Ename'}));
    await assert.rejects(saveProfile(db,b,{expectedRevision:1,displayName:'Friend',userId:a}));
    const roles=(await db.query("select relrowsecurity from pg_class where relname='account_profiles'")).rows;assert.equal(roles[0]!.relrowsecurity,true);
    assert.equal(initials('Alex Owner'),'AO');assert.equal(initials(' 李 明 '),'李明');assert.equal(initials(''),'TR');
  }finally{await db.close();}
});

test('avatar normalization bounds images, rejects active content and strips original metadata',async()=>{
  const original=await sharp({create:{width:320,height:200,channels:3,background:'#6366F1'}}).withMetadata({exif:{IFD0:{Artist:'PRIVATE fixture metadata'}}}).png().toBuffer();
  assert.ok((await sharp(original).metadata()).exif);
  const output=await normalizeAvatar(original,'image/png'),metadata=await sharp(output).metadata();
  assert.equal(metadata.format,'webp');assert.equal(metadata.width,256);assert.equal(metadata.height,256);assert.equal(metadata.exif,undefined);assert.equal(metadata.icc,undefined);assert.ok(output.length<=24576);
  for(const [bytes,mime]of [[Buffer.from('<svg onload="alert(1)"/>'),'image/svg+xml'],[Buffer.from('<svg/>'),'image/jpeg'],[original,'image/jpeg'],[original.subarray(0,16),'image/png'],[Buffer.alloc(2*1024*1024+1),'image/png']] as const)await assert.rejects(normalizeAvatar(bytes,mime));
  const large=await sharp({create:{width:4001,height:4000,channels:3,background:'white'}}).png().toBuffer();await assert.rejects(normalizeAvatar(large,'image/png'));
});

test('profile and avatar HTTP routes isolate accounts; rosters include accepted members only and anonymous views omit profiles',async()=>{
  const db=await embedded(),http=createServer(),owner=randomUUID(),editor=randomUUID(),viewer=randomUUID(),stranger=randomUUID();
  const identities:Record<string,string>={owner,editor,viewer,stranger};
  const provider:AccountProvider={authenticate:async header=>{const user=identities[header?.replace('Bearer ','')??''];if(!user)throw Error('No direct fixture session');return {userId:user,email:'private@example.test',token:'fixture'};},request:async()=>({})};
  try{
    await migrate(db);const core=new Core(db,false);
    const tripId=(await core.callFromWeb('create_trip',{...key(),...flaineTrip},owner)).tripId;
    const invite=async(user:string,role:'editor'|'viewer')=>{const created=await core.callFromWeb('create_itinerary_invite',{...key(),tripId,label:'Fixture invitation',role},owner);await core.callFromWeb('accept_itinerary_invite',{...key(),token:created.token,displayName:'Legacy member name'},user);return created.inviteId;};
    const editorInvite=await invite(editor,'editor');await invite(viewer,'viewer');await core.callFromWeb('create_itinerary_invite',{...key(),tripId,label:'Pending person',role:'editor'},owner);
    const link=await core.callFromWeb('create_itinerary_view_link',{...key(),tripId,label:'Fictional view link'},owner);
    await new Promise<void>(resolve=>http.listen(0,'127.0.0.1',resolve));const address=http.address();assert.ok(address&&typeof address!=='string');const origin=`http://127.0.0.1:${address.port}`;
    http.on('request',createApp({core,publicOrigin:origin,authenticate:async()=>{throw Error('MCP disabled');},accounts:accountRoutes({db,origin,provider,issuer:'https://fixture.invalid/auth/v1',publishableKey:'fixture'}),itinerary:itineraryRoutes({core,origin,authenticate:provider.authenticate})}));
    const request=(path:string,user='owner',body?:unknown,headers:Record<string,string>={})=>fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${user}`,origin,'content-type':'application/json',...headers},...(body===undefined?{}:{body:Buffer.isBuffer(body)?new Uint8Array(body).buffer:JSON.stringify(body)})});
    assert.equal((await request('/account/api/profile','missing')).status,401);
    assert.equal((await request('/account/api/profile','owner',{displayName:'Organizer',expectedRevision:0},{origin:'https://other.invalid'})).status,403);
    const saved=await(await request('/account/api/profile','owner',{displayName:'Organizer',expectedRevision:0})).json();assert.equal(saved.profile.revision,1);
    assert.equal((await request('/account/api/profile','editor',{userId:owner,displayName:'Other',expectedRevision:0})).status,400);
    const png=await sharp({create:{width:32,height:32,channels:3,background:'#F59E0B'}}).png().toBuffer();
    const upload=await request('/account/api/profile/avatar','owner',png,{'content-type':'image/png','x-profile-revision':'1'});assert.equal(upload.status,200);const withPhoto=(await upload.json()).profile;assert.ok(withPhoto.avatarDataUrl.startsWith('data:image/webp;base64,'));assert.equal(withPhoto.revision,2);
    assert.equal((await request('/account/api/profile/avatar','owner',png,{'content-type':'image/png','x-profile-revision':'1'})).status,409);
    assert.equal((await(await request('/account/api/profile','editor')).json()).profile.avatarDataUrl,null);
    assert.equal((await request('/account/api/profile/avatar','editor',Buffer.alloc(2*1024*1024+1),{'content-type':'image/png','x-profile-revision':'0'})).status,413);
    const roster=async(user='owner')=>request('/itinerary-api/trip-members',user,{tripId});
    const data=await(await roster()).json();assert.equal(data.members.length,3);assert.equal(data.members[0].displayName,'Organizer');assert.equal(data.members[0].handle,null);assert.ok(data.members[0].avatarDataUrl);assert.equal(data.members[0].isMe,true);assert.ok(!JSON.stringify(data).includes('private@example'));assert.ok(!JSON.stringify(data).includes('Pending person'));
    assert.equal((await roster('viewer')).status,200);assert.equal((await roster('stranger')).status,404);assert.equal((await roster('missing')).status,401);
    const anon=await(await fetch(origin+'/itinerary-share/read',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({token:link.token})})).json();assert.equal(anon.members,undefined);assert.ok(!JSON.stringify(anon).includes('owner_1'));assert.ok(!JSON.stringify(anon).includes('data:image'));
    await request('/account/api/profile','editor',{displayName:'New Friend Name',expectedRevision:0});
    assert.ok((await(await roster()).json()).members.some((m:any)=>m.displayName==='New Friend Name'&&m.handle===null));
    assert.ok((await core.callFromWeb('list_itinerary_access',{tripId},owner)).invites.some((i:any)=>i.display_name==='New Friend Name'));
    const removed=await(await request('/account/api/profile/remove-avatar','owner',{expectedRevision:2})).json();assert.equal(removed.profile.avatarDataUrl,null);assert.equal(removed.profile.avatarVersion,null);
    await core.callFromWeb('revoke_itinerary_access',{...key(),tripId,inviteId:editorInvite},owner);assert.equal((await roster('editor')).status,404);assert.equal((await(await roster()).json()).members.length,2);
    assert.equal((await request('/account/api/profile','owner',{userId:editor,handle:'wrong_1',displayName:'Wrong',expectedRevision:3})).status,400);
    for(let n=0;n<5;n++)await request('/account/api/profile/avatar','owner',Buffer.from('<svg/>'),{'content-type':'image/png','x-profile-revision':'3'});
    assert.equal((await request('/account/api/profile/avatar','owner',png,{'content-type':'image/png','x-profile-revision':'3'})).status,429);
  }finally{await new Promise<void>(resolve=>http.close(()=>resolve()));await db.close();}
});
