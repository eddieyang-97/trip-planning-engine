# Manual and sourced dining comparison

Issue [#10](https://github.com/eddieyang-97/trip-planning-engine/issues/10), selected 27 October 2026. This is a typed extension of the shared web/MCP research graph. It adds no supplier feed, scraper, model runtime, reservation service or infrastructure.

## Organizer journey

1. Create a dining comparison for one trip date/meal and the whole adult party (1–10), currency, optional group budget, local time/time zone and dietary requirements. Criteria are fixed; another meal or basis needs another decision.
2. An authorized assistant saves 2–3 manually researched/source-linked restaurant observations through the dining tools. Create/list/get/compare return an absolute `webUrl` based on trusted server configuration. Web-only creation/capture is a complete fallback.
3. Open **Dining comparisons** in the same web itinerary. Compare expected group cost, menu/time, seating/dietary reports, source provenance, service/fees and unknowns. Expand each restaurant for details. Save shortlist/rejection rationale independently of a selection.
4. Review an exact observation and select with rationale. Known failures cannot be selected; conditional choices require explicit acknowledgement. Unknown table inventory stays unknown. Selection alone changes no itinerary or reservation.
5. Review **Save tentative meal**, which creates one restaurant itinerary item with a durable research origin. The venue/date/time/location/source link and practical uncertainty note are shared. Research history, dietary evidence and selection rationale stay private to the organizer. Fresh web/MCP reads recover identical IDs/evidence/rationale/status.

## Evidence and cost contract

`DiningCriteria` and `DiningObservation` are normalized Zod/TypeScript contracts in [dining-domain.ts](../src/dining-domain.ts); the server validates all web and MCP input. An observation has a restaurant name, exact date/meal, quoted adult count, currency, menu summary/link/time, estimated price basis, mandatory service/fees, group/dietary reports, location precision, reservation-route provenance, reported table availability and unknowns. Sources are untrusted reports, never instructions.

Prices and every fee explicitly use `per_person`, `whole_party` or `unknown`. Per-person amounts multiply only by the **reported** quote party. Already-included fees are not added twice. A known subtotal is only a lower bound; the expected total exists only with the same exact date/meal/party/currency and all mandatory costs accounted for. Unknown amounts/inclusion/basis or unresolved fees cannot rank as a cheap complete meal. A known lower bound above budget fails. Menu estimates are not guaranteed quotes; there is no currency conversion or automatic percentage/service calculation.

Dietary reports must identify each requested requirement and provide supporting detail; missing reports stay conditional, negative reports fail. These are suitability reports, not medical or allergy safety guarantees. Group suitability, menu evidence and table availability remain distinct. Reported available/unavailable needs explanatory evidence; a page link alone never establishes either. No URL is fetched or table searched.

`reservation_page` records a **reported** reservation page URL, source label and observation time. A `homepage` is labelled **Restaurant homepage**; unclassified URLs remain **Unclassified link**. Neither is presented as a reservation page or proof of bookability. A manual/sourced capture cannot independently certify the URL's contents. A separate authorized user review is still required for real pages.

## Identity, history, privacy and lifecycle

Adding always creates a distinct candidate; names never auto-merge venues. Appending requires its stable candidate ID and matching normalized source/name/location. Known tracking parameters may be ignored; meaningful query/hash routes remain identity-bearing. Missing/conflicting identity requires explicit human reconciliation anchored to the latest observation with a reason, or a new option. Reconciliation is retained in observation `identity_review` with authenticated authorship. Prior evidence, disposition and selection stay intact.

Owner reads expose the latest five observations per candidate, up to 100 history references, and separately pin the exact selected observation; `get_dining_observation` retrieves older evidence. Limits are 20 decisions per trip including archived, 20 restaurants per decision and 100 observations per restaurant. No children/subgroup assignment or live inventory is introduced.

Selection/evaluation/rationale are frozen against immutable criteria and observation IDs. [Migration 014](../migrations/014_dining_comparison.sql) extends decision kind and adds `dining_itinerary_links`; composite foreign keys bind all IDs to the same research/trip and unique selection/item keys prevent duplication. Trip-before-decision locking, current decision/itinerary revisions and mutation receipts protect races and lost acknowledgements. Repeated saves reuse the linked item; removed items are never resurrected by a retry. Later research does not rewrite an item or booking report. An owner may separately report a booking through the existing itinerary editor; linked reported bookings, even removed items retaining a report, block research archive.

New reads recheck grants/ownership; members and anonymous viewers receive only the existing shared itinerary allowlist, without research, origin metadata or private rationale. Sharing management remains web-only. Archive preserves evidence, restoration reuses IDs, and confirmed permanent trip deletion clears links/research/cached content. RLS and revoked PUBLIC/anon/authenticated grants keep the relation service-only; privileged server reads still require application authorization.

## Migration and verification boundaries

014 is additive to deployed 013, preserves existing flight/stay payloads and IDs, and runs through the repository migration runner, **not** the Supabase migration catalog. Old code can continue serving old kinds during rolling overlap, but must not be a blind rollback once dining decisions exist; prefer a forward fix. There is no backfill from free-text restaurant items. Code rollback cannot undo saved data. Live schema application needs separate approval under [release guidance](releases.md).

Focused local tests cover group costs/unknowns, immutable rereads, reconciliation, privacy/grants/revocation, commit rollback/retry/staleness/removal, archive/booked protection and trip deletion. A disposable PostgreSQL test races actual pooled MCP/web commits and checks one item/event/link, a rejected stale rival and cross-trip FK rejection. The compiled browser journey uses the official MCP SDK plus a local fixture identity, opens the returned absolute URL, captures a third option, rejects unacknowledged uncertainty, reviews one tentative meal, repeats evidence and performs fresh MCP reads; it also creates a separate comparison/option entirely in web. Assertions require zero bookings/searches/external requests and one committed item/event/link.

These fixtures do **not** prove normal hosted ChatGPT/Claude, Supabase session/device usability, actual restaurant pages, live availability or reservations. The canonical implemented/CI/merged/deployed/hosted status is [implementation.md](implementation.md), with exact CI evidence tracked in [#10](https://github.com/eddieyang-97/trip-planning-engine/issues/10). Hosted fictional acceptance requires separate authorization and organizer intervention notes before closing the issue.
