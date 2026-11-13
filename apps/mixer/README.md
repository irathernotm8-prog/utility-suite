# Mixer

A music studio for you and your AI, in the Utility Suite. Compose instrumental tracks (no vocals) with synthesized
instruments and drum kits, edit and remix recordings you bring in, mix with effects and automation, measure what you
made, and export WAV/MP3 and stems. Claude and Codex plug in through an MCP plugin; because they can't hear, every
tool that changes sound can return measurements (loudness, key, balance, a mix check) and a picture.

## What's in it

- **Arrange**: tracks (instrument, drums, audio) with mute/solo/volume, clips you drag, trim, split (S) and duplicate
  (⌘D), a ruler with a loop bar and section markers, zoom, snap, drop audio anywhere to import it.
- **Editors** (double-click a clip): piano roll (draw, move, lengthen, marquee, velocity lane, quantize, transpose,
  audition, the key's notes tinted), drum step grid (paint, accent, soft, your own sample per voice), audio editor
  (trim on the waveform, gain, fades, pitch that keeps tempo, stretch that keeps pitch, tape speed, reverse, fit to
  the song's tempo).
- **Mix**: a console strip per track (effect chain, pan, fader, meter) and the master with **Check mix** — LUFS,
  peak, tonal balance against typical ranges, width, low-end mono and plain-language fixes.
- **8-bit music**: NES channels (pulse 12.5/25/50%, the 4-bit triangle, the 15-bit noise channel in long and short
  mode), the Game Boy wave channel, a SID-style saw, Chip Chord instruments that turn chords into the fast NES
  arpeggio, NES and Game Boy drum kits (triangle kicks, noise snares and hats, stepped 4-bit decays), chip rhythms
  (`chip-arp`, `chip-arp16`, `bass-chip`, `bass-gallop`) and grooves (`chiptune`, `chip-drive`, `chip-march`), an
  8-bit crush effect with real sample-rate reduction, **New song › Start with 8-bit channels**, and **Make it 8-bit**
  (song menu) to convert any song by each part's role.
- **Sound FX**: game sound effects. 30 kinds (sfxr's eight plus menu move/confirm/cancel, footstep, whoosh, thud,
  magic, teleport, alarm, death, heal, charge-up, zap, bounce, gunshot, door, and layered big explosion, sword swing,
  level up, game over, gem, ouch), every sfxr control, up to four layers (delay, gain, pitch), Mutate, Variations
  side by side, 8-bit/low-rate output, packs in `~/Documents/Mixer/Sound FX`, export to WAV, MP3, a `sounds.json`
  manifest and a JavaScript module that synthesizes the pack in the browser (`play('coin')`), with optional extra takes
  (`coin_1…`), and **Add to song** as a clip or on a drum pad.
- **Sounds**: 54 synthesized instruments in 10 categories (pianos, electric pianos, organ, clav, plucked strings
  modelled with Karplus–Strong, mallets, FM bells, pads, strings, brass, flute, leads, plucks, 808/sub/reese/acid/
  wobble basses, FX) and 10 drum kits (Studio, 808, 909, Trap, Lo-fi, Techno, Crushed Chip, NES, Game Boy, FX) with 18 voices — all
  synthesized, no sample downloads. Preview plays a phrase in the song's key.
- **Effects** (12): EQ, compressor, reverb, delay (note-synced, ping-pong), drive, filter (with LFO), chorus, stereo
  width (mono-below), bitcrush, tremolo/auto-pan, sidechain duck (follows a track or one drum voice), limiter.
- **Automation**: volume, pan and filter cutoff per track (set by Claude; shown as an **A** badge).
- **Export**: WAV 16/24/32-bit float or MP3 128–320 kbps, 44.1/48 kHz, normalized to a LUFS target, the whole song
  or the loop, optional stems.
- **Songs**: each song is a folder in `~/Documents/Mixer/<Song>` with `song.json`, `audio/` (copies of imports),
  `exports/` and `history/` (a snapshot before every change Claude makes). Undo/redo is shared by you and Claude.

## The plugin (Claude Desktop, Claude Code, Codex)

Connections › Add to Claude / Claude Code / Codex. Tools:

| Tool | What it does |
|---|---|
| `mixer_guide` | Conventions, every sound/rhythm/groove/effect, how to compose, arrange and mix, how to check work |
| `get_song`, `list_songs`, `new_song`, `open_song`, `set_song` | The song (summary + arrangement picture), tempo/key/time/length, loop, markers |
| `list_sounds` | Instruments, kits and voices, rhythms, grooves, effect settings |
| `add_track`, `edit_track`, `set_effects`, `automate` | Tracks, effect chains (track or master), automation |
| `write_notes` | Notes by name or MIDI number (piano-roll picture back) |
| `write_chords` | Progressions by name or numeral, 13 chord rhythms + 6 bass rhythms, smooth voicing |
| `write_drums` | Text patterns (`x...X...`) or 14 grooves, swing, fills, humanize (drum-grid picture back) |
| `edit_clip`, `arrange` | Move/split/duplicate/trim/fade/pitch/stretch/speed/reverse/fit tempo; copy/insert/delete bars |
| `import_audio` | Bring in a file; detects tempo, key, loudness (waveform picture back) |
| `analyze`, `view` | Render and measure the mix/a track/a clip/any file; pictures of the arrangement, notes, waveform |
| `transport`, `export`, `undo` | Play for the user, export files, undo/redo |
| `new_song` template `chiptune`/`gameboy`, `make_8bit` | 8-bit songs: console channels, or convert a song |
| `make_sfx`, `edit_sfx`, `list_sfx`, `new_sfx_pack`, `play_sfx` | Game sound effects: roll kinds with variations, layer and tweak, sheets of waveforms + spectrograms |
| `export_sfx`, `sfx_to_song` | WAV/MP3/JS module packs (with extra takes) into a game's folder; place a sound in the song or on a pad |

Ask Claude (sidebar) runs your own Claude Code or Codex headless with only Mixer's tools.

## Code map

```
src/main.js            window, settings, songs, IPC, bridge, Ask
src/project.js         songs on disk, shared undo/redo, history snapshots, audio imports
src/enginehost.js      the hidden engine window (render, analyze, pictures, export jobs)
src/mcp-handlers.js    every plugin tool (also used by the window for import/export/8-bit/sfx)
src/sfxlib.js          sound-effect packs on disk and their exports (WAV, MP3, sounds.json, JS module)
src/connectors.js      install the MCP server into Claude Desktop / Claude Code / Codex; the local bridge
src/ai.js              find Claude Code / Codex; Ask
src/core/              plain JS shared everywhere: theory.js (notes, keys, chords, rhythms, grooves),
                       song.js (the model and every edit), sounds.js (presets, kits, effects), levels.js
                       (calibration, generated), sfx.js (the game-sound synth: sfxr + layers + 8-bit output),
                       analysis.js (LUFS, tempo, key, balance, stereo, sections, mix
                       check, spectrogram), stretch.js (WSOLA), wav.js
src/audio/             Web Audio engine shared by playback and export: synth.js (incl. chip waves, LFSR noise),
                       drums.js (incl. NES/Game Boy kits), fx.js, worklets.js (8-bit crush), engine.js (incl. chip-chord arps)
                       (Session/Player/render), pictures.js
src/engine/            the hidden engine page (host.js) + its preload
src/renderer/          the window: app.js, transport.js, arrange.js, editors.js, mix.js, views.js, sfx.js, boot.js
src/vendor/lamejs/     MP3 encoder (LGPL-3.0)
mcp/                   mixer-mcp.js (stdio MCP server, no dependencies) and tools.js (tool list + instructions)
test/                  run.js (Node checks), e2e-main.js (every tool through the real engine), shots.js
                       (screenshots), calibrate.js (regenerates levels.js)
```

## Data

- Songs: `~/Documents/Mixer` (change in Settings).
- Sound packs: `~/Documents/Mixer/Sound FX/<Pack>/pack.json` (recipes) and `exports/` (unless you export elsewhere).
- App data: `settings.json`, `bridge.json` (the plugin's private connection), `mcp/` (the installed MCP script),
  `ask/` (scratch for Ask).
