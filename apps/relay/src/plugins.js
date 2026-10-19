// Relay — app plugins. Right now: Assist, Bilal's private, offline reply-drafting app.
// Assist runs its AI on this computer and opens a local bridge (127.0.0.1 + a private token it
// writes to its own app-data folder). Relay reads that file, starts Assist quietly in the
// background if it isn't running, and streams drafts back. Nothing leaves the computer.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, spawn } = require('child_process');
const { app, ipcMain } = require('electron');

let ctx = null;
const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const CLIENT = 'Relay';

const bridgeFile = () => path.join(app.getPath('appData'), 'Assist', 'bridge.json');
function readBridge() {
  try {
    const b = JSON.parse(fs.readFileSync(bridgeFile(), 'utf8'));
    if (!b.port || !b.token) return null;
    try { process.kill(b.pid, 0); } catch (e) { if (e.code === 'ESRCH') return null; }
    return b;
  } catch { return null; }
}

function appCandidates() {
  if (IS_MAC) return ['/Applications/Assist.app', path.join(os.homedir(), 'Applications', 'Assist.app')];
  if (IS_WIN) {
    const la = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return [path.join(la, 'Programs', 'Assist', 'Assist.exe'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Assist', 'Assist.exe'), path.join(la, 'Programs', 'assist', 'Assist.exe')];
  }
  return [];
}
const installedPath = () => appCandidates().find(p => fs.existsSync(p)) || null;

function launch(background = true) {
  const p = installedPath();
  return new Promise((resolve) => {
    if (IS_MAC) {
      const args = background ? ['-g', '-a', p || 'Assist', '--args', '--background'] : ['-a', p || 'Assist'];
      execFile('open', args, (err) => resolve(!err));
    } else if (p) {
      try { spawn(p, background ? ['--background'] : [], { detached: true, stdio: 'ignore' }).unref(); resolve(true); } catch { resolve(false); }
    } else resolve(false);
  });
}

async function call(b, route, { method = 'GET', body, signal, onEvent, timeout = 8000 } = {}) {
  const ctl = new AbortController();
  const t = onEvent ? null : setTimeout(() => ctl.abort(), timeout);
  signal?.addEventListener('abort', () => ctl.abort());
  try {
    const res = await fetch(`http://127.0.0.1:${b.port}${route}`, {
      method, signal: ctl.signal,
      headers: { authorization: `Bearer ${b.token}`, 'x-assist-client': CLIENT, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!onEvent) {
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { const e = new Error(j.error || j.message || `Assist error ${res.status}`); e.code = j.code; throw e; }
      return j;
    }
    if (!res.ok) { const j = await res.json().catch(() => ({})); const e = new Error(j.error || `Assist error ${res.status}`); e.code = j.code; throw e; }
    // newline-delimited JSON events: progress / delta / done / error
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', last = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let evt; try { evt = JSON.parse(line); } catch { continue; }
        last = evt;
        onEvent(evt);
      }
    }
    return last;
  } finally { clearTimeout(t); }
}

// Make sure Assist is running with its bridge open; start it hidden if needed.
async function connect({ start = true } = {}) {
  let b = readBridge();
  if (b) { try { await call(b, '/v1/hello', { timeout: 2500 }); return b; } catch { b = null; } }
  if (!start) return null;
  if (!installedPath() && !IS_MAC) { const e = new Error('Assist isn’t installed on this computer.'); e.code = 'not_installed'; throw e; }
  const ok = await launch(true);
  if (!ok) { const e = new Error('Assist isn’t installed on this computer.'); e.code = 'not_installed'; throw e; }
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 500));
    b = readBridge();
    if (b) { try { await call(b, '/v1/hello', { timeout: 1500 }); return b; } catch {} }
  }
  const e = new Error('Assist didn’t answer. Open Assist once and make sure “Let my other apps use Assist” is on in its Settings.');
  e.code = 'no_bridge'; throw e;
}

async function status({ start = false } = {}) {
  const enabled = ctx.getStore().settings.assistEnabled !== false;
  const installed = !!installedPath() || !!readBridge();
  let b = null;
  try { b = await connect({ start: start && enabled }); } catch (e) { return { installed, running: false, enabled, error: e.message, code: e.code }; }
  if (!b) return { installed, running: false, enabled };
  try {
    const s = await call(b, '/v1/status', { timeout: 6000 });
    return { installed: true, running: true, version: b.version, ...s, assistEnabled: s.enabled, enabled };
  } catch (e) { return { installed: true, running: true, enabled, version: b.version, error: e.message, code: e.code }; }
}

// Used by Relay's AI features when the provider is Assist (works offline)
async function complete({ system, messages, maxTokens, signal, onDelta }) {
  if (ctx.getStore().settings.assistEnabled === false) throw new Error('Assist is turned off in Settings → AI plugins.');
  const b = await connect({ start: true });
  let text = '', err = null;
  await call(b, '/v1/complete', {
    method: 'POST', signal, body: { system, messages, maxTokens: Math.min(maxTokens || 800, 1500) },
    onEvent: (evt) => {
      if (evt.type === 'delta') { text += evt.delta; onDelta?.(evt.delta); }
      else if (evt.type === 'error') err = evt;
    }
  });
  if (err) { const e = new Error(err.message); e.code = err.code; throw e; }
  return text;
}

const running = new Map(); // reqId -> AbortController
function register(c) {
  ctx = c;
  ipcMain.handle('assist:status', (_e, opts) => status(opts || {}));
  ipcMain.handle('assist:open', async () => {
    const b = readBridge();
    if (b) { try { await call(b, '/v1/show', { method: 'POST' }); return true; } catch {} }
    return launch(false);
  });
  ipcMain.handle('assist:draft', async (event, { reqId, payload }) => {
    const send = (evt) => !event.sender.isDestroyed() && event.sender.send('assist:event', { reqId, evt });
    const ctl = new AbortController();
    running.set(reqId, ctl);
    try {
      if (ctx.getStore().settings.assistEnabled === false) throw Object.assign(new Error('Assist is turned off in Settings → AI plugins.'), { code: 'off' });
      send({ type: 'progress', text: 'Connecting to Assist…' });
      const b = await connect({ start: true });
      const last = await call(b, '/v1/draft', { method: 'POST', signal: ctl.signal, body: payload, onEvent: send });
      if (!last || (last.type !== 'done' && last.type !== 'error')) send({ type: 'error', message: 'Assist stopped before finishing.' });
    } catch (e) {
      if (e.name === 'AbortError') send({ type: 'cancelled' });
      else send({ type: 'error', message: e.message, code: e.code });
    } finally { running.delete(reqId); }
  });
  ipcMain.handle('assist:cancel', (_e, reqId) => { running.get(reqId)?.abort(); running.delete(reqId); });
}

module.exports = { register, complete, status };
