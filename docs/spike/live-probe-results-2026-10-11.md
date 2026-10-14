# First live SerpApi probes — 11 October 2026

Historical observations and source checks from 11 October. A separate [hosted flight pilot](../hosted-live-search.md) was subsequently implemented and passed its first authenticated search on 13 October. Its fixed scope and unresolved quote fields are recorded in [current delivery status](../implementation.md); the probe prices below are not current fares. Remaining steps below describe the position at the end of the diagnostic investigation.

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

## Follow-up: source verification and accommodation success

The user asked to continue. An archive-list API diagnostic returned HTTP 403 with an HTML body, so it did not recover the first hotel error. After improving diagnostics and preserving the original ledger as `accommodation-attempts-initial-2026-10-11.jsonl`, one deliberately bounded follow-up ran all five accommodation searches successfully at 22:56 UTC. Across both turns, twelve search requests were attempted: six flights, one failed hotel search and five successful accommodation requests. The original hotel's failure cause remains unknown; success with unchanged query parameters does not prove a particular transient cause.

### Flight source check

The exact Google Flights research URL from the probe loaded the same flight pair with **four passengers**, a **£452** easyJet option and an explicit label that required taxes and fees were included for **four adults**. This resolves the displayed price basis for this particular observation at the metasearch source. It does not justify interpreting every provider price as a party total.

Google showed carry-on and checked luggage as chargeable. Clicking its easyJet option reached the airline's flight-selection page, demonstrating that the browser handoff navigates to the intended supplier. However, the airline's selected flights and basket amount did not populate. Airline repricing, complete luggage costs and snowboard carriage are still unverified. No passenger information was entered and no booking was made.

### Accommodation source checks

All three search modes and both optional Google property-detail stages completed. The Google hotel search returned 20 properties, with further pages left unfetched and only the first ten displayed. The results included vacation rentals as well as hotels, and locations beyond Flaine itself.

| Observation | API/source evidence | Remaining limits |
| --- | --- | --- |
| Hôtel Totem, Flaine | Google search reported £1,226 in its total field. The [official hotel's booking engine](https://app.mews.com/distributor/dc5d24f8-b9dc-4ce0-baa5-ad3300f5843f/) independently accepted 18–20 Dec and four adults. Its Classiques Communicantes category described two connecting rooms, maximum four people, and an advance-purchase breakfast rate of £601.24 nightly. | The nightly direct rate is not a verified full-stay total or proof that the Google result is the same room/rate. City-tax inclusion and final checkout total remain unresolved. The direct advance rate requires full prepayment and retains it on cancellation. No rate was booked. |
| [Flaine Forêt apartment, listing 47384817](https://www.airbnb.co.uk/rooms/47384817?check_in=2026-12-18&check_out=2026-12-20&adults=4&currency=GBP) | API displayed £633 total and a breakdown ending at £632.35. Airbnb's own page matched the £633 displayed total, four guests and exact dates. It described an entire rental unit in Flaine, one bedroom, four beds and capacity five. | Display rounding differs from the precise API breakdown; do not silently equate these amounts. Final checkout charges and any deposit remain unchecked. No reservation or hold was created. |

Airbnb's page advertised free cancellation before 13 December, check-in after 16:00 and checkout before 10:00. The precise cancellation time/time zone was not checked. Its listing description includes paid Wi-Fi and an optional paid parking arrangement; these should stay distinct from the accommodation's displayed total. Layout text and the sleeping-arrangement section are not perfectly aligned, so actual beds suitable for four friends remain a decision question.

### Product implications

- Keep separate evidence levels for provider extraction, source-page corroboration and supplier checkout verification. A working live request must not automatically mark all returned claims verified.
- A destination query is not a geographic constraint: results included Les Carroz, Morillon and Samoëns. Candidate evaluation needs explicit resort/location evidence before scoring price.
- A four-adult hotel query can still display two-person room categories and per-room nightly rates. Preserve occupancy, unit count, rate basis and mandatory charges independently.
- Preserve source precision and display rounding separately. Airbnb's rounded headline and detailed total should not look like two price changes.
- Model late checkout/early return against actual useful time at the destination. The midday Sunday flight is a diagnostic fixture selection, not a travel recommendation.

### Diagnostic change and validation

Both probe runners now return and ledger only allowlisted error categories, HTTP status and validated hexadecimal search IDs on provider failures. Arbitrary error strings, credential-bearing URLs and handoff tokens stay out of diagnostic output. Non-JSON HTTP errors retain their status without copying the body. No automatic retry was added. TypeScript build and all 16 targeted probe/diagnostic tests passed, including secret suppression and one-attempt failure behavior in both runners.

## Remaining acceptance steps

1. Finish airline-side verification of the four-adult return fare and booking-specific snowboard evidence; the Google source check is complete for the observed £452 figure.
2. Verify the hotel's complete payable total/allocation and the apartment's final charges without making bookings. Treat location, bed arrangement and cancellation terms as separate constraints.
3. Build the production adapter around durable search attempts, bounded costs and field-level evidence quality before expanding all-London coverage. These probes remain standalone diagnostics, with no hosted integration or candidate database writes.

Provider API references: [Google Flights](https://serpapi.com/google-flights-api), [Google Hotels](https://serpapi.com/google-hotels-api), [Search Archive API](https://serpapi.com/search-archive-api).
