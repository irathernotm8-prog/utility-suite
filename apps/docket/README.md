# Docket

Takes notes in your calls. Docket listens to your microphone and the call's audio (Zoom, Teams, Google Meet, Webex, Slack, or anything else that plays through your computer), transcribes on your computer, writes a summary, and turns every meeting's action items into one to-do list. Part of the Utility Package.

## What it does

- **Start notes** with the big button, the global shortcut (**Cmd/Ctrl+Shift+Alt+D**, changeable), the tray / menu bar icon, or let Docket notice the call. With **Watch for calls** on, it reads window titles (Zoom Meeting, Meet – …, … | Microsoft Teams, Webex, Slack huddles) and either asks or starts on its own, and asks to stop when the call window goes away.
- **Live transcript** with two voices kept apart: **You** (your mic) and **Them** (the call's audio). Both names are editable. When you're on speakers and the mic hears the call, the duplicate lines are dropped (echo check).
- **On-device transcription**: Whisper through Transformers.js, on the GPU (WebGPU) when there is one, otherwise the CPU. Three models: Quick (base), Balanced (small, the default) and Best (large-v3-turbo). English or 12 other languages. The model downloads once from Hugging Face; audio never leaves the computer.
- **My notes** next to the transcript, a **Mark this moment** button (**Cmd/Ctrl+M**), and a **floating bar** (timer, latest line, pause, mark, stop) over your call when Docket is in the background.
- **Summary** when you stop: overview, key points, decisions, open questions, chapters with times, and action items with owner and due date. Written by the Claude Code CLI signed in on the computer (your Claude plan), an Anthropic API key, or the Codex CLI (your ChatGPT plan). Only the transcript text is sent. With AI off you still get the transcript plus **Suggested** to-dos found by simple rules.
- **To-dos** from every meeting in one list: tick, edit, set owner and due date, filter to **Mine**, group by meeting or by due date, jump to the meeting or play the moment it was said. Add your own ("Send the deck to Maria friday" sets the date).
- **Ask** about one meeting (under its summary) or **across all meetings** ("What did I promise people this week?"). Answers point to [mm:ss] times you can click.
- **Playback** of the recording with click-to-seek from any line, chapter or to-do, and the current line highlighted.
- **Transcribe a file**: drop or pick an MP3, M4A, WAV, WebM, MP4 or MOV (a Zoom cloud recording, a voice memo). **Transcribe again** re-runs a meeting from its recording (for example after switching to a better model).
- **Search** titles, summaries, notes and transcripts (**Cmd/Ctrl+K**). Copy or export any meeting as Markdown.

## Code map

```
src/main.js            window, menu, tray, floating bar, global shortcut, docket:// protocol, system-audio capture, IPC, settings
src/store.js           meetings + to-dos on disk, notes.md writer, search (plain Node; tested)
src/webm.js            writes a Duration into chunked MediaRecorder WebM so players can seek (tested)
src/ai.js              summaries, action items, ask; Claude CLI / API key / Codex CLI (tested with fakes)
src/detect.js          call detection from window titles (tested)
src/renderer/
  app.js               the whole UI: sidebar, meeting view, live notes, to-dos, ask, settings
  engine.js            Recorder (mic + loopback → AudioWorklet → segments, MediaRecorder → audio.webm), Whisper worker client, file decoding
  text.js              voice-activity segmenting, Whisper clean-up, echo check, rule-based to-dos (UMD; tested)
  whisper-worker.js    Transformers.js pipeline (module worker)
  capture-worklet.js   audio thread: mono 16 kHz batches + levels
  bar.html/.js         floating bar
  util.js styles.css index.html
src/vendor/            Transformers.js 4.3.1 + ONNX Runtime Web (asyncify) WASM, served locally
src/assets/            tray icons (made by build/make-icon.py)
```

## Data

Notes live in a visible folder: **`~/Documents/Docket`** (Windows: `Documents\Docket`).

- `meetings/<id>/meeting.json`: title, segments, marks, your notes, summary
- `meetings/<id>/notes.md`: a readable copy, rewritten on every save
- `meetings/<id>/audio.webm` (or the imported file): the recording, if **Keep recordings** is on
- `todos.json`: every to-do

Settings (and an encrypted API key, if you use one) are in the app-data folder. The Whisper model is cached by the window (Cache Storage in app data).
