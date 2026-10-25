# Itinerary map

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

## Saved-pin verification and presentation

The previously deployed backend preserves pins when an older MCP client omits `mapLocations`; explicit `[]` clears them. Mutations return `mapLocationCount`, and MCP tool instructions require read-back verification. The web editor now checks the response count and the refreshed saved item's labels/coordinates before showing success. A mismatch leaves a reviewable error rather than claiming the pins saved. A plain location string or maps link still does not create coordinates. This release does not backfill existing real-trip pins.

Public website branding is **Trip Planner**, with the headline **Plan, organize and share your trips.** Repository, package and deployment identifiers remain unchanged.

Overview, Details and Map share category meanings: accommodation indigo `#6366F1`, restaurants/bars amber `#F59E0B`, activities green `#16A34A`, and flights/transfers blue `#0284C7`. Notes are neutral slate. Icons, labels and category filter chips provide non-colour cues. The 16 October map simplification removes itinerary numbers and multi-icon pills: a single category icon represents a location, and a neutral place icon represents mixed categories at the same location. Nearby locations cluster into count circles as the map zooms out. Selected pins gain an outline; the corresponding list card highlights. Every activity remains individually accessible through the selected-location card and place list. See the [map guide](itinerary-map.md) for the current interaction.

Booking remains a separate labelled checkmark: **Booked · reported by you/owner**. Neither colour nor a checkmark implies supplier verification or a new reservation.

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

## Validation and client limitations

PostgreSQL/fixture-browser regressions cover coordinate bounds, pin persistence, omission versus explicit removal, private projections, revocation, provider response limits, map filtering, shared places and keyboard selection. Bounded hosted demo, place-search and pin checks have separate release evidence. Native phone gestures and real-trip/client-specific workflows are not universally verified; consult [current delivery](implementation.md) and the original map PRs.

Some connected assistant clients cache MCP schemas. After the `mapLocations` tool field changes, refresh connection metadata and start a new conversation before expecting to write pins; a metadata refresh does **not** backfill coordinates already absent from itinerary items. Save/read-back `mapLocationCount` and the actual coordinates before claiming success. [ChatGPT connection guidance](https://developers.openai.com/plugins/deploy/connect-chatgpt#refresh-metadata).
