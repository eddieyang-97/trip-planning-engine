# Implementation status — 6 October 2026

## Delivered

The local scaffold implements the flight decision model, a persistent PostgreSQL database through PGlite, immutable criteria and observations, explicit coverage gaps, repeat comparisons, conservative scoring, saved/rejected candidates, selections and user-reported booking records. Fourteen tools are available through the official MCP TypeScript SDK with Streamable HTTP.

The acceptance inputs retain the user's confirmed Flaine dates, party count, snowboard requirement and all-airport scope. No previous connector prices are used as current fares. Test fixtures are synthetic and have one-hour fixture expiries; those expiries do not represent a supplier guarantee.

Local authentication uses a random bearer token and loopback binding. Hosted-mode code verifies asymmetric JWT signatures, issuer, audience, expiry, UUID subject and OAuth `client_id`, then requires an existing database grant. Host/Origin checks and a request-body limit protect the endpoint. Tests include an official SDK client over real local HTTP, signed test JWTs, cross-owner denial, grant revocation, duplicate mutations, revision conflicts, comparison semantics and database restart.

## Hosted deployment sequence

Target remains **one Render service + Supabase**. Vercel and a separate worker are unnecessary for this milestone. The repository contains an external PostgreSQL adapter and JWT verifier; this is preparatory code, not a tested hosted deployment.

1. Provision a dedicated free Supabase development project and use the repository's `render.yaml` Blueprint for one Free Render Node service in Frankfurt. Keep provider credentials server-side. The Blueprint configures Node 24, build `npm ci --include=dev && npm run build`, start `npm start`, and `/health` as the health route. GitHub Actions runs the build and tests on pushes and PRs. Render auto-deploy is initially off so future pushes do not unexpectedly change the hosted service.
2. Configure `APP_MODE=hosted`, `NODE_ENV=production`, `PORT` (provided by Render), `DATABASE_URL`, `SUPABASE_AUTH_ISSUER` and `MCP_AUDIENCE`. Render's assigned `RENDER_EXTERNAL_URL` supplies the public origin; set `PUBLIC_ORIGIN` only to override it with an HTTPS origin without a trailing slash. Use `DATABASE_CA_FILE` if needed for the trusted database certificate. TLS verification stays enabled. Connection-string SSL parameters are rejected to prevent them overriding verification. Preserve the external Host header through ingress. Use the Supabase session pooler connection if the direct database hostname is unreachable from the deployment network.
3. Free Render services do not have pre-deploy commands. The Blueprint sets `MIGRATE_ON_START=true` to apply versioned migrations transactionally before HTTP starts. An advisory transaction lock serializes migration initialization; subsequent starts check the applied version and leave existing records intact. Use a dedicated application database/schema and a role with sufficient migration privileges. Current tables live in `public`; review naming collisions before applying to an existing Supabase project. If migrating separately, set the flag to `false` and run `npm run migrate` before deployment. Runtime health checks include a database query and return 503 on database failure without exposing connection details.
4. Implement the small Supabase sign-in/OAuth consent and client-grant flow, plus grant revocation. The current code intentionally does not manufacture grants for hosted tokens. Register an actual client and verify its OAuth discovery, redirect, PKCE, refresh, issuer, audience and `client_id` behavior. Choose the audience based on tokens actually issued for the intended resource; do not weaken audience validation just to accept an unrelated token. No end-to-end Supabase OAuth exchange or ChatGPT/Claude connection has been tested yet. Confirm which “Muse” product is intended before claiming compatibility.
5. Exercise account isolation and revocation against external PostgreSQL and the hosted endpoint, including proxy headers, health checks, secret handling, request limits, logs and monitoring. Add production throttling and a least-privilege database role before wider access. The current database adapter is unit/integration tested only through embedded PostgreSQL, not a real Supabase instance.
6. Add a provider only after verifying access, commercial rights, retention limits, round-trip/party-price semantics, snowboard coverage and actual freshness/bookability. Follow the provider evaluation in the spike; SerpApi remains a conditional pilot choice, not a committed live integration.

RLS is enabled with no public policies and direct access is revoked from Supabase `anon`/`authenticated` roles when those roles exist. The current service expects a privileged server database connection. Such a connection bypasses RLS; ownership and client checks in `core.ts` are therefore essential. Do not expose that connection to a browser or use the browser's Supabase data API as an alternate access path. A dedicated runtime-role/RLS design is still a production hardening task.

The hosted fixture provider is disabled. Hosted mode currently supports manual evidence and comparisons but cannot initiate a search. OAuth authorization and application read/write/search permissions are distinct: `client_grants` stores the latter. There is no consent UI or grant-management tool yet.

### Deployment setup update — 8 October 2026

The dedicated Supabase project `trip-planning-engine` exists in the Free `Travel Research` organization, in Frankfurt (`eu-central-1`). Render creation is being prepared from the repository Blueprint. The database connection is entered directly into Render, never committed.

The Blueprint provides a separate `DATABASE_PASSWORD` field: paste the original password unchanged. Use the password-free session-pooler URI for `DATABASE_URL`; the app encodes and inserts the password in memory. Existing complete connection URIs also remain supported when the separate password setting is omitted. Credentials are not printed by configuration validation.

`MCP_AUDIENCE` now defaults to the service's public origin plus `/mcp`, so it need not be known before Render assigns its URL. An explicit override remains available. This preserves strict audience validation: the default Supabase audience `authenticated` will not pass. Before a real OAuth client can connect, configure resource-specific token issuance, the consent UI and stored client grants, and verify the resulting token against this audience. A healthy deployment alone is not proof of a working OAuth client connection.

## Provider integration requirements

### Hosted deployment verification — 9 October 2026

The Free Render service is live at `https://trip-planning-engine.onrender.com`, deployed from commit `0684d9c`. The first deployment failed with `SELF_SIGNED_CERT_IN_CHAIN`; the fix supplies the public Supabase CA through `DATABASE_CA_FILE=certs/supabase-prod-ca-2021.crt`. Certificate-chain and hostname verification remain enabled. The certificate source, fingerprint and expiry are recorded in `certs/README.md`.

Verified the pooler separately with TLS 1.3 and `authorized: true`, without transmitting a database password. Render then completed startup and its migration/version checks. The public checks returned:

- `GET /health`: HTTP 200, `{"status":"ok","liveSearch":false}`; includes a real database query.
- `GET /mcp` without a token: HTTP 401 with the protected-resource metadata challenge.
- `GET /.well-known/oauth-protected-resource/mcp`: HTTP 200 with this service's `/mcp` resource and the dedicated Supabase Auth issuer.

This verifies deployment and database connectivity, not authenticated end-to-end MCP use. Consent/account linking, resource-specific token issuance, client grants and live flight-provider integration remain incomplete. No paid infrastructure upgrade was made.

The current `FlightProvider` boundary accepts frozen criteria and returns validated offers plus coverage. Its only implementation is `fixture`; production provider types, capabilities and evidence provenance must be added explicitly. The schema deliberately rejects claims of live provider evidence today.

The fixture runner persists queued/running/completed/failed state, uses a lease and fences late results by generation. Automatic retry of an expired lease is safe for fixtures. **Do not apply that retry policy to a paid provider**: add provider idempotency/reconciliation, an `outcome_unknown` path for uncertain external outcomes, cost budgets, grant rechecks, timeout/cancellation, bounded retention and provider-specific expansion/caching rules first. Add evidence for query parameters, units, requested party, fare family, baggage, full return legs, timestamps and incomplete airport coverage.

The local examples include at most 20 observations per run and six departure airports. There is no generalized pagination/expansion engine or recurring-search scheduler. Candidate identity follows flight numbers, airports and local dates; provider identifiers and codeshare handling will need validation with real data. Time strings retain supplied local offsets; the live adapter must establish their correct airport time zones.

## Roadmap and acceptance gates

| Phase | Outcome | Exit evidence |
| --- | --- | --- |
| 0 — current | Local MCP flight decision slice | Offline acceptance tests, build and runnable demo |
| 1 | Hosted identity and persistence | A real client signs in; two accounts cannot access one another; revoke access mid-session |
| 2 | Live flight research | Rights-cleared provider; full party/return evidence; coverage and fees explicit; safe repeat-search behavior |
| 3 | Flaine decision trial | Search all London airports; resolve equipment quantity/size and transfers; compare real options with timestamps |
| 4 | Hotels | Shared decision/observation model with stay, occupancy, cancellation and full-price semantics |
| 5 | Restaurants and optional shared review | Provider access first; separately implement shared links, membership, votes and comments |

This work does not depend on friends having developer setup in the eventual product. The local developer scaffold is an implementation milestone; an ordinary shared web review flow remains a later product feature as requested.
