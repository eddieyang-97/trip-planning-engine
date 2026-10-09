import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createApp } from './app.js';
import { hostedAuthentication, localActor, localAuthentication } from './auth.js';
import { Core, runOneJob } from './core.js';
import { embedded, migrate, postgres, schemaVersion } from './database.js';
import { FixtureProvider } from './providers.js';
import { configuration } from './config.js';
import { accountRoutes, supabaseAccounts } from './accounts.js';

const config = configuration();
const { mode, local, port, origin, issuer } = config;
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
const authenticate = local ? localAuthentication(token!) : hostedAuthentication(issuer!, config.audience!);
const db = local ? await embedded(dataPath) : await postgres(config.databaseUrl!, config.databaseCaFile);
if (local || config.migrateOnStart) await migrate(db);
if (local) {
  await db.query(`insert into client_grants(owner_id,client_id,permissions) values($1,$2,$3)
    on conflict do nothing`, [localActor.userId, localActor.clientId, ['read', 'write', 'search']]);
} else {
  const migration = await db.query('select version from app_schema_migrations where version=$1',[schemaVersion]);
  if (!migration.rows.length) throw new Error('Run migrations before starting hosted mode');
}
if (!local) await db.query(`insert into oauth_resource(singleton,audience) values(true,$1)
  on conflict(singleton) do update set audience=excluded.audience`, [config.audience]);
const app = createApp({ core: new Core(db, local), authenticate, publicOrigin: origin, issuer,
  accounts: !local && config.publishableKey ? accountRoutes({ db, origin, issuer:issuer!, publishableKey:config.publishableKey,
    provider:supabaseAccounts(issuer!,config.publishableKey) }) : undefined,
  ready: async () => { await db.query('select 1'); } });
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
