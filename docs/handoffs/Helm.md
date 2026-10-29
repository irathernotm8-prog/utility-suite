# Helm: handoff for the Helm chat

Helm is the Utility Package's controller app: a PS5 DualSense (or Edge, PS4, Xbox) drives the whole Mac or Windows PC — pointer on the stick, a touchpad that clicks, scrolls and swipes between desktops, an on-screen keyboard, a quick panel, and a hold-R2 command layer — and it steps aside while a game plays. It lives in `apps/helm` inside `~/Downloads/Utility Package`. `apps/helm/README.md` has the feature list, how it works and the code map.

## Working on it

```bash
cd ~/Downloads/Utility\ Package/apps/helm
npm install        # if Electron didn't download: node node_modules/electron/install.js
npm start          # HELM_DEMO=1 npm start runs with a pretend controller and computer
npm test
npm run e2e
```

To ship a change, bump `version` in `package.json`, then from the Utility Package folder:

```bash
./utility note helm "what changed"
./utility publish
```

Pull before starting work. Stay inside `apps/helm`; `tools/`, `suite.json` and `apps/hub` belong to the Utility Package chat.

## State at first release (0.1.0)

- `npm test` (33 checks) passes; `npm run e2e` (10 checks + screenshots of every page and overlay) passes on Linux under Xvfb with the demo controller.
- On Bilal's Mac (M2): the app starts from source, node-hid enumerates HID devices, the input helper starts and answers, front-app detection works, and every Quartz call the helper uses was probed and works. **Not yet done with a real controller in hand, and nothing has run on Windows yet.** Check these first:
  1. **Mac Accessibility**: allow Helm (or Terminal/Electron in development), then move the left stick. If nothing moves, Settings › Diagnostics shows the helper's errors.
  2. **DualSense over Bluetooth on a Mac**: the touchpad should light up on the Home drawing. If only sticks and buttons work, the controller stayed in its short report (the reader asks for feature report 0x05 to switch it).
  3. **Desktop switching** (hold R2 + d-pad, or a two-finger swipe): needs ⌃← / ⌃→ enabled in Keyboard Shortcuts › Mission Control.
  4. **Windows helper**: first launch compiles `helm-input-<hash>.exe` with `csc.exe` (a second or two). If the pointer doesn't move, Diagnostics shows the compiler output; the fallback runs the same C# inside PowerShell.
  5. **Windows DPI**: the pointer moves in DIPs and is converted with `screen.dipToScreenPoint`; check a mixed-scale setup.
  6. **Lightbar/rumble** on Bluetooth uses CRC'd output reports; if the lightbar never changes colour, the write failed (Diagnostics).

## Rules specific to Helm

- **The windows never touch input.** Everything goes `window.helm.call(...)` → `ipcMain` in `src/main.js`.
- **The mapper stays pure** (`src/core/*`): no Electron, no timers of its own; `test/run.js` drives it with a fake clock and fake output. Add a check for any behaviour change.
- **Every platform module has the same shape** (`start, stop, ready, moveTo, mouse, wheel, key, combo, text, media, command, front, onXInput`); add new functions to `demo.js` too.
- **Never open a controller exclusively** and **send nothing while paused** — that's what keeps games working.
- **The overlay must never take focus** (`focusable: false`, `showInactive`, click-through), or typing would go to Helm instead of the app.
- `src/suitelink.js` is a copy of `tools/suitelink.js`; don't edit it here. Helm offers `status`, `claim`, `release`, `setEnabled`, `toggle`, `open` and the `state` event. Tell the Utility Package chat if these change (Game Hub and Atoll may use them).
- `src/platform/helpers/win-helper.cs` must stay C# 5 (Windows PowerShell 5.1's compiler). `mcs -langversion:5` checks it on Linux/Mac.
