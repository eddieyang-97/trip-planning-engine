# Delivery status and acceptance

Updated 22 October 2026. Current decisions are in the [architecture](architecture.md) and [current PRD](prd.md). This summarizes dated deployment and acceptance evidence; earlier release snapshots below are preserved as historical records.

## Guarded release preparation — 22 October 2026

[Issue #14](https://github.com/eddieyang-97/trip-planning-engine/issues/14) prepares validated commit/schema health metadata, a read-only exact-SHA smoke command, an isolated journaled-worker drain regression and a 180-second Render shutdown allowance. Eight focused runtime/configuration/MCP tests and local check/build pass. `autoDeployTrigger` stays **off** pending release safeguards and platform activation evidence. GitHub's active `main-ci-release` ruleset (25630562) was verified through read-back: `main` protected, PR required, strict GitHub Actions `test`, no bypass actors, resolved review threads and force-push/deletion restrictions. [Release guidance](releases.md) records procedures and limits.

The user already manually deployed merged F3 `266ffc2`; the Render view, successful startup and public/authenticated MCP read-only smoke were inspected. This establishes exact baseline deployment evidence, not rollout of the new ops source, automated deployment, client-schema refresh or full F3 acceptance. Existing Render notifications inherit failure-only delivery. No supplier search or trip write was made.

## Prepared F3 decision workflow — 22 October 2026

`get_decision` now returns current selections with saved rationale, original criteria, frozen evaluation and pinned observation independent of pagination; `get_trip` uses the same owner-only context. The official-SDK deterministic return/one-way workflows exercise criteria through persisted search, comparison, shortlist, selection and fresh read-back, including retries, changed criteria and access boundaries. Read-only hosted acceptance tooling now checks server flight metadata. No migration or provider/configuration change is needed; the source change has not been deployed. See [F3 scope and metadata diagnosis](hosted-live-search.md#f3-decision-read-back-and-metadata-diagnosis--22-october-2026).

These fixtures do not close [F3 #6](https://github.com/eddieyang-97/trip-planning-engine/issues/6): refreshed ChatGPT one-way and complete conversational selection/read-back, Claude acceptance and exact deployed SHA remain unverified. No supplier request, real-trip mutation or deployment was performed.

## Hosted F1/F2 MCP acceptance — 22 October 2026

The user reported deploying the latest merged `main` build; the exact Render deployment SHA was **not independently inspected**. An authorized real-account ChatGPT MCP test then proved live generalized multi-airport return discovery: a future LHR/LGW/LTN → GVA flight decision returned a persisted versioned combined-airport plan. The live run finished `complete` with **3/3 SerpApi flight-search attempts successful**, **0 result-validation failures**, and **10 provider-reported observations** (LGW/LTN return expansions). LHR was included in the combined outbound query but did not receive one of the two return expansions; no absence or sold-out claim is justified. A fresh `get_decision` read-back returned all ten saved observations, and `compare_candidates` evaluated all ten. All observed amounts still had `priceBasis: unknown` and `exactPartyQuoted: false`; these are neither guaranteed party totals nor bookable offers. No supplier booking or payment was made.

**F3 client limitation:** The ChatGPT-exposed `create_decision` schema still requires `criteria.inbound` to be a date, rejecting `null` before transport for a one-way test despite the server-side implementation and isolated SDK tests supporting one-way. A labelled Hong Kong test trip was created, but no Hong Kong decision or supplier request was created; the return-search test decision remains labelled in the user's existing trip. Refresh/re-publish the connected MCP tool schema and validate one-way plus full assistant shortlist/selection/read-back and Claude independently in [F3 #6](https://github.com/eddieyang-97/trip-planning-engine/issues/6). This report does **not** prove the exact deployed SHA, all provider responses, live one-way compatibility, full-market coverage or end-to-end F3 completion.

## Prepared bounded multi-airport coverage — 21 October 2026

F2 is based on main after PR #11 merged. One-way searches query up to three origins individually in saved order; further airports are explicitly omitted for budget. Return runs retain the combined base query and at most two selected-departure expansions. Persisted admission plans, query scopes and per-pair coverage distinguish attempted, failed, uncertain, unexpanded and omitted scope. The three-request reservation, rolling quotas and authorization/recovery guarantees remain unchanged. No migration or deployment is performed. The 22 October review correction exposes `acceptedReturnDestinations` for accepted observations only; source-response coverage can include other destinations beyond the cap. Fifteen focused tests pass, including truncation and legacy read compatibility. PR #11 review fixes are carried forward, including separate supplier success/result rejection in durable per-pair coverage; 36 focused tests pass and latest-head CI remains the full-suite gate.

Original F2 commit `bc3a631`: type checks/build and `npm test` passed 141/141 with zero skips, including four isolated pooled PostgreSQL checks and multi-airport official MCP SDK retrieval with deterministic suppliers. See [scope, compatibility, validation and acceptance limits](hosted-live-search.md#bounded-multi-airport-increment--21-october-2026). Live multi-airport and connected-assistant acceptance remain separately approved work; neither F1 nor F2 is closed by fixture tests.

## Prepared general-purpose MCP flight discovery — 21 October 2026

The fixed Flaine validator/probe dependency is replaced locally by generalized SerpApi query/normalization. Supports future airport/date combinations, 1–6 origins, 1–9 adults, one-way/return economy/GBP and several airline/itinerary observations. A combined origin query plus at most two return expansions fits the existing three-request reservation and unchanged owner/global ceilings. No new provider, service, configuration or SQL migration is introduced. Generalized code is **not deployed or live-supplier accepted**; earlier hosted evidence remains scoped to the fixed Flaine pilot.

One-way snapshots use null criteria return / empty offer return; old saved return evidence stays readable and immutable. New bounded evidence includes schedule, observed amount/basis, airline labels and restrictions; equipment, supplier expiry, exact party total and bookability remain unknown. Candidate identity reconciliation preserves old IDs when airport catalogue coverage expands. The existing saved-research web view tolerates one-way observations; no web search UI is added. See [flight scope, costs, examples, compatibility and remaining acceptance](hosted-live-search.md).

Original generalization commit `66b5c9f`: type check/build and `npm test` passed 129/129 with zero skips, including four isolated pooled PostgreSQL checks and the official MCP client flow with deterministic supplier responses. The [flight guide](hosted-live-search.md#generalized-local-validation--21-october-2026) records commands and remaining live acceptance. No live supplier calls, real-trip mutations, deployments, paid plans or quota increases were performed. The parallel P0 security gate in issue #3 remains outside this PR.

PR #11 review fixes add cached/bounded DST-aware conversion, cooperative normalization, supplier-shaped echo/default fixtures and separate provider-success/result-rejection diagnostics. Focused checks pass 23/23; the latest-head CI build/full suite is the automated gate. See [review evidence and remaining acceptance](hosted-live-search.md#pr-11-review-fixes--21-october-2026).

## Database access hardening — 21 October 2026

The live metadata security repair was explicitly approved, applied and privately
verified; Security Advisor subsequently reported zero errors. The isolated
bootstrap patch protects fresh and current-version installs without replaying
migrations or adding Data API access. Type check/build and 115 local tests pass;
all 119 CI tests passed with zero skips, including four pooled PostgreSQL checks. Authenticated MCP read and
public health/page checks pass after the live repair. PR #12 is merged; exact source commit `51fdde9` is deployed and startup/asset/auth-boundary checks passed. See the [sanitized security guide](database-security-2026-10-21.md);
raw project findings and screenshots stay private. Flight-search edits are excluded.

## Additional releases and remaining acceptance — 16 October 2026

The dated 15 October snapshot below is retained to preserve exact release evidence. Subsequent releases have separate checks and limitations:

- **Persistent browser sign-in:** same-account session persistence, cross-tab private-UI clearing and safe account switching passed local browser regressions. The [16 October joint release](account-linking.md#joint-persistent-session-and-map-deployment--16-october-2026) documents deployed assets and fictional hosted checks. On 16 October the user confirmed real-account persistence after a full browser-process restart; see the [dated acceptance note](account-linking.md#user-confirmed-real-account-browser-restart--16-october-2026). Other cross-client/session edge cases retain separate acceptance requirements.
- **Itinerary map:** saved map pins, read-back verification, category grouping, clustering and mobile-width presentation are implemented. The [map guide](itinerary-map.md) records 15–16 October CI/hosted demo acceptance; real Alba pinning, shared-link map use and native gestures remain joint checks.
- **Profiles and member roster:** migration 010 and authenticated name/photo/roster behavior are recorded in [account profiles](account-profiles.md), including 16 October hosted schema-version 10 startup. The user confirmed validating the native photo-picker flow on 16 October; see the [dated acceptance note](account-profiles.md#user-confirmed-native-photo-picker-acceptance--16-october-2026). Other profile and cross-device edge cases remain separate checks.
- **Signed-in discussion:** the [discussion guide](itinerary-comments.md) records the 15 October deployed comments workflow and its permission limits. Hosted comment exchange, moderation and revocation require their own real-account acceptance; proposals/approval remain outside the current feature.

## Trip lifecycle implementation - 16 October 2026

Owner archive/restore, explicitly confirmed permanent deletion and collaborator leave-trip are implemented across web and authorized MCP. Local build/type checks and 113 tests passed; four pooled PostgreSQL checks run in CI. Archive preserves sharing; deletion removes the trip graph and denies pending exports/links; retained retry guards and quota-only counters prevent resurrection or allowance reset. Fictional browser archive/restore, exact-name gating/cancel and collaborator-only leave passed, including actual leave completion. Permanent deletion was exercised only in isolated backend/MCP tests, not through a real account or browser. See [feature behavior, retention and migration](trip-lifecycle.md). CI passed all 117 tests with zero skips. The exact code commit `ea1c7c5` is deployed on Render; migration 011 startup, matching production assets, authenticated-route boundaries and public demo presentation passed. Live search was paused/drained for migration and restored to its original enabled setting. Signed-in hosted lifecycle writes and friend-device acceptance remain joint checks; no real trip was deleted. See the [dated hosted evidence](trip-lifecycle.md#hosted-release--16-october-2026).

## 15 October combined release — historical snapshot

The calendar export and member-discussion release is deployed as of 15 October 2026. See [hosted release evidence](release-calendar-comments-2026-10-15.md) for the tested build and hosted checks. A fresh public check confirmed health, calendar controls, frontend export code and protected backend routes. Saved-trip HTTP export and final native iPhone/iPad acceptance remain pending. The Render dashboard deployment ID/backend commit was not independently inspected.

The existing Free Render service hosts accounts, MCP, manual itineraries, saved flight research, account-free view links and signed-in editor invitations, backed by Supabase. Earlier 14 October deployment: `1444ac82afe1dc174119481d35781379bd621021`, deployed on 14 October 2026 after Render resolved its outage. It passed [CI run 38635202838](https://github.com/eddieyang-97/trip-planning-engine/actions/runs/38635202838): **81 tests passed, none skipped**, including three pooled PostgreSQL checks. Its [exact-commit deployment](https://dashboard.render.com/web/srv-db3t3iub7d7c739hfad0/deploys/dep-db80emaj9qps73b5pjvg) completed in 42.8 seconds; the dashboard identifies it as Live and `/health` returned 200 with status ok.

The release applies migrations 001–008; hosted startup completes only after the current schema version is verified. Existing invitations remain account-bound, existing viewers stay viewers, and no real trip was granted anonymous access. Live searches still require explicit server opt-in and a private SerpApi key; no provider request was made in this acceptance. No paid plan or additional host was used.

Hosted acceptance created a seven-day view link only for a fictional test trip. Two fresh visitor tabs opened its saved note without an account, reload retained access, Overview/Details worked, no edit/share controls appeared, and the credential fragment was removed from the displayed URL. Owner revocation denied both visitors on refresh and cleared their displayed plan. The fictional test link is revoked. The real itinerary was left on its Share trip screen with only the owner having access; no link was created or sent. See [sharing evidence](itinerary-sharing.md#hosted-rollout-recovered--14-october-2026).

Editor invitations and shared editing are included in the live release. Automated tests and isolated owner/editor browser add/edit/remove/reorder/revocation passed; hosted real-account editor joining/writes remain a separate acceptance gap. The desktop overview, phone agenda and sticky day navigation from `9a69257` remain included. See [display evidence](itinerary-web.md#overview-and-detailed-navigation--14-october-2026).

## Delivered capabilities and dated verification

| Capability | Delivery | Recorded evidence and limits |
| --- | --- | --- |
| Persistent flight decisions | Implemented and deployed | Immutable criteria/observations, comparisons, selection and separate reported booking records; full product workflow remains broader than the pilot |
| Budget, airport-local evaluation and consistent reads | Implemented and deployed | Regression tests and controlled pooled PostgreSQL read-consistency test; [correction details](correctness-fixes.md) |
| Private policy notes | Implemented and deployed | Versioned account-owned references and pinned selections; automated isolation/validation, separate from quote prices |
| Direct account sign-in | Real hosted sign-in succeeded | 13 October acceptance; direct confirmed browser session is separate from assistant tokens |
| Account confirmation email | Brevo delivery and confirmed sign-in passed | After SMTP repair, the second account received and confirmed its email and signed in on 14 October. One pilot delivery; broader deliverability is not guaranteed. [Email setup](account-linking.md#account-email-delivery) |
| Hosted OAuth and MCP | Official-SDK flow succeeded | Public registration, S256 PKCE, verified token claims and 23 listed tools; [account evidence](account-linking.md) |
| Bounded hosted flight search | One real run completed | Three successful durable attempts, ten provider-reported observations; identical mutation returned the same run without another search |
| ChatGPT / connected retrieval | Initial linking and retrieval succeeded | User-reported ChatGPT result plus independently verified connected read tools; no new search during retrieval |
| Manual organizer | Implemented and deployed | Hosted fictional trip creation and note save passed, with the same revision/item independently read through MCP. Cross-surface editing and broader hosted edit/remove/reorder acceptance remain pending |
| Overview and detailed navigation | Implemented, deployed and checked on the real itinerary | Desktop day columns, phone agenda, sticky dates, active-day tracking, activity disclosures and overview-to-detail navigation; no new itinerary writes or sharing grants |
| Saved-research web view | Implemented, deployed and viewed with a real account | Same trip and ten sellers as MCP; review draft cancelled without saving; isolated preview tested saves/duplicates |
| Account-free view links | Implemented, deployed and verified | Reusable, optionally expiring and revocable; two hosted anonymous visitors, reload, Overview/Details and revoke/refresh denial passed. Private booking notes, research and history stay hidden |
| Account-bound invitations and editor access | Implemented and deployed | Legacy viewer onboarding/revocation passed. Two hosted accounts verified editor invitation acceptance and item add/edit/reorder/remove on a fictional test trip on 15 October; see [discussion guide](itinerary-comments.md#validation). This does not establish every friend or MCP editing scenario |
| Standalone flight/accommodation probes | Live diagnostics recorded | 11 October observations/manual checks; no hosted accommodation provider or comprehensive market coverage |
| Apple Calendar export | Deployed on 15 October; hosted smoke checks passed | User-confirmed deployment; health 200, calendar UI/bundle present, protected routes returned expected 401/400/404 with no-store and no-referrer. Hosted demo selection/download checks and 93-test CI are recorded in [hosted release evidence](release-calendar-comments-2026-10-15.md). Saved-trip/native iPhone/iPad acceptance remains pending. [Feature guide](calendar-export.md) |

The hosted trip/run IDs and actual attempt results are in [the flight acceptance record](hosted-live-search.md#real-hosted-acceptance--13-october-2026). Latest hosted research view and connected itinerary read returned manual revision 1 and zero manual items. An isolated preview save did not change that real trip.

## Pilot boundaries

Confirmed Flaine inputs remain 18–20 December 2026, four travelers, snowboard required and all six London airports allowed. Four adults, one board and Geneva are explicit working assumptions where not confirmed.

The live pilot samples one direct easyJet Gatwick–Geneva pair and up to ten sellers. It does not search the other London airports or find the optimal pair. Price basis is unknown, exact-party quoting is false, and snowboard carriage/cost and supplier expiry are unresolved. Ten sellers do not establish ten feasible itineraries or verified party totals. No selection, passenger submission or booking was made in recorded acceptance.

Configured ceilings are three requests/run, six reserved requests/owner/day, twelve globally/day and sixty globally/30 days. Supplier quota and diagnostics remain separate. Free Render can sleep; durable recovery does not guarantee uninterrupted progress. See [pilot execution](hosted-live-search.md#persistence-cost-and-recovery).

## Remaining acceptance and delivery

1. **Organizer across both surfaces:** broaden hosted edit/remove/reorder acceptance and web↔MCP edit continuity; complete web flight controls/comparison; explicit research links and organizer reconciliation. Hosted creation/save and web-to-MCP read continuity passed with a fictional test trip.
2. **Accounts and assistants:** hosted second-account isolation, read-only mutation denial, refresh/revocation/reconnection, Claude compatibility and ChatGPT write/search behavior. Automated checks do not replace these real flows.
3. **Flight completeness:** broader airport/pair coverage, exact party-price basis, booking-specific snowboard evidence, seller repricing/handoff, transfers and provider-specific freshness/retention. No baggage-complete or comprehensive live-product claim yet.
4. **Collaboration:** pilot email delivery, viewer joining/revocation and a fictional hosted editor write journey passed; anonymous viewing and member comments are implemented. Complete real-friend editor and signed-in discussion/moderation acceptance; proposals and organizer approval remain conditional future work. **These gaps do not block manual/sourced accommodation comparisons**; live supplier integrations require their own approved-access, data/privacy and operational checks.
5. **Operating hardening:** least-privilege runtime role, throttling, output bounds/versioning, deletion/export/retention, consent recovery, telemetry and backup/restore. Accommodation/dining need separate access/evidence validation later.
6. **Apple Calendar export:** deployment is complete. Validate saved-trip individual/all/subset HTTP exports and native iPhone/iPad imports, including displayed times, checkout boundaries and repeat-import behavior. Hosted demo/browser selection, public route boundaries and CI passed; subscriptions and Mac-specific acceptance remain deferred.

## Evidence and history

- [Account linking](account-linking.md): configuration, dated deployment/acceptance and remaining client/security checks.
- [Hosted live flight pilot](hosted-live-search.md): admission/recovery, readiness and real hosted search.
- [Itinerary web app](itinerary-web.md): manual slice and saved-research release/acceptance.
- [Apple Calendar probe](apple-calendar-probe.md): standalone transport test and user-confirmed three-event import on iPhone/iPad; the full feature is now deployed; saved-trip/native acceptance remains pending.
- [Apple Calendar export](calendar-export.md): deployed flow, schedule rules, delivery/access boundaries and current validation.
- [11 October live probes](spike/live-probe-results-2026-10-11.md): diagnostic/source findings.
- [Earlier implementation record](history/implementation-2026-10-11.md): preserved 8–11 October status, setup and deployment history.
- [Architecture review](architecture-review.md): original findings with follow-up; [spike index](spike/README.md) for historical proposals.

Record new evidence in its feature guide and summarize it here. Historical counts and pending statuses apply to their dated records and do not override current status.
