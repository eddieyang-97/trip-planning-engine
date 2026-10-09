# Hotel and restaurant API spike — 9 October 2026

## Recommendation

Continue this as a small parallel provider spike. Keep the existing Render service and Supabase database; no additional infrastructure is needed. Separate three capabilities: property/place discovery, dated hotel rates, and dated restaurant table availability. A place listing or booking link proves neither a room nor a table is available.

For hotel research, test Google Hotels through the same SerpApi account proposed for flights once its key is available. This is a conditional research/click-out option: room allocation, total price, cancellation terms and permitted retention still need validation. Evaluate LiteAPI separately if room-level quotes are essential, especially for multiple rooms. Its booking-oriented commercial model needs checking against a research product whose users may book elsewhere.

For restaurants, begin with discovery, source links, manually reported preferences and external booking links. OpenStreetMap is useful open data, but the public Overpass servers failed our live trial. Treat it as a prototype source; do not promise reliable hosted searches yet. Google Places is a stronger candidate when richer coverage justifies billing setup and its display/storage restrictions. Reservation inventory should remain a separate optional integration. Do not build a reservation API by treating directory tags, opening hours or a booking URL as table availability.

This spike prepares contracts and an isolated diagnostic command. It does not register hotel or restaurant MCP tools, migrate production tables, or change the hosted service. The existing flight and account-linking acceptance work remains outstanding.

## Hotel providers

| Provider | Access and cost | What it can establish | Fit and unresolved questions |
| --- | --- | --- | --- |
| Booking.com Demand | Managed Affiliate Partner, signed contract, Partner Centre access, API key and affiliate ID; no generally available self-service production free tier established | Accommodation search; supported integrations can redirect or book. Sandbox data is not live inventory | Strong eventual option, but the connected Booking.com tool available in this chat does not give our backend a Demand API credential or reuse rights |
| Expedia Rapid | Partner approval, development credentials, launch requirements and production review; commercial terms depend on the agreement | Shopping, room/rate details and booking workflows | Substantial onboarding for this personal research pilot; no approval or production access obtained |
| SerpApi Google Hotels | SerpApi account/key and search-credit quota; shared budget with flight diagnostics. Recheck account plan before live requests | Dated Google Hotels results, indicative rates and property/provider detail links; fields can include nightly and total rates | Promising click-out pilot. A four-adult query does not establish a quote for two specific rooms. Validate taxes, seller handoff, room selection and cancellation; do not label an indexed result a held or guaranteed bookable offer |
| LiteAPI / Nuitee Connect | Self-service sandbox; live onboarding/payment setup. Published core rate/prebook/book API access is free subject to terms and reasonable look-to-book use; optional price index is $0.05/request and Places $0.01/request | Hotel-rate search with room occupancies, rate plans and cancellation data; prebook/revalidation and booking are separate stages | Most promising direct hotel API to investigate next. Confirm whether search-only/external-booking use is supported. Guest nationality is a required search input and is not yet known for our test |

Sources: [Booking.com prerequisites](https://developers.booking.com/demand/docs/getting-started/prerequisites), [Demand overview](https://developers.booking.com/demand/docs), [Booking.com sandbox](https://developers.booking.com/demand/docs/getting-started/try-out-the-api), [Expedia Rapid setup](https://developers.expediagroup.com/rapid/setup), [SerpApi Google Hotels API](https://serpapi.com/google-hotels-api), [LiteAPI rates](https://docs.liteapi.travel/reference/post_hotels-rates), [LiteAPI pricing](https://docs.liteapi.travel/reference/api-pricing-usage-costs), [LiteAPI booking workflow](https://docs.liteapi.travel/docs/booking-a-room). Prices and access conditions are a dated snapshot, not an account-specific quote.

## Restaurant discovery and availability

| Source | Access and cost | Useful evidence | Limitations |
| --- | --- | --- | --- |
| OpenStreetMap through Overpass | No API key for the tested public instances; community resources, no production SLA | Names, coordinates, cuisine tags, supplied hours and websites; lodging locations too | Coverage can be stale/incomplete. ODbL attribution and applicable database obligations must travel with the data. Public endpoint reliability failed our trial |
| Google Places | Google Cloud project, billing and API key. Published Text Search Pro: 5,000 free monthly events, then $32/1,000 in the first paid tier; Place Details Pro: 5,000 then $17/1,000 | Richer directory/place metadata; fields determine billing SKU | No general table inventory. Storage/caching is restricted, with exceptions such as indefinite place-ID storage. Respect Google attribution and map-display rules; do not persist unrestricted copies as our own directory |
| Foursquare Places | Developer credentials and usage billing. New API Pro pricing from June 2026: first 500 calls free, then $15/1,000 for the 501–100,000 band | Place discovery and details | Legacy V3 was deprecated in May 2026; use current endpoint/version. Premium fields have different pricing. No table inventory; inspect retention/display terms before persistence |
| OpenTable | Integration partner approval and scoped access; no public unrestricted production/free reservation tier established | Approved availability and reservation workflows | Availability access is a separate grant, not a consequence of knowing an OpenTable URL |
| TheFork | Contract/partner access and associated limits | Authorized restaurant availability and management workflows | The B2B restaurant-management API is not an open consumer-wide reservation feed |
| Zenchef | Restaurant or integration-partner onboarding; request documentation/demo access | Potentially relevant to French restaurants and booking integrations | No open consumer-wide availability entitlement established. A restaurant's external booking widget can be linked without claiming our backend can query it |

Sources: [Overpass public instances and resource guidance](https://wiki.openstreetmap.org/wiki/Overpass_API), [Overpass commons](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html), [OSM copyright/ODbL](https://www.openstreetmap.org/copyright), [Google Maps pricing](https://developers.google.com/maps/billing-and-pricing/pricing), [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies), [Foursquare API changes](https://docs.foursquare.com/developer/reference/upcoming-changes), [Foursquare current details API](https://docs.foursquare.com/fsq-developers-places/reference/place-details), [OpenTable developer portal](https://docs.opentable.com/), [TheFork getting started](https://docs.thefork.io/getting-started), [TheFork B2B introduction](https://docs.thefork.io/B2B-API/introduction), [Zenchef API access](https://help.zenchef.com/hc/en-gb/articles/27690768125597-Zenchef-API).

## Actual live checks

These are capability checks, not a completed hotel shortlist or a production integration acceptance test.

| Check on 9 October 2026 | Result | What remains unproven |
| --- | --- | --- |
| Connected Booking.com accommodation search: Flaine, 18–20 December 2026, four adults, two rooms, GBP, UK booker | Two accommodations returned with property identifiers, prices, ratings, coordinates and dated Booking.com links | Two-room allocation, complete mandatory charges, room-specific terms, cancellation and final seller revalidation were not established. No booking was made. No backend Demand API access was obtained |
| FOSSGIS Overpass, initial Flaine place-name lookup | HTTP 504; stopped before nearby-place search | No normalized place evidence saved |
| FOSSGIS Overpass, bounded northern-Alps lookup | HTTP 504; stopped before nearby-place search | No normalized place evidence saved |
| Private Coffee Overpass, same bounded lookup | HTTP 500; stopped before nearby-place search | No normalized place evidence saved; current diagnostic endpoint remains this documented alternative |

Confirmed user inputs are the travel dates, four travelers and destination. Four adults, two rooms and UK booker context were explicitly labelled test assumptions. In particular, UK booker context does not establish guest nationality. Hotel room configuration, budget and cancellation needs remain unconfirmed. The connector payload is not committed to the repository, and its returned prices are not promoted to normalized live quote records.

## Contracts and comparison rules

[`src/stay-dining.ts`](../../src/stay-dining.ts) defines proposed TypeScript interfaces, not runtime-validated public input schemas:

- `HotelSearch` specifies each room's adults and child ages. Hard requirements are separate from preference priority. Guest nationality may be unknown until a provider requires it.
- `HotelRateObservation` separates requested from quoted occupancy, rate plan, meals, payment timing, cancellation penalties and late-arrival evidence. An amount has an explicit basis; unknown taxes or room allocation prevent claiming a complete all-room stay total.
- `SourceEvidence` distinguishes sandbox, production and connector observations, timestamps, attribution and retention review. Unknown expiry remains null; no supplier validity window is invented.
- `PlaceDiscoveryProvider` returns directory evidence. `RestaurantAvailabilityProvider` separately returns slots for a date, party and time zone. No returned slots means only that the provider returned none for that request, not that the restaurant is fully booked everywhere.

Use the existing hard-constraint pass/fail/unknown approach when these types enter the decision engine. Hotels should compare verified full-stay totals for the same occupancy; restaurant menu estimates must remain separate from booking deposits. Walking time, dietary suitability and arrival feasibility require their own evidence. Unknown facts remain unknown and cannot silently become passing constraints or zero costs. Preference ranking and database persistence are not implemented by this spike.

## Run the place-discovery probe

```sh
npm run probe:places
# Explicit network opt-in, at most two sequential read-only requests:
npm run probe:places -- --live
```

The default prints a plan and makes no network requests. Live mode resolves Flaine within a northern French Alps bounding box, requires one unambiguous mapped location, and searches within 2.5 km for dining/lodging. It identifies itself to the server, applies timeouts, uses no automatic retry, rejects provider warning/partial-result responses, and caps output at 100 normalized places. Coverage is always labelled incomplete. Results preserve attribution, map-element links, source edit dates and fetch times; map edit dates do not prove venue information was recently verified.

Successful results are written only to ignored `.data/places-probe/` files. Failed requests leave no successful evidence artifact. Do not repeatedly run against an overloaded public endpoint; select a supported hosted/commercial source before depending on regular searches. OSM's data license is separate from application code licenses; no third-party GPL/AGPL implementation was copied.

## Next acceptance gates

1. With a SerpApi key available, run a bounded hotel diagnostic using the Flaine dates. Inspect both initial search and selected property details; record request count and which quote fields are genuinely present. Keep this budget separate from the existing six-search flight allowance.
2. Confirm actual room occupancy and guest nationality before testing a provider that requires them. If SerpApi cannot establish a comparable room configuration, evaluate LiteAPI sandbox, then a small production rate search once its access and search-only commercial fit are established. Sandbox success must never count as live availability validation.
3. Obtain one successful dated restaurant discovery response and inspect Flaine coverage. Retain source links and attribution; use provider-approved fields and retention. Do not add automatic refresh jobs or another service for the pilot.
4. Add runtime validation, ownership, provider-specific budgets, persistent evidence and bounded query tools only after these observations support a usable capability. Hotel/dining tools should inherit the existing MCP permissions and decision model.
5. Keep restaurant booking external initially. Add slot searching only when a provider grants the required access. No reservation or payment action is part of this spike.

Validation: TypeScript build and all 35 tests passed, including five new place-normalization/query tests. The zero-network probe passed. These checks verify local behavior; they do not turn failed live Overpass requests or connector-only hotel access into working production backend integrations.
