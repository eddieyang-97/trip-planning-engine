# Itinerary map — 15 October 2026

## User outcome and scope

Map joins Overview and Details over the same itinerary. Friends can browse saved
places through their existing view link. Owners and signed-in editors can find a
public place and explicitly save up to two pins on an item, including endpoints
for a flight or transfer. Map search never changes dates, times, booking status or
the free-text location. Existing items are unpinned until someone chooses a place.

Whole trip, each day and Ideas filter the items. Multi-day items remain visible
through their recorded end date, including a stay's checkout. Compact category
filters refine both map and list. Single-category locations use one coloured icon;
a shared location with mixed categories uses one neutral place pin. Itinerary
numbers are omitted from map pins and place cards.

Nearby distinct locations cluster in screen pixels as the map zooms out. Circle
counts represent locations, not itinerary order or number of activities. Activate
a cluster to zoom in; at maximum zoom it opens the complete place list instead.
Co-located activities share one pin and remain individually accessible in a
selected-location card below the map. Enter/Space support marker activation.
The selected marker gains an outline and its corresponding list card highlights.

Missing pins remain in the list. An actionable missing-location count filters the
list to those items; the existing map stays visible for context. Owners/editors
have Add map location; viewers have no edit action. There are no guessed
coordinates, route lines, driving durations or live navigation.

## Data and access

Optional `ItineraryItem.mapLocations` is an array of at most two
`{label, latitude, longitude}` objects. Labels are 1–250 characters; finite
coordinates are limited to latitude ±85 (the displayed Web Mercator map) and
longitude ±180. Older payloads remain valid. Existing JSONB item storage and
revision/idempotency checks apply; no migration is needed. Nested map fields are
explicitly allowlisted in member and anonymous projections. Pins are shared plan
data: do not store a private address in a trip you intend to share.

Owner MCP add/update tools accept the same optional pins, and reads return them.
Place lookup is a direct-web endpoint, not a new assistant geocoding tool.
Collaborator MCP editing remains its separate existing deliverable. Full item
updates should preserve mapLocations when editing unrelated fields; the editor
does so. Removal is explicit through Remove pin and saving the item.

`POST /itinerary-api/place-search` requires a direct account session, exact
same-origin request and current owner/editor access to the supplied trip. Access
is checked before and after the external lookup; anonymous links and signed-in
viewers cannot invoke it. Only the explicit query is sent to the search provider;
trip IDs, tokens, titles, notes and booking fields are not included. The search
UI displays this boundary and returns results as text, never provider HTML.

## Providers and deployment

- [Leaflet 1.9.4](https://leafletjs.com/reference.html), bundled locally, displays
  the map. Its BSD 2-Clause licence is included in `web/leaflet-license.txt`, served
  at `/assets/leaflet-license.txt` and linked from the map. No CDN JavaScript.
- [Photon](https://photon.komoot.io/) supplies explicit place searches. Its public
  server permits reasonable project usage but can throttle or withdraw service.
  This pilot sends no autocomplete, bulk or background requests. Each instance
  allows ten searches/user/minute, sixty total/minute and provider starts at least
  1.1 seconds apart. Responses have an 8-second deadline, 64KB cap and five-result
  cap. A bounded 200-entry memory cache lasts 24 hours; restarts clear the cache.
- [OpenStreetMap tiles](https://operations.osmfoundation.org/policies/tiles/) load
  only for the map viewport, with visible attribution and normal browser caching.
  Each tile image uses `referrerPolicy: origin`; the page otherwise retains
  `no-referrer`, so sharing fragments, trip queries and account tokens do not reach
  the tile host. No bulk prefetch, offline feature or tile proxy is introduced.
  These public services have no availability guarantee.

Empty map filters show their unpinned item list without loading a background map.
Changing a search query or closing/reopening the editor invalidates older pending
results, so an earlier response cannot replace the current search choices.

Defaults require no API key, paid plan, worker or database migration. Optional
`MAP_SEARCH_URL`, `MAP_TILE_URL` and `MAP_TILE_ATTRIBUTION` replace providers through
deployment configuration. Both endpoints require HTTPS; tile CSP uses the configured
tile origin. Keep the current single Render instance; global limits/cache must move
to shared storage before scaling horizontally. Provider failures preserve saved pins
and the accessible item list. Selected OSM-derived place data requires appropriate
OSM attribution; larger reuse should review ODbL obligations.

## Validation and joint acceptance

Local automated coverage checks legacy payloads, coordinate bounds, day spans,
numbering, provider response filtering/bounds, caching and rate limits, persistence,
editor booking-field preservation, anonymous nested-field privacy, unauthenticated
and viewer denial, origin checks and membership revocation. All external requests
in automated tests are stubbed; no provider quota is consumed by CI.

Browser checks used only isolated fictional data: phone-width map tiles loaded,
day filtering retained the stay, shared-place popups opened the correct detail,
and a live explicit `Turin Airport Italy` search produced choices. A chosen airport
pin survived save and a fresh page/sign-in. At a 390×844 viewport, document width
and scroll width were both 375px. This is a responsive browser check, not native
iPhone acceptance. No real trip was edited.

Joint checks after deployment: add the correct Alba venues; switch days and back
to Details; open the same pins on the friend's anonymous link; check two flight
endpoints, pin removal and mobile map gestures. These are intentionally pending
the user's joint testing session. Record deployment and CI evidence separately.

## Hosted release evidence — 15 October 2026

Implementation `d443ce9` and final UI refinement `d7dc2ac` are pushed to GitHub main.
The [final CI run](https://github.com/eddieyang-97/trip-planning-engine/actions/runs/38784581875)
passed **100 tests, zero skipped**, including all three pooled PostgreSQL checks.
Local full-suite validation passed 97 with those three external checks skipped;
the focused map suite and production build also passed after the privacy changes.

[Render deployment](https://dashboard.render.com/web/srv-db3t3iub7d7c739hfad0/deploys/dep-db8hjdrrjlhs7386nrc0)
explicitly selected `d7dc2ac0e9d632427e2b00b3eca01388bcc8abf2`. It succeeded in
42.2 seconds and became live at **19:22 London time**. The live frontend matched
the tested local bundle SHA-256
`8e25613ec572ea9fd86766a1d05126a0ec6f59fab6367b6aa7d477f62c70cc58`.
Health, map configuration and the distributed licence returned 200; anonymous
place-search returned 401 without a provider request.

The [hosted example map](https://trip-planning-engine.onrender.com/itinerary?demo=1&view=map)
rendered its grouped pins, loaded four visible tiles at phone width and reported
no browser errors or warnings. Document width and scroll width were both 375px
at a 390×844 viewport. Tile image referrer policy was `origin`. The screenshot is
`itinerary-map-live-2026-10-15.png` in this chat's visualization artifacts.

Real trip pinning, hosted signed-in place lookup/save, friend-link map viewing and
native phone gestures remain joint acceptance tasks. The real Alba and Flaine
items were not changed. The temporary release worktree was archived; concurrent
PRD/calendar document edits were retained byte-for-byte.

## Assistant metadata gap — 15 October 2026

A later read of Alba returned revision 36, 28 items and zero mapLocations. Recent
assistant edits had saved itinerary text but no coordinates. The connected plugin
still advertised the older 23-tool inventory and item input without mapLocations;
the deployed MCP server already advertised the new optional field. This is a
client discovery gap, not evidence that saved pins failed to render. No real
itinerary mutation was made during diagnosis.

The official-SDK regression now checks that both add/update discovery include
mapLocations, writes a pin through MCP and reads it back, checks an old-schema
update preserves it, then explicitly clears it with `[]`. Omission preserves
existing pins for both owner and editor updates. Mutation responses include
mapLocationCount, and add/update descriptions distinguish textual locations from
saved coordinates and require checking the result before claiming success.

After deployment, directly connected ChatGPT custom MCP apps require a metadata
refresh in their connection settings, then a new conversation. See
[OpenAI's refresh instructions](https://developers.openai.com/plugins/deploy/connect-chatgpt#refresh-metadata).
Refreshing does not backfill coordinates: the requested places still need to be
resolved, saved as mapLocations, and read back. This chat's connected tool schema
must also refresh before it can submit that new field.

## Compact map presentation - 16 October 2026

This refinement replaces the earlier numbered/multi-icon marker presentation.
No new provider, dependency, API credential, infrastructure or database migration
is introduced. Browser checks use fictional trips only.

Validation: production build passed. Local suite: 109 tests, 106 passed and three
external-PostgreSQL checks skipped for CI. The cluster regression checks distinct
location counts versus repeated activities, cell-boundary proximity, zoom splitting,
stable grouping and preservation of every stop. Browser acceptance checked category
and missing-location filters, Enter/Space selection and cluster expansion, every
activity at a shared location, the maximum-zoom fallback for adjacent entrances,
selected-place detail handoff, day filtering including a stay's checkout and the
existing public demo. At requested 390x844 phone width the document and scroll
width were both 375px; only the category chip strip scrolls horizontally. Native
phone gesture acceptance remains a joint check.

Automatic approval review blocked creating an anonymous link for the isolated
fictional test trip, so no link was created. Existing automated anonymous/access
checks passed; browser checks used the existing public demo instead. No real
itinerary, coordinates, memberships or sharing settings were changed.
