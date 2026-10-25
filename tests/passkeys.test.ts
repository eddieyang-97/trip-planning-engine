import assert from 'node:assert/strict';
import {test} from 'node:test';
import {configuration,passkeysEnabled} from '../src/config.js';
import {passkeyError} from '../web/account-passkeys.js';

test('passkeys default off and require explicit exact RP/origin opt-in',()=>{
  const env={PASSKEYS_ENABLED:'true',PASSKEY_RP_ID:'travel.example',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture'};
  assert.equal(passkeysEnabled('https://trip.onrender.com',{}),false);
  assert.equal(passkeysEnabled('https://travel.example',env),true);
  assert.equal(passkeysEnabled('http://localhost:1234',{...env,PASSKEY_RP_ID:'localhost'}),true);
  for(const changes of [{PASSKEYS_ENABLED:'yes'},{PASSKEY_RP_ID:undefined},{PASSKEY_RP_ID:'https://travel.example'},{PASSKEY_RP_ID:'example'},{SUPABASE_PUBLISHABLE_KEY:undefined}])
    assert.throws(()=>passkeysEnabled('https://travel.example',{...env,...changes}));
  assert.equal(passkeysEnabled('https://trip.onrender.com',{...env,PASSKEY_RP_ID:'trip.onrender.com'}),true);
  assert.throws(()=>passkeysEnabled('https://onrender.com',{...env,PASSKEY_RP_ID:'onrender.com'}));
  assert.throws(()=>passkeysEnabled('https://trip.onrender.com',{...env,PASSKEY_RP_ID:'other.onrender.com'}));
  assert.throws(()=>passkeysEnabled('https://trip.onrender.com',{...env,PASSKEY_RP_ID:'onrender.com'}));
  assert.throws(()=>passkeysEnabled('http://trip.onrender.com',{...env,PASSKEY_RP_ID:'trip.onrender.com'}));
  assert.throws(()=>passkeysEnabled('http://travel.example',env));
  assert.throws(()=>passkeysEnabled('ftp://localhost',{...env,PASSKEY_RP_ID:'localhost'}));
  assert.throws(()=>passkeysEnabled('http://127.0.0.1:1234',{...env,PASSKEY_RP_ID:'127.0.0.1'}));
  for(const host of ['127.0.0.1','[::1]','bad_host.example','-bad.example','bad-.example','bad..example','example.com.','*.onrender.com',`${'a'.repeat(64)}.example`])
    assert.throws(()=>passkeysEnabled(`https://${host}`,{...env,PASSKEY_RP_ID:host}));
});

test('hosted passkey RP follows PUBLIC_ORIGIN, independently of Render assigned URL',()=>{
  const env={APP_MODE:'hosted',PUBLIC_ORIGIN:'https://trip.onrender.com',RENDER_EXTERNAL_URL:'https://other.onrender.com',
    DATABASE_URL:'postgresql://fixture:fictional@db.example/postgres',SUPABASE_AUTH_ISSUER:'https://auth.example/auth/v1',
    SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',PASSKEYS_ENABLED:'true',PASSKEY_RP_ID:'trip.onrender.com'};
  assert.equal(configuration(env).passkeys,true);
  assert.throws(()=>configuration({...env,PASSKEY_RP_ID:'other.onrender.com'}));
  assert.equal(configuration({...env,PASSKEYS_ENABLED:undefined,PASSKEY_RP_ID:undefined}).passkeys,false);
});

test('passkey failures provide recovery guidance without reflecting provider diagnostics',()=>{
  for(const error of [{name:'NotAllowedError'},{cause:{name:'AbortError'}},{code:'ERROR_CEREMONY_ABORTED'}])assert.match(passkeyError(error),/cancelled or timed out/);
  assert.match(passkeyError({code:'email_not_confirmed'}),/Confirm your email/);
  for(const code of ['webauthn_challenge_expired','webauthn_challenge_not_found'])assert.match(passkeyError({code}),/expired/);
  assert.match(passkeyError({code:'webauthn_credential_not_found'}),/No matching passkey/);
  assert.match(passkeyError({code:'passkey_disabled'}),/unavailable/);
  assert.match(passkeyError({code:'webauthn_credential_exists'}),/already registered/);
  assert.match(passkeyError({code:'too_many_passkeys'}),/limit/);
  for(const error of [null,Error('private-token-diagnostic'),{code:'unknown',message:'private-token-diagnostic'}]){
    assert.doesNotMatch(passkeyError(error),/private-token-diagnostic/);assert.match(passkeyError(error),/Email and password/);
  }
});
