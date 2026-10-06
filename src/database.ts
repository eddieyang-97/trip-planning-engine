import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { readFile } from 'node:fs/promises';

export interface Queryable {
  query<T extends Record<string, any> = Record<string, any>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  execute(sql: string): Promise<void>;
}
export interface Database extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export async function embedded(path?: string): Promise<Database> {
  const db = new PGlite(path);
  await db.waitReady;
  return {
    query: (sql, params) => db.query(sql, params),
    execute: async sql => { await db.exec(sql); },
    transaction: fn => db.transaction(tx => fn({ query: (sql, params) => tx.query(sql, params), execute: async sql => { await tx.exec(sql); } })),
    close: () => db.close(),
  };
}
export async function postgres(url: string, caPath?: string): Promise<Database> {
  const parsed = new URL(url);
  // Avoid pg connection-string parameters overriding TLS verification.
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) {
    if (parsed.searchParams.has(key)) throw new Error('Configure TLS with DATABASE_CA_FILE, not URL SSL parameters');
  }
  const pool = new pg.Pool({ connectionString: url, max: 5, ssl: {
    rejectUnauthorized: true, ...(caPath ? { ca: await readFile(caPath, 'utf8') } : {}),
  } });
  return {
    query: async (sql, params) => { const result = await pool.query(sql, params); return { rows: result.rows }; },
    execute: async sql => { await pool.query(sql); },
    transaction: async fn => {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await fn({ query: (sql, params) => client.query(sql, params), execute: async sql => { await client.query(sql); } });
        await client.query('commit'); return result;
      }
      catch (error) { await client.query('rollback'); throw error; }
      finally { client.release(); }
    },
    close: () => pool.end(),
  };
}
export async function migrate(db: Database) {
  const sql = await readFile(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8');
  await db.transaction(async tx => {
    await tx.query('create table if not exists app_schema_migrations (version integer primary key)');
    await tx.query('lock table app_schema_migrations in exclusive mode');
    const done = await tx.query('select version from app_schema_migrations where version=1');
    if (!done.rows.length) { await tx.execute(sql); await tx.query('insert into app_schema_migrations values (1)'); }
  });
}
