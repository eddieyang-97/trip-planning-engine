import { timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { uuid, type Actor } from './domain.js';

export type Authenticate = (authorization: string | undefined) => Promise<Actor>;
export const localActor: Actor = { userId: '00000000-0000-4000-8000-000000000001', clientId: 'local-development' };
export function bearer(header?: string) {
  if (!header || !/^Bearer [^\s]+$/i.test(header)) throw new Error('Unauthorized');
  return header.slice(7);
}
export function localAuthentication(token: string): Authenticate {
  if (token.length < 32) throw new Error('LOCAL_TOKEN requires at least 32 characters');
  const expected = Buffer.from(token);
  return async header => {
    const actual = Buffer.from(bearer(header));
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Unauthorized');
    return localActor;
  };
}
export function hostedAuthentication(issuer: string, audience: string, keys?: JWTVerifyGetKey): Authenticate {
  const url = new URL(issuer);
  if (url.protocol !== 'https:' || url.search || url.hash || url.username || url.password) throw new Error('Invalid auth issuer');
  const jwks = keys ?? createRemoteJWKSet(new URL(`${issuer.replace(/\/$/, '')}/.well-known/jwks.json`));
  return async header => {
    const { payload } = await jwtVerify(bearer(header), jwks, {
      issuer, audience, algorithms: ['RS256', 'ES256'], requiredClaims: ['sub', 'exp', 'iat', 'client_id', 'travel_grant_version'],
    });
    const userId = uuid.parse(payload.sub);
    if (typeof payload.client_id !== 'string' || !payload.client_id || payload.client_id.length > 200) throw new Error('Unauthorized');
    if (typeof payload.iat !== 'number' || payload.iat > Math.floor(Date.now() / 1000) + 30) throw new Error('Unauthorized');
    return { userId, clientId: payload.client_id, grantVersion: uuid.parse(payload.travel_grant_version) };
  };
}
