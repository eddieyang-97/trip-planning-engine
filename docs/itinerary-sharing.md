# Itinerary sharing

Owners can grant **Can view** account-free links or **Can edit itinerary** signed-in invitations. They can revoke either. Editors change shared items; only owners manage invitations, research and booking status. Signed-in member comments are described in [itinerary discussion](itinerary-comments.md); proposals are not shipped. An owner-reported friend phone test confirmed viewing only, not editing. Deployment/test chronology lives in the original sharing Issues and PRs.

## Account-free view links

**Share trip → Can view → Create view link** creates an unguessable read-only link. Anyone possessing it can open and forward it; the owner sees that permission before creation. It does not identify individual visitors. Links default to no expiry, with optional 7-, 30- or 90-day expiry, and can be revoked independently. Editors still sign in and accept a separate single-person invitation. Existing account-bound invitations are never converted or broadened, including requests from a stale browser bundle.

Migration `008_itinerary_view_links.sql` adds explicit `account`/`link` modes. Legacy rows remain `account` with unchanged expiry. Database checks prohibit editor roles or accepted identities on anonymous links. A separate owner-web-only `create_itinerary_view_link` operation prevents an older account-invitation client from accidentally creating anonymous access. No sharing operations are exposed through MCP.

Links use `/itinerary#view=TOKEN`. The browser removes the credential fragment, retains it only in that tab’s session storage, and sends it in a same-origin POST body to the fixed `/itinerary-share/read` endpoint. This reader starts before auth configuration and does not require or consult account tokens. It cannot dispatch tools, select another trip ID, join membership, write data, run providers or authorize MCP. Changing to another credential fragment reinitializes the page rather than continuing to show the previous trip. Raw credentials are shown to owners once and only hashes persist, including mutation caches.

Each read uses a read-only repeatable-read snapshot and rechecks link mode, role, revocation and expiry. Its allowlisted response contains trip display fields and active manual items, including practical notes, useful links, open questions and reported booking status. Private booking notes, future unrecognized fields, owner IDs, research and history are omitted. Invalid, expired or revoked links show an account-free error; refresh clears the previous displayed plan. Revocation applies to subsequent reads and cannot retract copied data or cancel an already-running snapshot.

Pages/read responses use `no-store`, `no-referrer` and `noindex, nofollow, noarchive`. The read body is capped at 2KB and the process accepts at most 120 shared reads/minute. This coarse pilot limit resets on restart and is not distributed abuse protection. Existing limits cover both link types: 10 outstanding links/invitations, 100 total per trip; named collaborators remain capped at 20. Links are not discoverable trip listings and do not automatically make any trip public. Owners share URLs manually; no email is sent by creating one.

## Editor role

The editor implementation adds **Can view** (the default) or **Can edit itinerary**. Editors can add tentative items and edit, remove or reorder shared items in the web app. Only the owner manages invitations, research, booking status and private booking notes. The invitation preview explains these permissions before joining. Existing invitations and memberships remain viewers; the release does not grant any existing account editing access. This implementation is included in the recovered live rollout above; independent real-friend editor acceptance remains a separate evidence boundary.

Migration `007_itinerary_editors.sql` adds an invitation role and expands membership roles. Shared add/update requests use strict schemas that omit booking status and private notes. Updating a reported booking preserves those fields on the server. Owner history retains the editor's actor ID and the browser distinguishes collaborator changes. Editors receive the same private-field omissions as viewers; assistant writes remain owner-only and the two shared editing operations are excluded from MCP discovery.

Every edit and access change locks the trip before checking current membership. Cached edit retries recheck permissions, and shared revisions reject conflicting owner/editor changes. Accepting a fresh invitation replaces that person's previous membership and revokes the superseded invitation; this lets an owner change permissions through a new invitation without leaving an old editor link usable. Revocation stops subsequent reads and writes, including retries.

## Scope and privacy

- An invitation is for one person and one trip, expires after seven days if unused, and can be revoked. Accepted membership continues until revoked; expiry does not remove an existing collaborator.
- The friend can read current manual itinerary items, dates, local times, practical notes, useful links, open questions and owner-reported booking status. Practical notes and links must not contain details the organizer wants to keep private.
- Research decisions/evidence, booking notes, item history and the owner’s account identifier are omitted from collaborator responses. Viewers cannot edit. Editors can change shared itinerary items through the web app, but cannot manage invitations or booking status. Neither role can access another private trip or private research.
- Invitations are managed through verified direct web sessions. Existing assistant write grants do not acquire sharing authority. Invited `get_itinerary` reads enforce the same membership boundary.
- Revocation denies subsequent reads and writes after its transaction commits. The app discards the plan on an access-denied refresh and rechecks collaborator access when returning to the tab outside an open dialog. Saves from an already-open editor still check current permissions. Revocation cannot retract previously read/copied information or cancel an already-running read snapshot.

## Implementation

Migration `006_itinerary_sharing.sql` adds hash-only invitations and viewer memberships. These tables enable RLS and revoke access from public, anon and authenticated database roles. Application access is checked on every direct or MCP request.

Invitation tokens contain 32 random bytes. The URL uses `/itinerary#invite=TOKEN` so the credential does not enter HTTP paths, server access logs or referrers. The frontend removes the fragment and retains pending invitations only in the current tab’s session storage while navigating to account sign-in. The account page accepts only the fixed `returnTo=itinerary` destination; OAuth assistant consent takes priority. Email confirmation retains the existing exact `/account` redirect. A person who confirms in another tab returns to the original invitation tab and signs in.

Only the token hash persists, including in the idempotency cache. An identical create retry returns the invitation ID but no token; after a lost response, revoke that pending invitation and create another. Acceptance retries recheck revocation. Creation, acceptance and revocation lock the trip first; acceptance then locks the invitation. Concurrent claims have one winner. Limits: 10 outstanding invitations, 100 total invitations and 20 active collaborators per trip.

## Verification and remaining limits

Automated PostgreSQL and built-browser checks cover account isolation, private projections, hash-only tokens, invitation/revocation races, revision conflicts, idempotency, editor boundaries and revoke/refresh denial. Hosted fictional-trip view links, revocation, second-account confirmation/invitation and signed-in editor changes have bounded evidence. The real-friend phone viewing report is **user-reported**, not independently reproduced; broader friend editor/comment journeys are not implied. See [Issue #2](https://github.com/eddieyang-97/trip-planning-engine/issues/2), related sharing PRs and [current delivery](implementation.md).

Email/password confirmation requires configured SMTP, currently Supabase Auth with Brevo; see [account email delivery](account-linking.md#account-email-delivery). Invitations are shared manually. A one-time pilot delivery does not prove deliverability for every recipient. Never use project administrator invitations as a workaround for signup.
