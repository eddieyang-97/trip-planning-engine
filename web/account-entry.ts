type EntryMode = 'signin' | 'signup' | 'email' | 'recovery' | 'resend';
type SignupMethod = 'password' | 'passkey';

/** Presentation only: auth requests and verified callback handling stay in account.ts. */
export function configureAccountEntry(passkeysEnabled: boolean, passkeysSupported: boolean) {
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  let mode: EntryMode = 'signin', method: SignupMethod = 'password';
  const actions = () => mode === 'signup' ? method === 'passkey' ? 'passkey-signup' : 'signup'
    : mode === 'email' ? 'email-login' : mode === 'recovery' ? 'reset-password' : mode === 'resend' ? 'resend' : 'password-login';

  function render() {
    const signup = mode === 'signup', password = mode === 'signin' || (signup && method === 'password');
    const titles = {signin: 'Welcome back', signup: 'Create your account', email: 'Sign in by email', recovery: 'Reset your password', resend: 'Confirm your email'};
    const descriptions = {signin: 'Sign in to your travel account.', signup: 'Choose how you’d like to sign in.', email: 'We’ll send a sign-in link to your confirmed email.', recovery: 'We’ll email you a password recovery link.', resend: 'Request a new confirmation email for your password account.'};
    el('entry-title').textContent = titles[mode];
    el('entry-description').textContent = descriptions[mode];
    for (const value of ['signin', 'signup']) el(`entry-${value}`).setAttribute('aria-pressed', String(signup === (value === 'signup')));
    el('signup-methods').hidden = !signup || !passkeysEnabled;
    el('signup-passkey-support').hidden = !signup || !passkeysEnabled || passkeysSupported;
    for (const value of ['password', 'passkey']) el(`method-${value}`).setAttribute('aria-pressed', String(method === value));
    el('entry-password').hidden = !password;
    el('password-label').textContent = signup ? 'New password' : 'Password';
    const field = el<HTMLInputElement>('password');
    field.autocomplete = signup ? 'new-password' : 'current-password';
    field.required = password;
    field.minLength = signup ? 8 : 1;
    el('recovery-mode').hidden = mode !== 'signin';
    el('signup-hint').hidden = !signup;
    el('signup-hint').textContent = method === 'passkey'
      ? 'Verify your email, then create a passkey with Face ID, Windows Hello or a security key. No password needed.'
      : 'Use at least eight characters. Confirm your email before signing in.';
    for (const id of ['password-login', 'signup', 'passkey-signup', 'email-login', 'reset-password', 'resend']) el(id).hidden = id !== actions();
    el('entry-alternatives').hidden = mode !== 'signin';
    el('passkey-signin').hidden = !passkeysEnabled;
    el('passkey-login-hint').hidden = passkeysSupported;
    if (passkeysSupported) el('passkey-login').removeAttribute('aria-describedby');
    else el('passkey-login').setAttribute('aria-describedby', 'passkey-login-hint');
    el('entry-help').hidden = signup;
    el('entry-back').hidden = mode === 'signin' || signup;
    el('signup-resend').hidden = true;
  }

  function change(next: EntryMode) {
    mode = next;
    el<HTMLInputElement>('password').value = '';
    el('status').textContent = '';
    el<HTMLDetailsElement>('entry-help').open = false;
    render();
  }
  el('entry-signin').onclick = () => change('signin');
  el('entry-signup').onclick = () => change('signup');
  el('email-mode').onclick = () => { change('email'); el('email').focus(); };
  el('recovery-mode').onclick = () => { change('recovery'); el('email').focus(); };
  el('resend-mode').onclick = () => { change('resend'); el('email').focus(); };
  el('signup-resend').onclick = () => { change('resend'); el('email').focus(); };
  el('entry-back').onclick = () => change('signin');
  for (const value of ['password', 'passkey'] as const) el(`method-${value}`).onclick = () => {
    method = value; el<HTMLInputElement>('password').value = ''; el('status').textContent = ''; render();
  };
  el<HTMLButtonElement>('method-passkey').disabled = !passkeysSupported;
  render();
  return {
    action: () => el<HTMLButtonElement>(actions()),
    confirmationRequested: () => { el('signup-resend').hidden = false; },
    reset: () => { method = 'password'; change('signin'); },
    showAccount(signedIn: boolean) {
      document.body.classList.toggle('signed-out', !signedIn);
      el('signin').hidden = signedIn;
      el(signedIn ? 'account-feedback' : 'signin-feedback').append(el('status'));
    },
  };
}
