// Mural — runs the wallpapers: one window per display, placed on the desktop by the platform helper, fed the cursor
// and clicks, and paused the moment its desktop can't be seen.
//
// Pausing is two steps: the page stops drawing and decoding video, then the whole page is frozen through the DevTools
// protocol (Page.setWebLifecycleState "frozen"): no timers, no animation frames, no JavaScript at all, ~0% CPU, while
// the last frame stays on screen. Thawing is instant. A governor watches the wallpaper processes' CPU and steps frame
// rate (then resolution) down when they go over the budget, and back up when there's room.
'use strict';
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const { pauseReason, quality, Governor, displayFor } = require('./core/policy');

class Host extends EventEmitter {
  constructor({ electron, store, library, desktop, preload, log, dataDir }) {
    super();
    this.e = electron; this.store = store; this.library = library; this.desktop = desktop; this.preload = preload; this.log = log || (() => {}); this.dataDir = dataDir;
    this.recs = new Map(); // displayKey -> record
    this.power = { onBattery: false, locked: false, suspended: false, thermal: 'nominal', idle: false };
    this.userPaused = false; this.governor = new Governor(store.get().budget);
    this.lastPointer = null; this.pointerTimer = 0; this.metricsTimer = 0; this.started = false; this.quitting = false;
  }

  // ------------------------------------------------------------------------------------------------- lifecycle
  start() {
    if (this.started) return; this.started = true;
    const { screen, powerMonitor } = this.e;
    const s = this.store.get();
    try { this.power.onBattery = powerMonitor.isOnBatteryPower(); } catch (_) {}
    try { this.power.thermal = powerMonitor.getCurrentThermalState ? powerMonitor.getCurrentThermalState() : 'nominal'; } catch (_) {}
    const on = (ev, fn) => { try { powerMonitor.on(ev, fn); } catch (_) {} };
    on('on-battery', () => { this.power.onBattery = true; this.evaluate(true); });
    on('on-ac', () => { this.power.onBattery = false; this.evaluate(true); });
    on('lock-screen', () => { this.power.locked = true; this.evaluate(); });
    on('unlock-screen', () => { this.power.locked = false; this.evaluate(); });
    on('suspend', () => { this.power.suspended = true; this.evaluate(); });
    on('resume', () => { this.power.suspended = false; setTimeout(() => { this.sync(); this.evaluate(); }, 1500); });
    on('thermal-state-change', (e) => { this.power.thermal = (e && e.state) || e || 'nominal'; this.evaluate(); });
    this.desktop.on('click', (p) => this.onClick(p));
    this.desktop.on('cover', (list) => this.onCover(list));
    this.desktop.on('behind', () => { for (const r of this.recs.values()) if (r.win && !r.win.isDestroyed()) try { r.win.moveTop(); } catch (_) {} });
    this.desktop.on('restarted', () => { for (const r of this.recs.values()) if (r.win && !r.win.isDestroyed()) this.desktop.attach(r.win, r.display).catch(() => {}); });
    this.desktop.start({ clicks: false, cover: s.pauseCovered !== false });
    let deb = 0; const later = () => { clearTimeout(deb); deb = setTimeout(() => this.sync(), 600); };
    screen.on('display-added', later); screen.on('display-removed', later); screen.on('display-metrics-changed', later);
    this.metricsTimer = setInterval(() => this.sampleMetrics(), 4000);
    this.idleTimer = setInterval(() => this.checkIdle(), 30000);
    this.rotateTimer = setInterval(() => this.checkRotate(), 30000); this.rotatedAt = Date.now();
    this.sync();
  }

  displays() { return this.e.screen.getAllDisplays(); }
  key(d) { return String(d.id); }
  label(d, i) {
    const primary = this.e.screen.getPrimaryDisplay().id === d.id;
    return d.label || (primary ? 'Main display' : `Display ${i + 1}`);
  }

  /** Make the windows match the displays and the settings. */
  sync() {
    if (this.quitting) return;
    const s = this.store.get();
    const ds = this.displays(); const keys = new Set(ds.map((d) => this.key(d)));
    for (const [k, r] of this.recs) if (!keys.has(k) || !s.enabled) this.close(r, true);
    if (!s.enabled) { this.desktop.restoreDesktop().catch(() => {}); this.updateWatchers(); this.emit('state'); return; }
    ds.forEach((d, i) => {
      const k = this.key(d); let r = this.recs.get(k);
      if (!r) { r = { key: k, display: d, win: null, wallpaperId: null, covered: false, reason: null, frozen: false, freed: false, pausedAt: 0, traits: {}, stats: { fps: 0, ms: 0 }, cpu: 0, mem: 0, error: null }; this.recs.set(k, r); }
      const moved = JSON.stringify(r.display.bounds) !== JSON.stringify(d.bounds) || r.display.scaleFactor !== d.scaleFactor;
      r.display = d; r.label = this.label(d, i);
      const want = this.store.wallpaperFor(k);
      if (r.freed) return; // paused long enough to give the memory back; comes back when it can run
      if (!r.win || r.win.isDestroyed()) this.open(r, want);
      else if (r.wallpaperId !== want) this.load(r, want);
      else if (moved) this.desktop.place(r.win, d).catch(() => {});
    });
    this.updateWatchers(); this.emit('state');
  }

  open(r, id) {
    const { BrowserWindow } = this.e;
    const b = r.display.bounds;
    const win = new BrowserWindow({
      x: b.x, y: b.y, width: b.width, height: b.height, show: false, frame: false, transparent: false, backgroundColor: '#000000',
      focusable: false, skipTaskbar: true, hasShadow: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
      enableLargerThanScreen: true, roundedCorners: false, title: 'Mural wallpaper', paintWhenInitiallyHidden: true,
      ...this.desktop.windowOptions(),
      webPreferences: { preload: this.preload, contextIsolation: true, sandbox: true, backgroundThrottling: false, spellcheck: false, autoplayPolicy: 'no-user-gesture-required', additionalArguments: [`--mural-display=${r.key}`] }
    });
    r.win = win; r.frozen = false; r.attached = false; r.wallpaperId = null; r.ready = false;
    win.setMenu && win.setMenu(null);
    win.on('closed', () => {
      if (r.win !== win) return; r.win = null; r.frozen = false;
      if (!this.quitting && !r.closing && !r.freed) { this.log('wallpaper window closed unexpectedly; reopening', r.key); setTimeout(() => this.sync(), 2000); }
      r.closing = false;
    });
    win.webContents.on('render-process-gone', (_e, d) => { this.log('wallpaper renderer gone', d && d.reason); if (!this.quitting) { this.close(r, true); setTimeout(() => this.sync(), 1500); } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.once('ready-to-show', async () => {
      if (win.isDestroyed()) return;
      const res = await this.desktop.attach(win, r.display).catch((e) => ({ ok: false, error: e.message }));
      if (win.isDestroyed()) return;
      if (!res.ok) { r.error = 'Couldn’t place the wallpaper behind the desktop icons: ' + (res.error || 'unknown'); this.log(r.error); this.emit('state'); }
      r.attached = true;
      win.showInactive();
      if (this.desktop.name === 'mac') try { win.moveTop(); } catch (_) {}
    });
    win.loadURL(`mural://app/wallpaper.html?d=${encodeURIComponent(r.key)}`);
    r.pendingId = id;
    win.webContents.once('did-finish-load', () => { if (!win.isDestroyed()) this.load(r, r.pendingId); });
  }

  close(r, forget = false) {
    if (r.win && !r.win.isDestroyed()) { r.closing = true; this.desktop.forget(r.win).catch(() => {}); r.win.destroy(); }
    r.win = null; r.frozen = false;
    if (forget) this.recs.delete(r.key);
  }

  /** Show a wallpaper in a display's window. */
  load(r, id) {
    if (!r.win || r.win.isDestroyed()) return;
    let w = this.library.read(id);
    if (!w) { w = this.library.read('builtin/aurora'); id = 'builtin/aurora'; }
    r.wallpaperId = id; r.pendingId = id; r.name = w.manifest.name; r.traits = w.traits; r.hint = w.manifest.quality || {}; r.error = null; r.stats = { fps: 0, ms: 0 };
    if (r.frozen) this.thaw(r, true);
    const s = this.store.get();
    r.win.webContents.send('wp:load', {
      id, manifest: w.manifest, base: `mural://wp/${id}/`, quality: this.qualityFor(r), location: s.location, showStats: !!s.showStats,
      cursor: s.cursor !== false, clicks: s.clicks !== false
    });
    r.ready = true;
    this.updateWatchers(); this.evaluate(); this.emit('state');
  }

  qualityFor(r) { const s = this.store.get(); return quality({ settings: s, hint: r.hint || {}, onBattery: this.power.onBattery, level: this.governor.level }); }
  pushQuality() { for (const r of this.recs.values()) if (r.win && !r.win.isDestroyed() && r.ready) r.win.webContents.send('wp:quality', this.qualityFor(r)); }

  // ------------------------------------------------------------------------------------------------- pausing
  evaluate(qualityToo = false) {
    const s = this.store.get();
    for (const r of this.recs.values()) {
      const reason = pauseReason({ settings: s, covered: r.covered, userPaused: this.userPaused, ...this.power });
      r.reason = reason;
      if (reason) {
        if (!r.pausedAt) r.pausedAt = Date.now();
        if (r.win && !r.frozen) this.freeze(r);
        if (s.freeAfter > 0 && !r.freed && r.win && Date.now() - r.pausedAt > s.freeAfter * 60000) this.free(r);
      } else {
        r.pausedAt = 0;
        if (r.freed) { r.freed = false; this.sync(); }
        else if (r.win && r.frozen) this.thaw(r);
      }
    }
    if (qualityToo) this.pushQuality();
    this.updateWatchers(); this.emit('state');
  }
  freeze(r) {
    r.frozen = true;
    const wc = r.win.webContents; wc.send('wp:pause');
    setTimeout(() => {
      if (!r.frozen || !r.win || r.win.isDestroyed()) return;
      try { if (!wc.debugger.isAttached()) wc.debugger.attach('1.3'); wc.debugger.sendCommand('Page.setWebLifecycleState', { state: 'frozen' }).catch(() => {}); } catch (_) {}
    }, 120);
  }
  thaw(r, quiet = false) {
    r.frozen = false;
    const wc = r.win.webContents;
    try { if (wc.debugger.isAttached()) wc.debugger.sendCommand('Page.setWebLifecycleState', { state: 'active' }).catch(() => {}); } catch (_) {}
    if (!quiet) setTimeout(() => { if (r.win && !r.win.isDestroyed() && !r.frozen) { wc.send('wp:quality', this.qualityFor(r)); wc.send('wp:resume'); } }, 30);
    else setTimeout(() => { if (r.win && !r.win.isDestroyed()) wc.send('wp:resume'); }, 30);
  }
  /** Paused for a long time: swap a still of the wallpaper in as the system wallpaper and close the window. */
  async free(r) {
    if (!r.win || r.win.isDestroyed()) return;
    try {
      const img = await r.win.webContents.capturePage();
      const file = path.join(this.dataDir, `still-${r.key.replace(/[^a-z0-9-]/gi, '')}.png`);
      fs.writeFileSync(file, img.toPNG());
      const st = this.readState();
      if (!st.originalWallpaper) { const orig = await this.desktop.getWallpaper(); if (orig && !/still-/.test(orig)) { st.originalWallpaper = orig; this.writeState(st); } }
      await this.desktop.setWallpaper(file);
      r.freed = true; this.close(r); this.log('freed display', r.key);
    } catch (e) { this.log('free failed', e.message); }
    this.emit('state');
  }
  readState() { try { return JSON.parse(fs.readFileSync(path.join(this.dataDir, 'state.json'), 'utf8')); } catch (_) { return {}; } }
  writeState(s) { try { fs.writeFileSync(path.join(this.dataDir, 'state.json'), JSON.stringify(s)); } catch (_) {} }
  /** Put back the wallpaper that was there before Eco swapped stills in. */
  async restoreOriginal() {
    const st = this.readState();
    if (st.originalWallpaper) { await this.desktop.setWallpaper(st.originalWallpaper).catch(() => {}); delete st.originalWallpaper; this.writeState(st); }
  }

  setUserPaused(v) { this.userPaused = !!v; this.evaluate(); return this.userPaused; }

  onCover(list) {
    for (const r of this.recs.values()) {
      const b = r.display.bounds, c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      const m = list.find((s) => c.x >= s.bounds.x && c.x < s.bounds.x + s.bounds.width && c.y >= s.bounds.y && c.y < s.bounds.y + s.bounds.height);
      if (m) r.covered = m.covered;
    }
    this.evaluate();
  }
  checkIdle() {
    if (!this.store.get().pauseIdle) { if (this.power.idle) { this.power.idle = false; this.evaluate(); } return; }
    let idle = false; try { idle = this.e.powerMonitor.getSystemIdleTime() > 300; } catch (_) {}
    if (idle !== this.power.idle) { this.power.idle = idle; this.evaluate(); }
  }
  checkRotate() {
    const s = this.store.get(); const rot = s.rotate || {};
    if (!rot.on || !Array.isArray(rot.ids) || rot.ids.length < 2) return;
    if (Date.now() - this.rotatedAt < Math.max(1, rot.minutes) * 60000) return;
    this.rotatedAt = Date.now();
    const i = rot.ids.indexOf(s.wallpaper); const next = rot.ids[(i + 1) % rot.ids.length];
    if (this.library.read(next)) { this.store.set({ wallpaper: next }); this.sync(); this.emit('applied', next); }
  }

  // ------------------------------------------------------------------------------------------------- input
  running() { return [...this.recs.values()].filter((r) => r.win && !r.win.isDestroyed() && r.ready && !r.frozen); }
  updateWatchers() {
    const s = this.store.get(); const run = this.running();
    const wantPointer = s.cursor !== false && run.some((r) => r.traits && r.traits.cursor);
    const wantClicks = s.clicks !== false && run.some((r) => r.traits && r.traits.click);
    this.desktop.configure({ clicks: wantClicks, cover: s.pauseCovered !== false });
    if (wantPointer && !this.pointerTimer) this.pointerTimer = setInterval(() => this.pollPointer(), 33);
    if (!wantPointer && this.pointerTimer) { clearInterval(this.pointerTimer); this.pointerTimer = 0; }
  }
  pollPointer() {
    const p = this.e.screen.getCursorScreenPoint();
    if (this.lastPointer && p.x === this.lastPointer.x && p.y === this.lastPointer.y) return;
    this.lastPointer = p;
    for (const r of this.running()) {
      if (!r.traits.cursor) continue;
      const b = r.display.bounds; const inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
      if (inside || r.pointerInside) r.win.webContents.send('wp:pointer', { x: (p.x - b.x) / b.width, y: (p.y - b.y) / b.height, inside });
      r.pointerInside = inside;
    }
  }
  onClick(p) {
    if (this.store.get().clicks === false) return;
    const d = displayFor(p, [...this.recs.values()].map((r) => ({ bounds: r.display.bounds, r })));
    if (!d) return; const r = d.r;
    if (!r.win || r.win.isDestroyed() || r.frozen || !r.traits.click) return;
    const b = r.display.bounds;
    r.win.webContents.send('wp:click', { x: (p.x - b.x) / b.width, y: (p.y - b.y) / b.height, button: p.button || 0 });
  }

  // ------------------------------------------------------------------------------------------------- metrics
  onStats(key, st) { const r = this.recs.get(key); if (r) r.stats = st; }
  onError(key, msg) { const r = this.recs.get(key); if (r) { r.error = msg; this.log('wallpaper error', key, msg); this.emit('state'); } }
  sampleMetrics() {
    let metrics = []; try { metrics = this.e.app.getAppMetrics(); } catch (_) { return; }
    const byPid = new Map(metrics.map((m) => [m.pid, m]));
    let total = 0, running = 0;
    for (const r of this.recs.values()) {
      if (!r.win || r.win.isDestroyed()) { r.cpu = 0; r.mem = 0; continue; }
      const m = byPid.get(r.win.webContents.getOSProcessId());
      r.cpu = m ? m.cpu.percentCPUUsage : 0; r.mem = m ? (m.memory.workingSetSize || 0) : 0; // KB
      if (!r.frozen) { total += r.cpu; running++; }
    }
    const gpu = metrics.find((m) => m.type === 'GPU');
    this.gpuCpu = gpu ? gpu.cpu.percentCPUUsage : 0; this.gpuMem = gpu ? (gpu.memory.workingSetSize || 0) : 0; // KB
    // the GPU process does the drawing; count it when nothing else (the app window) is using it
    const appOpen = this.e.BrowserWindow.getAllWindows().some((w) => w.isVisible() && !w.isDestroyed() && w.getTitle() !== 'Mural wallpaper');
    if (!appOpen) total += this.gpuCpu;
    this.totalCpu = total;
    if (running) { this.governor.setBudget(this.store.get().budget); if (this.governor.sample(total)) { this.log('governor level', this.governor.level, 'cpu', total.toFixed(1)); this.pushQuality(); } }
    this.emit('metrics');
  }

  /** What the Performance page and the tray show. */
  status() {
    const s = this.store.get();
    const list = [...this.recs.values()].map((r) => ({
      key: r.key, label: r.label, bounds: r.display.bounds, scale: r.display.scaleFactor, wallpaperId: r.wallpaperId, name: r.name || '',
      state: r.freed ? 'freed' : !r.win ? 'off' : r.frozen ? 'paused' : 'running', reason: r.reason, covered: r.covered,
      fps: r.frozen ? 0 : r.stats.fps || 0, frameMs: r.stats.ms || 0, cpu: Math.round((r.cpu || 0) * 10) / 10, memMB: Math.round((r.mem || 0) / 1024),
      quality: this.qualityFor(r), traits: r.traits, error: r.error
    }));
    return {
      enabled: s.enabled, userPaused: this.userPaused, power: this.power, platform: this.desktop.name, mode: this.desktop.mode || null,
      governor: { level: this.governor.level, budget: this.governor.budgetName, limit: this.governor.limit }, totalCpu: Math.round((this.totalCpu || 0) * 10) / 10,
      gpuCpu: Math.round((this.gpuCpu || 0) * 10) / 10, gpuMemMB: Math.round((this.gpuMem || 0) / 1024), displays: list
    };
  }

  async stop() {
    this.quitting = true;
    clearInterval(this.pointerTimer); clearInterval(this.metricsTimer); clearInterval(this.idleTimer); clearInterval(this.rotateTimer);
    for (const r of this.recs.values()) this.close(r);
    this.recs.clear();
    await this.desktop.restoreDesktop().catch(() => {});
    await this.restoreOriginal().catch(() => {});
    this.desktop.stop();
  }
}

module.exports = { Host };
