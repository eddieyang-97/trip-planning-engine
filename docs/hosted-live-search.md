# Hosted live flight pilot

Updated 12 October 2026. Implementation is ready for deployment validation; successful hosted acceptance has not yet been recorded.

## Scope

The existing MCP `start_search` tool accepts `provider: live` when the backend has both `LIVE_SEARCH_ENABLED=true` and `SERPAPI_API_KEY`. Neither setting is exposed to browsers or assistants. The key alone never enables live search. Missing-key opt-in stops startup rather than silently falling back to synthetic results.

The first pilot supports the established Flaine acceptance inputs: 18–20 December 2026, four adults, provisional Geneva gateway, with Gatwick among the permitted airports. Other dates, parties and destinations fail before creating a run. The provider samples one deterministic direct easyJet LGW–GVA pair, then returns up to ten sellers. It does not find the optimal pair or sweep all London airports. Flights run first; hosted accommodation integration is pending.

The three stages are outbound search → return search → seller options. There is also one unmetered account preflight that requires an active zero-cost plan, sufficient included searches and hourly capacity. No account upgrades, credits or overages are enabled. Other clients sharing the key are outside the backend's reservation system; the account preflight is not an atomic supplier quota reservation.

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

Observations are marked `provider_reported`. `priceBasis` remains `unknown`, `exactPartyQuoted` remains false, snowboard carriage/cost remain unknown, and supplier expiry remains null. The earlier manual Google source check does not verify all future API prices. Flight wall times convert through reviewed airport zones; DST gaps, ambiguous times and malformed offers are rejected. Provider text containing the configured key is not saved.

`get_search_run` returns persisted status, partial coverage, accepted observation count and up to three attempt records. Research URLs lead to Google Flights; they are not held fares or ordinary seller booking URLs. The service never follows seller handoffs, sends passenger details or books tickets. Existing comparison/selection logic preserves uncertainty and hard constraint failures.

## Deployment and acceptance

1. Build and regression tests must pass; CI also provisions disposable PostgreSQL.
2. Set the secret `SERPAPI_API_KEY` and `LIVE_SEARCH_ENABLED=true` on the existing Render service, preserving its DB/auth settings and Free plan.
3. Deploy the tested main commit. Check `/health` for `status: ok` and `liveSearch: true`; unauthenticated `/mcp` must still return 401.
4. Use a verified user/client connection with read, write and search grants. Create or read the Flaine decision, call `start_search` using its current revision/version, and poll the returned run.
5. Verify durable attempts, provider provenance and incomplete price/equipment coverage. Retry the identical mutation and confirm there is no second run or additional search.

The itinerary web app remains the manual organizer. This change connects the hosted MCP research backend; it does not add flight search controls to the itinerary UI. Real Supabase OAuth/assistant acceptance is a separate remaining prerequisite if the user's client is not linked.

Rollback: set `LIVE_SEARCH_ENABLED=false` and restart/deploy. Evidence and ledgers stay in Postgres. Disabling admission does not cancel a supplier request already in flight; idle running records recover conservatively after lease expiry when the runner is enabled again.

## Validation so far

On 12 October the TypeScript build passed and the full local suite passed 61 tests with one opt-in PostgreSQL test skipped. New tests cover durable reservation before transmission, retry idempotency, per-owner allowance, expired work, revocation between stages, network uncertainty, explicit opt-in and DST conversion. Hosted deployment and live authenticated acceptance remain pending.
