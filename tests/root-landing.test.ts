import assert from 'node:assert/strict';
import {test} from 'node:test';
import express from 'express';
import {accountRoutes, type AccountProvider} from '../src/accounts.js';
import type {Database} from '../src/database.js';

test('root redirects to the itinerary while account and OAuth consent still work',async()=>{
  const provider:AccountProvider={
    authenticate:async()=>{throw Error('No account sign-in in route fixture');},
    request:async()=>{throw Error('No provider requests in route fixture');},
  };
  const app=express();
  app.use(accountRoutes({db:{} as Database,provider,origin:'http://localhost:3000',
    issuer:'https://auth.example/auth/v1',publishableKey:'sb_publishable_fixture'}));
  const server=app.listen(0,'127.0.0.1');
  try{
    await new Promise<void>((resolve,reject)=>{
      server.once('listening',resolve);
      server.once('error',reject);
    });
    const address=server.address();
    assert.ok(address&&typeof address!=='string');
    const base=`http://127.0.0.1:${address.port}`;
    const root=await fetch(`${base}/`,{redirect:'manual'});
    assert.equal(root.status,302);
    assert.equal(root.headers.get('location'),'/itinerary');

    for(const path of ['/account','/oauth/consent']){
      const response=await fetch(`${base}${path}`,{redirect:'manual'});
      assert.equal(response.status,200,path);
      assert.match(response.headers.get('content-type')??'',/text\/html/,path);
      assert.match(await response.text(),/Trip Planner — Your account/,path);
    }
  }finally{
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
});
