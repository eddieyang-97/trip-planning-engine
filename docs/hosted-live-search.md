# Hosted live flight search

Updated 21 October 2026. General-purpose MCP discovery is prepared locally; it has not been deployed or tested against live supplier data. The original fixed Flaine pilot passed hosted acceptance on 13 October; that dated evidence below is unchanged and does not prove generalized queries. See [architecture](architecture.md) and [delivery status](implementation.md).

## Scope

The existing MCP `start_search` tool accepts `provider: live` when the backend has both `LIVE_SEARCH_ENABLED=true` and `SERPAPI_API_KEY`. Neither setting is exposed to browsers or assistants. The key alone never enables live search. Missing-key opt-in stops startup rather than silently falling back to synthetic results.

The generalized source supports 1–6 distinct origin airport IATA codes, one different destination, a future departure calendar date (strictly after the current UTC date), optional return on/after departure, 1–9 adults, economy, GBP and 0–2 connections per direction. Unsupported/ambiguous airport time zones fail before reservation. Dates have no application-imposed Flaine window; supplier scheduling horizons/availability can still return no results or errors. Children, flexible-date calendars, multiple destinations, other cabins/currencies and exhaustive airport searches are outside this increment.

The adapter no longer calls the hardcoded standalone probe. A return run makes one combined airport query then expands up to two valid departures, preferring distinct origins before a second option from one origin. Each expansion can return several complete pairs; save at most ten per departure / twenty total. A one-way run saves up to twenty options from one query. It considers all returned airlines, validates route/local dates/cabin/connections/chronology, applies the saved outbound time cutoff and rejects invalid results. No seller endpoint or booking transaction is called.

An unmetered account preflight still requires an active zero-cost plan, at least three included searches and hourly capacity. No upgrades, credits or overages are enabled. Other clients sharing the key are outside our reservation system; preflight is not an atomic supplier quota reservation. Uncertain network/acknowledgement outcomes stop further dispatch. A known failed independent return expansion may leave useful partial observations; completion/coverage never means every airport or itinerary was covered.

## Persistence, cost and recovery

Migration 005 adds `serpapi` runs, `provider_reported` observation provenance and private provider-attempt records. Existing trips, observations and OAuth configuration are retained. The service's current startup migration policy applies migration 005.

Each accepted run reserves three request slots in Postgres. Admission is serialized with a database advisory lock. Conservative allowances are:

| Window | Allowance |
| --- | --- |
| One run | At most three search requests |
| One owner, rolling 24 hours | Six reserved requests / two runs |
| All owners, rolling 24 hours | Twelve reserved requests / four runs |
| All owners, rolling 30 days | Sixty reserved requests / twenty runs |

Unused slots from failed/empty runs remain counted. Retrying the identical idempotency key returns its original run; new keys still consume the allowance. These limits are separate from the provider account's quota and standalone probe usage.

One live job runs at a time across service processes. Every potentially metered request has a committed `reserved` attempt before transmission; attempt numbers are unique and bounded by database constraints. Completion records status and safe diagnostic classification, never keys, raw responses, booking POST payloads or supplier tokens. Permission/grant version is rechecked before every search request and before saving results. A revocation can stop subsequent spending; it cannot retract a request already sent.

The provider uses a 30-second timeout per request. The worker lease is three minutes, covering the account check and three bounded requests. Expired running jobs and outstanding attempts become `outcome_unknown`; live requests are never automatically reclaimed or resent. Queued jobs expire after one hour. A new run requires an explicit new mutation and another allowance reservation. Fixture recovery remains separate.

The runner lives inside the existing Node web service and uses Supabase Postgres; no new Render worker is required. Free Render sleep means progress can pause while idle. An authenticated request wakes the service, and the timer processes saved jobs while the process remains awake. Free-tier latency is part of this pilot, not an always-on guarantee.

## Evidence contract

Observations remain `provider_reported`, with `priceBasis:unknown`, `exactPartyQuoted:false`, unknown snowboard carriage/cost and null supplier expiry. The selected return result supplies the observed round-trip amount; unrelated leg prices are never added. One-way amounts retain one-way scope. Comparisons expose observed amount/currency/basis, both schedules, duration, connection count and restrictions without converting an observed amount into a verified party total or budget pass. Optional discovery evidence keeps supplier-created time separately from fetch time plus bounded per-direction baggage/restriction text. It does not establish fare-specific ancillary inventory. A fresh search is not a reprice or hold.

Wall times convert through a pinned [mwgg/Airports catalogue](https://github.com/mwgg/Airports/tree/a89e4e0dda9d9878337e2da190ebe1ef1d6af705) (7,917 unambiguous IATA/IANA entries) plus the original London/Geneva overrides. License is retained in `third_party/mwgg-airports-LICENSE`; regeneration is explicit with `node scripts/update-airport-zones.mjs`, never at build/test/runtime. Catalogue data is not airline coverage proof. Unknown connection zones, DST gaps/overlaps and malformed offers are rejected; known original mappings and historical observations are preserved. Provider text containing the configured key is discarded.

`get_search_run` returns persisted status, partial coverage, accepted observation count and up to three attempt records. Research URLs lead to Google Flights; they are not held fares or ordinary seller booking URLs. The service never follows seller handoffs, sends passenger details or books tickets. Existing comparison/selection logic preserves uncertainty and hard constraint failures.

Coverage separates requested airports, successfully queried combined-airport scope, returned origins, unexpanded departures, failed expansions, rejected records and truncation. A combined query is not six isolated queries, and a missing origin is not proof of no flights. `complete` always remains false. No broader supplier rights are asserted: existing research-only retention/display limitations still apply; raw responses, tokens and seller POST payloads are not stored. Storage-license/expiry enforcement and more complete seller/ancillary evidence remain separate work.

## MCP workflow and examples

1. `create_trip` (or retrieve an owned trip), then `create_decision` with explicit constraints/assumptions and scoring preferences. Change saved criteria using `update_decision_criteria`; get the current revision/version before mutation.
2. After the user's explicit search request, `start_search` with `provider:"live"`, current `decisionId`, `expectedRevision`, `criteriaVersion` and an idempotency key. Retrying this exact request uses the same key and returns the original run. A new key reserves another allowance.
3. Poll `get_search_run`; it reads durable status/evidence without spending another search. Inspect coverage/errors even when observations exist. Pass observation IDs to `compare_candidates`; only the complete quoted-cost fields affect cost ranking. A numeric observed price with unknown basis remains conditional.

Example criteria (full valid payload; preferences are an explicit example for review, not silent user preferences):

```json
{
  "origins":["LHR","LGW","LTN","STN","LCY","SEN"], "destination":"GVA",
  "outbound":"2027-01-14", "inbound":"2027-01-18", "adults":4, "currency":"GBP",
  "maxStops":1, "snowboardRequired":false, "snowboardQuantity":null,
  "earliestOutboundLocal":null, "groupBudgetMinor":null,
  "assumptions":["Economy; normal baggage requirements unconfirmed"],
  "preferences":{"costWeight":0.5,"costBestMinor":40000,"costWorstMinor":200000,
    "durationBestMinutes":180,"durationWorstMinutes":1440}
}
```

Other newly supported examples: JFK/EWR → LAX for two adults, 2 April 2027, `inbound:null`; CDG → FCO for one adult, 10–15 March 2027. These are input examples, not performed searches. Prices are requested in GBP regardless of route. The JSON return date is nullable; observations use `inbound:[]` for one-way and the saved-research view omits return actions.

## Provider trade-off and cost

[SerpApi documentation](https://serpapi.com/google-flights-api) supports comma-separated airports, passenger/date/cabin/stops parameters, one-way/return types and return expansion tokens. [Flight results](https://serpapi.com/google-flights-results) provide schedule, price and extension text. That is adequate for this bounded discovery increment; a second provider/service is not justified. Seller/fare endpoints trade an extra metered call per chosen pair for detail but do not establish snowboard inventory; the earlier seller stage is deliberately replaced by another itinerary expansion.

One return run is ≤3 metered requests; one repeat ≤3 more (6/trip research cycle), with no automatic retries or airport/date fan-out. A one-way plus repeat uses two requests but still reserves six local slots. Existing rolling owner/global allowances above stay unchanged and are not per-trip entitlements; no per-trip quota is introduced. An isolated six-airport sweep would need at least six base queries before return/seller expansion, so it cannot fit this ceiling. The zero-cost-plan guard keeps authorized paid spend at $0; included account quota is still consumed. Source coverage, party-price semantics, retention rights and live query compatibility require their own acceptance; no complete/bookable comparison is promised.

## Deployment and acceptance

1. Build and regression tests must pass; CI also provisions disposable PostgreSQL.
2. Set the secret `SERPAPI_API_KEY` and `LIVE_SEARCH_ENABLED=true` on the existing Render service, preserving its DB/auth settings and Free plan.
3. Deploy the tested main commit. Check `/health` for `status: ok` and `liveSearch: true`; unauthenticated `/mcp` must still return 401.
4. With explicit approval for a particular live test and ≤3 search requests, use a verified user/client with read/write/search grants and an isolated general-route decision. Submit current revision/version and poll its run. A second run or second client search needs its own approved scope/budget.
5. Verify durable attempts, provider provenance and incomplete price/equipment coverage. Retry the identical mutation and confirm there is no second run or additional search.

The itinerary web app provides manual organization and the deployed saved-research view. It does not yet provide flight search controls. Hosted OAuth and initial ChatGPT linking have succeeded; each new client still needs explicit authorization, and wider assistant/security acceptance remains separate. See [itinerary evidence](itinerary-web.md#hosted-verification--13-october-2026).

Rollback: set `LIVE_SEARCH_ENABLED=false` and restart/deploy. Evidence and ledgers stay in Postgres. Disabling admission does not cancel a supplier request already in flight; idle running records recover conservatively after lease expiry when the runner is enabled again.

No new environment setting, SQL migration or infrastructure is needed. One-way snapshots and the optional evidence object are additive JSONB changes: old return snapshots still read identically, but older application code cannot evaluate empty returns. Before rollback, disable live admission and prefer a compatible forward fix; never delete/rewrite evidence to make old readers pass. The P0 security gate in issue #3 remains separate and must pass before widening users. No deployment is authorized or performed in this task.

## Generalized local validation — 21 October 2026

`npm run check` and `npm run build` pass on the isolated PR branch based on current main. `npm test` passed **129 tests, zero failures/skips**, with `TEST_POSTGRES_URL` set to a fresh loopback-only PostgreSQL 17.10 cluster, including all four pooled PostgreSQL tests. The temporary runtime/harness lives under ignored `.data/`, leaves application dependencies unchanged and stops its server after tests. Supplier responses are deterministic fixtures; these checks do not establish live-provider acceptance.

New tests exercise arbitrary routes/dates/parties, one-way and connected itineraries, unsupported/invalid inputs, bounded airport/return expansion, twenty-observation truncation, malformed/mismatched responses, partial failures, lost acknowledgements, reservation-before-dispatch, no replay, secret filtering, old candidate identity/history, saved web projections and the official MCP SDK over loopback HTTP. Pooled admission uses mixed routes/parties and one-way/return requests: six concurrent owners admit exactly four runs/twelve reserved requests; an identical retry adds none. Existing revocation, deletion/recovery, read consistency and web/MCP privacy tests also pass.

These use deterministic supplier responses and isolated accounts/trips. No live search, supplier credentials, paid quota, real trips, production infrastructure or deployment was used. Remaining acceptance: review the existing supplier rights/retention limits; approve a specific ≤3-request live test; deploy the reviewed code separately; then validate a general return query and independently approved one-way/client flows in ChatGPT and Claude. Record actual provider echo/token compatibility, coverage and omissions. Seller quoting, board inventory, currency/cabin expansion and a complete airport sweep remain follow-ups, not claims from these tests.

## Historical validation — 12–13 October 2026

On 12 October the TypeScript build passed and the full local suite passed 61 tests with one opt-in PostgreSQL test skipped. New tests cover durable reservation before transmission, retry idempotency, per-owner allowance, expired work, revocation between stages, network uncertainty, explicit opt-in and DST conversion. After adding the PostgreSQL admission test, [CI run 38298508888](https://github.com/eddieyang-97/trip-planning-engine/actions/runs/38298508888) passed all 63 tests, zero skipped. Concurrent requests from six different owners over pooled connections admitted exactly four runs / twelve reserved requests; duplicate retry created no extra run.

The user entered and saved the provider secret in Render. The existing Free service then deployed the tested commit in [deployment dep-db6jd2lg1s2s739ianh0](https://dashboard.render.com/web/srv-db3t3iub7d7c739hfad0/deploys/dep-db6jd2lg1s2s739ianh0), reporting Live at 20:36 UK time on 12 October. Startup checks confirm migration 005 was applied before listening and the live pilot flag was enabled. No secret was printed or committed.

Post-deployment HTTP checks:

| Endpoint | Observed result |
| --- | --- |
| `/health` | 200, `status: ok`, `liveSearch: true` |
| `/account` | 200 |
| `/itinerary` | 200 |
| `/itinerary/config` | 200, mode `hosted` |
| `/mcp`, unauthenticated | 401 with authentication challenge |

No hosted supplier search was submitted during the 12 October readiness checks. The real authenticated flow completed the following day as recorded below.

## Real hosted acceptance — 13 October 2026

After direct sign-in and explicit approval of the **Travel hosted acceptance** public client, `npx tsx scripts/acceptance-hosted.ts --live` completed discovery, S256 PKCE, token verification and official-SDK MCP calls against the deployed service. The token's issuer, resource audience, client binding and grant version passed validation. The helper exited with code 0 and cleared its in-memory credentials.

| Record | Persisted ID / result |
| --- | --- |
| Trip | `3a9da81c-f69d-4482-93bd-6e3a5e2a34b8` |
| Flight decision | `00c66a7c-3a2c-4503-9131-0f3b66d71f11` |
| Search run | `0f984b0a-4d3b-4c80-8771-78c5b7d4dd6e` |
| Status | `complete` |
| Durable attempts | 1 outbound: success; 2 return: success; 3 seller options: success |
| Observations | 10, all `provider_reported` |
| Identical mutation retry | Returned the same run ID; no additional run or provider search |

This run used the established Flaine dates and four-adult party with provisional Geneva gateway and one deterministic direct easyJet Gatwick–Geneva pair. The user permits all London airports and requires snowboard carriage; this narrow pilot does not cover those requirements fully. Four adults, one board and Geneva are test assumptions where the confirmed inputs do not establish those details.

Assertions verified `priceBasis: unknown` and `exactPartyQuoted: false` for every saved observation. Snowboard carriage/costs, supplier expiry, exact bookable totals and actual seller handoff remain unverified. No candidates were selected, passenger details submitted or bookings made. Ten seller observations are evidence for this sampled pair, not ten fully validated itineraries. Claude compatibility, assistant write/search flows, refresh/revocation and hosted second-account isolation remain separate acceptance work.

The user subsequently connected ChatGPT and supplied its successful retrieval response for the saved trip, observations and unresolved constraints, explicitly reporting no new search. The account page independently showed the ChatGPT read/write/search grant. Once the Trip Planning tools became available here, direct read-only calls verified the trip, all ten seller observations, the empty itinerary and the existing three-attempt ledger. The recent-run list contained only the original completed search. See the [ChatGPT acceptance evidence and its limits](account-linking.md#chatgpt-saved-research-retrieval--13-october-2026).
