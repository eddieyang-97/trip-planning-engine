# Guarded releases

Updated 22 October 2026. The existing Blueprint-managed Free Render web service and Supabase remain the only deployment. [Issue #14](https://github.com/eddieyang-97/trip-planning-engine/issues/14) tracks activation and observed platform evidence; source configuration is not proof of applied settings.

## Before enabling automatic deployment

1. Verify active `main` protection: PR required, GitHub Actions `test` required with an up-to-date branch, no bypass actors, force pushes/deletion blocked. Zero formal approvals supports the sole maintainer; human review remains the working practice. Require review conversations to be resolved. Recheck the actual rule through GitHub after saving it.
2. Keep `autoDeployTrigger: "off"` until a controlled release and read-only checks pass. Confirm the exact commit in Render's live deployment, successful build/startup and database readiness. Current CI runs unconditional `test` jobs on PRs and every `main` push: install, build/type compilation and tests with disposable PostgreSQL. Inspect latest-commit logs for zero failures/skips; neither an old green PR nor a neutral/skipped job proves execution.
3. Confirm worker/migration compatibility. Current startup migrations finish before listening; startup fails if the required schema is absent. Readiness checks the database. Review every new migration for compatibility with both old/new processes during Render's rolling overlap. Ordinary releases must preserve admission locks, leases and attempt-before-dispatch journals.
4. Verify the applied platform shutdown window. The current Free service rejects `maxShutdownDelaySeconds`; do not configure it or assume a 180-second drain. The default 30-second window can interrupt a multi-request live run. Keep auto-deploy off until a reviewed strategy fits this limit; changing to paid compute requires separate user approval.
5. Run public and permitted authenticated smoke checks. Use the existing authorized MCP connection for a read; do not create a grant or trip solely for public readiness. The interactive `acceptance-hosted.ts` default establishes OAuth/client authorization and must use an authorized account; `--live` is not a deployment smoke check.

Independent ChatGPT/Claude feature acceptance stays in F3; it is not a reason to keep a safely tested build undeployed. Existing bounded F1/F2 live evidence can be reused. This procedure authorizes no supplier call, booking, payment or real-trip mutation.

## Activation and verification

Only after the prerequisites are observed, change `render.yaml` to `autoDeployTrigger: checksPass` and verify the Blueprint sync plus Render's actual **After CI Checks Pass** setting. Keep the same service, branch, plan and secrets. Never use `commit` as a fallback. Confirm service/workspace failure notifications are enabled.

Render [accepts success, neutral and skipped GitHub checks](https://render.com/docs/deploys#integrating-with-ci), so keep the required workflow unconditional and do not use path filters or skip phrases for required release checks. Zero checks or a failed check prevents auto-deploy. Do not add a CI check that waits for the same commit's Render deployment: it could become a circular dependency in the deployment gate.

Use one harmless green merge to record: full `main` SHA, successful `main` CI finish time, Render automatic trigger/start time after CI, deployed SHA, startup and smoke outcomes. Prove failed CI prevents deployment using controlled non-production or Render event evidence; never deliberately break production `main`. Until actual evidence exists, record the failed-CI demonstration as pending, not passed merely from vendor documentation.

## Read-only smoke command

After this release's metadata support is deployed:

```sh
node --import tsx scripts/smoke-release.ts https://trip-planning-engine.onrender.com FULL_EXPECTED_40_CHARACTER_SHA
```

The command makes only four GETs: `/health`, unauthenticated `/mcp`, `/account`, `/itinerary/config`. It requires the exact expected SHA, current schema version, ready database, MCP 401 and hosted web mode. It never follows redirects or prints raw remote diagnostics. Each request has a 60-second timeout for Free-tier wakeup; failures exit nonzero. Retry this read-only check after a cold start if necessary; do not retry a supplier request. An old/null SHA cannot pass. `/health` reads the [Render-provided public commit SHA](https://render.com/docs/environment-variables#render_git_commit), never arbitrary environment contents; no credential or private run data is exposed. Health is readiness/version evidence, not flight/client acceptance.

Separately verify an authenticated read through an already approved client/session. Keep identifiers, credentials, booking notes and private results out of CI logs and public evidence.

## Pause, drain and recover

- Pause unattended releases by setting Auto-Deploy **Off** in Render and reconciling `render.yaml` before the next Blueprint sync. Record the pause; do not disable required CI to force a release.
- For changes incompatible with an older worker, arrange a maintenance window. Stop new search submissions; privately inspect queued/running run counts. Disable `LIVE_SEARCH_ENABLED` and let the old process drain before enabling a compatible worker again. Changing that flag requires a restart/deploy, so it is not an instantaneous distributed admission switch. Queued runs remain durable and can resume when enabled; do not treat the flag as cancellation. Do not enable an old worker against plan-aware runs/schema.
- On SIGTERM/SIGINT, stop the process-local scheduler before waiting for HTTP close and the active job, then close the database. The Free service retains the [default 30-second shutdown limit](https://render.com/docs/deploys#graceful-shutdown). Its Blueprint validator rejects `maxShutdownDelaySeconds`, including the proposed 180 seconds. An account preflight plus three 30-second requests can exceed the applied window; local drain tests do not prove completion within it. Keep unattended releases off while this mismatch is unresolved. In-process draining is tested with an isolated journaled request. Forced termination/lease expiry retains the existing `outcome_unknown` recovery and never replays a live request.
- A new instance can overlap the old one during a rolling deploy; the database's single-live-job admission remains authoritative. No local timer or shutdown flag replaces that coordination.
- Rollback code only to a schema/plan-compatible reader/worker, with auto-deploy paused. Prefer a forward fix after additive migrations. Rolling back code does not undo schema/data changes; disabling live search does not reverse an already sent request. Preserve attempt journals and immutable research; never reset uncertain runs to queued or replay them to make a smoke check pass.

## Verified baseline — 22 October 2026

GitHub ruleset `main-ci-release` (25630562) is **active**, explicitly targets `refs/heads/main`, has an empty bypass list, requires PRs and resolved review threads, binds the strict/up-to-date `test` check to GitHub Actions (integration 15368), and blocks force pushes/deletion. The branch API independently returned `protected:true`. Zero formal approvals is deliberate for the sole maintainer, not a claim of an independently enforced approval gate.

Render's deployment view showed a **manual Dashboard** release of `266ffc2d9dfc67228b7c3a8151eba434a1a15f65`, with successful build, hosted/live-enabled startup and Live status (startup 10:03:39 UTC, Live 10:03:42 UTC). [Main CI run 39758284290](https://github.com/eddieyang-97/trip-planning-engine/actions/runs/39758284290) passed before this release. Public read-only checks returned health 200 (`ok`, live search enabled), unauthenticated MCP 401, account 200 and hosted config 200. An existing authorized MCP `list_trips` read succeeded; no trip contents were published. Render Auto-Deploy was **Off**, and service notifications inherited **Only failure notifications** from the workspace. No supplier request or trip write was made. At that baseline, commit/schema health metadata, the proposed extended shutdown allowance and automatic deployment were not verified in production. The later observation below supersedes those pending items. This observation does not retrospectively establish active-run drain status for the user's manual release.

## Deployed safeguards and Free-plan blocker — 22 October 2026

The user merged PR #16 and manually deployed `a29f491b3301741b173622e0f1517148fc7190eb`. [Main CI 39765023820](https://github.com/eddieyang-97/trip-planning-engine/actions/runs/39765023820) completed successfully at 10:44:51 UTC. Render showed a manual Dashboard trigger, successful build, startup at 10:51:10 UTC and Live at 10:51:19 UTC. The exact-SHA smoke command passed: commit matched, schema 11, health 200, unauthenticated MCP 401, account 200 and hosted web mode. An existing authorized MCP `list_trips` read succeeded without publishing contents. No supplier request or trip write was made.

The Blueprint page then reported `services[0].maxShutdownDelaySeconds: max shutdown delay is not supported for free tier services`. Thus the 180-second allowance in PR #16 was **rejected, not applied**, despite the successful manual code deployment. Remove the unsupported field and retain `autoDeployTrigger: "off"`; verify a subsequent Blueprint sync separately. No plan upgrade or new service is authorized by this correction. The current worker still preserves conservative unknown-outcome recovery after forced termination; that prevents unsafe replay but does not guarantee a useful completed search during a deploy. Applied extended draining, unattended green deployment and failed-CI prevention remain unverified.
