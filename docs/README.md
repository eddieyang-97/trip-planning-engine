# Documentation

Updated 23 October 2026. Use this index to find the authoritative guide for each topic. Start with current product requirements and delivery status; use architecture and database references for technical detail. Product decisions and delivery evidence follow. Dated research, observations and reviews retain the facts known at the time.

## Current guidance

| Document | Purpose |
| --- | --- |
| [High-level architecture](architecture.md#high-level-architecture) | Main system diagram, core data overview and accepted service/identity/execution decisions |
| [Database ER diagrams](database.md) | Initial ER baseline and extensions 007–012, including trip lifecycle 011 and research archive 012 |
| [User flow diagrams](user-flows.md) | Sign-in, flight research, itinerary editing, viewer invitations, deployed calendar export and planned proposal approval |
| [Product requirements](prd.md) | PRD v0.7: long-term product scope, completed October flight priority, open roadmap choices and release gates |
| [Delivery status and acceptance](implementation.md) | Dated deployed capabilities, acceptance evidence and remaining gaps |
| [Data Semantics Review](data-semantics-review.md) | Domain invariants, proposed decisions and migration gates; not a substitute for applied SQL |

**Planning versus evidence:** [Product requirements](prd.md) define intended behavior; [GitHub Issues](https://github.com/eddieyang-97/trip-planning-engine/issues) contain actionable deliverables; [current status](implementation.md#current-state--23-october-2026) records source, CI, deployment and independently observed acceptance. Security [#3](https://github.com/eddieyang-97/trip-planning-engine/issues/3), F1–F3 [#4–#6](https://github.com/eddieyang-97/trip-planning-engine/issues/4), releases [#14](https://github.com/eddieyang-97/trip-planning-engine/issues/14), browser regression [#2](https://github.com/eddieyang-97/trip-planning-engine/issues/2), research archive [#24](https://github.com/eddieyang-97/trip-planning-engine/issues/24) and manual production smoke [#28](https://github.com/eddieyang-97/trip-planning-engine/issues/28) are closed. The latter three have recorded PR/CI and bounded live acceptance; this does not establish every authenticated user journey or supplier-booking behavior. The next open feature candidates are [#7–#10](https://github.com/eddieyang-97/trip-planning-engine/issues/7).

**Current feature selection — 25 October:** The user selected [#9 accommodation](https://github.com/eddieyang-97/trip-planning-engine/issues/9) as P2/Now; see the [comparison guide](accommodation-comparison.md) and canonical [delivery record](implementation.md). No production schema application or normal connected-client acceptance is implied by source implementation.

**Current scope and deferred research:** Continue the MCP + native web itinerary/research product. [#10 dining](https://github.com/eddieyang-97/trip-planning-engine/issues/10) and [#8 group logistics](https://github.com/eddieyang-97/trip-planning-engine/issues/8) remain P2/Next; [#7 legacy import](https://github.com/eddieyang-97/trip-planning-engine/issues/7) is P3/Backlog. A first-party embedded agent [#31](https://github.com/eddieyang-97/trip-planning-engine/issues/31) and [Claude Duet design research #33](https://github.com/eddieyang-97/trip-planning-engine/issues/33) belong to **Deep Backlog**, not approved implementation. Prior [PR #32](https://github.com/eddieyang-97/trip-planning-engine/pull/32) closed unmerged.

**Production connector boundary:** Supabase MCP is for read-only schema/advisor/diagnostic verification by default, not general production database writes, applying migrations or revealing private trip records. Repository migrations tracked by `app_schema_migrations` remain authoritative. See [AGENTS.md](../AGENTS.md#connected-production-service-tools) and [release guidance](releases.md#connected-supabase-production-diagnostics).

## Feature guides and evidence

| Document | Scope |
| --- | --- |
| [ChatGPT and Claude user setup](connect-chatgpt-claude.md) | Friend-friendly connection, account, permissions and troubleshooting guide |
| [Account linking and persistent sign-in](account-linking.md) | Supabase/Brevo, browser session lifecycle, grants, revocation and dated OAuth/session acceptance |
| [Optional passkey pilot](passkeys.md) | Default-off sign-in/enrollment/removal, recovery, stable RP/domain rollout gate and isolated acceptance limits |
| [Trip lifecycle](trip-lifecycle.md) | Owner archive/restore, confirmed permanent deletion, leave-trip, retention and retry protections |
| [Database security investigation](database-security-2026-10-21.md) | Migration bootstrap hardening, read-only audit and October 30 grant compatibility; approved live repair; bootstrap release evidence |
| [Account profiles and trip members](account-profiles.md) | Editable names, private avatar uploads, accepted-member roster and profile privacy |
| [Itinerary map](itinerary-map.md) | Current map behavior, pin saving/read-back, presentation, source access and dated map acceptance |
| [Itinerary discussion](itinerary-comments.md) | Signed-in member comments, privacy, permissions and release evidence |
| [Itinerary timezone picker](itinerary-web.md#itinerary-timezone-picker--15-october-2026) | Picker semantics, iPhone touch regression and dated test evidence (consolidated into itinerary guide) |
| [Accommodation comparison](accommodation-comparison.md) | Typed manual/sourced whole-party lodging evidence, comparison and reviewed tentative-item linkage; source/acceptance boundaries |
| [Hosted flight search](hosted-live-search.md) | Bounded generalized F1/F2 live acceptance, F3 conditional ChatGPT selection/read-back, client gaps, limits and historical pilot evidence |
| [Guarded releases](releases.md) | CI/branch safeguards, verified manual post-deploy smoke, Supabase connector boundaries, worker draining and Render auto-deploy |
| [Itinerary web app](itinerary-web.md) | Manual organizer, deployed saved-research view and remaining cross-surface acceptance |
| [Calendar and comments hosted release](release-calendar-comments-2026-10-15.md) | Historical 15 October deployment, hosted smoke checks and acceptance limits |
| [Apple Calendar export](calendar-export.md) | Deployed individual/all/subset .ics export; saved-trip/native device acceptance pending |
| [Browser regression testing](browser-testing.md) | Built-app sharing/retry/revocation and lodging MCP → web review journeys; isolated setup and sanitized failure cases |
| [Itinerary sharing](itinerary-sharing.md) | Anonymous links, signed-in viewer/editor invitations, access privacy, revocation and acceptance |
| [Private policy notes](policy-notes.md) | Versioned account-private manual references, separate from quote evidence |
| [Correctness fixes](correctness-fixes.md) | Budget, airport-zone identity and read consistency corrections with regression evidence |

## Diagnostics

| Document | Scope |
| --- | --- |
| [Flight probe](flight-probe.md) | Standalone six-request diagnostic; its live trial is separate from hosted search |
| [Accommodation probe](accommodation-probe.md) | Standalone hotel/rental/Airbnb diagnostics; no hosted accommodation provider |
| [Apple Calendar probe](apple-calendar-probe.md) | User-confirmed three-event import on iPhone/iPad; agreed one-off export flow and pending production acceptance |
| [11 October live probe results](spike/live-probe-results-2026-10-11.md) | Historical source observations/manual checks with unresolved quote and equipment questions |

Diagnostic success is evidence for the observed request, not permission to expand scope, a supplier guarantee or proof of complete trip suitability.

## Historical research and reviews

- [Spike index](spike/README.md): 3–11 October research, provider evaluations, original architecture and proposals.
- [Architecture review](architecture-review.md): findings against baseline `6b352e1`, with subsequent progress linked at the top.
- [Earlier implementation record](history/implementation-2026-10-11.md): preserved 8–11 October delivery and deployment history.

Files in `spike/design/` are proposals, not runtime contracts or applied schema. Dated release reports preserve their original evidence even when feature status advances; avoid copying the same release report into several feature guides. Runtime behavior is defined by `src/`; applied schema by `migrations/`. External prices, repository activity and supplier terms in dated research have not been refreshed by this organization change.

Keep architecture, ER and flow diagrams alongside the decisions and schema they describe. Update ER relationships when migrations change, and label local/proposed extensions until deployment is recorded. Keep new delivery evidence in the relevant feature guide and summarize it in `implementation.md`. Record accepted decisions in `architecture.md`, new product priorities in the PRD and executable acceptance criteria in the corresponding GitHub Issue. Preserve dated observations/reviews rather than rewriting them as current results. Avoid a second independent backlog file.
