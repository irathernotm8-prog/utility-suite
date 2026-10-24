# Waypoint: handoff for the Waypoint chat

Waypoint is the Utility Package's travel planner: trips with interactive day timelines, bookings, documents, budgets and destination research, all kept on the computer so they work offline, and handed to a phone (QR over Wi-Fi), another computer (Beam or a `.waypoint` file) or anywhere (one-file offline pack, PDF). It lives in `apps/waypoint` inside `~/Downloads/Utility Package`. `apps/waypoint/README.md` has the features and code map.

## Working on it

```bash
cd ~/Downloads/Utility\ Package/apps/waypoint
npm install
npm start          # WAYPOINT_DEMO=1 npm start shows sample trips
npm test           # 10 Node checks, no Electron
```

To ship a change, bump `version` in `package.json`, then from the Utility Package folder:

```bash
./utility note waypoint "what changed"
./utility publish
```

Pull before starting work. Stay inside `apps/waypoint`; `tools/`, `suite.json` and `apps/hub` belong to the Utility Package chat.

## State at first release (0.1.0)

- `npm test`: dates/DST/time zones, timeline layout and clashes, free time, booking → timeline sync (stays, cars, overnight flights, turning off), budget with currencies/missing rates/settle-up, country data, the store (no path tricks, damaged trip.json falls back to .bak), `.waypoint` round trip with a 9 MB file, copy vs replace, a flipped byte and a cut-short file caught, the offline pack (script-injection safe, embedded vs linked docs), the phone server (page, docs with ranges, offline download, trip file, wrong token, unshared trip, new link).
- `test/e2e/shots.js` (Linux, Xvfb): every screen dark and light, a real drag (move an hour, then onto another day), the phone page at iPhone size, the offline copy opened from disk with the network off, and the PDF.
- **Not yet run on a real Mac or Windows PC.** Check first:
  1. **Phone hand-off**: Windows Firewall asks on first share — allow **Private networks**; the Wi-Fi must be set to Private. On Mac the firewall may ask to accept incoming connections.
  2. **`.waypoint` double-click / Open With** (`fileAssociations` in package.json) and **Send with Beam** (looks for `/Applications/Beam.app` or `%LOCALAPPDATA%\Programs\Utility Suite\Beam\Beam.exe`).
  3. **PDF/image preview windows** and **Save PDF** on both systems.
  4. Saving the offline pack on iPhone: Safari puts the downloaded page in Files; opening it from there works offline.

## Rules specific to Waypoint

- **Times are local to the trip** (`trip.tz`); `TL.localNow(tz)` drives “today” and the now line. Never store absolute timestamps for plans.
- **Bookings own their timeline items** (`item.bookingId` + `item.part`); always go through `TL.syncBooking` and `writeBack` in `renderer/timeline.js`.
- **Documents are owned by the main process**: `store.save` ignores any doc the window invents and keeps the stored `file`; paths go through `store.docPath` (no escaping the trip folder).
- `src/core/timeline.js` and `places.js` load in both Node and the window — no Node or DOM calls in them.
- The phone server only answers `/w/<token>/<shared trip>/…`, GET/HEAD only.
