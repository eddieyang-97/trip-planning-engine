import assert from 'node:assert/strict';
import {test} from 'node:test';
import {passkeysEnabled} from '../src/config.js';
import {passkeyError} from '../web/account-passkeys.js';

test('passkeys default off and require explicit stable RP/origin opt-in',()=>{
  const env={PASSKEYS_ENABLED:'true',PASSKEY_RP_ID:'travel.example',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture'};
  assert.equal(passkeysEnabled('https://trip.onrender.com',{}),false);
  assert.equal(passkeysEnabled('https://travel.example',env),true);
  assert.equal(passkeysEnabled('http://localhost:1234',{...env,PASSKEY_RP_ID:'localhost'}),true);
  for(const changes of [{PASSKEYS_ENABLED:'yes'},{PASSKEY_RP_ID:undefined},{PASSKEY_RP_ID:'https://travel.example'},{PASSKEY_RP_ID:'example'},{SUPABASE_PUBLISHABLE_KEY:undefined}])
    assert.throws(()=>passkeysEnabled('https://travel.example',{...env,...changes}));
  for(const host of ['onrender.com','trip.onrender.com'])assert.throws(()=>passkeysEnabled(`https://${host}`,{...env,PASSKEY_RP_ID:host}));
  assert.throws(()=>passkeysEnabled('http://travel.example',env));
  assert.throws(()=>passkeysEnabled('http://127.0.0.1:1234',{...env,PASSKEY_RP_ID:'127.0.0.1'}));
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
