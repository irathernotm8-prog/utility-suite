// Cadence — the Use an app step. Finds apps on this computer, opens them, and for apps built on Electron or
// Chromium (every Utility Suite app, Slack, Notion, VS Code, Chrome…) connects to the window over a private
// debugging port on 127.0.0.1 so the same actions as the Browser step work inside it: click "Last 7 days" in
// Lumen, copy its KPI cards and campaign table, screenshot a chart. Any other app gets shortcuts, menus,
// typing and the clipboard (native.js).
'use strict';
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { runActions, sleep, withTimeout } = require('./actions');
const { Native, IS_MAC, IS_WIN } = require('./native');

const SUITE = ['Assist', 'Atoll', 'Beam', 'Cadence', 'Crate', 'Datum', 'Decomp', 'Docket', 'Droid', 'Facet', 'Fresh Desk', 'Glean', 'Kiln', 'Lumen', 'Onward', 'RO3', 'Relay', 'Scene', 'Sideby', 'Slate', 'Touchline', 'Trace', 'Utility Hub', 'Vitals', 'Waypoint'];
const CHROMIUM_MAC = ['Google Chrome Framework.framework', 'Microsoft Edge Framework.framework', 'Brave Browser Framework.framework', 'Chromium Framework.framework', 'Arc Framework.framework', 'Vivaldi Framework.framework'];

// ───────── finding apps
function macApp(appPath) {
  const name = path.basename(appPath, '.app');
  const contents = path.join(appPath, 'Contents');
  let exe = name;
  try { const pl = fs.readFileSync(path.join(contents, 'Info.plist'), 'utf8'); const m = /<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/.exec(pl); if (m) exe = m[1]; } catch {}
  const fw = path.join(contents, 'Frameworks');
  const electron = fs.existsSync(path.join(fw, 'Electron Framework.framework'));
  const chromium = !electron && CHROMIUM_MAC.some((f) => fs.existsSync(path.join(fw, f)));
  return { name, path: appPath, exec: path.join(contents, 'MacOS', exe), process: exe, kind: electron ? 'electron' : chromium ? 'chromium' : 'native', suite: SUITE.includes(name) };
}
function winApp(exe, name) {
  const dir = path.dirname(exe);
  const electron = fs.existsSync(path.join(dir, 'resources', 'app.asar')) || fs.existsSync(path.join(dir, 'resources', 'app'));
  const chromium = !electron && /chrome|msedge|brave|vivaldi/i.test(path.basename(exe));
  return { name: name || path.basename(exe, '.exe'), path: exe, exec: exe, process: path.basename(exe, '.exe'), kind: electron ? 'electron' : chromium ? 'chromium' : 'native', suite: SUITE.includes(name || path.basename(exe, '.exe')) };
}
let cache = null;
function listApps({ fresh = false } = {}) {
  if (cache && !fresh && Date.now() - cache.t < 60000) return cache.list;
  const out = new Map();
  const add = (a) => { if (a && !out.has(a.name.toLowerCase())) out.set(a.name.toLowerCase(), a); };
  // test / development hook: CADENCE_APPS='[{"name":"Lumen","exec":"/path/electron","args":["/path/lumen"],"kind":"electron"}]'
  if (process.env.CADENCE_APPS) { try { for (const a of JSON.parse(process.env.CADENCE_APPS)) add({ suite: SUITE.includes(a.name), path: a.exec, process: path.basename(a.exec), kind: 'electron', ...a }); } catch {} }
  if (IS_MAC) {
    for (const dir of ['/Applications', path.join(os.homedir(), 'Applications'), '/System/Applications', '/Applications/Utilities', '/System/Applications/Utilities']) {
      let ents = []; try { ents = fs.readdirSync(dir); } catch {}
      for (const e of ents) if (e.endsWith('.app')) { try { add(macApp(path.join(dir, e))); } catch {} }
    }
  } else if (IS_WIN) {
    const la = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const suiteRoot = path.join(la, 'Programs', 'Utility Suite');
    for (const n of safeDir(suiteRoot)) { const exe = path.join(suiteRoot, n, `${n}.exe`); if (fs.existsSync(exe)) add(winApp(exe, n)); }
    const roots = [path.join(la, 'Programs'), la, process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);
    for (const root of roots) for (const n of safeDir(root)) {
      if (n === 'Utility Suite' || /^(Microsoft|Windows|Common Files|Temp|Packages|Google)$/i.test(n)) continue;
      const dir = path.join(root, n);
      const exes = safeDir(dir).filter((f) => /\.exe$/i.test(f) && !/unins|update|helper|crash|setup|installer/i.test(f));
      const pick = exes.find((f) => f.toLowerCase() === n.toLowerCase() + '.exe') || (exes.length === 1 ? exes[0] : null);
      if (pick) add(winApp(path.join(dir, pick), n));
    }
    for (const [n, p] of [['Google Chrome', path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe')], ['Microsoft Edge', path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe')], ['Excel', path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft Office', 'root', 'Office16', 'EXCEL.EXE')], ['PowerPoint', path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft Office', 'root', 'Office16', 'POWERPNT.EXE')]]) if (fs.existsSync(p)) add(winApp(p, n));
  }
  const list = [...out.values()].sort((a, b) => (b.suite - a.suite) || a.name.localeCompare(b.name));
  cache = { t: Date.now(), list };
  return list;
}
function safeDir(d) { try { return fs.readdirSync(d); } catch { return []; } }
function findApp(spec) {
  if (!spec) throw new Error('Choose an app');
  const s = String(spec).trim();
  if (fs.existsSync(s)) return IS_MAC && s.endsWith('.app') ? macApp(s) : IS_WIN && /\.exe$/i.test(s) ? winApp(s) : { name: path.basename(s), path: s, exec: s, process: path.basename(s), kind: 'native' };
  const list = listApps();
  const hit = list.find((a) => a.name.toLowerCase() === s.toLowerCase()) || listApps({ fresh: true }).find((a) => a.name.toLowerCase() === s.toLowerCase());
  if (!hit) throw new Error(`Couldn’t find “${s}” on this computer. ${IS_MAC ? 'Is it in Applications?' : 'Install it, or pick its .exe with Browse.'}`);
  return hit;
}

// ───────── processes
const execP = (bin, args) => new Promise((res) => execFile(bin, args, { windowsHide: true, timeout: 15000, maxBuffer: 8 << 20 }, (e, out) => res(e ? '' : String(out))));
async function pids(app) {
  if (app.args) return [...launched.values()].filter((l) => l.app.name === app.name && alive(l.pid)).map((l) => l.pid);
  if (IS_MAC || process.platform === 'linux') { const out = await execP('ps', ['-axo', 'pid=,command=']); return out.split('\n').map((l) => l.trim()).filter((l) => l.includes(app.exec) && !/--type=/.test(l)).map((l) => +l.split(/\s+/)[0]).filter(Boolean); }
  if (IS_WIN) { const out = await execP('powershell.exe', ['-NoProfile', '-Command', `Get-Process | Where-Object { $_.Path -eq '${String(app.exec).replace(/'/g, "''")}' } | ForEach-Object { $_.Id }`]); return out.split(/\s+/).map(Number).filter(Boolean); }
  return [];
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function quit(app, { force = false } = {}) {
  let list = await pids(app); if (!list.length) return;
  if (!force) {
    if (IS_MAC && !app.args) await execP('osascript', ['-e', `tell application "${String(app.path).replace(/"/g, '\\"')}" to quit`]);
    else if (IS_WIN && !app.args) await execP('taskkill', ['/IM', path.basename(app.exec)]);
    else for (const p of list) { try { process.kill(p, 'SIGTERM'); } catch {} }
    for (let i = 0; i < 40 && (await pids(app)).length; i++) await sleep(250);
    list = await pids(app);
  }
  for (const p of list) { try { if (IS_WIN) await execP('taskkill', ['/PID', String(p), '/T', '/F']); else process.kill(p, 'SIGKILL'); } catch {} }
  for (let i = 0; i < 20 && (await pids(app)).length; i++) await sleep(150);
}
function freePort() { return new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); }); }
async function getJSON(url, ms = 1500) { const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms); try { const r = await fetch(url, { signal: ctl.signal }); return await r.json(); } finally { clearTimeout(t); } }

const launched = new Map(); // app name → { port, pid, app }

async function launch(app, { control, file, restart = true, log = () => {} }) {
  const args = [...(app.args || [])];
  if (!control) {
    if (IS_MAC && !app.args) { await execP('open', ['-a', app.path, ...(file ? [file] : [])]); return { started: true }; }
    const env = { ...process.env, ...(app.env || {}) }; delete env.ELECTRON_RUN_AS_NODE;
    const ch = spawn(app.exec, [...args, ...(file ? [file] : [])], { detached: true, stdio: 'ignore', env }); ch.unref(); return { started: true, pid: ch.pid };
  }
  if (app.kind === 'native') throw new Error(`${app.name} isn’t built on Electron or Chromium, so Cadence can’t read inside it. Choose “Use keyboard and menus” for it instead.`);
  const known = launched.get(app.name);
  if (known && alive(known.pid)) { try { await getJSON(`http://127.0.0.1:${known.port}/json/version`); return { port: known.port, reused: true, wasRunning: known.wasRunning }; } catch {} }
  const running = (await pids(app)).length > 0;
  if (running) {
    if (!restart) throw new Error(`${app.name} is already open. Cadence needs to restart it once to read inside it — switch on “Restart it if it’s open”, or quit it first.`);
    log(`Restarting ${app.name} so Cadence can read inside it…`);
    await quit(app);
  }
  const port = await freePort();
  const userArgs = [`--remote-debugging-port=${port}`, '--remote-allow-origins=*', ...(app.kind === 'chromium' ? ['--no-first-run', '--no-default-browser-check'] : [])];
  const env = { ...process.env, ...(app.env || {}) }; delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_ENABLE_LOGGING;
  const ch = spawn(app.exec, [...args, ...userArgs, ...(file ? [file] : [])], { detached: true, stdio: 'ignore', env });
  ch.unref();
  launched.set(app.name, { port, pid: ch.pid, app, wasRunning: running });
  for (let i = 0; i < 120; i++) { try { await getJSON(`http://127.0.0.1:${port}/json/version`, 800); return { port, wasRunning: running }; } catch {} await sleep(250); }
  throw new Error(`${app.name} opened but didn’t accept Cadence’s connection. Some apps switch this off; use “Use keyboard and menus” for it instead.`);
}

// ───────── a tiny Chrome DevTools Protocol client (Node's built-in WebSocket)
class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.wait = new Map(); this.handlers = new Map(); this.closed = false; }
  open() {
    return new Promise((res, rej) => {
      const ws = new WebSocket(this.url); this.ws = ws;
      ws.onopen = () => res(this);
      ws.onerror = (e) => rej(new Error('Couldn’t connect to the app window: ' + (e.message || 'socket error')));
      ws.onclose = () => { this.closed = true; for (const [, w] of this.wait) w.rej(new Error('The app window closed')); this.wait.clear(); };
      ws.onmessage = (m) => { const d = JSON.parse(typeof m.data === 'string' ? m.data : Buffer.from(m.data).toString()); if (d.id && this.wait.has(d.id)) { const w = this.wait.get(d.id); this.wait.delete(d.id); d.error ? w.rej(new Error(d.error.message)) : w.res(d.result); } else if (d.method) (this.handlers.get(d.method) || []).forEach((f) => f(d.params)); };
    });
  }
  send(method, params = {}, ms = 60000) {
    if (this.closed) return Promise.reject(new Error('The app window closed'));
    const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => { const t = setTimeout(() => { this.wait.delete(id); rej(new Error(`${method} timed out`)); }, ms); this.wait.set(id, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } }); });
  }
  on(method, fn) { if (!this.handlers.has(method)) this.handlers.set(method, []); this.handlers.get(method).push(fn); return () => this.handlers.set(method, this.handlers.get(method).filter((x) => x !== fn)); }
  close() { try { this.ws.close(); } catch {} }
}
async function pageTarget(port, windowTitle, timeoutMs = 20000) {
  const t0 = Date.now(); let last = [];
  while (Date.now() - t0 < timeoutMs) {
    try {
      last = (await getJSON(`http://127.0.0.1:${port}/json/list`)).filter((t) => t.type === 'page' && !/^devtools:|^chrome-extension:/.test(t.url));
      const want = windowTitle ? last.filter((t) => (t.title || '').toLowerCase().includes(String(windowTitle).toLowerCase()) || t.url.toLowerCase().includes(String(windowTitle).toLowerCase())) : last;
      const pick = want.find((t) => t.url && t.url !== 'about:blank') || want[0];
      if (pick) return pick;
    } catch {}
    await sleep(300);
  }
  throw new Error(windowTitle ? `No window matching “${windowTitle}”. Windows: ${last.map((t) => t.title || t.url).join(', ') || 'none'}` : 'The app has no window yet');
}
async function cdpDriver(port, { windowTitle, dir } = {}) {
  const target = await pageTarget(port, windowTitle);
  const page = await new Cdp(target.webSocketDebuggerUrl).open();
  const ver = await getJSON(`http://127.0.0.1:${port}/json/version`);
  let browser = null;
  try { browser = await new Cdp(ver.webSocketDebuggerUrl).open(); } catch {}
  await page.send('Runtime.enable').catch(() => {}); await page.send('Page.enable').catch(() => {});
  await page.send('Page.setBypassCSP', { enabled: true }).catch(() => {});
  let loading = false; page.on('Page.frameStartedLoading', () => { loading = true; }); page.on('Page.frameStoppedLoading', () => { loading = false; });
  const downloads = [];
  if (browser && dir) {
    await browser.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: dir, eventsEnabled: true }).catch(() => {});
    const names = new Map();
    browser.on('Browser.downloadWillBegin', (p) => { names.set(p.guid, p.suggestedFilename); const w = downloads[0]; if (w && w.started) w.started(); });
    browser.on('Browser.downloadProgress', (p) => {
      if (p.state !== 'completed' && p.state !== 'canceled') return;
      const w = downloads.shift(); if (!w) return;
      if (p.state === 'canceled') return w.rej(new Error('The download was cancelled'));
      const src = path.join(dir, p.guid); const suggested = names.get(p.guid) || 'download';
      let name = w.saveAs && String(w.saveAs).trim() ? String(w.saveAs).trim().replace(/[\\/:*?"<>|]+/g, '-') : suggested;
      if (!path.extname(name)) name += path.extname(suggested);
      let dest = path.join(dir, name); for (let i = 2; fs.existsSync(dest); i++) dest = path.join(dir, `${path.basename(name, path.extname(name))} (${i})${path.extname(name)}`);
      try { fs.renameSync(src, dest); w.res(dest); } catch (e) { w.rej(e); }
    });
  }
  const KEYS = { enter: ['Enter', 13, '\r'], tab: ['Tab', 9], escape: ['Escape', 27], esc: ['Escape', 27], backspace: ['Backspace', 8], delete: ['Delete', 46], space: [' ', 32, ' '], down: ['ArrowDown', 40], up: ['ArrowUp', 38], left: ['ArrowLeft', 37], right: ['ArrowRight', 39], home: ['Home', 36], end: ['End', 35], pagedown: ['PageDown', 34], pageup: ['PageUp', 33] };
  const ev = async (expression) => {
    const r = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && (r.exceptionDetails.exception.description || r.exceptionDetails.exception.value)) || r.exceptionDetails.text || 'Script error');
    return r.result ? r.result.value : undefined;
  };
  return {
    title: target.title, target,
    alive: () => !page.closed,
    js: ev,
    mouseClick: async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 }); },
    insertText: (t) => page.send('Input.insertText', { text: t }),
    key: async (k) => { const [key, code, text] = KEYS[String(k).toLowerCase()] || [String(k), String(k).toUpperCase().charCodeAt(0), String(k).length === 1 ? String(k) : undefined]; await page.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, windowsVirtualKeyCode: code, text }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: code }); },
    goto: (url) => page.send('Page.navigate', { url }),
    isLoading: async () => loading,
    url: async () => { try { return await ev('location.href'); } catch { return target.url; } },
    expectDownload: (d, saveAs, secs) => new Promise((res, rej) => { if (!browser) return rej(new Error('Downloads aren’t available in this app')); const w = { saveAs, res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } }; const t = setTimeout(() => { const i = downloads.indexOf(w); if (i >= 0) downloads.splice(i, 1); rej(new Error('No download started')); }, secs * 1000); w.started = () => clearTimeout(t); downloads.push(w); }),
    downloadURL: (u) => ev(`(() => { const a = document.createElement('a'); a.href = ${JSON.stringify(u)}; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); })()`),
    capture: async (rect) => Buffer.from((await page.send('Page.captureScreenshot', { format: 'png', ...(rect ? { clip: { ...rect, scale: 1 } } : {}) })).data, 'base64'),
    pdf: async () => { try { return Buffer.from((await page.send('Page.printToPDF', { printBackground: true })).data, 'base64'); } catch { throw new Error('This app can’t save its window as a PDF; use a screenshot instead'); } },
    page, browser,
    close: () => { page.close(); if (browser) browser.close(); },
  };
}

// ───────── the step
async function runAppStep(w, x) {
  const app = findApp(w.app);
  const control = w.control || (app.kind === 'native' ? 'keys' : 'inside');
  const timeout = Math.max(10, Number(w.timeout) || 120);
  const deadline = Date.now() + timeout * 1000;
  const file = w.file ? x.resolvePath(typeof w.file === 'object' ? w.file.file : w.file) : null;
  const native = new Native(app);
  const out = { files: [], tables: {}, text: {}, table: null };
  x.log(`${control === 'inside' ? 'Opening and connecting to' : 'Opening'} ${app.name}`);
  let drv = null; let info = {};
  try {
    if (control === 'inside') {
      info = await withTimeout(launch(app, { control: true, file, restart: w.restart !== false, log: x.log }), Math.min(90, timeout), `${app.name} took too long to open`);
      drv = await cdpDriver(info.port, { windowTitle: w.window, dir: x.dir });
      x.log(`Connected to ${app.name}${drv.title ? ` — “${drv.title}”` : ''}`);
      if (w.waitFor) { const t0 = Date.now(); while (Date.now() - t0 < 30000) { try { await drv.js(require('./actions').HELPER); if (await drv.js(`!!window.__cadence.find(${JSON.stringify(w.waitFor)})`)) break; } catch {} await sleep(300); } }
      else await sleep(1200); // let the app draw its first screen
    } else {
      await launch(app, { control: false, file });
      await sleep(Number(w.settle) > 0 ? Number(w.settle) * 1000 : 2500);
    }
    await runActions({ driver: drv, native, actions: w.actions, x, out, deadline });
    return { ...out, file: out.files[0] || '', app: app.name };
  } finally {
    if (drv) drv.close();
    const after = w.afterwards || 'restore';
    try {
      if (after === 'quit' || (after === 'restore' && control === 'inside' && !info.reused)) {
        await quit(app);
        launched.delete(app.name);
        if (after === 'restore' && info.wasRunning) { await launch(app, { control: false }); x.log(`Reopened ${app.name} as it was`); }
        else x.log(`Closed ${app.name}`);
      }
    } catch (e) { x.log(`Couldn’t close ${app.name}: ${e.message}`, 'warn'); }
  }
}

// Record inside an app: connect, inject the recorder, stream actions until stop() is called.
async function recordApp(spec, onEvent) {
  const app = findApp(spec);
  const info = await launch(app, { control: true, restart: true });
  const drv = await cdpDriver(info.port, {});
  const { install } = require('./recorder-core');
  await drv.page.send('Runtime.addBinding', { name: '__cadenceRec' });
  drv.page.on('Runtime.bindingCalled', (p) => { if (p.name === '__cadenceRec') { try { onEvent({ type: 'action', action: JSON.parse(p.payload) }); } catch {} } });
  const code = `(${install.toString()})((a) => window.__cadenceRec(JSON.stringify(a)))`;
  await drv.page.send('Page.addScriptToEvaluateOnNewDocument', { source: code }).catch(() => {});
  await drv.js(code);
  return { app: app.name, stop: async () => { try { await drv.js(`(() => { const b = document.getElementById('__cadence_rec'); if (b) b.remove(); })()`); } catch {} drv.close(); onEvent({ type: 'done' }); } };
}

module.exports = { listApps, findApp, runAppStep, recordApp, launch, quit, cdpDriver, SUITE, _: { macApp, winApp, pids } };
