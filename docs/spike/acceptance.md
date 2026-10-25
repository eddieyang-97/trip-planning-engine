# Flaine acceptance checklist

Updated 13 October 2026. The original scenario remains the acceptance target; statuses below distinguish automated checks, recorded hosted proof and outstanding product requirements. See [current delivery status](../implementation.md), [PRD v0.4](../prd.md), [hosted flight acceptance](https://github.com/eddieyang-97/trip-planning-engine/blob/5137a2e6dfb1c17cc24f9704516991b0785e068f/docs/hosted-live-search.md#real-hosted-acceptance--13-october-2026) and [itinerary evidence](https://github.com/eddieyang-97/trip-planning-engine/blob/5137a2e6dfb1c17cc24f9704516991b0785e068f/docs/itinerary-web.md#hosted-verification--13-october-2026).

## Confirmed inputs and pilot scope

Confirmed: **18–20 December 2026**, **four travelers**, **snowboard required**, and **all London airports allowed**. Four adults, one board and Geneva remain explicit working assumptions. Budget, time boundaries, equipment dimensions and onward transfers remain unconfirmed.

The deployed pilot samples one direct easyJet LGW–GVA pair and up to ten sellers. It does not satisfy the all-airport requirement or establish a full-party, snowboard-complete bookable price. A completed run establishes completion of that narrow discovery request.

## Evidence and remaining checks

| Case | Required behavior | Evidence as of 13 October |
| --- | --- | --- |
| Account sign-in and MCP access | Verified account, client and resource audience | Real direct sign-in and official-SDK public registration/S256 PKCE/token verification passed |
| Same saved trip across surfaces/clients | Same account retrieves authoritative trip/evidence | Official-SDK creation/search, initial ChatGPT linking/reported retrieval, independent connected reads and real web research viewing passed; Claude remains unverified |
| Private account isolation | Other accounts cannot read/write guessed IDs | Automated ownership/grant tests pass; actual hosted second-account isolation remains outstanding |
| Confirmed/provisional brief | Retain confirmed dates/party/airport scope and label assumptions | Persisted criteria and connected retrieval preserve the brief; actual ages/board quantity/gateway still need confirmation |
| Exact-party live search | Full outbound/return evidence for the requested party | Hosted three-stage search for four adults completed with ten observations; every exact-party quote flag remains false and price basis unknown |
| All-London coverage | Explicit coverage for all six allowed airports | Only LGW sampled; other airports explicitly unsearched |
| Price and equipment unknowns | No complete total, free equipment or fully feasible claim without evidence | Automated comparisons plus hosted observation assertions/retrieval preserve unknown price basis, snowboard and expiry |
| Hard budget/time constraints | Known failure overrides preference scores; use airport-local time | Correctness regression tests and controlled pooled checks pass; real airline/equipment verification still needed |
| Transfer dependency | Unknown onward arrangements remain explicit | Retrieval/web show unresolved transfers; no transfer reservation or integrated feasibility proof |
| Immutable criteria | New versions never change prior run meaning | Automated persistence/revision tests pass; complete real multi-surface criteria-edit trial remains outstanding |
| Repeat search and changes | Preserve disposition/evidence; only comparable fares yield price deltas; absent is not sold out | Automated fixture diff tests and two standalone probe cycles exist; hosted fresh-run/reselection comparison not recorded |
| Duplicate retry | Identical mutation returns original run without another chargeable request | Automated checks and real hosted retry returned the same run; ledger retained exactly three successful attempts |
| Interrupted paid work | No blind resend after ambiguous transmission | Automated live lease/network tests pass; expired work becomes outcome-unknown without resend; no deliberate hosted crash trial recorded |
| Source failure / coverage | Failure must not become no availability; partial scope explicit | Automated provider-failure and coverage checks; hosted success proves only sampled scope, not generalized multi-source partial recovery |
| Evidence freshness/retention | Separate expired facts, permitted retention and preserved decision history | Expiry evaluation tested; provider age policy and executable deletion/redaction lifecycle remain work |
| Selection versus booking | Distinct explicit outcomes; synthetic offers cannot be booked | Automated selection/report tests pass; no actual selection/booking in hosted acceptance |
| Resource ceilings | Atomic admission, durable attempts, no metered work on status reads | Live tests and pooled admission check pass; actual run used three requests, repeated retry/retrieval added none |
| Organizer continuity | Web edits visible through MCP and vice versa | Automated shared-core tests pass; real web/MCP research reads agree; hosted manual write round trip remains outstanding |
| Web flight workflow | Research/compare/select through direct web controls | Saved evidence and tentative draft review deployed; full web search/comparison/outcome controls remain work |
| Collaboration | Authenticated roles, revocation, discussion, proposals and organizer approval | Not part of the recorded deployed/accepted release; local development does not establish acceptance. Follows organizer foundation, before accommodation integrations |

Automated checks are identified in [correctness fixes](../correctness-fixes.md), [live pilot validation](../hosted-live-search.md#validation-so-far) and feature test records. Test counts are dated evidence, not a claim that all product acceptance cases have passed.

## Historical connector observation — 3 October

The original [Trip.com snapshot](fixtures/flaine-connector-observation.json) returned nine easyJet options from LGW/LTN, with USD prices despite the en-GB request and contradictory per-traveler/total/currency descriptions. Its uncertain passenger-price basis, absent equipment data, incomplete airport coverage and unknown transfers informed the conservative evidence model.

That call proved connected source access at the time, not reusable backend access or a current fare. Subsequent [11 October probes](live-probe-results-2026-10-11.md) and the separate hosted pilot are their own evidence. Do not seed current inventory from these snapshots.

## Product acceptance still to demonstrate

The organizer must complete the bounded flight workflow through the web and intended assistants, retain criteria/decisions across sessions, understand the real trade-offs, and maintain the itinerary without a parallel Google Doc. A second research pass should reveal meaningful changes within two minutes without re-entering criteria.

After the organizer foundation, verify a real friend collaboration session, role enforcement, revocation, conflicting proposals and shared state. Working tool calls, one live run and ten sellers are useful technical proof; they do not alone demonstrate that product outcome.
