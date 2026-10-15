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

The browser extension disconnected before Render deployment. Comments are
pushed to GitHub but are **not yet verified live**. Resume by deploying the tested
`c608f0f0fcf8f48a41cd840870d9f0021394e8c2` commit to the existing service, then
verify organizer/editor comment exchange, moderation and access revocation on
**Sharing test — fictional itinerary**. The fictional editor item was removed;
the temporary editor membership still needs revocation after that run. Do not
change real itinerary data or grant new access to a real trip for acceptance.

The separate calendar-export work remains uncommitted and was excluded from
this release. No new services, paid plans or provider searches were used.
