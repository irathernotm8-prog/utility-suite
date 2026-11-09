# Mixer: handoff for the Mixer chat

Mixer is the Utility Package's music studio, made for working with Claude and Codex: compose instrumental tracks with
synthesized instruments and drum kits, edit and remix imported recordings, mix with effects and automation, measure,
and export. It lives in `apps/mixer` inside `~/Downloads/Utility Package`; `apps/mixer/README.md` has the feature list,
tools, code map and data folders.

## Working on it

```bash
cd ~/Downloads/Utility\ Package/apps/mixer
npm install
npm start
npm test                                        # 19 Node checks, no network
xvfb-run -a npx electron test/e2e-main.js /tmp/e2e    # (Linux) every plugin tool through the real engine + the MCP stdio → bridge path
xvfb-run -a npx electron test/shots.js /tmp/shots     # (Linux) every screen, playback, no window errors
npx electron test/calibrate.js                  # after changing an instrument or kit: regenerates src/core/levels.js
```

To ship a change, bump `version` in `package.json`, then from the Utility Package folder:

```bash
./utility note mixer "what changed"
./utility publish
```

Pull before starting work. Stay inside `apps/mixer`. `tools/`, `suite.json` and `apps/hub` belong to the Utility Package chat.

## How it fits together

- **One engine for hearing and exporting.** `src/audio/engine.js` builds the song as a Web Audio graph: track input →
  DC blocker → (kit crush/low-pass) → effects → automation gain → fader → pan → mute → master effects → master volume.
  The window's `Player` schedules a 180 ms window ahead every 25 ms (edits are heard at once, loops wrap, metronome);
  export/analysis render the same graph in an `OfflineAudioContext`, scheduled in 2-second slices with
  `suspend()`/`resume()` so only notes about to sound exist in the graph. Finished notes are disconnected (`sweep()`),
  otherwise every past note costs CPU until GC.
- **The hidden engine window** (`src/engine/`, run by `src/enginehost.js`) does render / analyze / probe / picture /
  peaks / export jobs for the plugin and the Export sheet. Analysis renders at 32 kHz (everything measured is below
  16 kHz) for speed; export uses 44.1/48 kHz.
- **The song** is plain JSON (`src/core/song.js`): times in beats, bars 1-based in the plugin, audio clips keep
  seconds (`offset`, `dur`, `srcDur`) plus `pitch`/`stretch`/`speed`/`reverse`/`gain`/fades. The main process owns
  it (`src/project.js`) with a shared undo stack; the window edits a working copy and commits whole songs
  (`song:commit`). A commit made while a Claude change was arriving is dropped with a toast (`S.remoteMark`).
- **Audio files** are copied into the song's `audio/` folder on import. Decoding is Chromium's `decodeAudioData`
  (WAV, MP3, AAC/M4A, FLAC, Ogg/Opus, MP4/MOV/WebM audio — not AIFF). Stretch/pitch use WSOLA
  (`src/core/stretch.js`), cached per (file, factor, reverse).
- **Levels are calibrated** (`src/core/levels.js`, generated): every instrument's mezzo-forte note peaks near −12 dBFS
  and each drum voice at a kit-typical level, so a fresh 5-track song lands around −12 to −13 LUFS before the master
  limiter. Re-run `test/calibrate.js` whenever a preset changes.
- **Claude can't hear**, so `analyze` reports LUFS (BS.1770 gating), peaks, PLR, tempo (spectral-flux autocorrelation),
  key (Krumhansl–Kessler on a chromagram), band balance %, stereo width / low-end width, per-bar energy → sections, and
  a mix check with fixes, plus a waveform/spectrogram picture with bar numbers. `write_notes`/`write_chords`/
  `write_drums` return a piano roll or drum grid; `get_song`/`arrange` return the arrangement.

## State at first release (0.1.0)

- Verified on Linux (Electron 44, Xvfb): 19 Node checks; the e2e run drives all 22 tools through the real engine
  window — trap drums with a fill, numerals in key (i VI III VII → Am F C G), arps, a melody, sidechain duck, master
  chain, automation, copying bars, analysis, WAV export with 5 stems normalized to −14 LUFS (peak under the
  ceiling), MP3 export, importing a recording (tempo 120 and E minor detected, tempo adopted), fit-to-tempo stretch,
  split, pitch, analyzing a file, undo, and the real MCP stdio → bridge path (22 tools, picture returned). Screens
  checked in light and dark; playback runs with no window errors.
- **Not yet run on a real Mac or Windows PC.** Check first:
  1. Playback latency and CPU with a big song (the scheduler and meters), and that audio starts on first Play.
  2. Export speed: on the 2-core Linux test box 21 s of a 5-track song renders in ~4.5 s at 44.1 kHz; a Mac should be
     several times faster. Analysis of a full 3-minute song is the slowest plugin call.
  3. Importing MP3/M4A/FLAC on each OS (Chromium's decoders; Electron ships the proprietary codecs).
  4. Plugin install from Connections (same code as Dither: Claude Desktop config, `claude mcp add`, Codex TOML).
- **Known limits:** instruments are synthesized (no sampled orchestras), no vocals, no stem separation of imported
  mixes, no MIDI input/recording, no audio recording, automation is drawn by Claude (shown, not yet editable in the
  window), one tempo per song.

## Ideas for next versions

- Stem separation for imported songs (a local Demucs model, like Facet/Kiln run models) — "remove vocals", "solo the
  drums".
- Record from a microphone or audio interface; MIDI keyboard input (Web MIDI) into the piano roll.
- Automation lanes editable in the window; tempo changes.
- A sample library (one-shots and loops) next to the synthesized sounds; Crate integration to pull tracks in.
