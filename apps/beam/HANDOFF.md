# Beam: handoff for the Beam chat

Beam is the Utility Package's AirDrop: it sends files, folders, text and links straight between Macs and PCs on the same network (and to/from phones through a QR-code web page), encrypted end to end and as fast as the network allows. It lives in `apps/beam` inside `~/Downloads/Utility Package`. `apps/beam/README.md` has the feature list, the protocol and the code map.

## Working on it

```bash
cd ~/Downloads/Utility\ Package/apps/beam
npm install
npm start          # BEAM_DEMO=1 npm start shows a pretend neighbourhood
npm test           # 17 Node checks, no Electron
```

To ship a change, bump `version` in `package.json`, then from the Utility Package folder:

```bash
./utility note beam "what changed"
./utility publish
```

Pull before starting work. Stay inside `apps/beam`; `tools/`, `suite.json` and `apps/hub` belong to the Utility Package chat.

## State at first release (0.1.0)

- `npm test`: encrypted frames (odd chunking, tampering, truncation, wrong key), the plan, safe names on Windows, and two engines over localhost: a 300 MB + 400-file folder with an empty file and folder (hashes, dates, no `.DS_Store`), trusted auto-accept and “2” names, decline, text, a forced failure then Retry sending only the missing jobs, receiver cancel, “trusted only”, a device faking another's id, the phone API (page, uploads, a cut-short upload, text, downloads with ranges, New link) and loopback discovery.
- `test/e2e/pair.js` (Linux, Xvfb): two real copies find each other over UDP multicast, one stages and sends 1.5 GB through the window, the other accepts with “Always accept”, the file arrives bit-for-bit, a text then goes straight in, and turning receiving off hides the computer. `test/e2e/shots.js` screenshots every screen in dark and light; `test/e2e/phone.js` drives the phone page in an iPhone-sized browser.
- **Not yet run on a real Mac or Windows PC.** Check these first:
  1. **Mac Local Network permission.** macOS 15+ asks once to let Beam find devices on the local network (`NSLocalNetworkUsageDescription` is set). If two Macs don't see each other, check System Settings › Privacy & Security › Local Network. Ad-hoc-signed apps sometimes don't get the prompt until the app is opened from /Applications.
  2. **Windows Firewall.** The first launch shows the Windows Defender Firewall prompt; Beam needs **Private networks** allowed (UDP 47820 for discovery, TCP 47821 for transfers). The network itself must be set to Private. Settings › About explains this on Windows.
  3. **Mac ↔ Windows, Wi-Fi ↔ Ethernet** on the same router: multicast (239.255.77.21) and broadcast are sent, plus (since 0.1.2) a unicast sweep of the local subnet every 30 s and direct unicast hellos to known devices, for mesh systems/APs that filter multicast between wireless and wired. Guest Wi-Fi / client isolation blocks everything. Separate subnets need Add by address (adding on one side is enough: the saved address gets unicast hellos, so the other side learns this one). Double NAT (a mesh or second router in router mode) only works from the inner side outwards; the fix is putting that router in bridge/AP mode.
  4. **Dock / Open With / Send to.** Drop files on the Dock icon or use Open With › Beam (`CFBundleDocumentTypes` for `public.item`/`public.folder`); on Windows, Explorer's Send to › Beam (`%APPDATA%\Microsoft\Windows\SendTo\Beam.lnk`, only written in packaged builds) passes `--send <files>` to the running copy.
  5. **Notification buttons** (Accept / Decline) are macOS only; on Windows the notification opens the window.
  6. **Speed on real hardware.** Localhost with both ends on one 2-core Linux box does ~100–220 MB/s; each real machine only does one side. Settings › Speed lets you force 2/4/8 connections.

## Rules specific to Beam

- **The plan is the contract.** Both sides run `files.plan()` on the same file list and the plan settings the sender puts in the offer; jobs are named by number only. Keep it deterministic. Its sizes travel with the offer, so an older and a newer copy of Beam still agree.
- **Everything between devices is sealed** with the pair's key (`crypto.seal` for messages, `Encrypt`/`Decrypt` frames for file data). `/v1/hello` is the only plain answer (public info). The phone page is plain HTTP on the LAN behind a secret token; keep it that way only for the phone.
- **Never trust names from the other side.** Paths go through `files.safeRel()`; nothing is written outside `.beam-incoming/<tid>` until finish moves it, and moves never overwrite (`uniquePath`).
- **Trust is id + key.** A trusted device whose key changes is treated as untrusted and flagged (`keyChanged`).
- The window never touches Node; everything goes through `window.beam.call(...)` → the `api` table in `src/main.js`.
- Settings, identity and history are JSON in `app.getPath('userData')`; received files go to the receive folder (default `~/Downloads/Beam`).

## Utility Suite link (0.1.3)

Beam now offers a few things to other suite apps (Atoll's add-ons) over the **Utility Suite link**: `src/suitelink.js`, a copy of `tools/suitelink.js` in the Utility Package. Keep it identical to that file; the Utility Package chat owns it. It's a Unix socket in `~/Library/Application Support/Utility Suite/link` (mode 0600) on a Mac and a per-user named pipe on Windows, so only this user's apps can reach it. Everything is in `src/main.js` under "Utility Suite link".

- Offers: `peers`, `transfers`, `send(peerId, paths)`, `sendText(peerId, text)`, `open`; events `peers` and `transfers` (at most twice a second).
- Nothing changes when no other app is connected: events are only sent while something is listening.
- If you rename or remove one of these, tell the Utility Package chat so Atoll keeps working.
