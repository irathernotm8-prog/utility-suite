# Beam

AirDrop for Macs, PCs and phones. Send files, whole folders, text and links straight to another computer on your network — no cloud, no cables, no size limit, encrypted end to end.

## What it does

- **Nearby.** Every computer running Beam on the same network shows up on its own (UDP multicast + broadcast, no setup). Drop files on a device to send, or drop them anywhere and click a device. Click a device for files, a folder, text or the clipboard.
- **Asks first.** The other side gets a request with who, what and how big, and accepts or declines (in the window, or from the notification on a Mac). Tick “Always accept” and that device becomes **trusted**: its sends go straight in.
- **Fast.** Big files are cut into 32 MB segments sent over several connections at once (Auto = up to 6); small files are packed into 16 MB batches so thousands of photos don't each pay for a round trip. Data streams straight from disk to disk. Over gigabit Ethernet or good Wi-Fi it runs at what the network allows.
- **Doesn't lose work.** A dropped connection retries each piece; a failed transfer can be retried and only the missing pieces are sent (the receiver keeps them for an hour). Nothing is ever overwritten: a second “Holiday” arrives as “Holiday 2”. Modified dates are kept.
- **Private.** Each device has an X25519 key. Two devices derive a shared AES-256-GCM key; every message and every 1 MB frame of file data is sealed. A changed, reordered or cut-short stream is rejected. Each pair has a 6-digit **safety code** to compare when trusting. If a trusted device's key ever changes, Beam warns instead of auto-accepting.
- **Phones and tablets, no app.** Phone & tablet shows a QR code. The phone opens a Beam page in its browser: send photos, videos, files and text to the computer, and download files or text the computer put up for it. The link is secret, works only on your network, and “New link” retires the old one.
- **Other networks.** A computer on another subnet/VLAN can be added by its address (Settings › About shows it). Beam remembers it and checks it every 10 seconds.
- **Receiving: Everyone / Trusted / Off.** Off also hides the computer.
- **Everywhere.** Menu bar (Mac) / tray (Windows) with send-to menus and receiving mode; drop on the Dock icon, the menu bar icon, or “Open With › Beam”; Windows Explorer **Send to › Beam**. Keeps the computer awake while files move. Runs in the background so others can send to you; optional open at login.

## Working on it

```bash
npm install
npm start
BEAM_DEMO=1 npm start            # a pretend neighbourhood: devices, history, a live transfer and a request
npm test                          # 16 Node checks: encryption, the plan, safe names, two engines over localhost (folders, retry, cancel, decline, trust, text, phone page), discovery
xvfb-run -a node test/e2e/pair.js # two real copies of the app find each other over UDP and send 1.5 GB through the window
xvfb-run -a node test/e2e/shots.js# every screen in dark and light → test/e2e/out
node test/e2e/phone.js            # the phone page in an iPhone-sized browser
```

Two copies on one computer: `BEAM_MULTI=1 BEAM_USER_DATA=/tmp/beam-b BEAM_PORT=48000 npm start`.

## How a transfer works

```
sender                                          receiver
  POST /v1/offer   (sealed: file list, plan) ─▶  asks its user, or accepts at once for a trusted device
                                             ◀─  { accepted, done: [jobs it already has] }
  both build the same plan: big files → 32 MB segments, small files → 16 MB batches
  PUT /v1/put?k=N  ×(up to 6 at a time)      ─▶  decrypts frames, writes straight to disk at the right offsets
  POST /v1/finish                            ─▶  every job there? set dates, move into the receive folder
```

Discovery: UDP 47820, multicast group 239.255.77.21 + each network's broadcast address, hello every 3 s, gone after 11 s. Transfers and the phone page: TCP 47821 (the next free port if taken).

## Code map

| File | What's in it |
|---|---|
| `src/core/engine.js` | The HTTP server, sending (offer → parallel jobs → finish, retries), receiving (ask, write, finish), history, trust |
| `src/core/crypto.js` | Keys, the shared key (ECDH + HKDF), sealed messages, the AES-GCM frame streams, safety codes |
| `src/core/files.js` | Walking dropped files and folders, the transfer plan, safe names, no-overwrite names, moves |
| `src/core/discovery.js` | Finding devices over UDP; network interfaces |
| `src/core/phone.js` | The phone page's API: QR code, uploads, text, downloads (with ranges) |
| `src/core/identity.js` | This device's id and key |
| `src/phone/index.html` | The page phones see (self-contained) |
| `src/main.js` | Window, menu bar / tray, notifications, Dock / Send to / Open With, settings, IPC |
| `src/renderer/` | `app.js` helpers and sending, `nearby.js` the field and requests, `views.js` Activity, Phone, Devices, Settings, `boot.js` start-up |
| `src/demo.js` | The pretend neighbourhood for `BEAM_DEMO=1` |
| `build/make-icon.py` | Regenerates the icon and tray icons |

## Where things are kept

- Received files: `~/Downloads/Beam` (change in Settings). Pieces of a transfer still arriving live in `.beam-incoming/` inside it and are cleaned up.
- App-data folder (`~/Library/Application Support/Beam`, `%APPDATA%\Beam`): `identity.json` (this device's id and private key), `settings.json` (name, trusted devices, saved addresses, phone link), `history.json`.
