# First live SerpApi probes — 11 October 2026

## Scope and execution

The user configured a private key locally and authorized the bounded flight and accommodation probes. Both active Free-plan/quota checks passed. The runners made six flight search requests and one hotel search request (seven attempted searches in total); this is an attempt count, not a verified billing count. Credentials and raw responses were not printed or committed. Local attempt ledgers remain Git-ignored and prevent accidental reruns. No application candidates, bookings, deployments or hosted configuration were changed.

Confirmed inputs: Flaine, 18–20 December 2026, four travelers, snowboard, all London airports acceptable. This capability test uses four adults, economy and Geneva as labelled assumptions, and only searches nonstop Gatwick flights. It does not compare every permitted airport or establish a recommended itinerary.

## Flights: diagnostic flow passed

`npm run probe:flights -- --live` completed both three-request cycles: outbound search, return search, seller options. Each response echoed the requested context; each seller response matched the selected pair. Seller responses were observed at 22:51:23 and 22:51:41 UTC (23:51 UK time) on 11 October.

| Leg | Flight | Source-reported local departure | Source-reported local arrival |
| --- | --- | --- | --- |
| Gatwick → Geneva | easyJet U2 8487 | 18 Dec 2026, 08:30 | 18 Dec 2026, 11:10 |
| Geneva → Gatwick | easyJet U2 8156 | 20 Dec 2026, 12:35 | 20 Dec 2026, 13:15 |

Each cycle returned 14 seller options; the diagnostic displayed a bounded first ten. Examples of source figures, unchanged between the two observations: easyJet £452, Trip.com £448 and BudgetAir £420. **These are unverified source figures, not confirmed four-person totals or per-person prices.** Do not multiply them or rank them as comparable confirmed fares. The selection was deterministic for testing and was not optimized for skiing time, price or preferences.

The normalized output contained no fare name, luggage terms or snowboard quote. All ten displayed handoffs required POST via Google, so they cannot be assumed to be ordinary reusable seller URLs. No handoff was submitted. Supplier expiry remains unknown; repeated source figures do not establish a held fare, independent supplier repricing or identical fare conditions.

Result: the live extraction and repeat-search flow works for one easyJet pair. `verifiedLiveIntegration` remains false. All-London coverage, exact four-person pricing, fare/luggage equivalence, snowboard carriage and seller handoff still need validation.

## Accommodation: first request failed

`npm run probe:accommodation -- --live` passed its account check, attempted the first Google Hotels search for Flaine on the same dates with four adults and GBP, then stopped with `provider_reported_error`. No observations were accepted. Google vacation rentals, Airbnb and both optional detail requests were not reached.

The runner deliberately suppresses raw provider errors because they may contain credential-bearing URLs. It did not retain a search ID or safe diagnostic classification, so this run cannot establish the cause. A read-only attempt to inspect the provider's search archive listing was unavailable and yielded no diagnosis. No new search was made during that investigation, and no automatic retry occurred. This is a provider-response failure, not evidence that accommodation is sold out or that the API key is invalid.

## Next acceptance steps

1. Verify the returned flight pair in the source/seller UI, including the labelled four-adult return total, fare inclusions and booking-specific snowboard evidence. Preserve unresolved fields as unknown.
2. Add safe error classification and a validated provider search ID to future diagnostic output, without raw errors, keys or token-bearing URLs. Inspect the existing failed search in the provider dashboard if available before spending another search budget.
3. After diagnosing accommodation, explicitly budget a follow-up run while preserving the first ledger. Validate one hotel allocation and one entire-place offer against their source pages.
4. Only then expand coverage and build the production adapter around durable search attempts, bounded costs and explicit evidence quality. The current probes are standalone diagnostics.

Provider API references: [Google Flights](https://serpapi.com/google-flights-api), [Google Hotels](https://serpapi.com/google-hotels-api), [Search Archive API](https://serpapi.com/search-archive-api).
