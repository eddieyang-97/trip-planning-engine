import assert from 'node:assert/strict';
import {test} from 'node:test';
import {accountAuthError} from '../web/account-errors.js';

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
