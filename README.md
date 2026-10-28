# Utility Package

The one home for every app Bilal has built: the source code, the tool that builds them, and **Utility Hub**, the app that installs and updates them on each computer. It's one GitHub repo; built apps are published to it and Utility Hub updates every computer from there.

| App | What it is | Lives in |
|---|---|---|
| **Assist** | Private, on-device AI chat and reply assistant | `apps/assist` |
| **Atoll** | A Dynamic Island for the desktop: timers and focus, music controls, one live match from Touchline, a file and clipboard shelf, weather and a system glance, in the notch on a MacBook or floating at the top of the screen | `apps/atoll` |
| **Beam** | AirDrop for Macs, PCs and phones: files, folders, text and links straight to nearby devices, encrypted, as fast as the network goes | `apps/beam` |
| **Bench** | A test workspace for Claude: sandbox desks that run apps on this computer with their own data, Mac/Linux VMs and Windows Sandbox for clean desktops, a live view, parallel smoke tests of the whole suite, findings, and a Claude/Codex plugin to launch, see, click, type and read errors | `apps/bench` |
| **Cadence** | Automations on a schedule: pull reports from sites, file them by week, and build slides and reports, with Claude and Codex plugged in | `apps/cadence` |
| **Crate** | Music downloads as tagged MP3s, album editing, and sending to your phone | `apps/crate` |
| **Datum** | Linked spreadsheets, slides, docs and dashboards | `apps/datum` |
| **Decomp** | Takes any app apart: decompiles Windows, Mac, Linux, Android, iOS, Java, .NET, Python, Electron and WebAssembly apps, and opens installers, disc images (ISO, UDF, DMG, VHD, CSO, Xbox, GameCube), game packs and firmware, on every core | `apps/decomp` |
| **Docket** | Meeting notes: on-device transcription of Zoom, Teams and Meet calls, AI summaries, one to-do list | `apps/docket` |
| **Droid** | Virtual Android phones and tablets: pick the look, Android version and hardware, run several at once, drag in apps and files | `apps/droid` |
| **Facet** | 3D models from a prompt or a picture, generated on this computer's own GPU: concept sketches, photo and multi-view to mesh, textures painted from the picture or by an AI painter (Hunyuan3D Paint), optional Tripo cloud engine with your own key, character rigging with test animations, export for Unity, Unreal, Godot, Blender, Roblox, three.js and 3D printing | `apps/facet` |
| **Fresh Desk** | Fast file explorer: tabs, preview, Terminal, undo, and Tidy for sorting and clean-up | `apps/fresh-desk` |
| **Glean** | Collects every photo and video from Instagram, Facebook, Patreon or any page at full size, grouped by post with captions; keeps each account up to date | `apps/glean` |
| **Kiln** | Stable Diffusion apps, models, profiles and prompts (replaces Stability Matrix) | `apps/kiln` |
| **Lumen** | Ads and analytics: Meta first, with Google, YouTube and Salesforce, plus an AI you can ask | `apps/lumen` |
| **Onward** | Job hunting with your AI plugged in | `apps/onward` |
| **RO2** | Quick, easy designs and photo edits (a lighter Canva): shapes, icons, text, free photos, any size or aspect ratio, export to PNG/JPG/WebP/SVG/PDF, and on-device AI: background remover, magic eraser, magic grab, magic expand | `apps/ro2` |
| **RO3** | Photo editing, video editing and file conversion | `apps/ro3` |
| **Relay** | Inboxes, calendars, browser, library and AI | `apps/relay` |
| **Scene** | Workspace layouts: save and switch apps, window positions on each display, links, volume, appearance and wallpaper for work, gaming or match day | `apps/scene` |
| **Sideby** | Watch parties with shared playback and room chat | `apps/sideby` |
| **Slate** | Accounts, retirement, credit and savings in one place | `apps/slate` |
| **Trace** | Paths, decisions, org charts and folder plans you can trace, with notes and screenshot guides | `apps/trace` |
| **Vitals** | Task manager and system dashboard: live CPU, memory, GPU and temperatures, apps and uninstalling, startup items, permissions, time and focus, upgrade advice with drivers and drive speed tests, checkup | `apps/vitals` |
| **Touchline** | Football scores, tables, match stats, squads and player histories for every league and season | `apps/touchline` |
| **Waypoint** | Travel planning and booking: search and book flights and hotels, trips with interactive day timelines, bookings, documents, budgets and research, all offline; to your phone by QR code, to another computer with Beam | `apps/waypoint` |
| **Utility Hub** | Installs, updates and removes the apps on each computer | `apps/hub` |

## How it works

```
 apps/<name>   ── edit, npm start ──▶  bump version + ./utility note  ──▶  ./utility suite --all  ──▶  Utility Hub on every computer
 (the only copy                                                               Utility-Suite-<date>-mac.dmg        install / update /
  of each app)                                                                Utility-Suite-<date>-windows-x64.zip  uninstall each app
```

1. **Each app is developed in `apps/<name>`.** That's the only copy; there are no outside project folders, source zips or porting anymore. Each app's chat has a handoff README in `docs/handoffs/`.
2. **To ship a change:** bump `version` in `apps/<name>/package.json`, then `./utility note <name> "what changed"` (it shows as "What's new" in the hub).
3. **Publish:** `./utility publish` builds whatever changed (Mac and Windows) and posts it to GitHub. Every Utility Hub sees the update and installs just that app. (`./utility suite --all` still makes offline downloads.)
4. **On each computer:** install Utility Hub once (setup link on the GitHub release page), tick the apps you want, and from then on the hub keeps them up to date. The hub updates itself too.

`./utility status` shows each app's version against the last suite and what's ready to ship. Not a terminal person? Double-click **`Utility Package.command`**.

## Personal data that stays outside

Some apps keep data in fixed places. It is never part of the package or the repo:

| App | Data folder |
|---|---|
| Relay | `~/Downloads/Relay/Relay Files` (library and downloads) |
| Onward | `~/Downloads/Onward/Onward Files` (resume, credentials, applications) |
| Slate | `~/Documents/Slate/Statements` |
| Atoll | its app-data folder: `settings.json`, `state.json` (timers, the shelf list, the followed team or match), `cache/` (Touchline match data and crests), `artwork/` (scratch). Shelf files stay where they are; clipboard history is never saved |
| Beam | `~/Downloads/Beam` (received files; `.beam-incoming/` inside holds transfers still arriving). Its app-data folder has `identity.json` (this device's key), `settings.json` (trusted devices, saved addresses, phone link) and `history.json` |
| Bench | its app-data folder: `desks/<id>/` (a sandbox desk's own home, app-data and temp folders; a Windows Sandbox desk's shared folder), `vms/` (Tart system images and VM disks, 20–30 GB each), `engines/` (Tart), `findings/` and `runs/` (screenshots and logs), `bridge.json` (the Claude plugin's private connection). Saved screenshots go to `~/Pictures/Bench` |
| Cadence | its app-data folder: `flows/` (one JSON per automation), `runs.json`, `memory.json`, `secrets.json` (encrypted), browser sign-ins, `runs/` (scratch, 14 days). Output goes where each automation says, by default `~/Documents/Cadence/<automation>` |
| Crate | `~/Music/Crate` (your MP3s; `.crate/` inside holds the index, artwork cache and originals of edited songs) |
| Decomp | its app-data folder: `engines/` (7-Zip, Java, JADX, Vineflower, .NET, ILSpy, Ghidra — up to ~1 GB) and `jobs.json`. Results go to `~/Documents/Decomp`, one folder per job |
| Docket | `~/Documents/Docket` (each meeting's notes, transcript and recording, plus `todos.json`) |
| Droid | its app-data folder: `sdk/` (emulator and Android versions, 1–2 GB each), `avd/` (each device's disk), `apks/` (app library); movable in Android versions › Data folder. Screenshots and recordings go to `~/Pictures/Droid` |
| Facet | `~/Documents/Facet` (one folder per model: `model.glb`, pictures, `facet.json`; change in Settings). Its app-data folder holds `Models/` (3D and image models, 2–20 GB) and `Engine/` (private Python and PyTorch, 1.5–5 GB) |
| Glean | `~/Pictures/Glean` (one folder per account, each with `captions.csv`, `glean.json` and `.glean/posters`; change it in Settings) |
| RO2 | `~/Documents/RO2` (one `.ro2` file per design, pictures inside; change in Settings). Its app-data folder holds `Models/` (the AI models, 300–500 MB, downloaded on first use), `settings.json` and `index.json` (Home thumbnails) |
| Vitals | its app-data folder (`focus/` holds one small file per day of time tracking) |
| Waypoint | `~/Documents/Waypoint` (one folder per trip: `trip.json` and `Documents/`; change it in Settings). Its app-data folder holds `private.bin` (booking keys and saved travelers, encrypted with the system keychain) and the booking browser's sign-ins |
| All apps | their app-data folder (`~/Library/Application Support/<App>`, `%APPDATA%\<App>`) |

## Commands

| Command | What it does |
|---|---|
| `./utility status` | Each app's version vs the last suite, and what's ready to ship |
| `./utility note <app> "…"` | Record what changed in the app's current version |
| `./utility publish [--apps a,b] [--dry-run]` | Build every app whose version went up (Mac + Windows), post it to GitHub, push the source |
| `./utility github <repo-name> [--private]` | One-time: create the GitHub repo, push the source, point the hub at it |
| `./utility suite [--mac] [--win] [--all] [--apps a,b]` | Build Utility Hub + the apps into one download per OS (`--classic`: the older Install All bundle) |
| `./utility build <app\|all> [--mac] [--win] [--arch …]` | One app's own installers, e.g. for a friend |
| `./utility add <project folder> [--exclude "Data"]` | Bring a new app in as `apps/<id>` |
| `./utility adopt <app>` | Move an app still developed elsewhere (Fresh Desk) into `apps/<id>` |
| `./utility port <app> --from-old` | One-off: pull edits made in an app's old folder after it moved in |
| `./utility doctor` | Check Node, npm, git, disk space and every app |

On Windows, use `utility.cmd` in place of `./utility`.

## Folder layout

```
apps/<id>/           each app's source; npm install / npm start inside it
apps/hub/            Utility Hub's source (npm test runs its tests)
suite.json           the app list: id, name, Mac/Windows architecture, excludes ("role": "hub" marks the hub)
CHANGELOG.md         what changed in each app, newest first (notes become "What's new")
docs/handoffs/       one README per app chat explaining how to work here
installer/           READ ME FIRST text that goes in each download
tools/utility.mjs    the build tool (plain Node, no dependencies)
.github/workflows/   builds the suite on real Mac and Windows machines (once on GitHub)
releases/  .build/   build output and workspace (not tracked)
```

## Publishing updates (GitHub)

Source code lives in a public GitHub repo, and built apps live on its **packages** release. Every Utility Hub (version 1.1 or newer) checks that release when it opens and every 15 minutes, shows what's new, and downloads only the apps you update. No more carrying DMGs and zips between computers.

**One-time setup on the Mac**

1. Install the GitHub CLI: `brew install gh`, or the macOS installer from https://cli.github.com.
2. Sign in: `gh auth login` (GitHub.com, HTTPS, log in with a browser).
3. Create the repo and push the source:
   ```bash
   cd ~/Downloads/Utility\ Package
   ./utility github utility-suite      # public; add --private for a private repo
   ```
   This also writes `apps/hub/feed.json`, which tells every hub you build where to look for updates.

**Every update after that**

```bash
# in apps/<name>: bump "version" in package.json, then
./utility note <name> "what changed"
./utility publish
```

`publish` builds every app whose version went up, for Mac and Windows. It uploads them, updates the catalogs the hubs read, removes the superseded packages, refreshes the release page, then commits and pushes the source. `--dry-run` shows what it would publish; `--apps datum` limits it to one app. The first publish uploads every app (a few GB), so later ones are much smaller.

**New computers and friends**

The release page has two permanent links: `Utility-Hub-Setup-mac.zip` and `Utility-Hub-Setup-windows.zip`. Install Utility Hub from one, tick the apps you want, and it downloads them. Computers that already run an older hub (1.0) need the new hub once, from that link or a suite download. After that, the hub updates itself.

`./utility suite` still makes offline downloads (USB, AirDrop) and works side by side with publishing.

## Platform notes

- **Mac builds** must run on a Mac. Apps and the hub are ad-hoc signed so they open on Apple Silicon. Assist, Datum and the hub are universal; the rest are Apple Silicon only (`macArch` in `suite.json`).
- **Windows builds run from the Mac.** For RO3 the tool installs the Windows sharp/FFmpeg binaries and checks them. If a Windows cross-build ever fails, use the GitHub workflow.
- **Not code-signed**, so the first launch of the hub shows the usual warning; the READ ME in each download explains it.
- **Same version = same app.** The hub only offers an update when the version number goes up.
