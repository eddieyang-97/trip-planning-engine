# Apple Calendar export

Deployed on 15 October 2026; the user confirmed deployment and public checks
verified the calendar controls, frontend code and protected backend routes.
See [hosted release evidence](release-calendar-comments-2026-10-15.md). Saved-trip export on a physical
iPhone/iPad still needs acceptance. The earlier standalone probe's
three-event import was confirmed by the user on 14 October; see [probe evidence](apple-calendar-probe.md).

## User flow

Choose **Export to calendar** from the itinerary toolbar. All eligible items start
selected in one dialog. Keep that selection to export the itinerary, or use
**Deselect all** and check a subset. **Add to calendar** on an individual Details
card opens the same dialog with that item selected. Ineligible items stay visible
with an explanation. An empty selection cannot be exported.

Choose **Export selected**, then **Open in Apple Calendar**. The second tap follows
a real HTTP calendar-file link, matching the tested probe and avoiding an
asynchronous popup. A **Download calendar file** alternative is also available.
Choose the destination calendar in Apple Calendar and add the events. Exporting
does not modify the saved itinerary, its revision or any booking.

Exports are snapshots. Later itinerary edits do not update imported events, and
repeat imports may create duplicates. Event UIDs are stable across individual,
all and subset exports, but client deduplication is not guaranteed. Private booking
notes are always excluded, including for the owner. Shared notes, open questions,
locations, safe useful links and reported plan status are included.

The demo produces a labelled sample download in browser memory; it does not call
the saved-trip export API or claim to test the native handoff.

## Schedules

- Timed events use UTC instants resolved from the recorded date, local time and
  IANA zone. Flight departure and arrival zones are resolved independently.
- Missing zones, partial timed ends, invalid dates and ends at/before the start
  are excluded with a reason. Nonexistent or repeated local times during clock
  changes are excluded rather than silently choosing an instant.
- A timed start with no end date/time exports DTSTART without an invented end or
  duration. The description states that the end is unknown; a calendar client
  may still choose its own display duration.
- Date-only items export as all-day events. A hotel's end date is checkout and
  therefore exclusive. Other date-only ranges include their recorded final day;
  the serializer converts that to the next exclusive date.
- Undated items are unavailable until a start date is recorded. A date-only item
  with an end time needs its start time resolved before export.

## Delivery and access

The existing Node service mounts the calendar routes before the generic web-tool
dispatcher. No migration, Apple login, new host or calendar subscription is used.

| Route | Purpose |
| --- | --- |
| POST /itinerary-api/calendar-export | Direct-session export preparation with trip ID, selected item IDs and expected revision |
| POST /itinerary-share/calendar-export | Preparation using the existing account-free view credential and selected item IDs; caller cannot supply a trip ID |
| GET /itinerary/calendar/:token.ics | Open the prepared snapshot inline; adding ?download=1 selects attachment delivery |

Preparation requires the configured same origin. Signed-in readers use the
existing get_itinerary access checks; view-link readers use the existing
allowlisted shared projection. Stale revisions, duplicate/foreign item IDs and
ineligible selections fail explicitly. The file serializer allowlists event
fields, so owner-only history, research and booking notes never enter the file.

Apple Calendar cannot send the browser's bearer header. Preparation therefore
returns an unguessable, file-specific URL valid for two minutes. Delivery rechecks
the original session and trip access, or the original view link, before returning
the frozen snapshot. Revocation/expiry denies subsequent downloads. These URLs
are temporary capabilities and must not be logged or shared as permanent links.
Existing HTTP requests are not logged by the app; infrastructure access logs
should redact calendar-token paths if enabled.

Files use text/calendar with inline Content-Disposition, no-store, no-referrer,
nosniff and noindex protections. Tickets live only in process memory; a process
restart invalidates them and the user can prepare again. Preparation is bounded
to 60 requests/minute and 120 outstanding tickets, with an 8 MB per-file limit
and 16 MB total cached file bytes. Bounds apply to this service process.

Text is escaped and long lines fold at 75 UTF-8 octets without splitting code
points, following [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545.html).

## Verification boundary

Automated checks cover individual/all/subset selection, calendar UID/UTC/DST/checkout rules, private-field omission, request authentication, stale revisions, share-link revocation and temporary-ticket expiration. Hosted deployment and bounded smoke are recorded in the [15 October release](release-calendar-comments-2026-10-15.md) and the merged calendar PR. Saved-trip native Apple Calendar import, displayed times and repeat-import behavior require separate device-specific acceptance; export is a one-off snapshot, not a subscription.
