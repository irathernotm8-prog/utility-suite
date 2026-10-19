# Assist 2.0 — private, on-device AI

Assist is a full AI chat app plus the original reply drafter, running entirely on your own computer. After a model is downloaded once, it works offline and nothing you type leaves your machine. Web access is optional and off until you switch it on in a chat.

## What's in 2.0

- **Chat**: unlimited conversations with a searchable sidebar. You can pin, rename, export to Markdown, and delete chats. Answers render with headings, lists, tables and code blocks that have a copy button. You can edit and resend a message, regenerate an answer, have it read aloud, and see the speed (tokens per second).
- **Memory**:
  - Every chat keeps a *running summary* when it outgrows what the model can read at once, so long chats never lose the thread.
  - Each chat also has *pinned notes* that are always used.
  - *Saved memories* apply across all chats. Say "remember that…", type `/remember …`, use the bookmark under a reply, or edit them in Settings → Memory.
- **Web**: the globe button lets Assist search (DuckDuckGo, with Bing as fallback), read the top pages, and answer with numbered citations and source chips. Paste a link and it reads that page.
- **Files**: attach or drop PDFs, Word (.docx), text, CSV and code files. Long documents are searched for the passages relevant to your question. Images work with the Vision model.
- **Think**: on Qwen 3.5 models, Assist reasons step by step before answering. The reasoning is shown, collapsed.
- **Assistants**: Assist, Writer, Marketer, Researcher, Summarizer, Coder, plus your own custom ones with their own instructions.
- **Models**: from Swift (0.9 GB) up to Pro (Qwen 3.5 9B, 6.4 GB) and Vision (Phi 3.5 Vision). Assist detects your computer's memory, recommends a model, and gives bigger computers longer chat memory (up to 16k tokens).
- **Quick Ask**: press ⌘⇧Space (Mac) or Ctrl⇧Space (Windows) in any app to open a floating box. It has one-click actions for whatever is on your clipboard (draft a reply, improve, summarize, explain, translate) and a "Continue in Assist" button.
- **Reply tab**: the original Assist drafter (email, text, comment, review with batch mode, new message), unchanged.
- **For your other apps**: the plugin bridge from 1.2 still works, and there's now an OpenAI-compatible endpoint (below).

## Plugin bridge (Relay and other apps)

When Assist starts it opens a local bridge on `127.0.0.1` (port 47615, or the next free one). It writes `bridge.json` to its app-data folder (`~/Library/Application Support/Assist/` on Mac, `%APPDATA%\Assist\` on Windows) with the `port`, a private `token`, and `openaiBaseUrl`. Requests need `Authorization: Bearer <token>`. Requests from web pages are refused. Turn it off in Settings → General → Plugins.

| Endpoint | What it does |
|---|---|
| `GET /v1/hello` | App, version, bridge version (2), whether plugins are on |
| `GET /v1/status` | Model, downloaded/loaded, busy, web available |
| `POST /v1/draft` | `{ type, tone, length, message, intent, context, subject, revisions }` → NDJSON `progress` / `delta` / `done` / `error` (unchanged from 1.2) |
| `POST /v1/complete` | `{ system, messages, maxTokens, temperature }` → same stream (unchanged) |
| `GET /v1/models` | OpenAI format: the current on-device model |
| `POST /v1/chat/completions` | **OpenAI-compatible**, streaming (`"stream": true`, SSE) or not. Any app or SDK that takes a base URL + API key can use Assist: base URL = `openaiBaseUrl`, key = `token`. |
| `POST /v1/show` | Brings the Assist window forward |

All requests share one queue with the app itself, so they run one at a time on the same model. If no model is downloaded yet, the bridge answers `model_missing` instead of starting a large download in the background. On Mac, closing the window keeps Assist running (with the model loaded) for Quick Ask and your apps; quit with ⌘Q.

## Run / build

```
npm install
npm start                 # run from source
npm run dist:win          # Windows installers (x64 + arm64)
npm run dist:mac          # Mac .dmg (must run on a Mac) — or use the GitHub workflow
```

The `.github/workflows/build.yml` workflow builds Mac and Windows on GitHub's machines (Actions → Build Assist → Run workflow, or push a tag like `v2.0.0` to publish a Release).

## Installing (send this to friends)

- **Windows:** run `Assist-Setup-…-x64.exe`. If SmartScreen appears, click **More info → Run anyway**.
- **Mac:** unzip, drag Assist to Applications, and open it. If macOS blocks it, go to **System Settings → Privacy & Security → Open Anyway** (once).

Your first message downloads the recommended model for your computer (about 1–4 GB). After that, no internet is needed unless you turn on Web.

## Project layout

- `main.js`: window, menus, Quick Ask window and shortcut, plugin bridge + OpenAI-compatible API
- `web.js`: web search and readable page text (runs in the app, not the page)
- `preload.js`: the small, safe API the interface can use
- `app/engine.js`: model catalog, memory-based recommendations, one shared queue
- `app/chat.js`: the chat client (history, memory, files, web, assistants)
- `app/reply.js`: the Reply tab · `app/bridge.js`: plugin and Quick Ask requests
- `app/research.js`, `app/docs.js`, `app/md.js`, `app/ui.js`, `app/store.js`: helpers
- `app/vendor/`: Markdown, sanitizer, PDF and Word readers, bundled for offline use (see THIRD_PARTY.md)
