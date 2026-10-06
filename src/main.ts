import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createApp } from './app.js';
import { hostedAuthentication, localActor, localAuthentication } from './auth.js';
import { Core, runOneJob } from './core.js';
import { embedded, migrate, postgres } from './database.js';
import { FixtureProvider } from './providers.js';

const mode = process.env.APP_MODE ?? 'local';
if (!['local', 'hosted'].includes(mode)) throw new Error('APP_MODE must be local or hosted');
const local = mode === 'local';
if (local && process.env.NODE_ENV === 'production') throw new Error('Production requires APP_MODE=hosted');
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; }
const origin = local ? `http://127.0.0.1:${port}` : required('PUBLIC_ORIGIN');
if (!local && new URL(origin).protocol !== 'https:') throw new Error('Hosted mode requires HTTPS');
const dataPath = resolve(process.env.DATA_DIR ?? '.data/postgres');
let token = process.env.LOCAL_TOKEN;
if (local && !token) {
  const tokenPath = resolve(dirname(dataPath), 'local-token');
  await mkdir(dirname(tokenPath), { recursive: true });
  try { token = (await readFile(tokenPath, 'utf8')).trim(); }
  catch (error: any) {
    if (error.code !== 'ENOENT') throw error;
    token = randomBytes(32).toString('base64url');
    await writeFile(tokenPath, token, { flag: 'wx', mode: 0o600 });
  }
  console.log(`Local bearer token stored at ${tokenPath}; it is not printed to logs.`);
}
const issuer = local ? undefined : required('SUPABASE_AUTH_ISSUER');
const authenticate = local ? localAuthentication(token!) : hostedAuthentication(issuer!, required('MCP_AUDIENCE'));
const db = local ? await embedded(dataPath) : await postgres(required('DATABASE_URL'), process.env.DATABASE_CA_FILE);
if (local) {
  await migrate(db);
  await db.query(`insert into client_grants(owner_id,client_id,permissions) values($1,$2,$3)
    on conflict do nothing`, [localActor.userId, localActor.clientId, ['read', 'write', 'search']]);
} else {
  const migration = await db.query('select version from app_schema_migrations where version=1');
  if (!migration.rows.length) throw new Error('Run migrations before starting hosted mode');
}
const app = createApp({ core: new Core(db, local), authenticate, publicOrigin: origin, issuer });
const server = app.listen(port, local ? '127.0.0.1' : '0.0.0.0', () => {
  console.log(`Travel decision MCP listening at ${origin}/mcp (${mode}; live search unavailable)`);
});
server.requestTimeout = 30_000;
let active: Promise<unknown> | undefined;
const provider = new FixtureProvider();
const timer = local ? setInterval(() => {
  if (!active) active = runOneJob(db, provider).catch(() => console.error('Fixture worker failed')).finally(() => { active = undefined; });
}, 500) : undefined;
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  if (timer) clearInterval(timer);
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await active;
  await db.close();
}
process.on('SIGINT', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); });
