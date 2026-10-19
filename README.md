# Utility Package

The one home for every app Bilal has built: the source code, the tool that builds them, and **Utility Hub**, the app that installs and updates them on each computer. It's one GitHub repo; built apps are published to it and Utility Hub updates every computer from there.

| App | What it is | Lives in |
|---|---|---|
| **Assist** | Private, on-device AI chat and reply assistant | `apps/assist` |
| **Datum** | Linked spreadsheets, slides, docs and dashboards | `apps/datum` |
| **Fresh Desk** | Private folder organization with preview and undo | `apps/fresh-desk` (still developed in its Codex folder until `./utility adopt fresh-desk`) |
| **Onward** | Job hunting with your AI plugged in | `apps/onward` |
| **RO3** | Photo editing, video editing and file conversion | `apps/ro3` |
| **Relay** | Inboxes, calendars, browser, library and AI | `apps/relay` |
| **Sideby** | Watch parties with shared playback and room chat | `apps/sideby` |
| **Slate** | Accounts, retirement, credit and savings in one place | `apps/slate` |
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
