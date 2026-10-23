# Vitals

A better task manager and system dashboard for Mac and Windows, part of the Utility Suite.

## What it does

| Page | What you get |
|---|---|
| **Overview** | Live processor, memory (with pressure), graphics and temperature gauges; network and disk activity charts with hover; the apps using the most; storage; battery; today's time summary; health score |
| **Activity** | Every running app with its helpers grouped under it (all Chrome helpers count as Chrome), shown as App, Background or System. Sort by CPU or memory, search, expand to processes, details drawer, Quit and Force quit |
| **Apps** | Everything installed, with version, size, last used and install date. Filters for *Not used lately*, *Largest* and *System*. **Uninstall**: Mac moves the app and the files it leaves in your Library to the Trash, and you pick which ones; Windows opens the app's own uninstaller (Store apps are removed directly) and the list updates when it's done |
| **Startup** | Login items, launch agents and system services (Mac); Run keys, Startup folders and sign-in scheduled tasks (Windows). Turn each one on or off, see what's running, and spot items whose app is gone |
| **Permissions** | Which apps can use the camera, microphone, screen, accessibility, files, contacts, photos… Grouped by permission or by app. Remove access in one click. Windows also shows when each was last used and flags anything **in use right now** |
| **Time & Focus** | Which app is in front, tracked while Vitals runs (even with the window closed). Active time, deep-focus sessions, app switches per hour, a focus score, the day hour by hour, a session timeline, and 7/30-day views. Mark apps Focus, Neutral or Distracting |
| **Thermals & Power** | Processor and graphics temperatures, thermal pressure, per-core load and temperature, fans, battery health, cycles, capacity, temperature and power draw |
| **This Mac / This PC** | Model, chip, cores, memory modules, graphics, displays, drives, OS, firmware, network. Copy specs in one click; serial numbers hidden until you click |
| **Checkup** | Plain-language findings, worst first: full disk, memory pressure, swap, hot or throttled processor, worn battery, long uptime, too many or broken startup items, apps unused for 6 months, sensitive permissions. **Save report** as PDF or HTML |

Also: a menu-bar (Mac) / tray (Windows) item showing CPU, memory or temperature; alerts when the computer runs hot or memory runs out; open at login; light and dark themes; Cmd/Ctrl+1–9 to jump between pages.

## Where data comes from

| | Mac | Windows |
|---|---|---|
| Processes | `ps` + `top` (memory footprint, same as Activity Monitor) + `lsappinfo` (which apps have windows) | `systeminformation` (CIM) + `Get-Process` (windows, descriptions) |
| Memory | `vm_stat`, `vm.swapusage`, memory pressure level | `systeminformation` |
| GPU | `ioreg` IOAccelerator (no admin) | `nvidia-smi` when present, else GPU Engine counters |
| Temperatures | `macos-temperature-sensor` (Apple Silicon, optional native module), `powerMonitor` thermal state, `pmset -g therm` | ThermalZoneInformation counters (no admin), `nvidia-smi` |
| Battery | `ioreg AppleSmartBattery` | `systeminformation` |
| Apps | `/Applications`, `~/Applications`, `/System/Applications`; Info.plist; Spotlight (`mdls`) for last used | Uninstall registry keys (HKLM, WOW6432Node, HKCU) + `Get-AppxPackage` |
| Startup | System Events login items, LaunchAgents/LaunchDaemons, `launchctl enable/disable` | Run keys + StartupApproved (what Task Manager uses), Startup folders, `schtasks` |
| Permissions | TCC databases via `sqlite3` (needs Full Disk Access for Vitals), `tccutil reset` | CapabilityAccessManager ConsentStore |
| Front app | `lsappinfo front` | `GetForegroundWindow` through a persistent PowerShell |

Windows commands share long-lived PowerShell processes (`src/sys/run.js`) so polling stays cheap.

## Code map

```
src/main.js            window, tray, settings, IPC, caches, report export
src/preload.js         window.vitals.call / on
src/report.js          printable health report
src/sys/run.js         exec helpers, admin prompts, persistent PowerShell
src/sys/parse.js       pure parsers for every tool's output + process grouping (tested)
src/sys/metrics.js     the live Sampler (CPU, memory, GPU, network, disk, battery, thermals, volumes)
src/sys/processes.js   process snapshot and quitting
src/sys/apps.js        installed apps, leftovers, uninstall
src/sys/startup.js     startup items and toggling
src/sys/perms.js       privacy permissions
src/sys/focus.js       time tracker, per-day JSON in userData/focus
src/sys/specs.js       hardware info
src/sys/checkup.js     findings and score
src/renderer/          index.html, styles.css, charts.js (canvas charts), app.js
build/make-icon.py     regenerates icon.png and the menu-bar template images
```

## Tests

```bash
npm test                         # 21 parser/grouping/focus/checkup checks (Node only)
test/e2e/run.sh                  # Linux + Xvfb: drives every page, 19 checks, screenshots in test/e2e/out
VITALS_DEMO=1 test/e2e/run.sh    # same, pretending to be a Mac with sensors, apps, startup items and permissions
```
