# Onward

Job hunting with your AI plugged in. Search listings, save them, tailor resumes, message the people hiring, and get walked through every application, all inside one app.

- **Jobs** (⌘1): your board. Each card shows the company, pay, location, experience and the people involved, plus what went into the application: tailored resume, cover letter, answers, and the date you applied. The job drawer has one-click AI for **Tailor resume**, **Cover letter**, **Check fit** and **Message**.
- **Discover** (⌘2): search LinkedIn (and Indeed) without leaving the app. Results open beside the list with the full posting, how to apply (Easy Apply or company site), a keyword match against your resume, and anyone named as hiring. **Save to board** brings everything along.
- **Browser** (⌘3): a built-in browser that stays signed in (LinkedIn, Indeed, Gmail, company sites). It presents itself as a regular browser, so Google and Microsoft sign-ins work. Tabs remember which job they're for, including the company-site tab that LinkedIn's **Apply** opens.
- **Apply Guide**: a step-by-step panel beside any application. It recognizes the application system (Workday, Greenhouse, Lever, iCIMS, Taleo and others) and gives tips for it. It fills everything your profile answers locally, with no AI and no tokens, lists what's left, attaches your tailored resume, and drafts written answers with AI. It shows you the Submit button but never presses it. You press it, and Onward records the application and every answer you gave.
- **People**: recruiters and hiring managers on each job. LinkedIn's hiring team, and names or emails mentioned in a posting, are saved automatically. **Message** writes a tailored email, LinkedIn message or connection note, and opens it in your Mail app, Gmail, Outlook or LinkedIn for you to send.
- **Profile** (⌘4): contact info, address, links, standard application answers (work authorization, sponsorship, salary, how you heard about the job, voluntary self-ID), your base resume, and as many credentials as you like.
- **Connect AI** (⌘5) and the **AI panel** (⌘J): see below.

## Connecting AI (pick any, or several)

| | How | Cost |
|---|---|---|
| **Claude** (desktop app) | Connect AI → *Add to Claude*, then restart Claude | Your Claude plan |
| **ChatGPT · Codex** | Connect AI → *Add to Codex*, then restart Codex (works in the ChatGPT desktop app's Codex, the Codex app, CLI and IDE) | Your ChatGPT plan |
| **Claude Code** | Copy the command on Connect AI | Your Claude plan |
| **In-app AI panel** | ChatGPT, Claude or Gemini, signed in inside the panel | Your plan, no API key |
| **API key** | OpenAI or Anthropic key on Connect AI | Pay per use |

Connected assistants (Claude, Codex) get 26 Onward tools: Discover search, the full posting for a listing, your profile, the job board, contacts and message drafts, tailored resume and cover letter, the browser, and `onward_autofill`, which fills a whole page from your profile in one call. Search and autofill return short summaries, so they use far fewer tokens than reading web pages.

Regular ChatGPT chats can't use apps on your computer, which is why GPT connects through Codex or the in-app panel.

## Run it

You need Node.js (LTS) from https://nodejs.org.

```bash
# from the onward folder
npm install
npm start          # run from source
npm run install-app  # build Onward.app into /Applications
```

After installing or updating, open Onward once (it points Claude and Codex at the new copy), then restart Claude or Codex.

## Ground rules built in

- **You press the final Submit.** If an assistant tries to click it or press Enter on it, Onward highlights the button instead.
- **You send every message.** Drafts open for you to review and send.
- No one types your passwords. You sign in yourself, and sign-ins stay inside Onward.
- Uploads are limited to files in your Onward Files folder.
- Tailoring prompts forbid inventing experience. AI may reword and reorder, never fabricate.
- API keys are encrypted with the macOS keychain.

## Where things live

```
~/Downloads/Onward/Onward Files/
  Profile/                    base resume
  Profile/Credentials/        certificates, degrees, licenses…
  Applications/<date> <Company> — <Role>/
                              tailored resume (.pdf + .docx), cover letter, job.json, application.json
  Downloads/                  anything downloaded in Onward's browser
```

App state: `~/Library/Application Support/Onward/onward-data.json`.

## Code map

- `src/main.js`: window, sessions, IPC, Claude and Codex setup
- `src/listings.js`: LinkedIn listing search and parsing (public job pages), keyword match
- `src/discover.js`: Discover search, details and save (Indeed runs in a hidden tab in `renderer/discover.js`)
- `src/autofill.js`: profile-to-form matching and application-system detection (local, no AI)
- `src/ai.js`: in-app AI prompts, API calls, reply parsing; `src/actions.js`: resume and cover-letter files
- `src/claude-tools.js` + `mcp/`: the connector (MCP server and tools)
- `src/browserctl.js`, `src/pagekit.js`: driving and reading pages across frames, recording submissions
- `src/renderer/`: `discover.js`, `guide.js` (Apply Guide), `people.js` (contacts and messages), `ai.js` (AI panel), `jobs.js`, `browser.js`, `profile.js`, `settings.js`
