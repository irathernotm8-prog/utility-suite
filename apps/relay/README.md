# Relay

All your inboxes, calendars and AI in one Mac app.

- **Home** (⌘1) — greeting, unread counts, today's agenda, pending tasks, and your latest inbox briefing
- **Tasks & notes** (⌘T) — every task has its own notes page, steps checklist, due date, priority and linked account
- **Inbox briefing** (⌘B) — reads each signed-in inbox and has Claude or ChatGPT tell you what needs a reply
- **Vault** (⌘9) — encrypted password manager with Touch ID, Google Password Manager import, generator; right-click any sign-in field → *Fill Password from Vault* / *Save Password to Vault*
- **Platform tabs** — Gmail, Outlook, Yahoo, Other (⌘2–⌘5), plus a unified Calendar (⌘6)
- **Chats** — Microsoft Teams, Slack, Google Chat, Zoom Team Chat, Webex, WhatsApp, Messenger, Instagram, Telegram, Discord, LinkedIn and X messages, each in its own private session with unread counts and notifications. Google Chat and Teams can reuse a Gmail/Outlook sign-in
- **Split view** (⌘⇧S) — any two mail accounts, chat apps or storage drives side by side (e.g. Teams beside Outlook, Drive beside Dropbox). Drag the divider, swap sides, right-click an account → Open in split view. Drag finished downloads into any page to upload them
- **Quick switcher** (⌘K) — jump to any account, chat, tab or action, or type a web address
- **Look** — dark purple-and-black by default; pick any accent color or switch back to the colorful Legacy palette (Settings → General). Inboxes can match Relay (purple & black) automatically; Relay leaves a provider's own dark theme alone
- **Storage** (⌘7) — Google Drive, OneDrive, Dropbox, MEGA, iCloud Drive, Box. Drive and OneDrive reuse your Gmail/Outlook sign-in
- **Browser** (⌘8) — tabs, bookmarks, incognito (⌘⇧N), find (⌘F); links from your email open here
- **Library** (⌘⇧L) — Books & Comics, Movies & Shows, and Music from plain folders in `Relay Files`: posters/covers (automatic, artwork next to the file, embedded album art, or your own — drag an image onto a poster), series, seasons & episodes, albums, resume where you left off, Continue and Favorites
- **Downloads** (⌘⇧J) — every download lands in `~/Downloads/Relay/Relay Files/Downloads` (changeable) with full history; move to Library, remove from history or move to Trash
- **Slim sidebar** (⌘\) — collapse any left sidebar to an icon rail and back
- **Relay Player** (⌘⌥P) — opt-in player for video & audio: speed, picture-in-picture, Chromecast casting, AirPlay via QuickTime, download. Send media from the Browser tab (film button or right-click → Play in Relay Player), including HLS streams; YouTube opens in a full-window cinema view; streamed/DRM video can be popped out picture-in-picture
- **Relay Reader** (⌘⌥R) — images, folders, .cbz comics and PDFs: whole page / fit width, two-page spreads, manga mode, zoom & pan
- **Tracking** (⌘⇧K) — packages across UPS, USPS, FedEx, DHL, Amazon & more; spots tracking numbers in emails; status & ETAs read straight from each carrier's own tracking page (no API needed; auto-checks every few hours, "Carrier page" view shows the live site). A paid 17TRACK API key is optional
- **Ad & tracker blocking** — uBlock Origin–compatible lists across mail, storage and the browser
- **Skins** — right-click an account → Appearance & ads: Relay, Midnight (dark), Dim, Match Relay, or custom CSS
- **Accounts sidebar** — profile pictures, unread badges, `+` to add more; drag to reorder, right-click for options
- **Private sessions** — every account has its own isolated session, so you can be signed in to several Gmail accounts at once
- **Calendar** — month / week / day views, per-account colors, local events, and each account's calendar via its iCal feed (Test button, plain-English errors, auto-fixes webcal/Outlook links, "Open my calendar settings" to find the link, refreshes every 15 minutes)
- **Assistant** (⌘J) — opens Claude, ChatGPT, Gemini or Copilot in the side panel with your own free account; Relay pastes in the email/page/calendar you're looking at (Summarize, Draft reply, To-dos) and **Use answer** puts the reply into your draft. API keys and the offline Assist app are still options. The inbox briefing works with free accounts too
- **Assist plugin** — pick **Assist** in the Assistant panel to draft replies to the open email with your own offline Assist app (tone, length, "what to say", then Shorter / More formal / Warmer / Try again). Right-click selected text → *Draft a Reply with Assist*. Also works for the inbox briefing and follow-up questions. Relay starts Assist in the background when needed; turn it on/off in Settings → AI plugins

## Relay Files

```
~/Downloads/Relay/Relay Files/
  Downloads/        everything you download in Relay
  Books & Comics/   PDFs, .cbz comics, folders of pages — a folder of volumes becomes a series
  Movies & Shows/   a video is a movie; a folder with S01E01… files or Season folders is a show
  Music/            Artist/Album/tracks — tags and built-in artwork are read automatically
```

Covers: put `poster.jpg` / `cover.jpg` next to a movie or in a series/album folder, or `Movie Name.jpg` next to `Movie Name.mp4`, or right-click → Change cover. Your own covers are kept in `Relay Files/.covers`.

## Run it

You need Node.js (LTS) from https://nodejs.org.

```bash
cd ~/Downloads/Relay
npm install
npm start
```

## Install as a real app

```bash
npm run install-app
```

This builds `Relay.app` and copies it to /Applications. You can then launch it from Launchpad/Spotlight and keep it in the Dock.

## Updating from an earlier version

```bash
cd ~/Downloads/Relay
npm install
npm run install-app
```

## Sharing a test build with a Windows friend

```bash
cd ~/Downloads/Relay
npm run dist:win
```

This creates `dist/Relay-<version>-Windows-Portable.exe` (one file, nothing to install) and a `.zip` version.
Upload the .exe to Google Drive / Dropbox / WeTransfer and send the link. On first launch Windows shows
“Windows protected your PC” because the app isn’t code-signed — click **More info → Run anyway**.
Their data stays on their PC (`%APPDATA%\Relay`); none of your accounts, vault or API keys are included.

## Setup tips

- **Google or Outlook won't sign in:** right-click the account → **Sign-in troubles…** and try another mode (Safari, Firefox, Edge). If you see a passkey prompt, choose “Try another way” and use your password.
- **Vault:** open the Vault tab, create a master password, then *Import from Google*. Delete the exported CSV afterwards (Relay offers to move it to the Trash).

- **Add an account:** pick a tab, click `+`, then sign in on the provider's page. Relay never sees your password.
- **Profile picture:** picked up automatically after you sign in. You can also choose an image or use Gravatar.
- **Account color:** right-click an account (or click its color dot in Calendar) and pick a swatch, or use the rainbow swatch for any color.
- **Calendar feeds** (Edit account → Calendar feed):
  - Google: Calendar → Settings → your calendar → *Secret address in iCal format*
  - Outlook: Settings → Calendar → Shared calendars → *Publish a calendar* → ICS link
  - Yahoo: Calendar → ⋯ next to the calendar → Share → ICS link
- **AI keys:** Settings (⌘,) → AI plugins. Keys are encrypted with your macOS keychain.
  - Claude: https://console.anthropic.com/settings/keys
  - ChatGPT: https://platform.openai.com/api-keys
  - Models can be changed in the same screen.

## Where things live

- `src/main.js` — window, sessions, settings storage, calendar feed parsing, AI streaming
- `src/renderer/app.js` — tabs, sidebar, accounts, settings
- `src/renderer/calendar.js` — calendar
- `src/renderer/ai.js` — Claude / ChatGPT panel
- `src/renderer/styles.css` — the look

App data is stored in `~/Library/Application Support/Relay/relay-data.json`.
