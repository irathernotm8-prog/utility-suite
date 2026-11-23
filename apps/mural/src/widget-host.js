// Mural — the widgets layer: one transparent window per display that has widgets, above the wallpaper and the desktop
// icons, below every app. Mouse clicks pass straight through except over a widget (main checks the pointer against
// the widget rectangles 30 times a second and flips click-through), so the desktop works as before.
//   Mac: window level "normal − 1": under all app windows, over the icons; still clickable and typeable.
//   Windows: owned by Progman (stays on Win+D, sits over the icons) and pushed to the bottom after use.
// Arrange mode lifts the layer over everything with a dim backdrop so widgets can be dragged, resized and removed.
'use strict';
const { EventEmitter } = require('events');
const os = require('os');
const { shell } = require('electron');
const { execFile } = require('child_process');

class WidgetLayer extends EventEmitter {
  constructor({ electron, widgets, host, desktop, store, preload, log }) {
    super();
    this.e = electron; this.widgets = widgets; this.host = host; this.desktop = desktop; this.store = store; this.preload = preload; this.log = log || (() => {});
    this.layers = new Map(); // displayKey -> { win, display, ignoring, frozen, ready }
    this.editing = false; this.hitTimer = 0; this.suite = new Map(); this.cpuPrev = null;
  }
  start() {
    this.host.on('state', () => this.followHost());
    let deb = 0; this.host.on('displays', () => { clearTimeout(deb); deb = setTimeout(() => this.sync(), 400); });
    this.fitTimer = setInterval(() => { for (const L of this.layers.values()) this.fit(L); }, 5000);
    this.sync();
  }

  displays() { return this.e.screen.getAllDisplays(); }
  key(d) { return String(d.id); }

  /** Windows only where there are widgets (or while arranging). No widgets = no window = no cost. */
  sync() {
    const ds = this.displays(); const keys = new Set(ds.map((d) => this.key(d)));
    // widgets on a display that's gone move to the main display
    const primary = this.key(this.e.screen.getPrimaryDisplay());
    for (const i of this.widgets.instances()) if (!keys.has(i.display)) this.widgets.update(i.id, { display: primary });
    for (const [k, L] of this.layers) if (!keys.has(k)) this.closeLayer(k);
    for (const d of ds) {
      const k = this.key(d); const want = this.editing || this.widgets.instances(k).length > 0;
      let L = this.layers.get(k);
      if (!want) { if (L) this.closeLayer(k); continue; }
      if (!L || !L.win || L.win.isDestroyed()) L = this.openLayer(d);
      else { L.display = d; this.fit(L); this.push(k); }
    }
    this.updateHitLoop(); this.emit('changed');
  }

  openLayer(d) {
    const { BrowserWindow } = this.e; const k = this.key(d); const b = d.bounds;
    const win = new BrowserWindow({
      x: b.x, y: b.y, width: b.width, height: b.height, show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      skipTaskbar: true, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, focusable: true, enableLargerThanScreen: true,
      roundedCorners: false, title: 'Mural widgets', paintWhenInitiallyHidden: true,
      webPreferences: { preload: this.preload, contextIsolation: true, sandbox: true, backgroundThrottling: false, spellcheck: true, additionalArguments: [`--mural-display=${k}`] }
    });
    const L = { win, display: d, key: k, ignoring: true, frozen: false, ready: false };
    this.layers.set(k, L);
    win.setIgnoreMouseEvents(true);
    win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.on('closed', () => { if (L.win === win) { L.win = null; if (!L.closing && !this.host.quitting) setTimeout(() => this.sync(), 1500); } });
    win.on('blur', () => { if (this.desktop.name === 'windows' && !this.editing) this.desktop.lowerWidgets(win).catch(() => {}); });
    win.webContents.on('render-process-gone', () => { this.closeLayer(k); setTimeout(() => this.sync(), 1500); });
    win.once('ready-to-show', async () => {
      if (win.isDestroyed()) return;
      this.placeLevel(L, false);
      win.showInactive();
      if (this.desktop.name === 'windows') await this.desktop.raiseWidgets(win).catch(() => {});
      L.ready = true; this.push(k); this.followHost();
    });
    win.loadURL(`mural://app/widgets.html?d=${encodeURIComponent(k)}`);
    return L;
  }
  /** Where the layer sits: under apps normally, over everything while arranging. */
  placeLevel(L, top) {
    const w = L.win; if (!w || w.isDestroyed()) return;
    try {
      if (this.desktop.name === 'mac') {
        w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
        try { w.setHiddenInMissionControl(true); } catch (_) {}
        if (top) w.setAlwaysOnTop(true, 'floating'); else w.setAlwaysOnTop(true, 'normal', -1); // level −1: just under app windows
      } else if (this.desktop.name === 'windows') {
        if (top) { w.setAlwaysOnTop(true, 'screen-saver'); w.focus(); } else { w.setAlwaysOnTop(false); this.desktop.lowerWidgets(w).catch(() => {}); }
      } else if (top) w.focus();
    } catch (e) { this.log('widget level', e.message); }
  }
  closeLayer(k) { const L = this.layers.get(k); if (!L) return; L.closing = true; if (L.win && !L.win.isDestroyed()) L.win.destroy(); this.layers.delete(k); }
  fit(L) {
    const w = L.win; if (!w || w.isDestroyed()) return;
    const want = L.display.bounds; const have = w.getBounds();
    if (Math.abs(have.x - want.x) > 1 || Math.abs(have.y - want.y) > 1 || Math.abs(have.width - want.width) > 1 || Math.abs(have.height - want.height) > 1) w.setBounds(want);
  }

  /** Send a display's widgets (and their manifests) to its layer. */
  layoutFor(k) {
    const L = this.layers.get(k); const b = L ? L.display.bounds : { width: 1440, height: 900 };
    return this.widgets.instances(k).sort((a, z) => a.z - z.z).map((i) => {
      const t = this.widgets.read(i.type); if (!t) return null;
      const c = this.widgets.clamp(i, b);
      return { ...c, name: t.manifest.name, url: `mural://widget/${i.type}/${t.manifest.page}?i=${i.id}`, permissions: t.manifest.permissions, resizable: t.manifest.size.resizable, minW: t.manifest.size.minW, minH: t.manifest.size.minH };
    }).filter(Boolean);
  }
  push(k) {
    const L = this.layers.get(k); if (!L || !L.win || L.win.isDestroyed()) return;
    const s = this.store.get();
    L.win.webContents.send('wl:layout', { display: k, editing: this.editing, widgets: this.layoutFor(k), location: s.location, platform: process.platform });
  }
  pushAll() { for (const k of this.layers.keys()) this.push(k); }

  // ------------------------------------------------------------------------------------------------- arranging
  setEditing(on) {
    this.editing = !!on;
    this.sync();
    for (const L of this.layers.values()) {
      if (!L.win || L.win.isDestroyed()) continue;
      if (L.frozen) this.thaw(L);
      L.win.setIgnoreMouseEvents(!this.editing); L.ignoring = !this.editing;
      this.placeLevel(L, this.editing);
      if (!this.editing && this.widgets.instances(L.key).length === 0) this.closeLayer(L.key);
    }
    this.pushAll(); this.updateHitLoop(); this.followHost(); this.emit('changed');
    return this.editing;
  }

  // ------------------------------------------------------------------------------------------------- click-through
  updateHitLoop() {
    const want = !this.editing && [...this.layers.values()].some((L) => L.win && !L.frozen);
    if (want && !this.hitTimer) this.hitTimer = setInterval(() => this.hitTest(), 33);
    if (!want && this.hitTimer) { clearInterval(this.hitTimer); this.hitTimer = 0; }
  }
  hitTest() {
    const p = this.e.screen.getCursorScreenPoint();
    for (const L of this.layers.values()) {
      if (!L.win || L.win.isDestroyed() || L.frozen) continue;
      const b = L.display.bounds; const x = p.x - b.x, y = p.y - b.y;
      const over = x >= 0 && y >= 0 && x < b.width && y < b.height && this.layoutFor(L.key).some((i) => x >= i.x - 3 && x < i.x + i.w + 3 && y >= i.y - 3 && y < i.y + i.h + 3);
      if (over === !L.ignoring) continue;
      L.ignoring = !over; L.win.setIgnoreMouseEvents(!over);
    }
  }

  // ------------------------------------------------------------------------------------------------- pausing with the wallpaper
  followHost() {
    if (this.editing) return;
    const st = this.host.status();
    for (const L of this.layers.values()) {
      if (!L.win || L.win.isDestroyed() || !L.ready) continue;
      const d = st.displays.find((x) => x.key === L.key);
      const reason = d ? d.reason : this.host.userPaused ? 'paused' : null;
      // "paused by you" only stops the wallpaper: widgets keep working. Anything that hides the desktop pauses them too.
      const hide = reason && reason !== 'paused' && reason !== 'battery';
      if (hide && !L.frozen) this.freeze(L); else if (!hide && L.frozen) this.thaw(L);
    }
    this.updateHitLoop();
  }
  freeze(L) {
    L.frozen = true; const wc = L.win.webContents; wc.send('wl:pause');
    if (!L.ignoring) { L.ignoring = true; L.win.setIgnoreMouseEvents(true); }
    setTimeout(() => { if (!L.frozen || !L.win || L.win.isDestroyed()) return; try { if (!wc.debugger.isAttached()) wc.debugger.attach('1.3'); wc.debugger.sendCommand('Page.setWebLifecycleState', { state: 'frozen' }).catch(() => {}); } catch (_) {} }, 150);
  }
  thaw(L) {
    L.frozen = false; const wc = L.win.webContents;
    try { if (wc.debugger.isAttached()) wc.debugger.sendCommand('Page.setWebLifecycleState', { state: 'active' }).catch(() => {}); } catch (_) {}
    setTimeout(() => { if (L.win && !L.win.isDestroyed()) wc.send('wl:resume'); }, 30);
  }

  // ------------------------------------------------------------------------------------------------- what widgets can ask for
  /** A call from a widget, already tied to its instance by the layer page. Permissions are checked here. */
  async call(instanceId, name, args = []) {
    const inst = this.widgets.instance(instanceId); if (!inst) throw new Error('This widget is no longer on the desktop');
    const t = this.widgets.read(inst.type); if (!t) throw new Error('Unknown widget');
    const perms = t.manifest.permissions; const need = (p) => { if (!perms.includes(p)) throw new Error(`This widget didn't ask for "${p}" permission`); };
    switch (name) {
      case 'storage.get': { const d = this.widgets.getData(inst.id); return args[0] == null ? d : d[args[0]]; }
      case 'storage.set': return this.widgets.setData(inst.id, args[0], args[1]);
      case 'settings.set': { this.widgets.update(inst.id, { settings: args[0] || {} }); this.emit('changed'); return this.widgets.instance(inst.id).settings; }
      case 'resize': {
        const w = Math.max(t.manifest.size.minW, Number(args[0]) || inst.w), h = Math.max(t.manifest.size.minH, Number(args[1]) || inst.h);
        this.widgets.update(inst.id, { w, h }); this.push(inst.display); return { w, h };
      }
      case 'system': need('system'); return this.systemStats();
      case 'location': need('location'); return this.store.get().location || null;
      case 'open': {
        need('open'); const target = String(args[0] || '');
        if (/^https?:\/\//i.test(target)) { await shell.openExternal(target); return true; }
        if (/^(\/|~\/|[a-z]:\\)/i.test(target)) { const err = await shell.openPath(target.replace(/^~/, os.homedir())); if (err) throw new Error(err); return true; }
        return this.openApp(target);
      }
      case 'suite': {
        const app = String(args[0] || ''); need('suite:' + app);
        let c = this.suite.get(app); if (!c) { c = require('./suitelink').connect(app, { retryMs: 3000, timeout: 4000 }); this.suite.set(app, c); }
        if (!c.up) { c.poke(); await new Promise((r) => { const t = setTimeout(r, 1500); c.once('up', () => { clearTimeout(t); r(); }); }); }
        const res = await Promise.race([c.call(String(args[1] || 'hello'), ...(args[2] || [])), new Promise((_, rej) => setTimeout(() => rej(new Error(`${app} isn't answering — is it running?`)), 4000))]);
        return res;
      }
      case 'openSettings': this.emit('settings', inst.id); return true;
      default: throw new Error('Unknown call ' + name);
    }
  }
  systemStats() {
    const cpus = os.cpus(); const now = cpus.map((c) => c.times); let pct = null;
    if (this.cpuPrev && this.cpuPrev.length === now.length) {
      let idle = 0, total = 0;
      now.forEach((t, i) => { const p = this.cpuPrev[i]; const d = (k) => t[k] - p[k]; const tot = d('user') + d('nice') + d('sys') + d('idle') + d('irq'); idle += d('idle'); total += tot; });
      pct = total > 0 ? Math.round((1 - idle / total) * 1000) / 10 : null;
    }
    this.cpuPrev = now;
    return { cpu: pct, cores: cpus.length, memTotal: os.totalmem(), memFree: os.freemem(), uptime: os.uptime(), load: os.loadavg(), platform: process.platform, host: os.hostname() };
  }
  openApp(name) {
    return new Promise((res, rej) => {
      const cb = (e) => (e ? rej(new Error(`Couldn't open ${name}`)) : res(true));
      if (process.platform === 'darwin') execFile('/usr/bin/open', ['-a', name], cb);
      else if (process.platform === 'win32') execFile('cmd.exe', ['/d', '/c', 'start', '""', name], { windowsHide: true }, cb);
      else rej(new Error('Opening apps works on Mac and Windows'));
    });
  }

  status() { return { editing: this.editing, layers: [...this.layers.values()].map((L) => ({ display: L.key, frozen: L.frozen, ignoring: L.ignoring, widgets: this.widgets.instances(L.key).length })) }; }
  stop() { clearInterval(this.hitTimer); clearInterval(this.fitTimer); for (const k of [...this.layers.keys()]) this.closeLayer(k); for (const c of this.suite.values()) try { c.stop(); } catch (_) {} }
}

module.exports = { WidgetLayer };
