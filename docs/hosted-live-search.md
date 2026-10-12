# Hosted live flight pilot

Updated 12 October 2026. Commit `a6d4c849181cbed175a15944778e6d58e9697aa6` is deployed on the existing Free Render service with live search enabled. Deployment/readiness checks pass; a real authenticated hosted search is still pending.

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

No hosted supplier search was submitted during these readiness checks. A real user/client OAuth connection and one authenticated `start_search` → `get_search_run` flow remain necessary to complete end-to-end hosted acceptance. Local live probes and offline regression tests do not substitute for that check.
