# Six-search Flaine capability probe

This standalone command tests SerpApi's actual response shape before implementing a production flight adapter. It does not depend on Render, Supabase or MCP account linking. Tests use invented responses; a passing build is not evidence of live flights.

## Current status

The runner and offline tests are complete. Build and all 30 tests passed on 9 October 2026. The plan-only command completed with zero requests. No provider key was configured, so no live flight search has been run. Airline coverage, actual price basis and equipment availability remain unverified.

## Run

From the project directory, inspect the zero-network plan:

```sh
npm run probe:flights
```

For the live test, use an existing authorized SerpApi Free account with at least six included searches and six searches of hourly capacity available. Put its private key in `.env` as `SERPAPI_API_KEY=...`, or supply the environment variable through your own secure environment. `.env` is Git-ignored. Never paste the key into chat, commit it, put it in a command argument, or upload it as a test fixture. The command does not create accounts, upgrade plans or buy credits.

```sh
npm run probe:flights -- --live
```

The account preflight requires an active plan with a zero monthly price, enough included credits and enough hourly capacity. A paid plan, missing/ambiguous quota or missing key stops the probe before flight requests. These checks are conservative; they do not reserve SerpApi account credits against another application using the same key simultaneously. Avoid other use of that key during the small test.

## Exact scope

The query is London Gatwick to Geneva, 18–20 December 2026, four adults, economy, GBP and nonstop. Dates and four travelers are confirmed user inputs; adult ages and nonstop-only scope are test assumptions. The snowboard requirement remains unresolved by this API. LHR, LTN, STN, LCY and SEN are explicitly not requested in this first probe.

The runner requests fresh extraction and makes at most six search calls:

1. Fetch outbound results and pick one matching direct easyJet flight with a departure token.
2. Use that token to fetch returns and select one matching easyJet return with a booking token.
3. Fetch seller options and require their selected flight pair to match the requested pair.
4. Repeat those three stages for the same pair. If it is not returned, stop and report that fact without claiming it sold out.

Each response must echo the route, dates, party, currency, trip type and cabin. Missing fields cause an explicit stop for investigation. The first runtime response may expose a documentation/schema difference; inspect it before relaxing any validation. A returned price remains `priceBasis: unverified` and `exactPartyQuoted: false` until checked against the seller's labeled total. Do not multiply a one-person amount to claim four-seat availability.

## Budget and output

The CLI exclusively creates `.data/provider-probe/serpapi-attempts.jsonl` and refuses a concurrent or accidental second run. Each request is recorded and flushed before transmission. The file contains only our stage, attempt count, status and timestamp. It never stores keys, response payloads, prices, seller tokens, account details or booking POST data.

Timeouts and uncertain responses stop as `outcome_unknown`. There is no automatic retry or resume. Keep the ledger after interruption; inspect reserved attempts before explicitly authorizing another run. Re-running with a new budget requires deliberate handling of the old ledger, not an automatic reset.

The console shows a bounded, whitelisted research summary. It preserves source figures as unverified, identifies GET versus POST handoff requirements, and keeps snowboard price/availability and supplier expiry unknown. URLs are not followed and POST handoffs are not submitted. Raw provider errors are suppressed because they can echo credential-bearing URLs. No travel observations are inserted into the application database. Console output may still be retained by your terminal or assistant session; do not enable blanket request/debug logging.

## What completes validation

`status: completed` means both three-stage response flows ran for the same itinerary. It deliberately still returns `verifiedLiveIntegration: false`. Next manually check the source/seller view against the labeled four-person return total, fare, both flights and normal luggage. A generic snowboard fee remains a policy estimate until supported by booking-specific evidence. Production retention/redisplay and metered-retry behavior need their own integration decisions.

Only after this small probe produces useful evidence should we authorize the larger all-London test. See the [provider validation report](spike/live-flight-provider-validation.md) for its proposed 14-request bound. No all-airport sweep is enabled by this command.

Primary references used for request fields and response structure: [flight API](https://serpapi.com/google-flights-api), [booking options](https://serpapi.com/google-flights-booking-options), [account preflight API](https://serpapi.com/account-api).
