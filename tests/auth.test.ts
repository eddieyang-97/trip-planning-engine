import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { hostedAuthentication, localAuthentication } from '../src/auth.js';

test('hosted JWT checks signature, expiry, issuer, audience, user subject and OAuth client binding', async () => {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = await exportJWK(publicKey); jwk.kid = 'test';
  const issuer = 'https://auth.example/auth/v1', audience = 'https://travel.example/mcp', user = randomUUID();
  const verify = hostedAuthentication(issuer, audience, createLocalJWKSet({ keys: [jwk] }));
  const make = (claims: Record<string, unknown> = {}, key = privateKey) => new SignJWT({
    iss: issuer, aud: audience, sub: user, client_id: 'approved-client',
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60, ...claims,
  }).setProtectedHeader({ alg: 'ES256', kid: 'test' }).sign(key);
  assert.deepEqual(await verify(`Bearer ${await make()}`), { userId: user, clientId: 'approved-client' });
  for (const claims of [{ iss: 'https://wrong.example' }, { aud: 'another-api' }, { exp: 1 },
    { client_id: undefined }, { sub: 'not-a-uuid' }, { iat: Math.floor(Date.now() / 1000) + 120 }]) {
    await assert.rejects(verify(`Bearer ${await make(claims)}`));
  }
  const other = await generateKeyPair('ES256');
  await assert.rejects(verify(`Bearer ${await make({}, other.privateKey)}`));
  await assert.rejects(verify(undefined));
});

test('local authentication rejects absent and incorrect credentials', async () => {
  const verify = localAuthentication('a'.repeat(40));
  await assert.rejects(verify(undefined)); await assert.rejects(verify(`Bearer ${'b'.repeat(40)}`));
  await assert.rejects(verify('Basic x')); await assert.rejects(verify('Bearer short'));
  assert.throws(() => localAuthentication('short'));
});
