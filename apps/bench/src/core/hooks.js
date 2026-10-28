// Bench — the small helper Bench puts inside an Electron app's main process when it starts the app (through the
// app's own debugger, before any of the app's code runs). It reports windows, console messages, crashes and native
// dialogs back to Bench, and gives Bench screenshots, input, menus and page access for each window.
// This function is turned into text and run inside the app, so it must not use anything from Bench's scope.
'use strict';

function benchHooks(require, opts) {
  if (globalThis.__bench) return { already: true };
  const electron = require('electron');
  const { app, BrowserWindow, dialog, Menu, screen, nativeImage } = electron;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const emit = (e) => { try { if (typeof globalThis.__benchEmit === 'function') globalThis.__benchEmit(JSON.stringify(e)); } catch (_) {} };
  const B = { v: 1, hidden: !!opts.hidden, intercept: opts.intercept !== false, mac: process.platform === 'darwin', answers: { open: [], save: [], message: [] }, pending: new Map(), dialogSeq: 0, created: Date.now() };

  // ── windows
  const alive = (w) => w && !w.isDestroyed();
  const info = (w) => {
    let b = { x: 0, y: 0, width: 0, height: 0 }; try { b = w.getContentBounds(); } catch (_) {}
    const wc = w.webContents;
    return { id: w.id, title: w.getTitle(), x: b.x, y: b.y, width: b.width, height: b.height, visible: w.isVisible(), focused: w.isFocused(), minimized: w.isMinimized(),
      url: wc.getURL(), loading: wc.isLoading(), crashed: wc.isCrashed ? wc.isCrashed() : false, parent: (w.getParentWindow() && w.getParentWindow().id) || null, devtools: wc.getType && wc.getType() !== 'window' };
  };
  B.windows = () => BrowserWindow.getAllWindows().filter(alive).filter((w) => !w.webContents.getURL().startsWith('devtools://')).map(info);
  B.win = (id) => {
    let w = id ? BrowserWindow.fromId(+id) : null;
    if (id && !alive(w)) throw new Error(`Window ${id} is closed. Open windows: ${B.windows().map((x) => `${x.id} “${x.title}”`).join(', ') || 'none'}`);
    if (!w) {
      const all = BrowserWindow.getAllWindows().filter(alive).filter((x) => !x.webContents.getURL().startsWith('devtools://'));
      w = all.find((x) => x.id === B.lastWin && x.isVisible()) || all.find((x) => x.isFocused()) || all.filter((x) => x.isVisible()).sort((a, b) => b.id - a.id)[0] || all[0];
    }
    if (!alive(w)) throw new Error('The app has no windows open');
    return w;
  };
  const offscreen = () => { let x = 0; try { for (const d of screen.getAllDisplays()) x = Math.min(x, d.bounds.x); } catch (_) {} return x - 30000; };
  const hide = (w) => {
    try { w.setOpacity(0); } catch (_) {}
    try { w.setIgnoreMouseEvents(true); } catch (_) {}
    try { w.setSkipTaskbar(true); } catch (_) {}
    try { if (w.setHiddenInMissionControl) w.setHiddenInMissionControl(true); } catch (_) {}
    try { const b = w.getBounds(); w.__benchPos = w.__benchPos || { x: b.x, y: b.y }; w.setPosition(offscreen(), 200); } catch (_) {}
  };
  const unhide = (w) => {
    try { w.setOpacity(1); } catch (_) {}
    try { w.setIgnoreMouseEvents(false); } catch (_) {}
    try { w.setSkipTaskbar(false); } catch (_) {}
    try { if (w.setHiddenInMissionControl) w.setHiddenInMissionControl(false); } catch (_) {}
    try { if (w.__benchPos) w.setPosition(w.__benchPos.x, w.__benchPos.y); else w.center(); } catch (_) {}
  };
  // out of sight: windows show without taking focus from whatever the person is doing
  const proto = BrowserWindow.prototype; const realShow = proto.show; const realFocus = proto.focus; const realMoveTop = proto.moveTop;
  proto.show = function () { if (B.hidden) { try { return this.showInactive(); } catch (_) {} } return realShow.apply(this, arguments); };
  proto.focus = function () { if (B.hidden) { try { this.webContents.focus(); } catch (_) {} return; } return realFocus.apply(this, arguments); };
  if (realMoveTop) proto.moveTop = function () { if (B.hidden) return; return realMoveTop.apply(this, arguments); };
  B.setHidden = (on) => {
    B.hidden = !!on;
    for (const w of BrowserWindow.getAllWindows().filter(alive)) (on ? hide : unhide)(w);
    try { if (app.dock) on ? app.dock.hide() : app.dock.show(); } catch (_) {}
    if (!on) { const w = BrowserWindow.getAllWindows().filter(alive).find((x) => x.isVisible()); if (w) { try { realShow.call(w); realFocus.call(w); } catch (_) {} } }
    return B.windows();
  };

  const hook = (w) => {
    if (!w || w.__bench) return; w.__bench = true;
    const wc = w.webContents; const win = w.id;
    // one declared parameter: newer Electron passes everything on the event (and warns about listeners that take more)
    wc.on('console-message', function (e) {
      const a = arguments; const lvl = a[1], msg = a[2], line = a[3], src = a[4];
      const level = typeof e.level === 'string' ? e.level : ['verbose', 'info', 'warning', 'error'][lvl] || 'info';
      emit({ type: 'log', source: 'window', win, level, text: e.message != null ? e.message : msg, url: e.sourceId != null ? e.sourceId : src, line: e.lineNumber != null ? e.lineNumber : line });
    });
    wc.on('render-process-gone', (e, d) => emit({ type: 'crash', win, reason: d.reason, exitCode: d.exitCode }));
    wc.on('unresponsive', () => emit({ type: 'hang', win }));
    wc.on('responsive', () => emit({ type: 'responsive', win }));
    wc.on('did-fail-load', (e, code, desc, url, main) => { if (code !== -3) emit({ type: 'load-failed', win, code, desc, url, main }); });
    wc.on('preload-error', (e, p, err) => emit({ type: 'log', source: 'preload', win, level: 'error', text: `Preload ${p} failed: ${(err && err.stack) || err}` }));
    wc.on('did-finish-load', () => emit({ type: 'loaded', win, url: wc.getURL(), title: w.getTitle() }));
    w.on('page-title-updated', () => emit({ type: 'window-changed', win }));
    w.on('show', () => emit({ type: 'window-changed', win }));
    w.on('closed', () => emit({ type: 'window-closed', win }));
    if (B.hidden) hide(w);
    emit({ type: 'window', win });
  };
  app.on('browser-window-created', (e, w) => hook(w));
  app.on('child-process-gone', (e, d) => { if (d.reason !== 'clean-exit') emit({ type: 'child-gone', kind: d.type, reason: d.reason, exitCode: d.exitCode, name: d.name || d.serviceName }); });
  if (B.hidden) app.whenReady().then(() => { try { if (app.dock) app.dock.hide(); } catch (_) {} });
  for (const w of BrowserWindow.getAllWindows()) hook(w);

  // ── native dialogs: never visible in a screenshot, so Bench answers them (from Claude or the person in Bench)
  const isWin = (x) => x && typeof x === 'object' && x.webContents && typeof x.getTitle === 'function';
  const real = {};
  for (const k of ['showOpenDialog', 'showOpenDialogSync', 'showSaveDialog', 'showSaveDialogSync', 'showMessageBox', 'showMessageBoxSync', 'showErrorBox']) real[k] = dialog[k];
  const describe = (kind, o) => ({ kind, title: o.title || '', message: o.message || '', detail: o.detail || '', buttons: o.buttons || [], defaultId: o.defaultId, cancelId: o.cancelId, type: o.type || '', defaultPath: o.defaultPath || '', filters: o.filters || [], properties: o.properties || [], checkboxLabel: o.checkboxLabel || '' });
  const autoAnswer = (kind, o) => {
    const q = B.answers[kind]; if (q && q.length) return q.shift();
    if (kind === 'message') return { button: o.cancelId != null ? o.cancelId : (o.buttons && o.buttons.length > 1 ? o.buttons.length - 1 : 0), auto: true };
    return { cancel: true, auto: true };
  };
  const toResult = (kind, a, o) => {
    if (kind === 'open') return a.cancel ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: a.paths || [] };
    if (kind === 'save') return a.cancel ? { canceled: true, filePath: '' } : { canceled: false, filePath: a.path || '' };
    return { response: a.button != null ? +a.button : 0, checkboxChecked: !!a.checkbox };
  };
  const ask = (kind, args, sync) => {
    const o = (isWin(args[0]) ? args[1] : args[0]) || {};
    const id = ++B.dialogSeq; const d = { id, ...describe(kind, o), at: Date.now() };
    if (kind === 'message' && o.type === 'error') emit({ type: 'log', source: 'app', level: 'error', text: `Error dialog: ${o.title ? o.title + ' — ' : ''}${o.message || ''}${o.detail ? ' (' + o.detail + ')' : ''}` });
    if (sync || (B.answers[kind] && B.answers[kind].length)) { const a = autoAnswer(kind, o); emit({ type: 'dialog', dialog: d, answered: a }); return toResult(kind, a, o); }
    return new Promise((resolve) => {
      const timer = setTimeout(() => { if (B.pending.has(id)) { B.pending.delete(id); const a = autoAnswer(kind, o); emit({ type: 'dialog-closed', id, answered: a, timeout: true }); resolve(toResult(kind, a, o)); } }, (opts.dialogTimeout || 300) * 1000);
      B.pending.set(id, { d, resolve: (a) => { clearTimeout(timer); B.pending.delete(id); emit({ type: 'dialog-closed', id, answered: a }); resolve(toResult(kind, a, o)); } });
      emit({ type: 'dialog', dialog: d, pending: true });
    });
  };
  if (B.intercept) {
    dialog.showOpenDialog = (...a) => ask('open', a, false);
    dialog.showOpenDialogSync = (...a) => { const r = ask('open', a, true); return r.canceled ? undefined : r.filePaths; };
    dialog.showSaveDialog = (...a) => ask('save', a, false);
    dialog.showSaveDialogSync = (...a) => { const r = ask('save', a, true); return r.canceled ? undefined : r.filePath; };
    dialog.showMessageBox = (...a) => ask('message', a, false);
    dialog.showMessageBoxSync = (...a) => ask('message', a, true).response;
    dialog.showErrorBox = (title, content) => emit({ type: 'log', source: 'app', level: 'error', text: `Error box: ${title} — ${content}` });
  }
  B.dialogs = () => [...B.pending.values()].map((p) => p.d);
  B.answer = (a) => {
    const kind = a.kind || 'message';
    const target = a.id ? B.pending.get(+a.id) : [...B.pending.values()].find((p) => p.d.kind === kind) || [...B.pending.values()][0];
    if (target) { target.resolve(a); return { answered: target.d }; }
    B.answers[kind] = B.answers[kind] || []; B.answers[kind].push(a); return { queued: kind };
  };

  // ── input through the window's own DevTools connection (works while the window is out of sight or unfocused)
  const dbg = async (wc) => {
    if (!wc.debugger.isAttached()) { wc.debugger.attach('1.3'); wc.__benchFocus = false; }
    if (!wc.__benchFocus) { wc.__benchFocus = true; try { await wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true }); } catch (_) {} }
    return wc.debugger;
  };
  B.input = async (id, events) => {
    const w = B.win(id); B.lastWin = w.id; const wc = w.webContents; let d = null;
    try { d = await dbg(wc); } catch (_) { d = null; }
    for (const ev of events) {
      if (ev.wait) { await sleep(ev.wait); continue; }
      if (d) { await d.sendCommand(ev.method, ev.params); continue; }
      // fallback when another debugger holds the window: Electron's own input events
      const p = ev.params || {};
      if (ev.method === 'Input.insertText') wc.insertText(p.text);
      else if (ev.method === 'Input.dispatchMouseEvent') {
        const type = { mouseMoved: 'mouseMove', mousePressed: 'mouseDown', mouseReleased: 'mouseUp', mouseWheel: 'mouseWheel' }[p.type];
        wc.sendInputEvent(type === 'mouseWheel' ? { type, x: p.x, y: p.y, deltaX: -p.deltaX, deltaY: -p.deltaY } : { type, x: p.x, y: p.y, button: p.button === 'none' ? 'left' : p.button, clickCount: p.clickCount || 1 });
      } else if (ev.method === 'Input.dispatchKeyEvent') {
        const type = p.type === 'keyUp' ? 'keyUp' : 'keyDown'; const mods = []; if (p.modifiers & 1) mods.push('alt'); if (p.modifiers & 2) mods.push('control'); if (p.modifiers & 4) mods.push('meta'); if (p.modifiers & 8) mods.push('shift');
        const kc = p.key === ' ' ? 'Space' : p.key.replace(/^Arrow/, '');
        wc.sendInputEvent({ type, keyCode: kc, modifiers: mods }); if (type === 'keyDown' && p.text) wc.sendInputEvent({ type: 'char', keyCode: p.text, modifiers: mods });
      }
    }
    return true;
  };

  // ── pictures
  B.capture = async (id, o) => {
    o = o || {}; const w = B.win(id); const b = w.getContentBounds();
    let img = await w.webContents.capturePage();
    // nothing painted (e.g. the system stopped drawing a hidden window): ask its DevTools for a fresh frame, briefly
    if (img.isEmpty()) {
      try {
        const d = await dbg(w.webContents);
        const r = await Promise.race([d.sendCommand('Page.captureScreenshot', { format: 'png' }), sleep(4000).then(() => null)]);
        if (r) img = nativeImage.createFromBuffer(Buffer.from(r.data, 'base64'));
      } catch (_) {}
    }
    if (img.isEmpty()) throw new Error(`Window “${w.getTitle()}” has nothing drawn yet${w.isVisible() ? '' : ' (it isn’t shown)'}`);
    // native: keep the screen's own pixel density (sharp on Retina) instead of shrinking to window points
    let tw = o.native ? img.getSize().width : b.width || img.getSize().width, th = o.native ? img.getSize().height : b.height || img.getSize().height;
    if (o.maxWidth && tw > o.maxWidth) { th = Math.round((th * o.maxWidth) / tw); tw = o.maxWidth; }
    const s = img.getSize(); if (s.width !== tw || s.height !== th) img = img.resize({ width: tw, height: th, quality: o.jpeg ? 'good' : 'best' });
    return { data: (o.jpeg ? img.toJPEG(o.quality || 72) : img.toPNG()).toString('base64'), width: tw, height: th, scale: (b.width || tw) / tw, win: w.id, title: w.getTitle() };
  };

  // ── page and app access
  B.exec = (id, code) => { const w = B.win(id); return w.webContents.executeJavaScript(code, true); };
  B.focus = (id) => { const w = B.win(id); B.lastWin = w.id; if (!B.hidden) { try { realShow.call(w); realFocus.call(w); } catch (_) {} } return info(w); };
  B.close = (id) => { const w = B.win(id); w.close(); return true; };
  B.reload = (id) => { const w = B.win(id); w.webContents.reload(); return true; };
  B.setSize = (id, width, height) => { const w = B.win(id); w.setContentSize(Math.round(width), Math.round(height)); return info(w); };
  B.quit = () => { setTimeout(() => app.quit(), 10); return true; };
  B.about = () => ({ name: app.getName(), version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, userData: app.getPath('userData'), ready: app.isReady(), windows: B.windows() });

  // ── the app menu (Electron menu shortcuts don't reach the page, so Bench presses them through the menu)
  const clean = (s) => String(s || '').replace(/&/g, '').replace(/(\.\.\.|…)$/, '').trim().toLowerCase();
  const walk = (menu, path, out) => { if (!menu) return out; for (const it of menu.items) { if (it.type === 'separator') continue; const label = it.label || (it.role ? it.role : ''); const p = path.concat(label); out.push({ item: it, path: p }); if (it.submenu) walk(it.submenu, p, out); } return out; };
  B.menu = () => {
    const m = Menu.getApplicationMenu(); if (!m) return [];
    const tree = (menu) => menu.items.filter((it) => it.type !== 'separator' && it.visible !== false).map((it) => ({ label: it.label || it.role || '', accelerator: it.accelerator ? String(it.accelerator) : '', enabled: it.enabled, checked: it.type === 'checkbox' || it.type === 'radio' ? it.checked : undefined, role: it.role || undefined, submenu: it.submenu ? tree(it.submenu) : undefined }));
    return tree(m);
  };
  B.menuClick = (path, id) => {
    const m = Menu.getApplicationMenu(); if (!m) throw new Error('This app has no menu');
    const want = path.map(clean); const all = walk(m, [], []);
    const hit = all.find((x) => x.path.length === want.length && x.path.every((p, i) => clean(p) === want[i])) || all.find((x) => clean(x.path[x.path.length - 1]) === want[want.length - 1] && !x.item.submenu);
    if (!hit) throw new Error(`No menu item “${path.join(' › ')}”`);
    if (!hit.item.enabled) throw new Error(`“${hit.path.join(' › ')}” is greyed out right now`);
    const w = B.win(id); hit.item.click(undefined, w, w.webContents);
    return hit.path.join(' › ');
  };
  B.menuAccel = (key, id) => { // key from Bench: "meta+shift|s" style
    const m = Menu.getApplicationMenu(); if (!m) return null;
    const norm = (acc) => {
      const parts = String(acc).split('+').map((p) => p.trim()).filter(Boolean); const k = parts.pop(); const mods = new Set();
      for (const p of parts) { const l = p.toLowerCase(); if (l === 'cmdorctrl' || l === 'commandorcontrol') mods.add(B.mac ? 'meta' : 'control'); else if (['cmd', 'command', 'super', 'meta'].includes(l)) mods.add('meta'); else if (['ctrl', 'control'].includes(l)) mods.add('control'); else if (['alt', 'option', 'altgr'].includes(l)) mods.add('alt'); else if (l === 'shift') mods.add('shift'); }
      const kk = { esc: 'Escape', return: 'Enter', up: 'Up', down: 'Down', left: 'Left', right: 'Right', space: 'Space', delete: 'Delete', backspace: 'Backspace', tab: 'Tab', plus: 'Plus' }[String(k).toLowerCase()] || (String(k).length === 1 ? String(k).toLowerCase() : k);
      return [...mods].sort().join('+') + '|' + kk;
    };
    const hit = walk(m, [], []).find((x) => x.item.accelerator && x.item.enabled && x.item.visible !== false && norm(x.item.accelerator) === key && !x.item.submenu);
    if (!hit) return null;
    if (hit.item.role && ['copy', 'paste', 'cut', 'selectall', 'selectAll', 'undo', 'redo', 'delete', 'pasteAndMatchStyle'].includes(hit.item.role)) return null; // editing keys go to the page
    const w = B.win(id); hit.item.click(undefined, w, w.webContents); return hit.path.join(' › ');
  };

  globalThis.__bench = B;
  return { ok: true, electron: process.versions.electron, ready: app.isReady() };
}

module.exports = { benchHooks };
