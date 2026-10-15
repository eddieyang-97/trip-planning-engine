# Itinerary timezone picker

Start and end time zones use separate searchable city/country comboboxes. Users can search city names, country names or IANA identifiers, choose with mouse/touch or arrow keys and Enter, and leave either field empty when unknown. The displayed label is friendly (for example, Rome — Italy); saved itinerary fields remain the existing IANA identifiers. The picker never guesses a zone from the destination and does not change stored dates or local times.

Saved aliases retain their original IDs. Unknown future saved IDs remain intact when another item field is edited. Unselected search text cannot silently replace or reuse the previous zone: users must choose a result or clear the field before saving. Keyboard Escape closes the results before closing the item dialog. On narrow screens each picker spans the editor width.

The bundled country-specific metadata derives from IANA tzdb’s public-domain [zone.tab](https://github.com/eggert/tz/blob/main/zone.tab), including aliases that retain a city/country label. The source URL, retrieval date and SHA-256 are recorded in `web/timezone-data.ts`. Browser Intl supplies country labels and supported timezone names; existing server validation remains authoritative. No provider, geocoder, runtime service or npm dependency is added. The stored identifiers retain daylight-saving rules rather than freezing a UTC offset. A few explicit destination search aliases help find the appropriate representative city; they do not populate the fields automatically.

Validation covers city/country/identifier and destination searches, distinct regional clock rules, legacy and unknown ID preservation, and seasonal Rome offsets. Isolated browser acceptance verified keyboard and pointer selection, separate start/end values surviving save/reopen, invalid-text rejection, optional clearing and the narrow-screen layout. Implementation `93d2289` passed [CI run 38662588755](https://github.com/eddieyang-97/trip-planning-engine/actions/runs/38662588755): **83 passed, zero skipped**, including all three pooled PostgreSQL checks. The local isolated run passed 80 with those three checks skipped. A 390px phone viewport reported 375px document width with no overflow and a 274px result panel spanning the editor. 

The exact tested commit was [deployed on 15 October 2026](https://dashboard.render.com/web/srv-db3t3iub7d7c739hfad0/deploys/dep-db829a0m7kps73cp05fg) at 01:56 London time, completing in 42.9 seconds. Render showed Deploy succeeded/Live and `/health` returned 200 with status ok. The release contains only the timezone change; concurrent calendar work stayed outside this commit.

Hosted browser acceptance opened an existing flight editor and verified its saved start/end IDs display as London — United Kingdom and Rome — Italy. Searching Italy returned the Rome result with Europe/Rome beneath it. The editor was cancelled without saving; no real itinerary values, revisions or booking state were changed. Save/reopen, invalid input, clearing and phone-width checks used only the isolated fictional fixture.

## Touch selection regression — 15 October 2026

A user reported that tapping Rome after searching `alba` on an iPhone left the
typed query in the field. The previous picker committed only on click while
closing immediately on blur. The fix commits a stationary primary-pointer
release and keeps an in-progress option gesture alive across input blur. Touch
selection finishes keyboard editing before setting the chosen label; scrolling,
cancelled gestures and secondary buttons do not select. A following compatibility
click is ignored, while keyboard and assistive click activation remain supported.
The search inputs also disable keyboard autocorrection and automatic capitals
for city names and IANA identifiers.
The relative ordering of focus/blur and pointer events varies between browsers;
see the [Pointer Events specification](https://w3c.github.io/pointerevents/).

Exact destination aliases now rank before incidental substrings: `alba` shows
Rome first, ahead of Albania and Svalbard. Stored IANA IDs and local times are
unchanged by search ranking.

Regression tests replay tap-without-click, duplicate click, drag, cancellation,
foreign-pointer, mouse and assistive activation sequences. The complete local
suite passed 93 tests with three external PostgreSQL checks skipped. The browser
fixture verified `alba` → Rome selection, a closed panel, keyboard selection for
the other zone, and both zones surviving save/reopen. At 390px viewport width,
document width and scroll width were both 375px. All writes used an isolated
fictional itinerary. Actual iPhone Safari confirmation remains required after
deployment; the desktop browser's phone viewport does not emulate its keyboard
or native touch event ordering.
