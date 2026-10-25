// Only a public Git SHA may leave the process through /health; never echo arbitrary env text.
export function deploymentCommit(env:NodeJS.ProcessEnv=process.env):string|null {
  return /^[a-f0-9]{40}$/i.test(env.RENDER_GIT_COMMIT??'')?env.RENDER_GIT_COMMIT!.toLowerCase():null;
}

export function databaseConnection(env: NodeJS.ProcessEnv = process.env): string {
  if (!env.DATABASE_URL) throw new Error('Missing DATABASE_URL');
  let database: URL;
  try { database = new URL(env.DATABASE_URL); } catch { throw new Error('Invalid DATABASE_URL'); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error('DATABASE_URL must use PostgreSQL');
  if (env.DATABASE_PASSWORD) database.password = encodeURIComponent(env.DATABASE_PASSWORD);
  if (!database.password || database.password.includes('YOUR-PASSWORD')) throw new Error('Set DATABASE_PASSWORD to your database password');
  return database.toString();
}

export function passkeysEnabled(origin:string, env:NodeJS.ProcessEnv=process.env):boolean {
  const enabled=env.PASSKEYS_ENABLED??'false';
  if(!['true','false'].includes(enabled))throw Error('PASSKEYS_ENABLED must be true or false');
  if(enabled==='false')return false;
  const url=new URL(origin),rp=env.PASSKEY_RP_ID;
  // One exact app hostname during the pilot. Never enroll on Render hostnames.
  if(!rp||rp!==url.hostname||rp==='onrender.com'||rp.endsWith('.onrender.com')||/^\d+\.\d+\.\d+\.\d+$/.test(rp)||rp.includes(':')||
    url.protocol!=='https:'&&rp!=='localhost')
    throw Error('Passkeys require PASSKEY_RP_ID matching the stable public hostname (not onrender.com) and HTTPS or loopback');
  if(!env.SUPABASE_PUBLISHABLE_KEY)throw Error('Passkeys require Supabase account sign-in');
  return true;
}

export function configuration(env: NodeJS.ProcessEnv = process.env) {
  const mode = env.APP_MODE ?? 'local';
  if (mode !== 'local' && mode !== 'hosted') throw new Error('APP_MODE must be local or hosted');
  const local = mode === 'local';
  if (local && (env.NODE_ENV === 'production' || env.RENDER === 'true')) throw new Error('Deployment requires APP_MODE=hosted');
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const required = (name: string) => { const value = env[name]; if (!value) throw new Error(`Missing ${name}`); return value; };
  const origin = local ? `http://127.0.0.1:${port}` : env.PUBLIC_ORIGIN || required('RENDER_EXTERNAL_URL');
  let parsed: URL;
  try { parsed = new URL(origin); } catch { throw new Error('Invalid public origin'); }
  if (parsed.origin !== origin || (!local && parsed.protocol !== 'https:')) throw new Error('Public origin must be HTTPS with no path or trailing slash');
  const migrateOnStart = env.MIGRATE_ON_START ?? 'false';
  if (!['true', 'false'].includes(migrateOnStart)) throw new Error('MIGRATE_ON_START must be true or false');
  const databaseUrl = local ? undefined : databaseConnection(env);
  const liveSearch=env.LIVE_SEARCH_ENABLED??'false';
  if(!['true','false'].includes(liveSearch))throw new Error('LIVE_SEARCH_ENABLED must be true or false');
  if(liveSearch==='true'&&!env.SERPAPI_API_KEY?.trim())throw new Error('Live search requires SERPAPI_API_KEY');
  if (env.SUPABASE_PUBLISHABLE_KEY && !/^sb_publishable_[A-Za-z0-9_-]+$/.test(env.SUPABASE_PUBLISHABLE_KEY)) throw new Error('Use a Supabase publishable key, never a secret/service-role key');
  const passkeys=passkeysEnabled(origin,env);
  if(passkeys&&local)throw Error('Passkeys require hosted account mode');
  return { mode, local, port, origin, passkeys, migrateOnStart: migrateOnStart === 'true',liveSearch:liveSearch==='true',
    databaseUrl, databaseCaFile: env.DATABASE_CA_FILE,
    publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
    issuer: local ? undefined : required('SUPABASE_AUTH_ISSUER'),
    audience: local ? undefined : env.MCP_AUDIENCE || `${origin}/mcp`,
  };
}
