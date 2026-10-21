# Docket: handoff for the Docket chat

Docket is the Utility Package's meeting note-taker: live transcription on the computer, AI summaries, and one to-do list across meetings. It lives in `apps/docket` inside `~/Downloads/Utility Package`. `apps/docket/README.md` has the feature list and code map.

## Working on it

```bash
cd ~/Downloads/Utility\ Package/apps/docket
npm install
npm start
npm test
```

To ship a change, bump `version` in `package.json`, then from the Utility Package folder:

```bash
./utility note docket "what changed"
./utility publish
```

Pull before starting work. Stay inside `apps/docket`; `tools/`, `suite.json` and `apps/hub` belong to the Utility Package chat.

## State at first release (0.1.0)

- Built and tested on Linux (Electron 44 under Xvfb) with a WAV file standing in for the microphone (`DOCKET_FAKE_AUDIO`): live recording, segmenting, Whisper (Quick model, CPU/WASM), the echo check, stop → audio.webm with a Duration, playback, file import, a real summary and Ask through the signed-in Claude Code CLI, to-dos, the floating bar, and both themes. `npm test` has 18 checks.
- **Not yet run on a Mac or on Windows.** Check these first:
  1. **Call audio on macOS.** Docket asks Chromium for "screen + loopback audio" (`setDisplayMediaRequestHandler` → `audio: 'loopback'`) with the `MacLoopbackAudioForScreenShare` and `MacSckSystemAudioLoopbackOverride` features switched on in `main.js`. It needs macOS 13+ and **Screen & System Audio Recording** permission. If "Call" stays at zero during a Zoom call, that's the place to look. Ad-hoc signed builds may need the permission toggled off and on after an update.
  2. **Microphone permission** on macOS comes from `NSMicrophoneUsageDescription` in `build.mac.extendInfo` plus `askForMediaAccess`.
  3. **WebGPU.** The container had no GPU, so only the WASM path ran. On Apple Silicon the worker should report "GPU" in Settings → Transcription. If transcripts come out garbled on GPU, try **Run on: CPU only**; if that fixes it, the WebGPU dtypes in `whisper-worker.js` (`dtypes()`) are the thing to change.
  4. **Windows:** loopback capture is native; the tray icon replaces the menu bar icon, and closing the window with **Watch for calls** on keeps Docket in the tray.
  5. Meeting detection reads window titles with `desktopCapturer` (on macOS only once screen permission is granted, so it never prompts from the background). Title patterns are in `detect.js` with tests; real Teams/Meet titles may need more patterns.

## Rules specific to Docket

- **The window owns `meeting.json`.** Main writes it only when the window sends a meeting (`meeting:save`). Main owns `todos.json`; the window changes to-dos only through `todos:*` IPC. `ai:summarize` reads the meeting from disk, so the window saves first.
- **Audio never leaves the computer.** Only transcript text, your notes and the meeting date go to the AI, and only when summarizing or asking.
- **Recording runs in the main window's renderer** (`backgroundThrottling: false`). Closing the window while recording only hides it. Quitting mid-recording stops properly first (`command('stop', { quitting: true })` → `docket:stopped`).
- **Commands from the tray, shortcut, bar and notifications go through `command()` in main**, which runs `window.docket.command(...)` with a user gesture so `getDisplayMedia` is allowed.
- **Speech engine files are vendored** in `src/vendor` (no npm dependency, so no native modules and nothing to cross-build). To update Transformers.js, copy `dist/transformers.min.js` and the matching `onnxruntime-web` `ort-wasm-simd-threaded.asyncify.{mjs,wasm}` (the ORT version bundled in that Transformers.js release).
- The renderer is served from `docket://app/` with cross-origin isolation headers (needed for threaded WASM). Recordings come from `docket://data/<id>/audio.*` with byte ranges.
- Echo check (`text.js` → `addSegment`): a "me" line that repeats a "them" line said at the same time is dropped. Keep the tests passing if you tune it.

## Testing

- `npm test`: quick Node checks.
- `DOCKET_USER_DATA=/tmp/d-ud DOCKET_HOME=/tmp/d-home npm start` gives a clean app and notes folder.
- `DOCKET_FAKE_AUDIO=/path/to/speech.wav` makes Chromium use that file as the microphone (and on Linux as the call audio too, which exercises the echo check).
