# Waypoint

Plan and book whole trips in one place, and carry them anywhere. Mac and Windows (Electron), part of the Utility Suite.

## What it does

- **Trips**: one card per trip with a cover, countdown and what's next; upcoming and past trips; duplicate, delete (to the Trash).
- **Interactive day timeline**: an hour grid per day. Drag a plan to move it (15-minute snapping), drag its bottom edge to change how long it runs, drop it on another day in the day strip to move it there, drag an “any time” plan onto the grid to give it a time. Double-click the grid to add a plan. Overlaps are striped and flagged, free stretches show on hover and in the side panel, a red “now” line runs during the trip (in the destination's time zone). Zoom in/out, “All days” list, keyboard: ← → days, N new, Delete, ⌘/Ctrl-D duplicate.
- **Book** (flights and stays):
  - **In the app**: with a Duffel key (Settings › Booking), search every airline Duffel carries — sort by cheapest/fastest/earliest, filter stops — and buy the ticket in one step from your Duffel balance. With a LiteAPI key, search hotels by city, see rooms and cancellation terms, re-check the price, and book on the card saved in your LiteAPI account. Test keys (`duffel_test_…`, `sand_…`) run the whole flow without charging anything. Live mode asks you to confirm names and dates first.
  - **On booking sites, inside Waypoint**: Google Flights, Kayak, Skyscanner, Expedia, Booking.com, Airbnb, Google Hotels and Hotels.com open in Waypoint's own browser with the search filled in (sign-ins stick). When it spots a confirmation page, **Save to trip** saves the page as a PDF and opens a booking filled in with the reference, total and dates.
  - Either way the booking lands in Bookings, on the timeline and in the budget, with a confirmation PDF in Documents. Saved travelers (names as on passports, birth dates, contacts) fill in checkouts; they and the keys are encrypted with the system keychain and never go into trips, packs or .waypoint files.
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

Trips: `~/Documents/Waypoint/<Trip>/trip.json` + `Documents/` (change in Settings). Settings and `private.bin` (encrypted keys and travelers): the app-data folder. Nothing goes online except searches and bookings you make.

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
| `src/core/providers.js` | Duffel (flights) and LiteAPI (stays) clients, plus sample services for `WAYPOINT_DEMO` |
| `src/core/capture.js` | booking-site links, reading confirmation pages, orders → trip bookings, confirmation PDFs |
| `src/core/secrets.js` | keys and traveler profiles, encrypted with Electron safeStorage |
| `src/core/airports.js` | offline airport list for the search form (shared with the window) |
| `src/browser.js` | the booking browser window (toolbar + site view, `persist:waypoint-web` session) |
| `src/demo.js` | sample trips (“Try a sample trip”, `WAYPOINT_DEMO=1`) |
| `src/renderer/*` | the window: one file per view, `app.js` shared helpers, `boot.js` start-up |

## Working on it

```bash
npm install
npm start                 # WAYPOINT_DEMO=1 npm start for sample trips
npm test                  # 13 Node checks, no Electron (booking is tested against mock Duffel/LiteAPI servers)
xvfb-run -a node test/e2e/shots.js   # Linux: screenshots of every screen + phone page + PDF
```
