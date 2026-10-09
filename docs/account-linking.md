# Account linking pilot

The account page, consent API and token hook ship in one Render service. Supabase manages users, OAuth authorization codes, PKCE and refresh tokens. This milestone does not enable live flight search or bookings.

## Deployment and Supabase configuration

Deploy the repository with migration `002_account_linking.sql` and `SUPABASE_PUBLISHABLE_KEY`. The public key is intentionally exposed in `/account/config`; never substitute a secret or service-role key. The migration adds three private tables and a token-hook function, with no destructive changes to trip data. It does not enable the hook in Supabase.

After verifying the deployed account page, configure the dedicated Supabase project:

| Setting | Value |
| --- | --- |
| Authentication → URL Configuration → Site URL | `https://trip-planning-engine.onrender.com` |
| Allowed email-confirmation redirect | `https://trip-planning-engine.onrender.com/account` |
| OAuth Server | Enabled |
| OAuth authorization path | `/oauth/consent` |
| Auth Hooks → Custom Access Token | PostgreSQL function `public.travel_access_token_hook` |
| JWT signing | An active asymmetric ES256 or RS256 key; verify the public JWKS |
| Dynamic client registration | Enable only when connecting an MCP client that requires it; registration itself must not grant access |

These are project settings, not the user's account on the Supabase dashboard. Do not alter dashboard credentials, disable email confirmation, use wildcard redirect URLs, or weaken JWT audience checks. Existing signing-key migration, if required, needs a separate reviewed rollout.

The first user creates a travel account at `/account`, confirms the email, and signs in. The browser stores its direct Supabase session in tab-scoped session storage. Confirmation opened in a different tab may require returning to the original tab and signing in again. Supabase's default email service may limit recipients; inspect the project email configuration before inviting friends. Configure a verified sender separately if necessary.

The assistant connects to `https://trip-planning-engine.onrender.com/mcp`. Discover the authorization server through its protected-resource metadata. Do not claim support for a particular assistant until its real registration, PKCE, consent and refresh flow succeeds.

## Permissions and revocation

Account APIs accept a signed direct Supabase session with audience `authenticated`, a session ID, and no OAuth client ID. They check the current confirmed user with Supabase. Assistant tokens cannot manage grants. Mutations require the exact site Origin and an 8 KB JSON limit.

Consent is bound server-side to the authenticated user and verified authorization details. Requests expire after ten minutes and can be consumed once. Users approve read access to all their trips and may additionally approve writes. Search is unavailable in this pilot. Provider identity scopes are displayed separately from application permissions.

Only active application consent lets the token hook issue the `/mcp` resource audience and a grant-version UUID. MCP validates signature, issuer, audience, expiry, user and client, then rechecks current permissions and version on every tool call. Approval rotates the version; old access tokens remain invalid after reconnection. Refresh-token revocation also depends on Supabase: a failed upstream revocation is shown to the user with a retry action, while application access remains revoked locally.

Approval commits locally before returning the OAuth redirect. If the external approval succeeds but the transaction or redirect validation fails, application access remains denied; revoke the upstream grant and restart consent to recover. The two systems do not share a distributed transaction.

The hook is restricted to `supabase_auth_admin`; anonymous and authenticated database roles cannot execute it or access the consent tables. Runtime currently uses a privileged database connection, so server-side ownership checks are essential. A least-privilege runtime role and abuse throttling remain gates before wider access.

## Verification and remaining acceptance

Automated tests cover direct-session/assistant-token separation, cross-account denial, origin checks, immutable client binding, denial, expiration, replay, invalid redirects, upstream failure, read-only grants, revocation and reconnect version checks. Build and all 19 tests pass on 9 October 2026. These use signed test JWTs, an embedded PostgreSQL database and a mocked Supabase consent provider.

The implementation in commit `4fccad9` was pushed with PRD sync `cbae4a1` and deployed on 9 October. Hosted checks: `/health`, `/account`, `/assets/account.js` and `/account/config` returned 200; unauthenticated `/account/api/me` and `/mcp` returned 401. The account page rendered the sign-in form without browser console errors. Public Supabase JWKS advertises ES256. The available dashboard browser is signed out, so hook enablement and project URL settings have not been changed or verified. Browser screenshot capture was unavailable; visual verification was limited to the rendered page's accessibility state.

Still required against the hosted service:

1. Enable and verify the project settings above, then complete a real email sign-in.
2. Connect a real assistant using OAuth PKCE. Inspect claim names and resource audience without logging token values.
3. Create and retrieve the confirmed Flaine acceptance trip; reconnect a second assistant to the same travel account and retrieve it there.
4. Verify a second travel account cannot read the first account's trip. Revoke during a session, test refresh rejection, reconnect, and verify old access tokens remain rejected.
5. Test read-only consent with an attempted mutation. No booking or live-search claims are valid at this milestone.

Supabase references: [OAuth server setup](https://supabase.com/docs/guides/auth/oauth-server/getting-started), [MCP authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication), [token hooks](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook).
