# Sideby

Watch anything together with friends, in sync. Desktop app for Mac and Windows (Electron).

## How it works

**Rooms are peer to peer.** There's no Sideby server to run. When you open a room, Sideby finds the other people in it through public Nostr relays, then everyone connects directly over encrypted WebRTC. Video, chat and reactions never pass through a server. The room code is also the password that encrypts the handshake, so only people with the code can join.

Everyone has a **personal room code** that never changes (unless you make a new one). Friends save it once and can join any time you're in.

**Two ways to watch:**

| | Synced watching | Broadcast |
|---|---|---|
| What it is | Everyone opens the same page in Sideby's built-in browser. Sideby finds the video on the page and keeps everyone's play, pause, seek and speed matched. | The host streams a page, window or screen (with sound) to everyone. |
| Works with | Any site with a normal video player: YouTube, Vimeo, Twitch VODs, Internet Archive, embedded players, direct MP4/WebM/HLS links. | Anything you can see, including live sports, local files and other apps. |
| Picture quality | Full quality for everyone; each person streams from the site. | Up to 1080p60, limited by the host's upload speed. |
| Best for | Movies, shows, YouTube. | Live games, streams that won't sync, files on your computer. |

Netflix, Disney+, Max and other DRM services won't play in Sideby's browser (Electron has no Widevine), and they show black when broadcast.

## Using it

1. Enter your name and press **Open my room**.
2. Press **Invite** (or click the code chip) and send the invite. Friends paste it on their home screen. If they copied it, Sideby notices and offers to join. `sideby://join/CODE` links also open Sideby directly.
3. Search YouTube or paste any link in the address bar. Everyone's stage follows the host.
4. Play, pause and seek in the page's own player or with Sideby's controls. By default anyone can control playback. The host can turn that off in Settings.
5. For live games: open the stream page, then **Broadcast → Broadcast this page**.

Click a friend's seat on the couch to make them host. If the host leaves, the next person in the room takes over automatically.

Keyboard: `Space` play/pause, `F` theater mode, `C` show/hide chat, `1`–`8` reactions.

## Development

```bash
npm install
npm start                  # your copy
npm run friend             # a second copy with its own profile, to test with yourself
npm test                   # unit tests (sync math, room protocol, invite codes)
npm run vendor             # rebuild ui/vendor after upgrading trystero / hls.js / fonts
npm run relay              # optional self-hosted relay (see below)
```

### Layout

```
electron/main.js          app lifecycle, sideby:// links, IPC, screen-capture handler, menu
electron/stage.js         built-in browser (WebContentsView), ad blocking, local file + player protocol
electron/frame-preload.js runs in every frame of the stage: finds/controls the <video>, draws reactions
electron/ui-preload.js    the window.sideby bridge for the UI
electron/settings.js      settings.json in userData
ui/app.mjs                UI controller and RoomSession (sync, follow-the-host, broadcast, chat)
ui/lib/room-core.mjs      room protocol: host election, state, chat, controls (transport-agnostic, tested)
ui/lib/net.mjs            Trystero/WebRTC transport
ui/lib/sync.mjs           drift correction math (tested)
ui/lib/clock.mjs          clock offset to the host (tested)
ui/lib/broadcast.mjs      screen/tab broadcast over WebRTC
ui/player/                built-in player for direct files and HLS
relay/server.mjs          optional self-hosted relay
```

### Sync

The host's stage reports its video every 500 ms and on every play/pause/seek. The host publishes `{t, paused, rate, at}` to the room. Each guest estimates the host's clock offset (NTP-style), projects where the host is now, and corrects:

- under 0.12 s off: leave it alone
- 0.12–1.25 s: speed up or slow down 6% until caught up (no visible jump)
- over 1.25 s: seek, then wait 2 s before seeking again
- live streams: match the distance behind the live edge (approximate; use Broadcast for exact)
- YouTube ads and different videos are detected and not fought

### Connection troubleshooting

Most home networks connect directly. Some strict networks (some offices, schools, mobile carriers) block direct connections, so friends never appear. The fix is a TURN server: Settings → Connection. Cloudflare Calls and Metered both have free tiers. A friend's seat shows "(relay)" when their connection goes through TURN.

If public relays are ever unreliable, run `npm run relay` on any always-on machine behind HTTPS and add its `wss://` address under Settings → Connection → My own relay server. Everyone in the room must use the same setting.
