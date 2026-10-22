# Trip Planning Workspace

A shared trip planning product with two first-class surfaces: a web app for researching, organizing and collaborating on trips, and a hosted MCP interface for working on those same trips through an assistant. Both use the same accounts, saved plans, decisions and evidence.

The product helps people compare travel choices, retain their reasoning and turn decisions into a clear itinerary that replaces a separate Google Doc. Research uses explicit constraints, dated source evidence and repeatable searches. Bookings happen externally and are recorded separately from selected plans.

“Trip Planning Workspace” is the working product name. The repository, package and deployment identifiers remain `trip-planning-engine`.

## Product surfaces

| Surface | Product role | Current slice |
| --- | --- | --- |
| Web app | Use the trip directly: review saved research, organize an itinerary and collaborate without an assistant account | Deployed manual organizer, shared viewing/editor access, signed-in comments, map pins, profiles, calendar export and saved-flight drafts; fuller research controls and remaining real-device/account acceptance are separate increments |
| MCP | Let a connected assistant retrieve and update the same trip, research options, explain trade-offs and manage the plan | Deployed persistent decisions, bounded live pilot, comparisons, selections, itinerary and private policy tools; official-SDK OAuth/search and connected retrieval verified |

Both surfaces are core to the product. Their interfaces can suit different tasks, while shared operations retain the same permissions, facts and revision rules. Delivery proceeds in independently verified increments. Existing invitations and comments are implemented; advanced proposals remain conditional. The [PRD](docs/prd.md) defines target behavior and current priorities; [implementation notes](docs/implementation.md) track delivered behavior and acceptance gaps.

**Recorded 14 October pilot release:** the [web app](https://trip-planning-engine.onrender.com/itinerary), accounts, MCP, saved flight research and [itinerary sharing](docs/itinerary-sharing.md) are deployed on Free Render + Supabase. Release `1444ac8` passed all **81 CI tests** and deployed successfully after Render's outage. View links open without an account, support optional expiry and can be revoked; two hosted visitors and revocation passed on a fictional test trip. Editors still sign in. Overview and sticky detailed day navigation are included. Later comment, map, calendar and profile releases are documented in the [current delivery record](docs/implementation.md) and dated feature guides; this paragraph is the **14 October snapshot**, not a claim of current release status.

Start with the [high-level architecture](docs/architecture.md#high-level-architecture), [database ER diagrams](docs/database.md) and [user flows](docs/user-flows.md). The [documentation index](docs/README.md) also links product requirements, delivery evidence and historical research.

Account-confirmation emails use Supabase Auth with [Brevo custom SMTP](docs/account-linking.md#account-email-delivery). A second account received and confirmed its email, signed in and joined a view-only itinerary; organizer revocation then removed access. Organizers share trip invitation links manually. This is pilot acceptance, not a guarantee of delivery to every mailbox.

## Current delivery and priorities (22 October 2026)

The [PRD](docs/prd.md) defines the intended product, [GitHub Issues](https://github.com/eddieyang-97/trip-planning-engine/issues) are the sole actionable queue, and [delivery status](docs/implementation.md) distinguishes implemented, deployed and actually accepted behavior.

- **Completed/closed:** database security bootstrap audit [#3](https://github.com/eddieyang-97/trip-planning-engine/issues/3); bounded generalized flight discovery [F1 #4](https://github.com/eddieyang-97/trip-planning-engine/issues/4), multi-airport coverage [F2 #5](https://github.com/eddieyang-97/trip-planning-engine/issues/5), and ChatGPT conditional selection/read-back [F3 #6](https://github.com/eddieyang-97/trip-planning-engine/issues/6). Flight amounts remain research evidence, not confirmed whole-party bookable totals; F3 closure does not establish a single complete hosted new-search journey.
- **Operations:** guarded Render service auto-deploy uses `checksPass` after main CI; [#14](https://github.com/eddieyang-97/trip-planning-engine/issues/14) tracks outstanding failed-CI prevention and operational acceptance. Blueprint Auto Sync remains off.
- **Open follow-ups:** [#21](https://github.com/eddieyang-97/trip-planning-engine/issues/21) for ChatGPT one-way schema exposure and independent Claude compatibility; [#2](https://github.com/eddieyang-97/trip-planning-engine/issues/2) browser E2E; [#7–#10](https://github.com/eddieyang-97/trip-planning-engine/issues/7) for itinerary import, group logistics, accommodation and dining.

**No new primary product implementation has been selected since closing F3.** Treat the closed F1–F3 issue titles and older pilot reports as dated history, not present work instructions.

## Run locally

**Using ChatGPT or Claude?** See the [friend-friendly connection guide](docs/connect-chatgpt-claude.md) for account setup, supported plans and permissions.

The [itinerary web app](docs/itinerary-web.md) provides the organizer and saved research at `/itinerary`, using the same persistent trip state as MCP. Open `/itinerary?demo=1` for a labelled, editable Flaine preview; example data resets on reload. Hosted users sign in through `/account`; no MCP client or assistant account is required. Real sign-in and research viewing passed. Account-free view links and signed-in editor invitations are deployed. Hosted anonymous read/revocation passed; discussion and broader hosted edit continuity remain later work.

Requires Node.js 24 and npm. No provider account or database installation is needed.

```sh
npm ci
npm run demo
npm run dev
```

`demo` uses a temporary in-memory PostgreSQL database, runs the Flaine example and prints the comparison. `dev` starts a persistent database in `.data/postgres` and serves MCP at `http://127.0.0.1:3000/mcp`. Settings are in `.env.example`; copy it to `.env` if needed. A local bearer token is generated in `.data/local-token` unless `LOCAL_TOKEN` is set. Configure a compatible **local HTTP MCP client** to send `Authorization: Bearer <that token>`. The token is never printed to service logs. This endpoint is reachable only on this computer; a cloud chat client cannot reach it.

The job runners use the same process. `start_search` returns a run ID; use `get_search_run` to poll. Synthetic fixtures are labelled and use example.com links. `provider: live` requires explicit `LIVE_SEARCH_ENABLED=true`, a backend `SERPAPI_API_KEY`, an authorized search and the existing quota. The deployed generalized adapter supports bounded searches for future dates, economy/GBP, one destination, 1–6 origin airports and 1–9 adults: round trips use a combined outbound query and at most two return expansions; one-way runs query up to three origins separately. A run reserves at most three provider requests. Coverage is explicitly partial, and provider-reported prices do not establish a verified whole-party total or booking availability. See [hosted flight search](docs/hosted-live-search.md) for client/schema limitations and precise evidence.

```sh
npm test
npm run check
npm run build
npm start
```

`npm start` uses the compiled app with the same mode and data path. Stop the dev process first; only one process should open a given embedded database. Tests use isolated databases and do not contact flight suppliers, Supabase or other external APIs.

## The Flaine acceptance case

Confirmed inputs: **18–20 December 2026, four travelers, snowboard, all London airports**: LHR, LGW, LTN, STN, LCY and SEN.

Working assumptions: four adults, one snowboard for the party, Geneva gateway, economy examples, maximum two stops and demonstration score weights. Ages, equipment dimensions/weight, transfer arrangements, budget and departure restrictions remain unconfirmed. The fixture covers LGW only and explicitly reports the other five airports as unknown coverage. The synthetic comparison yields:

| Example | Flight price for party | Snowboard fee | Comparable total | Result |
| --- | ---: | ---: | ---: | --- |
| TEST101 | £480 | Unknown | Unknown | Conditional |
| TEST102 | £620 | £90 for one board, both directions | £710 | Meets the modeled flight constraints |
| TEST103 | £150 with unknown price basis | Unknown | Unknown | Conditional |

These are invented test cases, not researched fares. Even the complete example does not establish transfer feasibility or overall trip suitability. Selection and booking reports are separate records; synthetic evidence cannot be recorded as booked. Manually supplied evidence and booking reports remain unverified and labelled `user_reported`.

## Shared model

The web app and MCP call one shared service. Hosted state lives in Supabase Postgres; persisted jobs run inside the existing Node process. Local development uses embedded PostgreSQL and synthetic fixtures. See the [current architecture](docs/architecture.md#service-boundaries) for the service diagram and accepted boundaries.

`Trip → Decision → CriteriaVersion / Candidate / SearchRun → Observation`. A candidate identifies a flight itinerary; observations preserve separate dated prices and evidence. Runs reference immutable criteria versions. Selections snapshot the evaluation and rationale. Booking records capture only the user's report of an external booking.

Hard constraints produce pass/fail/unknown verdicts before preference scoring. Utility uses fixed cost and duration anchors, so adding a candidate does not change existing scores. Missing costs produce score intervals, never zero-priced equipment. Comparisons list eligible options before conditional and ineligible ones, then order by the lower score bound. Overlapping intervals do not establish a winner. Repeated searches compare like-for-like fare bases; changed criteria suppress price deltas. Missing results are never labelled sold out.

The [architecture-review corrections](docs/correctness-fixes.md) make known over-budget costs fail even when equipment costs are missing, derive flight-local times from a reviewed airport-zone catalogue, and return Core reads from one database snapshot. Historical evidence remains intact. Broader airport coverage and remaining product/security acceptance are tracked in [delivery status](docs/implementation.md).

Mutations require an idempotency key. Mutable decision/itinerary updates also require the last observed revision. Retrying identical input returns the original result; reusing the key with different input fails. Operations check the authenticated owner; MCP additionally checks the stored client grant/version. Supplier/user text is treated as evidence, not instructions.

## MCP tools

| Purpose | Tools |
| --- | --- |
| Trips and evidence | `list_trips`, `create_trip`, `get_trip`, `get_decision` |
| Manual itinerary | `get_itinerary`, `add_itinerary_item`, `update_itinerary_item`, `remove_itinerary_item`, `move_itinerary_item` |
| Private policy notes | `create_policy_note`, `update_policy_note`, `get_policy_note`, `list_policy_notes` |
| Decision criteria | `create_decision`, `update_decision_criteria` |
| Search | `start_search`, `get_search_run` |
| Research | `save_candidate`, `compare_candidates`, `compare_search_runs` |
| Outcomes | `set_candidate_disposition`, `select_candidate`, `record_booking` |

The HTTP transport is stateless; application data is persistent. There is no SSE subscription or server session to recover. Clients poll saved runs. Tool errors are structured, with `isError: true`; transport authentication failures are HTTP 401.

[Private policy notes](docs/policy-notes.md) retain manually curated airline rules with sources, applicability and review dates. Updates append versions; comparisons and selections can reference an exact version. Notes are reusable across the owner's trips and remain separate from quote totals and availability. The four tools are included in the hosted release; a dedicated real-account note workflow has not been recorded.

## Repository

```text
src/
  app.ts           MCP adapter and HTTP protections
  auth.ts          Local token / hosted JWT verification
  accounts.ts      Direct-session sign-in verification, consent and revocation
  itinerary.ts     Shared manual itinerary validation, persistence and history
  itinerary-research.ts Bounded saved-research projection for the organizer
  itinerary-web.ts Direct-session web API and itinerary asset routes
  core.ts          Ownership, persistence, tools, fixture jobs
  domain.ts        Runtime TypeScript schemas and scoring
  database.ts      Embedded / external PostgreSQL adapters
  providers.ts     Provider boundary and synthetic examples
  live-provider.ts Narrow SerpApi normalization and scope validation
  live-search.ts   Durable attempts, allowance admission and safe live recovery
  policies.ts      Private, versioned policy notes and review reminders
  acceptance.ts    Confirmed Flaine inputs and assumptions
  main.ts          Configuration and process lifecycle
migrations/        Executable scaffold database schema
web/               Itinerary app, account and OAuth consent pages
tests/             Domain, persistence, authorization and MCP tests
scripts/           Demo, migration and build asset scripts
docs/README.md     Documentation index
docs/prd.md        Product requirements
docs/architecture.md Accepted decisions and current architecture
docs/database.md   Database ER diagrams and migration relationships
docs/user-flows.md Current journeys and labelled target flows
docs/implementation.md Current delivery status and acceptance
docs/spike/        Historical research and design proposals
docs/history/      Earlier implementation records
```

The executable schema normalizes relationships and versions while storing validated criteria and offer payloads in JSONB. The larger schema in `docs/spike/design` is a design proposal, not the applied migration. No application code was copied from the reviewed trip-planning projects. Dependency licenses remain their respective owners' licenses; no license has yet been chosen for this repository.

## Next milestone

**Current status (22 October 2026):** The bounded F1/F2 flight implementation and F3's persisted ChatGPT conditional selection/read-back are delivered; [#4](https://github.com/eddieyang-97/trip-planning-engine/issues/4), [#5](https://github.com/eddieyang-97/trip-planning-engine/issues/5) and [#6](https://github.com/eddieyang-97/trip-planning-engine/issues/6) are closed. Follow-up [#21](https://github.com/eddieyang-97/trip-planning-engine/issues/21) isolates the unresolved ChatGPT one-way metadata and Claude checks. [Security #3](https://github.com/eddieyang-97/trip-planning-engine/issues/3) is closed; [guarded deployment #14](https://github.com/eddieyang-97/trip-planning-engine/issues/14) and [browser E2E #2](https://github.com/eddieyang-97/trip-planning-engine/issues/2) retain remaining acceptance. Do not interpret closed issues as proof of unsupported client behavior or bookable fares.

The long-term product direction remains the shared itinerary and sourced accommodation/restaurant research. Follow-on tasks cover [import](https://github.com/eddieyang-97/trip-planning-engine/issues/7), [participant logistics](https://github.com/eddieyang-97/trip-planning-engine/issues/8), [stay comparison](https://github.com/eddieyang-97/trip-planning-engine/issues/9) and [restaurant shortlists](https://github.com/eddieyang-97/trip-planning-engine/issues/10). The focused [browser E2E](https://github.com/eddieyang-97/trip-planning-engine/issues/2) remains separate. Consult the [priority rationale](docs/prd.md#12-incremental-roadmap-and-execution-backlog) and [GitHub Issues](https://github.com/eddieyang-97/trip-planning-engine/issues) for the executable queue. No live supplier calls or production changes are authorized by these priorities.

The standalone [flight](docs/flight-probe.md) and [accommodation](docs/accommodation-probe.md) diagnostics ran live on 11 October; their [dated results](docs/spike/live-probe-results-2026-10-11.md) preserve source checks and unresolved costs. They remain separate from hosted search and do not enable accommodation tools. `npm run probe:places` prints a zero-network plan; recorded public Overpass trials failed. Connected Booking.com access does not grant reusable backend API access.

See [account linking](docs/account-linking.md) for completed OAuth/retrieval proof and remaining refresh/revocation, second-account and other-assistant checks. Shared state and permissions are acceptance requirements for both surfaces.

The deployed [Blueprint](render.yaml) uses Free compute and applies migrations at startup. Service auto-deploy is configured for `checksPass` on the protected `main` branch; **Blueprint Auto Sync stays off** and configuration changes are manually coordinated. Release gate acceptance is tracked separately in [#14](https://github.com/eddieyang-97/trip-planning-engine/issues/14) and the [release guide](docs/releases.md). The service checks database availability on `/health` and refuses local mode on Render. GitHub Actions runs the build and tests.
