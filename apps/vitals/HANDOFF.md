# Vitals: handoff for the Vitals chat

Vitals is the Utility Package's system app: a better task manager (apps with their helpers grouped, CPU, memory, quit/force quit), a live dashboard (CPU, memory pressure, GPU, temperatures, network, disk, battery), installed apps with uninstall, startup items, privacy permissions, time and focus tracking, specs, and a Checkup with a PDF report. It lives in `apps/vitals` inside `~/Downloads/Utility Package`. `apps/vitals/README.md` has the feature list, where each number comes from on Mac and Windows, and the code map.

## Working on it

```bash
cd ~/Downloads/Utility\ Package/apps/vitals
npm install
npm start
npm test
```

To ship a change, bump `version` in `package.json`, then from the Utility Package folder:

```bash
./utility note vitals "what changed"
./utility publish
```

Pull before starting work. Stay inside `apps/vitals`; `tools/`, `suite.json` and `apps/hub` belong to the Utility Package chat.

## State at first release (0.1.0)

- Built and tested on Linux (Electron 44 under Xvfb). `npm test` runs 23 Node checks on fixtures of real tool output: `vm_stat`, `ps`, `top`, `lsappinfo`, `ioreg` (GPU and battery), `mdls`, `launchctl`, TCC rows, Windows `reg query` (uninstall keys, StartupApproved, ConsentStore), process grouping on both systems, the focus tracker and the checkup.
- `test/e2e/run.sh` drives every page in the real window (19 checks). `VITALS_DEMO=1` fakes a Mac with sensors, battery, apps, startup items and permissions so those pages can be checked too.
- **Not yet run on a real Mac or Windows PC.** Check these first:
  1. **Mac temperatures.** They come from the optional native module `macos-temperature-sensor` (Apple Silicon). It compiles during `npm install`, which needs the Xcode command line tools. If it's missing, Vitals still runs and shows thermal pressure (`powerMonitor.getCurrentThermalState()`) instead of degrees. MacBook Air has no fans, so the Fans card says so.
  2. **Permissions on Mac** need Full Disk Access for Vitals (the page walks you through it). Reading uses `sqlite3` on both TCC databases; Remove uses `tccutil reset`, falling back to an admin prompt for system-level ones.
  3. **Login items** use System Events, so the first visit to Startup asks to allow automation. Newer apps' background items (SMAppService) can only be switched off in System Settings › Login Items; the page links there.
  4. **Activity memory on Mac** is the footprint from `top` (matches Activity Monitor), refreshed every ~6 s; RSS fills in until then.
  5. **Windows** polls through two shared PowerShell processes (`fast` and `slow` in `src/sys/run.js`). If anything looks stuck, that's the place to look. Processes come from `systeminformation` with `powerShellStart()`.
  6. **Windows uninstall** starts the app's own uninstaller (MsiExec `/I` becomes `/X`), then polls the registry every 3 s and removes the row when it's gone.
  7. **Windows startup toggles** write the same StartupApproved bytes Task Manager does; HKLM items and scheduled tasks show a UAC prompt.

## 0.1.1 — fixes from the first real runs

- **Mac crashed about 2 s after launch** (`EXC_BREAKPOINT` on a `ThreadPoolForegroundWorker` thread). Cause: `app.getFileIcon` crashes Electron 44 on macOS — the same crash Fresh Desk hit. Mac icons now come from the bundle's `.icns` via `plutil` + `sips`, cached in `userData/app-icons` (`macAppIcon` in `main.js`). Processes outside an `.app` show initials. `test/run.js` fails if `getFileIcon` ever appears in the Mac path again.
- **Windows Overview stayed empty.** Cause: `systeminformation`'s persistent PowerShell (`powerShellStart`) stops answering for good after any command writes to stderr, and the sampler awaited it. Now: no `powerShellStart`; Windows processes, network, page file, disk, GPU and thermals all go through Vitals' own runner (`src/sys/run.js`); and the sampler only awaits memory — every other collector refreshes in the background with an in-flight guard and a hard timeout (`Sampler.refresh`), so one stuck command can't stop the readings.
- The runner now marks the start and end of each answer (PowerShell can print terminal codes before output), writes results with `[Console]::Out.WriteLine` (no line wrapping of long JSON), and a shell killed after a timeout can no longer knock out its replacement. `VITALS_PWSH=/path/to/pwsh node test/ps-runner.js` checks it against real PowerShell; every Windows script was also checked with PowerShell's parser.
- The native temperature module now runs in a child process (`src/sys/temp-worker.js`, started with `fork`), so a sensor problem can't take the app down either. After 3 failures Vitals stops trying and shows thermal pressure.

## 0.2.0 — Upgrade tab

- **Upgrades** (`src/sys/upgrade.js` → `inventory()`, `src/sys/advisor.js` → `advise()`): reads memory slots/type/speed/max, drives (bus, media, wear), graphics (real VRAM from the registry on Windows), socket, chassis, battery and Apple display support, then gives each component a verdict (upgradeable / built in / limited / unknown) and ranks suggestions. Only suggests a part when the exact spec is known (memory type + form factor + speed, within the board's maximum and slot count). Shop links are search URLs (Crucial, Kingston, OWC, Newegg, Amazon), plus iFixit; install guides live in `src/renderer/guides.js`. The last inventory is saved in `state.json`; **Check my upgrade** rescans and shows what changed (`diffInventory`).
- **Drivers & updates**: Windows problem devices (`Win32_PnPEntity` error codes), important drivers with age and vendor links, and a Windows Update search (COM, slow, on request; its own PowerShell shell `updates`). Mac: `softwareupdate --list` on request, system extensions and third-party kexts.
- **Drives**: external and internal volumes, rename (`diskutil rename` / `Set-Volume`, UAC fallback with `label`), eject, and a speed test. Windows tests with unbuffered I/O (C# compiled by `Add-Type`, shell `disk`); a Mac remounts an external volume between write and read so the read isn't from cache (internal Mac drives are marked "may be cached").
- Checked here: advisor fixtures (Windows desktop, Apple Silicon Air, soldered laptop), every new PowerShell script through PowerShell's parser, the C# compiled with real PowerShell, the speed test on Linux, and the page under `VITALS_DEMO=1` (Mac) and `VITALS_DEMO=win`. **Not yet on a real Mac/PC**: first things to look at are `system_profiler` field names for memory on your model, `Get-StorageReliabilityCounter` (can need admin; wear just won't show), and the Windows Update search time.

## Rules specific to Vitals

- **The window never runs commands.** Everything goes through `window.vitals.call(...)` → `ipcMain` handlers in `main.js`, which call `src/sys/*`.
- **Parsers stay pure** in `src/sys/parse.js` with a fixture test in `test/run.js`. Add a fixture whenever a tool's output changes.
- **Time tracking stores only the app and the seconds**, never window titles, in `userData/focus/YYYY-MM-DD.json`. It runs while the window is closed (`keepRunning`, on by default) and pauses on lock, sleep and idle.
- **Never call `app.getFileIcon` on macOS** (crashes Electron 44). Mac icons come from `plutil` + `sips`; Windows uses `getFileIcon`, one at a time.
- **The sampler never awaits slow work.** New collectors go through `Sampler.refresh(key, fn, everyTicks, timeoutMs)`.
- **Don't use `systeminformation` for anything PowerShell-based on Windows**; use `ps()`/`psJson()` from `run.js`.
- **Destructive actions always confirm**, and Mac uninstalls go to the Trash, never straight to deletion.
- Native module: `macos-temperature-sensor` is an `optionalDependency` with `os: darwin, cpu: arm64`, so Windows cross-builds (`npm ci --os=win32`) skip it. Everything else is plain JS (`systeminformation`).

## Utility Suite link (0.2.1)

Vitals now offers a few things to other suite apps (Atoll's add-ons) over the **Utility Suite link**: `src/suitelink.js`, a copy of `tools/suitelink.js` in the Utility Package. Keep it identical to that file; the Utility Package chat owns it. It's a Unix socket in `~/Library/Application Support/Utility Suite/link` (mode 0600) on a Mac and a per-user named pipe on Windows, so only this user's apps can reach it. Everything is in `src/main.js` under "Utility Suite link".

- Offers: `stats`, `history`, `open`; event `tick` (each sample, only while something is connected).
- Nothing changes when no other app is connected: events are only sent while something is listening.
- If you rename or remove one of these, tell the Utility Package chat so Atoll keeps working.
