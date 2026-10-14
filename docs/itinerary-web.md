# Itinerary web app — organizer slice

Updated 13 October 2026. The same Node service serves `/itinerary`; no additional host, framework or backend service is required. Manual organization and saved-research review are deployed, with real-account research viewing and connected reads verified. Real hosted manual writes, collaboration acceptance and automatic research reconciliation remain incomplete. See [current architecture](architecture.md) and [delivery status](implementation.md).

## What works

- Trip picker and creation, day-by-day display, date navigation and an unscheduled section. All six item types are supported: flight, accommodation, transfer, activity, restaurant and note.
- Add/edit/remove items and move them within a date group. Manual ordering controls presentation; the app does not reorder a plan behind the user's back based on times.
- Optional local dates/times, IANA zones, locations, safe HTTPS links, practical notes and open questions. Unknown values stay empty. An end date is shown on its starting item; overnight stays are not automatically duplicated on each day.
- Tentative versus user-reported booked status. The booked state requires an explicit booking note. No supplier reservation, cancellation or payment is performed.
- Persistent history with before/after values, actor, timestamp and revision. Removing an item hides it from the current plan while retaining the record and history. Latest 50 events are returned; the full history remains in the database.
- One authoritative trip state for web and MCP. Five tools expose the same implementation: `get_itinerary`, `add_itinerary_item`, `update_itinerary_item`, `remove_itinerary_item`, `move_itinerary_item`.

## Preview and sign-in

```sh
npm run build
npm run dev
```

Open `http://127.0.0.1:3000/itinerary?demo=1` for the deliberately labelled Flaine example. It contains no confirmed bookings, invented fares or invented flight times. Four adults and the Geneva gateway are labelled or noted assumptions. Demo changes live only in page memory and reset on reload; no private trip is loaded or written. This is an interactive design preview, not the user's saved itinerary.

The actual `/itinerary` view uses the existing travel-account session and directs signed-out hosted users to `/account`. The account page links back to itineraries. Sign in and follow that link in the same tab because the existing session uses tab-scoped session storage. No MCP client or provider API key is needed to use the hosted web app. Real account sign-in passed on 13 October; the Supabase dashboard account is separate.

Local development accepts the existing local bearer token through a password field. That token is held only in memory, not embedded in the page or written to browser storage. It remains a developer option; friends use hosted sign-in. In this work session the review server uses port 3084 and the isolated `.data/itinerary-preview` database.

## Persistence and authorization

Migration `004_itinerary.sql` adds the trip itinerary revision, `itinerary_items` and `itinerary_events`. It does not change existing research selections or bookings. New tables use RLS with direct public/anon/authenticated data access revoked. The server still requires explicit ownership checks because its database connection can bypass RLS.

The browser sends direct-session bearer tokens to `/itinerary-api/:operation`. Hosted authentication reuses `supabaseAccounts`: verify the token and confirmed live user, and reject assistant OAuth tokens. POST requests require the same Origin. A server-only, allowlisted `Core.callFromWeb` accepts the authenticated user ID; client-supplied owner fields are rejected by strict schemas. It does not create or expand assistant grants. MCP calls continue to check their grant and version on every operation.

Web and MCP writes share idempotency records, trip ownership checks and transaction logic. A trip-row lock plus `expectedRevision` prevents concurrent writes silently replacing one another. Every successful edit increments the trip itinerary revision. The UI keeps an idempotency key for an identical failed submission; users should inspect uncertain outcomes before changing the draft or reopening an editor. On a revision conflict it asks for a reload instead of automatically applying stale content.

The first slice limits each trip to 500 item records including removed items. The display includes the first 60 dates plus every date containing an item, with a notice for longer trips. These are explicit pilot bounds. Content is rendered with text nodes rather than user-supplied HTML, links open with `noopener noreferrer`, and the page has a restrictive CSP and no external analytics, fonts or media dependencies.

## Original manual-slice validation — 11 October 2026

At this slice's validation, the TypeScript build and all 46 tests passed. Tests covered schemas, ownership, assistant revocation, direct-session route protection, same-origin checks, cross-trip IDs, idempotent retries, conflicts, reordering, removal history, migrations and actual MCP tool calls. Browser checks verified demo add/edit flows, a required booking note and resulting status, and no horizontal page/editor overflow at 390px. Console checks reported no errors; screenshot capture was unavailable then. Later visual capture and release evidence are recorded below; a physical-phone trial remains outstanding.

The original slice required a joint asset/migration release plus real sign-in, two-account isolation and a web-to-MCP edit round trip. Deployment and sign-in subsequently succeeded; real manual writes, hosted two-account isolation and the edit round trip remain open. See the 13 October hosted verification below.

## Saved research display — 13 October 2026

`get_itinerary` now adds a typed, owner-scoped research projection within the same repeatable-read transaction as the manual plan. It shows up to five decisions by title, twenty newest candidate/seller/fare observations per decision and twenty pinned selection/booking records. Older selected/booked evidence remains visible within those limits even when a newer fare observation exists. Limit notices are explicit. Provider request tokens, OAuth grants and attempt ledgers are excluded from this presentation payload. No migration or expanded web-operation allowlist is needed.

The page shows the saved flight pair, airport-local dates/times and zones, observation dates, provenance, incomplete coverage, source links and recorded seller amounts. Unknown party basis stays unknown; prices are not presented as comparable verified trip totals. Current selection and booking reports appear separately from the manual plan. Rejected and synthetic research cannot be copied through the review buttons. The unresolved-questions panel includes research assumptions and missing price/equipment/airport coverage.

Review outbound/return opens the existing item editor with a tentative draft. Nothing is persisted until the user saves. Copying never selects a candidate or makes a booking; no price is guessed or carried into the manual item. A matching existing flight (route/location, dates and local times) opens for editing rather than adding another copy. This is a manual snapshot with a source link and research note, not a durable observation-ID link or automatic update mechanism. Changed research must be reconciled by the organizer. The research section starts open on an empty itinerary and collapsed once plan items exist, keeping the day-by-day view prominent.

The UI now shows initial/loading feedback and bounded request timeouts. An unavailable trip URL falls back to an available owner trip with an explanatory message. A failed reload retains the previous plan and reports the failure; the editor stays open if a mutation or its subsequent reload fails.

Validation before deployment: build passed; the local regression suite passed 67 tests with the two external PostgreSQL checks skipped (69 total). New tests cover private read projection, bounded observations, retained older selection/booking evidence, no read-side mutation/search, airport-local overnight dates, tentative-only drafts and safe research links. An isolated loopback preview used copied Flaine evidence with live search disabled. Chrome verified unknown-basis seller labels, flight review, tentative save into the correct day, existing-item detection, and stale-trip-link recovery. At a 390px viewport, the page and editor fit without horizontal page overflow. Preview edits did not change the hosted trip. CI and hosted deployment verification are tracked below when complete.

Next acceptance increments: finish organizer validation, direct web flight controls and durable research links/reconciliation. [View-only invitations and membership](itinerary-sharing.md) deployed on 14 October; live friend onboarding acceptance remains pending. Comments/proposals and organizer approval follow. History pagination/restoration remains further work. Public anonymous sharing is not enabled.

## Hosted verification — 13 October 2026

Implementation `70b884a54f7584b6d80919a601b35b2f72e30750` passed [CI run 38466213421](https://github.com/eddieyang-97/trip-planning-engine/actions/runs/38466213421): all 69 tests passed, none skipped, including both pooled PostgreSQL checks. That exact commit [deployed successfully](https://dashboard.render.com/web/srv-db3t3iub7d7c739hfad0/deploys/dep-db79l8ss728c73fm8fo0) to the existing Free service in 42.4 seconds, reporting Live at 21:55:42 London time. No new host, plan, migration or provider search was needed.

After the user signed in, the actual hosted Flaine view displayed the saved direct Gatwick–Geneva pair, all ten seller observations, observation time, incomplete coverage, research source/review controls and research-derived open questions. The return review draft showed 20 December, 12:35 Europe/Zurich departure and 13:15 Europe/London arrival, with tentative status and no booking note. It was cancelled without saving. A real connected MCP `get_itinerary` call returned the same trip and ten `provider_reported` research observations, manual revision 1 and zero manual items. The isolated preview's saved flight did not affect the real trip.

HTTP checks returned 200 for `/health` and `/itinerary`; health retained `liveSearch: true`. Unauthenticated `/mcp` returned 401 with its authentication challenge. Chrome visual capture verified the deployed research view. Phone-width editing/save/duplicate-detection checks were against the isolated preview, not a physical phone or a hosted write. Real manual itinerary writes, two-account browser isolation and the later collaboration milestone retain their separate acceptance work.

## Hosted creation and sharing — 14 October 2026

Release `f6f1670` adds private view-only invitations and applies migration 006. All 72 CI tests passed, including three pooled PostgreSQL checks. The signed-in hosted app created a clearly fictional trip and saved one tentative note; an independent connected MCP read returned the same item at revision 2. This verifies real hosted creation/save and web-to-MCP read continuity. The original Flaine itinerary is still empty and unchanged. Cross-surface editing and broader hosted edit/remove/reorder acceptance remain pending.

The hosted Share trip screen created one invitation only for the fictional itinerary. Its signed-out test tab retained the pending invitation through account navigation. The user saved Brevo SMTP settings in Supabase, and a reload confirmed they persisted. New-account email delivery, hosted viewer acceptance and hosted revocation are the remaining checks. See [sharing evidence and privacy boundaries](itinerary-sharing.md).
