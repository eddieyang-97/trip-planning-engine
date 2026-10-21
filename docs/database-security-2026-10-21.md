# Database access hardening — 21 October 2026

## Scope and operational evidence

This change addresses [security issue #3](https://github.com/eddieyang-97/trip-planning-engine/issues/3).
The live catalog and Security Advisor were reviewed privately, the narrow metadata
repair was explicitly approved and applied, and the follow-up Advisor reported
zero errors. Raw findings, project identifiers, grants and screenshots remain in
private operational evidence, outside Git. This public guide does not establish
whether any historical access or tampering occurred; access logs were not audited.

The live repair is complete. Bootstrap protection is merged and deployed; CI and exact-commit evidence are recorded below.
No trip records, supplier calls, invitations, OAuth scopes or paid plans were changed.

## Bootstrap behavior

`src/database.ts` protects `app_schema_migrations` on every migration run. It enables
RLS, revokes table and version-column privileges from PUBLIC and conditionally
from existing `anon` and `authenticated` roles, and adds no policies or grants.
The owning migration connection retains access. Application account/role checks
remain mandatory because that connection can bypass RLS.

Protection runs after the existing advisory/table locks, before reading recorded
versions, within the same transaction. It covers fresh installations and existing
current-version databases without replaying numbered migrations. Schema version
remains 11. It changes no trip data, version rows, OAuth hook or project-wide defaults.
An older bootstrap would leave a fresh database unprotected; rolling back code
must never disable RLS or restore client grants.

For an explicitly approved immediate repair, the reviewed
[operational SQL](../scripts/harden-migration-metadata.sql) applies equivalent
protection to the public metadata table, with bounded lock/statement timeouts.
The [read-only catalog audit](../scripts/audit-data-api-permissions.sql) checks RLS,
PUBLIC table ACLs, effective browser table/column access and truncate privileges.
It reads no account/trip content. It is not an audit of views, functions, every
inherited role, policies, access history or the whole project.

## Regression evidence

Two tests reproduced the missing bootstrap protection before the fix. They cover
permissive default grants, legacy PUBLIC/browser table and column grants, denied
read/write/truncate operations, unchanged schema-version rows and a saved fictional
trip, repeated startup and an independent RLS backstop after re-granting CRUD.
The same fixture exercises the operational SQL. A fresh install must protect every
application table, including bootstrap metadata.

In the isolated security worktree, `npm run check`, `npm run build` and `npm test`
pass: 119 total tests, 115 passed, zero failed and four optional pooled PostgreSQL
checks skipped because no loopback test server is configured. These local tests
use synthetic data and fake providers. CI and real deployment remain separate
verification stages. The security worktree excludes concurrent flight-search edits.

After the approved SQL repair, public health/account/itinerary endpoints returned
200 and a read-only authenticated MCP trip-list request succeeded. An earlier MCP
request timed out; a retry after the health check succeeded. No supplier request
or real-trip write was made. This does not constitute every signed-in browser,
friend-device or collaboration workflow.

## October 30 compatibility

[Supabase's announcement](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)
says that from 30 October 2026 new public tables need explicit grants for the
Data/GraphQL APIs; existing grants remain and direct PostgreSQL clients are
unaffected. Trip Planner uses `supabase-js` for Auth sessions and the Node service's
direct PostgreSQL connection for application tables. The inspected application
has no direct table Data API consumer. Do not add `anon`, `authenticated` or
`service_role` grants merely to dismiss the announcement. A future direct Data API
feature needs its own reviewed access contract.

Remaining Advisor exceptions are recorded privately. No paid feature or unrelated
Auth setting was enabled. Existing PRD/calendar and flight-search drafts are outside
this release.

## Release verification

PR [#12](https://github.com/eddieyang-97/trip-planning-engine/pull/12) merged as
`51fdde97387253171a392473a3ce0c319307ed61`. Its application source matches the
tested PR head `251df9706de62128ed68a2df511882a611c6d842` exactly. CI
[39686697169, attempt 2](https://github.com/eddieyang-97/trip-planning-engine/actions/runs/39686697169/attempts/2)
passed all 119 tests with zero failures/skips, including all four pooled PostgreSQL
checks. The first attempt passed the new regressions and PostgreSQL checks but
crashed in native Node/V8 Wasm code while executing a lifecycle test. Re-running
the failed job on the same source passed; no tests were disabled or assertions
weakened. Local full-suite, type check and production build also pass as above.

The exact merged commit above is deployed. Hosted startup completed successfully
with migration-on-start and schema version 11; no numbered migration was added.
Public health returned 200 with status ok and the existing live-search flag true.
Account and itinerary pages returned 200; account JS/CSS and itinerary JS/view CSS
match the tested build after newline normalization. Private profile/lifecycle routes
still reject unauthenticated requests with 401/no-store. An authenticated MCP
trip-list read succeeded after deployment, without writes or provider searches.
The privately refreshed Advisor still reports zero errors; its separate remaining
exception is recorded privately. Deployment identifiers and raw operational evidence
are intentionally excluded from this public guide.

These checks establish startup, owner-connection compatibility, browser/API auth
boundaries and an actual MCP read. Full friend-device/signed-in-browser workflows
were not repeated for this metadata-only change. No new runtime source from the
parallel flight-search work was included in the deployment.
