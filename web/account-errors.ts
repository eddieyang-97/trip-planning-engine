/** Fixed messages only: never display provider text that may contain credentials or account details. */
export function accountAuthError(error: { code?: string; name?: string }, action: 'signup' | 'signin'): string {
  const messages: Record<string,string> = {
    email_address_not_authorized: 'The Supabase email sender only allows organization members. Use the email attached to your Supabase organization for this pilot, or configure a verified email sender.',
    over_email_send_rate_limit: 'The confirmation email limit has been reached. Wait before trying again; repeated clicks will not help.',
    over_request_rate_limit: 'Too many sign-in requests. Wait a few minutes before trying again.',
    email_address_invalid: 'This email address is not accepted. Use a real email address you can receive confirmation at.',
    weak_password: 'Choose a stronger password, then try again.',
    email_not_confirmed: 'Confirm your account using the email from Supabase, then return here to sign in.',
    invalid_credentials: 'Sign-in failed. Check your email and password.',
    signup_disabled: 'Account creation is disabled in the Supabase project.',
    email_provider_disabled: 'Email/password sign-in is disabled in the Supabase project.',
    captcha_failed: 'Account verification could not be completed. The sign-in setup needs review.',
    hook_timeout: 'The authentication token hook timed out. The server setup needs review.',
    hook_timeout_after_retry: 'The authentication token hook timed out. The server setup needs review.',
    unexpected_failure: 'Supabase could not complete the request. Check the authentication service and its logs.',
  };
  if (error.code && Object.hasOwn(messages,error.code)) return `${messages[error.code]} (${error.code})`;
  if (error.name==='AuthRetryableFetchError') return 'Unable to reach Supabase Auth. Check your connection and try again later.';
  return action==='signup'?'Unable to create the account. The authentication setup needs review.':'Sign-in failed. Check your email, password and email confirmation.';
}
