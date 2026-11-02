# Optional passkey pilot — issue #35

The hosted web app offers email/password registration or email verification followed by passkey enrollment without creating a password. Existing users can add passkeys to the same account. Sign-in methods share account IDs, trips and browser sessions; assistant OAuth grants remain separate. The friends-only pilot describes how the app is shared, not an invite-only signup restriction or a separate passkey cohort.

Deployment/public checks passed; the new password-free registration journey has not been independently exercised with a real inbox and device. See [current delivery](implementation.md#passkey-registration-delivery--2-november-2026) and [issue #35](https://github.com/eddieyang-97/trip-planning-engine/issues/35) for acceptance and the pending security-risk decision.

<a id="optional-registration-choice--source-follow-up-2-november-2026"></a>
<a id="optional-registration-choice--deployed-2-november-2026"></a>

## Registration and sign-in

| Action on `/account` | Behavior |
| --- | --- |
| **Create account** | Enter email and a new password, confirm the email, then sign in. |
| **Create account with passkey** | Enter email, open the newest verification link in the requesting browser, then explicitly choose **Register a passkey** under Passkeys (beta). No password is created. |
| **Continue with passkey** | Use a previously enrolled passkey; the authenticator resolves the account. This does not create an account. |
| **Email me a sign-in link** | Access an existing account without a password. It does not create a new account (`shouldCreateUser:false`) and remains available when passkeys are disabled or unsupported. |

Supabase requires a confirmed, signed-in, non-anonymous user before enrollment. The passkey signup path establishes that account through a supported email magic-link/PKCE exchange. An existing email resolves to the existing account; no app-managed account merge or credential database is introduced. Losing access to an account is not a reason to create a duplicate to recover its trips.

Ordinary sign-in with `returnTo=itinerary` returns to the itinerary. Passkey signup and explicit credential-management verification stay on Account for the requested passkey action; use **Open your itineraries** afterward. Assistant authorization context survives the email round trip, but consent remains a separate decision. Trip invitation tokens stay in the original invitation tab: return there if the email opens another tab, then review and accept the invitation. Email verification and passkey enrollment do not themselves create trip membership.

<a id="account-fallback-and-recovery"></a>

## Passkey management and recovery

Signed-in users can register, reload and remove passkeys under **Passkeys (beta)**. Removal requires confirmation, including for the last key. Registration/removal recheck the confirmed identity and verify the result against a fresh key list. After a lost acknowledgement, reload keys before retrying; the app does not automatically replay ceremonies. Credential material remains with Supabase and the authenticator, without application credential tables or raw credential logging.

| Situation | Recovery path |
| --- | --- |
| Lost device or missing key | Use **Email me a sign-in link**, or your password if you set one. The verified email-link return can authorize one replacement-key action; request fresh verification if that approval has expired or been consumed. |
| No password, or forgotten password | For account access, use an email sign-in link. To add/reset a password, choose **Forgot password**, open the recovery email in the requesting browser and set a new password under **Password and recovery**. |
| Unsupported WebAuthn/browser | Use email-link access or an existing password. Authenticated key listing/removal remains available even when creation is unsupported. |
| Canceled enrollment | The confirmed account remains accessible by email. A consumed email approval requires fresh verification before retrying. |
| Expired/used link, failed challenge or network error | Request a new link/challenge explicitly. Check the key list before replaying an uncertain registration/removal. |
| Changed hostname/RP ID | Old passkeys cannot sign in under the new RP ID. Retain email/password access and enroll new keys after a separately approved origin/configuration change. |
| Lost both device and email access | No self-service identity-recovery process is implemented; recovery would require a separately approved identity-verification process. |

<a id="credential-reauthentication--pr-37-review"></a>

## Fresh verification for credential changes

For each passkey registration/removal, supply the current password or choose **Verify by email for a passkey change**. A restored/refreshed session, recent-looking JWT or prior successful operation is not fresh proof.

Email requests save only intent (email, expected account ID, purpose and itinerary/consent context) in browser storage. Intent is consumed on callback, cleared on sign-out/account changes, and eligible for ten minutes. It never authorizes a write by itself. Only a successful SDK PKCE exchange for the matching confirmed account grants one passkey-management attempt within five minutes, held in memory. Reload, account change, sign-out, expiry or an attempted action invalidates/consumes that approval; cancellation can consume it before any credential is created. Password fields are cleared rather than persisted or logged.

Password updates require a fresh current-password check and send `current_password` to the provider. The separate SDK-verified `PASSWORD_RECOVERY` event permits one password-update attempt within five minutes without the old password. Recovery approval is memory-only and cannot authorize passkey registration/removal; email passkey approval cannot authorize password updates. Provider password-policy/recovery behavior must be verified when changing settings, especially when adding a first password to an account created without one.

### Security boundary and pending decision

Supabase's documented passkey-management APIs require a signed-in/current user but expose no documented per-operation fresh-auth enforcement equivalent to this UI guard. A stolen still-valid direct Supabase token may therefore bypass the app's fresh password/email verification and call credential-management APIs. **Secure password change** and **Require current password when updating** protect password changes, not passkey registration/removal. Provider resistance to direct-token management has not been demonstrated; do not present the UI check as an enforced provider policy or a blanket security certification.

Explicit owner acceptance of this residual for the optional pilot is **not recorded**. The accepted hostname/re-enrollment trade-off, PR merge, deployment and earlier owner-reported device successes do not imply that acceptance. Keep the decision and any proposed mitigation in [#35](https://github.com/eddieyang-97/trip-planning-engine/issues/35); production policy or architecture changes require separate approval.

<a id="production-configuration-and-deployment--25-october-2026"></a>

## Configuration and rollback

The pilot uses RP ID `trip-planning-engine.onrender.com` and origin `https://trip-planning-engine.onrender.com`. Re-enrolling pilot users if that hostname changes is an accepted trade-off; a custom domain is not required. The app requires an exact public-hostname match, HTTPS and valid DNS labels; it rejects bare `onrender.com`, sibling/parent domains and IP addresses. `localhost` is reserved for isolated fixtures. Do not enroll against unrelated preview hosts.

Both the app flag/RP settings (`PASSKEYS_ENABLED`, `PASSKEY_RP_ID`, effective public origin) and Supabase's server feature must be configured. Repository/Blueprint examples remain default-off despite the enabled hosted pilot. The operator settings last read back on 25 October had provider passkeys, email signup/confirmation, **Secure password change** and **Require current password when updating** enabled. Those observations are dated evidence, not a fresh dashboard audit. Email verification/recovery use configured Supabase SMTP and the exact `/account` callback; the implementation uses the default magic-link email template. No production template/policy change was part of PR #61.

Passkeys are experimental in the inspected provider documentation. Recheck the current [Supabase passkey guide](https://supabase.com/docs/guides/auth/passkeys), [password policies](https://supabase.com/docs/guides/auth/password-security), SDK version and RP/origin eligibility before an upgrade or configuration change. Device support requires a secure context and WebAuthn credential APIs; detection does not guarantee every authenticator works.

### Rollback

After operator authorization, `PASSKEYS_ENABLED=false` hides passkey signup/sign-in/management in this app. Disabling the provider feature is a separate Supabase change. Neither action deletes existing credentials; retain the RP ID so they remain usable if re-enabled. Existing-account email-link access and configured password recovery remain available independently of the passkey UI flag; password sign-in works for accounts that have a password.

Do not disable email confirmation or weaken password-change policies as a routine rollback. If recovery fails, investigate delivery/provider errors and obtain approval for a concrete configuration or forward fix. Preserve existing accounts and credentials; never delete keys to make rollback appear complete.

<a id="local-evidence-owner-reported-acceptance-and-remaining-checks"></a>

## Verification boundaries

Built-browser fixtures exercise registration choice, canceled enrollment/retry, same-account passkey sign-in, email access without duplicate signup, identity isolation, recovery, session changes, itinerary returns and separate assistant consent. They use the compiled app/SDK, isolated PGlite, signed fixture JWTs, a fake Supabase HTTP service and a virtual authenticator. They do **not** implement production Supabase attestation/signature verification, SMTP delivery or provider-side fresh-auth enforcement. See [browser testing](browser-testing.md) and [test source](../tests/e2e/passkeys.spec.mjs).

Public deployment checks prove the reported release, readiness and served controls, not authenticated user behavior. Earlier owner-reported passkey sign-in, removal/re-enrollment, password recovery and assistant continuity apply to the earlier account flow; they do not prove the new password-free signup, independent cross-account/device behavior or a complete OAuth PKCE/refresh/revocation lifecycle. [Delivery status](implementation.md) summarizes the current boundary; [#35](https://github.com/eddieyang-97/trip-planning-engine/issues/35) and [PR #61](https://github.com/eddieyang-97/trip-planning-engine/pull/61) retain dated findings, CI and rollout history.
