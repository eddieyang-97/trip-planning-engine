/** Fixed messages only: never display provider text that may contain credentials or account details. */
export const signupReceivedMessage='Check your email, including spam, for confirmation. If this email is already registered, use Sign in. For a pending confirmation, choose Resend confirmation. For privacy, this response can also appear for an existing account; it does not confirm that a new account was created.';
export function accountAuthError(error: { code?: string; name?: string; status?: number; details?: {code?: string}|null }, action: 'signup' | 'signin' | 'resend'): string {
  const messages: Record<string,string> = {
    email_address_not_authorized: 'The Supabase email sender only allows organization members. Use the email attached to your Supabase organization for this pilot, or configure a verified email sender.',
    over_email_send_rate_limit: 'The confirmation email limit has been reached. Wait before trying again; repeated clicks will not help.',
    over_request_rate_limit: 'Too many sign-in requests. Wait a few minutes before trying again.',
    email_address_invalid: 'This email address is not accepted. Use a real email address you can receive confirmation at.',
    weak_password: 'Choose a stronger password, then try again.',
    email_not_confirmed: 'Confirm your account using the email from Supabase, then return here to sign in.',
    invalid_credentials: 'Sign-in failed. Check your email and password.',
    email_exists: 'This email is already registered. Use Sign in. If confirmation is pending, choose Resend confirmation.',
    user_already_exists: 'This account is already registered. Use Sign in. If confirmation is pending, choose Resend confirmation.',
    user_not_found: 'Sign-in could not be completed. Check your email and password, or create an account.',
    user_banned: 'This account is unavailable. Contact the travel app administrator.',
    user_sso_managed: 'This account uses an organization sign-in method. Contact the travel app administrator.',
    validation_failed: 'Check the email and password fields. For a new account, use a password of at least eight characters.',
    request_timeout: 'The sign-in request timed out. Try again later; avoid repeatedly creating accounts.',
    conflict: 'Another sign-in request is still processing. Wait a moment before trying again.',
    signup_disabled: 'Account creation is disabled in the Supabase project.',
    email_provider_disabled: 'Email/password sign-in is disabled in the Supabase project.',
    captcha_failed: 'Account verification could not be completed. The sign-in setup needs review.',
    hook_timeout: 'The authentication token hook timed out. The server setup needs review.',
    hook_timeout_after_retry: 'The authentication token hook timed out. The server setup needs review.',
    hook_payload_over_size_limit: 'The authentication token setup needs review. Contact the travel app administrator.',
    hook_payload_invalid_content_type: 'The authentication token setup needs review. Contact the travel app administrator.',
    provider_email_needs_verification: 'Verify your email before signing in. Check your inbox and spam folder.',
    session_not_found: 'Your session has ended. Sign in again.',
    session_expired: 'Your session has expired. Sign in again.',
    refresh_token_not_found: 'Your session has ended. Sign in again.',
    refresh_token_already_used: 'Your session is no longer valid. Sign in again.',
    bad_jwt: 'Your session could not be verified. Sign in again.',
    flow_state_expired: 'This confirmation link has expired. Request a new confirmation and open it in the tab where you started.',
    flow_state_not_found: 'This confirmation link cannot be completed in this tab. Return to the tab where you started, or request a new confirmation.',
    bad_code_verifier: 'Open the confirmation link in the same tab where you started, or request a new confirmation.',
    otp_expired: 'This confirmation link has expired or was already used. Try signing in, or request a new confirmation.',
    insufficient_aal: 'This account requires additional verification that the pilot does not yet support. Contact the travel app administrator.',
    unexpected_failure: 'Supabase could not complete the request. Check the authentication service and its logs.',
  };
  const code=error.code??error.details?.code;
  if (code && Object.hasOwn(messages,code)) return `${messages[code]} (${code})`;
  if(error.name==='AuthSessionMissingError'||error.name==='AuthInvalidJwtError')return 'Your session could not be verified. Sign in again.';
  if(error.name==='AuthPKCECodeVerifierMissingError'||error.name==='AuthPKCEGrantCodeExchangeError')return 'This confirmation link cannot be completed in this tab. Open it in the tab where you started, or request a new confirmation.';
  if(error.status===429)return 'Too many authentication requests. Wait before trying again.';
  if(error.status&&error.status>=500)return 'The authentication service is unavailable. Try again later.';
  if (error.name==='AuthRetryableFetchError'||error.name==='TypeError') return 'Unable to reach Supabase Auth. Check your connection and try again later.';
  if(error.name==='TimeoutError'||error.name==='AbortError')return 'The authentication request timed out. Try again later.';
  return action==='signup'?'Unable to create the account. The authentication setup needs review.':action==='resend'?'Unable to resend confirmation. Try again later.':'Sign-in failed. Check your email, password and email confirmation.';
}
