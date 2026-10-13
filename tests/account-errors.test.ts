import assert from 'node:assert/strict';
import {test} from 'node:test';
import {accountAuthError,signupReceivedMessage} from '../web/account-errors.js';

test('account feedback distinguishes email restrictions, limits and confirmation without provider text',()=>{
  assert.match(accountAuthError({code:'email_address_not_authorized'},'signup'),/organization members/);
  assert.match(accountAuthError({code:'over_email_send_rate_limit'},'signup'),/repeated clicks will not help/);
  assert.match(accountAuthError({code:'email_not_confirmed'},'signin'),/Confirm your account/);
  assert.match(accountAuthError({name:'AuthRetryableFetchError'},'signup'),/Unable to reach/);
  for(const code of ['secret_token_value','constructor','__proto__']){
    const error={code,message:'password=private; bearer=secret'};
    const feedback=accountAuthError(error,'signup');
    assert.doesNotMatch(feedback,/password=|bearer=|secret_token_value|constructor|__proto__/);
  }
});

test('existing and unconfirmed accounts have a recovery action; neutral signup does not claim creation',()=>{
  for(const code of ['email_exists','user_already_exists'])assert.match(accountAuthError({code},'signup'),/Sign in.*Resend confirmation/);
  assert.match(accountAuthError({code:'email_not_confirmed'},'signin'),/Confirm your account/);
  assert.match(accountAuthError({code:'otp_expired'},'signin'),/request a new confirmation/);
  assert.match(accountAuthError({name:'AuthImplicitGrantRedirectError',status:500,details:{code:'otp_expired'}},'signin'),/request a new confirmation/);
  assert.match(signupReceivedMessage,/already registered.*Sign in/);
  assert.match(signupReceivedMessage,/does not confirm that a new account was created/);
});

test('expired sessions, broken confirmation flows, network and HTTP failures give safe next steps',()=>{
  for(const code of ['session_not_found','session_expired','refresh_token_not_found','refresh_token_already_used','bad_jwt'])assert.match(accountAuthError({code},'signin'),/Sign in again/);
  for(const code of ['flow_state_expired','flow_state_not_found','bad_code_verifier'])assert.match(accountAuthError({code},'signin'),/tab/);
  assert.match(accountAuthError({status:429},'resend'),/Wait/);
  assert.match(accountAuthError({status:503},'signin'),/unavailable/);
  assert.match(accountAuthError({name:'AuthRetryableFetchError',status:503},'signin'),/unavailable/);
  assert.match(accountAuthError({name:'AuthSessionMissingError'},'signin'),/Sign in again/);
  assert.match(accountAuthError({name:'AuthPKCECodeVerifierMissingError'},'signin'),/tab where you started/);
  assert.match(accountAuthError({name:'TimeoutError'},'signup'),/timed out/);
  assert.match(accountAuthError({code:'weak_password'},'signup'),/stronger password/);
  assert.match(accountAuthError({code:'validation_failed'},'signup'),/eight characters/);
});
