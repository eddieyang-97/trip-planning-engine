import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {embedded,migrate,schemaVersion,type Database} from '../src/database.js';
import {Core} from '../src/core.js';
import {flaineTrip} from '../src/acceptance.js';

const roles=['anon','authenticated'];
const privileges=['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'];
const denied=(error:unknown)=>typeof error==='object'&&error!==null&&'code' in error&&error.code==='42501';
async function asRole(db:Database,role:string,sql:string){
  assert.ok(roles.includes(role));
  return db.transaction(async tx=>{await tx.execute(`set local role ${role}`);return tx.query(sql);});
}
async function assertProtected(db:Database){
  assert.equal((await db.query("select relrowsecurity from pg_class where oid='app_schema_migrations'::regclass")).rows[0]!.relrowsecurity,true);
  for(const role of roles){
    assert.equal((await db.query("select has_any_column_privilege($1,'app_schema_migrations','SELECT,INSERT,UPDATE,REFERENCES') as allowed",[role])).rows[0]!.allowed,false,role+' must not retain column grants');
    for(const privilege of privileges)assert.equal((await db.query("select has_table_privilege($1,'app_schema_migrations',$2) as allowed",[role,privilege])).rows[0]!.allowed,false,`${role} must not have ${privilege}`);
    for(const sql of ['select * from app_schema_migrations','insert into app_schema_migrations values(999)',
      'update app_schema_migrations set version=999 where version=1','delete from app_schema_migrations where version=1','truncate app_schema_migrations']){
      await assert.rejects(asRole(db,role,sql),denied);
    }
  }
  assert.deepEqual((await db.query('select version from app_schema_migrations order by version')).rows.map(row=>row.version),Array.from({length:schemaVersion},(_,i)=>i+1));
}

test('fresh bootstrap denies browser roles even with permissive default grants; every application table has RLS',async()=>{
  const db=await embedded();
  try{
    await db.execute('create role anon; create role authenticated; alter default privileges in schema public grant all on tables to anon,authenticated');
    await migrate(db);await migrate(db);
    await assertProtected(db);
    const unprotected=await db.query("select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity");
    assert.deepEqual(unprotected.rows,[],'Bootstrap metadata is part of the application security boundary');
  }finally{await db.close();}
});

test('current-version bootstrap repairs old metadata grants without replaying migrations or changing trip data',async()=>{
  const db=await embedded();
  try{
    await db.execute('create role anon; create role authenticated');await migrate(db);
    const trip=await new Core(db,false).callFromWeb('create_trip',{...flaineTrip,idempotencyKey:randomUUID()},randomUUID());
    const before=(await db.query('select * from trips where id=$1',[trip.tripId])).rows;
    await db.execute('alter table app_schema_migrations disable row level security; grant all on app_schema_migrations to public,anon,authenticated; grant all(version) on app_schema_migrations to public,anon,authenticated');
    assert.equal((await db.query("select has_table_privilege('anon','app_schema_migrations','TRUNCATE') as allowed")).rows[0]!.allowed,true);
    await migrate(db);await migrate(db);await assertProtected(db);
    assert.deepEqual((await db.query('select * from trips where id=$1',[trip.tripId])).rows,before);
    // RLS is an independent backstop if a future default/manual grant reappears.
    await db.execute('grant select,insert,update,delete on app_schema_migrations to anon,authenticated');
    for(const role of roles){
      assert.deepEqual((await asRole(db,role,'select * from app_schema_migrations')).rows,[]);
      await assert.rejects(asRole(db,role,'insert into app_schema_migrations values(999)'),denied);
      assert.deepEqual((await asRole(db,role,'update app_schema_migrations set version=999 returning version')).rows,[]);
      assert.deepEqual((await asRole(db,role,'delete from app_schema_migrations returning version')).rows,[]);
    }
    await migrate(db);await assertProtected(db);
    // The separately reviewed operational SQL repairs the same legacy state.
    await db.execute('alter table app_schema_migrations disable row level security; grant all on app_schema_migrations to public,anon,authenticated; grant all(version) on app_schema_migrations to public,anon,authenticated');
    await db.execute(await readFile(new URL('../scripts/harden-migration-metadata.sql',import.meta.url),'utf8'));
    await assertProtected(db);
    assert.deepEqual((await db.query('select * from trips where id=$1',[trip.tripId])).rows,before);
  }finally{await db.close();}
});
