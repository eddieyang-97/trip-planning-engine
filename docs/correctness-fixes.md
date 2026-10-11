# Decision correctness and consistent reads — 11 October 2026

This change addresses findings 1–3 of the [architecture review](architecture-review.md). The other findings remain separate provider, collaboration and operational work; this is not a production-readiness claim.

## Budget failures

Evaluation now returns `knownSubtotalMinor` separately from `totalMinor`. A trustworthy subtotal includes only matching-currency, exact-party amounts with a supported price basis and applicable equipment quantity. When that subtotal exceeds a hard budget, the offer is ineligible even if another mandatory component is unknown. When it fits but the total is incomplete, the budget remains unknown. Selection cannot override the known failure through conditional acknowledgment.

Arithmetic uses integers with a BigInt intermediate. Overflow remains an unknown display total, but cannot hide a known budget failure. The scoring/evaluation version is now `fixed-anchors-v2`; saved historical selections keep their original evaluation snapshot.

## Airport-local times and identity

Cutoffs, departure dates and new candidate keys derive local dates/times from the timestamp's instant in a reviewed airport IANA zone. Written offsets are no longer treated as proof of the airport's local clock. The current catalogue, `flaine-airports-v1`, deliberately covers LHR, LGW, LTN, STN, LCY and SEN (`Europe/London`), and GVA (`Europe/Zurich`). [IANA zone reference](https://data.iana.org/time-zones/tzdb/zone1970.tab).

Other airports remain usable as unresolved evidence: airport-zone checks and applicable local date/cutoff checks stay unknown. New supplied zone fields must match the catalogue; arbitrary caller-provided zones cannot make an unsupported airport pass. Broader routes need reviewed mappings, not an inference from a fixed UTC offset. Unknown-zone identity uses the normalized instant as an explicit provisional fallback and therefore does not promise stable matching across schedule changes.

Newly saved observations include departure/arrival IANA zones where known. Existing immutable payloads are not rewritten; evaluation resolves their airport zones through the same catalogue. Candidate keys are versioned. On encountering legacy keys, the writer reuses an existing candidate only when its observations yield one unambiguous corrected identity. It retains the candidate ID, disposition and all observation/selection/booking references. Conflicting legacy matches stop with `IDENTITY_REVIEW_REQUIRED` rather than merging history or silently creating another match. Catalogue expansion will need an explicit identity-version migration plan for previously unresolved airports.

Manual itinerary wall times retain their existing, separate semantics. No instant or time zone is inferred for an undated or zone-unknown manual entry.

## Consistent reads

Every read-only Core operation, whether called through MCP or the web, uses a read-only repeatable-read transaction. Trip revisions, items, histories, decisions and related evidence therefore come from one transaction snapshot. Existing writes continue using their transaction locks, idempotency and expected-revision checks. This change does not add automatic write retries or alter provider request behavior.

Authorization is evaluated within the snapshot at request start. An already-authorized in-flight read may finish while a revocation commits; the next request sees the revocation. Production PostgreSQL continues to require verified TLS. The pooled adapter is shared with tests without adding a production option to disable TLS. [PostgreSQL isolation behavior](https://www.postgresql.org/docs/current/transaction-iso.html).

## Validation

The local build and 54 tests passed; the pooled PostgreSQL check is skipped locally because no loopback PostgreSQL server is installed. Regression cases cover the two reproduced bugs, incomplete/zero/wrong-currency costs, exact arithmetic overflow, UTC/offset equivalence, overnight dates, DST changes, unknown airports, rejection of mismatched zone assertions, blocked over-budget selection, legacy identity preservation and ambiguous legacy matches. Embedded tests also verify that Core reads actually enter read-only repeatable-read transactions and that writes remain writable afterward.

GitHub Actions provisions an isolated PostgreSQL 17 service. The integration test pauses an itinerary read after obtaining its revision, commits an item addition through another pooled connection, then verifies that the first read still returns the original revision/items/history and a later read sees the update. It runs the actual initial/itinerary migrations in a random test schema and never uses `DATABASE_URL` or Supabase.

**CI verified:** [Check run 38119375186](https://github.com/eddieyang-97/trip-planning-engine/actions/runs/38119375186) passed the build and **all 55 tests, zero failures and zero skipped**, for implementation commit `09dfebd`. Its logs explicitly confirm the pooled PostgreSQL concurrency regression passed. This verifies the controlled pooled case, not hosted Supabase/OAuth acceptance.

No new application migration, hosted database mutation or Render deployment is required for this code-only correction. Deployment and real-account acceptance remain separate from these checks.
