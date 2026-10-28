# Vantage

The Utility Suite's browser: fast, private, and built for working with several pages at once.

- **Split view, up to four pages on one screen.** Two side by side, two stacked, one big and two, three columns, or a grid of four (⌘⌥1–6, or the split button). Drag any tab onto the page to place it; drag the gaps to resize, double-click a gap to even out. Each pane has its own header; the focused one drives the toolbar. **Focus mode** (⇧⌘F) goes full screen and hides the toolbar until you touch the top edge.
- **Ad, tracker and annoyance blocking** with Ghostery's engine (uBlock Origin / EasyList compatible, including YouTube's scriptlets and cookie-banner lists). Shield in the address bar with a per-page count, per-site pause, your own filters, running total.
- **Built-in VPN for the browser's traffic**: one-click free Cloudflare WARP, any WireGuard config (Proton VPN, Mullvad, IVPN, your own), or a SOCKS5/HTTP proxy. Kill switch, WebRTC leak protection, remote DNS. Other apps on the computer are not affected.
- **Fast downloads**: big files come down over up to 16 connections at once (8 by default), parts written straight into place; a finished connection takes over half of the largest remaining part. Pause/resume survives restarts. Servers that limit connections are respected automatically; anything that can't be split uses Chromium's downloader.
- **Password vault from Relay** (AES-256-GCM, scrypt, Touch ID) with **autofill**: a menu under sign-in fields, "Save / Update password?" after signing in, strong-password suggestions on sign-up forms, **2FA codes** (TOTP) filled into one-time-code fields, never-save list, import from Relay's vault, Google/Chrome/1Password/Bitwarden CSV.
- **Library, Player and Reader from Relay**: books & comics, movies & shows and music from plain folders (keeps using Relay's `Relay Files` folder in place), Chromecast and AirPlay, picture in picture, comics and PDFs.
- Tabs on top or on the side, pinned tabs, tab sleeping, reopen closed tabs, containers (separate sign-ins per tab), private windows, history with search, bookmarks bar (imports Chrome/Brave/Edge/Arc bookmarks and Relay's), address-bar suggestions and inline completion, ⌘K command palette, reader view, find in page, per-site zoom and dark pages, site permissions with remember/block, HTTPS upgrade, secure DNS, Global Privacy Control, screenshots, save page, default-browser registration.

## Run it

```bash
cd ~/Downloads/Utility\ Package/apps/vantage
npm install
node node_modules/electron/install.js   # only if npm skipped Electron's download
npm start
npm test
```

`VANTAGE_USER_DATA=/tmp/vantage-test npm start` gives a clean profile. `VANTAGE_DEBUG=1` logs download decisions and the VPN engine's output (and keeps its config file).

## Code map

| File | What it does |
|---|---|
| `src/main.js` | Windows, browsing sessions (normal, private, containers), permissions, page context menu, menus, settings, history, bookmarks, default browser, suite link |
| `src/preload.js` | `window.vantage` for the UI, and `window.relay` (same surface) for the screens that came from Relay |
| `src/page-preload.js` | Runs in every page: browser identity for sign-in pages, autofill menu, save-password capture |
| `src/core/store.js` | Settings, bookmarks, session, downloads list (`vantage-data.json`) and history (`history.json`) |
| `src/core/adblock.js` | Ghostery engine, per-site allow list, custom filters, counts |
| `src/core/vpn.js` | WARP registration, WireGuard via wireproxy, proxies, kill switch, WebRTC policy |
| `src/core/downloads.js` | Multi-connection downloader and Chromium downloads |
| `src/core/vault.js` | Password vault (from Relay) + autofill, TOTP, Relay import |
| `src/core/library.js`, `media.js`, `identity.js` | From Relay: Library scanning/covers, Player/Reader back-end and casting, sign-in identity |
| `src/renderer/tabs.js` | Tabs, panes and layouts, web views, errors, infobars, session restore |
| `src/renderer/toolbar.js` | Address bar, popovers (shield, VPN, split, downloads, passwords, site, menu), bookmarks bar, find, reader view, palette, commands |
| `src/renderer/pages.js` | New Tab, Settings, History, Bookmarks, Downloads, and the Library/Passwords pages |
| `src/renderer/library.js`, `player.js`, `reader.js`, `vault.js`, `ported.css` | Screens moved from Relay |
| `build/make-icon.py` | Draws `build/icon.svg`/`icon.png` and tray glyphs (`python3 build/make-icon.py`; also `relay <dir>` for Relay's icon) |

## Where data lives

App-data folder (`~/Library/Application Support/Vantage`, `%APPDATA%\Vantage`): `vantage-data.json`, `history.json`, `vantage-vault.json` (encrypted), `adblock-*.bin` (filter lists), `bin/wireproxy` (VPN engine, downloaded on first connect), browser profiles. Downloads go to the system Downloads folder unless changed. The Library uses Relay's `~/Downloads/Relay/Relay Files` when it exists, otherwise `~/Downloads/Vantage/Vantage Files`.
