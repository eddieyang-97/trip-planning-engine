import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configuration } from '../src/config.js';

const hosted = {
  APP_MODE: 'hosted', NODE_ENV: 'production', RENDER: 'true', PORT: '10000',
  RENDER_EXTERNAL_URL: 'https://travel-example.onrender.com',
  DATABASE_URL: 'postgresql://user:example@db.example/postgres',
  SUPABASE_AUTH_ISSUER: 'https://project.example/auth/v1', MCP_AUDIENCE: 'test-audience',
};
test('hosted config uses the assigned Render origin and never falls back to local storage', () => {
  assert.equal(configuration(hosted).origin, hosted.RENDER_EXTERNAL_URL);
  assert.equal(configuration(hosted).port, 10000);
  assert.equal(configuration(hosted).local, false);
  assert.equal(configuration({ ...hosted, PUBLIC_ORIGIN: 'https://custom.example' }).origin, 'https://custom.example');
  assert.equal(configuration({ ...hosted, MCP_AUDIENCE: undefined }).audience, `${hosted.RENDER_EXTERNAL_URL}/mcp`);
  assert.equal(configuration(hosted).audience, 'test-audience');
  for (const name of ['DATABASE_URL', 'SUPABASE_AUTH_ISSUER', 'RENDER_EXTERNAL_URL']) {
    assert.throws(() => configuration({ ...hosted, [name]: undefined }), new RegExp(`Missing ${name}`));
  }
});
test('deployment rejects local mode, invalid origins, ports and ambiguous migration flags', () => {
  assert.throws(() => configuration({ NODE_ENV: 'production' }), /hosted/);
  assert.throws(() => configuration({ RENDER: 'true' }), /hosted/);
  for (const origin of ['http://example.com', 'https://example.com/', 'https://example.com/path', 'https://user:pass@example.com', 'invalid']) {
    assert.throws(() => configuration({ ...hosted, PUBLIC_ORIGIN: origin }));
  }
  assert.throws(() => configuration({ ...hosted, PORT: '0' }), /PORT/);
  assert.throws(() => configuration({ ...hosted, MIGRATE_ON_START: 'yes' }), /MIGRATE_ON_START/);
  assert.equal(configuration({ ...hosted, MIGRATE_ON_START: 'true' }).migrateOnStart, true);
  assert.equal(configuration({}).origin, 'http://127.0.0.1:3000');
});

test('a separate database password is encoded once and never included in configuration errors', () => {
  const password = 'example:@/#?%40 + ü';
  const cfg = configuration({ ...hosted, DATABASE_URL: 'postgresql://user@db.example/postgres', DATABASE_PASSWORD: password });
  const parsed = new URL(cfg.databaseUrl!);
  assert.equal(decodeURIComponent(parsed.password), password);
  assert.equal(parsed.hostname, 'db.example');
  assert.equal(parsed.username, 'user');
  assert.equal(parsed.pathname, '/postgres');
  assert.throws(() => configuration({ ...hosted, DATABASE_URL: 'postgresql://user@db.example/postgres' }), /Set DATABASE_PASSWORD/);
  assert.throws(() => configuration({ ...hosted, DATABASE_URL: 'not-a-url-secret' }), { message: 'Invalid DATABASE_URL' });
});
