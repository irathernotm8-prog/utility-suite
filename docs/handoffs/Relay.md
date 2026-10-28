# Relay has moved into the Utility Package

**New home:** `~/Downloads/Utility Package/apps/relay`
**Old location:** ~/Downloads/Relay (source only; `Relay Files` stays put), which is retired and has been moved to `~/Downloads/Old app folders (safe to delete)`. Don't edit or build there.

## What changed and why

- **One copy of every app.** All of Bilal's apps now live in a single folder, `~/Downloads/Utility Package`, each in `apps/<name>`. That folder is a public **GitHub repo**. Updates are published there, and every computer's Utility Hub pulls them from one place. No more duplicate project folders, source zips or copied installers.
- **You work in `apps/relay` directly.** There's no porting or exporting step anymore. What you save there is the app.
- **Installers come from the Utility Package, not this chat.** Each computer runs **Utility Hub**, which installs, updates and removes the apps. Don't build DMGs/EXEs/ZIPs here to hand out.

## Working on Relay

```bash
cd ~/Downloads/Utility\ Package/apps/relay
npm install
npm start
npm run install-app   # optional: quick install into /Applications while developing
```

`node_modules/` and `dist/` stay local and are never committed.

## Shipping a change

1. Bump `version` in `apps/relay/package.json` (1.2.0 → 1.2.1 for fixes, 1.3.0 for features). **The hub only offers an update when the version goes up.**
2. Write the "What's new" line the hub shows:
   ```bash
   cd ~/Downloads/Utility\ Package
   ./utility note relay "one line about what changed"
   ```
3. Tell Bilal it's ready. He runs `./utility publish`, which builds the update for Mac and Windows and posts it to GitHub, and every computer's Utility Hub offers it within minutes.

## Rules for working in a shared repo

- **Stay inside `apps/relay`.** Don't edit other apps, `tools/`, `suite.json` or `apps/hub`. Ask in the Utility Package chat if something there needs to change.
- **No personal data or secrets in the folder.** No API keys in code, no real documents in fixtures. `.env` is ignored by git, but keep keys out of source anyway.
- **User data belongs outside the app**, in `app.getPath('userData')` or the app's own data folder. Utility Hub replaces the app on every update, so anything stored inside it is lost.
- **Keep these stable:** `productName`, `build.appId` and `build/icon.png`. The hub uses them to recognise and show the app. Keep `electron-builder` in `devDependencies` and `package-lock.json` up to date (run `npm install` after changing dependencies).
- Don't hard-code the source location (`~/Downloads/relay` or `apps/relay`). Use `__dirname` / `app.getAppPath()`.

## Specific to Relay

- **`~/Downloads/Relay/Relay Files` stays exactly where it is.** It's Relay's default download folder (`src/files.js`) and the Library folder Vantage now uses, with about 7.6 GB of your media. Only the source code moved. Never copy `Relay Files` into `apps/relay`, and don't change the default path without a migration.
- `npm run install-app` still works. Utility Hub recognises the copy in `/Applications` and updates it like any other.
- The README's `cd ~/Downloads/Relay` instructions are out of date; use `apps/relay`.

## If you changed files in the old folder after the move

Tell Bilal. One command pulls those late edits in:
```bash
cd ~/Downloads/Utility\ Package && ./utility port relay --from-old
```

## Utility Suite link (2.0.1)

Relay now offers a few things to other suite apps (Atoll's add-ons) over the **Utility Suite link**: `src/suitelink.js`, a copy of `tools/suitelink.js` in the Utility Package. Keep it identical to that file; the Utility Package chat owns it. It's a Unix socket in `~/Library/Application Support/Utility Suite/link` (mode 0600) on a Mac and a per-user named pipe on Windows, so only this user's apps can reach it. Everything is in `src/main.js` under "Utility Suite link".

- Offers: `unread`, `recent`, `open(accountId)`; events `unread` and `mail`. The renderer pushes them through `relay.suitePush` (preload): `suiteUnread()` in `renderer/app.js` sends the counts, and when a mail inbox's count goes up it reads the newest unread email with `Briefing.latest()` (the briefing scraper) at most every 20 s per inbox.
- Nothing changes when no other app is connected: events are only sent while something is listening.
- If you rename or remove one of these, tell the Utility Package chat so Atoll keeps working.

## 2.1.0 — the Library moved to Vantage, new icon

- The Library tab (books & comics, movies & shows, music) moved to **Vantage**, the suite's browser (`apps/vantage`). Relay no longer has `src/library.js` or `renderer/library.js`; `src/files.js` keeps `root()` (the Relay Files folder, still the default downloads location) and the player's resume points (`media:progress`). Vantage uses the same `Relay Files` folder in place and copied Relay's covers, favorites and resume points once on first launch.
- Opening the old Library (a saved tab, ⌘⇧L) lands on Home with a note that it lives in Vantage. Downloads lost "Move to Library".
- New icon in the suite family (mail card with a chat bubble behind it): `build/icon.svg`/`icon.png`/`icon.ico` and the in-app `assets/relay-mark*.png`. Drawn by `apps/vantage/build/make-icon.py relay apps/relay`.
- The browser tab, Vault, Player and Reader stay in Relay.
