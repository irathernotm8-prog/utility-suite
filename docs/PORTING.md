# How app updates ship

> Porting is retired. Every app now lives in `~/Downloads/Utility Package/apps/<id>` and is developed there directly. Each app's chat has its own handoff README in `docs/handoffs/`; give that file to the chat.

## The loop

1. Work in `apps/<id>` (`npm install`, `npm start`).
2. Bump `version` in `apps/<id>/package.json`. The hub only offers an update when it goes up.
3. `./utility note <id> "what changed"`. This becomes "What's new" in Utility Hub.
4. `./utility publish` builds the changed apps for Mac and Windows, posts them to GitHub and pushes the source.
5. Every computer's Utility Hub sees the update online (on launch, every 15 minutes, or **Check for updates**) and installs just that app.
6. Pull before starting work, so you build on the latest source. (`./utility suite` still makes offline downloads for USB/AirDrop.)

## Rules for every app

- Stay inside `apps/<id>`. `tools/`, `suite.json` and `apps/hub` belong to the Utility Package chat.
- No personal data or secrets in the source tree. `.env`, `node_modules`, `dist` and `releases` are ignored by git.
- User data lives outside the app, in `app.getPath('userData')` or the app's data folder (Relay Files, Onward Files, Slate's Statements).
- Keep `productName`, `build.appId` and `build/icon.png` stable, `electron-builder` in `devDependencies`, and `package-lock.json` current.
- Native modules are fine; tell the Utility Package chat when you add a new one so Windows cross-builds get checked.

## Apps and their handoffs

| App | Folder | Handoff |
|---|---|---|
| Assist | `apps/assist` | `docs/handoffs/Assist.md` |
| Datum | `apps/datum` | `docs/handoffs/Datum.md` |
| Fresh Desk | `apps/fresh-desk` (after `./utility adopt fresh-desk`) | `docs/handoffs/Fresh Desk.md` |
| Onward | `apps/onward` | `docs/handoffs/Onward.md` |
| RO3 | `apps/ro3` | `docs/handoffs/RO3.md` |
| Relay | `apps/relay` | `docs/handoffs/Relay.md` |
| Sideby | `apps/sideby` | `docs/handoffs/Sideby.md` |
| Slate | `apps/slate` | `docs/handoffs/Slate.md` |
| Utility Hub | `apps/hub` | maintained in the Utility Package chat (`cd apps/hub && npm test`) |

Old project folders were moved to `~/Downloads/Old app folders (safe to delete)`. `./utility port <id> --from-old` pulls any late edits from there until that folder is trashed.
