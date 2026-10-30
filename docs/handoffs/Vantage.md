# Vantage: handoff for the Vantage chat

Vantage is the Utility Package's browser: split view up to four pages, ad blocking, a VPN for the browser's own traffic, multi-connection downloads, the password vault with autofill, and the Library/Player/Reader that moved over from Relay. It lives in `apps/vantage` inside `~/Downloads/Utility Package`. `apps/vantage/README.md` has the feature list, code map and data folders.

## Working on it

```bash
cd ~/Downloads/Utility\ Package/apps/vantage
npm install          # if Electron's binary is missing afterwards: node node_modules/electron/install.js
npm start
npm test             # 18 Node checks
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

## 0.2.0

- **Look:** accent follows the new globe icon (Ocean blue, `#3fa9f5 → #6a7dff`). Appearance settings: seven accents plus any color, density, which toolbar buttons show, icon-only bookmarks. Accent tokens are `:root[data-accent=…]` in `vantage.css`; `boot.js` sets the attribute.
- **New Tab** (`renderer/newtab.js`): clock, weather (Open-Meteo, place from ipwho.is or a city you type), search box with modes (Tab cycles: web, YouTube, Images, Maps, Wikipedia, Reddit, GitHub), shortcuts (most visited, or your own list with icons and drag order), Jump back in with page previews, Read later, Privacy (7-day blocked chart and VPN switch), Notes. Backgrounds: aurora, Bing picture of the day, your picture, plain. Customize drawer on the page. Settings live in `settings.newtab`.
- **Address bar:** "Suggestions while you type" off means no drop-down at all; "Ask the search engine too" is separate. On New Tab the drop-down waits for typing.
- **Bookmark icons:** the site's own icon is fetched once (`favicon:get`, cached in `vantage-data.json → favicons`, through the browsing session so the VPN applies) and saved on the bookmark. The icon picker (`V.iconPicker`) offers site icon, emoji, symbol + color, letters + color, or a picture. Fields on a bookmark: `iconType`, `icon`, `emoji`, `glyph`, `color`, `letter`, `image`, `hideName`.
- **Google sign-in (ported from Relay):** the cause of "This browser or app may not be secure" was ad blocking on accounts.google.com. Sign-in hosts (`AUTH_HOSTS` in `core/adblock.js`) are never filtered. On a rejection URL Vantage steps auto → Safari → Edge → Chrome by itself (`signin:blocked`), goes back to the last sign-in step keeping `continue=`, and shows an infobar; Sign-in help (⌘K → "Sign-in help", or Settings → Privacy) picks a mode or starts over. Firefox's version in the identity is worked out from the date.
- **YouTube not starting until reload:** the lists' scriptlets broke YouTube's player after in-page navigation. Scriptlets are skipped on youtube.com/google.com (network blocking still removes the ads), and cosmetic filters now go to the frame that asked, scriptlets once per frame (own handler in `core/adblock.js` instead of the engine's).
- **Mini player** (`tabs.js`): when you switch away from a tab playing a video with sound, the tab's view shrinks into a corner and the page's own video is styled to fill it (injected CSS + `vantage-mini` attributes, removed on exit), so nothing reloads. Controls: play/pause, ±10 s, mute, Picture in Picture, size, open tab, close; drag to any corner. ⌥⌘M or the tab menu pops a video out by hand. Setting: `miniPlayer.auto/size/corner`.
- **Full screen:** Electron takes the whole window out of full screen when a video leaves it. `main.js` tracks `appFull` (full screen you chose) per window and puts the window straight back after a video's full screen ends.
- **0.2.2 — "Sign in with Google" loop:** the identity switch used to happen in `will-redirect`; Chromium reloads the page you came from when the user agent changes mid-navigation, so site → Google redirects never arrived. Now a redirect that crosses into or out of a sign-in page is stopped and the same address is loaded fresh with the right identity (`applyIdentityTracking`). The automatic retry no longer clears Google's cookies (that signed you out); only "Start over" does. Sign-in hosts always open as real pop-ups (keeps `window.opener`). `storage-access` is allowed like Chrome does (embedded Google buttons and reCAPTCHA were stuck behind a prompt). Sign-in mode was reset to Automatic once.
- **Minimized tabs:** double-click a tab (or right-click → Minimize Tab) to shrink it to its icon; clicking it opens it back to full size. Kept in the session (`collapsed`). Tabs are a little wider (250px basis, 280px max).
- **Bookmark names:** a blank name shows only the icon on the bookmarks bar.
- **Read later** (⇧⌘D, page menu, ⋯ menu) and **Notes** are kept in `vantage-data.json`. Page previews for Jump back in are JPEGs in `thumbs.json` (last 60, never from private windows).

Checked in Bench on the Mac: YouTube home → video plays first time with no ad; mini player pops out on tab switch and from ⌥⌘M, controls work, Open tab restores the page; Google sign-in page loads with nothing blocked and no longer rejects; the rejection auto-retry switches to Safari and returns to the sign-in step; New Tab in light, dark, aurora and picture of the day; weather; previews; icon picker; suggestions off; accent and dark theme.

## Rules specific to Vantage

- **Pages never get Node.** `will-attach-webview` strips any preload and forces sandbox/contextIsolation and an allowed partition (`persist:vantage`, `vantage-private`, `persist:vantage-c-<id>`). Page code is `page-preload.js`, registered per session.
- **Passwords only reach a page when you pick an entry**, and only if the entry matches that frame's site (`matchesFor` in `core/vault.js`). The autofill menu only ever sees names and usernames. Captured passwords wait in main-process memory behind a token until you press Save.
- **One webRequest handler per event per session** (`prepareSession` in `main.js`): HTTPS upgrade, media sniffing and ad blocking share `onBeforeRequest`; identity headers and GPC share `onBeforeSendHeaders`. Add to those, don't register new ones.
- **VPN routing goes through `vpn.route()`** so every session (including the UI's default session) follows it; Vantage's own setup requests use the `vantage-control` partition so they never go through a tunnel being built. Private keys are sealed with `safeStorage`; the engine's config file is deleted after start.
- **Downloader:** requests use `cache: 'no-store'` (otherwise they wait behind the paused native download of the same URL in Chromium's cache) and no Referer header (Chromium cancels requests with a referrer it didn't set). Keep both.
- **Webviews never move in the DOM** (moving one reloads it). Panes are absolutely positioned boxes; hidden tabs are `visibility: hidden` at the focused pane's size. The mini player is the same view repositioned, never a new webview.
- **Never ad-block sign-in pages** and keep scriptlets off YouTube; both broke real use.
- The Library, Player, Reader and Vault screens are Relay's, talking to `window.relay` and `window.RelayApp` (the shim in `renderer/shell.js`). `RelayApp.isShown(kind)` replaces Relay's "which tab is open" checks.

## Utility Suite link

Offers `open(url)` (opens in a new tab, or focuses Vantage), `vpn` (status) and `downloads` (the last ten). No events.
