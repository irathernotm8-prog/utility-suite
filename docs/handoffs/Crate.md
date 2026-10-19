# Crate: handoff for the Crate chat

Crate is the Utility Package's MP3 library app: it downloads from YouTube and similar sites, tags and edits the MP3s, and sends them to a phone. It lives in `apps/crate` inside `~/Downloads/Utility Package`. `apps/crate/README.md` has the feature list and code map.

## Working on it

```bash
cd ~/Downloads/Utility\ Package/apps/crate
npm install
npm start
npm test
```

To ship a change, bump `version` in `package.json`, then from the Utility Package folder:

```bash
./utility note crate "what changed"
./utility publish
```

Pull before starting work. Stay inside `apps/crate`; `tools/`, `suite.json` and `apps/hub` belong to the Utility Package chat.

## Rules specific to Crate

- **The MP3 and its tags are the source of truth.** The index in `<library>/.crate/library.json` is a cache plus extras (source link, play counts, loved, playlists, what was sent where, edit settings). A rescan must always be able to rebuild a working library from the files alone.
- **Never edit a song destructively.** The first audio edit copies the file to `.crate/originals/<id>.mp3`; every later edit re-renders from that original, and *Undo all edits* restores it. Keep that so edits never stack generation loss.
- **Tags are ID3v2.3 with a 1000px square JPEG front cover** (`tags.write`). Phones and Apple Music read that reliably; don't switch to v2.4.
- **Files follow the naming pattern** whenever tags change (`library.placeTrack`). Moving goes through `uniqueRel` (no overwrites) and `pruneEmpty` (only removes folders that are empty apart from .DS_Store/Thumbs.db).
- **Deleting goes to the Trash** (`shell.trashItem`), never `fs.rm`, for the user's songs.
- **Tools:** FFmpeg comes from `ffmpeg-static` (asar-unpacked). yt-dlp and Deno are downloaded into app data at runtime, not bundled, because YouTube breaks old yt-dlp builds within weeks. Don't add `ffprobe-static`: it ships every platform's binary (~350 MB); `audio.probe` parses FFmpeg's report instead.
- **iTunes catalog**: every request goes through `metadata.itunes()` (queue, cache, backoff). Don't call the API directly.
- **No secrets.** The only optional credential is the browser sign-in for yt-dlp (`--cookies-from-browser`), which yt-dlp reads from the browser itself. Crate stores only the browser's name.

## Testing

- `npm test` checks title clean-up, file naming, MP3 conversion, trim/fade/gain/loudness, waveform, silence detection, square artwork, ID3 round trip, library add/edit/rename/reorder, edit + undo, rescan, import from M4A/FLAC, playlists and folder export.
- `CRATE_USER_DATA=/tmp/crate-test npm start` gives a clean settings folder. Point Settings → Library folder somewhere disposable to keep your real library out of it.
- Live download test: `CRATE_TEST_URL="https://www.youtube.com/watch?v=FGBhQbmPwH8" CRATE_YTDLP=~/Library/Application\ Support/Crate/bin/yt-dlp CRATE_DENO=~/Library/Application\ Support/Crate/bin/deno npm test`
