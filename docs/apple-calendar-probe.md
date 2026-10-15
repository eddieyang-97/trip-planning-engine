# Apple Calendar handoff probe

Prepared 14 October 2026. This isolated probe tests the device handoff before
implementing itinerary exports. It uses only fictional events and does not load
accounts, authentication settings, itinerary data or the application database.

## Run

Generate files and check fixture structure:

~~~sh
node scripts/probe-apple-calendar.mjs
~~~

Run a local test page on port 3091:

~~~sh
node scripts/probe-apple-calendar.mjs --serve
~~~

For an iPhone or iPad on the same trusted Wi-Fi, use:

~~~sh
node scripts/probe-apple-calendar.mjs --serve --lan
~~~

The script prints the loopback URL and local network address candidates. Open a
reachable local network URL in Safari on the Apple device. LAN mode serves only
the fictional probe page and calendar fixtures, not arbitrary files or the main
app. It does not change Windows firewall rules. Stop it with Ctrl+C.

Files are generated in the ignored .data/apple-calendar-probe directory.
There is no public deployment or tunnel.

## Device test

Create a disposable Apple calendar named **Trip Planning TEST**. Use a fresh test
calendar for each import attempt so overlapping attempts do not confuse event
counts.

1. Tap **Open one event**. Record whether Calendar offers Add, the browser shows a
   preview, or Safari downloads a file.
2. Tap **Open three events**. Record whether Calendar offers Add All and whether
   all three events actually appear in the selected calendar.
3. Compare the **Download** links if direct opening does not offer an import.
4. Optionally try **Subscribe**. Record this separately: a read-only feed is a
   different product behavior from importing editable events. The probe's
   webcal:// link uses local HTTP, so a result here is not a production HTTPS
   acceptance result. The feed becomes unavailable after the server stops.

Expected fixtures:

| Event | Expected schedule |
| --- | --- |
| Meeting | 15 Oct 2026, 10:00–10:30 Europe/London; 09:00–09:30 UTC |
| Fictional London–Zurich flight | 15 Oct 2026, 10:20 London departure, 13:00 Zurich arrival; 09:20–11:00 UTC |
| Two-night hotel | All day on 15 and 16 Oct; checkout 17 Oct, represented as an exclusive all-day end date |

The single file contains the meeting. The multi-event file contains all three.
Timed events are encoded as UTC instants; Apple Calendar may display them in its
configured calendar/device time zone. No alerts or attendees are included.
The meeting uses the same UID in both fixtures; use separate test calendars
rather than assuming repeated imports deduplicate.

Delete the disposable test calendars when finished.

## Evidence and limits

- Fixture checks passed: event counts, CRLF endings, final calendar delimiter,
  short lines, and the expected UTC and all-day end fields.
- HTTP checks passed for the page, both files, inline/attachment response modes,
  unknown-path rejection, and page access using this computer's LAN address.
- MIME type is text/calendar; charset=utf-8.
- Physical-device multi-event import passed on 14 October 2026: after retrying
  the local test page on their iPhone/iPad, the user confirmed that all three
  test events worked in Apple Calendar. This is user-reported device acceptance.
- Initial page access failed because the foreground probe process had stopped.
  Restarting it as a hidden background process restored access at the same LAN
  address; the user confirmed that the page then worked.
- Exact displayed times, all-day checkout boundaries, repeat-import behavior,
  subscription behavior and production HTTPS delivery were not separately
  confirmed by this device result.
- These checks do not constitute validation by an independent iCalendar parser.
- No Apple login, native calendar write API, production export UI or automatic
  synchronization has been implemented.

Apple documents [iPhone calendar subscriptions](https://support.apple.com/en-gb/guide/iphone/iph3d1110d4/ios)
and [importing .ics files from Mail](https://support.apple.com/en-gu/guide/iphone/ipha0d932e96/ios).
The local browser handoff for the three-event import now has device confirmation.
The full [calendar export feature](calendar-export.md) was implemented and tested
locally on 15 October. Deployment and its final hosted iPhone/iPad acceptance
remain pending; this document preserves the earlier probe evidence.
