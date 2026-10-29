# Helm

Run the whole computer from a game controller, on a Mac or a Windows PC. Pick up a PS5 DualSense (or a DualSense Edge, a PS4 controller or an Xbox controller) and point, click, scroll, swipe between desktops, type, switch apps and control playback without touching the keyboard or mouse. Helm steps aside on its own while a game is playing.

## What it does

**Everyday (default buttons)**

| | |
|---|---|
| Left stick | Pointer: smooth, with an acceleration curve, a boost at full tilt, and sub-pixel precision |
| Right stick | Smooth scrolling, both directions |
| L2 (analog) | Squeeze to slow the pointer for fine work; L3 toggles precision |
| Cross / Square | Click (held, so drags work) / right-click; double-clicks register on a Mac |
| Circle | Escape |
| Triangle | On-screen keyboard |
| L1 / R1 | Back / forward |
| D-pad | Arrow keys, with key repeat |
| Create | Spotlight (Mac) / Start search (Windows) |
| Options | Mission Control / Task View |
| PS button | Quick panel |
| Mute | Mute |
| R3 | Middle-click |

**Hold R2: the command layer** (a cheat sheet appears after a moment)

D-pad ← → switches desktops, ↑ Mission Control / Task View, ↓ the app's windows; L1/R1 are the app switcher (⌘ / Alt stays held until you let go of R2); right stick up/down is the volume; Cross Return, Circle close window, Square copy, Triangle paste, L2 undo, L3 show desktop, R3 reload, Create screenshot, Options play/pause, PS turns Helm off.

**Touchpad** (PlayStation controllers): one finger moves the pointer (faster the quicker you swipe), tap or press to click, press and slide to drag, two-finger tap or press to right-click, two fingers to scroll (natural, with momentum), two-finger swipe sideways to switch desktops like a Mac trackpad.

**On-screen keyboard**: pick keys with the stick, d-pad or by sliding on the touchpad; Cross or a pad press types, Square deletes, Triangle is space, R2 Return, L2 shift, L1/R1 move the text cursor, Options switches to symbols, Create makes the next key a ⌘ / Ctrl shortcut, Circle closes. It never takes focus, so typing goes to the app you were in.

**Quick panel** (PS button): Search, Keyboard, Mission Control / Task View, Desktop, Apps, Screenshot, Play/pause, Mute, Volume −/+, Lock, Helm settings, plus battery and the time.

**Everything is rebindable** (Buttons page): every button has an everyday action and a command-layer action, chosen from ~60 actions. Pointer, scroll and touchpad feel are on the Pointer & touchpad page.

**Hold Create + Options** for a moment to turn Helm on or off from the couch. Neither button fires when you do.

## Games

Helm never takes the controller away from a game; it reads the controller without locking it, and while a game is playing it sends nothing at all. It rests when:

- the app in front is on the **Games** list (Game Hub, Skyline Protocol, Danger Room, Lethal Protector, Valkorath and Steam Big Picture are there from the start; add any app by name, bundle ID or .exe),
- the app in front **fills the screen** and isn't on the "keep Helm on" list (browsers, video players, Finder/Explorer…), or
- another suite app **claims** the controller over the Utility Suite link (below).

Holding Create + Options while it rests brings Helm back over that app until you switch to another.

### Utility Suite link (`helm`)

| Call | |
|---|---|
| `status()` | `{ enabled, paused, mode, controller }` |
| `claim(owner, seconds = 12, label)` | Helm rests until the claim lapses; renew it every few seconds while a game runs |
| `release(owner)` | End a claim |
| `setEnabled(on)`, `toggle()` | Turn Helm on / off |
| `open()` | Show Helm's window |

Event: `state` `{ enabled, paused }`. Game Hub should `claim('gamehub', 15, 'Game Hub')` every ~5 s while a game is running and `release('gamehub')` when it ends.

## How it works

```
controller ──HID (node-hid, shared)──▶ src/controllers.js ─frame─▶ src/core/mapper.js ──▶ src/output.js ──▶ platform helper ──▶ real input
              XInput (Windows helper) ─┘        (one controller drives at a time)      125 Hz tick       sub-pixel pointer    Mac: JXA + Quartz events
                                                                                         │                                    Windows: C# + SendInput
                                                                    overlay (HUD, keyboard, panel, hint) ◀── ui
```

- **Reading controllers.** `src/core/parse.js` turns raw HID reports into one frame shape (DualSense and Edge over USB and Bluetooth, DualShock 4, Xbox over Bluetooth on a Mac; XInput on Windows). Bluetooth PlayStation controllers are switched to full reports by reading their calibration feature report. Devices are opened non-exclusively so games still see them. The lightbar, player lights and rumble use the controllers' output reports (with the Bluetooth CRC).
- **The mapper** (`src/core/mapper.js`) runs on a steady 8 ms tick against the latest frame, so motion is smooth whatever rate the controller reports at. `touchpad.js`, `keyboard.js` and `panel.js` are its pure helpers; `actions.js` is the action catalog and default bindings.
- **Sending input.** Mac: `src/platform/helpers/mac-helper.js` is a long-running `osascript -l JavaScript` process that posts Quartz events (mouse with click counts, pixel scrolling, keys with modifier flags, media keys). A second copy answers "which app is in front?" so those lookups never delay input. Windows: `src/platform/helpers/win-helper.cs` is compiled once on the PC with the .NET Framework's `csc.exe` (falls back to PowerShell `Add-Type`) into `helm-input-<hash>.exe` in the app-data `bin/` folder; it uses `SendInput` (absolute, per-monitor DPI aware) and polls XInput.
- **Games** (`src/games.js`) polls the app in front every 0.9 s.

## Working on it

```bash
npm install
npm start          # HELM_DEMO=1 npm start: a pretend DualSense and a pretend computer
npm test           # 33 Node checks: parsers, CRC, mapper, touchpad, keyboard, panel, games, output
npm run e2e        # drives the demo controller in the real window; screenshots in test/e2e-out
```

## Permissions and platform notes

- **Mac:** Helm needs **Accessibility** (System Settings › Privacy & Security › Accessibility) to move the pointer and type; the Home page asks and opens the pane, and Helm restarts its input helper by itself once it's allowed. In development, allow the app you run `npm start` from (Terminal / Electron). Mission Control and Launchpad open through `open -b`; desktop switching uses ⌃← / ⌃→ (on by default in Keyboard Shortcuts › Mission Control). Typing uses the US key layout for ASCII and pastes anything else. Tip: in System Settings › Game Controllers, set the controller's Home button to do nothing so the PS button opens Helm's quick panel only.
- **Windows:** no permissions needed. Apps running as administrator don't accept input from a normal-rights app (Windows rule); run Helm as administrator if you need it there. `Win+L` can't be sent by any app, so Lock uses `LockWorkStation`.
- **Xbox controllers** do everything except the touchpad. On a Mac they're read over Bluetooth HID.
- **node-hid** is the one native module: N-API prebuilds for Mac (arm64/x64) and Windows (x64) ship inside the package, so `npmRebuild` is off and Windows cross-builds need no compiler.

## Data

Its app-data folder: `settings.json`, `helm-input.js` (the Mac helper, refreshed from the app on launch), `bin/` (the compiled Windows helper).
