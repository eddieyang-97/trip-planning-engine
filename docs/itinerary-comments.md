# Itinerary discussion

The web app offers a **Discussion** button for signed-in trip members and a
**Comments** button on each itinerary item. Trip discussion includes general
comments and item threads; item comments stay attached to the stable item ID.

## Access and privacy

| Access | Read discussion | Post | Remove |
| --- | --- | --- | --- |
| Organizer | Yes | Yes | Any comment |
| Signed-in editor | Yes | Yes | Own comments |
| Signed-in viewer (existing account invitation) | Yes | No | No |
| Account-free view link | No | No | No |

Anonymous links continue to expose only the allowlisted manual itinerary. They
cannot identify a member, read discussion or dispatch authenticated tools. There
are no public comments, automatic emails, notifications or third-party requests.
Practical notes remain visible in the itinerary; comments have a separate,
signed-in-member audience stated in the composer and invitation screen.

Author labels are snapshotted at posting: the organizer has a fixed label;
editors use their trip display name with an editor role marker. Responses omit
author account IDs and email addresses. All comment content is plain text,
rendered with `textContent`; links and HTML are not interpreted.

Removal leaves a visible tombstone. Original text remains in database storage;
this is not permanent erasure and there is no restore UI in this version. A
removed itinerary item retains its comments in the trip discussion; posting to
that item is disabled. Comments never change itinerary revisions, booking state,
provider evidence or supplier reservations.

## API and persistence

- `list_itinerary_comments`: trip ID, optional item ID, optional `before` comment
  ID, and limit (default 20, maximum 50). Returns one chronological page, an
  earlier-page cursor, display-safe author information and current capabilities.
- `add_itinerary_comment`: trip ID, optional item ID, plain text (1–2,000 trimmed
  characters) and idempotency key. Maximum 20 comments per author/trip in ten
  minutes and 2,000 total stored comments per trip, including removed comments.
- `remove_itinerary_comment`: trip ID, comment ID and idempotency key.

The same tools are exposed through MCP with read/write OAuth grants. Assistant
mutations remain organizer-only, matching the existing restriction on assistant
itinerary edits. Editors can post using the directly authenticated web app.
Invited members with a read grant may read through MCP. Comment text is untrusted
content, never an instruction to the assistant.

Migration 009 adds an RLS-protected comments table, composite item/trip foreign
key and pagination indexes. All comment writes lock the trip before checking
membership, coordinating with item removal and access revocation. Cached
mutation retries recheck current permission; they cannot bypass revocation or
downgrades. Mutation responses retain IDs rather than comment bodies. Cursor
comparison stays inside PostgreSQL to preserve sub-millisecond timestamps.

The browser loads discussion on demand and refreshes on request or focus while
open. It does not add realtime infrastructure. Network retries keep their
idempotency key and failed writes retain the draft. Trip changes close stale
discussion views; permission failures clear loaded discussion.

## Validation

The isolated release suite passes 83 tests locally, with three pooled PostgreSQL
checks reserved for CI. New coverage includes membership boundaries, moderation,
revoked retries, cross-trip items/cursors, removed threads, timestamp-precise
pagination, content/rate limits, anonymous projections and the official MCP
client workflow. The pooled sharing test also exercises a comment write waiting
behind revocation on another connection.

Browser checks on fictional data cover posting, literal HTML display, item
threads, viewer read-only controls and a 390px phone viewport without horizontal
overflow. Hosted acceptance and deployment results are recorded after release.

On 15 October 2026, two hosted accounts verified editor invitation acceptance,
adding, editing, reordering and removing an item on the named fictional sharing
test trip. The organizer read back the editor's changes. No real itinerary was
modified. The temporary editor membership is retained only until the discussion
acceptance run, then revoked.

Proposals, approval workflows, voting, notifications and live collaborative
presence remain future work; this does not mark the full collaboration roadmap
complete.

## Release status — 15 October 2026

Implementation commits: `a5d284e` and final UI fix `c608f0f`.
[Final CI run](https://github.com/eddieyang-97/trip-planning-engine/actions/runs/38712376361)
passed all 86 tests with zero skipped, including pooled PostgreSQL checks.

The user started the Render deployment from their phone after Chrome
became unavailable. The comments build is now serving on the existing hosted
app. Public verification on 15 October 2026 confirmed:

- `/health` returned 200 with `status: ok`.
- Itinerary HTML includes the discussion dialog and composer.
- The hosted JavaScript exactly matches the tested `c608f0f` release bundle
  (SHA-256 `d89781335c48623c2ba3bb33a587f2cce9abccfe27910c3201e491e5f9c4c94a`).
- The browser demo renders successfully and hides discussion as intended.
- An unauthenticated discussion read returned 401; an invalid anonymous request
  with a tool-dispatch field returned 400.
- The existing connected MCP account successfully read the fictional itinerary:
  owner access, revision 6, one remaining original test item. This was read-only.

Render dashboard status and the exact deployed backend commit were not
independently inspected because the available in-app browser is signed out of
Render. The tested code checks migration 009 before startup; healthy startup
with this release is consistent with its migration completing.

**Still pending:** hosted organizer/editor comment exchange, moderation and
revocation on **Sharing test — fictional itinerary**. The temporary editor
membership must be revoked after that run. Posting was not verified through a
signed-in browser in this deployment check. The connector's current discovery
still lists the previous 23 tools, so the three new MCP comment tools require a
metadata refresh before use through that connection. Do not change real
itinerary data or grant new access to a real trip for acceptance.

The separate calendar-export work was excluded from the deployed `c608f0f`
release. That work subsequently merged into GitHub main (`abe6ba3`); the
verified hosted bundle still matches the comments release. No new services,
paid plans or provider searches were used for these deployment checks.
