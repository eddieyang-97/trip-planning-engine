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

This command rebuilds the real frontend bundles and backend, then runs two Chromium journeys at a 390×844 viewport: sharing/retry/revocation and accommodation MCP → web review. There is no separate server to start. Each test owns a new in-memory PGlite database, runs all migrations, seeds fictional identities/trip/item/membership through Core, listens on an ephemeral loopback port, and closes the server/database and browser contexts in teardown. It neither reads `.env` nor uses `DATABASE_URL`, production accounts, Supabase, a worker or a provider adapter.

The sharing fixture imports `dist/src` and serves the actual `dist/web/itinerary.js`, HTML and CSS through the production Express routes. Two independent browser contexts use the existing **local development token** form. The injected Authenticate callback accepts only this test's random owner/viewer tokens; the real API origin, authorization, projection, revision and idempotency checks still run. MCP authentication is disabled in this fixture. No production authentication bypass, runtime environment flag or test endpoint is added.

All browser network requests outside the fixture origin are denied and fail the final assertion. Live search is disabled; no worker runs; the final database assertion requires zero search runs. Do not repoint this fixture at a hosted service or substitute real trip content/tokens.

## What the sharing journey proves

1. Organizer and named viewer open the built details view through real HTTP.
2. Organizer edits a booked item's title and practical notes. The first save reaches the real backend and commits; only its HTTP acknowledgement is deliberately dropped.
3. The form shows the failure. Retrying unchanged input sends the identical revision and idempotency key, succeeds and displays the saved edit. Direct database reads verify one item, one added event plus **one** edited event, revision **3**, owner authorship, before/after payloads, unchanged private booking note/status, and exactly **one** cached update mutation. The entire persisted edit snapshot (including timestamps) is unchanged by the retry.
4. Viewer Refresh gets revision 3 and displays the edited note and owner-reported booking status. Both the HTTP projection and DOM omit private booking evidence/history/research; edit/share controls are absent.
5. Organizer revokes the viewer through Share trip. The viewer's next Refresh returns 404/`FORBIDDEN_OR_NOT_FOUND` with `no-store`, clears the displayed plan and removes the trip from the sidebar.
6. Direct database reads verify both invitation and membership revoked, exactly one revoke mutation, and unchanged item/history/edit counts. No supplier run occurred.

The existing required GitHub Actions `test` job runs this same command after the backend/PostgreSQL suite, on PRs and main pushes. Browser installation and execution each have three-minute step bounds, within the existing ten-minute job bound; one worker, zero retries, a 60-second test timeout and two-minute suite bound keep failures visible. CI uses the Ubuntu runner’s installed runtime libraries and downloads only the pinned Chromium headless shell ([Playwright installation guidance](https://playwright.dev/docs/browsers)). Failure-only traces/screenshots are retained for seven days. They contain fictional fixture data and short-lived fixture tokens; never use real credentials in this harness or publish private hosted traces.

## Lean failure-to-regression convention

For a significant observed failure, when a useful deterministic reproduction is practical, record these five fields beside the focused test or in the relevant feature guide. A small paragraph/table is sufficient; no incident framework or mandatory reproduction for every production error.

| Field | First example: lost itinerary-save acknowledgement |
| --- | --- |
| Observed symptom / evidence boundary | In the controlled browser reproduction, the backend commits but the browser receives a network error and leaves the edit form open. This models an interrupted save; it is **not evidence of a hosted duplicate-edit incident**. |
| Violated invariant to guard | An identical retry must not create another event/revision or lose private booking evidence. After revocation the next read must deny access and remove stale displayed content. |
| Sanitized fixture / trigger | Fictional trip, random test identities, private sentinel; route interception fetches the real first update response then aborts delivery. The second attempt goes through normally. |
| Expected result | Visible recovery on retry; viewer sees only the permitted updated fields; committed revocation denies the next Refresh and clears the view. |
| Mutation count / persisted evidence | One update cache row; added+edited history only; itinerary revision 3 before/after retry and revoke; one revoke cache row; invitation/member revoked; zero search runs. |

Keep raw private diagnostics, production identities, booking codes and tokens out of fixtures and public issue reports. Distinguish verified causes from hypotheses. Prefer the smallest boundary that recreates the failure; use isolated fake providers only when the failure actually needs one.

## Evidence and limits — 22 October 2026

Local Windows Chromium: `npm run test:e2e` passed (one journey). Build passed as part of the command. Current-head CI evidence is recorded in [PR #26](https://github.com/eddieyang-97/trip-planning-engine/pull/26) and [issue #2](https://github.com/eddieyang-97/trip-planning-engine/issues/2), with the canonical summary in [delivery status](implementation.md). The initial CI attempt passed 173 backend tests with zero skips but timed out installing extra Ubuntu fonts before any browser test ran; the workflow now reuses the runner’s existing Chromium runtime libraries and installs only the browser. This setup correction does not remove or relax a test assertion.

This is one built-app integration test with PGlite and injected local identities. It does **not** prove Supabase email delivery, JWT verification or browser session persistence, hosted OAuth/MCP compatibility, real PostgreSQL pool races, editor onboarding, anonymous view-link behavior, provider identity/availability, Safari/iOS touch behavior or real-user acceptance. Existing focused backend/PostgreSQL tests and separately recorded hosted/device checks cover different boundaries. No hosted account, trip, permission, deployment or provider request is changed by this test.


## Accommodation cross-surface regression — 25 October 2026

The second test uses its own isolated PGlite database, random local identity and read/write grant, loopback server and the official MCP SDK. It creates a fictional ten-adult trip and two sourced lodging configurations through actual MCP HTTP, shortlists with rationale, opens the stable trip/decision URL in the compiled web app, manually captures a third option, reviews a selection and explicitly saves one tentative stay. A fresh MCP read verifies identical source/evidence/selection/item IDs, rationale, status and the durable link. The same browser also creates a separate comparison and manual option without MCP data entry, then retrieves it through MCP.

Assertions require one item/event/link for the reviewed selection, zero booking records/search runs and no external browser requests or page errors. Mobile/desktop screenshots use fictional fixtures only and are ignored QA artifacts. The source test is [stay-comparison.spec.mjs](../tests/e2e/stay-comparison.spec.mjs); [accommodation guidance](accommodation-comparison.md) documents semantics and current limits. This verifies local transport/persistence/browser integration, not a normal hosted ChatGPT/Claude conversation or Supabase/OAuth acceptance.

## Dining cross-surface regression — 27 October 2026

The dining test uses a separate fictional ten-adult trip and official local MCP SDK client. Two saved restaurants have differing fee completeness and reported reservation-page versus homepage evidence. The built mobile web opens the absolute same-decision URL, adds a third manual option, requires acknowledgement of unknown tables before selecting and saves one tentative restaurant item. Fresh MCP reads verify exact evidence/rationale/link/status; repeated prices preserve the original selection. A separate web-only comparison/capture is retrieved through MCP. Database assertions require one item/event/link and zero bookings/searches; external browser requests and page errors are rejected. Mobile/desktop screenshots are fictional ignored QA artifacts. See [test source](../tests/e2e/dining-comparison.spec.mjs) and [acceptance boundaries](dining-comparison.md). This is not hosted Supabase/OAuth or normal assistant acceptance.
