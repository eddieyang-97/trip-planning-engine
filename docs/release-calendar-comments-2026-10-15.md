# Calendar export and comments: hosted release

The user deployed the latest GitHub commit from their phone on 15 October 2026.
The merged build is serving at https://trip-planning-engine.onrender.com.

## Release evidence

- Tested merged commit: `7669aa86e7be979fc02e395d9bf58bc14e5a1717`.
- [CI run 38724379313](https://github.com/eddieyang-97/trip-planning-engine/actions/runs/38724379313):
  93 passed, zero failed, zero skipped, including pooled PostgreSQL checks.
- Public health returned HTTP 200 with `status: ok`.
- Hosted JavaScript matches the locally built, tracked release code exactly:
  SHA-256 `0c80022f83a1e0bdfd5cb434869f413132a5ec28f2f840597c5adfe66b4790b3`.
- Hosted HTML includes both calendar-export controls and the discussion dialog.

Render's dashboard deployment ID and backend commit were not independently
inspected: the available browser is signed out. These findings establish that
the tested frontend is serving and the new backend routes respond.

## Hosted browser checks

Using only the labelled fictional demo:

- The toolbar opens **Export to calendar** with all six dated items selected;
  the undated item has an explanation and cannot be selected.
- **Deselect all** disables export. Selecting two items prepares two events.
- A downloaded sample `.ics` contains exactly the selected stay and mountain
  day, excludes the unselected flight, and has the expected VCALENDAR envelope.
  The stay ends exclusively on checkout, 20 December; the single activity ends
  exclusively the following day.
- **Select all** prepares six events. **Add to calendar** on an individual
  Details card selects that item alone and prepares one event.
- No browser errors or warnings were recorded.

Live boundary checks returned 401 for an unauthenticated direct export, 400 for
malformed anonymous preparation, and a generic 404 for an invalid file ticket.
Responses include `no-store` and `no-referrer` headers.

## Acceptance still required

The demo creates sample files in browser memory. It does not verify a saved-trip
HTTP export or native Apple Calendar handoff. A physical iPhone/iPad check should
export saved items, open the calendar preview, verify the displayed dates/times,
choose a destination calendar and check repeated-import behavior. Export is a
snapshot; later itinerary edits do not update imported events.

Hosted two-account comment exchange, moderation and revocation remain pending.
Use the existing fictional sharing test; revoke its temporary editor membership
after that run. No real itinerary was modified during these deployment checks.

See [calendar behavior](calendar-export.md) and [discussion access](itinerary-comments.md)
for the feature contracts. Their earlier pending-deployment notes describe the
state before this release; this record supersedes deployment status only.
