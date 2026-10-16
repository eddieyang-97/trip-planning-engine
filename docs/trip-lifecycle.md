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

Browser acceptance and hosted deployment evidence are recorded below.
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

### Release CI — 16 October 2026

Code commit `ea1c7c582932067f313512248bd66e23448559f4` passed
[GitHub Actions run 38965043166](https://github.com/eddieyang-97/trip-planning-engine/actions/runs/38965043166):
117 tests passed, zero failed and zero skipped, including the controlled pooled
PostgreSQL editor/deletion race and the existing admission, sharing and snapshot
checks. `npm run check`, `npm run build` and the local full suite passed in the
isolated release worktree (113 passed; four external PostgreSQL checks skipped
locally). This CI run used synthetic accounts and stub providers.

The rollout first redeployed the previous `7b48098` application with
`LIVE_SEARCH_ENABLED=false` and checked the public health response before migration.
The disabled deployment is `dep-db98v22fngtc739bc8rg`. The default old-instance
shutdown window is 60 seconds before SIGTERM plus 30 seconds to force termination,
per [Render's deployment sequence](https://render.com/docs/deploys); the Blueprint
does not override that default. The migration deployment waits beyond that window.
This avoids overlapping the old quota accounting and child-first worker locks
with the new lifecycle code. Live search is restored only on the new application.

### Hosted release — 16 October 2026

The exact tested code commit `ea1c7c582932067f313512248bd66e23448559f4`
was deployed paused as `dep-db9908opd3as73bd1vp0` (53.9 seconds), then redeployed
with its original live-search flag restored in
[Render deployment dep-db99167f3r2c73aj805g](https://dashboard.render.com/web/srv-db3t3iub7d7c739hfad0/deploys/dep-db99167f3r2c73aj805g)
(54.6 seconds). The final dashboard shows Live at commit `ea1c7c5`; startup logs
show the hosted live pilot enabled. Successful hosted startup requires migration
011 to be present. Health returned 200 with `status: ok` and `liveSearch: true`
at 21:02 UTC. Account and itinerary pages returned 200, and deployed account JS/CSS
and itinerary JS/view CSS match the locally tested production build after newline
normalization.

Unauthenticated same-origin requests to prepare, archive, restore, delete and leave
all returned 401 with `Cache-Control: no-store`. The hosted synthetic demo rendered
Overview, Details and Map controls, with lifecycle actions/discovery filters hidden
and no browser warning/error recorded. This verifies deployment, protected-route
boundaries and public presentation; signed-in hosted lifecycle writes, friend-device
use and real-account destructive acceptance remain separate joint checks. No real
trip was archived/deleted, no actual invite was sent, and no provider request was
initiated for this release. Free hosting and existing auth permissions remain.

After migration, prefer a forward fix. If older code is needed, leave live search
disabled and drain newer workers before replacement; never restart old live workers
against the migrated ledger. Database/code rollback cannot undo a confirmed deletion.
