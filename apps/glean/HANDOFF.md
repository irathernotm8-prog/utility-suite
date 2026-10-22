# Glean: handoff for the Glean chat

Glean is the Utility Package's image and video collector. It's a signed-in browser that gathers every photo and video a page loads (Instagram, Facebook, Patreon, X, any site) at full size, grouped by post with captions, then saves them into organized folders and keeps each account up to date. It lives in `apps/glean` inside `~/Downloads/Utility Package`. `apps/glean/README.md` has the feature list and code map.

## Working on it

```bash
cd ~/Downloads/Utility\ Package/apps/glean
npm install
npm start
npm test
```

To ship a change, bump `version` in `package.json`, then from the Utility Package folder:

```bash
./utility note glean "what changed"
./utility publish
```

Pull before starting work. Stay inside `apps/glean`; `tools/`, `suite.json` and `apps/hub` belong to the Utility Package chat.

## State at first release (0.1.0)

- Built and tested on Linux (Electron 44 under Xvfb). `npm test` runs 14 Node checks covering the site adapters, dedupe and merge rules, naming, the library and the downloader.
- `test/e2e/run.sh` (Linux, root, Xvfb) starts a mock server that answers as `www.instagram.com`, `scontent.cdninstagram.com`, `www.patreon.com`, `c10.patreonusercontent.com` and `example.org`. It points Electron at it with `--host-resolver-rules`, then drives the real window. 11 checks pass:
  - Inline JSON and the feed API: 20 posts, 3 carousels, 2 reels, all at 1080px.
  - The lightbox.
  - Unticking a post, then downloading with names, the CSV and the manifest.
  - Clear.
  - Check for new: it stops after about one page of posts it already has.
  - Patreon: multi-image posts, a locked post skipped, WebP saved as JPG.
  - Batch with a gallery page and a direct link.
  - The library, its detail view and the contact-sheet PDF.
  - The light theme and Settings.
- **Not yet run against the real sites while signed in, or on a Mac or Windows.** The Instagram login page did render correctly inside Glean's browser. Check these first:
  1. **Instagram while signed in.** Open a profile, Collect, Auto-scroll. The tray should fill with posts that have dates and captions. If it fills only with "loose" pictures, Instagram's response shape changed: look at `instagramWalk`/`isIgPost` in `extract.js`. A post is any object with `image_versions2`/`display_url` plus `code`/`shortcode`/`pk`. Responses are picked up in `capture.js → onCdp` (XHR/Fetch, JSON or JS content type, URL matching `API_HINT`).
  2. **Facebook** is best effort. Photos come from GraphQL `__typename: 'Photo'` with `image`/`viewer_image`/`photo_image`, and are grouped under the nearest `Story`. The page's Photos tab only loads thumbnails until a photo is opened, so a lower resolution there is expected. Opening the photo viewer and pressing the right arrow through a set loads full sizes.
  3. **Patreon:** media come from `included[type=media]` (`image_urls.original`, `download_url`). Video posts that stream (Mux/HLS) have no file to save and are skipped.
  4. **Downloads with a Referer:** Chromium refuses a Referer set directly on `session.fetch()`. Glean sends `X-Glean-Referer`, and `onBeforeSendHeaders` turns it into `Referer`. Keep that pairing.
  5. **Mac:** traffic lights sit at 16,15 and the sidebar leaves 84px. **Windows:** the title-bar overlay colours follow the theme (`window:chrome`), and the bars leave 150px on the right.

## Rules specific to Glean

- **Pages never get Node.** Webviews always use `src/browser/webview-preload.js` (identity only), forced in `will-attach-webview`. Page scripts run in isolated world 1077.
- **Main owns the tray** (`Collection`). The window only receives diffs (`glean:collection`) and sends keys back to download.
- **One session:** `persist:glean`. Thumbnails in the tray come through `glean-img://`, fetched with that session, so signed-in CDNs work. Saved files come through `glean-file://`, which only serves files inside the Glean folder or a library folder.
- **Dedupe key:** the CDN file name (`keyOf`). The same picture at different sizes merges into one item that keeps the biggest size and the richest post info (`merge`). Videos are keyed by their cover picture, so the grid thumbnail and the video are one item. Keep the tests passing if you touch either.
- **The library is rebuildable:** each account folder's `glean.json` is the truth, and `library.json` is only an index (`Library.rescan`).
- **Sync** ("Check for new") stops after 6 posts in a row that are already saved (`autoScroll({ untilKnown })`).
- No native modules and no runtime npm dependencies, so there's nothing special for Windows cross-builds.
