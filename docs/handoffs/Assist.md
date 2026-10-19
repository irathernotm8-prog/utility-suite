# Assist has moved into the Utility Package

**New home:** `~/Downloads/Utility Package/apps/assist`
**Old location:** ~/Downloads/Assist (the Assist-*-Source.zip exports), which is retired and has been moved to `~/Downloads/Old app folders (safe to delete)`. Don't edit or build there.

## What changed and why

- **One copy of every app.** All of Bilal's apps now live in a single folder, `~/Downloads/Utility Package`, each in `apps/<name>`. That folder is a public **GitHub repo**. Updates are published there, and every computer's Utility Hub pulls them from one place. No more duplicate project folders, source zips or copied installers.
- **You work in `apps/assist` directly.** There's no porting or exporting step anymore. What you save there is the app.
- **Installers come from the Utility Package, not this chat.** Each computer runs **Utility Hub**, which installs, updates and removes the apps. Don't build DMGs/EXEs/ZIPs here to hand out.

## Working on Assist

```bash
cd ~/Downloads/Utility\ Package/apps/assist
npm install
npm start
```

`node_modules/` and `dist/` stay local and are never committed.

## Shipping a change

1. Bump `version` in `apps/assist/package.json` (1.2.0 → 1.2.1 for fixes, 1.3.0 for features). **The hub only offers an update when the version goes up.**
2. Write the "What's new" line the hub shows:
   ```bash
   cd ~/Downloads/Utility\ Package
   ./utility note assist "one line about what changed"
   ```
3. Tell Bilal it's ready. He runs `./utility publish`, which builds the update for Mac and Windows and posts it to GitHub, and every computer's Utility Hub offers it within minutes.

## Rules for working in a shared repo

- **Stay inside `apps/assist`.** Don't edit other apps, `tools/`, `suite.json` or `apps/hub`. Ask in the Utility Package chat if something there needs to change.
- **No personal data or secrets in the folder.** No API keys in code, no real documents in fixtures. `.env` is ignored by git, but keep keys out of source anyway.
- **User data belongs outside the app**, in `app.getPath('userData')` or the app's own data folder. Utility Hub replaces the app on every update, so anything stored inside it is lost.
- **Keep these stable:** `productName`, `build.appId` and `build/icon.png`. The hub uses them to recognise and show the app. Keep `electron-builder` in `devDependencies` and `package-lock.json` up to date (run `npm install` after changing dependencies).
- Don't hard-code the source location (`~/Downloads/assist` or `apps/assist`). Use `__dirname` / `app.getAppPath()`.

## Specific to Assist

- **Stop exporting source zips.** The package used to read `Assist-Source.zip`. Your 2.0 work was saved as `Assist-2.0-Source.zip`, so the package kept reading the old 1.2.0 zip; that's why the update didn't come through. Assist 2.0.0 is now in `apps/assist`, and from now on you edit files there directly. No zips, no copies.
- Installers for friends (Mac DMG, Windows x64/arm64 Setup files) now come from the Utility Package. For an ARM Windows laptop, Bilal runs `./utility build assist --win --arch arm64`.
- `apps/assist/.github/workflows/build.yml` won't run once the package is a GitHub repo, because GitHub only runs workflows at the repo root. The package has its own root workflow that builds everything, so leave yours alone or delete it.
- Relay's Assist plugin finds Assist in `/Applications/Assist.app` (Mac) or the Utility Suite folder (Windows), which is exactly where Utility Hub installs it.

## If you changed files in the old folder after the move

Tell Bilal. One command pulls those late edits in:
```bash
cd ~/Downloads/Utility\ Package && ./utility port assist --from-old
```
