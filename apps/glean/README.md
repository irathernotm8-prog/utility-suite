# Glean

Collect every photo and video from a page you can see, at full size, grouped by post, with captions and dates. Works on Instagram, Facebook, Patreon, X, Pinterest, Threads and any other website. Part of the Utility Package.

## What it does

- **A signed-in browser.** Sign in to Instagram, Facebook, Patreon and other sites once inside Glean. Glean keeps its own sign-ins, separate from your other browsers, and presents itself as ordinary Chrome so sign-in pages work.
- **Collect.** Press Collect on any page. Glean reads the same data the page loads:
  - **Instagram:** the feed API and the data each page ships with. You get every photo of a carousel in order, reels and videos as MP4, stories, the caption, the date, and the original (largest) size, never the grid thumbnail.
  - **Patreon:** the posts API. Every image and attachment in each post you can see, with the post title and text. Locked posts are skipped because there's nothing to see.
  - **Facebook:** photos and videos from GraphQL responses, grouped under their post (best effort; see the handoff).
  - **X:** original-size images (`name=orig`) and the highest-bitrate MP4.
  - **Pinterest, WordPress sites:** asks the CDN for the original instead of the resized copy.
  - **Any site:** the largest `srcset` candidate, CSS backgrounds, direct links to image files, and every image or video the page downloads.
- **Auto-scroll.** Keeps a feed loading until the end, a limit, or (for **Check for new**) until it reaches posts you already have. Gentle, Normal or Fast.
- **The tray.** Shows everything grouped by post (or as one grid), with ticks to pick and choose. Shift-click selects a range, double-click opens a large preview, and **New only** hides what's already in your library. Icons, avatars and other pictures that aren't part of a post stay out of the way.
- **Download.** Fetches through the same signed-in session, three at a time. It backs off when a site says "too many requests" and skips anything already saved. WebP and AVIF are saved as JPG (optional), and files carry the post's date.
- **Organised folders:** `~/Pictures/Glean/Instagram/clientbrand/2026-10-02 C9xYz 01.jpg` by default. You can also use a folder per post, or just the account name. Every account folder gets `captions.csv` (file, post link, date, caption) and `glean.json`, which records what was saved and from where. A `.txt` caption per post is optional.
- **Library.** One card per account or page. Open it to see its posts. **Check for new** reopens the page, scrolls until it reaches posts you already have, and downloads only the new ones.
- **Contact sheet.** A PDF of an account's posts (pictures, dates, links, captions) to send a client for review. It's saved next to the files.
- **Batch.** Paste a list of profiles, posts, galleries or direct file links. Glean visits each one, optionally auto-scrolls, and downloads everything new when it's done. You can right-click any link and choose **Add Link to Batch**.
- **Right-click** any image or video and choose **Add to Tray**.

Only download what you have the right to use: your clients' accounts with their permission, content you've paid for, or your own.

## Code map

```
src/main.js                 window, settings, IPC, glean-img:// (remote thumbnails via the signed-in session),
                            glean-file:// (saved files), WebP→JPG converter window, contact-sheet PDF, sync
src/preload.js              the window's API (window.glean.call / on)
src/browser/capture.js      the session (identity, popups, context menu), Chrome DevTools Protocol network capture,
                            page scans, auto-scroll, batch
src/browser/identity.js     ordinary-Chrome identity (shared with Kiln/Relay)
src/browser/webview-preload.js  applies that identity inside pages; nothing else is exposed to them
src/collect/extract.js      site adapters: Instagram, Patreon, Facebook, X, generic JSON, DOM and network sightings;
                            dedupe keys, CDN upgrades, merge rules        (pure, tested)
src/collect/dom-scan.js     scripts run in an isolated world: SCAN, SCROLL, RESET
src/collect/collection.js   the tray: dedupe by picture, page buffer before Collect is pressed
src/library/naming.js       folder layouts, file-name templates, captions.csv  (pure, tested)
src/library/downloader.js   queue, retries, 429 back-off, posters for videos, manifest records
src/library/library.js      library.json index + per-folder glean.json manifests, rescan
src/library/sheet.js        contact sheet HTML
src/renderer/               index.html, styles.css, app.js
build/make-icon.py          regenerates build/icon.png
test/run.js                 npm test (Node only)
test/e2e/                   mock Instagram/Patreon/gallery server + a driver that runs the real app (Linux, Xvfb)
```

## Data

- Pictures: `~/Pictures/Glean` (change it in Settings). Each account folder holds `glean.json`, `captions.csv` and `.glean/posters/`.
- App data: `~/Library/Application Support/Glean` or `%APPDATA%\Glean`. This holds `settings.json`, `library.json` and the browser session (`Partitions/glean`). Settings → **Sign out of everything** clears the session.
- If `library.json` is lost, Glean rebuilds it from the `glean.json` files in the pictures folder on launch.
