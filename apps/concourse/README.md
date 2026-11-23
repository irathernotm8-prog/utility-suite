# Concourse

Microsoft Teams, rebuilt as a glowing departures board. A stand-alone desktop app (Mac and Windows) with its own UI on top of Microsoft Graph: chats, channels, meetings you can join, a timetable calendar and your own tasks, without Teams' bloat.

## What's in it

- **Board (home).** Live split-flap clock, the next departure with a countdown and a big Join button, and three boards for the chosen day (◀ TODAY ▶): **Departures** (meetings: time, gate = Teams/Zoom/Meet/room, status ON TIME · NOW BOARDING · IN PROGRESS · DEPARTED · CANCELLED · AWAITING RSVP), **Arrivals** (messages that came in that day, unread first) and **Manifest** (your tasks due that day, overdue ones, quick add). "Open platforms" lists free gaps in your working hours; click one to book a meeting there.
- **Chats.** Every 1:1, group and meeting chat. Unread from Teams' own read marker, pin, mute, mark unread, search and filters. Thread with runs by sender, date flaps, reactions (👍 ❤️ 😆 😮 😢 😡), reply with quote, edit (↑ edits your last message), delete, copy, urgent messages, @mentions that really mention, **→ Task** on any message, images and files, and **Meet now** (creates a Teams meeting with everyone in the chat, posts the link and joins).
- **Teams.** Every team and channel, posts with replies, new posts and replies. Reading channel posts needs Microsoft's "Read all channel messages" permission, which an admin usually approves once; Concourse asks for it separately so everything else works without it.
- **Timetable.** Week view draws each day as a transit line: meetings are stations along it with the duration as a lit segment, overlaps branch onto parallel tracks, and a train marks now. Day view is that day's full departures board plus free platforms. Meeting drawer: Join (or Join with… browser / Concourse window / Teams app / Vantage / copy link), RSVP, attendees and their replies, notes, prep task, email or chat with attendees, cancel (organiser). New meeting with a people picker, Teams link on/off and free-slot suggestions.
- **Manifest.** Self-assigned tasks in four columns (Delayed, Boarding, Scheduled, Standby). Local tasks live on this computer; Microsoft To Do tasks sync both ways when an account is connected. Tasks made from a message or meeting link back to it.
- **Everywhere.** ⌘K palette (chats, meetings, tasks, commands), live ticker along the bottom, menu-bar countdown to the next meeting (Mac) and a tray menu with today's departures, ⌘⇧J global "join next meeting", meeting reminders with a Join button, message notifications (mentions-only, quiet hours, respects Do not disturb), presence and status message, several accounts, four lamp colours (Amber, Cyan, Signal, Platinum), offline start from the last snapshot.
- **Suite.** Optional "Record with Docket" starts Docket's notes when you join. Join in Vantage. Offers `status`, `next`, `today`, `unread`, `join(id?)`, `open(view)` and events `unread`, `boarding` on the Utility Suite link (for Atoll).

## Run

```bash
npm install
npm start            # your accounts
npm run demo         # a pretend company (or: Settings › Look around with sample data)
npm test             # 15 Node checks, no Electron, no network
```

## Connecting Microsoft 365 (one time)

Concourse is a public client (no secret). It needs an app registration's **Application (client) ID**:

1. entra.microsoft.com › App registrations › New registration. Name *Concourse*; *Accounts in any organizational directory (multitenant)*.
2. Redirect URI: *Public client/native (mobile & desktop)* → `http://localhost`.
3. Authentication › Advanced › *Allow public client flows*: Yes.
4. API permissions › Microsoft Graph › Delegated: `User.Read User.ReadBasic.All People.Read Chat.ReadWrite ChatMessage.Send Calendars.ReadWrite Presence.Read.All Presence.ReadWrite Tasks.ReadWrite Team.ReadBasic.All Channel.ReadBasic.All ChannelMessage.Send` (+ `ChannelMessage.Read.All` for channel posts; admin approval).
5. Paste the ID in Settings › Accounts, or put it in `src/config.json` so every copy you build (and give to friends) has it.

Sign-in is Microsoft's own page in the system browser (authorization code + PKCE, loopback redirect), so MFA and SSO work. Refresh tokens are stored encrypted with the system keychain (`safeStorage`) in `accounts.bin`. If a tenant blocks user consent, Settings has an **Admin consent link** to send IT. Personal (Teams free) accounts can't be used: Graph has no chat API for them.

## Code map

```
src/main.js          window, tray/menu bar, accounts + tokens, reminders, notifications, joining, suite link, the api table
src/sync.js          one account's live copy (chats 8–20 s, calendar 3 min, To Do 2 min, presence 90 s) with change events
src/core/auth.js     PKCE sign-in with a loopback redirect, refresh, friendly AADSTS errors, admin consent link
src/core/graph.js    Microsoft Graph client: throttling, paging, every call Concourse makes
src/core/model.js    pure board logic: statuses, join links, departures/arrivals/manifest, tracks, free slots
src/demo.js          the pretend company (same shapes as Graph) for demo, tests and screenshots
src/preload.js       window.concourse.call / on / model
src/renderer/        board.css (tokens, flaps), app.css (layout), flap.js, util.js, app.js, views/*.js
test/run.js          Node checks;  test/e2e/shoot.js  screenshots of every screen (see the file for the command)
```

## Data

Its app-data folder: `settings.json`, `accounts.bin` (encrypted refresh tokens), `tasks.json` (local tasks), `cache.json` (last snapshot for offline start), `photos/` (profile pictures, 7 days), `window.json`. Meeting windows keep their sign-in in the `persist:meetings` partition.
