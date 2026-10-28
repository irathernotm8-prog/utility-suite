# Vantage: handoff for the Vantage chat

Vantage is the Utility Package's browser: split view up to four pages, ad blocking, a VPN for the browser's own traffic, multi-connection downloads, the password vault with autofill, and the Library/Player/Reader that moved over from Relay. It lives in `apps/vantage` inside `~/Downloads/Utility Package`. `apps/vantage/README.md` has the feature list, code map and data folders.

## Working on it

```bash
cd ~/Downloads/Utility\ Package/apps/vantage
npm install          # if Electron's binary is missing afterwards: node node_modules/electron/install.js
npm start
npm test             # 15 Node checks
```

To ship a change, bump `version` in `package.json`, then from the Utility Package folder:

```bash
./utility note vantage "what changed"
./utility publish
```

Pull before starting work. Stay inside `apps/vantage`; `tools/`, `suite.json` and `apps/hub` belong to the Utility Package chat.

## State at first release (0.1.0)

Run for real on the Mac (Apple Silicon, macOS) through Bench:
- Pages load in single and grid-of-four split view; tab numbers and pane headers follow the layout; session restore.
- Ad blocking on news sites (hundreds of requests blocked per page, cosmetic ad slots hidden).
- Cloudflare WARP: registered, engine downloaded, `cdn-cgi/trace` reports `warp=on` through the tunnel.
- Fast downloads: a 130 MB GitHub release asset came down in parts and passed `unzip -t`; a host that answers 429 to parallel ranges drops to fewer connections by itself.
- Vault: autofill menu under the sign-in field, fill, "Update the saved password?" after signing in, live 2FA code.
- Library/Passwords/Settings pages in light and dark; tabs on the side.

**Not yet checked:** Windows (registry default-browser, wireproxy `.exe` from `tar`, title-bar overlay padding), WireGuard configs from a real provider, proxy authentication, Touch ID unlock in a packaged build, focus mode in real full screen, Chromecast.

## Rules specific to Vantage

- **Pages never get Node.** `will-attach-webview` strips any preload and forces sandbox/contextIsolation and an allowed partition (`persist:vantage`, `vantage-private`, `persist:vantage-c-<id>`). Page code is `page-preload.js`, registered per session.
- **Passwords only reach a page when you pick an entry**, and only if the entry matches that frame's site (`matchesFor` in `core/vault.js`). The autofill menu only ever sees names and usernames. Captured passwords wait in main-process memory behind a token until you press Save.
- **One webRequest handler per event per session** (`prepareSession` in `main.js`): HTTPS upgrade, media sniffing and ad blocking share `onBeforeRequest`; identity headers and GPC share `onBeforeSendHeaders`. Add to those, don't register new ones.
- **VPN routing goes through `vpn.route()`** so every session (including the UI's default session) follows it; Vantage's own setup requests use the `vantage-control` partition so they never go through a tunnel being built. Private keys are sealed with `safeStorage`; the engine's config file is deleted after start.
- **Downloader:** requests use `cache: 'no-store'` (otherwise they wait behind the paused native download of the same URL in Chromium's cache) and no Referer header (Chromium cancels requests with a referrer it didn't set). Keep both.
- **Webviews never move in the DOM** (moving one reloads it). Panes are absolutely positioned boxes; hidden tabs are `visibility: hidden` at the focused pane's size.
- The Library, Player, Reader and Vault screens are Relay's, talking to `window.relay` and `window.RelayApp` (the shim in `renderer/shell.js`). `RelayApp.isShown(kind)` replaces Relay's "which tab is open" checks.

## Utility Suite link

Offers `open(url)` (opens in a new tab, or focuses Vantage), `vpn` (status) and `downloads` (the last ten). No events.
