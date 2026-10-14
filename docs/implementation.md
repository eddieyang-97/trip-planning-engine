# Delivery status and acceptance

Updated 14 October 2026. Current decisions are in the [architecture](architecture.md) and [PRD v0.4](prd.md). This summarizes recorded delivery and acceptance evidence.

## Current release

The existing Free Render service hosts accounts, MCP, manual itinerary, saved flight research and view-only invitations, backed by Supabase. Latest recorded deployed implementation: `f6f1670ad5dad6dfb9200d2e514b56724d94cdc5`, deployed on 14 October. It passed [CI run 38488584377](https://github.com/eddieyang-97/trip-planning-engine/actions/runs/38488584377): **72 tests passed, none skipped**, including three pooled PostgreSQL checks. Hosted reads confirm the updated itinerary role and trip-list projection. See [sharing release evidence](itinerary-sharing.md); second-account email, confirmation, viewer joining and revocation passed; broader collaboration remains later work.

The recorded release applies migrations 001–006. Live searches require explicit server opt-in plus a private SerpApi key; hosted synthetic searches are disabled. No paid plan or additional host is part of this release. Concurrent local development is separate from this deployed/accepted baseline.

## Delivered and verified

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
| Saved-research web view | Implemented, deployed and viewed with a real account | Same trip and ten sellers as MCP; review draft cancelled without saving; isolated preview tested saves/duplicates |
| View-only itinerary invitations | Implemented and deployed | Owner creates/revokes one-person links; viewer reads omit research, booking notes and history. All CI checks passed; hosted second-account confirmation, joining, view-only display and owner revoke / viewer refresh passed on 14 October |
| Standalone flight/accommodation probes | Live diagnostics recorded | 11 October observations/manual checks; no hosted accommodation provider or comprehensive market coverage |

The hosted trip/run IDs and actual attempt results are in [the flight acceptance record](hosted-live-search.md#real-hosted-acceptance--13-october-2026). Latest hosted research view and connected itinerary read returned manual revision 1 and zero manual items. An isolated preview save did not change that real trip.

## Pilot boundaries

Confirmed Flaine inputs remain 18–20 December 2026, four travelers, snowboard required and all six London airports allowed. Four adults, one board and Geneva are explicit working assumptions where not confirmed.

The live pilot samples one direct easyJet Gatwick–Geneva pair and up to ten sellers. It does not search the other London airports or find the optimal pair. Price basis is unknown, exact-party quoting is false, and snowboard carriage/cost and supplier expiry are unresolved. Ten sellers do not establish ten feasible itineraries or verified party totals. No selection, passenger submission or booking was made in recorded acceptance.

Configured ceilings are three requests/run, six reserved requests/owner/day, twelve globally/day and sixty globally/30 days. Supplier quota and diagnostics remain separate. Free Render can sleep; durable recovery does not guarantee uninterrupted progress. See [pilot execution](hosted-live-search.md#persistence-cost-and-recovery).

## Remaining acceptance and delivery

1. **Organizer across both surfaces:** broaden hosted edit/remove/reorder acceptance and web↔MCP edit continuity; complete web flight controls/comparison; explicit research links and organizer reconciliation. Hosted creation/save and web-to-MCP read continuity passed with a fictional test trip.
2. **Accounts and assistants:** hosted second-account isolation, read-only mutation denial, refresh/revocation/reconnection, Claude compatibility and ChatGPT write/search behavior. Automated checks do not replace these real flows.
3. **Flight completeness:** broader airport/pair coverage, exact party-price basis, booking-specific snowboard evidence, seller repricing/handoff, transfers and provider-specific freshness/retention. No baggage-complete or comprehensive live-product claim yet.
4. **Collaboration:** pilot email delivery, hosted viewer joining and revocation passed; add comments, proposals and organizer approval afterward. View-only membership/invitations are deployed; broader collaboration remains a later milestone before accommodation integration.
5. **Operating hardening:** least-privilege runtime role, throttling, output bounds/versioning, deletion/export/retention, consent recovery, telemetry and backup/restore. Accommodation/dining need separate access/evidence validation later.

## Evidence and history

- [Account linking](account-linking.md): configuration, dated deployment/acceptance and remaining client/security checks.
- [Hosted live flight pilot](hosted-live-search.md): admission/recovery, readiness and real hosted search.
- [Itinerary web app](itinerary-web.md): manual slice and saved-research release/acceptance.
- [11 October live probes](spike/live-probe-results-2026-10-11.md): diagnostic/source findings.
- [Earlier implementation record](history/implementation-2026-10-11.md): preserved 8–11 October status, setup and deployment history.
- [Architecture review](architecture-review.md): original findings with follow-up; [spike index](spike/README.md) for historical proposals.

Record new evidence in its feature guide and summarize it here. Historical counts and pending statuses apply to their dated records and do not override current status.
