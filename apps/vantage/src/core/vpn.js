// Vantage — built-in VPN for the browser's own traffic.
//   • Cloudflare WARP: one click, free. Vantage registers a WARP device the way Cloudflare's own app does.
//   • WireGuard: import a .conf from any provider (Proton VPN, Mullvad, IVPN, your own server).
//   • Proxy: SOCKS5 / HTTP(S) proxy you already have.
// WireGuard runs in user space through wireproxy (github.com/whyvl/wireproxy, ISC licence), downloaded once
// into the app-data folder. It exposes a local SOCKS5 port; every Vantage session is pointed at it, so only
// Vantage's traffic goes through the tunnel (no system extension, no admin rights). Hostnames are resolved
// at the far end of the tunnel. If the tunnel drops while the kill switch is on, pages stop loading instead
// of leaking out unprotected.
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { app, session, safeStorage, webContents } = require('electron');

let store = null, notify = () => {}, sessions = () => [];
let proc = null, port = 0, restarts = 0, stopping = false;
const state = { mode: 'off', status: 'off', error: '', ip: '', loc: '', colo: '', warp: '', since: 0, progress: '' };

const dir = () => path.join(app.getPath('userData'), 'vpn');
const binDir = () => path.join(app.getPath('userData'), 'bin');
const exe = () => path.join(binDir(), process.platform === 'win32' ? 'wireproxy.exe' : 'wireproxy');
const cfg = () => store.settings().vpn;
// Vantage's own requests (setting up WARP, fetching the engine) go direct, never through the tunnel being built
const control = () => session.fromPartition('vantage-control');
const set = (patch) => { Object.assign(state, patch); notify({ ...state }); };

/* ---------- secrets (WireGuard private keys never sit on disk in plain text) ---------- */
function seal(text) {
  if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(text).toString('base64');
  return 'b64:' + Buffer.from(text).toString('base64');
}
function unseal(v) {
  if (!v) return '';
  try { return unsealRaw(v); } catch (e) { console.error('vpn: stored secret unreadable', e.message); return ''; }
}
function unsealRaw(v) {
  if (v.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'));
  if (v.startsWith('b64:')) return Buffer.from(v.slice(4), 'base64').toString();
  return v;
}
const secrets = () => (store.get().secrets = store.get().secrets || {});

/* ---------- WireGuard config ---------- */
function parseConf(text) {
  const out = { iface: {}, peers: [] }; let sec = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/[#;].*$/, '').trim();
    if (!line) continue;
    const m = /^\[(\w+)\]$/.exec(line);
    if (m) { sec = m[1].toLowerCase(); if (sec === 'peer') out.peers.push({}); continue; }
    const kv = /^([A-Za-z0-9]+)\s*=\s*(.+)$/.exec(line);
    if (!kv) continue;
    const target = sec === 'interface' ? out.iface : sec === 'peer' ? out.peers[out.peers.length - 1] : null;
    if (target) target[kv[1].toLowerCase()] = kv[2].trim();
  }
  if (!out.iface.privatekey) throw new Error('This doesn’t look like a WireGuard config (no PrivateKey in [Interface])');
  if (!out.iface.address) throw new Error('The config has no Address in [Interface]');
  if (!out.peers.length || !out.peers[0].publickey || !out.peers[0].endpoint) throw new Error('The config needs a [Peer] with PublicKey and Endpoint');
  return out;
}
function proxyConf(parsed, socksPort) {
  const i = parsed.iface;
  const lines = ['[Interface]', `PrivateKey = ${i.privatekey}`, `Address = ${i.address}`, `DNS = ${i.dns || '1.1.1.1'}`];
  if (i.mtu) lines.push(`MTU = ${i.mtu}`);
  for (const p of parsed.peers) {
    lines.push('', '[Peer]', `PublicKey = ${p.publickey}`, `Endpoint = ${p.endpoint}`, `AllowedIPs = ${p.allowedips || '0.0.0.0/0, ::/0'}`);
    if (p.presharedkey) lines.push(`PresharedKey = ${p.presharedkey}`);
    lines.push(`PersistentKeepalive = ${p.persistentkeepalive || 25}`);
  }
  lines.push('', '[Socks5]', `BindAddress = 127.0.0.1:${socksPort}`);
  return lines.join('\n') + '\n';
}

/* ---------- Cloudflare WARP (free) ---------- */
function keypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  return {
    pub: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64'),
    priv: privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('base64')
  };
}
async function registerWarp() {
  const { pub, priv } = keypair();
  const body = { key: pub, install_id: '', fcm_token: '', tos: new Date().toISOString(), model: 'PC', serial_number: crypto.randomUUID(), locale: 'en_US' };
  let lastErr = null;
  for (const v of ['v0a2158', 'v0a1922', 'v0a977']) {
    try {
      const r = await control().fetch(`https://api.cloudflareclient.com/${v}/reg`, {
        method: 'POST', body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json; charset=UTF-8', 'User-Agent': 'okhttp/3.12.1', 'CF-Client-Version': 'a-6.10-2158' }
      });
      if (!r.ok) { lastErr = new Error(`Cloudflare answered ${r.status}`); continue; }
      const j = await r.json();
      const res = j.result || j;
      const c = res.config;
      const peer = c.peers[0];
      const a = c.interface.addresses;
      const endpoint = peer.endpoint.host || `${peer.endpoint.v4.replace(/:0$/, '')}:2408`;
      return [
        '[Interface]', `PrivateKey = ${priv}`, `Address = ${a.v4}/32${a.v6 ? `, ${a.v6}/128` : ''}`, 'DNS = 1.1.1.1, 1.0.0.1', 'MTU = 1280', '',
        '[Peer]', `PublicKey = ${peer.public_key}`, 'AllowedIPs = 0.0.0.0/0, ::/0', `Endpoint = ${endpoint}`
      ].join('\n');
    } catch (e) { lastErr = e; }
  }
  throw new Error('Couldn’t set up Cloudflare WARP' + (lastErr ? ` (${lastErr.message})` : '') + '. You can import a WireGuard config instead.');
}

/* ---------- wireproxy (downloaded once) ---------- */
function assetName() {
  const osn = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  return `wireproxy_${osn}_${arch}.tar.gz`;
}
async function ensureEngine() {
  if (fs.existsSync(exe())) return exe();
  set({ progress: 'Downloading the VPN engine…' });
  fs.mkdirSync(binDir(), { recursive: true });
  const rel = await (await control().fetch('https://api.github.com/repos/whyvl/wireproxy/releases/latest', { headers: { 'User-Agent': 'Vantage', Accept: 'application/vnd.github+json' } })).json();
  const asset = (rel.assets || []).find(a => a.name === assetName());
  if (!asset) throw new Error(`No VPN engine is published for this computer (${assetName()})`);
  const r = await control().fetch(asset.browser_download_url);
  if (!r.ok) throw new Error('Couldn’t download the VPN engine (' + r.status + ')');
  const tmp = path.join(binDir(), asset.name);
  fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
  await new Promise((res, rej) => execFile('tar', ['-xzf', tmp, '-C', binDir()], (e) => e ? rej(e) : res()));
  try { fs.unlinkSync(tmp); } catch {}
  if (!fs.existsSync(exe())) {
    // some releases put it in a folder
    const found = findFile(binDir(), path.basename(exe()));
    if (found) fs.renameSync(found, exe()); else throw new Error('The VPN engine download was incomplete');
  }
  if (process.platform !== 'win32') fs.chmodSync(exe(), 0o755);
  set({ progress: '' });
  return exe();
}
function findFile(d, name, depth = 0) {
  if (depth > 3) return null;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isFile() && e.name === name) return p;
    if (e.isDirectory()) { const f = findFile(p, name, depth + 1); if (f) return f; }
  }
  return null;
}
function freePort() {
  return new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });
}
function waitPort(p, ms = 15000) {
  const until = Date.now() + ms;
  return new Promise((res, rej) => {
    const tryOnce = () => {
      const c = net.connect(p, '127.0.0.1');
      c.once('connect', () => { c.destroy(); res(); });
      c.once('error', () => { c.destroy(); if (Date.now() > until) rej(new Error('The VPN engine didn’t start')); else setTimeout(tryOnce, 250); });
    };
    tryOnce();
  });
}

/* ---------- routing ---------- */
let currentRules = null;
async function route(rules) {
  currentRules = rules;
  for (const ses of sessions()) {
    try { await ses.setProxy(rules ? { proxyRules: rules, proxyBypassRules: '<local>' } : { mode: 'direct' }); await ses.closeAllConnections?.(); } catch (e) { console.error('proxy', e.message); }
  }
  applyWebRTC();
}
function protectedNow() { return state.mode !== 'off' && cfg().webrtc !== false; }
function applyWebRTC(wc) {
  const list = wc ? [wc] : webContents.getAllWebContents().filter(w => w.getType() === 'webview' || w.getType() === 'window');
  for (const w of list) { try { w.setWebRTCIPHandlingPolicy(protectedNow() ? 'disable_non_proxied_udp' : 'default'); } catch {} }
}
const BLACKHOLE = 'socks5://127.0.0.1:9';

async function check() {
  const ses = sessions()[0];
  if (!ses) return;
  try {
    const r = await ses.fetch('https://www.cloudflare.com/cdn-cgi/trace', { cache: 'no-store' });
    const t = await r.text();
    const kv = Object.fromEntries(t.trim().split('\n').map(l => l.split('=')));
    set({ ip: kv.ip || '', loc: kv.loc || '', colo: kv.colo || '', warp: kv.warp || '' });
  } catch (e) { set({ ip: '', loc: '', error: state.status === 'on' ? 'Connected, but the test page didn’t load: ' + e.message : state.error }); }
}

/* ---------- connect / disconnect ---------- */
async function connect(mode = cfg().mode) {
  await disconnect(true);
  stopping = false;
  set({ mode, status: 'connecting', error: '', ip: '', loc: '', progress: '' });
  cfg().mode = mode; cfg().lastMode = mode; store.save();
  try {
    if (mode === 'proxy') {
      const p = cfg().proxy || {};
      if (!p.host || !p.port) throw new Error('Add the proxy’s address and port first');
      await route(`${p.type || 'socks5'}://${p.host}:${p.port}`);
    } else {
      let conf;
      if (mode === 'warp') {
        conf = unseal(secrets().warp);
        if (!conf) { set({ progress: 'Setting up Cloudflare WARP…' }); conf = await registerWarp(); secrets().warp = seal(conf); store.save(); }
      } else {
        conf = unseal(secrets().wireguard);
        if (!conf) throw new Error('Import a WireGuard config first');
      }
      const parsed = parseConf(conf);
      await ensureEngine();
      port = await freePort();
      fs.mkdirSync(dir(), { recursive: true, mode: 0o700 });
      const confPath = path.join(dir(), 'tunnel.conf');
      fs.writeFileSync(confPath, proxyConf(parsed, port), { mode: 0o600 });
      set({ progress: 'Connecting…' });
      startEngine(confPath);
      await waitPort(port);
      await route(`socks5://127.0.0.1:${port}`);
      // the config file holds the private key: remove it once the engine has read it
      if (!process.env.VANTAGE_DEBUG) setTimeout(() => { try { fs.unlinkSync(confPath); } catch {} }, 1500);
    }
    restarts = 0;
    set({ status: 'on', since: Date.now(), progress: 'Checking the connection…' });
    // the first handshake can take a moment: try the test page a few times before reporting a problem
    for (let i = 0; i < 4; i++) { set({ error: '' }); await check(); if (state.ip) break; await new Promise(r => setTimeout(r, 1500)); }
    set({ progress: '' });
  } catch (e) {
    set({ status: 'error', error: e.message, progress: '' });
    if (cfg().killSwitch !== false) await route(BLACKHOLE); else await route(null);
  }
  return { ...state };
}
function startEngine(confPath) {
  proc = spawn(exe(), ['-c', confPath], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let tail = '';
  const grab = (d) => { tail = (tail + d.toString()).slice(-2000); if (process.env.VANTAGE_DEBUG) console.log('[wireproxy]', d.toString().trim()); };
  proc.stdout.on('data', grab); proc.stderr.on('data', grab);
  proc.on('exit', async (code) => {
    proc = null;
    if (stopping) return;
    console.error('wireproxy exited', code, tail.slice(-400));
    if (cfg().killSwitch !== false) await route(BLACKHOLE);
    if (restarts < 3 && state.mode !== 'off') {
      restarts++;
      set({ status: 'connecting', error: 'Tunnel dropped, reconnecting…' });
      setTimeout(() => connect(state.mode), 1500 * restarts);
    } else set({ status: 'error', error: 'The tunnel stopped. ' + (cfg().killSwitch !== false ? 'Pages are blocked until you reconnect or turn the VPN off.' : '') });
  });
}
async function disconnect(quiet = false) {
  stopping = true;
  if (proc) { try { proc.kill(); } catch {} proc = null; }
  // while switching tunnels, the kill switch keeps pages from going out unprotected
  await route(quiet && cfg().killSwitch !== false ? BLACKHOLE : null);
  if (!quiet) { cfg().mode = 'off'; store.save(); set({ mode: 'off', status: 'off', error: '', ip: '', loc: '', since: 0 }); check(); }
}

async function importWireGuard(text, name) {
  parseConf(text);  // throws if invalid
  secrets().wireguard = seal(text);
  cfg().wireguardName = name || 'WireGuard';
  store.save();
  return true;
}
function resetWarp() { delete secrets().warp; store.save(); }

function init(s, { onState, getSessions }) {
  store = s; notify = onState || notify; sessions = getSessions || sessions;
  const m = cfg().mode;
  if (m && m !== 'off') connect(m);   // reconnect at launch, so nothing leaks before it's up
  else check();
}

module.exports = {
  applyTo: (ses) => { if (!store) return; if (currentRules || (cfg().mode !== 'off' && cfg().killSwitch !== false)) ses.setProxy({ proxyRules: currentRules || BLACKHOLE, proxyBypassRules: '<local>' }).catch(() => {}); },
  init, connect, disconnect, check, importWireGuard, resetWarp, applyWebRTC,
  state: () => ({ ...state, hasWireGuard: !!secrets().wireguard, wireguardName: cfg().wireguardName || '', hasWarp: !!secrets().warp }),
  proxyAuth: () => { const p = cfg().proxy || {}; return p.user ? { user: p.user, pass: unseal(secrets().proxyPass) } : null; },
  setProxyPassword: (pw) => { if (pw) secrets().proxyPass = seal(pw); else delete secrets().proxyPass; store.save(); },
  stop: () => { stopping = true; if (proc) try { proc.kill(); } catch {} },
  _test: { parseConf, proxyConf, keypair }
};
