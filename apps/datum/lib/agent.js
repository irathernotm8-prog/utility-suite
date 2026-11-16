// Datum — the AI side of the main process: the Claude / Codex plugin bridge, the in-app assistant over Claude Code,
// Codex or a model API key, and the settings for both. Tool calls are carried out by the window (renderer/js/agent.js),
// which holds the project; this file only routes them, takes screenshots and keeps API keys (encrypted, never sent
// to the window).
'use strict';
const fs = require('fs');
const path = require('path');
const { app, ipcMain, safeStorage, shell } = require('electron');
const connectors = require('./connectors');
const ai = require('./ai');
const llm = require('./llm');
const { guideText } = require('../mcp/guide');

const file = () => path.join(app.getPath('userData'), 'ai.json');
const DEFAULTS = { provider: 'builtin', models: {}, bases: {}, keys: {} };
let settings = null;
const load = () => { if (!settings) { try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) }; } catch { settings = { ...DEFAULTS }; } } return settings; };
const save = () => { try { fs.writeFileSync(file(), JSON.stringify(settings, null, 2), { mode: 0o600 }); } catch (e) { console.error('ai settings', e); } };
const enc = (v) => (!v ? '' : safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(v).toString('base64') : 'p:' + Buffer.from(v).toString('base64'));
const dec = (v) => { if (!v) return ''; try { return v.startsWith('p:') ? Buffer.from(v.slice(2), 'base64').toString() : safeStorage.decryptString(Buffer.from(v, 'base64')); } catch { return ''; } };
const publicSettings = () => { const s = load(); const { keys, ...rest } = s; return { ...rest, hasKey: Object.fromEntries(Object.entries(keys || {}).map(([k, v]) => [k, !!v])) }; };

function setup({ getWin, showWindow, htmlToPng }) {
  // ---- calling the window: it owns the project, so every tool runs there
  let seq = 0, ready = false;
  const pending = new Map();
  const waiters = [];
  ipcMain.on('agent:ready', () => { ready = true; waiters.splice(0).forEach((f) => f()); });
  ipcMain.on('agent:result', (_e, { id, result }) => { const p = pending.get(id); if (p) { pending.delete(id); clearTimeout(p.timer); p.resolve(result); } });
  const whenReady = () => (ready ? Promise.resolve() : new Promise((r) => { waiters.push(r); setTimeout(r, 30000); }));
  const win = () => { const w = getWin(); return w && !w.isDestroyed() ? w : null; };
  const toWindow = async (name, args, client) => {
    if (!win()) { ready = false; showWindow(); }
    if (!win()) throw new Error('Datum’s window is closed. Ask the user to open Datum.');
    await whenReady();
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Datum took too long to answer')); }, 10 * 60 * 1000);
      pending.set(id, { resolve, timer });
      win().webContents.send('agent:call', { id, name, args, client });
    });
  };
  // the window reloads (a crash, or Ctrl+R): it signs in again
  app.on('browser-window-created', (_e, w) => { w.webContents.on('did-start-loading', () => { if (w === getWin()) ready = false; }); });

  const text = (t) => ({ content: [{ type: 'text', text: t }] });
  async function handle(name, args = {}, client = '') {
    try {
      if (name === 'datum_guide') return text(guideText());
      if (name === 'screenshot') {
        const r = await toWindow('screenshot', args, client);
        if (r.isError) return r;
        const w = win();
        let data;
        if (w && w.isVisible() && !w.isMinimized()) {
          await new Promise((res) => setTimeout(res, 700));
          const img = await w.webContents.capturePage();
          if (!img.isEmpty()) data = img.resize({ width: Math.min(1400, img.getSize().width) }).toPNG().toString('base64');
        }
        if (!data && r.page) data = (await htmlToPng(r.page.html, r.page.w, r.page.h)).replace(/^data:image\/png;base64,/, '');
        if (!data) return text((r.content && r.content[0] && r.content[0].text) || 'Datum is running in the background, so there is nothing on screen to capture. Use dashboard_data to read the numbers.');
        return { content: [...(r.content || []), { type: 'image', data, mimeType: 'image/png' }] };
      }
      if (name === 'export_pdf') args = { ...args, __downloads: app.getPath('downloads') };
      if (name === 'save_project') args = { ...args, __documents: app.getPath('documents') };
      return await toWindow(name, args, client);
    } catch (e) { return { content: [{ type: 'text', text: 'Error: ' + (e.message || e) }], isError: true }; }
  }

  connectors.startBridge(handle, (st) => { const w = win(); if (w) w.webContents.send('agent:bridge', st); });
  setTimeout(() => connectors.refreshInstalled(), 4000); // looks for the claude / codex commands, which can take a moment
  app.on('will-quit', () => connectors.stopBridge());

  // ---- settings and connections
  const h = (ch, fn) => ipcMain.handle(ch, (_e, ...a) => fn(...a));
  h('agent:settings', () => ({ ...publicSettings(), providers: llm.PROVIDERS.map(({ id, name, model, keyUrl, noKey, base }) => ({ id, name, model, keyUrl, noKey, base })) }));
  h('agent:settings-set', (patch = {}) => {
    const s = load();
    if (patch.provider) s.provider = patch.provider;
    if (patch.id && 'model' in patch) s.models[patch.id] = patch.model || undefined;
    if (patch.id && 'base' in patch) s.bases[patch.id] = patch.base || undefined;
    if (patch.id && 'key' in patch) s.keys[patch.id] = patch.key ? enc(String(patch.key).trim()) : undefined;
    save();
    return publicSettings();
  });
  h('agent:models', async (id) => { const p = llm.PROVIDERS.find((x) => x.id === id); if (!p) throw new Error('Unknown provider'); const s = load(); return llm.listModels({ ...p, base: s.bases[id] || p.base }, dec(s.keys[id])); });
  h('agent:status', () => ({ claude: ai.cli('claude'), codex: ai.cli('codex'), ...connectors.connectorStatus() }));
  h('agent:connect', async (which) => (which === 'desktop' ? connectors.connectDesktop() : which === 'code' ? connectors.connectCode() : which === 'codex' ? connectors.connectCodex() : null));
  h('agent:open-url', (u) => (/^https:\/\//.test(u) ? shell.openExternal(u) : null));

  // ---- the in-app assistant: Claude Code / Codex on this computer, or a model over an API key
  const chats = new Map(); let ctl = null;
  const chatOf = (key) => { if (!chats.has(key)) chats.set(key, { history: [], sessions: {} }); return chats.get(key); };
  h('agent:chat-stop', () => { if (ctl) ctl.abort(); ctl = null; return true; });
  h('agent:chat-clear', (key) => { chats.delete(key || 'none'); return true; });
  h('agent:chat-send', async ({ prompt, key, context, provider } = {}) => {
    if (ctl) throw new Error('The assistant is still working. Stop it first, or wait.');
    const s = load(); provider = provider || s.provider;
    const c = chatOf(key || 'none'); const my = new AbortController(); ctl = my;
    const ev = (e) => { const w = win(); if (w) w.webContents.send('agent:chat-event', e); };
    try {
      let r;
      if (provider === 'claude-code' || provider === 'codex') {
        connectors.installScript(); const entry = connectors.connectorStatus().entry;
        const full = `${prompt}\n\n(You're inside the Datum app. ${context || ''} The user watches Datum update as you work. Keep your final message short.)`;
        r = await ai.askAgent({ prompt: full, entry, cwd: path.join(app.getPath('userData'), 'ask'), signal: my.signal, provider: provider === 'codex' ? 'codex' : 'claude', resume: provider === 'claude-code' ? c.sessions.claude : null, onEvent: ev });
        if (r.session) c.sessions.claude = r.session;
      } else {
        const p = llm.PROVIDERS.find((x) => x.id === provider); if (!p) throw new Error('Choose an AI in Ask Datum › Settings');
        const system = `${guideText()}\n\n## Right now\n${context || ''}\nToday is ${new Date().toDateString()}.`;
        r = await llm.runTurn({ provider: { ...p, base: s.bases[provider] || p.base }, key: dec(s.keys[provider]), model: s.models[provider] || p.model, system, history: c.history, prompt, handle: (n, a, by) => handle(n, a, by), onEvent: ev, signal: my.signal });
        if (c.history.length > 120) c.history.splice(1, c.history.length - 100);
      }
      ev({ kind: 'done', text: r.text });
      return { text: r.text };
    } catch (e) {
      const msg = /abort/i.test(e.name || '') || /Stopped/.test(e.message) ? 'Stopped' : e.message;
      c.history.length = 0; // a half-finished turn would confuse the next one
      ev({ kind: 'error', text: msg });
      throw new Error(msg);
    } finally { if (ctl === my) ctl = null; }
  });
  return { handle };
}

module.exports = { setup };
