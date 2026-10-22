import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createApp } from './app.js';
import { hostedAuthentication, localActor, localAuthentication } from './auth.js';
import { Core, runOneJob,saveOffer } from './core.js';
import {SerpApiFlightProvider} from './live-provider.js';
import {runOneLiveJob} from './live-search.js';
import { embedded, migrate, postgres, schemaVersion } from './database.js';
import { FixtureProvider } from './providers.js';
import { configuration, deploymentCommit } from './config.js';
import {startSearchWorker} from './search-worker.js';
import {serviceShutdown} from './shutdown.js';
import { accountRoutes, supabaseAccounts } from './accounts.js';
import { itineraryRoutes } from './itinerary-web.js';

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
const core=new Core(db,local,config.liveSearch);
const accounts=!local&&config.publishableKey?supabaseAccounts(issuer!,config.publishableKey):undefined;
const app = createApp({ core, authenticate, publicOrigin: origin, issuer,
  deployment:{commit:deploymentCommit(),schemaVersion},
  itinerary:itineraryRoutes({core,origin,local,authenticate:local?authenticate:accounts?.authenticate,
    supabaseUrl:issuer?new URL(issuer).origin:undefined,publishableKey:config.publishableKey}),
  accounts: !local && config.publishableKey ? accountRoutes({ db, origin, issuer:issuer!, publishableKey:config.publishableKey,
    provider:accounts!, liveSearch:config.liveSearch }) : undefined,
  ready: async () => { await db.query('select 1'); } });
const server = app.listen(port, local ? '127.0.0.1' : '0.0.0.0', () => {
  console.log(`Travel decision MCP listening at ${origin}/mcp (${mode}; live pilot ${config.liveSearch?'enabled':'disabled'})`);
});
server.requestTimeout = 30_000;
const provider = new FixtureProvider();
const liveProvider=config.liveSearch?new SerpApiFlightProvider(process.env.SERPAPI_API_KEY!):undefined;
const worker = local||liveProvider ? startSearchWorker(async signal=>{
  if(liveProvider)await runOneLiveJob(db,liveProvider,saveOffer,signal);
  if(local&&!signal.aborted)await runOneJob(db,provider);
},()=>console.error('Search worker failed; persisted run state will be recovered without retrying live requests.')) : undefined;
const stop=serviceShutdown({
  stopWork:()=>worker?.stop(),
  closeHttp:()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())),
  closeDatabase:()=>db.close(),
  onFailure:()=>{
    console.error('Shutdown incomplete; durable live attempts require conservative recovery.');
    process.exit(1);
  },
});
process.on('SIGINT', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); });
