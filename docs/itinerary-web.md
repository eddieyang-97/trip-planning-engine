# Itinerary web app — organizer slice

Updated 25 October 2026 for hosted landing-page navigation; dated feature and acceptance details below retain their original scope. The same Node service serves `/itinerary`; no additional host, framework or backend service is required. Manual organization, saved-research review and private viewer invitations are deployed. Hosted creation/save, second-account joining and revocation passed; broader organizer editing and automatic research reconciliation remain incomplete. See [current architecture](architecture.md) and [delivery status](implementation.md).

## Temporary read recovery

For [#52's first increment](https://github.com/eddieyang-97/trip-planning-engine/issues/52), source retains the current trip's last-loaded on-screen plan after a temporary refresh failure, labels it with the last successful load time, and provides Retry. A failed first load has its own retry panel. Retry reads the requested trip only; it does not repeat edits or searches. This applies to signed-in trips and account-free view links and adds no persistent/offline cache.

Retry retains the requested trip from a direct link, including an archived-trip lookup that temporarily failed. Switching trips clears the previous snapshot. Sign-out/account changes and access denial clear private content and open dialogs; a denied trip-list read also clears the entire displayed list. Denial is handled before assuming a non-JSON response is temporary. The recovery UI does not establish that access remains valid during an outage: the next successful access check is authoritative. This increment requires separate merge/deployment and hosted acceptance evidence in issue #52.

## Research archive/restore

Owners can archive an active research decision from its saved-research section. Archived research disappears from active flight cards, selections and open questions; manual itinerary items stay in place. The **Archived research** disclosure lists retired decisions with restore controls and pagination. A decision with any linked booking report cannot be archived. Restore retains the same evidence and selection rationale, with no new search or evaluation. Already admitted searches continue; archive neither cancels supplier work nor refunds allowance. These controls share decision revision and retry protection with MCP `archive_decision`/`restore_decision`. Assistants can use `list_decisions({tripId,status:"archived"})` and `get_decision` for deliberate evidence retrieval and the latest 20 transition events; older journal entries remain stored. Migration 012 is required. See [delivery status](implementation.md) for deployed acceptance and [Issue #24](https://github.com/eddieyang-97/trip-planning-engine/issues/24) for historical verification.

## Compact phone workspace

The [#52 phone-layout increment](https://github.com/eddieyang-97/trip-planning-engine/issues/52) keeps the title/dates compact, trip switching and accepted members in disclosures, and Add item/Share trip visible when the reader's role allows them. **More** contains Refresh, calendar export, discussion and the existing trip options. Desktop keeps the trip list and secondary actions visible. Member expansion is retained across refreshes of the same trip.

Owners open the short **Research** summary to reach saved flights, stay/dining comparisons and Add research. Direct comparison links and comparison-load errors open the relevant disclosures. Background discovery leaves ordinary trip URLs focused on the itinerary; opening or choosing a comparison retains its specific link. Viewers/editors and anonymous links retain their existing research/profile restrictions; moving controls does not change backend authorization, selection, itinerary or booking semantics. First-trip and empty-plan actions remain available. This is source behavior; merge/deployment and hosted/device acceptance are tracked separately in issue #52.

## Overview and detailed navigation

The default Overview presents days side by side on desktop and as a compact vertical agenda on phones. Morning, afternoon and evening sections group items by their recorded local start time; card heights do not represent duration. Flight cards explicitly show differing departure/arrival zones. Stays appear through their checkout date as references to the same item; unknown times and undated alternatives remain separate. Known same-zone interval overlaps receive a check-details label; unknown ends and cross-zone intervals are not guessed. Details retains the organizer's manual order.

Overview cards open the corresponding expanded Details card; owners and editors also have a direct Edit action. Editing a stay from any displayed day retains its original check-in/checkout dates. The Overview/Details switch and horizontally scrollable date links stay at the top as the trip header scrolls away. Details highlights the day currently in view; tapping a date leaves its heading below the sticky bar. Individual activity cards use keyboard-accessible native disclosure controls, retain time/status when collapsed and remember collapse choices while the page is open. The selected view is kept in the URL. Both views use the same fetched itinerary and existing owner/viewer privacy projection; there is no new data store, provider request, permission or migration.

## Contextual item editor

Day-level **Add** in Overview and Details prefills only the chosen start date. The header Add uses the currently viewed day; Ideas and the map's Whole trip context start undated. Clearing a date keeps an unscheduled idea. The editor starts with title, type, date, optional local start time and location. End schedule/time zones, notes/link, map pins and owner-only booking details use separate disclosures, which open automatically when their saved or research-draft fields are populated. Save and Cancel remain outside the scrolling fields. Invalid fields reveal their section before receiving focus.

Collapsing a section does not discard its values. **Use start time zone for end** explicitly copies a selected zone once, without changing dates/times or automatically following later start-zone changes. Distinct flight zones remain independent. Editor writes continue to exclude booking status and private notes; new editor items remain tentative, and updating a shared item preserves the owner's booking facts. Viewers and account-free links receive no Add/Edit controls. This [#52 increment](https://github.com/eddieyang-97/trip-planning-engine/issues/52) changes browser interaction only; deployment and hosted/device acceptance require separate evidence.

## Apple Calendar export — current feature guide

The itinerary provides one-item, all-item and selected-subset `.ics` snapshots, using existing trip access and private-field filtering. For the authoritative user flow, schedule/DST rules, temporary download tickets, limitations and dated acceptance evidence, see [Apple Calendar export](calendar-export.md) and the preserved [15 October combined release record](release-calendar-comments-2026-10-15.md). Saved-trip/native-device acceptance is tracked in [delivery status](implementation.md).

## What works

- Trip picker and creation, day-by-day display, date navigation and an unscheduled section. All six item types are supported: flight, accommodation, transfer, activity, restaurant and note.
- Add/edit/remove items and move them within a date group. Manual ordering controls presentation; the app does not reorder a plan behind the user's back based on times.
- Optional local dates/times, IANA zones, locations, safe HTTPS links, practical notes and open questions. Unknown values stay empty. An end date is shown on its starting item; overnight stays are not automatically duplicated on each day.
- Tentative versus user-reported booked status. The booked state requires an explicit booking note. No supplier reservation, cancellation or payment is performed.
- Persistent history with before/after values, actor, timestamp and revision. Removing an item hides it from the current plan while retaining the record and history. Latest 50 events are returned; the full history remains in the database.
- One authoritative trip state for web and MCP. Five tools expose the same implementation: `get_itinerary`, `add_itinerary_item`, `update_itinerary_item`, `remove_itinerary_item`, `move_itinerary_item`.

## Itinerary timezone picker

Start and end time zones use separate searchable city/country comboboxes. Users can search city names, country names or IANA identifiers, choose with mouse/touch or arrow keys and Enter, and leave either field empty when unknown. The displayed label is friendly (for example, Rome — Italy); saved itinerary fields remain the existing IANA identifiers. The picker never guesses a zone from the destination and does not change stored dates or local times.

Saved aliases retain their original IDs. Unknown future saved IDs remain intact when another item field is edited. Unselected search text cannot silently replace or reuse the previous zone: users must choose a result or clear the field before saving. Keyboard Escape closes the results before closing the item dialog. On narrow screens each picker spans the editor width.

The bundled country-specific metadata derives from IANA tzdb’s public-domain [zone.tab](https://github.com/eggert/tz/blob/main/zone.tab), including aliases that retain a city/country label. The source URL, retrieval date and SHA-256 are recorded in `web/timezone-data.ts`. Browser Intl supplies country labels and supported timezone names; existing server validation remains authoritative. No provider, geocoder, runtime service or npm dependency is added. The stored identifiers retain daylight-saving rules rather than freezing a UTC offset. A few explicit destination search aliases help find the appropriate representative city; they do not populate the fields automatically.

Touch choices commit on primary-pointer release without treating scroll/cancel as a selection; compatibility clicks are ignored to avoid duplicate selection, while keyboard and assistive click activation remain supported. This avoids an observed blur-before-click failure on iPhone-style interaction. Fixture coverage does not prove every physical browser. See the relevant timezone-picker PR for exact regression evidence.

## Preview and sign-in

```sh
npm run build
npm run dev
```

Open `http://127.0.0.1:3000/itinerary?demo=1` for the deliberately labelled Flaine example. It contains no confirmed bookings, invented fares or invented flight times. Four adults and the Geneva gateway are labelled or noted assumptions. Demo changes live only in page memory and reset on reload; no private trip is loaded or written. This is an interactive design preview, not the user's saved itinerary.

On the hosted service, the root `/` redirects to `/itinerary` (HTTP 302), making the trip workspace the default landing page for both signed-in and signed-out visitors. The actual `/itinerary` view uses the existing travel-account session and directs signed-out hosted users to `/account?returnTo=itinerary`; after successful sign-in they return to their trips. The dedicated `/account` and `/oauth/consent` pages remain available without a redirect, including for password recovery, account settings and assistant authorization. Since 16 October, Account and Itinerary share persistent, refreshable browser sign-in across navigation and closed/reopened app tabs. Sign-out/account changes clear private views and invalidate outstanding responses; see [persistent session and joint-release evidence](account-linking.md#persistent-browser-session). No MCP client or provider API key is needed to use the hosted web app. Real account sign-in passed on 13 October; the Supabase dashboard account is separate.

Local development accepts the existing local bearer token through a password field. That token is held only in memory, not embedded in the page or written to browser storage. It remains a developer option; friends use hosted sign-in. Local preview ports and fixture database paths vary by development session.

## Persistence and authorization

Migration `004_itinerary.sql` adds the trip itinerary revision, `itinerary_items` and `itinerary_events`. It does not change existing research selections or bookings. New tables use RLS with direct public/anon/authenticated data access revoked. The server still requires explicit ownership checks because its database connection can bypass RLS.

The browser sends direct-session bearer tokens to `/itinerary-api/:operation`. Hosted authentication reuses `supabaseAccounts`: verify the token and confirmed live user, and reject assistant OAuth tokens. POST requests require the same Origin. A server-only, allowlisted `Core.callFromWeb` accepts the authenticated user ID; client-supplied owner fields are rejected by strict schemas. It does not create or expand assistant grants. MCP calls continue to check their grant and version on every operation.

Web and MCP writes share idempotency records, trip ownership checks and transaction logic. A trip-row lock plus `expectedRevision` prevents concurrent writes silently replacing one another. Every successful edit increments the trip itinerary revision. The UI keeps an idempotency key for an identical failed submission; users should inspect uncertain outcomes before changing the draft or reopening an editor. On a revision conflict it asks for a reload instead of automatically applying stale content.

The first slice limits each trip to 500 item records including removed items. The display includes the first 60 dates plus every date containing an item, with a notice for longer trips. These are explicit pilot bounds. Content is rendered with text nodes rather than user-supplied HTML, links open with `noopener noreferrer`, and the page has a restrictive CSP and no external analytics, fonts or media dependencies.

## Saved research display

`get_itinerary` now adds a typed, owner-scoped research projection within the same repeatable-read transaction as the manual plan. It shows up to five decisions by title, twenty newest candidate/seller/fare observations per decision and twenty pinned selection/booking records. Older selected/booked evidence remains visible within those limits even when a newer fare observation exists. Limit notices are explicit. Provider request tokens, OAuth grants and attempt ledgers are excluded from this presentation payload. No migration or expanded web-operation allowlist is needed.

The page shows the saved flight pair, airport-local dates/times and zones, observation dates, provenance, incomplete coverage, source links and recorded seller amounts. Unknown party basis stays unknown; prices are not presented as comparable verified trip totals. Current selection and booking reports appear separately from the manual plan. Rejected and synthetic research cannot be copied through the review buttons. The unresolved-questions panel includes research assumptions and missing price/equipment/airport coverage.

Review outbound/return opens the existing item editor with a tentative draft. Nothing is persisted until the user saves. Copying never selects a candidate or makes a booking; no price is guessed or carried into the manual item. A matching existing flight (route/location, dates and local times) opens for editing rather than adding another copy. This is a manual snapshot with a source link and research note, not a durable observation-ID link or automatic update mechanism. Changed research must be reconciled by the organizer. The research section starts open on an empty itinerary and collapsed once plan items exist, keeping the day-by-day view prominent.

The UI now shows initial/loading feedback and bounded request timeouts. An unavailable trip URL falls back to an available owner trip with an explanatory message. A failed reload retains the previous plan and reports the failure; the editor stays open if a mutation or its subsequent reload fails.

## Verification and history

The compiled-browser and PostgreSQL regressions cover authorized trip writes, revision conflicts, stale responses, saved-research privacy, duplicate manual review drafts, navigation, timezone input and sharing boundaries. Hosted/real-device acceptance remains scoped to what was actually exercised. Earlier release/deployment/CI counts and account-specific observations live in the original Issues and PRs; consult [current delivery](implementation.md), [browser tests](browser-testing.md) and [feature index](README.md) instead of treating a prior pilot result as general acceptance.
