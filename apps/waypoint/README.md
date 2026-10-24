# Waypoint

Plan whole trips in one place and carry them anywhere. Mac and Windows (Electron), part of the Utility Suite.

## What it does

- **Trips**: one card per trip with a cover, countdown and what's next; upcoming and past trips; duplicate, delete (to the Trash).
- **Interactive day timeline**: an hour grid per day. Drag a plan to move it (15-minute snapping), drag its bottom edge to change how long it runs, drop it on another day in the day strip to move it there, drag an “any time” plan onto the grid to give it a time. Double-click the grid to add a plan. Overlaps are striped and flagged, free stretches show on hover and in the side panel, a red “now” line runs during the trip (in the destination's time zone). Zoom in/out, “All days” list, keyboard: ← → days, N new, Delete, ⌘/Ctrl-D duplicate.
- **Bookings**: flights, stays, car hire, trains, tickets, tours, restaurants — confirmation numbers (click to copy), times, addresses, seats, cost and paid/unpaid, attached documents. Each booking with a date puts itself on the timeline (check-in/out, pick-up/drop-off, overnight flights split across days); dragging those plans moves the booking too.
- **Documents**: drop files anywhere in the window. Copies live in the trip folder, filed as passports, visas, tickets, confirmations, insurance… with “whose” and “goes with booking”. Image and PDF previews.
- **Budget**: planned by category vs booked vs spent, any currency with your own exchange rates (offline), spending by day against a daily target, quick-add expenses, and who owes whom.
- **Research**: built-in key facts for 52 countries (emergency numbers, currency, plugs and voltage, driving side, dialling code, languages, time zone — all overridable), local time, places to go (one click puts one into a day's free time), saved links, packing list, notes.
- **Take it with you** (the fast hand-off):
  - **To your phone**: a QR code; the phone opens the trip straight from this computer over Wi-Fi, and “Save for offline” downloads the self-contained page.
  - **Offline pack**: one HTML file with every day, booking, key fact and (optionally) the documents inside — opens on any device with no app and no internet.
  - **Another computer**: “Send with Beam” hands a `.waypoint` file to Beam; or save the `.waypoint` file and move it any way. Double-click / drop it on Waypoint to open (keep both or replace).
  - **PDF itinerary** for printing or email.

## Where things live

Trips: `~/Documents/Waypoint/<Trip>/trip.json` + `Documents/` (change in Settings). Settings: the app-data folder. Nothing goes online.

## Code map

| File | What |
|---|---|
| `src/main.js` | window, settings, menu, the `api` table the window calls |
| `src/core/timeline.js` | dates/times, layout, clashes, free time, booking → timeline sync, budget maths, checks (shared with the window) |
| `src/core/places.js` | offline country facts (shared with the window) |
| `src/core/store.js` | trip folders, atomic saves with `.bak`, documents |
| `src/core/bundle.js` | `.waypoint` export/import (streamed, SHA-256 per file) |
| `src/core/pack.js` | the offline pack page and the printable itinerary |
| `src/core/share.js` | Wi-Fi hand-off server (secret link, range requests) + QR |
| `src/demo.js` | sample trips (“Try a sample trip”, `WAYPOINT_DEMO=1`) |
| `src/renderer/*` | the window: one file per view, `app.js` shared helpers, `boot.js` start-up |

## Working on it

```bash
npm install
npm start                 # WAYPOINT_DEMO=1 npm start for sample trips
npm test                  # 10 Node checks, no Electron
xvfb-run -a node test/e2e/shots.js   # Linux: screenshots of every screen + phone page + PDF
```
