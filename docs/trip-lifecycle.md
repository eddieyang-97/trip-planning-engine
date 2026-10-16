# Trip lifecycle - 16 October 2026

## Product behavior

The owner can archive, restore or permanently delete a trip through the web app
and a write-authorized MCP client. An invited viewer/editor can leave only their
own membership. Represented travelers and anonymous visitors are not memberships.
These actions never contact a supplier or cancel an external reservation.

**Archive** changes organization, not access. Active discovery omits archived
trips; Active / Archived / All filters exist on web and MCP `list_trips.status`.
Archived trips retain their itinerary, research, booking reports, discussion,
history, invitations, membership and editing access. An archived banner appears
when opened, including through an existing view link. Restore returns the trip
to Active. Opening it or passing its end date never restores/archives it.

**Delete permanently** is a secondary owner-only Trip options action on active
or archived trips. Review shows the exact trip ID, name and dates, affected
record counts, sharing effects and retention limitations. The web button stays
disabled until the exact trip name is entered. Cancel changes no trip content.
`prepare_trip_action` creates a ten-minute, single-use confirmation bound to
trip, account, client, action and current lifecycle revision. `delete_trip`
requires that token/revision, exact name and `confirmed: true`. MCP descriptions
require explicit human confirmation of the displayed trip and consequences;
destructive annotations tell the host to apply its confirmation policy. The
boolean is a client assertion, not cryptographic proof of human approval.
Lost/expired/stale reviews require a fresh preparation and a new idempotency key.
Tokens are hashed in storage and omitted from cached mutation responses.

**Leave trip** uses the same explicit-review pattern. It revokes only the caller's
membership and its account invitation. Shared contributions and their historical
authors remain, other people retain access, and rejoining needs a fresh owner
invitation. The owner cannot leave. An independently held anonymous view link
retains its existing read-only scope. A replay of an old leave after rejoining
cannot remove the new membership.

## Storage, authority and concurrency

Migration 011 is additive: archive actor/time and `lifecycle_revision` on trips;
trip association on mutation receipts; hashed action confirmations; minimal
deleted-trip tombstones; and a quota-only live-search usage ledger. Existing
trips start Active at lifecycle revision 1. Existing create-trip and identifiable
child mutation receipts are associated with their trips; existing live-run
reservations are copied to the usage ledger. No existing trip is archived or
deleted by migration. New tables have RLS and no public/anon/authenticated grants.

The lifecycle revision protects destructive review of the whole workspace. Trip
content/access mutations and worker claim/result/attempt changes advance it;
preparing a review does not. It supplements the existing itinerary, decision,
criteria and profile clocks. Comments/research still do not invalidate unrelated
itinerary item edits. Archive/restore use expected lifecycle revision. Permissions
and client grants are checked on execution and retries.

All trip writes coordinate on the trip row before child rows. Live admission and
claim use admission advisory lock -> trip -> child; recovery follows the same
root-first ordering. No database transaction spans a supplier network request.
Deleting a trip removes queued/running run records, so subsequent stage admission
or result persistence cannot proceed. A request already admitted/in flight may
complete and consume quota; deletion cannot recall it. No automatic charged retry
is introduced. Read-only repeatable-read snapshots remain: an already-authorized
read can finish after deletion, but a new read must deny access.

## Deletion and retention policy

In one transaction, confirmed deletion physically removes the trip and its
itinerary items (including removed ones), edit history, comments, invitations,
memberships, decisions, criteria versions, candidates, observations, selections,
booking records, search runs, attempt diagnostics, policy-selection references
and outstanding confirmations. Trip-associated cached mutation response content
is cleared. Subsequent direct/member/anonymous reads fail; pending calendar
delivery rechecks the source and is denied. In-memory calendar bytes expire under
their existing two-minute lifetime. Downloaded copies cannot be recalled.

Account profiles, reusable account-private policy notes, other trips and other
accounts remain. Minimal UUID tombstones and request keys/hashes are retained
without an expiry to prevent old requests recreating deleted resources. They
contain no trip title, itinerary, prices or notes. Search quota reservations retain
only random reservation ID, requesting account ID, reserved request count and time;
they count for rolling 30-day admission even when the trip was deleted. Expired
quota rows are removed on the next admission, so idle deployments can retain
expired counter metadata longer. Deletion is not a quota refund.

Deletion covers the active application database. Provider backup purge timing is
not guaranteed in this pilot and is disclosed before confirmation. No deletion
claim is made for supplier systems or information someone already copied. An
account erasure process and a verified backup expiry/restore policy are separate
operating work.

## Deployment and forward recovery

Use the existing Free Render/Supabase deployment with migration-on-start; no new
provider, credential, scope, host or paid plan. Keep migration 011 when rolling back
code. After quota ledger activation, do not run an older live-admission worker
that accounts only from search_runs: pause live search first or forward-fix the
service. An old worker does not honor the new deletion lock ordering. The new
code and migration must deploy together on the single instance. Database schema
rollback cannot restore data removed by a confirmed delete. Restoring an older
database backup could resurrect records; backup recovery requires a reviewed
deletion-tombstone reconciliation before reopening access, and is not automated.

## Verification

Production build and full local suite pass: 117 tests, 113 passed, four external
PostgreSQL checks reserved for CI. Focused tests cover upgrade/backfill, archive
sharing preservation, owner/grant isolation, exact client-bound review, expiry,
stale revisions, full relational deletion, cache sanitization/non-resurrection,
leave/rejoin, retained contributions, outstanding calendar/link denial and an
in-flight stubbed provider with quota preservation. A controlled pooled PostgreSQL
test races deletion with an already-started editor save. All provider sends are
stubbed and all trips/accounts are fictional.

Browser acceptance and hosted deployment evidence are recorded below when complete.
Real trips are never deleted to verify the feature.


### Local browser and transport acceptance

A fictional owner archived its trip, saw it disappear from Active, opened it from
Archived with the retained itinerary/roster and restored it to Active. Delete review
showed exact identity and counts; blank/wrong names disabled the final button,
the matching name enabled it, and Cancel preserved the trip. At requested 390x844
phone width the dialog and confirmation controls fit a 375px document without
horizontal overflow. Browser permanent deletion was not submitted. A second
fictional account saw only Leave trip for the shared itinerary, confirmed leaving,
and lost that shared trip while keeping its own trip. No browser warnings/errors
were recorded. The SDK transport exercised archive/restore/confirmed deletion,
idempotent delete retries, post-delete denial and preservation of account policy
notes. No real trip/account was modified and no live provider request was issued.
