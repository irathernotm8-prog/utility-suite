# Fresh Desk has moved into the Utility Package

**New home:** `~/Downloads/Utility Package/apps/fresh-desk`
**Old location:** the Codex project folder (~/.codex/.chatgpt-projects/…/fresh-desk). It retires as soon as Bilal runs the one adopt command below; after that, don't edit or build there.

## What changed and why

- **One copy of every app.** All of Bilal's apps now live in a single folder, `~/Downloads/Utility Package`, each in `apps/<name>`. That folder is a public **GitHub repo**. Updates are published there, and every computer's Utility Hub pulls them from one place. No more duplicate project folders, source zips or copied installers.
- **You work in `apps/fresh-desk` directly.** There's no porting or exporting step anymore. What you save there is the app.
- **Installers come from the Utility Package, not this chat.** Each computer runs **Utility Hub**, which installs, updates and removes the apps. Don't build DMGs/EXEs/ZIPs here to hand out.

## Working on Fresh Desk

```bash
cd ~/Downloads/Utility\ Package/apps/fresh-desk
npm install
npm start
```

`node_modules/` and `dist/` stay local and are never committed.

## Shipping a change

1. Bump `version` in `apps/fresh-desk/package.json` (1.2.0 → 1.2.1 for fixes, 1.3.0 for features). **The hub only offers an update when the version goes up.**
2. Write the "What's new" line the hub shows:
   ```bash
   cd ~/Downloads/Utility\ Package
   ./utility note fresh-desk "one line about what changed"
   ```
3. Tell Bilal it's ready. He runs `./utility publish`, which builds the update for Mac and Windows and posts it to GitHub, and every computer's Utility Hub offers it within minutes.

## Rules for working in a shared repo

- **Stay inside `apps/fresh-desk`.** Don't edit other apps, `tools/`, `suite.json` or `apps/hub`. Ask in the Utility Package chat if something there needs to change.
- **No personal data or secrets in the folder.** No API keys in code, no real documents in fixtures. `.env` is ignored by git, but keep keys out of source anyway.
- **User data belongs outside the app**, in `app.getPath('userData')` or the app's own data folder. Utility Hub replaces the app on every update, so anything stored inside it is lost.
- **Keep these stable:** `productName`, `build.appId` and `build/icon.png`. The hub uses them to recognise and show the app. Keep `electron-builder` in `devDependencies` and `package-lock.json` up to date (run `npm install` after changing dependencies).
- Don't hard-code the source location (`~/Downloads/fresh-desk` or `apps/fresh-desk`). Use `__dirname` / `app.getAppPath()`.

## Specific to Fresh Desk

- **One step left:** Fresh Desk is still developed in the Codex project folder. On the Mac, Bilal runs `cd ~/Downloads/Utility\ Package && ./utility adopt fresh-desk` once. That copies the latest work into `apps/fresh-desk` and makes it the home. After that, point this chat at `apps/fresh-desk` and stop editing the Codex copy.

## If you changed files in the old folder after the move

Tell Bilal. One command pulls those late edits in:
```bash
cd ~/Downloads/Utility\ Package && ./utility port fresh-desk --from-old
```
