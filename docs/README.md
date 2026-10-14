# Documentation

Updated 14 October 2026. Start with the architecture and database diagrams, then user flows. Product decisions and delivery evidence follow. Dated research, observations and reviews retain the facts known at the time.

## Current guidance

| Document | Purpose |
| --- | --- |
| [High-level architecture](architecture.md#high-level-architecture) | Main system diagram, core data overview and accepted service/identity/execution decisions |
| [Database ER diagrams](database.md) | Deployed relationships and keys, plus a separately labelled viewer-sharing extension |
| [User flow diagrams](user-flows.md) | Sign-in, flight research, itinerary editing, viewer invitations and planned proposal approval |
| [Product requirements](prd.md) | Target behavior, scope and milestone order; PRD v0.4 gives web and MCP equal product standing |
| [Delivery status and acceptance](implementation.md) | Deployed capabilities, recorded acceptance and remaining gaps |

Requirements define what should exist; delivery status says what has been implemented, deployed and verified. Deployment alone does not complete acceptance. Use the most recent dated evidence section when an older record describes an earlier state.

## Feature guides and evidence

| Document | Scope |
| --- | --- |
| [Account linking](account-linking.md) | Configuration, consent, grants, revocation and dated OAuth/assistant acceptance |
| [Hosted flight pilot](hosted-live-search.md) | SerpApi scope, configured allowances, durable attempts, recovery and actual hosted search |
| [Itinerary web app](itinerary-web.md) | Manual organizer, deployed saved-research view and remaining cross-surface acceptance |
| [Private policy notes](policy-notes.md) | Versioned account-private manual references, separate from quote evidence |
| [Correctness fixes](correctness-fixes.md) | Budget, airport-zone identity and read consistency corrections with regression evidence |

## Diagnostics

| Document | Scope |
| --- | --- |
| [Flight probe](flight-probe.md) | Standalone six-request diagnostic; its live trial is separate from hosted search |
| [Accommodation probe](accommodation-probe.md) | Standalone hotel/rental/Airbnb diagnostics; no hosted accommodation provider |
| [11 October live probe results](spike/live-probe-results-2026-10-11.md) | Historical source observations/manual checks with unresolved quote and equipment questions |

Diagnostic success is evidence for the observed request, not permission to expand scope, a supplier guarantee or proof of complete trip suitability.

## Historical research and reviews

- [Spike index](spike/README.md): 3–11 October research, provider evaluations, original architecture and proposals.
- [Architecture review](architecture-review.md): findings against baseline `6b352e1`, with subsequent progress linked at the top.
- [Earlier implementation record](history/implementation-2026-10-11.md): preserved 8–11 October delivery and deployment history.

Files in `spike/design/` are proposals, not runtime contracts or applied schema. Runtime behavior is defined by `src/`; applied schema by `migrations/`. External prices, repository activity and supplier terms in dated research have not been refreshed by this organization change.

Keep architecture, ER and flow diagrams alongside the decisions and schema they describe. Update ER relationships when migrations change, and label local/proposed extensions until deployment is recorded. Keep new delivery evidence in the relevant feature guide and summarize it in `implementation.md`. Record accepted decisions in `architecture.md`; update product scope in the PRD. Preserve dated observations/reviews rather than rewriting them as current results.
