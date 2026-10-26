# Atoll

A Dynamic Island for your desktop, part of the Utility Suite. It sits at the top centre of the screen (flush against the notch on a MacBook that has one, a floating pill everywhere else), shows what's live in the space around it, and opens into a full panel when you hover or press **⌘⌥Space / Ctrl+Alt+Space**.

## What it does

| Module | In the island | Open |
|---|---|---|
| **Music** | Cover art on the left, an equaliser tinted to the cover on the right; a moment with the cover when the song changes | Big cover, title, artist and album, a scrubber you can drag, previous / play-pause / next, system volume |
| **Timers** | The soonest timer counting down with a progress ring; a finished timer rings until you stop it | Type any time (`5`, `1:30`, `90s`, `1h 15m`) with a label, quick presets, several timers at once with pause, +1 min and cancel. **Focus** sessions (work / short break / long break cycles) and a **stopwatch** with laps |
| **Live match** (Touchline plugin) | Both crests and the score, a pulsing live dot; goals, kick-off and full-time grow the island into a moment | Scoreboard with minute, red cards and every goal, card and VAR call. Follow a team (Atoll finds its match each day and shows the next one in between) or pin one of today's matches |
| **Shelf** | Drag files onto the pill and it opens to catch them | Files wait there (as paths, nothing is copied) until you drag them out into any app; double-click opens, the folder button reveals. Clipboard history of recent text, in memory only |
| **Weather** | Temperature in the header | Now, high / low and the next hours, from Open-Meteo for the city you choose |
| **System** | | Battery, processor and memory on Home |

When two things are live at once the first takes the island and the second gets the little bubble beside it (the order is in Settings › Island). The menu bar / tray item starts timers and focus sessions and can hide the island.

## Where everything comes from

| | Mac | Windows |
|---|---|---|
| Now playing | Music and Spotify through Apple Events (`osascript`; asks `running()` first so polling never launches them). Music's artwork is written to a file by AppleScript; Spotify's comes from its URL | The system media controls (`GlobalSystemMediaTransportControlsSessionManager`) in one long-lived PowerShell: Spotify, Apple Music, Media Player, browsers, anything that shows in the volume flyout. Thumbnail from the session |
| System volume | `set volume` | Core Audio through a small C# class (same as Scene's) |
| Football | FotMob via Touchline's data layer (`src/touchline/vendor`, copied from `apps/touchline/src/data`), ESPN backup | same |
| Weather | Open-Meteo forecast + geocoding (no key) | same |
| Battery | `navigator.getBattery()` in the page | same |
| Memory | `vm_stat` (active + wired + compressed) | `os.freemem()` |

macOS 15.4 closed the system-wide Now Playing API to other apps, so browser audio isn't shown on a Mac.

## Code map

```
src/main.js              app, tray, shortcut, settings window, every call from the pages (API)
src/island.js            the island window: notch detection, top-centre placement, sizing
src/store.js             settings.json and state.json (timers, shelf, followed match)
src/modules/timers.js    timers, stopwatch, focus; pure apart from setTimeout
src/modules/media/       index.js (polling, artwork, choosing a player), mac.js, win.js, demo.js
src/modules/match.js     the Touchline plugin: follow a team or a match, goal/kick-off/full-time moments
src/modules/shelf.js     files and clipboard history
src/modules/glance.js    weather and CPU / memory
src/touchline/           index.js (day, match, team, search), images.js (atoll-img:// crest cache), vendor/
src/renderer/island.*    the island page: compact, peek and open shapes, all views, sounds
src/renderer/settings.*  the settings window
build/make-icon.py       icon and menu bar / tray glyphs
test/run.js              Node checks; test/e2e/ drives the real windows and saves screenshots
```
