# Architectural review — 11 October 2026

Reviewed repository baseline: `6b352e1`. Scope: product requirements, implementation and spike architecture; runtime modules; executable and proposed schemas; MCP and web interfaces; authentication and consent; flight, accommodation and places probes; deployment, build and tests.

The architecture is a sound research prototype. Keep one Node service, Supabase and a shared application core. The evidence/criteria/selection model is the strongest part of the design. The next work should address correctness and complete the existing boundaries before adding more providers or infrastructure.

This review distinguishes reproduced defects, risks inferred from implementation, and deliberate prototype gaps. It does not certify hosted OAuth, external PostgreSQL behavior or live provider access.

**Implementation follow-up, 11 October:** Findings 1–3 have subsequent fixes and regression tests documented in [correctness-fixes.md](correctness-fixes.md). The original findings below describe baseline `6b352e1` and are preserved as the review record. CI verified all 55 tests, including controlled pooled PostgreSQL concurrency, with none skipped. Findings 4–13 remain open or milestone-gated as described.

## Prioritized findings

### 1. High — Missing equipment costs can hide a known budget failure

**Reproduced defect.** `src/domain.ts:85–92` checks the budget only against a complete total. When the equipment fee is unknown, it ignores a known base fare that already exceeds the cap. The synthetic £620 party fare against a £600 cap, with the snowboard fee unset, produces `budget: unknown` and overall `conditional`. `src/core.ts:206–208` then permits selection with conditional acknowledgment. That turns a known hard-constraint failure into an uncertainty the user can acknowledge.

Calculate a trustworthy known subtotal and complete total separately. Fail the budget when same-currency, exact-party known costs already exceed it; leave it unknown only when the known subtotal fits and mandatory costs remain unresolved. Add the reproduced case to the domain tests. This is also an explicit requirement in `docs/prd.md:146`.

### 2. High — Flight dates, cutoffs and identity trust the timestamp's written offset

**Reproduced defect.** `src/domain.ts:31–36` accepts offset timestamps without airport time zones. Evaluation and identity use string slices at lines 66–81. An LGW departure at `2026-12-18T18:30:00+01:00` passes an 18:00 London cutoff, although its actual London time is 17:30. The parsed offer is reported eligible. UTC-normalized provider timestamps can likewise put a departure on the wrong local calendar date.

Store the flight instant and airport IANA zone, derive local dates/times from those fields, and use the derived departure date in identity. Require reliable airport-zone normalization at the provider and manual-evidence boundary. Test UTC inputs, overnight travel and daylight-saving transitions. For manually entered itinerary wall times, retain their different semantics and explicit unknown zones; do not force an inferred instant.

### 3. Medium — Multi-query reads can return revisions and contents from different commits

**Implementation-derived risk, not reproduced against external PostgreSQL.** `src/database.ts:40` begins an ordinary transaction. `get_itinerary` reads the trip revision and then items/history without a read lock (`src/itinerary.ts:39–43`). If another connection commits an edit between those statements, the response can contain revision N with items from N+1. `get_decision`, `get_trip` and search-run reads have similar patterns. Embedded tests serialize access through one PGlite instance and do not validate the hosted pool's interleavings.

Define snapshot consistency for read operations: a read-only repeatable-read transaction, one statement, or an appropriate aggregate lock can provide it. Keep existing write locks and revision checks; stale revisions already prevent silent overwrites. Add external PostgreSQL tests with two connections and controlled barriers. PostgreSQL documents statement-level snapshots under its default isolation in [transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html).

### 4. High before live search — The implemented provider boundary is fixture-specific

**Deliberate prototype gap.** `src/providers.ts:3–6` allows only `id: 'fixture'`; migration 001 permits only fixture runs and synthetic/user-reported observations. `src/core.ts:231–257` retries expired fixture leases, has no attempt ledger or provider deadline, persists results as synthetic, and commits the entire response or none of it. It also truncates at 20 offers without independently adding a truncation flag to coverage. Hosted mode runs no worker (`src/main.ts:54`).

The richer proposal in `docs/spike/design/provider.ts` covers many of the needed concepts, but it is not executable. Before enabling a supplier, implement atomic request-budget reservations, attempts, timeouts/cancellation, adapter/query versions, provider provenance and identifiers, partial coverage, explicit truncation, and ambiguous-outcome reconciliation. Test crashes immediately before/after sending and stale-generation completion. Never enable a paid adapter by changing the fixture enum and reusing its automatic recovery behavior.

### 5. High before collaboration — Membership and visibility need one authorization design

**Milestone gap.** Ownership is checked directly in several modules (`src/core.ts:42–49`, `src/itinerary.ts:39`, `src/policies.ts:43–49`). Web calls use an authenticated, allowlisted entry point that bypasses assistant client grants (`src/core.ts:72–80`). That is appropriate for the current owner-only surface, but there is no common representation of trip membership or permissions for friends. The committed next milestone in `docs/prd.md:177–188` includes invitations, roles, comments and proposals.

Define a principal with verified account and authentication surface. Apply assistant grants where relevant, then trip roles and operation permissions consistently in the core. Specify projections for account-private policy notes and private booking detail rather than making every owner's associated record visible to trip members. Add expiring, hashed invitation tokens redeemed after sign-in, revocable memberships, proposal state transitions and atomic approval with revision checks. Introduce item revisions if unrelated edits should not invalidate a proposal; retain a trip revision for consistent views. Test every read and write from both surfaces for organizer, collaborator, viewer, revoked member and unrelated account.

### 6. Medium — Repeat comparison silently chooses among ambiguous fare matches

**Implementation-derived risk.** `src/core.ts:141–146` maps observations to one previous observation per candidate/seller/fare/party/equipment key. Multiple observations sharing that key overwrite one another. They are read in UUID order, so the selected baseline is unrelated to price or time. Fare is a free-text label, and the runtime offer schema has no structured cabin, fare conditions or provider offer identifier. It cannot establish the detailed equivalence promised in the PRD.

Version candidate identity, require an explicit carrier/flight identity or provider-scoped fallback, and normalize fare equivalence separately. When a comparison key has multiple incompatible matches, return ambiguity instead of one price delta. Test duplicate keys, same-named fares with different conditions, and changed schedules. Preserve candidate disposition independently of whichever offer was returned.

### 7. Medium — Several promised decision facts cannot be represented

**Requirements gap.** The current criteria expose only cost-versus-duration weighting, one outbound cutoff, adults and snowboard fields (`src/domain.ts:12–27`). The PRD specifies importance levels for cost/timing/duration/stops, more time windows, passenger composition and baggage. Disposition has no reason; booking records have no structured actual paid amount (`src/core.ts:25–27`, migration 001). Evaluation has an algorithm version but no evaluated timestamp or metric contribution breakdown (`src/domain.ts:103–106`).

Reconcile requirements with the supported prototype contract explicitly. For the flight slice, prioritize passenger/baggage basis, required time windows, persistent rejection reasons, actual booking money, and reproducible evaluation metadata. Preserve versioned preference settings and expose contributions before expanding scoring. Unsupported requirements should stay visible as unsupported rather than only becoming freeform assumptions.

### 8. Medium — Freshness depends entirely on a supplied expiry

**Design gap.** `src/domain.ts:93` treats every offer without supplier expiry as unknown freshness. The flight probe intentionally reports `expiresAt: null` (`src/serpapi-probe.ts`). A manually supplied far-future expiry, conversely, is treated as sufficient for the freshness check. There is no adapter-owned age policy, retrieval timestamp or distinction between supplier expiry and a research recheck deadline.

Keep supplier expiry nullable. Add provider-specific observation-age policy and return source observation time, retrieval time, policy evaluation time and recheck status separately. Preserve manual provenance and make clear that recency does not establish bookability. Do not invent a supplier expiry to force a provider result into the eligible group.

### 9. Medium — Typed inputs are not matched by stable, bounded outputs

**Implementation-derived scaling and contract risk.** `src/app.ts:42–53` registers input schemas but no output schemas. Core results use `Record<string, any>` and return database rows. `get_trip` returns all decisions and booking records and runs queries per decision, selection and policy reference (`src/core.ts:113–125`). Decisions and bookings have no aggregate limit. A large trip can occupy one of the five database connections for a long time and generate a large MCP response.

Define runtime output schemas and derived types with a response version, timestamps, stable application field names and errors with safe next actions. Paginate decisions, bookings and history; make summaries compact and fetch full evidence explicitly. Batch related queries. Keep JSONB for validated snapshots where useful, while separating database rows from the public contract. A second deployment or monorepo is unnecessary for this work.

### 10. High before wider access — Isolation depends on a privileged application connection

**Known hardening gap.** Migration 001 enables RLS with no application policies, and current documentation states that runtime uses a privileged connection that bypasses RLS. Ownership checks are present; this review found no demonstrated cross-account bypass. Nevertheless, a future missed predicate would not be caught by the database. Migrations and runtime also share the database capability in startup (`src/main.ts:29–30`).

Specify separate migration and runtime roles with least privileges. Choose and test either tenant-context RLS for server transactions or tightly controlled database entry points, while keeping direct browser/Data API access denied. Implement bounded request admission and account/client quotas before broad access; body limits alone do not bound valid requests or pool waiters. Do not relax signature, resource-audience or grant-version checks to make OAuth acceptance pass.

### 11. Medium — Deletion and retention have no executable lifecycle

**Requirements and provider-integration gap.** `docs/prd.md:272` requires trip deletion and retention. There is no deletion API, retention deadline or cleanup job in the executable migrations. Foreign keys generally prevent parent deletion until child records are handled. Private content is duplicated in selection evaluation, itinerary before/after history and idempotency responses; deleting an observation or itinerary item alone would leave copies.

Design a transactionally ordered deletion/export workflow and a provider retention policy before storing live evidence. Enumerate all copies, including mutation responses and backups. Distinguish expiry for evaluation from deletion/redaction for retention. Preserve only permitted decision history when evidence is redacted, and return that state explicitly. Define idempotency retention so cleanup does not silently change retry guarantees.

### 12. Medium — Consent's external side effect lacks a durable recovery state

**Known distributed-operation gap.** `src/accounts.ts:90–103` holds a transaction and consent-row lock while making the upstream consent call. Upstream success cannot be rolled back if local commit or redirect validation fails. First-time approval fails closed locally, and the docs correctly describe manual recovery. For an existing connection, rollback retains its previous grant rather than necessarily leaving access denied. There is no durable state that distinguishes unsent, sent, upstream-approved and locally-committed attempts.

Before relying on this flow beyond the private proof, persist consent attempts and document recovery/compensation for each failure boundary. Keep network work outside long-lived database locks where possible, and finalize grants atomically only after verified approval. Test lost responses, commit failure, reconnection with an existing grant and consent/revocation interleavings. This finding does not invalidate the existing token and grant checks.

### 13. Medium — Hosting, operations and architecture documents disagree on guarantees

**Design/documentation gap.** `render.yaml` selects Free compute; the spike architecture describes an always-on paid service and periodic lease sweeps. Current hosted code deliberately disables searches, so this is a future execution mismatch, not a demonstrated lost hosted job. Render documents Free service spin-down after 15 minutes idle and restart on incoming traffic in [Free service limitations](https://render.com/docs/free). A timer alone cannot promise progress while that service sleeps.

For the authorized free prototype, state that work progresses only while the service is awake, persist pending state and recover on startup. Any stronger execution promise needs an explicit hosting decision later. Record current architecture and accepted decisions in one authoritative document; mark the spike as historical. Add structured logs/metrics for requests, authorization failures, jobs, budgets and latency, plus backup/restore and additive migration rollback procedures. Health currently verifies database access, not OAuth or provider readiness; retain that distinction. Real hosted OAuth and external PostgreSQL acceptance remain required.

## What should stay

- One application deployment and a modular core shared by web and MCP.
- Immutable criteria and observations; selections pin exact evidence and evaluation.
- Explicit synthetic/manual provenance, missing costs and incomplete coverage.
- Hard constraints before preferences, fixed utility anchors and score intervals.
- Database-backed idempotency, optimistic revision checks and transactional write locks.
- Separate selection, user-reported booking and supplier transactions.
- Separate private policy references rather than copying generic fees into quotes.
- Strict bearer/JWT checks, grant-version rotation, ownership checks, same-origin writes, CSP and text-node rendering.
- Bounded standalone probes that reserve attempts before requests and do not claim production integration.

## Recommended sequence

1. Correct budget/time evaluation and add regression tests. Define read consistency and test actual pooled PostgreSQL interleavings.
2. Establish current architecture decisions, typed/bounded contracts and the supported flight requirements. Complete hosted sign-in, OAuth, two-account isolation and web/MCP continuity acceptance.
3. Implement one live adapter with request budgets, durable attempts, safe recovery, provenance, freshness and retention. Validate exact-party and equipment semantics before a live-product claim.
4. Complete explicit research-to-itinerary links and reconciliation, then memberships, invitations, comments and proposals using common authorization and history rules. Expand accommodation/dining only after the relevant milestone acceptance.

## Validation

`npm run check` and `npm run build` passed. All 46 existing tests passed with the sandbox restrictions removed for the test run. The initial sandboxed run passed 42 and failed four: three localhost connections were denied with `EACCES`, and disk-backed PGlite aborted. All four passed on the unrestricted rerun, so they are not reported as application defects.

Separate direct calls to the existing domain functions reproduced findings 1 and 2. No live supplier requests, hosted sign-ins, external database mutations or deployments were performed. Application source and migrations were not changed; this review document is the only tracked addition.
