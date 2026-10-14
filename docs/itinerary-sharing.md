# View-only itinerary sharing MVP

The organizer can create a trip, add manual itinerary items and create a private invitation from **Share trip**. A friend opens the URL, signs into their own travel account, reviews the invitation and joins with a display name. No assistant, API key or developer setup is needed. Comments, proposals and collaborative editing remain a later milestone.

## Scope and privacy

- An invitation is for one person and one trip, expires after seven days if unused, and can be revoked. Accepted membership continues until revoked; expiry does not remove an existing viewer.
- The friend can read current manual itinerary items, dates, local times, practical notes, useful links, open questions and owner-reported booking status. Practical notes and links must not contain details the organizer wants to keep private.
- Research decisions/evidence, booking notes, item history and the owner’s account identifier are omitted from viewer responses. Viewers cannot edit, access another private trip, manage invitations or read private research, even through a connected assistant.
- Invitations are managed through verified direct web sessions. Existing assistant write grants do not acquire sharing authority. The MCP tool count remains 23; invited `get_itinerary` reads enforce the same membership boundary.
- Revocation denies new reads immediately after its transaction commits. The app discards the plan on an access-denied refresh and rechecks viewer access when returning to the tab. Revocation cannot retract previously read/copied information or cancel an already-running read snapshot.

## Implementation

Migration `006_itinerary_sharing.sql` adds hash-only invitations and viewer memberships. These tables enable RLS and revoke access from public, anon and authenticated database roles. Application access is checked on every direct or MCP request.

Invitation tokens contain 32 random bytes. The URL uses `/itinerary#invite=TOKEN` so the credential does not enter HTTP paths, server access logs or referrers. The frontend removes the fragment and retains pending invitations only in the current tab’s session storage while navigating to account sign-in. The account page accepts only the fixed `returnTo=itinerary` destination; OAuth assistant consent takes priority. Email confirmation retains the existing exact `/account` redirect. A person who confirms in another tab returns to the original invitation tab and signs in.

Only the token hash persists, including in the idempotency cache. An identical create retry returns the invitation ID but no token; after a lost response, revoke that pending invitation and create another. Acceptance retries recheck revocation. Creation, acceptance and revocation lock the trip first; acceptance then locks the invitation. Concurrent claims have one winner. Limits: 10 outstanding invitations, 100 total invitations and 20 active viewers per trip.

## Validation and launch dependency

Automated checks cover privacy projection, strict owner writes, unrelated-trip denial, assistant boundaries, hash-only persistence, retries, expiry, single-use claims, revocation and re-invitation. A separate loopback PostgreSQL integration check verifies concurrent claims and revocation ordering with independent connections. Browser QA uses two synthetic identities in an isolated in-memory fixture, including the 390px phone view and actual owner revoke / viewer refresh flow.

**Email delivery must be configured before inviting a new external friend.** On 13 October 2026, the project’s custom SMTP switch was off. Supabase’s built-in sender only sends to project organization members; it is not a production friend sign-up service. Keep email confirmation enabled and configure a verified SMTP sender. Do not add friends as project administrators to work around delivery.

See [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp). The organizer has no owned domain, so the proposed pilot setup is Brevo Free with a verified sender address. Brevo documents automatic replacement of free-email sender domains with `brevosend.com`; this is a temporary pilot route, and an authenticated owned domain is the longer-term option. The account must be approved for sending and confirmation delivery must be tested, including to an external account. [Brevo free plan](https://help.brevo.com/hc/en-us/articles/208589409-About-Brevo-s-pricing-plans), [sender replacement](https://help.brevo.com/hc/en-us/articles/16045394674066-Troubleshooting-Domain-authentication).

Implementation commit `f6f1670ad5dad6dfb9200d2e514b56724d94cdc5` was pushed and manually deployed to the existing Free Render service on 14 October 2026. [CI run 38488584377](https://github.com/eddieyang-97/trip-planning-engine/actions/runs/38488584377) passed all 72 tests with zero skipped, including all three pooled PostgreSQL checks. Browser QA verified the synthetic owner/viewer flow, new itinerary creation, phone width, private-note omission and revocation. The hosted `get_itinerary` now returns the new owner role; the existing Flaine manual plan remains at revision 1 with no items, and its saved research remains intact. No new provider run or real membership grant was made.

Opening Render was initially blocked by automatic approval review's usage limit. After its stated reset time passed and normal browser review became available again, the same authorized deployment action succeeded; no alternative execution channel was used to bypass the failed review.

Brevo Free onboarding is complete, with a verified sender and 300 daily emails displayed. The user entered and saved the SMTP key and verified sender directly in Supabase. A dashboard reload confirmed custom SMTP enabled, host `smtp-relay.brevo.com`, port 587, sender name Travel Research and a stored, hidden password. External confirmation delivery remains unverified; do not describe new-friend onboarding as ready until that check passes. The SMTP credential, account identifier and postal address are not recorded here.

Hosted organizer acceptance on 14 October created **Sharing test — fictional itinerary**, dated 1–2 January 2027 for one adult, and saved a tentative note explicitly labelled fictional. A connected MCP read independently returned that same item at revision 2. This verifies hosted trip creation, manual saving and web-to-MCP read continuity; cross-surface editing remains a separate acceptance gap. A single-use invitation labelled Own test account was created only for this synthetic trip, and its separate signed-out browser tab reached account creation with the pending invitation retained. Confirmation delivery, authenticated viewer acceptance and hosted revocation are pending the user's second-account sign-up. The real Flaine trip remains unchanged and private.

Credentials belong in the provider/Supabase dashboard, never this repository or chat. The user completes provider account creation, password and terms steps. Configure the sender and SMTP credentials from that account, keep confirmation enabled, then test sign-up before a real friend invitation.
