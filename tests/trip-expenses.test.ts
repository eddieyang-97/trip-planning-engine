import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import pg from 'pg';
import {z} from 'zod';
import {Core,type ToolName} from '../src/core.js';
import {embedded,migrate,pooledDatabase,type Database} from '../src/database.js';
import {DomainError} from '../src/domain.js';
import {equalShares,parsePounds} from '../src/expense-split.js';
import {readItineraryViewLink} from '../src/itinerary-view-links.js';
import type {ExpenseLedger} from '../src/trip-expenses.js';

const denied=(code:string)=>(error:unknown)=>error instanceof DomainError&&error.code===code;
const trip={name:'Fictional forest weekend',destination:'Fictional village',startDate:'2027-01-08',endDate:'2027-01-11',adults:10};
async function setup(db:Database,count:number){
  const core=new Core(db,false),owner=randomUUID();
  const write=(name:ToolName,args:Record<string,unknown>,user=owner)=>core.callFromWeb(name,{idempotencyKey:randomUUID(),...args},user);
  const {tripId}=await write('create_trip',trip),travelers:string[]=[];
  for(let i=0;i<count;i++){
    const result=await write('manage_trip_traveler',{tripId,expectedRevision:i+1,change:{action:'add',name:`Traveler ${i+1}`}});
    travelers.push(result.travelerId);
  }
  const read=(user=owner)=>core.callFromWeb('get_trip_expenses',{tripId},user) as Promise<ExpenseLedger>;
  return {core,owner,write,tripId,travelers,read};
}

test('GBP input and equal shares conserve every penny regardless of selection order',()=>{
  assert.equal(parsePounds('2000'),200000);
  assert.equal(parsePounds('2.1'),210);
  for(const amount of ['0','-1','1.001','£2','1e3','1000000.01'])assert.equal(parsePounds(amount),null);
  assert.deepEqual(equalShares(100,['c','b','a']),[{travelerId:'a',amountMinor:34},{travelerId:'b',amountMinor:33},{travelerId:'c',amountMinor:33}]);
  assert.deepEqual(equalShares(1,['b','a']).map(share=>share.amountMinor),[1,0]);
});

test('expense ledger persists the actual payer, subset shares, corrections and privacy boundaries',async()=>{
  const db=await embedded();
  try{
    await migrate(db);
    const {core,owner,write,tripId,travelers,read}=await setup(db,10);
    const editor=randomUUID();
    const lodge={title:'Lodge',paidOn:'2027-01-08',payerId:travelers[0],amountMinor:200000,currency:'GBP',travelerIds:travelers};
    const activity={...lodge,title:'Activity',amountMinor:24000,payerId:travelers[9],travelerIds:travelers.slice(0,6)};
    const lodgeArgs={tripId,expectedRevision:0,expense:lodge,idempotencyKey:randomUUID()};
    const first=await write('save_trip_expense',lodgeArgs);
    assert.deepEqual(await write('save_trip_expense',lodgeArgs),first);
    await assert.rejects(write('save_trip_expense',{...lodgeArgs,expense:{...lodge,amountMinor:1}}),denied('IDEMPOTENCY_CONFLICT'));
    const second=await write('save_trip_expense',{tripId,expectedRevision:1,expense:activity});
    const plan=await read();
    assert.equal(plan.revision,2);
    assert.deepEqual(plan.expenses.find(entry=>entry.id===first.expenseId)!.shares.map(share=>share.amountMinor),Array(10).fill(20000));
    assert.deepEqual(plan.expenses.find(entry=>entry.id===second.expenseId)!.shares.map(share=>share.amountMinor),Array(6).fill(4000));
    assert.equal(plan.balances[6]!.balanceMinor,-20000);
    assert.equal(plan.balances[9]!.balanceMinor,4000);
    assert.equal(plan.balances.reduce((total,balance)=>total+balance.balanceMinor,0),0);
    const foreign=await setup(db,1);
    await assert.rejects(write('save_trip_expense',{tripId,expectedRevision:2,expense:{...activity,travelerIds:foreign.travelers}}),denied('VALIDATION_ERROR'));
    await assert.rejects(write('save_trip_expense',{tripId,expectedRevision:2,expense:{...activity,currency:'EUR'}}),z.ZodError);
    await assert.rejects(read(editor),denied('FORBIDDEN_OR_NOT_FOUND'));
    const invite=await write('create_itinerary_invite',{tripId,label:'Fixture editor',role:'editor'});
    await write('accept_itinerary_invite',{token:invite.token,displayName:'Fixture editor'},editor);
    assert.equal((await read(editor)).expenses.length,2);
    assert.deepEqual((await read(editor)).history,[]);
    await assert.rejects(write('void_trip_expense',{tripId,expectedRevision:2,expenseId:first.expenseId},editor),denied('FORBIDDEN_OR_NOT_FOUND'));
    await assert.rejects(core.call('get_trip_expenses',{tripId},{userId:owner,clientId:'fixture'}),denied('FORBIDDEN_OR_NOT_FOUND'));
    const link=await write('create_itinerary_view_link',{tripId,label:'Account-free fixture'});
    assert.ok(!JSON.stringify(await readItineraryViewLink(db,{token:link.token})).includes('Lodge'));

    await write('manage_trip_traveler',{tripId,expectedRevision:11,change:{action:'archive',id:travelers[9]}});
    assert.equal((await read(editor)).travelers[9]!.name,'');
    await write('save_trip_expense',{tripId,expectedRevision:2,expenseId:second.expenseId,expense:{...activity,amountMinor:24001}});
    await assert.rejects(write('void_trip_expense',{tripId,expectedRevision:2,expenseId:second.expenseId}),denied('REVISION_CONFLICT'));
    const corrected=await read();
    assert.equal(corrected.expenses.find(entry=>entry.id===second.expenseId)!.shares.reduce((sum,share)=>sum+share.amountMinor,0),24001);
    assert.deepEqual(corrected.history.filter(entry=>entry.id===second.expenseId).map(entry=>[entry.action,entry.amountMinor]),[['corrected',24001],['recorded',24000]]);
    await write('void_trip_expense',{tripId,expectedRevision:3,expenseId:second.expenseId});
    const final=await read();
    assert.equal(final.expenses.length,1);
    assert.equal(final.balances[9]!.balanceMinor,-20000);
    assert.equal(final.history[0]!.action,'voided');
    assert.equal((await core.callFromWeb('get_itinerary',{tripId},owner)).revision,12);
    await write('revoke_itinerary_access',{tripId,inviteId:invite.inviteId});
    await assert.rejects(read(editor),denied('FORBIDDEN_OR_NOT_FOUND'));
    const review=await write('prepare_trip_action',{tripId,action:'delete'});
    await write('delete_trip',{tripId,expectedRevision:review.expectedRevision,confirmationToken:review.confirmationToken,confirmationName:trip.name,confirmed:true});
    assert.equal((await db.query('select revision from trip_expense_events where trip_id=$1',[tripId])).rows.length,0);
  }finally{await db.close();}
});

test('pooled PostgreSQL commits only one competing expense write at the same ledger revision',{skip:!process.env.TEST_POSTGRES_URL,timeout:30000},async()=>{
  const url=new URL(process.env.TEST_POSTGRES_URL!);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));assert.equal(url.search,'');
  const schema='test_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:url.href,max:1});
  let db:Database|undefined;
  try{
    await admin.query(`create schema ${schema}`);
    db=pooledDatabase(new pg.Pool({connectionString:url.href,max:4,options:`-c search_path=${schema}`,statement_timeout:10000}));
    // The account-linking migration owns a function in public and is tested separately.
    for(const file of ['001_initial.sql','003_policy_notes.sql','004_itinerary.sql','005_live_search.sql','006_itinerary_sharing.sql','007_itinerary_editors.sql','008_itinerary_view_links.sql','009_itinerary_comments.sql','010_account_profiles.sql','011_trip_lifecycle.sql','012_decision_archive.sql','013_stay_comparison.sql','014_dining_comparison.sql','015_trip_travelers.sql','016_trip_expenses.sql']){
      await db.execute(await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
    }
    const {tripId,travelers,write,read}=await setup(db,2);
    const expense={title:'Fictional tickets',paidOn:'2027-01-08',payerId:travelers[0],amountMinor:101,currency:'GBP',travelerIds:travelers};
    const results=await Promise.allSettled([101,102].map(amountMinor=>write('save_trip_expense',{tripId,expectedRevision:0,expense:{...expense,amountMinor}})));
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
    assert.equal(results.filter(result=>result.status==='rejected'&&denied('REVISION_CONFLICT')(result.reason)).length,1);
    const stored=await read();
    assert.equal(stored.revision,1);
    assert.equal(stored.expenses.length,1);
    assert.equal(stored.history.length,1);
    assert.equal(stored.expenses[0]!.shares.reduce((sum,share)=>sum+share.amountMinor,0),stored.expenses[0]!.amountMinor);
  }finally{await db?.close();await admin.query(`drop schema if exists ${schema} cascade`);await admin.end();}
});
