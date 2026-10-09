export function databaseConnection(env: NodeJS.ProcessEnv = process.env): string {
  if (!env.DATABASE_URL) throw new Error('Missing DATABASE_URL');
  let database: URL;
  try { database = new URL(env.DATABASE_URL); } catch { throw new Error('Invalid DATABASE_URL'); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error('DATABASE_URL must use PostgreSQL');
  if (env.DATABASE_PASSWORD) database.password = encodeURIComponent(env.DATABASE_PASSWORD);
  if (!database.password || database.password.includes('YOUR-PASSWORD')) throw new Error('Set DATABASE_PASSWORD to your database password');
  return database.toString();
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
  if (env.SUPABASE_PUBLISHABLE_KEY && !/^sb_publishable_[A-Za-z0-9_-]+$/.test(env.SUPABASE_PUBLISHABLE_KEY)) throw new Error('Use a Supabase publishable key, never a secret/service-role key');
  return { mode, local, port, origin, migrateOnStart: migrateOnStart === 'true',
    databaseUrl, databaseCaFile: env.DATABASE_CA_FILE,
    publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
    issuer: local ? undefined : required('SUPABASE_AUTH_ISSUER'),
    audience: local ? undefined : env.MCP_AUDIENCE || `${origin}/mcp`,
  };
}
