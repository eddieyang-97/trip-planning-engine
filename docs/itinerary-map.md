# Itinerary map — 15 October 2026

## User outcome and scope

Map joins Overview and Details over the same itinerary. Friends can browse saved
places through their existing view link. Owners and signed-in editors can find a
public place and explicitly save up to two pins on an item, including endpoints
for a flight or transfer. Map search never changes dates, times, booking status or
the free-text location. Existing items are unpinned until someone chooses a place.

Whole trip, each day and Ideas filter the items. Multi-day items remain visible
through their recorded end date, including a stay's checkout. Numbers follow the
displayed item order. Co-located pins share a marker and list their items in its
popup. Pin/list actions open the existing detailed item. Missing pins stay visible
as cards with an Add map location action for editors; viewers have no edit action.
There are no guessed coordinates, route lines, driving durations or live navigation.

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
