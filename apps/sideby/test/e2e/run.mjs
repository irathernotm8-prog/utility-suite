// Two-copy end-to-end test: launches two Sideby instances with separate
// profiles, connects them through a local relay, and checks sync, chat,
// broadcast and host handoff. Needs ffmpeg (to make a test video).
//   npm run test:e2e            (on Linux CI: xvfb-run -a npm run test:e2e)
//   SIGNAL=public npm run test:e2e   uses the real public Nostr relays instead
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import { startSites } from './sites.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(here, '../..');
const require = createRequire(path.join(APP, 'package.json'));
const ELECTRON = require('electron');
const OUT = path.join(os.tmpdir(), 'sideby-e2e');
fs.mkdirSync(OUT, { recursive: true });
const media = path.join(OUT, 'test.mp4');
if (!fs.existsSync(media)) execSync(`ffmpeg -loglevel error -f lavfi -i testsrc2=size=640x360:rate=30 -f lavfi -i sine=frequency=440 -t 120 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "${media}" -y`);
const stopSites = startSites(media);
const { createWsRelayServer } = await import(path.join(APP, 'node_modules/@trystero-p2p/ws-relay/dist/server.mjs'));
const relay = createWsRelayServer({ port: 8787 });
const grab = name => { if (process.platform === 'linux') try { execSync(`import -window root "${path.join(OUT, name)}"`); } catch {} };
const CODE = process.env.CODE || 'K7QM2X9PD';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const appData = process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Application Support') : process.platform === 'win32' ? process.env.APPDATA : path.join(os.homedir(), '.config');
function seed(profile, name, color) {
  profile = `e2e-${profile}`;
  const dir = path.join(appData, `Sideby-${profile}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
    profile: { name, color }, personalCode: profile === 'e2e-a' ? CODE : null, adblock: process.env.ADBLOCK === '1',
    signaling: process.env.SIGNAL === 'public' ? { kind: 'public', urls: [] } : { kind: 'relay', urls: ['ws://127.0.0.1:8787'] }, onboarded: true
  }));
}

let port = 9230;
async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const listeners = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else listeners.forEach(l => l(m)); };
  const call = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  return { call, on: fn => listeners.push(fn), close: () => ws.close() };
}
async function launch(profile) {
  const myPort = port++;
  const proc = spawn(ELECTRON, [...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []), `--remote-debugging-port=${myPort}`, ...(process.env.SIGNAL === 'public' ? [`--proxy-server=${process.env.HTTPS_PROXY}`] : []), APP], {
    env: { ...process.env, SIDEBY_PROFILE: `e2e-${profile}` }, stdio: ['ignore', 'pipe', 'pipe']
  });
  const log = fs.createWriteStream(path.join(OUT, `electron-${profile}.log`));
  proc.stdout.pipe(log); proc.stderr.pipe(log);
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(500);
    try { target = (await (await fetch(`http://127.0.0.1:${myPort}/json/list`)).json()).find(t => t.url.startsWith('sideby-app://')); } catch {}
  }
  const c = await cdp(target.webSocketDebuggerUrl);
  await c.call('Runtime.enable');
  c.on(m => {
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) console.log(`[${profile}] ${m.params.type}: ${m.params.args.map(a => a.value ?? a.description).join(' ')}`);
    if (m.method === 'Runtime.exceptionThrown') console.log(`[${profile}] EXCEPTION ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
  });
  const win = {
    async evaluate(fn, arg) {
      const r = await c.call('Runtime.evaluate', { expression: `(${fn})(${JSON.stringify(arg ?? null)})`, awaitPromise: true, returnByValue: true, userGesture: true });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed');
      return r.result?.result?.value;
    },
    async screenshot({ path: file }) { const r = await c.call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(r.result.data, 'base64')); }
  };
  for (let i = 0; i < 30 && !(await win.evaluate(() => !!window.__sideby)); i++) await sleep(300);
  return { app: { close: async () => { c.close(); proc.kill(); } }, win };
}
const S = (win, fn, arg) => win.evaluate(fn, arg);

seed('a', 'Bilal', '#D4F08A');
seed('b', 'Kiana', '#F0A58A');
const A = await launch('a');
const B = await launch('b');
await A.win.screenshot({ path: path.join(OUT, 'shot-home.png') });

await S(A.win, code => window.__sideby.enterRoom(code, { asHost: true, personal: true }), CODE);
await sleep(500);
await S(B.win, code => window.__sideby.enterRoom(code, { asHost: false }), CODE);

// wait for connection
let connected = false;
for (let i = 0; i < 40 && !connected; i++) {
  await sleep(500);
  connected = await S(B.win, () => { const s = window.__sideby.session; return !!s && s.core.hostId && !s.core.isHost && s.core.members.size === 1; });
}
check('guest connects to host over WebRTC', connected);
check('host sees guest name', await S(A.win, () => [...window.__sideby.session.core.members.values()].map(m => m.name).join()) === 'Kiana');

// host opens a page with a cross-origin iframe player
await S(A.win, () => window.__sideby.session.goTo('http://127.0.0.1:9101/framed'));
await sleep(4000);
const hostVideo = await S(A.win, () => window.__sideby.session.local);
check('host detects video inside cross-origin iframe', !!hostVideo && hostVideo.duration > 100, JSON.stringify(hostVideo && { t: hostVideo.t, paused: hostVideo.paused, d: hostVideo.duration }));
const guestUrl = await S(B.win, () => window.__sideby.session.loadedHostUrl);
check('guest follows host to the same page', guestUrl === 'http://127.0.0.1:9101/framed', guestUrl);

// play on host and let sync settle
await S(A.win, () => { const s = window.__sideby.session; if (s.local?.paused) s.togglePlay(); });
await sleep(1500);
await S(A.win, () => window.__sideby.session.seekTo(40));
await sleep(5000);
// Each copy's position projected to "now", so report timing doesn't skew comparisons.
const now = win => S(win, () => { const l = window.__sideby.session.local; if (!l) return null; return { ...l, t: l.paused ? l.t : l.t + (Date.now() - l.receivedAt) / 1000 * (l.rate || 1) }; });
const pos = async () => Promise.all([now(A.win), now(B.win)]);
let [a, b] = await pos();
check('both playing', a && b && !a.paused && !b.paused, `host paused=${a?.paused} guest paused=${b?.paused}`);
check('positions within 0.5s after host seek', a && b && Math.abs(a.t - b.t) < 0.5, `host ${a?.t?.toFixed(2)} guest ${b?.t?.toFixed(2)} status=${await S(B.win, () => window.__sideby.session.syncStatus)}`);
await A.win.screenshot({ path: path.join(OUT, 'shot-host.png') });
await B.win.screenshot({ path: path.join(OUT, 'shot-guest.png') });
await S(A.win, () => window.__sideby.session.core.react('🔥'));
await sleep(700);
grab('screen-guest-sync.png');

// guest pauses via Sideby control -> host pauses
await S(B.win, () => window.__sideby.session.togglePlay());
await sleep(2000);
[a, b] = await pos();
check('guest pause reaches host', a?.paused && b?.paused, `host paused=${a?.paused} guest paused=${b?.paused}`);
check('positions match while paused', a && b && Math.abs(a.t - b.t) < 0.4, `${a?.t?.toFixed(2)} vs ${b?.t?.toFixed(2)}`);
const activity = await S(B.win, () => [...document.querySelectorAll('.msg.activity')].map(x => x.textContent));
check('activity line shown', activity.some(t => /paused/.test(t)), activity.join(' | '));

// guest seeks
await S(B.win, () => window.__sideby.session.seekTo(80));
await S(A.win, () => window.__sideby.session.togglePlay());
await sleep(4000);
[a, b] = await pos();
check('guest seek + host play stays in sync', a && b && !a.paused && Math.abs(a.t - b.t) < 0.5 && a.t > 79, `${a?.t?.toFixed(2)} vs ${b?.t?.toFixed(2)}`);

// drift recovery: desync guest locally
await B.win.evaluate(() => window.sideby.stage.apply({ seek: 10 }));
await sleep(3500);
[a, b] = await pos();
check('guest snaps back after local drift', a && b && Math.abs(a.t - b.t) < 0.6, `${a?.t?.toFixed(2)} vs ${b?.t?.toFixed(2)}`);

// chat + reactions
await S(B.win, () => window.__sideby.session.core.chat('hi from Kiana https://example.com'));
await sleep(800);
const chatA = await S(A.win, () => [...document.querySelectorAll('.msg .text')].map(x => x.textContent));
check('chat arrives', chatA.some(t => t.includes('hi from Kiana')), chatA.join(' | '));

// guest navigates by themselves -> unfollow simulated via host nav instead: host goes to direct video page
await S(A.win, () => window.__sideby.session.goTo('http://127.0.0.1:9101/'));
await sleep(4000);
check('guest follows host navigation', await S(B.win, () => window.__sideby.session.loadedHostUrl) === 'http://127.0.0.1:9101/');

// media URL opens built-in player
await S(A.win, () => window.__sideby.session.goTo('http://127.0.0.1:9101/test.mp4'));
await sleep(4000);
const hostUrl = await S(A.win, () => window.__sideby.session.nav.url);
check('direct media opens built-in player', /^sideby-media:\/\/player/.test(hostUrl), hostUrl);
[a, b] = await pos();
check('built-in player syncs', a && b && Math.abs(a.t - b.t) < 0.6, `${a?.t?.toFixed(2)} vs ${b?.t?.toFixed(2)}`);

// broadcast the stage
await S(A.win, () => window.__sideby.session.startBroadcast('stage'));
await sleep(5000);
const bc = await S(B.win, () => { const v = document.getElementById('stage-video'); return { hidden: v.hidden, w: v.videoWidth, h: v.videoHeight, tracks: v.srcObject?.getTracks().map(t => t.kind).join(), mode: window.__sideby.session.core.state.mode }; });
check('guest receives broadcast with video+audio', !bc.hidden && bc.w > 0 && /video/.test(bc.tracks) && /audio/.test(bc.tracks || ''), JSON.stringify(bc));
await sleep(8000);
console.log('broadcast stats:', await S(B.win, () => document.getElementById('stream-stats').textContent));
grab('screen-guest-broadcast.png');
await S(A.win, () => window.__sideby.session.stopBroadcast());
await sleep(2500);
check('broadcast stops cleanly', await S(B.win, () => window.__sideby.session.core.state.mode) === 'browse');

// host leaves -> guest becomes host
await S(A.win, () => window.__sideby.leaveRoom());
await sleep(3000);
check('guest becomes host when host leaves', await S(B.win, () => window.__sideby.session.core.isHost));
await B.win.screenshot({ path: path.join(OUT, 'shot-guest-host.png') });

await A.app.close(); await B.app.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
stopSites(); relay.close?.();
console.log(`Screenshots and logs: ${OUT}`);
process.exit(failed ? 1 : 0);
