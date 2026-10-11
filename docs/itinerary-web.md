# Itinerary web app — organizer slice

Implemented locally on 11 October 2026. The same Node service serves `/itinerary`; no additional host, framework or backend service is required. This slice delivers manual itinerary display/editing. It does not complete the later membership, comment, proposal or selected-research-linking requirements in the PRD.

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

The actual `/itinerary` view uses the existing travel-account session and directs signed-out hosted users to `/account`. The account page links back to itineraries. Sign in and follow that link in the same tab because the existing session uses tab-scoped session storage. No MCP client or provider API key is needed to use the hosted web app. Account sign-in still needs real hosted acceptance; the Supabase dashboard account is separate.

Local development accepts the existing local bearer token through a password field. That token is held only in memory, not embedded in the page or written to browser storage. It remains a developer option; friends use hosted sign-in. In this work session the review server uses port 3084 and the isolated `.data/itinerary-preview` database.

## Persistence and authorization

Migration `004_itinerary.sql` adds the trip itinerary revision, `itinerary_items` and `itinerary_events`. It does not change existing research selections or bookings. New tables use RLS with direct public/anon/authenticated data access revoked. The server still requires explicit ownership checks because its database connection can bypass RLS.

The browser sends direct-session bearer tokens to `/itinerary-api/:operation`. Hosted authentication reuses `supabaseAccounts`: verify the token and confirmed live user, and reject assistant OAuth tokens. POST requests require the same Origin. A server-only, allowlisted `Core.callFromWeb` accepts the authenticated user ID; client-supplied owner fields are rejected by strict schemas. It does not create or expand assistant grants. MCP calls continue to check their grant and version on every operation.

Web and MCP writes share idempotency records, trip ownership checks and transaction logic. A trip-row lock plus `expectedRevision` prevents concurrent writes silently replacing one another. Every successful edit increments the trip itinerary revision. The UI keeps an idempotency key for an identical failed submission; users should inspect uncertain outcomes before changing the draft or reopening an editor. On a revision conflict it asks for a reload instead of automatically applying stale content.

The first slice limits each trip to 500 item records including removed items. The display includes the first 60 dates plus every date containing an item, with a notice for longer trips. These are explicit pilot bounds. Content is rendered with text nodes rather than user-supplied HTML, links open with `noopener noreferrer`, and the page has a restrictive CSP and no external analytics, fonts or media dependencies.

## Validation and remaining acceptance

TypeScript build and all 46 tests pass. Tests cover schemas, ownership, assistant revocation, direct-session route protection, same-origin checks, cross-trip IDs, idempotent retries, conflicts, reordering, removal history, migrations and actual MCP tool calls. Browser checks verified demo add/edit flows, a required booking note and the resulting status, and no horizontal page/editor overflow at a 390px viewport. Browser console reported no errors during those interactions. Screenshot capture failed in the available browser; visual inspection of a rendered screenshot and a real phone remain outstanding.

Before hosted release, deploy the built assets and migration together and test real Supabase sign-in, two independent accounts and a web-to-MCP edit round trip on external PostgreSQL. The current GitHub push does not claim a new Render deployment.

Next product increments: explicit insertion of selected research with reconciliation when the selection changes; authenticated invitations and membership; comments/proposals; organizer approval. Trip editing, history pagination/restoration and richer accessibility/phone checks can follow pilot feedback. Public anonymous sharing is not enabled.
