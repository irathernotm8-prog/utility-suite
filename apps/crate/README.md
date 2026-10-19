# Crate

Your MP3 library, built for the phone. Download songs, albums and playlists from YouTube (and SoundCloud, Bandcamp and the other sites yt-dlp supports), turn them into properly tagged MP3s, tidy them up, then send them to your iPhone or Android.

## What it does

- **Download** (⌘D): paste a link, or search YouTube / YouTube albums & playlists / SoundCloud. Playlists open as a checklist; tick **Save as an album** to give every song the same album, album artist, year, genre and cover, numbered in order. **Find album info & cover** pulls the real album from the iTunes catalog, and the downloads then use its song titles and track numbers.
- **Clean tags automatically**: "Artist - Song (Official Video) | 4K" becomes *Artist* / *Song*, "ft." moves into the title, and a catalog lookup fills in album, track number, year, genre and the real album cover. Turn any of it off in Settings.
- **320 kbps MP3s** (or 256 / 192 / VBR V0), with optional loudness matching (−14 LUFS).
- **Library**: Songs, Albums, Artists, Recently added, Loved, playlists, and **Needs a touch-up** (songs missing art, album, track numbers or with messy titles), with **Find info for all**.
- **Info panel** (⌘I): edit one song or many at once: title, artist, album, album artist, track/disc numbers, year, genre, composer, comment and lyrics. Drop an image on the artwork, search the catalog for covers, or paste a link. Everything is written into the MP3 as ID3v2.3, which every phone reads.
- **Albums**: drag songs to reorder (Crate renumbers 1 of n…), **Find album info** matches every song to the catalog's track list, and you can drop a cover onto the album.
- **Edit audio**: a waveform editor to trim intros and outros (drag the handles, or **Trim silence**), add fade in/out, change the volume or even out loudness, all with a live preview. Edits always re-render from the original download, which is kept, so **Undo all edits** puts it back exactly.
- **Player**: queue, shuffle, repeat, media keys and Now Playing, play counts, loved songs.
- **Send to phone**: **Apple Music → iPhone** copies new or changed songs into Music's "Automatically Add" folder; then sync in Finder, or let Sync Library upload them. **Folder / USB / Android** mirrors Artist/Album folders and writes `.m3u8` playlists. Crate remembers what it already sent.
- **Import**: drop MP3s (or M4A, FLAC, WAV, … which are converted) anywhere in the window. Files you copy into the library folder yourself are picked up on launch or with **Rescan**.

## Where things live

| What | Where |
|---|---|
| Your MP3s | `~/Music/Crate/Artist/Album/01 Title.mp3` (changeable in Settings, as is the naming pattern) |
| Library index, artwork cache, originals of edited songs | `~/Music/Crate/.crate/` |
| Settings and the downloaded tools (yt-dlp, Deno) | the app-data folder (`~/Library/Application Support/Crate`, `%APPDATA%\Crate`) |

None of it is part of the app or the repo.

## Tools

- **FFmpeg** is bundled (`ffmpeg-static`, unpacked from the asar). It does conversion, edits, artwork and waveforms. There is no separate ffprobe; file details are read from FFmpeg's own report.
- **yt-dlp** and **Deno** are downloaded from their GitHub releases on first use (Download page → *Set up downloads*). YouTube now needs a JavaScript runtime for yt-dlp to unlock its formats, which is why Deno is there. Crate runs `yt-dlp -U` every few days; Settings → *Update now* re-downloads both.
- **iTunes Search API** (free, no key) for song/album info and covers. It allows about 20 lookups a minute, so Crate queues, caches and backs off.

## Run it

```bash
cd apps/crate
npm install
npm start          # CRATE_USER_DATA=/tmp/crate-test npm start for a clean settings folder
npm test           # quick checks: titles, naming, conversion, edits, tags, library, export
```

`CRATE_TEST_URL=<a YouTube link> CRATE_YTDLP=… CRATE_DENO=… npm test` also downloads a real song end to end.

## Code map

```
src/main.js            window, menu, crate:// protocol (songs with seeking, artwork), IPC
src/preload.js         window.crate.call / on
src/core/settings.js   settings.json in app data
src/core/tools.js      FFmpeg path, yt-dlp + Deno install/update, process runner
src/core/audio.js      MP3 encode with trim/fade/gain/loudnorm, square artwork, waveform peaks, silence, probe
src/core/tags.js       ID3 read/write (node-id3)
src/core/metadata.js   title clean-up, iTunes catalog (songs, albums, track lists, matching)
src/core/library.js    the library: index, naming/organizing, artwork cache, edits + originals, import, rescan, albums, playlists
src/core/downloader.js yt-dlp probe/search, the download queue and pipeline (fetch → info → art → MP3 → library)
src/core/exporter.js   Apple Music "Automatically Add" and folder export with .m3u8
src/renderer/          app.js (shell, player, dialogs), views.js, inspector.js, editor.js, download.js, export.js, settings.js
test/run.js            node checks (no Electron)
```
