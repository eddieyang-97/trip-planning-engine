# Persistent sign-in and map presentation

Implementation: 16 October 2026. Product scope: PRD priorities 1 and 2 only.

## Browser session

Account and Itinerary use the same Supabase client configuration and `travel-account` local-storage key. Supabase retains the refreshable session; passwords are never persisted by the application. Valid sign-in survives navigation and closing/reopening app tabs. The provider still validates direct-session JWTs; MCP OAuth grants remain separate. Signing out uses Supabase's local scope, ending this browser's session without revoking unrelated assistant grants.

A one-time migration moves the previous tab session and pending PKCE verifiers into persistent storage. An existing persistent account wins. The migration marker remains after sign-out so an old tab cannot restore its stale session. Invitation/view-link credentials stay in tab storage. If browser storage is blocked, the app reports a recoverable error rather than silently promising persistence. Private browsing and clearing site data can end persistence.

Auth events and cross-tab storage changes synchronously clear private UI on sign-out/account changes, then reload outside Supabase's auth callback. Account generations reject responses started under a previous identity; rejected authentication also invalidates outstanding responses. Browser back/forward-cache restoration clears and rechecks private pages that may have missed broadcasts. Token refresh for the same identity does not reload the page. Anonymous shared views continue to work without a session. Two-account testing now requires separate browser profiles or private windows; ordinary tabs share the signed-in account.

“Your account” opens account settings; only sign-in/invitation return links automatically continue into the itinerary.

## Map saves

The previously deployed backend preserves pins when an older MCP client omits `mapLocations`; explicit `[]` clears them. Mutations return `mapLocationCount`, and MCP tool instructions require read-back verification. The web editor now checks the response count and the refreshed saved item's labels/coordinates before showing success. A mismatch leaves a reviewable error rather than claiming the pins saved. A plain location string or maps link still does not create coordinates. This release does not backfill existing real-trip pins.

## Presentation

Public website branding is **Trip Planner**, with the headline **Plan, organize and share your trips.** Repository, package and deployment identifiers remain unchanged.

Overview, Details and Map share category meanings: accommodation indigo `#6366F1`, restaurants/bars amber `#F59E0B`, activities green `#16A34A`, and flights/transfers blue `#0284C7`. Notes are neutral slate. Icons, text labels and the map legend provide non-colour cues. Item numbers have a contrasting badge. Selected pins enlarge and gain an outline while retaining their category colours; the corresponding place card is highlighted. Co-located items retain all their category icons and remain individually accessible in the popup and place list. The list also provides precise selection when nearby pins overlap at a wide zoom.

Booking remains a separate labelled checkmark: **Booked · reported by you/owner**. Neither colour nor a checkmark implies supplier verification or a new reservation.

## Validation

- Production build passes.
- Local suite: 105 tests, 102 passed, 3 external-PostgreSQL checks skipped. No paid provider calls.
- New checks cover one-time migration, PKCE migration, persistent account precedence, stale-tab non-resurrection, isolated stores, blocked storage, identity generations, SDK restoration, expired-JWT refresh, sign-out and revoked refresh sessions. Map tests cover mixed-category grouping and save/read-back mismatches; the official MCP integration covers pin write/read, omission preservation and explicit clearing.
- Fictional loopback browser acceptance: Account and Itinerary share sign-in; closing all app tabs and reopening retains it; sign-out removes the other tab's private title/cards; switching to a second fixture identity shows only its trip. Existing pins survive a browser save with verified read-back. Phone-size map legend, category pins and selection inspected.
- A full browser-process restart and real-account hosted sign-in remain joint acceptance checks. Local client recreation/tab closure is evidence of persistence, not a claim those manual checks were performed. Real trips were not changed for these tests.

## Hosted release — 16 October 2026

Code commit: `dd58879073c49c465b14b03e7baf2da002e8f292` (includes `d934eb0` and `a114dd3`). [CI run 38824100758](https://github.com/eddieyang-97/trip-planning-engine/actions/runs/38824100758), job `116727359907`: **105 passed, 0 failed, 0 skipped**, including PostgreSQL 17 checks. The final small correction uses Leaflet's popup-open event so keyboard Enter and pointer activation both highlight selection; keyboard activation passed in the fictional browser fixture.

Existing Free Render service deployment [`dep-db8m5im7bikc73fi10lg`](https://dashboard.render.com/web/srv-db3t3iub7d7c739hfad0/deploys/dep-db8m5im7bikc73fi10lg) reached **Live**, duration 43.9 seconds. `/health` returned `ok`; account and itinerary pages returned 200 with Trip Planner branding. Public `account.js`, `itinerary.js` and `itinerary-views.css` match the tested local build (SHA-256 after newline normalization). The hosted fictional demo displays category legend, mixed-category markers and phone layout; keyboard Enter also highlighted the marker, selected place card and selection status on the deployed service. Real-account hosted sign-in and a full browser-process restart remain joint acceptance checks above.

No migration, new service, paid plan or new access scope was required. The concurrent PRD/calendar drafts were preserved and excluded from this release.
