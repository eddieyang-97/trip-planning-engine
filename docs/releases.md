# Guarded releases

The existing Blueprint-managed Free Render web service and Supabase remain the only deployment. Service-level auto-deploy after required green CI is active; Blueprint Auto Sync is off. Source configuration is not proof of applied settings. Historical rollout evidence lives in [Issues #14](https://github.com/eddieyang-97/trip-planning-engine/issues/14) and [#28](https://github.com/eddieyang-97/trip-planning-engine/issues/28).

## Check release safeguards before deployment

1. Verify active `main` protection: PR required, GitHub Actions `test` required with an up-to-date branch, no bypass actors, force pushes/deletion blocked. Zero formal approvals supports the sole maintainer; human review remains the working practice. Require review conversations to be resolved. Recheck the actual rule through GitHub after saving it.
2. Verify the existing service-level `autoDeployTrigger: "checksPass"` and passing CI before release; pause it for incompatible configuration/schema work. Confirm the exact commit in Render's live deployment, successful build/startup and database readiness. Current CI runs unconditional `test` jobs on PRs and every `main` push: install, build/type compilation and tests with disposable PostgreSQL. Inspect latest-commit logs for zero failures/skips; neither an old green PR nor a neutral/skipped job proves execution.
3. Confirm worker/migration compatibility. Current startup migrations finish before listening; startup fails if the required schema is absent. Readiness checks the database. Review every new migration for compatibility with both old/new processes during Render's rolling overlap. Ordinary releases must preserve admission locks, leases and attempt-before-dispatch journals.
4. Verify the applied platform shutdown window. The current Free service rejects `maxShutdownDelaySeconds`; do not configure it or assume a 180-second drain. The default 30-second window can interrupt a multi-request live run. Use the existing interruptible worker strategy and recovery rules below; do not assume platform shutdown prevents uncertain supplier outcomes. No plan upgrade is needed.
5. Run public and permitted authenticated smoke checks. Use the existing authorized MCP connection for a read; do not create a grant or trip solely for public readiness. The interactive `acceptance-hosted.ts` default establishes OAuth/client authorization and must use an authorized account; `--live` is not a deployment smoke check.

Independent ChatGPT/Claude feature acceptance stays in F3; it is not a reason to keep a safely tested build undeployed. Existing bounded F1/F2 live evidence can be reused. This procedure authorizes no supplier call, booking, payment or real-trip mutation.

## CI-gated deployment and verification

Keep `autoDeployTrigger: checksPass` in `render.yaml` consistent with Render's actual **After CI Checks Pass** setting; read back any approved change after green main CI. Keep the same service, branch, plan and secrets. Never use `commit` as a fallback. Confirm service/workspace failure notifications are enabled.

Keep Blueprint **Auto Sync = No**. [Blueprint synchronization is a separate configuration deployment path](https://render.com/docs/infrastructure-as-code#disabling-automatic-sync), not proof of the linked-commit CI gate. After merging a `render.yaml` change, inspect that exact main commit's successful CI before manually syncing the Blueprint. Review the proposed resource changes first. Ordinary application commits still auto-deploy through service-level `checksPass`; do not enable Blueprint auto-sync as a shortcut. If a release depends on new environment/build/start configuration, pause service auto-deploy before merging; after green main CI, manually sync the coordinated config and verify `checksPass` is restored. Pausing Blueprint sync alone does not hold code deployments. Manual Dashboard deploys/restarts remain explicit operator actions, not CI-gated evidence.

Render [accepts success, neutral and skipped GitHub checks](https://render.com/docs/deploys#integrating-with-ci), so keep the required workflow unconditional and do not use path filters or skip phrases for required release checks. Zero checks or a failed check prevents auto-deploy. Do not add a CI check that waits for the same commit's Render deployment: it could become a circular dependency in the deployment gate.

For meaningful releases, verify the full deployed SHA, required CI, startup and bounded smoke outcomes. An untested failed-CI nondeployment guarantee must not be described as independently demonstrated merely from vendor documentation.

## Read-only smoke command

For an approved release:

```sh
node --import tsx scripts/smoke-release.ts https://trip-planning-engine.onrender.com FULL_EXPECTED_40_CHARACTER_SHA
```

The command makes only four GETs: `/health`, unauthenticated `/mcp`, `/account`, `/itinerary/config`. It requires the exact expected SHA, current schema version, ready database, MCP 401 and hosted web mode. It never follows redirects or prints raw remote diagnostics. Each request has a 60-second timeout for Free-tier wakeup; failures exit nonzero. Retry this read-only check after a cold start if necessary; do not retry a supplier request. An old/null SHA cannot pass. `/health` reads the [Render-provided public commit SHA](https://render.com/docs/environment-variables#render_git_commit), never arbitrary environment contents; no credential or private run data is exposed. Health is readiness/version evidence, not flight/client acceptance.

Separately verify an authenticated read through an already approved client/session. Keep identifiers, credentials, booking notes and private results out of CI logs and public evidence.

## Manual production smoke workflow — 23 October 2026

[Issue #28](https://github.com/eddieyang-97/trip-planning-engine/issues/28) adds a **non-required, manually dispatched** GitHub Actions check for the currently deployed production release. It is separate from the `Check / test` main/PR gate: **never make post-deploy smoke a required status**, since Render's `checksPass` would then wait for a workflow that itself waits for deployment.

1. After Render shows a deployment as **Live**, copy that deployment's **full 40-character SHA** (not the current tip of `main` unless it matches the deployed commit).
2. In GitHub, open **Actions → Production smoke (manual) → Run workflow**. Supply the SHA in `expected_sha`. The workflow checks out that exact release, installs its dependencies, and calls `scripts/post-deploy-smoke.ts`. This workflow and runner must exist in the release under test; older commits made before this increment are not supported by that GitHub job.
3. Inspect the **smoke-production** job and its summary. PASS requires the public `/health` response to report the exact supplied Git SHA and matching source schema version, the database to be ready, unauthenticated `/mcp` to return 401, `/account` to return 200, and `/itinerary/config` to report hosted mode.
4. On failure, the summary reports only the expected/observed public SHA, schema, endpoint status codes, attempts and a short reason. A mismatched SHA or schema, broken authentication boundary or invalid hosted configuration **fails immediately**; safe GET-only network/5xx faults can retry up to **three attempts** within a **five-minute runner deadline** (eight-minute GitHub job timeout). Do not regard an older `main` deployment as a green release just because health returned 200.
5. To reproduce locally from the same release revision: `node --import tsx scripts/post-deploy-smoke.ts FULL_EXPECTED_40_CHARACTER_SHA`.

The job uses no production secrets, authentication, browser account, trip data, supplier calls, bookings, payments or write endpoints. No Render deployment, rollback, permission change or automated schedule is triggered. The check does **not** prove authenticated MCP tool discovery (including ChatGPT's plugin action cache), real-user sign-in, Web UI browser journeys, supplier correctness or booking availability.

## Connected Supabase production diagnostics



The Supabase connector points at the **live** project. Use it primarily to inspect read-only metadata, effective schema, RLS/grants, limited aggregated logs and advisors. A connection alone does not authorize SQL writes/DDL, migration application, Auth changes, branch/project creation or inspection of private trip/traveler records. Obtain separate approval and disclose potential branch costs before such actions; never install production credentials into GitHub smoke jobs.

Application schema authority is `migrations/` plus `src/database.ts` / `app_schema_migrations`. Do **not** assume Supabase's separate migration list contains the app's 001–012 SQL versions or reapply migrations through both channels. Keep code/schema edits in reviewed PRs, pass disposable PostgreSQL checks, and deploy through the existing guarded release flow. After approved schema changes, recheck effective RLS/grants and Supabase security/performance advisors without exposing private rows. See [agent instructions](../AGENTS.md#connected-production-service-tools) and the [database schema reference](database.md).

## Pause, drain and recover

- Pause unattended releases by setting Auto-Deploy **Off** in Render and reconciling `render.yaml` before the next Blueprint sync. Record the pause; do not disable required CI to force a release.
- For changes incompatible with an older worker, arrange a maintenance window. Stop new search submissions; privately inspect queued/running run counts. Disable `LIVE_SEARCH_ENABLED` and let the old process drain before enabling a compatible worker again. Changing that flag requires a restart/deploy, so it is not an instantaneous distributed admission switch. Queued runs remain durable and can resume when enabled; do not treat the flag as cancellation. Do not enable an old worker against plan-aware runs/schema.
- On SIGTERM/SIGINT, stop the process-local scheduler and abort its live search immediately, before waiting for HTTP close and active finalization, then close the database. The Free service retains the [default 30-second shutdown limit](https://render.com/docs/deploys#graceful-shutdown). Its Blueprint validator rejects `maxShutdownDelaySeconds`, including the proposed 180 seconds. The shutdown signal prevents new account/search dispatch, aborts the current fetch/body wait and finalizes the run with completed observations where authorization and persistence permit. An interrupted request remains `outcome_unknown`; an intent committed just before cancellation is conservatively unknown even if dispatch cannot be established. Unstarted queries remain unattempted, and the original three-slot budget reservation is retained. A 25-second process cleanup deadline leaves margin before the platform kill; if HTTP/DB cleanup stalls, exit without resetting or replaying the run. Database recovery is still required after lost finalization. Fixtures exercise prompt normal cleanup, not a hosted timing guarantee. Forced termination/lease expiry retains the existing `outcome_unknown` recovery and never replays a live request.
- A new instance can overlap the old one during a rolling deploy; the database's single-live-job admission remains authoritative. No local timer or shutdown flag replaces that coordination.
- Rollback code only to a schema/plan-compatible reader/worker, with auto-deploy paused. Prefer a forward fix after additive migrations. Rolling back code does not undo schema/data changes; disabling live search does not reverse an already sent request. Preserve attempt journals and immutable research; never reset uncertain runs to queued or replay them to make a smoke check pass.

## Historical evidence

CI-gate installation, initial manual release, worker rollout, Render/Blueprint platform limitations and the first successful production smoke are documented in [Issue #14](https://github.com/eddieyang-97/trip-planning-engine/issues/14), [Issue #28](https://github.com/eddieyang-97/trip-planning-engine/issues/28), their merged PRs and CI runs. These are historical evidence; the operational instructions above describe the current procedure.
