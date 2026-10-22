# Architecture and accepted decisions

Updated 16 October 2026. This records accepted architecture for **Trip Planning Workspace**, not the latest deployment snapshot. The initial design was validated in release `f6f1670`, and later account, map, sharing, comments and calendar changes are documented in their dated feature guides. Repository/package/service identifiers remain `trip-planning-engine`. See the [PRD](prd.md) for target behavior and [delivery status](implementation.md) for acceptance evidence.

## High-level architecture

Recorded deployed design: one Free Render service, Supabase identity/storage, Brevo SMTP configured for account-confirmation emails, and an explicitly enabled SerpApi flight pilot. Web and MCP are equal product surfaces; the service owns permissions and saved facts. After SMTP repair, second-account email confirmation, sign-in, viewer joining and organizer revocation passed.

```mermaid
flowchart TB
    subgraph Clients["Two product surfaces"]
        Web["Web app"]
        Assistant["Assistant client"]
    end
    subgraph Render["One Free Render Node service"]
        API["Web API and account pages"]
        MCP["MCP adapter and token checks"]
        Core["Shared trip, itinerary and decision core"]
        Worker["Persisted job runner"]
        Adapter["Bounded flight adapter"]
    end
    subgraph Supabase["Supabase"]
        Auth["Auth"]
        DB[("Postgres")]
    end
    SerpApi["SerpApi"]
    Brevo["Brevo SMTP relay"]
    Inbox["User email inbox"]

    Web -->|"Direct-session bearer"| API
    Web -->|"Sign-up / sign-in / resend confirmation"| Auth
    Auth -->|"Auth email via configured SMTP"| Brevo
    Brevo -->|"Confirmation email; SMTP authentication failing"| Inbox
    Inbox -->|"User follows confirmation link to /account"| Web
    Assistant -->|"OAuth bearer / Streamable HTTP"| MCP
    Auth -.->|"Session verification"| API
    Auth -.->|"Signing keys / JWKS"| MCP
    API --> Core
    MCP --> Core
    Core -->|"Trips, evidence, revisions and grants"| DB
    Worker <-->|"Claim runs; persist attempts and evidence"| DB
    Worker --> Adapter
    Adapter -->|"Bounded supplier requests"| SerpApi
```

The account pages and Supabase Auth handle direct sign-in and assistant authorization; neither surface accesses application tables directly. The runner is part of the same Node process and can pause when the Free service sleeps. No additional host, separate worker or backend LLM is required by the current design.

Supabase Auth generates the confirmation email and verification link; Brevo relays the message. SMTP credentials are held in Supabase configuration. The Render service has no direct Brevo client or email job runner. Organizers share itinerary invitation URLs themselves; creating an invitation does not send an email. See [account email configuration](account-linking.md#account-email-delivery) and [sharing acceptance](itinerary-sharing.md).

## Core data overview

This is the durable core relationship overview, not an exhaustive representation of the latest schema. [Database diagrams and the migration-extension index](database.md) cover the initial 001–006 baseline and subsequent 007–011 changes. [Data semantics](data-semantics-review.md) records the underlying invariants and unresolved concepts.

```mermaid
erDiagram
    TRIPS ||..o{ DECISIONS : contains
    TRIPS ||..o{ ITINERARY_ITEMS : organizes
    TRIPS ||..o{ ITINERARY_EVENTS : records_history
    DECISIONS ||--o{ CRITERIA_VERSIONS : versions
    DECISIONS ||..o{ CANDIDATES : considers
    DECISIONS ||..o{ SEARCH_RUNS : searches
    CRITERIA_VERSIONS ||..o{ SEARCH_RUNS : freezes
    CANDIDATES ||..o{ OBSERVATIONS : has_evidence
    SEARCH_RUNS |o..o{ OBSERVATIONS : produces
    SEARCH_RUNS ||--o{ PROVIDER_ATTEMPTS : executes
    OBSERVATIONS ||..o{ SELECTIONS : supports
    CRITERIA_VERSIONS ||..o{ SELECTIONS : evaluates_under
    SELECTIONS ||..o{ BOOKING_RECORDS : records_outcome
```

A candidate survives repeat searches; prices belong to dated observations. A selection pins exact evidence and criteria. A reported booking is a separate outcome. Manual itinerary items share the trip but do not yet have durable links to research observations. See [user flow diagrams](user-flows.md) for the corresponding journeys.

## Decisions already made

| Area | Accepted direction | Current boundary |
| --- | --- | --- |
| Product surfaces | Web and hosted MCP are first-class interfaces to one account and trip workspace | Web has manual itinerary and saved research; the full web flight workflow remains to be delivered |
| Deployment | One Node service on the existing Free Render plan, plus Supabase for Postgres and account identity | No additional host, Redis, separate worker, paid upgrade or backend LLM is part of the current deployment |
| Account email | Supabase Auth uses Brevo Free custom SMTP with a verified sender; email confirmation remains enabled | The initial SMTP failure was repaired and a second-account confirmation and sign-in passed on 14 October; wider deliverability remains unverified. Invitation URLs are shared manually |
| Shared authority | The service owns permissions, durable state, evidence, constraints and deterministic ranking | Browsers and assistants present facts and request changes; conversation memory is not authoritative |
| First live source | Bounded generalized SerpApi flight discovery runs in the existing service (F1/F2 closed) | Live multi-origin return discovery and a later connected ChatGPT conditional selection/read-back passed; no single new-search-to-selection hosted pass, one-way client acceptance or independent Claude proof. Complete party/equipment quotes and booking remain unverified; see [#21](https://github.com/eddieyang-97/trip-planning-engine/issues/21) |
| Evidence | Candidate identity is separate from dated offer observations; criteria versions are immutable | Synthetic, user-reported and provider-reported facts stay distinct; unknown costs are never zero |
| Outcomes | Selection and user-reported external booking are separate records | No purchase, payment, passenger submission, cancellation or ticket servicing capability |
| Itinerary | Manual items organize the full trip before further provider integrations | Saved research prepares a tentative manual draft; durable research links/reconciliation remain future work |
| Apple Calendar export | One-off .ics snapshots of individual, all or selected saved itinerary items; one combined all/selection dialog | Deployed on 15 October; hosted demo and public boundary checks passed. Saved-trip/native iPhone/iPad acceptance remains pending. Two-minute file tickets recheck source access; no Apple account integration or subscription feed |
| Collaboration | Organizer owns shared itinerary decisions; signed-in editors can edit permitted fields, signed-in members can use discussion according to role, and anonymous links are read-only | Viewer/editor invitations, revocable anonymous links and comments are implemented; proposals, approval and full hosted real-friend editor/comment acceptance remain separate goals. Invitation management uses direct web sessions |
| Expansion | Manual/sourced accommodation and dining comparison can proceed independently of advanced collaboration | Live supplier integrations require their own evidence, data-rights and provider-access gates; standalone diagnostics do not constitute hosted integrations. Voting and proposals remain deferred |

These are chosen directions, not a declaration that every capability is complete. The original paid-host and MCP-first recommendations in the [October spike](spike/README.md) are historical.

## Service boundaries

HTTP/web, MCP, core and the runner share one deployment and one TypeScript package. Local development uses loopback authentication, PGlite and a synthetic fixture runner; hosted mode uses external Postgres and enables live work only with both the server flag and provider key. Hosted fixtures are disabled.

Transport adapters validate requests and establish identity. Core operations enforce ownership, applicable grants, idempotency and revision rules. `itinerary.ts`, `itinerary-research.ts` and `policies.ts` provide focused domain operations. `live-search.ts` owns admission, attempt persistence and recovery; `live-provider.ts` normalizes supplier meaning. `database.ts` owns adapters and migrations. Separate deployments require a demonstrated workload need.

## Accounts and authorization

Account identity is the verified Supabase user UUID, never an email match, chat identity or caller-supplied owner field. The browser uses a direct confirmed-account session. MCP uses asymmetric JWT validation for issuer, exact resource audience, expiry, client identity and stored grant version. Application read/write/search grants are separate from OAuth identity scopes. Search requires write plus explicit search consent.

Direct web operations use a server-only allowlist and ownership checks; they do not create assistant grants. MCP rechecks stored permissions/version for each operation. Web writes require the exact Origin; account and itinerary pages have restrictive CSP and render user content as text. See [account linking](account-linking.md).

RLS denies direct browser/Data API access. The current privileged runtime connection can bypass RLS, so application ownership checks remain essential. Separate migration/runtime roles, abuse throttling and a common membership authorization model remain hardening work. Collaboration must apply trip roles to both surfaces and distinguish shared trip evidence from account-private policy notes and booking detail.

The numbered application migrations enforce that private-table boundary. A
[21 October investigation](database-security-2026-10-21.md) found that bootstrap
metadata `app_schema_migrations` lacked equivalent protection. The deployed
bootstrap fix enables RLS and revokes PUBLIC/browser grants on every migration
run, including current-version databases. Its local tests pass; the approved live metadata repair and private follow-up audit passed. Supabase's October 30 Data
API grant default does not require exposing tables used through direct Postgres.

## Persistent model and consistency

[The database ER diagrams](database.md) are the schema reference for keys and relationships. Supabase accounts are verified external identities, not a local users table or an enforced `auth.users` foreign key.

Money uses exact integer minor units and an explicit passenger/currency basis. Criteria changes append versions; later searches do not overwrite evidence or earlier selections. Candidate disposition survives repeat searches. Policy references pin exact versions and never establish offer-specific equipment entitlement or price.

Mutations carry idempotency keys; mutable decision, itinerary and policy updates also require the current revision/version. Locks and transactions serialize writes. Core reads use read-only repeatable-read snapshots, keeping revisions and related contents consistent. Airport-local evaluation and flight identity derive from reviewed airport zones; unknown zones remain unresolved. See [correctness fixes](correctness-fixes.md).

The repository now contains numbered migrations 001–011: editor roles (007), anonymous view links (008), item/trip comments (009) account profiles (010) and trip lifecycle (011) extend the initial 001–006 baseline. The [database reference](database.md) distinguishes the original ER snapshots from these extensions. Dated [delivery evidence](implementation.md) and [feature guides](README.md) determine what was verified in a particular hosted release; source presence alone is not deployment proof. JSONB stores validated snapshots alongside normalized ownership/version relationships. The larger schema/interfaces in `spike/design/` remain proposals. General typed output contracts, full history pagination, structured actual booking amounts, broader passenger/baggage modeling and broader provider-data retention still need implementation; trip deletion/retention is covered by the lifecycle extension below.

## Concurrency, consistency and scaling trade-offs

These are intentional **private-pilot choices**, not claims of real-time collaboration, linearizable external effects or measured production throughput. Preserve these guarantees when changing database access, web/MCP operations or worker behavior.

1. **Consistent reads, not latest-at-response-time.** Core reads use read-only PostgreSQL `REPEATABLE READ` transactions; revision, items, history and related evidence come from one snapshot. A read whose snapshot authorized access can finish after revocation commits; a *new* read must see the revocation.
   - **Trade-off:** Correct cross-query views can be briefly stale.
   - **Revisit when:** A verified user journey needs push updates or stronger revocation ordering; do not add read locks solely to force fresher results.
2. **Selective pessimistic writes, not blanket serializability.** Write transactions use PostgreSQL's default `READ COMMITTED` isolation with explicit row locks and constraints: trip mutations/sharing coordinate on the trip row, decision mutations on the decision row, and metered-admission on an advisory lock.
   - **Trade-off:** Less retry overhead than universal `SERIALIZABLE`, but every new writer must maintain lock ordering and protect any new cross-entity invariants.
   - **Revisit when:** A demonstrated write-skew bug or cross-entity invariant cannot be enforced cleanly with these locks and constraints.
3. **One trip-wide itinerary revision.** Competing item edits compare `expectedRevision` after taking the trip lock; a stale writer fails, even if it modifies a different item.
   - **Trade-off:** Simple, auditable history and no silent lost updates, at the cost of avoidable conflicts and manual reload/review.
   - **Revisit when:** Measured `REVISION_CONFLICT` rates or repeated user draft loss warrant per-item versions or a deliberate merge UX; never silently replay stale edits.
4. **Independent clocks for distinct concerns.** `itinerary_revision`, decision/criteria versions and account-profile revisions protect different write sets; comments and provider-run results do not universally increment the itinerary revision.
   - **Trade-off:** Unrelated activity does not invalidate itinerary edits, but an unchanged itinerary revision says nothing about comment, research or roster freshness.
   - **Revisit when:** A real multi-surface workflow needs a joined change feed or explicit workspace cursor.
5. **Idempotent mutations, not exactly-once external work.** `mutation_requests` keys plus request hashes deduplicate identical commands; a fresh key is a distinct command. The live runner records metered attempts before dispatch and marks ambiguous/lost acknowledgements `outcome_unknown`, without auto-replay.
   - **Trade-off:** Favors integrity and spending limits over guaranteed supplier-job completion.
   - **Revisit when:** Booking or payments require supplier idempotency, correlation, reconciliation, compensation and explicit recovery.
6. **Small shared capacity and process-local utilities.** The hosted PostgreSQL pool allows **five connections per process**; multi-query reads hold a connection and same-trip writes queue on its row lock. Web freshness is refresh-driven, not push-synchronized. Calendar tickets and some HTTP rate counters live in process memory.
   - **Trade-off:** Minimal infrastructure, but contention and single-instance assumptions; tickets do not survive process restarts and per-process limits are not global.
   - **Revisit when:** Measured p95 latency, pool waits, conflict rates, demand for live updates or a planned multi-instance rollout justifies shared admission/tickets and stronger coordination.

**Evidence boundary:** Controlled [pooled PostgreSQL read](../tests/read-consistency.test.ts), [sharing](../tests/sharing-postgres.test.ts) and [admission](../tests/live-admission-postgres.test.ts) tests exercise selected interleavings, not throughput. The [database adapter](../src/database.ts), [itinerary service](../src/itinerary.ts), [core](../src/core.ts) and [live runner](../src/live-search.ts) implement these choices. Observe the [quality/scale readiness gates](prd.md#10-quality-and-operating-requirements) before broadening traffic or enabling consequential external effects.

## Live execution and pilot limits

Releases retain the same service and database. The reviewed worker baseline has a verified manual release; service-level CI-gated activation is tracked separately. Blueprint auto-sync stays off so configuration changes are manually applied only after green main CI. Public health can include a validated Render commit SHA and the startup-checked schema version, alongside the database readiness check. Shutdown stops local worker ticks and signals active live work: no further supplier dispatch, abort fetch/body waits, then persist partial observations and conservative unknown outcomes before HTTP/DB cleanup. A 25-second cleanup deadline leaves margin inside the Free service's default 30 seconds; custom shutdown allowance is rejected. If persistence stalls or the process is killed, leases and journals remain authoritative. The interruptible worker is reviewed and manually deployed/verified; the activation change requests `checksPass`, with applied settings and automatic-release evidence tracked in #14. Forced termination still recovers conservatively from durable leases/attempts. See [guarded releases](releases.md) for migration compatibility, rolling overlap, pause/recovery and actual activation evidence. No post-deploy check is allowed to block the same CI gate while waiting for its deployment.

`start_search` persists a run and reserves three request slots before returning its ID. Current allowances are two runs per owner per rolling day, four globally per rolling day and twenty globally per rolling 30 days. Admission and worker concurrency are serialized in Postgres. These are configured pilot ceilings, separate from supplier quota and standalone diagnostic usage.

One live job runs at a time. Each potentially metered request has a committed attempt before transmission; permissions/version are checked between stages and before saving. Requests time out after 30 seconds; the lease is three minutes and queued jobs expire after one hour. Interrupted running work becomes `outcome_unknown` and is never automatically resent. Fixture lease recovery remains separate. See [the flight guide](hosted-live-search.md) for exact behavior and rollback.

The runner progresses while the Free Render process is awake; saved work can pause during sleep. Startup/timer recovery uses durable state, and polling never initiates another supplier search. The pilot promises persistent status and conservative recovery, not always-on progress or exactly-once external requests.

The deployed generalized adapter uses one combined origin-airport query for returns, then at most two outbound return expansions within the same three-request ceiling. One-way plans query up to three individual origins in saved order and disclose budget omissions. Admission stores the versioned plan in run coverage JSONB; each attempt commits sanitized query scope with its ledger intent before I/O. Reads reconcile scope with authoritative attempt status and project per-pair coverage. Known independent failures allow later planned queries; unknown outcomes stop without replay. Legacy queued runs without a plan keep combined scope. Unused reserved slots remain charged to local allowance. Up to 20 itinerary observations retain observed price, schedule and source restrictions; seller and fare family remain unverified. No seller endpoint or exhaustive return-airport sweep is added. Cached time-zone formatters and bounded offset resolution preserve ambiguous-time rejection; normalization yields every eight results. Response echoes normalize documented defaults/numeric forms while preserving material scope checks and explicit outbound binding for return prices. Supplier completion is separate from bounded result-validation diagnostics; unusable results never become observations. Unknown party-price basis, equipment, expiry and bookability stay visible even when a run completes. Bounded multi-origin return discovery and subsequent persisted ChatGPT conditional selection/read-back passed on 22 October. One-way client metadata, a single complete hosted journey and Claude acceptance remain unverified (see [the flight guide](hosted-live-search.md) and [#21](https://github.com/eddieyang-97/trip-planning-engine/issues/21)). Broader storage/redisplay rights, retention enforcement and exact supplier quote checks remain separate limits, without claiming new rights from this code change.

One-way criteria use `inbound:null` (or omitted); observations use an empty inbound leg. Existing return snapshots remain unchanged. A pinned MIT IATA/time-zone catalogue extends the original reviewed overrides; unknown/ambiguous airport mappings fail live admission. Candidate keys reconcile lazily against existing immutable observations when catalogue coverage changes, preserving IDs/disposition/history or stopping for ambiguous identity review. No SQL migration, quota increase, OAuth change or extra service is required. Older code cannot evaluate one-way snapshots: disable live admission before a rollback and roll forward with compatible readers; do not rewrite/delete observations. See the [flight guide](hosted-live-search.md).

## Organizer and next milestones

Decision read-back is self-contained for the current selection: `get_decision` and `get_trip` project its stored rationale/evaluation, original criteria version and pinned observation independently of recent-evidence pagination. A changed criteria version is flagged, never silently applied to the frozen selection. This adds no stored concept or migration and retains owner-only research authorization and read-snapshot isolation. Candidate shortlist disposition remains separate from selection rationale and booking records. HTTP SDK discovery and conditional ChatGPT selection/read-back have been tested; connected client schemas still need one-way refresh/verification, and Claude remains independently untested ([#21](https://github.com/eddieyang-97/trip-planning-engine/issues/21)).

The organizer maintains manual flight, accommodation, transfer, activity, restaurant and note items, with tentative/reported-booked labels and change history. The saved-research projection uses the same read snapshot and bounds decisions, recent observations and pinned outcomes. Reviewing a flight opens a draft; saving creates/updates a manual item. The draft is a snapshot, not a durable research link or automatic update.

Complete the organizer foundation across web and MCP: direct web flight controls, honest comparisons, explicit research links/reconciliation and actual edit continuity. Viewer/editor invitations, anonymous view links and member discussion now have implementation and dated acceptance evidence; hosted acceptance varies by user journey. Later proposals and organizer approval remain conditional. Preserve history and private-booking visibility rules. These capabilities do not themselves require a new provider or additional infrastructure.

Calendar export serializes the saved itinerary into iCalendar (.ics) files using one exporter for the individual action and combined all/selection flow. It reuses existing trip read permissions and privacy projections without mutating trip state. A bounded in-memory ticket grants access to one frozen file for two minutes; delivery rechecks the original authenticated session or view-link access. Native Calendar can follow that file URL without receiving the web bearer header. Text/calendar delivery preserves known instants and exclusive all-day ends. No database schema or additional service is needed. Apple account integration, subscriptions and synchronization are outside this slice. See [calendar requirements](prd.md#calendar-export), [implementation and access details](calendar-export.md) and [earlier device evidence](apple-calendar-probe.md); the deployed release is documented in [hosted release evidence](release-calendar-comments-2026-10-15.md), with saved-trip/native acceptance still pending.

Outstanding operating work includes least-privilege database roles, throttling, bounded public output contracts, consent recovery, retention/deletion/export, telemetry and backup/restore. [Delivery status](implementation.md) distinguishes completed proof from remaining acceptance; the [architecture review](architecture-review.md) preserves the original findings.


## Trip lifecycle extension - 16 October 2026

Migration 011 and the [trip lifecycle guide](trip-lifecycle.md) add owner archive/restore, confirmed permanent deletion and personal membership exit. Archive preserves sharing. Delete physically removes the trip graph and clears scoped cached response content; minimal tombstones/retry guards prevent resurrection. A quota-only reservation ledger survives deletion so live allowance cannot reset.

The lifecycle revision is a separate whole-workspace review clock; content/access changes and worker state changes advance it. It does not replace or broaden itinerary edit conflicts. To enforce deletion across research and provider writers, mutations now lock the trip before decision/run/item rows; live admission/claim take the existing advisory admission lock first, then trip and child locks. Recovery uses root-before-child ordering too. This deliberately serializes same-trip writes for the private pilot while preserving READ COMMITTED writes and snapshot reads. No lock spans supplier I/O. An admitted request may finish after deletion, but no further stage or evidence write can use the deleted trip. The controlled [delete/editor race](../tests/trip-lifecycle-postgres.test.ts) supplements the existing concurrency evidence; no throughput claim is made.

Confirmation tokens are hashed, short-lived, one-use and bound to the exact account/client/action/revision. MCP requires host-enforced explicit user confirmation and destructive tool annotations. See the feature guide for backup limitations, retained metadata and forward recovery; an old worker must not resume live admission against a post-deletion database.
