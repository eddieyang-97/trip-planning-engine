# Browser regressions and failure cases

## Run the isolated journeys

Requires Node.js 24. One-time setup after installing dependencies:

```sh
npm ci --include=dev
npx playwright install --only-shell chromium
```

Then run:

```sh
npm run test:e2e
```

This command rebuilds the frontend/backend and runs the Chromium suite in [tests/e2e](../tests/e2e). Coverage includes account/passkey/session flows, itinerary editing and read recovery, sharing/privacy/revocation, clipboard links and accommodation/dining MCP → web review. The default viewport is 390×844; tests switch to desktop sizes where needed. Test sources and CI, not a fixed count in this guide, define the current suite.

There is no separate server to start. Fixtures use isolated PGlite databases, application migrations, fictional identities/data and ephemeral loopback HTTP servers, then close their resources. Local itinerary fixtures inject random development identities; the account fixture runs the actual Supabase SDK against a fake HTTP Auth service with signed fixture JWTs and a virtual WebAuthn authenticator. No live Supabase account, production database, supplier adapter or metered search is used. Do not substitute real credentials/data or repoint fixtures at a hosted service.

The built Express/frontend routes still enforce their applicable origin, authorization, private projection, revision and idempotency checks. Browser requests are restricted to fixture origins. The injected/fake identity boundary is not a production authentication bypass; individual tests assert the persisted state and mutation counts relevant to their scenario.

The required GitHub Actions `test` job runs this command after build and backend/PostgreSQL tests on PRs and main pushes. [Workflow configuration](../.github/workflows/check.yml) bounds browser installation to three minutes and browser execution to four minutes within the ten-minute job. [Playwright configuration](../playwright.config.mjs) uses one worker, no retries, a 60-second per-test timeout and a three-minute suite budget. Failure-only traces/screenshots are retained for seven days; keep them fictional and sanitized.

## What the sharing journey proves

1. Organizer and named viewer open the built details view through real HTTP.
2. Organizer edits a booked item's title and practical notes. The first save reaches the real backend and commits; only its HTTP acknowledgement is deliberately dropped.
3. The form shows the failure. Retrying unchanged input sends the identical revision and idempotency key, succeeds and displays the saved edit. Direct database reads verify one item, one added event plus **one** edited event, revision **3**, owner authorship, before/after payloads, unchanged private booking note/status, and exactly **one** cached update mutation. The entire persisted edit snapshot (including timestamps) is unchanged by the retry.
4. Viewer Refresh gets revision 3 and displays the edited note and owner-reported booking status. Both the HTTP projection and DOM omit private booking evidence/history/research; edit/share controls are absent.
5. Organizer revokes the viewer through Share trip. The viewer's next Refresh returns 404/`FORBIDDEN_OR_NOT_FOUND` with `no-store`, clears the displayed plan and removes the trip from the sidebar.
6. Direct database reads verify both invitation and membership revoked, exactly one revoke mutation, and unchanged item/history/edit counts. No supplier run occurred.

## Lean failure-to-regression convention

For a significant observed failure, when a useful deterministic reproduction is practical, record these five fields beside the focused test or in the relevant Issue/PR. A small paragraph/table is sufficient; no incident framework or mandatory reproduction for every production error.

| Field | First example: lost itinerary-save acknowledgement |
| --- | --- |
| Observed symptom / evidence boundary | In the controlled browser reproduction, the backend commits but the browser receives a network error and leaves the edit form open. This models an interrupted save; it is **not evidence of a hosted duplicate-edit incident**. |
| Violated invariant to guard | An identical retry must not create another event/revision or lose private booking evidence. After revocation the next read must deny access and remove stale displayed content. |
| Sanitized fixture / trigger | Fictional trip, random test identities, private sentinel; route interception fetches the real first update response then aborts delivery. The second attempt goes through normally. |
| Expected result | Visible recovery on retry; viewer sees only the permitted updated fields; committed revocation denies the next Refresh and clears the view. |
| Mutation count / persisted evidence | One update cache row; added+edited history only; itinerary revision 3 before/after retry and revoke; one revoke cache row; invitation/member revoked; zero search runs. |

Keep raw private diagnostics, production identities, booking codes and tokens out of fixtures and public issue reports. Distinguish verified causes from hypotheses. Prefer the smallest boundary that recreates the failure; use isolated fake providers only when the failure actually needs one.

<a id="evidence-and-limits--22-october-2026"></a>

## Authentication coverage and evidence limits

[Passkey/account regressions](../tests/e2e/passkeys.spec.mjs) exercise the built browser, real Auth SDK, signed direct-session token validation, shared-account read-back, isolated identities, cross-tab clearing, email PKCE callbacks, password recovery and separate assistant-consent/grant controls. Focused [credential-guard tests](../tests/account-credentials.test.ts) check expiry, one-use approval and account boundaries. An existing-account email link must continue an itinerary return; passkey signup/management must remain on Account for the key action.

These fixtures validate application behavior with a fake provider. They do not verify production Supabase WebAuthn attestation/signatures, SMTP delivery, actual provider credential-change policy, real-device support or an external assistant's OAuth exchange/refresh/revocation. The default Chromium viewport is not Safari/iOS acceptance. Separate backend tests use disposable PostgreSQL for relevant transactions/permissions; the browser PGlite fixture is not a substitute for those checks. See [passkey security boundaries](passkeys.md) and [current delivery](implementation.md); exact test results and failed iterations belong in the relevant PR/CI.

## Accommodation cross-surface regression — 25 October 2026

The MCP-to-web journey uses its own isolated PGlite database, random local identity and read/write grant, loopback server and the official MCP SDK. It creates a fictional ten-adult trip and two sourced lodging configurations through actual MCP HTTP, shortlists with rationale, opens the stable trip/decision URL in the compiled web app, manually captures a third option, reviews a selection and explicitly saves one tentative stay. A fresh MCP read verifies identical source/evidence/selection/item IDs, rationale, status and the durable link. The same browser also creates a separate comparison and manual option without MCP data entry, then retrieves it through MCP.

Assertions require one item/event/link for the reviewed selection, zero booking records/search runs and no external browser requests or page errors. Mobile/desktop screenshots use fictional fixtures only and are ignored QA artifacts. The source test is [stay-comparison.spec.mjs](../tests/e2e/stay-comparison.spec.mjs); [accommodation guidance](accommodation-comparison.md) documents semantics and current limits. This verifies local transport/persistence/browser integration, not a normal hosted ChatGPT/Claude conversation or Supabase/OAuth acceptance.

## Dining cross-surface regression — 27 October 2026

The dining test uses a separate fictional ten-adult trip and official local MCP SDK client. Two saved restaurants have differing fee completeness and reported reservation-page versus homepage evidence. The built mobile web opens the absolute same-decision URL, adds a third manual option, requires acknowledgement of unknown tables before selecting and saves one tentative restaurant item. Fresh MCP reads verify exact evidence/rationale/link/status; repeated prices preserve the original selection. A separate web-only comparison/capture is retrieved through MCP. Database assertions require one item/event/link and zero bookings/searches; external browser requests and page errors are rejected. Mobile/desktop screenshots are fictional ignored QA artifacts. See [test source](../tests/e2e/dining-comparison.spec.mjs) and [acceptance boundaries](dining-comparison.md). This is not hosted Supabase/OAuth or normal assistant acceptance.
