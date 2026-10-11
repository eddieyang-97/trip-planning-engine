# Flaine accommodation capability probe

Updated 11 October 2026. This standalone diagnostic inspects hotel, Google vacation-rental and third-party Airbnb search responses. It is not a hosted accommodation provider and does not save application candidates, follow seller links or make bookings.

## Run

```sh
# Print the plan; zero network requests:
npm run probe:accommodation

# Requires an existing authorized Free SerpApi key in ignored .env:
npm run probe:accommodation -- --live
```

The runner reads `SERPAPI_API_KEY`. Never put it in a command argument or chat. The first live run on 11 October stopped after its first hotel search returned `provider_reported_error`. After the user continued the investigation, its ledger was preserved and a deliberate five-search follow-up completed all three modes plus both Google detail requests. The original failure's cause remains unknown. Airbnb's source page independently matched one £633 displayed total for four guests on the requested dates. Hotel allocation, mandatory charges and final checkout validation remain incomplete. See [live probe findings](spike/live-probe-results-2026-10-11.md).

Validation on 11 October: TypeScript build, all 42 offline tests and the zero-network plan passed. Seven new tests cover query budgets, context/property matching, price uncertainty, failures, output bounds and direct-detail responses.

## Scope and budget

Requests use Flaine, 18–20 December 2026, four adults and GBP. Dates and four travelers are confirmed; adult ages remain a test assumption. No bed count, bedroom count or two-room requirement is silently imposed. This diagnostic cannot validate the intended two-hotel-rooms versus one-apartment comparison yet.

One account preflight checks for an active zero-monthly-cost plan, at least five included search credits and five searches of hourly capacity. Then:

1. Request the first page in Google Hotels mode.
2. Request the first page in Google Vacation Rentals mode.
3. Request the first page from SerpApi's Airbnb engine.
4. Fetch at most one Google property detail from each of the first two modes, using a token returned by that mode. A direct property-detail search response or missing token skips the extra request.

The maximum is **five search calls plus one account check**. This allowance is separate from the six-search flight probe but uses the same account quota. Avoid concurrent use of the key: the provider's account check does not reserve credits against other clients. The command buys no credits and enables no overages.

The CLI exclusively creates `.data/provider-probe/accommodation-attempts.jsonl`. Each attempt is recorded and flushed before transmission. The ledger stores our stage, mode, attempt, status and timestamp. Failures may also record an HTTP status, allowlisted error category and validated hexadecimal provider search ID; raw error messages remain suppressed. It prevents automatic reruns; preserve it after an interruption and inspect the previous attempt before authorizing another budget. Network uncertainty consumes its reserved attempt, stops the run and never triggers a retry. The runner ignores pagination and never follows provider-supplied API URLs.

## What the output means

Each response must echo the destination, travel dates, adults, currency, engine and mode-specific query context. Property details must match the selected token. A missing or changed response field stops the run for inspection instead of relaxing validation. Live responses may expose differences from documentation; offline tests are not a substitute for this check.

Console output includes up to ten observations per mode, displayed totals/nightly rates where provided, descriptive layout and price terms, and a bounded seller summary for Google details. Prices remain unverified source figures. `fullStayTotalMinor` stays null and `exactPartyQuoted` stays false; occupancy, mandatory fees, cancellation deadlines, late arrival and final availability require further evidence. In particular, a four-adult query alone does not prove two rooms were quoted. Empty results do not mean all accommodation is sold out.

Airbnb result dates must independently match the requested dates before its extracted amount can appear in the diagnostic total field. Price breakdown lines remain descriptive: subtotals, totals and discounts are not summed. A free-cancellation label does not establish its deadline. Site links have query strings removed to avoid persisting tracking or handoff tokens; they are property references, not dated booking quotes. Keys are redacted and raw account data, search tokens, HTML and provider errors are omitted. Console text may be retained by the terminal/chat, but the command writes no property payloads to disk or the application database.

`completed` means the bounded requests were processed, including empty results and unsupported detail steps. It does not establish sufficient inventory, a comparable price or a working production provider. The next acceptance step is to inspect real responses and verify one useful offer in the source/seller view, then decide which fields can support persistent comparison under the provider's retention/display terms.

## Airbnb clarification

The earlier research established no open official Airbnb consumer-search API. A third-party route was missed: SerpApi documents an `airbnb` engine that extracts search results. It is now included in this diagnostic. That does not establish official Airbnb partnership, unrestricted storage rights or bookable inventory. The product can still retain user-supplied Airbnb links and notes independently of an automated integration.

Primary references: [Google Hotels and vacation-rental parameters](https://serpapi.com/google-hotels-api), [Google property details](https://serpapi.com/google-hotels-property-details), [SerpApi Airbnb search](https://serpapi.com/airbnb-search-api), [SerpApi account API](https://serpapi.com/account-api). See the broader [provider spike](spike/hotel-restaurant-providers.md) for other integration routes.
