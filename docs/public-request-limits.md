# Public request limits — issue 51

Implemented in source and merged into `main` via [PR #66](https://github.com/eddieyang-97/trip-planning-engine/pull/66) on 2 November 2026, with latest-head CI passing. Exact-SHA deployment and hosted proxy/caller-isolation validation were not independently confirmed for this change.

Shared reads and calendar preparation use separate process-local fixed windows
of one minute. Each request must pass the existing Origin check, then per-caller
admission before credential/database work. Requests already rejected by the
caller limit do not consume the process-wide attempt allowance.

| Route group | Attempts per caller | Total admitted attempts | Authorized-use ceiling |
| --- | --- | --- | --- |
| Shared itinerary reads | 30/minute | 600/minute | 120/minute |
| Direct and shared calendar preparation together | 30/minute | 300/minute | 60/minute |

Invalid view credentials and failed direct authentication consume only attempt
allowances. Authorized-use counters advance after access checks; calendar requests
also require a matching itinerary revision. An authorized but invalid calendar
selection can consume this allowance because serialization work is bounded too.
Limits return 429 with `Retry-After: 60`. Original trip permissions, shared-field
projections, link expiry/revocation and calendar delivery rechecks still apply.

Each limiter stores at most 1,024 caller keys and clears them on the first request
after the window expires. New keys are rejected at capacity rather than evicting
existing counters. No tokens or user content are used as keys or logged. Calendar
ticket bounds remain 120 outstanding tickets, two-minute expiry, 8 MB per file
and 16 MB total cached bytes. Restart resets these in-memory limits and tickets.

## Caller identity and deployment

Caller identity is Express `req.ip`. Proxy trust defaults off, so the socket peer
is used and client-supplied `Forwarded`/`X-Forwarded-For` cannot rotate identities.
`Origin` remains a request-origin check, never an abuse-control identity.

Behind a proxy, set `TRUSTED_PROXY_ADDRESSES` only to verified ingress IPs/CIDRs.
The setting accepts a comma-separated list of literal IPv4/IPv6 addresses or
nonzero CIDRs, rejecting wildcard trust, hop counts and named subnet shortcuts.
Express walks the socket peer and forwarded chain from right to left to the first
untrusted address; arbitrary leftmost header values are not trusted.

Before enabling client-IP proxy trust behind Render or any other ingress, verify its actual socket
peers, routing paths and handling of client-supplied forwarded headers. The proxy
must overwrite or append the actual client address, and only those controlled
proxy ranges should be trusted. No Render ranges are guessed or automatically
trusted by this change. With trust unset, users behind one proxy or NAT share a
caller bucket; this safe fallback does not establish hosted per-user isolation.

These are bounded pilot controls, not a distributed denial-of-service defense.
Many distinct callers can still reach the global attempt ceiling. Multiple
instances have independent allowances. Changing either constraint requires
operating evidence, not higher limits based solely on these fixtures.

## Regression coverage

`tests/public-request-limits.test.ts` uses an isolated database and HTTP server to
repeat 120 invalid shared reads and 60 unauthenticated exports. A separate caller
still reads and exports successfully. It checks spoofed forwarding chains, proxy
trust disabled, Origin denial, global ceilings, revocation, unchanged mutation
counts, caller-map capacity and window recovery. No production flood test is used.
