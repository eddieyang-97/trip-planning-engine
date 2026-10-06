# Flaine end-to-end acceptance specification

Confirmed by the user: 18–20 December **2026**, **four travelers**, **snowboard required**, **all London airports acceptable**. One board for the party and four adults are explicit test assumptions; they are not confirmed traveler details. Geneva is the proposed gateway. No exact Friday work cutoff, Sunday arrival limit, spending cap, equipment dimensions or transfer booking has been supplied.

## Live research observation

The connected Trip.com tool was called for London–Geneva round trip, 18–20 December 2026, four adults, economy, locale en-GB. It returned nine options, all easyJet, with departures from LGW or LTN and returns to LGW. This is a sampled response, not complete London airport or airline coverage. Source retrieval timestamp is recorded in the JSON artifact; provider observation time was not supplied.

The response demonstrates why normalization is necessary:

- Currency was USD and the site was us.trip.com despite en-GB locale.
- Numeric prices were returned with a localized “per traveler” label, while the tool schema called the price a total and described CNY. These conflict. Keep `priceBasis=unknown`; do not infer a four-person total.
- The exact four-adult query is visible in the summary/links, but that alone does not prove inventory/price completeness for all travelers.
- No snowboard fee or carriage allowance was returned. No transfer evidence was returned. Eligibility for the complete trip therefore remains conditional.
- Some cheapest combinations use different outbound/return London airports. Preserve the airport identities; “all airports” does not mean cross-airport ground costs are zero.
- No after-work departure appeared in this small response. This does not establish that no evening flight exists.

The call proves **live connector access**, not our own provider credentials, remote MCP deployment, a verified purchase quote or a passed end-to-end product test. It did not book anything. Do not seed production with this snapshot as current inventory.

## Acceptance cases to execute on the vertical slice

| Case | Expected result | Current status |
|---|---|---|
| Same trip across clients | Create through ChatGPT, read same ID/criteria through Claude signed into same travel account | Not run; hosted auth required |
| Private account isolation | Second account cannot read/write guessed trip, run, observation or selection IDs | Not run |
| Confirmed/provisional brief | Dates/party count/airport breadth retained; age mix and board quantity flagged as assumptions | Specified in fixture |
| Exact-party live search | Source queried for four travelers; full outbound/return path; coverage and timestamps retained | Connector call performed; deployment adapter not tested |
| Price-basis mismatch | Ambiguous basis yields no comparable group total | Required by design; runtime test pending |
| Equipment unknown | Candidate conditional; no free snowboard assumption, even with a checked-bag boolean | Required by design; runtime test pending |
| Hard time constraint | Once user sets a cutoff, failing flight excluded from eligible group regardless of cheap fare | Pending |
| Transfer dependency | Late arrival with unknown onward transfer stays conditional; route duration not treated as a seat reservation | Pending |
| Changed criteria | Old run references old immutable criteria; new run uses new version | Pending |
| Repeated search | Saved/rejected choices survive; comparable price/schedule deltas shown; missing result means not-seen, not sold-out | Pending |
| Duplicate tool retry | Same mutation key/payload returns same run without another reserved charge; changed payload conflicts | Pending |
| Crash after send | Attempt becomes outcome-unknown or reconciles by provider ID; no blind duplicate paid search | Pending |
| Source failure | Partial coverage and usable observations retained; failed airport/provider not described as no availability | Pending |
| Evidence expiry | Facts become expired/redacted; historical user decision persists, with missing source content disclosed | Pending |
| Select vs book | Selection records rationale; booking only recorded on explicit report of external completion | Pending |
| Resource ceiling | Run stops expansion at budget; truncation visible; status reads create no paid requests | Pending |

## Pilot success criterion

Compare this workflow with ordinary flight search plus notes. On the second search, the organizer should identify meaningful changes within two minutes without re-entering criteria, and explain the trade-off and outstanding baggage/transfer conditions. Continue investment only if remembered context or cost completeness improves a real decision. A successful demo of tool calls alone does not validate the product thesis.
