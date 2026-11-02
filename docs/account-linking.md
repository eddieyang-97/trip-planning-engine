# Account linking pilot

Account and Itinerary share a persistent Supabase session. Users can register with email/password or verify email before enrolling a passkey without a password; existing-account email-link access supports lost-key recovery. See [account choices and credential safeguards](passkeys.md#registration-and-sign-in). Direct web sign-in never grants an assistant access by itself: assistant authorization, permissions and revocation use the separate OAuth boundary below.

This modular service serves Account, consent, token-hook integration, web and MCP. Supabase manages user identity, authorization codes, PKCE and refresh tokens. [Delivery status](implementation.md) records deployment/acceptance; [client evidence #21](https://github.com/eddieyang-97/trip-planning-engine/issues/21) distinguishes bounded ChatGPT/Claude reads from unverified refresh/revocation, writes/search and complete live-search journeys.

## Deployment and Supabase configuration

For a new installation, apply the current repository migrations and set `SUPABASE_PUBLISHABLE_KEY`; migration `002_account_linking.sql` introduces account linking. The public key is intentionally exposed in `/account/config`; never substitute a secret or service-role key. The migration adds private tables and the token-hook function, but enabling the hook is a separate Supabase configuration step. The existing service has this configuration enabled; [delivery status](implementation.md) and the linked Issues retain dated verification. See [current architecture](architecture.md) for the lasting integration contract.

The existing dedicated project uses the following settings. Verify them when setting up another environment; consult the linked evidence rather than treating this table as a fresh settings audit:

| Setting | Value |
| --- | --- |
| Authentication → URL Configuration → Site URL | `https://trip-planning-engine.onrender.com` |
| Allowed confirmation / magic-link / recovery callback | `https://trip-planning-engine.onrender.com/account` |
| OAuth Server | Enabled |
| OAuth authorization path | `/oauth/consent` |
| Auth Hooks → Custom Access Token | PostgreSQL function `public.travel_access_token_hook` |
| JWT signing | An active asymmetric ES256 or RS256 key; verify the public JWKS |
| Dynamic client registration | Enabled for the current assistant connections; registration itself does not grant application access |
| Custom SMTP | Enabled with Brevo; host `smtp-relay.brevo.com`, port 587, verified sender, sender name Travel Research |
| Email confirmation | Required; a confirmed, non-anonymous identity is required for protected account operations |

These are project settings, not the user's account on the Supabase dashboard. Do not alter dashboard credentials, disable email confirmation, use wildcard redirect URLs, or weaken JWT audience checks. Existing signing-key migration, if required, needs a separate reviewed rollout.

Create your own travel account at `/account`. Both registration choices require email verification; passkey signup then needs an explicit **Register a passkey** action. Open verification/recovery links in the browser that requested them so the SDK can use its stored PKCE verifier. Pending trip-invitation tokens remain tab-specific: return to the original invitation tab if email opens another tab, then review and accept the invitation. Passkey signup and credential-management verification stay on Account for the requested action; ordinary itinerary sign-in returns to the itinerary. See [registration and recovery](passkeys.md).

The assistant connects to `https://trip-planning-engine.onrender.com/mcp`. Discover the authorization server through its protected-resource metadata. Describe each assistant's observed support precisely: successful registration, PKCE, consent, tool discovery and read-only retrieval **do not** by themselves prove token refresh/revocation, mutation or live search for that client.

## Persistent browser session

Account and Itinerary use the same Supabase client configuration and `travel-account` local-storage key. Supabase retains the refreshable session; passwords are never persisted by the application. Valid sign-in survives navigation and closing/reopening app tabs. The provider still validates direct-session JWTs; MCP OAuth grants remain separate. Signing out uses Supabase's local scope, ending this browser's session without revoking unrelated assistant grants.

A one-time migration moves the previous tab session and pending PKCE verifiers into persistent storage. An existing persistent account wins. The migration marker remains after sign-out so an old tab cannot restore its stale session. Invitation/view-link credentials stay in tab storage. If browser storage is blocked, the app reports a recoverable error rather than silently promising persistence. Private browsing and clearing site data can end persistence.

Auth events and cross-tab storage changes synchronously clear private UI on sign-out/account changes, then reload outside Supabase's auth callback. Account generations reject responses started under a previous identity; rejected authentication also invalidates outstanding responses. Browser back/forward-cache restoration clears and rechecks private pages that may have missed broadcasts. Token refresh for the same identity does not reload the page. Anonymous shared views continue to work without a session. Two-account testing now requires separate browser profiles or private windows; ordinary tabs share the signed-in account.

“Your account” opens account settings. Ordinary sign-in/invitation return links continue into the itinerary; passkey signup and credential-management verification intentionally remain on Account for the explicit key action.

A real-account browser restart was owner-reported successful; fixture tests cover session persistence, stale response/account boundaries, cross-tab sign-out and refresh/revocation. Original CI/deployment evidence remains in the relevant Issues/PRs, not here.

## Account email delivery

The hosted Brevo SMTP email-confirmation flow was tested with a second account, including sign-in, viewer invitation and revocation. This is bounded pilot evidence, not a general deliverability guarantee; setup failures and repairs remain in the original Issues/PRs.

The account page calls Supabase Auth for password signup/resend, email magic-link signup/sign-in, and password recovery, using the exact `/account` callback. Supabase generates the appropriate message/link and submits it through Brevo SMTP. Use the provider's SMTP login and **SMTP key**, which is distinct from a Brevo API key. Keep both in Supabase's dashboard; no Brevo credential or new Render environment variable is required. See [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp) and [Brevo SMTP configuration](https://help.brevo.com/hc/en-us/articles/7924908994450-Send-transactional-emails-using-Brevo-SMTP).

Check the current Brevo allowance and Supabase Auth rate limits independently; historical dashboard quotas are not the project's effective sending rate. Neither quota nor saved SMTP settings prove inbox delivery. For failed delivery, inspect Supabase Auth errors and Brevo transactional logs, then check sender status and both services' limits. Use **Resend confirmation** for password signup. For email-link access/signup or recovery, request a new link with the corresponding action and use the newest email; requests remain rate-limited. Automatic email retries and application delivery tracking are not implemented.

Earlier second-account confirmation/sign-in evidence does not verify the new password-free magic-link registration flow, recovery on every device or inbox delivery for every recipient. See [current passkey acceptance](implementation.md#passkey-registration-delivery--2-november-2026). Trip invitations are application links shared manually, separate from Supabase Auth emails. Keep email confirmation enabled throughout.

## Permissions and revocation

Account APIs accept a signed direct Supabase session with audience `authenticated`, a session ID, and no OAuth client ID. They check the current confirmed user with Supabase. Assistant tokens cannot manage grants. Mutations require the exact site Origin and an 8 KB JSON limit.

Consent is bound server-side to the authenticated user and verified authorization details. Requests expire after ten minutes and can be consumed once. Users approve read access to **all current and future trips/research accessible to their account**, not a single test trip, and may additionally approve writes. When live search is enabled, a separate unchecked search option requires write access and describes **bounded generalized economy/GBP one-way and return discovery** (future dates, 1–6 origin airports, one destination, 1–9 adults, at most three provider requests/run, partial coverage and unverified party-price/baggage/bookability). Writes alone do not grant searches. Disabled deployments reject search consent before contacting Supabase. Existing grants are not expanded automatically; revoke the existing connection (including the Supabase grant) and reconnect to explicitly approve new permissions. Provider identity scopes are displayed separately from application permissions; the approved Claude account requested profile/email/phone and refresh access, distinct from application read/write/search grants.

Only active application consent lets the token hook issue the `/mcp` resource audience and a grant-version UUID. MCP validates signature, issuer, audience, expiry, user and client, then rechecks current permissions and version on every tool call. Approval rotates the version; old access tokens remain invalid after reconnection. Refresh-token revocation also depends on Supabase: a failed upstream revocation is shown to the user with a retry action, while application access remains revoked locally.

Approval commits locally before returning the OAuth redirect. If upstream approval succeeds but local commit or redirect validation fails, no new local grant is created; an existing connection can retain its prior grant after rollback. Revoke the upstream and local grant, then restart consent to recover. The systems do not share a distributed transaction; durable consent-attempt recovery remains work.

The hook is restricted to `supabase_auth_admin`; anonymous and authenticated database roles cannot execute it or access the consent tables. Runtime currently uses a privileged database connection, so server-side ownership checks are essential. A least-privilege runtime role and abuse throttling remain gates before wider access.

## Verification and remaining acceptance

Automated checks cover direct/assistant session separation, ownership, origins, bound consent, expiry/replay, redirects, read-only grants, revocation and reconnect versions. Bounded hosted evidence includes direct sign-in, public registration, S256 PKCE, verified MCP tokens and particular ChatGPT/Claude retrieval and flight workflows. Connected ChatGPT conditional selection/read-back, refreshed one-way criteria and a Claude read-only OAuth/retrieval journey have bounded evidence in [Issue #21](https://github.com/eddieyang-97/trip-planning-engine/issues/21) and related flight Issues. These do **not** establish universal client interoperability, refresh/revocation, write/search or a complete new-search journey. See [current delivery](implementation.md).

**Remaining hosted account/assistant acceptance** (not established by the completed Claude read-only test):

1. Verify a separate travel account cannot access another owner's private trip. Test live-session revocation, refresh rejection, reconnection and invalidation of old access tokens across relevant clients.
2. Verify that a hosted read-only connection is denied on an attempted mutation; the automated authorization tests are not equivalent to a real hosted denial probe.
3. Independently verify any intended Claude mutation/search or refresh/revocation behavior before advertising it. A complete single-conversation live new-search/poll/compare/shortlist/select/read-back workflow and live one-way supplier results remain unverified and require separately authorized scope/cost.

Project configuration, real direct sign-in, public client registration, S256 PKCE exchange, token validation, MCP access and the separately approved bounded live return search have succeeded. Client-specific guarantees remain limited to observed operations. Booking remains unavailable.

## Interactive hosted acceptance command

Run `npx tsx scripts/acceptance-hosted.ts --metadata-only` for authenticated tool discovery without reading trips. This mode rejects `--live`. The default without either flag also calls `list_trips`; `--live` is a separately authorized, metered historical Flaine acceptance, never a metadata or deployment smoke check. Every mode establishes a new OAuth/client grant and requires explicit account authorization. It uses the installed official MCP SDK for discovery, public registration and PKCE. Open the printed authorization URL in the same laptop's browser, sign into the travel account, and inspect the consent for **Travel hosted acceptance**. The exact loopback return URL is `http://127.0.0.1:8732/callback`; no client secret, password, access token, refresh token or PKCE verifier is saved to disk. The callback checks a random state, binds only to loopback, expires after ten minutes and redirects away from the authorization-code URL before inspection. Requests are restricted to the configured travel and Supabase origins.

The `--live` mode requires separate read/write/search consent and creates a named Flaine acceptance trip and decision. Fixed mutation keys make repeated runs return the same trip, decision and search instead of automatically spending again. It retries the identical search mutation once to verify idempotency, polls for up to four minutes, and checks persisted provider provenance and unknown price basis. It never selects candidates, sends passenger details or books. A polling timeout can leave an already-admitted run processing; inspect its printed run ID rather than issuing a new search. Revoke the test connection from the account page when finished. This verifies the official SDK flow, not ChatGPT/Claude-specific token refresh or revocation. ChatGPT and Claude have separate, bounded client-connection/read acceptance recorded above; do not infer broader client operations from this helper.

## Historical evidence

Original OAuth setup/repair, account feedback fixes, session rollout and ChatGPT retrieval acceptance are recorded in their GitHub Issues/PRs. This guide documents current configuration, session/grant rules, troubleshooting and remaining boundaries.
