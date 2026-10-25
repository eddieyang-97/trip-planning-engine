# Trip Planning Workspace

A shared trip-planning workspace with two interfaces to the **same accounts, trips, decisions and saved evidence**: a web app for itinerary review/collaboration and an authorized hosted MCP service for ChatGPT/Claude. Users can compare sourced choices, preserve reasoning and carry tentative selections into an itinerary. **A selection is not a booking**; external bookings are reported separately.

- **Web:** [Itinerary](https://trip-planning-engine.onrender.com/itinerary) and [account](https://trip-planning-engine.onrender.com/account) pages; manual trip organization, sharing, comments, maps, profiles, calendar export and saved research. See [web guide](docs/itinerary-web.md).
- **MCP:** authenticated trip, itinerary, research and bounded flight-search tools with separate grants, revision checks and persisted state. See [hosted search](docs/hosted-live-search.md) and [account linking](docs/account-linking.md).
- **Target cross-surface journey:** an authorized assistant saves a sourced stay/dining shortlist in a durable trip; the web app reviews, selects and tentatively places it on the itinerary; a fresh web/MCP read sees the same result. Feature scope and verified progress remain distinct; see [delivery status](docs/implementation.md).

## Current delivery and priorities

[Delivery status](docs/implementation.md) is the **single current capability/acceptance summary**. [GitHub Issues](https://github.com/eddieyang-97/trip-planning-engine/issues) are the only actionable backlog and priority source; [PRD](docs/prd.md) describes intended product behavior. Current work emphasizes accommodation comparison [#9](https://github.com/eddieyang-97/trip-planning-engine/issues/9), then dining [#10](https://github.com/eddieyang-97/trip-planning-engine/issues/10) and logistics [#8](https://github.com/eddieyang-97/trip-planning-engine/issues/8). An embedded model-backed planner is not part of the approved implementation.

The hosted service uses **Render + Supabase PostgreSQL/Auth**. Protected `main` runs build, PostgreSQL tests and browser CI; deployment and authenticated acceptance are separately verified. The connected Supabase project is **production**, not a sandbox; review [AGENTS.md](AGENTS.md) before any live operation. Pilot source coverage, missing costs, booking status and client interoperability must not be inferred from a green test or an accessible endpoint.

Start with the [documentation index](docs/README.md), [architecture](docs/architecture.md), [database reference](docs/database.md) and [user flows](docs/user-flows.md).

## Run locally

Requires **Node.js 24** and npm. No external provider account is needed for synthetic development.

```sh
npm ci
npm run demo
npm run dev
```

`npm run demo` uses synthetic flight fixtures; `npm run dev` serves a local MCP endpoint at `http://127.0.0.1:3000/mcp` with a bearer token in `.data/local-token` unless `LOCAL_TOKEN` is supplied. Settings are in `.env.example`. Local MCP cannot be reached by a cloud client without separate networking.

```sh
npm run build
npm test
npm run check
npm run test:e2e
```

For the browser suite, first install Chromium with `npx playwright install --only-shell chromium`; the [browser guide](docs/browser-testing.md) explains coverage. Tests use isolated fictional accounts/data. Live supplier queries are separately opt-in, authorized, metered and bounded; never run them as part of routine verification.

For end users connecting ChatGPT or Claude, follow [the connection guide](docs/connect-chatgpt-claude.md).

## The Flaine acceptance case

The synthetic example models four travelers going to Flaine via Geneva, **18–20 December 2026**, with snowboard equipment and London-origin constraints. The fixture does **not** represent actual fares, full airport coverage or confirmed equipment charges. See [`src/acceptance.ts`](src/acceptance.ts) and the [flight evidence/limitations](docs/hosted-live-search.md) instead of treating the example as bookable inventory.

## Shared model

`Trip → Decision → CriteriaVersion / Candidate / SearchRun → Observation`. Criteria versions and dated offer observations retain provenance; a selection pins its evidence and rationale; a later user-reported booking is a separate fact. Missing prices and source coverage remain **unknown**, never free or sold out. Trip/research writes use ownership checks, revisions and idempotency. Web and MCP share the same domain rules but have distinct authentication/grants. Details: [architecture](docs/architecture.md), [semantics](docs/data-semantics-review.md) and [correctness](docs/correctness-fixes.md).

## MCP tools

Representative operations: `list_trips`, `create_trip`, `get_trip`, `create_decision`, `update_decision_criteria`, `start_search`, `get_search_run`, `save_candidate`, `compare_candidates`, `select_candidate`, `record_booking`, itinerary operations and private policy notes. Exposed schemas and authorized client scope are authoritative; the list here is not a complete or guaranteed client catalogue. Background searches return durable run IDs for polling, not a reservation.

## Repository

- `src/`: HTTP/MCP adapters, authorization, trip/itinerary/research domain, database access and provider boundaries.
- `web/`: browser itinerary/account/consent experiences.
- `migrations/`: versioned application schema; `app_schema_migrations` is authoritative.
- `tests/`: domain, PostgreSQL and built-browser regressions.
- `docs/`: [current guidance](docs/README.md), product requirements, feature contracts, operations and separately identified historical research.

[Release procedures](docs/releases.md) describe the guarded deployment workflow and its limits. [AGENTS.md](AGENTS.md) sets engineering and documentation conventions.
