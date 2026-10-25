# Itinerary web app — organizer slice

Updated 25 October 2026 for hosted landing-page navigation; dated feature and acceptance details below retain their original scope. The same Node service serves `/itinerary`; no additional host, framework or backend service is required. Manual organization, saved-research review and private viewer invitations are deployed. Hosted creation/save, second-account joining and revocation passed; broader organizer editing and automatic research reconciliation remain incomplete. See [current architecture](architecture.md) and [delivery status](implementation.md).

## Research archive/restore — Issue #24 (prepared)

Owners can archive an active research decision from its saved-research section. Archived research disappears from active flight cards, selections and open questions; manual itinerary items stay in place. The **Archived research** disclosure lists retired decisions with restore controls and pagination. A decision with any linked booking report cannot be archived. Restore retains the same evidence and selection rationale, with no new search or evaluation. Already admitted searches continue; archive neither cancels supplier work nor refunds allowance. These controls share decision revision and retry protection with MCP `archive_decision`/`restore_decision`. Assistants can use `list_decisions({tripId,status:"archived"})` and `get_decision` for deliberate evidence retrieval and the latest 20 transition events; older journal entries remain stored. Migration 012 is required. This is implementation guidance, not deployed acceptance; see [delivery status](implementation.md).

## Overview and detailed navigation — 14 October 2026

The default Overview presents days side by side on desktop and as a compact vertical agenda on phones. Morning, afternoon and evening sections group items by their recorded local start time; card heights do not represent duration. Flight cards explicitly show differing departure/arrival zones. Stays appear through their checkout date as references to the same item; unknown times and undated alternatives remain separate. Known same-zone interval overlaps receive a check-details label; unknown ends and cross-zone intervals are not guessed. Details retains the organizer's manual order.

Overview cards open the corresponding expanded Details card. The Overview/Details switch and horizontally scrollable date links stay at the top as the trip header scrolls away. Details highlights the day currently in view; tapping a date leaves its heading below the sticky bar. Individual activity cards use keyboard-accessible native disclosure controls, retain time/status when collapsed and remember collapse choices while the page is open. The selected view is kept in the URL. Both views use the same fetched itinerary and existing owner/viewer privacy projection; there is no new data store, provider request, permission or migration.

Validation: build passed and 71 local tests passed with three external PostgreSQL checks skipped. New checks cover stay checkout boundaries, timed/untimed ordering, conservative overlap warnings and delivery of the stylesheet. An isolated copy of the selected trip verified desktop columns, 390px phone fit, sticky date switching, correct active day when opening an activity, collapsing, and viewer privacy.

Implementation `9a69257bc9f7468e2e2188ed116ffd6a07dfc787` passed [CI run 38629184354](https://github.com/eddieyang-97/trip-planning-engine/actions/runs/38629184354): all 74 tests passed, none skipped, including all three pooled PostgreSQL checks. That exact commit [deployed to the existing Free service](https://dashboard.render.com/web/srv-db3t3iub7d7c739hfad0/deploys/dep-db7u207f3r2c739edee0) in 48.5 seconds, reporting Live at 21:08:16 London time on 14 October. The signed-in hosted itinerary rendered three overview columns and all 27 detail cards. At 390px, activity selection, collapse, sticky navigation, date switching, and the active date changing while scrolling passed with no horizontal page overflow or console errors. The organizer's existing Edit form opened correctly and was cancelled without saving. No itinerary data, invitation or booking was changed by these display checks. Physical-phone testing remains separate.

## Apple Calendar export — current feature guide

The itinerary provides one-item, all-item and selected-subset `.ics` snapshots, using existing trip access and private-field filtering. For the authoritative user flow, schedule/DST rules, temporary download tickets, limitations and dated acceptance evidence, see [Apple Calendar export](calendar-export.md) and the preserved [15 October combined release record](release-calendar-comments-2026-10-15.md). Saved-trip/native-device acceptance is tracked in [delivery status](implementation.md).

## What works

- Trip picker and creation, day-by-day display, date navigation and an unscheduled section. All six item types are supported: flight, accommodation, transfer, activity, restaurant and note.
- Add/edit/remove items and move them within a date group. Manual ordering controls presentation; the app does not reorder a plan behind the user's back based on times.
- Optional local dates/times, IANA zones, locations, safe HTTPS links, practical notes and open questions. Unknown values stay empty. An end date is shown on its starting item; overnight stays are not automatically duplicated on each day.
- Tentative versus user-reported booked status. The booked state requires an explicit booking note. No supplier reservation, cancellation or payment is performed.
- Persistent history with before/after values, actor, timestamp and revision. Removing an item hides it from the current plan while retaining the record and history. Latest 50 events are returned; the full history remains in the database.
- One authoritative trip state for web and MCP. Five tools expose the same implementation: `get_itinerary`, `add_itinerary_item`, `update_itinerary_item`, `remove_itinerary_item`, `move_itinerary_item`.

## Itinerary timezone picker — 15 October 2026

Start and end time zones use separate searchable city/country comboboxes. Users can search city names, country names or IANA identifiers, choose with mouse/touch or arrow keys and Enter, and leave either field empty when unknown. The displayed label is friendly (for example, Rome — Italy); saved itinerary fields remain the existing IANA identifiers. The picker never guesses a zone from the destination and does not change stored dates or local times.

Saved aliases retain their original IDs. Unknown future saved IDs remain intact when another item field is edited. Unselected search text cannot silently replace or reuse the previous zone: users must choose a result or clear the field before saving. Keyboard Escape closes the results before closing the item dialog. On narrow screens each picker spans the editor width.

The bundled country-specific metadata derives from IANA tzdb’s public-domain [zone.tab](https://github.com/eggert/tz/blob/main/zone.tab), including aliases that retain a city/country label. The source URL, retrieval date and SHA-256 are recorded in `web/timezone-data.ts`. Browser Intl supplies country labels and supported timezone names; existing server validation remains authoritative. No provider, geocoder, runtime service or npm dependency is added. The stored identifiers retain daylight-saving rules rather than freezing a UTC offset. A few explicit destination search aliases help find the appropriate representative city; they do not populate the fields automatically.

Validation covers city/country/identifier and destination searches, distinct regional clock rules, legacy and unknown ID preservation, and seasonal Rome offsets. Isolated browser acceptance verified keyboard and pointer selection, separate start/end values surviving save/reopen, invalid-text rejection, optional clearing and the narrow-screen layout. Implementation `93d2289` passed [CI run 38662588755](https://github.com/eddieyang-97/trip-planning-engine/actions/runs/38662588755): **83 passed, zero skipped**, including all three pooled PostgreSQL checks. The local isolated run passed 80 with those three checks skipped. A 390px phone viewport reported 375px document width with no overflow and a 274px result panel spanning the editor. 

The exact tested commit was [deployed on 15 October 2026](https://dashboard.render.com/web/srv-db3t3iub7d7c739hfad0/deploys/dep-db829a0m7kps73cp05fg) at 01:56 London time, completing in 42.9 seconds. Render showed Deploy succeeded/Live and `/health` returned 200 with status ok. The release contains only the timezone change; concurrent calendar work stayed outside this commit.

Hosted browser acceptance opened an existing flight editor and verified its saved start/end IDs display as London — United Kingdom and Rome — Italy. Searching Italy returned the Rome result with Europe/Rome beneath it. The editor was cancelled without saving; no real itinerary values, revisions or booking state were changed. Save/reopen, invalid input, clearing and phone-width checks used only the isolated fictional fixture.

### Touch selection regression — 15 October 2026

A user reported that tapping Rome after searching `alba` on an iPhone left the
typed query in the field. The previous picker committed only on click while
closing immediately on blur. The fix commits a stationary primary-pointer
release and keeps an in-progress option gesture alive across input blur. Touch
selection finishes keyboard editing before setting the chosen label; scrolling,
cancelled gestures and secondary buttons do not select. A following compatibility
click is ignored, while keyboard and assistive click activation remain supported.
The search inputs also disable keyboard autocorrection and automatic capitals
for city names and IANA identifiers.
The relative ordering of focus/blur and pointer events varies between browsers;
see the [Pointer Events specification](https://w3c.github.io/pointerevents/).

Exact destination aliases now rank before incidental substrings: `alba` shows
Rome first, ahead of Albania and Svalbard. Stored IANA IDs and local times are
unchanged by search ranking.

Regression tests replay tap-without-click, duplicate click, drag, cancellation,
foreign-pointer, mouse and assistive activation sequences. The complete local
suite passed 93 tests with three external PostgreSQL checks skipped. The browser
fixture verified `alba` → Rome selection, a closed panel, keyboard selection for
the other zone, and both zones surviving save/reopen. At 390px viewport width,
document width and scroll width were both 375px. All writes used an isolated
fictional itinerary. Actual iPhone Safari confirmation remains required after
deployment; the desktop browser's phone viewport does not emulate its keyboard
or native touch event ordering.

## Preview and sign-in

```sh
npm run build
npm run dev
```

Open `http://127.0.0.1:3000/itinerary?demo=1` for the deliberately labelled Flaine example. It contains no confirmed bookings, invented fares or invented flight times. Four adults and the Geneva gateway are labelled or noted assumptions. Demo changes live only in page memory and reset on reload; no private trip is loaded or written. This is an interactive design preview, not the user's saved itinerary.

On the hosted service, the root `/` redirects to `/itinerary` (HTTP 302), making the trip workspace the default landing page for both signed-in and signed-out visitors. The actual `/itinerary` view uses the existing travel-account session and directs signed-out hosted users to `/account?returnTo=itinerary`; after successful sign-in they return to their trips. The dedicated `/account` and `/oauth/consent` pages remain available without a redirect, including for password recovery, account settings and assistant authorization. Since 16 October, Account and Itinerary share persistent, refreshable browser sign-in across navigation and closed/reopened app tabs. Sign-out/account changes clear private views and invalidate outstanding responses; see [persistent session and joint-release evidence](account-linking.md#persistent-browser-session--16-october-2026). No MCP client or provider API key is needed to use the hosted web app. Real account sign-in passed on 13 October; the Supabase dashboard account is separate.

Local development accepts the existing local bearer token through a password field. That token is held only in memory, not embedded in the page or written to browser storage. It remains a developer option; friends use hosted sign-in. Local preview ports and fixture database paths vary by development session.

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

Next acceptance increments: finish organizer validation, direct web flight controls and durable research links/reconciliation. [View-only invitations and membership](itinerary-sharing.md) deployed on 14 October; hosted second-account onboarding and revocation passed. Comments/proposals and organizer approval follow. History pagination/restoration remains further work. Public anonymous sharing is not enabled.

## Hosted verification — 13 October 2026

Implementation `70b884a54f7584b6d80919a601b35b2f72e30750` passed [CI run 38466213421](https://github.com/eddieyang-97/trip-planning-engine/actions/runs/38466213421): all 69 tests passed, none skipped, including both pooled PostgreSQL checks. That exact commit [deployed successfully](https://dashboard.render.com/web/srv-db3t3iub7d7c739hfad0/deploys/dep-db79l8ss728c73fm8fo0) to the existing Free service in 42.4 seconds, reporting Live at 21:55:42 London time. No new host, plan, migration or provider search was needed.

After the user signed in, the actual hosted Flaine view displayed the saved direct Gatwick–Geneva pair, all ten seller observations, observation time, incomplete coverage, research source/review controls and research-derived open questions. The return review draft showed 20 December, 12:35 Europe/Zurich departure and 13:15 Europe/London arrival, with tentative status and no booking note. It was cancelled without saving. A real connected MCP `get_itinerary` call returned the same trip and ten `provider_reported` research observations, manual revision 1 and zero manual items. The isolated preview's saved flight did not affect the real trip.

HTTP checks returned 200 for `/health` and `/itinerary`; health retained `liveSearch: true`. Unauthenticated `/mcp` returned 401 with its authentication challenge. Chrome visual capture verified the deployed research view. Phone-width editing/save/duplicate-detection checks were against the isolated preview, not a physical phone or a hosted write. Real manual itinerary writes, two-account browser isolation and the later collaboration milestone retain their separate acceptance work.

## Hosted creation and sharing — 14 October 2026

Release `f6f1670` adds private view-only invitations and applies migration 006. All 72 CI tests passed, including three pooled PostgreSQL checks. The signed-in hosted app created a clearly fictional trip and saved one tentative note; an independent connected MCP read returned the same item at revision 2. This verifies real hosted creation/save and web-to-MCP read continuity. The original Flaine itinerary is still empty and unchanged. Cross-surface editing and broader hosted edit/remove/reorder acceptance remain pending.

The hosted Share trip screen created one invitation only for the fictional itinerary. Its signed-out test tab retained the pending invitation through account navigation. The user saved Brevo SMTP settings in Supabase, and a reload confirmed they persisted. After SMTP repair, second-account confirmation/sign-in, hosted viewer acceptance and hosted revocation passed. The selected real itinerary rendered all 27 imported items in the hosted organizer app and fit a 390px viewport; its sharing dialog remains owner-only and ready for manual invitation creation. See [sharing evidence and privacy boundaries](itinerary-sharing.md).
