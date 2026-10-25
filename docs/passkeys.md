# Optional passkey pilot — issue #35

Production pilot status (25 October 2026). Optional passkey sign-in and account management are enabled on the existing Trip Planner web app for all confirmed users; there is no separate passkey cohort. New users still create accounts with email/password and confirm their email before enrolling. The app uses the existing Render service hostname as the RP ID; changing it later requires re-enrollment. Deployment/configuration evidence and user-reported live-account tests are recorded below; detailed security, second-account, browser fallback and OAuth token-lifecycle acceptance remain incomplete. Issue #35 stays open.

## Production configuration and deployment — 25 October 2026

After explicit user authorization, production passkey and password-change settings were applied to the single existing Supabase project and Render service. The accepted service hostname is the RP ID; changing the RP ID later invalidates existing passkeys, so users would need to enroll again.

**Configuration invariants:** The configured RP ID must match the effective HTTPS public-origin hostname exactly. The app allows the exact Render service hostname, not bare `onrender.com` (a public suffix), other sibling/parent domains, IP addresses, HTTP public origins or invalid DNS labels; `localhost` is reserved for isolated fixtures. The repository/Blueprint example remains default-off even though production is explicitly enabled. The app flag alone does not enable Supabase's provider feature; both must be configured. Never enroll on an unrelated preview host.

| Setting | Read-back value |
| --- | --- |
| Supabase Passkey authentication | Enabled |
| Relying Party Display Name | Trip Planner |
| Relying Party ID | `trip-planning-engine.onrender.com` |
| Relying Party Origins | `https://trip-planning-engine.onrender.com` |
| Secure password change | Enabled |
| Require current password when updating | Enabled |
| Email provider / signup / email confirmation | Enabled |
| Supabase Site URL / allowed callback | `https://trip-planning-engine.onrender.com` / `https://trip-planning-engine.onrender.com/account` |
| Render `PASSKEYS_ENABLED` | `true` |
| Render `PASSKEY_RP_ID` | `trip-planning-engine.onrender.com` |

Render deployment `dep-dbf1rr8m7kps73ffajg0` reached **Live** on commit `a56f26a1926853ac55907ba9c8fd622951ed5813`. The hosted `/health` returned `ok`; a fresh `/account/config` response returned `passkeys:true`. The public account page displayed **Continue with passkey** alongside email/password sign-in. No passwords, tokens or environment values were exposed in the read-back. The app feature is now visible to all confirmed users of this existing service.

Supabase currently documents passkeys as experimental. The deployed code pins `@supabase/supabase-js` 2.117.3 and uses the passkey sign-in, registration, list and delete APIs; feature detection requires a secure context and WebAuthn credential support but does not guarantee every device or credential manager. The server-side provider feature must remain enabled. No passkey ceremony, user account, trip access, email delivery or assistant authorization was exercised during configuration.

### Rollback

To hide/disable passkeys, set Render `PASSKEYS_ENABLED=false` and disable Supabase Passkey authentication separately. Disabling either layer does not delete or revoke existing provider credentials; retain the configured RP ID so those credentials can work again if the feature is re-enabled. If the password-recovery test fails under the enabled password policies, restore the affected password-change toggles to their prior values and keep the app/provider passkey gates disabled until recovery works. Do not delete credentials as rollback.

## Account, fallback and recovery

`Continue with passkey` uses the same persisted Supabase client, refresh behavior and `travel-account` storage as email/password sign-in. It does not create or merge an account, add permissions or alter MCP tokens. The backend still verifies signed direct-session JWTs and the current confirmed email user. Assistant grants, resource audience, read/write/search permissions and revocation stay separate.

Signed-in users can register, reload and remove passkeys under Your account. Registration/deletion recheck the current confirmed, non-anonymous identity. Removal requires confirmation reminding the user to retain password/email recovery, including when removing the last key. Successful writes are checked against a fresh key list; errors or lost acknowledgements require reloading before retrying. Names are rendered as plain text. Credential material is managed by Supabase and the authenticator; the app adds no credential tables or logging.

### Credential reauthentication — PR #37 review

Every ordinary password change and passkey registration/removal now requires a fresh `signInWithPassword` check using the current confirmed account's email. A restored or refreshed session, recent-looking JWT or earlier successful action does not satisfy that check. Password fields are cleared when the action begins and on account changes; the app does not persist or log their values. Ordinary password updates also send `current_password` so the provider can enforce that policy when configured.

Recovery remains usable without knowing the lost password: only the SDK's verified `PASSWORD_RECOVERY` event grants one password-update attempt in this page, expiring after five minutes. That approval is kept in memory, never restored from browser storage/JWT claims, and cleared on sign-out, ordinary sign-in or account changes. It cannot authorize passkey registration/removal. Reloading requires the current password or a new recovery link; a failed/uncertain update consumes the approval too.

**Production policy configuration read back, 25 October 2026:** Supabase shows **Secure password change on**, **Require current password when updating on**, email confirmation on, and Passkey authentication on. Supabase documents secure password change as requiring reauthentication when the current session is older than 24 hours. The app supplies `current_password` for ordinary password changes. The provider's current-password handling has a recovery-session exception; verify against the deployed provider version when changing the policy. The owner reported successfully testing email/password recovery on the live account on 25 October; an independently inspected hosted recovery/PKCE/password-update trace and separate fictional-account edge cases remain unverified.

The passkey guide requires a confirmed signed-in user for registration and an authenticated user for management; no provider-side fresh-auth control for passkey registration/removal was found. The app reauthenticates those actions in its UI, but that check is bypassable through direct Supabase calls using a stolen valid session token. This residual is accepted for the friends-only feature only with that limitation documented; no custom authentication proxy is introduced. The owner reported successful live-account recovery and passkey removal/re-enrollment; old-session password-change rejection, provider-side protection against direct management calls, multiple-device/browser behavior and independently reproducible end-to-end acceptance remain unverified.

- **Lost device/missing key:** use email/password. If the password is forgotten, enter the existing email and select Forgot password. Open the recovery email in the requesting browser, then set a new password under Password and recovery. The exact `/account` callback uses the existing PKCE session flow. Losing access to both credentials and the confirmed email requires a separately approved identity/recovery process; do not create a duplicate account to recover trips.
- **Unsupported browser:** password sign-in remains enabled. Existing keys can still be listed/removed from an authenticated session when creation is unavailable. Try a current browser/platform with WebAuthn support on the configured HTTPS origin.
- **Cancel/timeout/expired request:** restart explicitly or use password sign-in. No automatic ceremony replay. Network failures may have happened after a successful enrollment/removal; reload keys before retrying.
- **Changed domain:** continue with password/email recovery on the approved new origin, remove unusable keys and enroll again only after the RP/origin rollout is approved. Keep the old RP stable where possible; disabling the UI flag does not revoke existing Supabase credentials.
- **Unconfirmed account:** confirm the email first. Anonymous sessions and assistant OAuth tokens cannot manage this application's account settings.

## Local evidence, owner-reported acceptance and remaining checks

The new built-web Chromium regression uses an isolated PGlite database, a fake Supabase HTTP protocol service, signed fixture JWTs and a virtual discoverable WebAuthn authenticator. It exercises password sign-in, cancelled registration, list failure, registration, sign-out/passkey sign-in, same-account/trip read-back, refresh, consent redirect, read-only grant enforcement/revocation, deletion confirmation and read-back, recovery request/PKCE return/password update, cross-tab sign-out, another-account isolation, expired/missing credentials, disabled feature and unsupported-browser fallback. Browser requests are restricted to the fixture origin. The fake Auth service checks ceremony challenge/origin and credential identity but **does not implement Supabase's signature/attestation verification**. Fixture success is not production provider acceptance.

Focused unit/backend coverage checks flag/RP rejection, sanitized recoverable messages, direct passkey-session acceptance and existing session isolation, consent/reconnect/revocation. Existing backend tests retain the independent OAuth client, grant-version and read/write/search boundaries.

Automated fixtures cover credential guards, account boundaries, recovery and WebAuthn browser behavior, but a fake Supabase Auth service **does not verify production attestation/signature or provider-side recent-auth enforcement**. Detailed per-commit CI counts, review fixes and pre-activation decisions are in [PRs #37–#39](https://github.com/eddieyang-97/trip-planning-engine/pull/39) and [Issue #35](https://github.com/eddieyang-97/trip-planning-engine/issues/35).

**Owner-reported live-account checks — 25 October 2026:** The owner reports using passkeys on their hosted account, successfully removing a registered passkey and enrolling it again ([initial follow-up](https://github.com/eddieyang-97/trip-planning-engine/issues/35#issuecomment-6401010690)). The owner also confirms testing **passkey sign-in after re-enrollment, email/password recovery and connected-assistant OAuth continuity** ([subsequent follow-up](https://github.com/eddieyang-97/trip-planning-engine/issues/35#issuecomment-6401028336)). These are successful *user-reported* real-account operations, distinct from the earlier configuration read-back and isolated browser fixtures. The assistant did not handle credentials or independently perform/observe the authenticator ceremony, recover the account or inspect an OAuth token exchange. Do not infer specific PKCE, refresh, revocation or cross-account checks from basic OAuth continuity.

**Remaining acceptance:** A separate, authorized fictional account still needs new-user email signup and confirmation delivery, sign-in, enrollment/management and identity/trip read-back with a real provider and authenticator. Verify another account remains isolated, cancellation/unsupported-browser password fallback, enforcement of the current-password requirement for enrollment/removal and ordinary password updates, expired/used recovery rejection, and the provider's behavior on fresh-auth bypass attempts. Independently exercise OAuth/PKCE exchange, permissions, refresh, revocation and authorized web/MCP continuity where those are required acceptance gates; the owner's OAuth continuity report alone does not cover them. The app's fresh-password UI check is bypassable by direct provider requests with a stolen valid bearer token, and no provider-side recent-auth requirement for passkey management has been established; this remains an accepted pilot limitation, not a passed security test. User consent and device prompts are required; no password or one-time code should be shared in chat. Keep issue #35 open until its remaining acceptance scope is explicitly reviewed.

