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

<a id="validation"></a>
<a id="release-status--15-october-2026"></a>
## Verification boundaries and historical release

Isolated backend/PostgreSQL and browser regressions cover roles, author privacy,
revoked retries, cross-trip access, pagination, limits, plain-text rendering
and editor/viewer behavior. These fixtures do **not** establish a real-account
hosted comment exchange or moderator/revocation acceptance.

The initial 15 October comments deployment had a separately verified public
frontend and guarded unauthenticated routes, but its original checks did not
independently verify a signed-in hosted comment exchange or Render backend SHA.
The later combined [calendar/comments hosted release](release-calendar-comments-2026-10-15.md)
and [original comments CI](https://github.com/eddieyang-97/trip-planning-engine/actions/runs/38712376361)
retain dated evidence. Their then-pending client tool refresh and test-editor
revocation are **historical action items**, not proof of today's client/tool state;
verify any outstanding fictional-test membership before considering it resolved.

Proposals, organizer approval workflows, voting, notifications and live
collaborative presence remain future work. This discussion feature does not
mark the broader collaboration roadmap complete.
