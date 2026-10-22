# Account linking pilot

The account page, consent API and token hook ship in one Render service. Supabase manages users, OAuth authorization codes, PKCE and refresh tokens. The [bounded live flight pilot](hosted-live-search.md) completed its first real authenticated hosted search on 13 October 2026 through the official MCP SDK; generalized multi-airport return discovery and connected ChatGPT conditional selection/read-back followed. **Client update — 22 October 2026:** a refreshed ChatGPT connection persisted one-way criteria (`inbound:null`), authenticated server tool discovery passed, and an independently authorized Claude Free client completed OAuth, tool discovery and exactly two read-only fictional trip/decision retrievals. These checks do **not** verify live one-way fares, Claude writes/search, refresh/revocation, or a full single hosted new-search-to-selection workflow. See [client evidence](hosted-live-search.md#refreshed-chatgpt-one-way-criteria--22-october-2026) and [delivery status](implementation.md#current-state--22-october-2026). Booking is unavailable.

## Deployment and Supabase configuration

For a new installation, apply the current repository migrations and set `SUPABASE_PUBLISHABLE_KEY`; migration `002_account_linking.sql` introduces account linking. The public key is intentionally exposed in `/account/config`; never substitute a secret or service-role key. The migration adds private tables and the token-hook function, but enabling the hook is a separate Supabase configuration step. The existing service has this configuration enabled; dated verification is recorded below. See [current architecture](architecture.md) and [delivery status](implementation.md).

The existing dedicated project uses the following settings. Verify them when setting up another environment; historical setup and successful acceptance are recorded below:

| Setting | Value |
| --- | --- |
| Authentication → URL Configuration → Site URL | `https://trip-planning-engine.onrender.com` |
| Allowed email-confirmation redirect | `https://trip-planning-engine.onrender.com/account` |
| OAuth Server | Enabled |
| OAuth authorization path | `/oauth/consent` |
| Auth Hooks → Custom Access Token | PostgreSQL function `public.travel_access_token_hook` |
| JWT signing | An active asymmetric ES256 or RS256 key; verify the public JWKS |
| Dynamic client registration | Enabled for the current assistant connections; registration itself does not grant application access |
| Custom SMTP | Enabled with Brevo; host `smtp-relay.brevo.com`, port 587, verified sender, sender name Travel Research |
| Email confirmation | Required; second-account confirmation, sign-in and viewer acceptance passed on 14 October |

These are project settings, not the user's account on the Supabase dashboard. Do not alter dashboard credentials, disable email confirmation, use wildcard redirect URLs, or weaken JWT audience checks. Existing signing-key migration, if required, needs a separate reviewed rollout.

The first user creates a travel account at `/account`, confirms the email, and signs in. Since 16 October, Account and Itinerary share a refreshable Supabase session in persistent browser storage. Closing app tabs does not end valid sign-in; sign-out clears private views across tabs. Passwords are not persisted. Pending invitations remain tab-specific, so return to the invitation tab after confirmation. See [persistent browser session and acceptance](account-linking.md#persistent-browser-session--16-october-2026). The existing project uses Brevo custom SMTP as described below; a new environment needs its own sender configuration.

The assistant connects to `https://trip-planning-engine.onrender.com/mcp`. Discover the authorization server through its protected-resource metadata. Describe each assistant's observed support precisely: successful registration, PKCE, consent, tool discovery and read-only retrieval **do not** by themselves prove token refresh/revocation, mutation or live search for that client.

## Persistent browser session — 16 October 2026

Account and Itinerary use the same Supabase client configuration and `travel-account` local-storage key. Supabase retains the refreshable session; passwords are never persisted by the application. Valid sign-in survives navigation and closing/reopening app tabs. The provider still validates direct-session JWTs; MCP OAuth grants remain separate. Signing out uses Supabase's local scope, ending this browser's session without revoking unrelated assistant grants.

A one-time migration moves the previous tab session and pending PKCE verifiers into persistent storage. An existing persistent account wins. The migration marker remains after sign-out so an old tab cannot restore its stale session. Invitation/view-link credentials stay in tab storage. If browser storage is blocked, the app reports a recoverable error rather than silently promising persistence. Private browsing and clearing site data can end persistence.

Auth events and cross-tab storage changes synchronously clear private UI on sign-out/account changes, then reload outside Supabase's auth callback. Account generations reject responses started under a previous identity; rejected authentication also invalidates outstanding responses. Browser back/forward-cache restoration clears and rechecks private pages that may have missed broadcasts. Token refresh for the same identity does not reload the page. Anonymous shared views continue to work without a session. Two-account testing now requires separate browser profiles or private windows; ordinary tabs share the signed-in account.

“Your account” opens account settings; only sign-in/invitation return links automatically continue into the itinerary.

### Verification and limitations — 16 October

The original sign-in/map joint release also changed map presentation and verified pin saving; those feature semantics are now in [the itinerary map guide](itinerary-map.md#saved-pin-verification-and-presentation--16-october-2026). This subsection retains the original joint test and deployment evidence.

- Production build passes.
- Local suite: 105 tests, 102 passed, 3 external-PostgreSQL checks skipped. No paid provider calls.
- New checks cover one-time migration, PKCE migration, persistent account precedence, stale-tab non-resurrection, isolated stores, blocked storage, identity generations, SDK restoration, expired-JWT refresh, sign-out and revoked refresh sessions. Map tests cover mixed-category grouping and save/read-back mismatches; the official MCP integration covers pin write/read, omission preservation and explicit clearing.
- Fictional loopback browser acceptance: Account and Itinerary share sign-in; closing all app tabs and reopening retains it; sign-out removes the other tab's private title/cards; switching to a second fixture identity shows only its trip. Existing pins survive a browser save with verified read-back. Phone-size map legend, category pins and selection inspected.
- A full browser-process restart and real-account hosted sign-in remain joint acceptance checks. Local client recreation/tab closure is evidence of persistence, not a claim those manual checks were performed. Real trips were not changed for these tests.

### Joint persistent-session and map deployment — 16 October 2026

Code commit: `dd58879073c49c465b14b03e7baf2da002e8f292` (includes `d934eb0` and `a114dd3`). [CI run 38824100758](https://github.com/eddieyang-97/trip-planning-engine/actions/runs/38824100758), job `116727359907`: **105 passed, 0 failed, 0 skipped**, including PostgreSQL 17 checks. The final small correction uses Leaflet's popup-open event so keyboard Enter and pointer activation both highlight selection; keyboard activation passed in the fictional browser fixture.

Existing Free Render service deployment [`dep-db8m5im7bikc73fi10lg`](https://dashboard.render.com/web/srv-db3t3iub7d7c739hfad0/deploys/dep-db8m5im7bikc73fi10lg) reached **Live**, duration 43.9 seconds. `/health` returned `ok`; account and itinerary pages returned 200 with Trip Planner branding. Public `account.js`, `itinerary.js` and `itinerary-views.css` match the tested local build (SHA-256 after newline normalization). The hosted fictional demo displays category legend, mixed-category markers and phone layout; keyboard Enter also highlighted the marker, selected place card and selection status on the deployed service. Real-account hosted sign-in and a full browser-process restart remain joint acceptance checks above.

No migration, new service, paid plan or new access scope was required. The concurrent PRD/calendar drafts were preserved and excluded from this release.

### User-confirmed real-account browser restart — 16 October 2026

After the joint release, the user confirmed validating persistent sign-in after a full browser-process restart with a real hosted account. This closes the **user-acceptance check for that specific behavior** that was listed as pending in the original release evidence above. This confirmation is user-reported; no browser session, account credentials or independent reproduction was inspected in this documentation update. It does not prove every token-revocation, cross-browser or assistant OAuth scenario.

## Account email delivery

On 14 October 2026, Brevo onboarding, sender verification and Supabase custom SMTP configuration completed. Initial second-account sign-ups failed with SMTP `535 Authentication failed`. With explicit user approval, SMTP IP blocking was disabled because it had no authorized addresses; the user then saved a replacement SMTP key/login directly. At 01:38:10 London time the Auth log recorded a successful confirmation request, and Brevo reported one email sent and delivered. The user confirmed the email, signed in, and joined a fictional itinerary as a viewer. Owner revocation then removed its access on refresh. Email confirmation stayed enabled. See [the dated sharing evidence](itinerary-sharing.md#validation-and-launch-dependency).

The account page calls Supabase Auth for sign-up and resend confirmation, with the exact `/account` redirect. Supabase generates the message and confirmation link and submits it through Brevo SMTP. Use the provider's SMTP login and **SMTP key**, which is distinct from a Brevo API key. Keep both in Supabase's dashboard; no Brevo credential or new Render environment variable is required. See [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp) and [Brevo SMTP configuration](https://help.brevo.com/hc/en-us/articles/7924908994450-Send-transactional-emails-using-Brevo-SMTP).

The recorded Brevo dashboard allowance was 300 emails/day. Supabase Auth rate limits also apply independently; that allowance does not establish the project's effective sending rate. Neither quota nor saved SMTP settings prove inbox delivery. For failed delivery, inspect Supabase Auth errors and Brevo transactional logs, then check sender status and both services' limits. The account page supports resend confirmation; automatic retries and application email-delivery tracking are not implemented.

The hosted second-account email, confirmation, sign-in, invitation and revocation flow passed. This is one pilot delivery, not a deliverability guarantee for every recipient. If confirmation opens another tab, return to the original invitation tab so its pending token is retained. Trip invitations are application links shared manually; they are separate from Supabase Auth email invitations. Keep email confirmation enabled throughout.

## Permissions and revocation

Account APIs accept a signed direct Supabase session with audience `authenticated`, a session ID, and no OAuth client ID. They check the current confirmed user with Supabase. Assistant tokens cannot manage grants. Mutations require the exact site Origin and an 8 KB JSON limit.

Consent is bound server-side to the authenticated user and verified authorization details. Requests expire after ten minutes and can be consumed once. Users approve read access to **all current and future trips/research accessible to their account**, not a single test trip, and may additionally approve writes. When live search is enabled, a separate unchecked search option requires write access and describes **bounded generalized economy/GBP one-way and return discovery** (future dates, 1–6 origin airports, one destination, 1–9 adults, at most three provider requests/run, partial coverage and unverified party-price/baggage/bookability). Writes alone do not grant searches. Disabled deployments reject search consent before contacting Supabase. Existing grants are not expanded automatically; revoke the existing connection (including the Supabase grant) and reconnect to explicitly approve new permissions. Provider identity scopes are displayed separately from application permissions; the approved Claude account requested profile/email/phone and refresh access, distinct from application read/write/search grants.

Only active application consent lets the token hook issue the `/mcp` resource audience and a grant-version UUID. MCP validates signature, issuer, audience, expiry, user and client, then rechecks current permissions and version on every tool call. Approval rotates the version; old access tokens remain invalid after reconnection. Refresh-token revocation also depends on Supabase: a failed upstream revocation is shown to the user with a retry action, while application access remains revoked locally.

Approval commits locally before returning the OAuth redirect. If upstream approval succeeds but local commit or redirect validation fails, no new local grant is created; an existing connection can retain its prior grant after rollback. Revoke the upstream and local grant, then restart consent to recover. The systems do not share a distributed transaction; durable consent-attempt recovery remains work.

The hook is restricted to `supabase_auth_admin`; anonymous and authenticated database roles cannot execute it or access the consent tables. Runtime currently uses a privileged database connection, so server-side ownership checks are essential. A least-privilege runtime role and abuse throttling remain gates before wider access.

## Verification and remaining acceptance

Automated checks cover direct/assistant session separation, ownership, origins, bound consent, expiry/replay, redirects, read-only grants, revocation and reconnect versions. Recorded real hosted proof includes direct sign-in, public registration, S256 PKCE, verified MCP tokens, bounded return flight searches, ChatGPT retrieval and conditional test selection/read-back. **On 22 October 2026**, a refreshed ChatGPT connection persisted fictional one-way criteria; separate authenticated server metadata inspection verified 31 tool definitions; and a Claude Free client independently completed consent/OAuth and retrieved exactly one fictional trip and its decision using **read-only** access. The Claude connection did **not** retrieve the historical Flaine trip. See [the dated client test](hosted-live-search.md#refreshed-chatgpt-one-way-criteria--22-october-2026), [Issue #21](https://github.com/eddieyang-97/trip-planning-engine/issues/21) and the [canonical delivery status](implementation.md).

**Remaining hosted account/assistant acceptance** (not established by the completed Claude read-only test):

1. Verify a separate travel account cannot access another owner's private trip. Test live-session revocation, refresh rejection, reconnection and invalidation of old access tokens across relevant clients.
2. Verify that a hosted read-only connection is denied on an attempted mutation; the automated authorization tests are not equivalent to a real hosted denial probe.
3. Independently verify any intended Claude mutation/search or refresh/revocation behavior before advertising it. A complete single-conversation live new-search/poll/compare/shortlist/select/read-back workflow and live one-way supplier results remain unverified and require separately authorized scope/cost.

Project configuration, real direct sign-in, public client registration, S256 PKCE exchange, token validation, MCP access and the separately approved bounded live return search have succeeded. Client-specific guarantees remain limited to observed operations. Booking remains unavailable.

## Historical setup and deployment — 9–12 October 2026

The pending statements and test counts in this section apply to those dated setup checks. They are superseded by the successful 13 October evidence below.

Automated tests cover direct-session/assistant-token separation, cross-account denial, origin checks, immutable client binding, denial, expiration, replay, invalid redirects, upstream failure, read-only grants, revocation and reconnect version checks. Build and all 19 tests pass on 9 October 2026. These use signed test JWTs, an embedded PostgreSQL database and a mocked Supabase consent provider.

The implementation in commit `4fccad9` was pushed with PRD sync `cbae4a1` and deployed on 9 October. Hosted checks: `/health`, `/account`, `/assets/account.js` and `/account/config` returned 200; unauthenticated `/account/api/me` and `/mcp` returned 401. The account page rendered the sign-in form without browser console errors. Public Supabase JWKS advertises ES256. The available dashboard browser is signed out, so hook enablement and project URL settings have not been changed or verified. Browser screenshot capture was unavailable; visual verification was limited to the rendered page's accessibility state.

On 12 October dashboard inspection confirmed OAuth Server and Dynamic OAuth Apps were already enabled, with authorization path `/oauth/consent`. The Site URL was still `http://localhost:3000`, the redirect allowlist was empty, and no auth hooks were configured. The hosted Site URL and `public.travel_access_token_hook` are being prepared for review; this inspection does not establish successful sign-in or assistant connection.

Later on 12 October, after explicit user approval, the Site URL was saved as `https://trip-planning-engine.onrender.com`, the exact `/account` confirmation redirect was added, and the Postgres `public.travel_access_token_hook` was enabled. Dashboard verification showed the hook enabled and the saved URL values. OAuth Server and Dynamic OAuth Apps settings were retained. Public Auth settings confirm signup is enabled and email confirmation is required.

The search-consent fix (`bcb80b7`) passed all 64 CI tests and deployed successfully. A user signup attempt failed with the old generic message; its cause is not yet established. The feedback fix (`227f070`) passed all 65 tests, none skipped, and [deployed successfully](https://dashboard.render.com/web/srv-db3t3iub7d7c739hfad0/deploys/dep-db6jj57f3r2c73cjtn3g). Known Supabase error codes now produce fixed, actionable messages without displaying raw provider text or credentials. At the time of that deployment, real signup and authenticated search were still pending; the successful 13 October flow is recorded below.

## Interactive hosted acceptance command

Run `npx tsx scripts/acceptance-hosted.ts --metadata-only` for authenticated tool discovery without reading trips. This mode rejects `--live`. The default without either flag also calls `list_trips`; `--live` is a separately authorized, metered historical Flaine acceptance, never a metadata or deployment smoke check. Every mode establishes a new OAuth/client grant and requires explicit account authorization. It uses the installed official MCP SDK for discovery, public registration and PKCE. Open the printed authorization URL in the same laptop's browser, sign into the travel account, and inspect the consent for **Travel hosted acceptance**. The exact loopback return URL is `http://127.0.0.1:8732/callback`; no client secret, password, access token, refresh token or PKCE verifier is saved to disk. The callback checks a random state, binds only to loopback, expires after ten minutes and redirects away from the authorization-code URL before inspection. Requests are restricted to the configured travel and Supabase origins.

The `--live` mode requires separate read/write/search consent and creates a named Flaine acceptance trip and decision. Fixed mutation keys make repeated runs return the same trip, decision and search instead of automatically spending again. It retries the identical search mutation once to verify idempotency, polls for up to four minutes, and checks persisted provider provenance and unknown price basis. It never selects candidates, sends passenger details or books. A polling timeout can leave an already-admitted run processing; inspect its printed run ID rather than issuing a new search. Revoke the test connection from the account page when finished. This verifies the official SDK flow, not ChatGPT/Claude-specific token refresh or revocation. ChatGPT and Claude have separate, bounded client-connection/read acceptance recorded above; do not infer broader client operations from this helper.

The first interactive run successfully discovered the hosted resource/authorization server, registered a public client and prepared an S256 challenge. It reached the hosted consent sign-in page with an `authorization_id`. User consent, token exchange and supplier requests had not completed at the time of this note.

## Account feedback follow-up — 13 October 2026

The account form now handles reported existing accounts, neutral signup responses, invalid fields/passwords, unconfirmed email, email delivery restrictions, throttling, expired sessions/confirmation links, PKCE verifier errors, and network/service failures. Supabase may obfuscate an existing-account signup response; the app explains that a neutral response does not establish creation of a new account. It does not query private user records to defeat that behavior. A separate Resend confirmation button needs only the email field, returns neutral delivery guidance, and shows rate-limit failures. Authentication requests have a 20-second timeout, simultaneous form submissions are disabled, and passwords are cleared after completed attempts. A server-rejected browser session leaves the sign-in form available.

Build and six targeted tests pass. [CI run 38462240434](https://github.com/eddieyang-97/trip-planning-engine/actions/runs/38462240434) for implementation `4ff852239c87742dae5b5bf5696437622e3fbd3e` passed all 67 tests, none skipped, including both pooled PostgreSQL checks. Chrome checks against an isolated loopback service with simulated responses verified explicit existing-account guidance, neutral signup guidance, unconfirmed-email feedback, resend throttling, expired confirmation links, and recovery from an invalid session. No real account, email or provider search was created by these UI checks. The initial interactive attempt was interrupted before sign-in; a fresh authorization later completed the hosted flow as recorded below.

The same implementation [deployed successfully on 13 October](https://dashboard.render.com/web/srv-db3t3iub7d7c739hfad0/deploys/dep-db796idg1s2s739k01p0), taking 40.2 seconds and reporting Live at 21:24 UK time. The service remains Free; startup reports hosted mode with the live pilot enabled. Post-deployment checks returned 200 for `/health` and `/account/config`, both with `liveSearch: true`, and 401 for unauthenticated `/account/api/me` and `/mcp`; the MCP authentication challenge remained present. The live account page includes Resend confirmation. These checks do not establish successful real signup, OAuth token exchange or hosted flight acceptance.

Later on 13 October a real user completed direct sign-in. A fresh official-SDK OAuth request reached the verified consent screen for **Travel hosted acceptance**, showing the registered public client, exact loopback return URL, `openid` scope and separate read/write/search application permissions. The user approved that exact connection. The S256 PKCE exchange succeeded; token verification confirmed the configured issuer, exact `/mcp` audience, registered client ID and grant version without printing token values. MCP connected and listed 23 tools.

The acceptance created a named Flaine trip and decision, admitted one live run, and repeated the identical mutation to confirm it returned the same run. Persisted status became `complete`, with three successful attempts (outbound, return, seller options) and ten observations. Every observation passed the `provider_reported`, unknown price-basis and `exactPartyQuoted: false` assertions. See the [hosted acceptance record](hosted-live-search.md#real-hosted-acceptance--13-october-2026). The SDK's optional streaming request returned 405 without preventing connection or tool execution. Chrome blocked the final loopback `/done` display, but the callback, token exchange and full acceptance process had already succeeded with exit code 0; no browser security warning was bypassed.

The test client retains its approved read/write/search connection until revoked. In-memory tokens were cleared and the loopback listener closed when the helper exited. No booking, selection or passenger submission was made. This establishes official-SDK hosted acceptance, not verified fares.

## ChatGPT saved-research retrieval — 13 October 2026

After the user connected the custom MCP server, direct browser inspection of the account page showed a **ChatGPT** connection with read/write/search grants. This Codex chat did not have that plugin's tools exposed, so retrieval was tested in ChatGPT itself. The user supplied its resulting response: it opened the same named Flaine acceptance trip, reported the observations saved at 21:28 London time, and listed ten sellers for U2 8487 outbound and U2 8156 return. It explicitly stated that no new search was run and preserved the unknown price basis, exact-party quote, snowboard, transfer and airport-coverage caveats. It reported no selected/booked flight and an empty manual itinerary.

The **Trip Planning** tools then became available in this Codex chat. Read-only `get_trip`, `get_search_run`, `get_itinerary` and `get_decision` calls succeeded directly through the connected plugin. They confirmed the same owner/trip, immutable criteria version 1, decision revision 2, ten seller observations with prices matching the supplied response, no selections/bookings and an empty itinerary at revision 1. The recent-run list contained only the original completed run; its ledger retained exactly three successful attempts. No search or mutation tool was called during this check.

This establishes initial ChatGPT linking, reported ChatGPT retrieval and independently verified connected-tool retrieval. It does not establish ChatGPT write/search behavior, token refresh, revocation, second-account isolation, Claude compatibility or a bookable quote. Recorded seller prices are research evidence with unknown party basis and must not be ranked as verified trip totals.

Supabase references: [OAuth server setup](https://supabase.com/docs/guides/auth/oauth-server/getting-started), [MCP authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication), [token hooks](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook).
