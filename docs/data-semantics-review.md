# Data Semantics Review — Trip Planner

**Status:** working domain review, not an approved schema migration or implementation claim  
**Reviewed:** 16 October 2026  
**Scope:** semantic invariants that must survive UI, service, provider and database replacements; decisions to resolve before the relevant features are built.  
**Source of truth:** [Product requirements](prd.md) for intended behavior, [SQL migrations](../migrations/) for definitions present in source, [architecture](architecture.md) for accepted architecture, and [delivery status](implementation.md) for verified deployment/acceptance. This document is a **review register**, not a second implementation specification.

## 1. Principle and boundaries

**Preserve domain meaning and historical facts we are permitted to retain; allow their physical representation to evolve.** A stable ID, role, user report, provider observation or payment event must not silently acquire a different meaning because code or a schema was regenerated.

- Separate **identity**, **creation/attribution**, **current ownership**, **permission**, **travel participation**, **reservation state** and **financial settlement**. Do not overload one `user_id`, `status` or `amount` with multiple meanings.
- Prefer straightforward constraints, typed validations, versioned migrations and narrow domain contracts to speculative enterprise schemas or generic abstraction layers.
- Preserve a source, observation time, amount basis and verification level with consequential facts; explicitly record unknowns.
- History is not infinite retention. Protect private codes and traveler data; enforce supplier data rights, erasure, access controls and applicable retention periods.
- Physical table/JSONB layout, caches, ranking methods and supplier integrations can change. Core semantics and externally visible behavior require a migration/compatibility plan.

## 2. Status register (implemented source versus proposed domain)

| Concept | Meaning and invariant to protect | Status / evidence | Next decision |
|---|---|---|---|
| **Account identity** | Verified Supabase user UUID is the security principal; email, display handle and chat identity are not authorization IDs. | Implemented authentication architecture; no app-level FK to `auth.users` per [architecture](architecture.md#accounts-and-authorization). | Handle account deletion/recreation and attribution retention in privacy review. |
| **Trip** | Stable resource ID; current `owner_id` controls organizer authority. A creator/actor isn't automatically the current owner forever. | `trips(id, owner_id, payload)` in [001](../migrations/001_initial.sql). | Decide whether ownership transfer is supported and if creator must be stored separately **before** enabling transfer. No organization model now. |
| **Membership / invitation** | A member is a signed-in account authorized for a trip; a traveler is not automatically a member. Roles and revocation are trip-specific. | `itinerary_members`/`itinerary_invites` in [006](../migrations/006_itinerary_sharing.sql), editor role in [007](../migrations/007_itinerary_editors.sql), anonymous link mode in [008](../migrations/008_itinerary_view_links.sql). Source presence is not proof all migrations are deployed. | Specify precise owner/editor/viewer capabilities on web and MCP, role changes, member exit, historical attribution and reassignment. |
| **Participant** | A person represented in travel, room, activity or expense allocations, potentially without an account; needs identity across edits and name changes. | Participant-specific plans required in [PRD](prd.md#6-domain-model); no dedicated participant table is present in reviewed migrations 001–009. | **Before group logistics/expenses:** choose trip-scoped `participant_id` and optional account link; avoid using a display name as a primary identity. |
| **Itinerary item / edit** | Plan item belongs to a trip, not necessarily a research candidate. Removed item and edit history are distinct from deleting its trip or booking. | `itinerary_items` with `removed_at`, and `itinerary_events` with actor/before/after/revision in [004](../migrations/004_itinerary.sql). | Define retention/export/redaction for history and links when a participant leaves or a trip is deleted. |
| **Research decision / candidate** | A stable candidate is not a search result, an available offer or a booking; chosen/rejected disposition survives new research. | `decisions`, `candidates`, `criteria_versions` and `selections` in [001](../migrations/001_initial.sql). | Document identity/deduplication rules when suppliers rename properties or flight offers change. |
| **Observation / evidence** | Dated sourced assertion with cost basis, availability scope and provenance; a new observation must not rewrite a historical one. | `observations`, `search_runs` and selection references in [001](../migrations/001_initial.sql); live extensions described in [architecture](architecture.md). | Define allowed historical retention and deletion of raw supplier content versus permitted derived decision rationale. |
| **Booking / reservation** | A selection, click-through, booking request, user report and supplier-verified reservation are distinct. Booking alone never proves payment. | `booking_records` in [001](../migrations/001_initial.sql) currently constrains status to `user_reported_booked`; approved provider booking is future scope. | **Before booking integration:** normalize reported/verified and requested/pending/failed/cancelled states, source authority, confirmation retrieval and monetary meaning. |
| **Expense / repayment** | Actual paid expense, allocation owed, displayed estimate and reported repayment are different facts. | Planned only in [PRD](prd.md#trip-expenses-and-settlement-ledger-later-deliverable); no corresponding ledger schema in reviewed migrations. | **Before Trip Expenses:** stable payer/payee participant identities, currency, exact minor units, shares, adjustments, partial repayment and dispute semantics. |
| **Comments / author label** | Historical author ID records who acted; display names may change without changing authorship. | `itinerary_comments(author_id, author_label, author_role)` in [009](../migrations/009_itinerary_comments.sql); profile handle/avatar customization is separately planned. | Decide whether displayed historical labels are frozen snapshots or resolved from a current profile, and privacy behavior after account deletion. |

**Verification limit:** Reviewed repository files, not a live database schema dump or deploy logs. The architecture/database narrative sometimes describes migrations 001–006 while source includes 007–009; confirm which migrations were applied before marking later capabilities deployed.

## 3. Domain invariants to test

These are behavior contracts, not proposals for immediate new tables.

1. **Identity and authorization:** no access is granted by a displayed name, a represented participant or a client-supplied owner ID. Every protected read/write on web and MCP resolves verified identity and current trip permissions; anonymous links expose only allowed fields and can be revoked.
2. **Attribution:** current role/name changes or membership revocation do not silently rewrite the historical actor behind an edit, selection, comment, booking report or later expense adjustment. Privacy erasure may require deliberate redaction rather than indefinite retention.
3. **Trip boundaries:** an itinerary item, candidate, observation, booking and member must belong to the correct parent trip/decision. Cross-trip associations are rejected, including when links or IDs are guessed.
4. **Research integrity:** candidate identity, decision disposition, observed offers and selection rationale are distinct. A failed/new search neither replaces a previously selected option nor implies its availability or unavailability.
5. **Booking integrity:** opening checkout or selecting an option never marks it booked; a user report is visibly labeled as such; a supplier create timeout is pending verification, not permission to book twice. Cancellations/refunds do not erase reservation history.
6. **Financial integrity (when implemented):** a reservation is not an expense; an estimated total is not paid cash; split shares sum to the original actual amount under deterministic rounding; repayments are external reports unless independently verified; never net different currencies without an explicit conversion event.
7. **Concurrency and history:** versioned writes, transactions and idempotency prevent lost edits and duplicate mutations; soft removal is not equivalent to full erasure. Migration or code rollback must account for data already written under a newer contract.
8. **Privacy and data rights:** private traveler/confirmation fields never leak via anonymous/share projections. Retain only authorized supplier data; trip deletion, access revocation and legal erasure have distinct semantics.

## 4. Review decisions and proposed default positions

| Decision to resolve | Proposed minimal position | When needed |
|---|---|---|
| Who is creator versus current owner? | Keep current `owner_id` as owner; preserve `actor_id` in events. Only add immutable `created_by` and transfer history if ownership transfer becomes a product requirement; first check whether existing events can establish creation reliably. | Before implementing ownership transfer. |
| What uniquely identifies a traveler? | Stable **trip-scoped participant ID** independent of name and login, optionally linkable to an account. Explicit association, not automatic membership. Handle duplicate names and a participant who later signs up. | Before participant-specific imports, lodging/activity assignments and expense shares. |
| Does leaving a trip remove travel participation or history? | No automatic deletion of plan/expense history on role revocation. Revoke access independently; redact/erase personal information under documented retention and erasure rules. | Before member exit, transfer or full trip deletion. |
| What is the authoritative source of a booking? | Track `source = user_reported | supplier_verified` separately from reservation lifecycle; keep source evidence and verification time. Supplier claims need a verified adapter outcome; manual reports never upgrade themselves. | Before native booking APIs or general imported confirmations. |
| What is the meaning of booking `paid_amount`? | Distinguish quoted total, charged amount, deposit, refund and who actually paid. Do not silently treat a booking record as a complete financial ledger; note current SQL booking record only has booked time, note and report status. | Before enriching booking records or building Trip Expenses. |
| How does an expense link to people and bookings? | Optional links to itinerary/booking, but expense itself has stable ID, payer, allocated participants, currency, source/receipt, adjustments and repayment events. No automatic creation on selection or confirmation. | At Trip Expenses design gate. |
| What survives external evidence expiry? | Separate deletable/restricted raw supplier responses from permitted derived facts, local notes, sourced timestamps and selection rationale. Never promise indefinite provider-data retention. | Before adding stay/dining providers or automated import. |
| What does delete/archive mean? | Archive preserves the plan but changes its visibility/active status per product rules; trip deletion removes associated private records under a clear retention process and does **not** cancel external reservations. Define exceptions and user-facing warnings. | Before shipping archive/restore/delete. |

These are **review recommendations**, not approved changes to authorization policy or database structure. Decide them in feature design, add acceptance examples and only then migrate existing records.

## 5. Lean rollout and migration checklist

For every feature that introduces a durable domain concept:

1. **Name the invariant.** Record what the entity means, what it does *not* mean, its identifier, authority, relationships, state transitions and unknown values.
2. **Check information sufficiency.** Can old records be migrated deterministically? If not, choose an explicit `unknown`/user-review outcome; don't fabricate creator, payer or participant identity.
3. **Make additive changes first.** Version migrations; preserve older clients/JSONB payloads during rollout; backfill and validate before removing legacy semantics. A code rollback may require forward recovery rather than a database downgrade.
4. **Enforce where appropriate.** Keep foreign keys/unique/check constraints, transactionality and server-side authorization aligned with validated application contracts; do not rely solely on frontend controls.
5. **Test from both surfaces.** Exercise multi-account roles, anonymous projection, cross-trip IDs, repeat/idempotent operations, historical attribution, concurrency, retained user reports, and restore/export as relevant.
6. **Reconcile history and privacy.** Specify source rights, retention, cancellation/erasure and the impact of membership or ownership changes. Confirm production migrations applied and capture actual test evidence.
7. **Ship only the needed slice.** Do not introduce organization workspaces, enterprise RBAC, speculative participant hierarchies or a generalized ledger before their user journeys are validated.

## 6. Next review gates (not immediate build tasks)

- **Group logistics/import:** decide participant identity and account linking; test Center Parcs split departures and duplicate names; preserve Alba traveler subsets.
- **Profiles/members:** decide display-name history, creator/owner semantics, and how revocation/exit affects attribution.
- **Booking handoff/providers:** agree reservation lifecycle, source authority, quote-versus-charge, private confirmation fields and recoverable supplier timeouts.
- **Trip Expenses:** agree payer, shares, currency, refund/adjustment and repayment invariants; test an activity attended by only six of ten travelers.
- **Archive/delete/public beta:** agree erasure/retention, reversible operational migration and restore evidence.

**Decision rule:** invest in semantics whenever ambiguity could irreversibly corrupt or lose real history; defer physical abstractions until actual product behavior demands them.

---

**Pointers:** [Full PRD](prd.md) · [Database diagrams](database.md) · [Architecture](architecture.md) · [Implementation status](implementation.md) · [Migrations](../migrations/)  
**Maintenance rule:** update this review when a new durable concept is introduced or an invariant changes. Record implementation status and tested deployment evidence in the delivery docs, not here.
