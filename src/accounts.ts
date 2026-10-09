import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Router, json, type Request, type Response, type NextFunction } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { bearer } from './auth.js';
import { uuid } from './domain.js';
import type { Database } from './database.js';

export interface AccountIdentity { userId: string; email: string; token: string }
export interface AccountProvider {
  authenticate(header?: string): Promise<AccountIdentity>;
  request(identity: AccountIdentity, path: string, method?: string, body?: unknown): Promise<any>;
}
export function supabaseAccounts(issuer: string, publishableKey: string, keys?: JWTVerifyGetKey, send = fetch): AccountProvider {
  const jwks = keys ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  async function request(identity: AccountIdentity, path: string, method = 'GET', body?: unknown) {
    const response = await send(`${issuer}${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { apikey: publishableKey, Authorization: `Bearer ${identity.token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) throw new Error('Supabase authorization request failed');
    return response.status === 204 ? {} : response.json();
  }
  return { request, authenticate: async header => {
    const token = bearer(header);
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: 'authenticated', algorithms: ['ES256', 'RS256'],
      requiredClaims: ['sub', 'iat', 'exp', 'session_id'] });
    if (payload.client_id || payload.is_anonymous === true || payload.role !== 'authenticated') throw new Error('Direct sign-in required');
    if (typeof payload.iat !== 'number' || payload.iat > Math.floor(Date.now()/1000)+30) throw new Error('Invalid session');
    const userId = uuid.parse(payload.sub);
    // Check the live identity as well as the signature; never trust a posted account ID.
    const user = await request({ userId, token, email: '' }, '/user');
    if (user.id !== userId || !user.email || !user.email_confirmed_at) throw new Error('Confirmed account required');
    return { userId, token, email: user.email };
  } };
}

const authorizationId = z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/);
const consentInput = z.strictObject({ requestId: uuid, action: z.enum(['approve', 'deny']),
  permissions: z.array(z.enum(['read', 'write', 'search'])).max(3).default([]) });
function redirectURL(value: unknown, expected?: string): string {
  const url = new URL(z.string().max(4096).parse(value));
  if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new Error('Invalid client redirect');
  if (expected) { const base = new URL(expected); if (base.origin !== url.origin || base.pathname !== url.pathname) throw new Error('Redirect mismatch'); }
  return url.href;
}
export function accountRoutes(options: { db: Database; provider: AccountProvider; origin: string; issuer: string; publishableKey: string }) {
  const router = Router(), { db, provider, origin } = options;
  router.use((_req, res, next) => {
    res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' ${new URL(options.issuer).origin}; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff'); next();
  });
  router.get(['/','/account','/oauth/consent'], async (_req,res) => res.type('html').send(await readFile(new URL('../web/account.html',import.meta.url),'utf8')));
  router.get('/assets/account.js', async (_req,res) => res.type('application/javascript').send(await readFile(resolve('dist/web/account.js'),'utf8')));
  router.get('/assets/account.css', async (_req,res) => res.type('text/css').send(await readFile(new URL('../web/account.css',import.meta.url),'utf8')));
  router.get('/account/config', (_req,res) => res.json({ supabaseUrl: new URL(options.issuer).origin, publishableKey: options.publishableKey, mcpUrl: `${origin}/mcp` }));
  router.use('/account/api', async (req,res,next) => {
    // No cookie authentication: a caller needs a direct-session bearer token.
    // Cross-origin writes are forbidden even if a caller supplies credentials.
    if (req.method !== 'GET' && req.headers.origin !== origin) { res.status(403).json({ error: 'Open the account page to make changes.' }); return; }
    try { res.locals.identity = await provider.authenticate(req.headers.authorization); next(); }
    catch { res.status(401).json({ error: 'Sign in to your travel account again.' }); }
  }, json({ limit: '8kb' }));
  router.get('/account/api/me', (_req,res) => res.json({ userId: res.locals.identity.userId, email: res.locals.identity.email }));
  router.get('/account/api/connections', async (_req,res) => {
    const result = await db.query(`select c.client_id,c.client_name,c.updated_at,g.permissions,g.revoked_at
      from oauth_connections c join client_grants g using(owner_id,client_id) where c.owner_id=$1 order by c.updated_at desc limit 100`, [res.locals.identity.userId]);
    res.json({ connections: result.rows });
  });
  router.post('/account/api/authorization', async (req,res) => {
    const { authorization_id } = z.strictObject({ authorization_id: authorizationId }).parse(req.body);
    const identity: AccountIdentity = res.locals.identity;
    const details = await provider.request(identity, `/oauth/authorizations/${encodeURIComponent(authorization_id)}`);
    if (details.redirect_url) { res.json({ redirectUrl: redirectURL(details.redirect_url) }); return; }
    if (details.authorization_id !== authorization_id || details.user?.id !== identity.userId) throw new Error('Authorization identity mismatch');
    const clientId = uuid.parse(details.client?.id), clientName = z.string().min(1).max(200).parse(details.client?.name);
    const redirectUri = redirectURL(details.redirect_uri), requestId = randomUUID();
    await db.transaction(async tx => {
      await tx.query('delete from oauth_consent_requests where expires_at < now()');
      await tx.query('delete from oauth_consent_requests where owner_id=$1 and authorization_id=$2', [identity.userId, authorization_id]);
      await tx.query(`insert into oauth_consent_requests(id,owner_id,authorization_id,client_id,client_name,redirect_uri,expires_at)
        values($1,$2,$3,$4,$5,$6,now()+interval '10 minutes')`, [requestId,identity.userId,authorization_id,clientId,clientName,redirectUri]);
    });
    res.json({ requestId, clientId, clientName, redirectUri, scope: z.string().max(500).parse(details.scope) });
  });
  router.post('/account/api/consent', async (req,res) => {
    const input = consentInput.parse(req.body), identity: AccountIdentity = res.locals.identity;
    if (input.action === 'approve' && (!input.permissions.includes('read') || (input.permissions.includes('search') && !input.permissions.includes('write')))) { res.status(400).json({ error:'Approval requires read access; searches also require write access.' }); return; }
    const outcome = await db.transaction(async tx => {
      const pending = (await tx.query(`select * from oauth_consent_requests where id=$1 and owner_id=$2
        and expires_at>now() and consumed_at is null for update`, [input.requestId,identity.userId])).rows[0];
      if (!pending) return null;
      const result = await provider.request(identity, `/oauth/authorizations/${encodeURIComponent(pending.authorization_id)}/consent`, 'POST', { action:input.action });
      const redirect = redirectURL(result.redirect_url,pending.redirect_uri);
      if (input.action === 'approve') {
        await tx.query(`insert into client_grants(owner_id,client_id,permissions) values($1,$2,$3)
          on conflict(owner_id,client_id) do update set permissions=excluded.permissions,revoked_at=null`, [identity.userId,pending.client_id,[...new Set(input.permissions)]]);
        await tx.query(`insert into oauth_connections(owner_id,client_id,client_name,grant_version) values($1,$2,$3,$4)
          on conflict(owner_id,client_id) do update set client_name=excluded.client_name,grant_version=excluded.grant_version,updated_at=now()`, [identity.userId,pending.client_id,pending.client_name,randomUUID()]);
      }
      await tx.query('update oauth_consent_requests set consumed_at=now() where id=$1',[input.requestId]);
      return redirect;
    });
    if (!outcome) { res.status(409).json({ error:'This approval expired or was already used. Restart the connection from your assistant.' }); return; }
    res.json({ redirectUrl:outcome });
  });
  router.post('/account/api/revoke', async (req,res) => {
    const { clientId } = z.strictObject({ clientId:uuid }).parse(req.body), identity: AccountIdentity = res.locals.identity;
    // Deny tool access first. A provider failure must never restore local permissions.
    const revoked = await db.query('update client_grants set revoked_at=now() where owner_id=$1 and client_id=$2 returning client_id',[identity.userId,clientId]);
    if (!revoked.rows.length) { res.status(404).json({ error:'Connection not found.' }); return; }
    try { await provider.request(identity,`/user/oauth/grants?client_id=${encodeURIComponent(clientId)}`,'DELETE'); res.json({ revoked:true, providerRevoked:true }); }
    catch { res.json({ revoked:true, providerRevoked:false, message:'Travel access is revoked. Retry to finish revoking the sign-in grant.' }); }
  });
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(error instanceof z.ZodError ? 400 : 502).json({ error:error instanceof z.ZodError ? 'Invalid account request.' : 'Unable to complete authorization. Restart the connection or try again.' });
  });
  return router;
}
