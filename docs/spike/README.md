# Historical research and design spike

Research and proposals recorded 3–11 October 2026. Index clarified 13 October. This folder preserves the investigation that informed the product; it is not the current architecture or delivery-status source.

Start with the [documentation index](../README.md), [accepted architecture decisions](../architecture.md), [PRD v0.4](../prd.md) and [current delivery status](../implementation.md).

## Decisions that supersede the original spike

| Original proposal | Current decision / evidence |
| --- | --- |
| MCP-first product with a later full web app | Web and MCP are first-class surfaces over the same account/trip; organizer foundation across both, then collaboration |
| Paid always-on Render recommendation | Existing Free Render service plus Supabase; durable in-process jobs with limited progress while the service sleeps |
| SerpApi only a conditional diagnostic candidate | Live probes completed; narrow hosted flight pilot deployed and first authenticated run completed |
| Account linking and hosted access wholly unproved | Direct sign-in, official-SDK OAuth/search, initial ChatGPT linking and connected retrieval succeeded; broader acceptance remains open |
| Hotel/place integrations before later collaboration | Complete organizer foundation and collaboration before hosted accommodation search; manual stays/transfers/activities remain useful meanwhile |

Supplier rights, exact-party totals, snowboard evidence and broader coverage remain unresolved. These decisions do not establish production permission or bookable inventory.

## Dated research and observations

| Document | Role |
| --- | --- |
| [Repository/provider research](research.md) | 3 October snapshot of projects, licenses, pricing and access; external claims have not been revalidated by this cleanup |
| [Flight provider evaluation](live-flight-provider-validation.md) | 9 October public-document assessment and commercial/capability questions |
| [Accommodation/restaurant evaluation](hotel-restaurant-providers.md) | 9 October findings and later diagnostic follow-up; no hosted stay/table integration |
| [11 October live probes](live-probe-results-2026-10-11.md) | Actual diagnostics/manual checks; historical evidence rather than current fares |
| [Flaine input](fixtures/flaine-input.json) | Original confirmed inputs and explicit assumptions |
| [3 October connector observation](fixtures/flaine-connector-observation.json) | Historical Trip.com evidence; not a production fixture or booking guarantee |

## Superseded design and current acceptance

- [Original architecture proposal](architecture.md): retained as the 3 October recommendation; superseded by [current architecture](../architecture.md).
- [Domain interfaces](design/domain.ts), [provider contract](design/provider.ts) and [schema proposal](design/schema.sql): unimplemented design artifacts. Use `src/` and `migrations/` for executable behavior.
- [Flaine acceptance checklist](acceptance.md): current evidence mapping for the original scenario, separating automated checks, hosted acceptance and unresolved requirements.

Preserve dated observations and original proposal bodies. Add links to subsequent evidence rather than rewriting historical prices, tests or recommendations as current facts.
