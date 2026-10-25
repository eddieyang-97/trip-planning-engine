import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { readFile } from 'node:fs/promises';

export interface Queryable {
  query<T extends Record<string, any> = Record<string, any>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  execute(sql: string): Promise<void>;
}
export interface Database extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>,options?:{readOnly?:boolean}): Promise<T>;
  close(): Promise<void>;
}
export async function embedded(path?: string): Promise<Database> {
  const db = new PGlite(path);
  await db.waitReady;
  return {
    query: (sql, params) => db.query(sql, params),
    execute: async sql => { await db.exec(sql); },
    transaction: (fn,options) => db.transaction(async tx => {
      if(options?.readOnly)await tx.exec('set transaction isolation level repeatable read read only');
      return fn({ query: (sql, params) => tx.query(sql, params), execute: async sql => { await tx.exec(sql); } });
    }),
    close: () => db.close(),
  };
}
export async function postgres(url: string, caPath?: string): Promise<Database> {
  const parsed = new URL(url);
  // Avoid pg connection-string parameters overriding TLS verification.
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) {
    if (parsed.searchParams.has(key)) throw new Error('Configure TLS with DATABASE_CA_FILE, not URL SSL parameters');
  }
  const pool = new pg.Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000, idle_in_transaction_session_timeout: 30_000, ssl: {
    rejectUnauthorized: true, ...(caPath ? { ca: await readFile(caPath, 'utf8') } : {}),
  } });
  pool.on('error', () => { console.error('An idle PostgreSQL connection failed; a later request will reconnect.'); });
  return pooledDatabase(pool);
}
// Shared transaction implementation. Tests supply an isolated loopback PostgreSQL pool;
// production pools are always constructed above with verified TLS.
export function pooledDatabase(pool:pg.Pool):Database {
  return {
    query: async (sql, params) => { const result = await pool.query(sql, params); return { rows: result.rows }; },
    execute: async sql => { await pool.query(sql); },
    transaction: async (fn,options) => {
      const client = await pool.connect();
      try {
        await client.query(options?.readOnly?'begin isolation level repeatable read read only':'begin');
        const result = await fn({ query: (sql, params) => client.query(sql, params), execute: async sql => { await client.query(sql); } });
        await client.query('commit'); return result;
      }
      catch (error) { await client.query('rollback'); throw error; }
      finally { client.release(); }
    },
    close: () => pool.end(),
  };
}
const migrations = ['001_initial.sql', '002_account_linking.sql', '003_policy_notes.sql', '004_itinerary.sql', '005_live_search.sql', '006_itinerary_sharing.sql', '007_itinerary_editors.sql', '008_itinerary_view_links.sql', '009_itinerary_comments.sql', '010_account_profiles.sql','011_trip_lifecycle.sql','012_decision_archive.sql','013_stay_comparison.sql'];
export const schemaVersion = migrations.length;
export async function migrate(db: Database) {
  await db.transaction(async tx => {
    // Serialize even the first migration, before the version table exists.
    await tx.query('select pg_advisory_xact_lock(781349, 1)');
    await tx.query('create table if not exists app_schema_migrations (version integer primary key)');
    await tx.query('lock table app_schema_migrations in exclusive mode');
    // Bootstrap metadata is outside the numbered migrations. Protect existing
    // installations too, even when every numbered migration already ran.
    // The owning migration/server connection retains access; Data API roles do not.
    await tx.execute(`
      alter table app_schema_migrations enable row level security;
      revoke all on table app_schema_migrations from public;
      revoke all (version) on table app_schema_migrations from public;
      do $$ begin
        if exists(select 1 from pg_roles where rolname='anon') then
          revoke all on table app_schema_migrations from anon;
          revoke all (version) on table app_schema_migrations from anon;
        end if;
        if exists(select 1 from pg_roles where rolname='authenticated') then
          revoke all on table app_schema_migrations from authenticated;
          revoke all (version) on table app_schema_migrations from authenticated;
        end if;
      end $$;
    `);
    for (const [index, file] of migrations.entries()) {
      const version = index + 1;
      const done = await tx.query('select version from app_schema_migrations where version=$1', [version]);
      if (!done.rows.length) {
        await tx.execute(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
        await tx.query('insert into app_schema_migrations values ($1)', [version]);
      }
    }
  });
}
