// Atoll — add-ons: Docket, Scene, Beam, Vitals and Relay on the island. Each is off until you turn it on in
// Settings › Add-ons. When on, Atoll talks to the app through the Utility Suite link (src/suitelink.js) while the app
// is running, and offers to open it (in the background) when it's installed but not running. Nothing here changes
// how Atoll behaves with every add-on off.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const suitelink = require('./suitelink');

const META = {
  docket: { name: 'Docket', what: 'Meeting notes: see a recording, and start one when a call begins' },
  scene: { name: 'Scene', what: 'Switch workspace scenes from the island' },
  beam: { name: 'Beam', what: 'Send files and text to nearby devices' },
  vitals: { name: 'Vitals', what: 'Processor, memory, graphics and temperature at a glance' },
  relay: { name: 'Relay', what: 'New email and unread counts' }
};
const IDS = Object.keys(META);

/** Where Utility Hub installs an app (see apps/hub/lib/apps.js). */
function installPaths(id, { home = os.homedir(), env = process.env, platform = process.platform } = {}) {
  const name = META[id].name;
  if (platform === 'darwin') return [path.join('/Applications', `${name}.app`), path.join(home, 'Applications', `${name}.app`)];
  if (platform === 'win32') return [path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Programs', 'Utility Suite', name, `${name}.exe`)];
  return [];
}

class Addons extends EventEmitter {
  constructor({ enabled = () => ({}), demo = false, exists = fs.existsSync, launcher = null, linkOptions = {} } = {}) {
    super();
    this.enabledOf = enabled; this.demo = demo; this.exists = exists; this.launcher = launcher; this.linkOptions = linkOptions;
    this.links = {}; this.st = {}; this.instCache = {};
    for (const id of IDS) this.st[id] = this.blank(id);
  }
  blank(id) { return { id, name: META[id].name, what: META[id].what, enabled: false, installed: null, up: false, version: null, launching: false, data: {} }; }

  installed(id) {
    if (this.demo) return true;
    const c = this.instCache[id];
    if (c && Date.now() - c.at < 60e3) return c.v;
    const v = installPaths(id).some((p) => { try { return this.exists(p); } catch (_) { return false; } });
    this.instCache[id] = { v, at: Date.now() };
    return v;
  }

  /** Start or stop links to match the settings. */
  sync() {
    const on = this.enabledOf() || {};
    for (const id of IDS) {
      const want = !!on[id];
      const s = this.st[id];
      s.enabled = want;
      if (want && !this.links[id]) this.open(id);
      if (!want && this.links[id]) { this.links[id].stop(); delete this.links[id]; this.st[id] = this.blank(id); }
      if (want) s.installed = this.installed(id) || s.up;
    }
    this.changed();
  }

  open(id) {
    const l = suitelink.connect(id, { retryMs: 5000, ...this.linkOptions });
    this.links[id] = l;
    l.on('up', (info) => { const s = this.st[id]; s.up = true; s.installed = true; s.launching = false; s.version = info?.version || null; this.changed(); this.load(id); });
    l.on('down', () => { const s = this.st[id]; s.up = false; s.data = {}; this.changed(); });
    const set = (patch) => { Object.assign(this.st[id].data, patch); this.changed(id); };
    if (id === 'docket') {
      l.on('status', (d) => { const was = this.st.docket.data.status; set({ status: d }); if (was && was.recording !== d.recording) this.emit('moment', { kind: d.recording ? 'docket-start' : 'docket-stop', status: d }); });
      l.on('detected', (m) => { set({ status: { ...(this.st.docket.data.status || {}), detected: m } }); if (m && !this.st.docket.data.status?.recording) this.emit('moment', { kind: 'meeting', meeting: m }); });
    }
    if (id === 'scene') l.on('switched', (d) => set({ list: d }));
    if (id === 'beam') { l.on('peers', (p) => set({ peers: p })); l.on('transfers', (t) => set({ transfers: t })); }
    if (id === 'vitals') l.on('tick', (t) => { const h = this.st.vitals.data.history || { cpu: [], mem: [], gpu: [], temp: [] }; for (const k of ['cpu', 'mem', 'gpu', 'temp']) { const v = k === 'cpu' ? t?.cpu : k === 'mem' ? t?.mem?.pct : k === 'gpu' ? t?.gpu?.util : t?.temp; h[k] = [...h[k], v ?? null].slice(-60); } set({ stats: t, history: h }); });
    if (id === 'relay') {
      l.on('unread', (a) => set({ accounts: a }));
      l.on('mail', (m) => { set({ recent: [m, ...(this.st.relay.data.recent || [])].slice(0, 20) }); this.emit('moment', { kind: 'mail', mail: m }); });
    }
  }

  /** First look after connecting. */
  async load(id) {
    const l = this.links[id]; if (!l) return;
    const get = async (name) => { try { return await l.call(name); } catch (_) { return undefined; } };
    const d = this.st[id].data;
    if (id === 'docket') d.status = await get('status');
    if (id === 'scene') d.list = await get('list');
    if (id === 'beam') { d.peers = await get('peers'); d.transfers = await get('transfers'); }
    if (id === 'vitals') {
      d.stats = await get('stats');
      const h = await get('history');
      if (h) d.history = { cpu: (h.cpu || []).map((v) => (v == null ? null : Math.round(v))), mem: (h.mem || []).map((v) => (v == null ? null : Math.round(v))), gpu: h.gpu || [], temp: h.temp || [] };
    }
    if (id === 'relay') { d.accounts = await get('unread'); d.recent = await get('recent'); }
    this.changed(id);
  }

  async call(id, name, ...args) {
    const l = this.links[id];
    if (!l || !l.up) throw new Error(`${META[id]?.name || id} isn’t running`);
    const r = await l.call(name, ...args);
    if (id === 'scene' && (name === 'activate' || name === 'previous')) setTimeout(() => this.load('scene'), 300);
    return r;
  }

  /** Open an installed app in the background, then connect as soon as it's listening. */
  launch(id) {
    const s = this.st[id];
    if (!META[id] || s.up) return false;
    const p = installPaths(id).find((x) => { try { return this.exists(x); } catch (_) { return false; } });
    if (!p && !this.launcher) throw new Error(`${META[id].name} isn’t installed. Add it in Utility Hub.`);
    s.launching = true; this.changed();
    if (this.launcher) this.launcher(id, p);
    else if (process.platform === 'darwin') spawn('/usr/bin/open', ['-g', '-a', p, '--args', '--hidden'], { detached: true, stdio: 'ignore' }).unref();
    else spawn(p, ['--hidden'], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
    let n = 0;
    const tick = () => { if (s.up || !this.links[id] || ++n > 20) { s.launching = false; this.changed(); return; } this.links[id].poke(); setTimeout(tick, 1000); };
    setTimeout(tick, 800);
    return true;
  }

  changed() { this.emit('change'); }
  snapshot() {
    const out = {};
    for (const id of IDS) { const s = this.st[id]; out[id] = { ...s, data: s.data }; }
    return out;
  }
  stop() { for (const id of Object.keys(this.links)) this.links[id].stop(); this.links = {}; }
}

module.exports = { Addons, META, IDS, installPaths };
