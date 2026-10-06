# Travel Research Engine — technical/product spike

3 October 2026 · Proposed design · Companion to PRD v0.2

## Recommendation

Build a persistent travel decision service, exposed through remote MCP. The valuable product is remembered criteria, comparable evidence, an explainable shortlist and repeat searches. Generic itinerary generation adds little to this first use case. ChatGPT and Claude provide the conversational layer; no backend LLM is needed initially. Collaboration and a full web app remain deferred.

Start with fixed-date flight research, with explicit baggage and transfer uncertainty. Use **one Render Node service plus Supabase**. Serve MCP and minimal account/consent pages from that service. Evaluate **SerpApi as the first pilot flight adapter**, subject to confirming permitted display/retention and testing exact-party fares. Do not commit the product to Duffel: its standard agreement prohibits metasearch. Keep manual, attributed observations as a useful fallback, clearly distinct from provider-verified offers.

This is a completed research/design deliverable, **not a completed integration proof**. Public source and provider documentation were inspected. One live Trip.com connector search was performed. No project provider credentials, deployed MCP endpoint or authenticated ChatGPT/Claude connection were available, so those acceptance gates remain open. No repository was scaffolded, no paid plan activated and no GPL/AGPL code copied.

## Deliverables

- [Repository and API research](research.md): source-level findings, licenses, access, pricing, maintenance and reuse decisions.
- [Architecture and delivery plan](architecture.md): hosting, auth, tool contracts, ranking, structure and roadmap.
- [TypeScript domain design](design/domain.ts) and [provider contract](design/provider.ts).
- [Relational schema proposal](design/schema.sql): design DDL, not a deployed migration.
- [Flaine acceptance specification](acceptance.md) and [confirmed/provisional inputs](fixtures/flaine-input.json).
- [Live connector observation](fixtures/flaine-connector-observation.json): diagnostic evidence, not a production provider fixture or bookable quote guarantee.

## Decisions this spike changes

1. **MCP is an interface, not the application.** Authorization, durable searches and scoring live in a transport-independent core so a later shared web view uses identical behavior.
2. **SearchRun is not a child of one Candidate.** A decision has criteria versions, runs and candidates; a run yields observations for many candidates, and a candidate survives across runs. Prices belong to dated observations, not to the candidate identity.
3. **Unknown required facts prevent an unqualified recommendation.** A cheap fare with unknown snowboard carriage is conditional, not eligible by default. An unknown price component is not zero.
4. **Evidence retention is provider-specific.** A durable decision history does not imply permission to retain every provider payload indefinitely. Store allowed IDs, timestamps and user decisions; expire restricted content.
5. **Access is the critical path.** A polished itinerary UI cannot resolve missing inventory rights, fare completeness or account linking. These get small measurable tests before a larger build.

## First build gate

Implement a small proof only after this design is reviewed: sign in through both target clients, create/read the same private trip, call one permitted flight source for four travelers, persist a dated observation, and repeat safely after a timeout. Require real group-price semantics, explicit missing baggage, account isolation and bounded search spend. If the provider cannot satisfy those conditions, keep the product as a saved-decision workspace with manual evidence while changing the adapter; do not describe it as verified live comparison.
