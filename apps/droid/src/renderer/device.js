// A phone window: the frame, the live screen (WebGL), touch/keyboard/wheel input, drag and drop, toolbar and panels.
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtBytes = (n) => (!n ? '0 B' : n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`);
const call = (...a) => window.droid.call(...a);
const send = (...a) => window.droid.send(...a);
const ID = new URLSearchParams(location.search).get('id');
const MAC = window.droid.platform === 'darwin';

let CITIES = [];
const V = { dev: null, styles: null, state: 'starting', rotation: 'PORTRAIT', L: null, gl: null, latest: null, gotFrame: false, panel: null, audio: true, rec: false, onTop: false, filesDir: '/sdcard/', startedAt: Date.now(), z: 0, dl: null, err: null };

// ───────────────────────── boot
async function boot() {
  const theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  const hello = await call('view:hello', ID);
  V.dev = hello.device;
  V.styles = hello.styles;
  CITIES = hello.cities;
  V.state = hello.session?.state || hello.device.state || 'starting';
  V.audio = V.dev.options.audio;
  document.title = V.dev.name;
  document.body.classList.add(`a-${V.dev.accent}`);
  buildTools();
  V.gl = makeRenderer($('#screen'));
  layout();
  renderOverlay();
  bindInput();
  bindDrop();
  window.droid.on('view:frame', onFrame);
  window.droid.on('view:audio', onAudio);
  window.droid.on('view:error', (e) => { V.err = e; V.gotFrame = false; renderOverlay(); });
  window.droid.on('device:state', (s) => { if (s.id !== ID) return; V.state = s.state; if (s.state === 'starting') { V.err = null; V.gotFrame = false; V.startedAt = Date.now(); } renderOverlay(); updateTools(); if (s.state === 'running' && V.panel) renderPanel(); });
  window.droid.on('sdk:progress', (p) => { if (p.deviceId !== ID) return; V.dl = p.phase === 'done' ? null : p; renderOverlay(); });
  window.droid.on('toast', (t) => { if (t.device === ID) toast(t); });
  window.droid.on('files:changed', (f) => { if (f.id === ID && V.panel === 'files') renderPanel(); });
  window.droid.on('apps:changed', (f) => { if (f.id === ID && V.panel === 'apps') renderPanel(); });
  window.droid.on('devices:changed', async () => { const h = await call('view:hello', ID).catch(() => null); if (h) { const resize = h.device.screen.w !== V.dev.screen.w || h.device.screen.h !== V.dev.screen.h || h.device.style !== V.dev.style || h.device.finish !== V.dev.finish; V.dev = h.device; if (resize) layout(); } });
  new ResizeObserver(() => layout()).observe($('#stageBox'));
  setInterval(() => { if (!V.gotFrame) renderOverlay(); }, 1000);
  document.body.classList.add('ready');
  $('#screen').focus();
}

// ───────────────────────── layout
function layout() {
  const box = $('#stageBox').getBoundingClientRect();
  if (!box.width || !box.height || !V.dev) return;
  const fr = $('#frame');
  const fin = finishColors();
  V.L = Frames.renderFrame(fr, { style: V.dev.style, finish: fin, natW: V.dev.screen.w, natH: V.dev.screen.h, rotation: V.rotation, box: { w: box.width, h: box.height }, onButton: hwButton });
  const fx = (box.width - V.L.frame.w) / 2, fy = (box.height - V.L.frame.h) / 2;
  fr.style.left = `${fx}px`; fr.style.top = `${fy}px`;
  const sc = V.L.screen;
  for (const el of [$('#screen'), $('#overlay'), $('#drop')]) {
    Object.assign(el.style, { left: `${fx + sc.x}px`, top: `${fy + sc.y}px`, width: `${sc.w}px`, height: `${sc.h}px`, borderRadius: `${sc.r}px` });
  }
  const c = $('#screen');
  const dpr = window.devicePixelRatio || 1;
  const turned = V.rotation === 'LANDSCAPE' || V.rotation === 'REVERSE_LANDSCAPE';
  const devW = turned ? V.dev.screen.h : V.dev.screen.w, devH = turned ? V.dev.screen.w : V.dev.screen.h;
  const pw = Math.min(devW, Math.round(sc.w * dpr)), ph = Math.min(devH, Math.round(sc.h * dpr));
  if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; if (V.latest) draw(V.latest); }
  send('view:want', ID, { width: pw, height: ph });
}
function finishColors() { const st = V.styles[V.dev.style] || V.styles.pixel; return st.finishes.find((f) => f.id === V.dev.finish) || st.finishes[0]; }

// Resize the window to hug the frame (after rotating or opening a panel), keeping the current scale.
function fitWindow(k = V.L && V.L.k) {
  if (!k) return;
  const nf = Frames.layoutFrame(V.dev.style, V.dev.screen.w, V.dev.screen.h, V.rotation, { w: 1e5, h: 1e5 });
  const fw = (nf.frame.w / nf.k) * k, fh = (nf.frame.h / nf.k) * k;
  const tools = $('#tools');
  const tw = tools.getBoundingClientRect().width || 48;
  const th = tools.scrollHeight || 0;   // keep the whole toolbar visible, even for a short landscape frame
  const w = Math.round(fw + tw + 10 + 24 + (V.panel ? 330 : 0));
  const h = Math.round(Math.max(fh, th, V.panel ? 520 : 0) + 24);
  send('view:fit', ID, w, h);
}

// ───────────────────────── rendering frames
function makeRenderer(canvas) {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true });
  if (!gl) return null;
  const vs = 'attribute vec2 p; varying vec2 uv; void main(){ uv = vec2((p.x+1.0)/2.0, 1.0-(p.y+1.0)/2.0); gl_Position = vec4(p,0,1); }';
  const fs = 'precision mediump float; varying vec2 uv; uniform sampler2D t; void main(){ gl_FragColor = vec4(texture2D(t, uv).rgb, 1.0); }';
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  let tw = 0, th = 0;
  return {
    draw(w, h, data) {
      if (w !== tw || h !== th) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, w, h, 0, gl.RGB, gl.UNSIGNED_BYTE, data); tw = w; th = h; }
      else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGB, gl.UNSIGNED_BYTE, data);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
  };
}
let ctx2d = null, rgba = null;
function draw(f) {
  if (V.gl) return V.gl.draw(f.w, f.h, f.data);
  // 2D fallback when WebGL isn't available
  const c = $('#screen');
  ctx2d = ctx2d || c.getContext('2d');
  if (!rgba || rgba.width !== f.w || rgba.height !== f.h) rgba = new ImageData(f.w, f.h);
  const d = rgba.data, s = f.data;
  for (let i = 0, j = 0; i < s.length; i += 3, j += 4) { d[j] = s[i]; d[j + 1] = s[i + 1]; d[j + 2] = s[i + 2]; d[j + 3] = 255; }
  const tmp = draw.tmp || (draw.tmp = document.createElement('canvas'));
  tmp.width = f.w; tmp.height = f.h; tmp.getContext('2d').putImageData(rgba, 0, 0);
  ctx2d.imageSmoothingQuality = 'high';
  ctx2d.drawImage(tmp, 0, 0, c.width, c.height);
}
let rafPending = false;
function onFrame(f) {
  if (!f.data || !f.w) { send('view:ack', ID); return; }
  if (f.rotation && f.rotation !== V.rotation) { const k = V.L && V.L.k; V.rotation = f.rotation; fitWindow(k); layout(); }
  V.latest = f;
  if (!V.gotFrame) { V.gotFrame = true; V.err = null; renderOverlay(); }
  if (!rafPending) {
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; if (V.latest) draw(V.latest); send('view:ack', ID); });
  }
}

// ───────────────────────── sound (16-bit stereo PCM, 44.1 kHz)
let actx = null, playAt = 0;
function onAudio(pcm) {
  if (!V.audio) return;
  if (!actx) { actx = new AudioContext({ sampleRate: 44100, latencyHint: 'interactive' }); playAt = 0; }
  const bytes = pcm instanceof Uint8Array ? pcm : new Uint8Array(pcm);
  const n = Math.floor(bytes.byteLength / 4);
  if (!n) return;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, n * 4);
  let silent = true;
  const buf = actx.createBuffer(2, n, 44100);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  for (let i = 0; i < n; i++) { const l = dv.getInt16(i * 4, true), r = dv.getInt16(i * 4 + 2, true); if (l || r) silent = false; L[i] = l / 32768; R[i] = r / 32768; }
  if (silent && playAt < actx.currentTime) return;
  const src = actx.createBufferSource(); src.buffer = buf; src.connect(actx.destination);
  const now = actx.currentTime;
  if (playAt < now + 0.02 || playAt > now + 0.35) playAt = now + 0.05;   // resync if we fell behind or drifted ahead
  src.start(playAt); playAt += buf.duration;
}

// ───────────────────────── overlay (starting, downloading, errors)
function renderOverlay() {
  const o = $('#overlay');
  if (V.gotFrame && !V.err) { o.classList.remove('show'); o.innerHTML = ''; o.style.background = 'transparent'; return; }
  o.classList.add('show');
  o.style.background = 'radial-gradient(120% 80% at 50% 110%, rgba(73,224,138,.22), transparent 60%), #05080a';
  const secs = Math.floor((Date.now() - V.startedAt) / 1000);
  const t = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  if (V.err) {
    o.innerHTML = `<div class="boot err">${icon('warning', 34)}<b>${V.err.failed ? "Couldn't start" : 'The device stopped'}</b><span style="color:#ffd7dc">${esc(V.err.reason || '')}</span>
      <div class="row" style="gap:6px;margin-top:4px"><button class="btn sm primary" data-o="retry">Try again</button><button class="btn sm" data-o="cold">Cold boot</button><button class="btn sm" data-o="close">Close</button></div></div>`;
  } else if (V.state === 'downloading' || V.dl) {
    const p = V.dl || {};
    const pct = p.total ? Math.round((p.got / p.total) * 100) : 0;
    o.innerHTML = `<div class="boot"><img src="../../build/icon.png" alt=""><b>${p.phase === 'unpack' ? 'Unpacking' : 'Downloading'} ${esc(p.label || 'Android')}</b><div class="bar ${p.phase !== 'download' ? 'indet' : ''}"><i style="width:${pct}%"></i></div><span>${p.total ? `${fmtBytes(p.got)} of ${fmtBytes(p.total)}` : 'Getting ready…'}</span></div>`;
  } else if (V.state === 'stopping') {
    o.innerHTML = `<div class="boot"><img src="../../build/icon.png" alt=""><b>Saving and turning off…</b></div>`;
  } else {
    const phase = V.state === 'starting' ? 'Starting the emulator' : 'Starting Android';
    o.innerHTML = `<div class="boot"><img src="../../build/icon.png" alt=""><b>${phase}…</b><div class="bar indet"><i></i></div><span>${t}${secs > 40 ? ' · the first start takes longest' : ''}</span></div>`;
  }
  o.onclick = (e) => {
    const b = e.target.closest('[data-o]'); if (!b) return;
    if (b.dataset.o === 'retry') { V.err = null; V.startedAt = Date.now(); renderOverlay(); call('device:start', ID).catch(showErr); }
    if (b.dataset.o === 'cold') { V.err = null; V.startedAt = Date.now(); renderOverlay(); call('device:start', ID, { coldBoot: true }).catch(showErr); }
    if (b.dataset.o === 'close') send('view:win', ID, 'close');
  };
}
const showErr = (e) => { V.err = { reason: e.message, failed: true }; renderOverlay(); };

// ───────────────────────── input
function toDev(e) {
  const r = $('#screen').getBoundingClientRect();
  const u = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), v = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
  const p = Frames.toDevice(u, v, V.rotation, V.dev.screen.w, V.dev.screen.h);
  return { x: Math.round(Math.min(V.dev.screen.w - 1, p.x)), y: Math.round(Math.min(V.dev.screen.h - 1, p.y)) };
}
function bindInput() {
  const c = $('#screen');
  let down = null, pending = null, raf = false, pinch = null;
  const flush = () => {
    raf = false;
    if (!pending) return;
    const p = pending; pending = null;
    if (pinch) send('view:touch', ID, touches(p, 1));
    else send('view:mouse', ID, p.x, p.y, 1);
  };
  const center = () => ({ x: V.dev.screen.w / 2, y: V.dev.screen.h / 2 });
  const touches = (p, pressure) => { const cc = center(); return [{ x: p.x, y: p.y, identifier: 1, pressure: pressure ? 1 : 0 }, { x: Math.round(2 * cc.x - p.x), y: Math.round(2 * cc.y - p.y), identifier: 2, pressure: pressure ? 1 : 0 }]; };
  c.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    c.focus();
    c.setPointerCapture(e.pointerId);
    down = toDev(e);
    pinch = e.altKey ? true : null;
    c.classList.toggle('pinch', !!pinch);
    if (pinch) send('view:touch', ID, touches(down, 1)); else send('view:mouse', ID, down.x, down.y, 1);
  });
  c.addEventListener('pointermove', (e) => {
    if (!down) return;
    pending = toDev(e);
    if (!raf) { raf = true; requestAnimationFrame(flush); }
  });
  const up = (e) => {
    if (!down) return;
    flush();
    const p = toDev(e);
    if (pinch) send('view:touch', ID, touches(p, 0)); else send('view:mouse', ID, p.x, p.y, 0);
    down = null; pinch = null; c.classList.remove('pinch');
  };
  c.addEventListener('pointerup', up);
  c.addEventListener('pointercancel', up);
  c.addEventListener('contextmenu', (e) => { e.preventDefault(); key('GoBack'); });
  let wx = 0, wy = 0, wraf = false;
  c.addEventListener('wheel', (e) => {
    e.preventDefault();
    const k = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 400 : 1;
    wx += -e.deltaX * k; wy += -e.deltaY * k;
    if (!wraf) { wraf = true; requestAnimationFrame(() => { wraf = false; const dx = Math.round(wx * 1.2), dy = Math.round(wy * 1.2); wx = 0; wy = 0; if (dx || dy) send('view:wheel', ID, dx, dy); }); }
  }, { passive: false });

  window.addEventListener('keydown', onKey);
}
const KEYMAP = { Enter: 'Enter', Backspace: 'Backspace', Tab: 'Tab', Delete: 'Delete', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', Escape: 'GoBack', PageUp: 'PageUp', PageDown: 'PageDown', Home: 'Home', End: 'End' };
function onKey(e) {
  if (e.target.closest && e.target.closest('#panel, input, textarea, select')) return;
  const mod = MAC ? e.metaKey : e.ctrlKey;
  if (mod) {
    const k = e.key.toLowerCase();
    if (k === 'v') { e.preventDefault(); return paste(); }
    if (k === 's') { e.preventDefault(); return screenshot(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); return rotate(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); return rotate(1); }
    if (e.shiftKey && k === 'h') { e.preventDefault(); return key('GoHome'); }
    if (e.shiftKey && k === 'r') { e.preventDefault(); return key('AppSwitch'); }
    if (k === 'a' || k === 'c' || k === 'x' || k === 'z') { e.preventDefault(); return ctrlCombo(k); }
    return;   // leave other shortcuts (quit, close window) to the system
  }
  if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;
  e.preventDefault();
  if (KEYMAP[e.key]) return key(KEYMAP[e.key]);
  if (e.key.length === 1) {
    if (e.key.charCodeAt(0) < 128) key(e.key);
    else send('view:text', ID, e.key);
  }
}
// Ctrl+A/C/X/Z on Android: send the key with Control held down.
function ctrlCombo(k) { send('view:key', ID, 'Control', 'keydown'); key(k); send('view:key', ID, 'Control', 'keyup'); }
function key(k) { send('view:key', ID, k, 'keypress'); }
async function paste() {
  const t = await navigator.clipboard.readText().catch(() => '');
  if (!t) return;
  if (/^[\x20-\x7e\n\t]*$/.test(t) && t.length <= 1000) send('view:text', ID, t.replace(/\r/g, ''));
  else { ctrlCombo('v'); }
}
function hwButton(which) { if (which === 'power') key('Power'); else key(which === 'volUp' ? 'AudioVolumeUp' : 'AudioVolumeDown'); }

// ───────────────────────── drag and drop onto the screen
function bindDrop() {
  let depth = 0;
  const drop = $('#drop');
  const show = (on) => { drop.hidden = !on; };
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
    if (e.target.closest && e.target.closest('#panel')) return;
    depth++; show(true);
    $('#dropIc').innerHTML = icon('download', 24);
    $('#dropTitle').textContent = 'Drop to install or copy';
    $('#dropSub').textContent = 'Apps (APK, APKM, XAPK, APKS) install. Other files go to Downloads.';
  });
  window.addEventListener('dragleave', (e) => { if (e.target.closest && e.target.closest('#panel')) return; depth = Math.max(0, depth - 1); if (!depth) show(false); });
  window.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    if (e.target.closest && e.target.closest('#panel')) return;
    e.preventDefault(); depth = 0; show(false);
    const paths = [...e.dataTransfer.files].map((f) => window.droid.pathFor(f)).filter(Boolean);
    if (!paths.length) return;
    try { await call('view:drop', ID, paths); }
    catch (err) { toast({ kind: 'bad', title: "Couldn't drop that here", text: err.message }); }
  });
}

// ───────────────────────── toolbar
const TOOLS = [
  ['power', 'power', 'Power'], ['volUp', 'volUp', 'Volume up'], ['volDown', 'volDown', 'Volume down'], '-',
  ['rotL', 'rotL', `Rotate left (${MAC ? '⌘' : 'Ctrl+'}←)`], ['rotR', 'rotR', `Rotate right (${MAC ? '⌘' : 'Ctrl+'}→)`], '-',
  ['back', 'back', 'Back (Esc or right-click)'], ['home', 'home', `Home (${MAC ? '⌘⇧' : 'Ctrl+Shift+'}H)`], ['recents', 'recents', `Recent apps (${MAC ? '⌘⇧' : 'Ctrl+Shift+'}R)`], '-',
  ['shot', 'camera', `Screenshot (${MAC ? '⌘' : 'Ctrl+'}S)`], ['rec', 'record', 'Record the screen'], '-',
  ['files', 'folder', 'Files'], ['apps', 'apps', 'Apps'], ['location', 'pin', 'Location'], ['network', 'wifi', 'Network'], ['more', 'moreV', 'More'], '-',
  ['min', 'minimize', 'Minimize'], ['close', 'power', 'Turn off and close'],
];
function buildTools() {
  $('#tools').innerHTML = TOOLS.map((t) => (t === '-' ? '<div class="sep"></div>' : `<button class="icon-btn ${t[0] === 'close' ? 'close' : ''}" data-t="${t[0]}" title="${esc(t[2])}">${icon(t[0] === 'close' ? 'close' : t[1], 18)}</button>`)).join('');
  $('#tools').onclick = (e) => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    const t = b.dataset.t;
    ({
      power: () => key('Power'), volUp: () => key('AudioVolumeUp'), volDown: () => key('AudioVolumeDown'),
      rotL: () => rotate(-1), rotR: () => rotate(1), back: () => key('GoBack'), home: () => key('GoHome'), recents: () => key('AppSwitch'),
      shot: screenshot, rec: record, files: () => togglePanel('files'), apps: () => togglePanel('apps'), location: () => togglePanel('location'), network: () => togglePanel('network'), more: () => togglePanel('more'),
      min: () => send('view:win', ID, 'minimize'), close: () => send('view:win', ID, 'close'),
    })[t]?.();
    if (!['files', 'apps', 'location', 'network', 'more'].includes(t)) $('#screen').focus();
  };
  updateTools();
}
function updateTools() {
  const live = V.state === 'running';
  $$('#tools [data-t]').forEach((b) => { if (!['min', 'close', 'more'].includes(b.dataset.t)) b.disabled = !live && !['location', 'network'].includes(b.dataset.t); b.classList.toggle('on', b.dataset.t === V.panel); });
  const r = $('#tools [data-t="rec"]'); if (r) r.classList.toggle('rec', V.rec);
  const n = $('#tools [data-t="network"]'); if (n && V.dev) n.innerHTML = icon(V.dev.network.mode === 'isolated' ? 'wifiOff' : V.dev.network.mode === 'proxy' ? 'route' : 'wifi', 18);
}

const ROTS = [0, 90, 180, -90];
async function rotate(dir) {
  V.z = (V.z + dir + 4) % 4;
  await call('view:rotate', ID, ROTS[V.z]).catch((e) => toast({ kind: 'bad', title: "Couldn't rotate", text: e.message }));
}
async function screenshot() {
  try {
    const file = await call('view:screenshot', ID);
    flash();
    toast({ kind: 'ok', title: 'Screenshot saved and copied', text: file.split(/[\\/]/).pop(), reveal: file });
  } catch (e) { toast({ kind: 'bad', title: "Couldn't take a screenshot", text: e.message }); }
}
function flash() {
  const o = $('#overlay'); const f = document.createElement('div');
  Object.assign(f.style, { position: 'absolute', inset: 0, background: '#fff', opacity: 0.7, transition: 'opacity .35s' });
  o.appendChild(f); requestAnimationFrame(() => (f.style.opacity = 0)); setTimeout(() => f.remove(), 400);
}
async function record() {
  try {
    if (!V.rec) { await call('view:record', ID, true); V.rec = true; updateTools(); toast({ kind: 'busy', id: 'rec', title: 'Recording the screen', text: 'Click the record button again to stop (3 minutes at most).' }); V.recTimer = setTimeout(() => V.rec && record(), 178000); }
    else {
      V.rec = false; updateTools(); clearTimeout(V.recTimer);
      toast({ kind: 'busy', id: 'rec', title: 'Saving the recording…' });
      const file = await call('view:record', ID, false);
      toast({ kind: 'ok', id: 'rec', title: 'Recording saved', text: file ? file.split(/[\\/]/).pop() : '', reveal: file });
    }
  } catch (e) { V.rec = false; updateTools(); toast({ kind: 'bad', id: 'rec', title: 'Recording failed', text: e.message }); }
}

// ───────────────────────── panels
function togglePanel(name) {
  V.panel = V.panel === name ? null : name;
  if (V.map) { V.map.remove(); V.map = null; }
  $('#panel').hidden = !V.panel;
  updateTools();
  fitWindow();
  if (V.panel) renderPanel();
}
function panelShell(title, body, foot = '') {
  $('#panel').innerHTML = `<div class="p-head"><b>${title}</b><button class="icon-btn sm" data-p="close" title="Close">${icon('close', 15)}</button></div><div class="p-body">${body}</div>${foot ? `<div class="p-foot">${foot}</div>` : ''}`;
  $('[data-p="close"]').onclick = () => togglePanel(V.panel);
}
async function renderPanel() {
  const p = V.panel; if (!p) return;
  const live = V.state === 'running';
  if (!live && ['files', 'apps'].includes(p)) return panelShell(p === 'files' ? 'Files' : 'Apps', `<div class="muted small">Available once Android has started.</div>`);
  ({ files: panelFiles, apps: panelApps, location: panelLocation, network: panelNetwork, more: panelMore })[p]();
}

// files
async function panelFiles() {
  const dir = V.filesDir;
  const parts = dir.replace(/^\/|\/$/g, '').split('/').filter(Boolean);
  const crumbs = parts.map((p, i) => `<button data-dir="/${parts.slice(0, i + 1).join('/')}/">${esc(i === 0 && p === 'sdcard' ? 'Phone storage' : p)}</button>`).join(`<span class="muted">›</span>`);
  panelShell('Files', `<div class="crumbs">${crumbs}</div><div id="fList"><div class="row muted small"><span class="spin"></span>Loading…</div></div>`,
    `<button class="btn sm" data-f="upload">${icon('upload', 14)}Add files</button><button class="btn sm" data-f="mkdir">${icon('plus', 14)}Folder</button><span class="grow"></span><button class="icon-btn sm" data-f="refresh" title="Refresh">${icon('refresh', 15)}</button>`);
  const panel = $('#panel');
  let items = [];
  try { items = await call('files:list', ID, dir); } catch (e) { $('#fList').innerHTML = `<div class="small" style="color:var(--bad)">${esc(e.message)}</div>`; }
  const ic = (f) => (f.dir ? 'folder' : /\.(png|jpe?g|gif|webp|heic)$/i.test(f.name) ? 'image' : /\.(mp4|mov|mkv|webm|3gp)$/i.test(f.name) ? 'video' : /\.(mp3|m4a|wav|ogg|flac)$/i.test(f.name) ? 'music' : 'file');
  $('#fList').innerHTML = items.length ? items.map((f) => `<div class="fitem ${f.dir ? 'dir' : ''}" data-path="${esc(f.path)}" data-isdir="${f.dir ? 1 : 0}" ${f.dir ? '' : 'draggable="true"'} title="${f.dir ? 'Open' : 'Drag to your desktop to copy'}">
      <span class="fi">${icon(ic(f), 16)}</span><div class="meta"><b>${esc(f.name)}</b><span>${f.dir ? f.mtime : `${fmtBytes(f.size)} · ${f.mtime}`}</span></div>
      <div class="acts">${f.dir ? '' : `<button class="icon-btn xs" data-f="save" title="Save to your computer">${icon('download', 14)}</button>`}<button class="icon-btn xs" data-f="del" title="Delete">${icon('trash', 14)}</button></div></div>`).join('')
    : `<div class="muted small" style="padding:10px 4px">This folder is empty. Drop files here to copy them in.</div>`;
  panel.onclick = async (e) => {
    const cr = e.target.closest('[data-dir]'); if (cr) { V.filesDir = cr.dataset.dir; return panelFiles(); }
    const fb = e.target.closest('[data-f]');
    const it = e.target.closest('.fitem');
    if (fb) {
      const a = fb.dataset.f;
      if (a === 'refresh') return panelFiles();
      if (a === 'mkdir') return void prompt2('New folder name');
      if (a === 'upload') { const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true; inp.onchange = async () => { const ps = [...inp.files].map((f) => window.droid.pathFor(f)); toast({ kind: 'busy', id: 'up', title: 'Copying…', device: ID }); await call('files:push', ID, ps, dir).catch((er) => toast({ kind: 'bad', id: 'up', title: 'Copy failed', text: er.message })); toast({ kind: 'ok', id: 'up', title: `Copied ${ps.length} file${ps.length === 1 ? '' : 's'}` }); panelFiles(); }; inp.click(); return; }
      if (a === 'save' && it) { const f = await call('files:save', ID, it.dataset.path).catch((er) => toast({ kind: 'bad', title: 'Save failed', text: er.message })); if (f) toast({ kind: 'ok', title: 'Saved', text: f.split(/[\\/]/).pop(), reveal: f }); return; }
      if (a === 'del' && it) { await call('files:delete', ID, it.dataset.path).catch((er) => toast({ kind: 'bad', title: 'Delete failed', text: er.message })); return panelFiles(); }
      return;
    }
    if (it && it.dataset.isdir === '1') { V.filesDir = it.dataset.path + '/'; panelFiles(); }
  };
  $$('.fitem[draggable="true"]', panel).forEach((el) => {
    el.addEventListener('mouseenter', () => send('files:prepull', ID, el.dataset.path), { once: true });
    el.addEventListener('dragstart', (e) => { e.preventDefault(); send('files:drag', ID, el.dataset.path); });
  });
  const body = $('.p-body', panel);
  body.ondragover = (e) => { e.preventDefault(); body.style.background = 'color-mix(in srgb, var(--acc) 6%, transparent)'; };
  body.ondragleave = () => { body.style.background = ''; };
  body.ondrop = async (e) => {
    e.preventDefault(); e.stopPropagation(); body.style.background = '';
    const ps = [...e.dataTransfer.files].map((f) => window.droid.pathFor(f)).filter(Boolean);
    if (!ps.length) return;
    toast({ kind: 'busy', id: 'up', title: 'Copying…' });
    await call('files:push', ID, ps, dir).then(() => toast({ kind: 'ok', id: 'up', title: `Copied ${ps.length} file${ps.length === 1 ? '' : 's'}` })).catch((er) => toast({ kind: 'bad', id: 'up', title: 'Copy failed', text: er.message }));
    panelFiles();
  };
}
function prompt2(label) {
  // Electron windows have no prompt(); a tiny inline one
  const host = $('#panel .p-body');
  const row = document.createElement('div'); row.className = 'row'; row.style.marginBottom = '8px';
  row.innerHTML = `<input class="input" placeholder="${esc(label)}" style="flex:1;height:30px"><button class="btn sm primary">Create</button>`;
  host.prepend(row);
  const inp = $('input', row); inp.focus();
  const go = async () => { const v = inp.value.trim(); row.remove(); if (v) { await call('files:mkdir', ID, V.filesDir + v.replace(/[\\/]/g, '')).catch(() => {}); panelFiles(); } };
  $('button', row).onclick = go; inp.onkeydown = (e) => { if (e.key === 'Enter') go(); if (e.key === 'Escape') row.remove(); };
  return null;
}

// apps
const TILE = ['#49e08a', '#63a8ff', '#ff8a5c', '#a78bfa', '#ff6f91', '#ffbf47', '#1fc6b4', '#9aa3b5'];
function tile(name) { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0; const col = TILE[h % TILE.length]; const short = name.split('.').filter((x) => !['com', 'org', 'net', 'io', 'app', 'me', 'de', 'android', 'google'].includes(x)); return `<span class="ai" style="background:linear-gradient(140deg, ${col}, color-mix(in srgb, ${col} 55%, #000))">${esc((short[0] || name)[0].toUpperCase())}</span>`; }
async function panelApps() {
  const play = V.dev.image.tag === 'google_apis_playstore';
  panelShell('Apps', `<div id="aList"><div class="row muted small"><span class="spin"></span>Loading…</div></div>`,
    `${play ? `<button class="btn sm" data-ap="play">${icon('store', 14)}Play Store</button>` : ''}<button class="btn sm" data-ap="lib">${icon('box', 14)}From library</button><button class="btn sm" data-ap="dash">${icon('search', 14)}Find apps</button>`);
  const [pk, lib] = await Promise.all([call('apps:installed', ID).catch(() => []), call('library:list').catch(() => [])]);
  const list = pk || [];
  $('#aList').innerHTML = `<div class="p-section">Installed by you · ${list.length}</div>${list.length ? list.map((a) => `<div class="app-row" data-pkg="${esc(a.id)}">${tile(a.id)}<div class="meta"><b>${esc(prettyPkg(a.id))}</b><span>${esc(a.id)}</span></div><div class="acts"><button class="icon-btn xs" data-ap="launch" title="Open">${icon('play', 13)}</button><button class="icon-btn xs" data-ap="uninstall" title="Uninstall">${icon('trash', 14)}</button></div></div>`).join('') : `<div class="muted small">Nothing yet. Drop an APK onto the screen, or use the buttons below.</div>`}
    <div id="libPick" hidden><div class="p-section">Your app library</div>${lib.length ? lib.map((f) => `<div class="app-row" data-file="${esc(f.file)}">${tile(f.package || f.name)}<div class="meta"><b>${esc(f.label || f.package || f.name)}</b><span>${f.version ? `v${esc(f.version)} · ` : ''}${fmtBytes(f.size)}</span></div><div class="acts" style="opacity:1"><button class="btn xs" data-ap="install">Install</button></div></div>`).join('') : '<div class="muted small">Your library is empty.</div>'}</div>`;
  $('#panel').onclick = async (e) => {
    const b = e.target.closest('[data-ap]'); if (!b) return;
    const a = b.dataset.ap, row = b.closest('[data-pkg],[data-file]');
    try {
      if (a === 'play') return call('apps:openPlay', ID, null);
      if (a === 'dash') return send('view:win', ID, 'dashboard');
      if (a === 'lib') { const lp = $('#libPick'); lp.hidden = !lp.hidden; if (!lp.hidden) lp.scrollIntoView({ behavior: 'smooth' }); return; }
      if (a === 'launch') return call('apps:launch', ID, row.dataset.pkg);
      if (a === 'uninstall') { b.innerHTML = '<span class="spin"></span>'; await call('apps:uninstall', ID, row.dataset.pkg); return; }
      if (a === 'install') { b.disabled = true; b.innerHTML = '<span class="spin"></span>'; await call('library:install', row.dataset.file, ID); b.textContent = 'Installed'; }
    } catch (err) { toast({ kind: 'bad', title: 'Something went wrong', text: err.message }); panelApps(); }
  };
}
const prettyPkg = (p) => { const parts = p.split('.'); const last = parts[parts.length - 1]; const pick = ['android', 'app', 'mobile', 'client'].includes(last) && parts.length > 1 ? parts[parts.length - 2] : last; return pick.charAt(0).toUpperCase() + pick.slice(1).replace(/_/g, ' '); };

// location
async function panelLocation() {
  const l = V.dev.location;
  const opt = (m, ic, t, s) => `<button class="opt ${l.mode === m ? 'on' : ''}" data-lm="${m}">${icon(ic, 18)}<div><b>${t}</b><span>${s}</span></div></button>`;
  panelShell('Location', `
    ${opt('actual', 'globe', 'Actual', 'Roughly where you are')}
    ${opt('simulated', 'route', 'Simulated', 'A city, still or on the move')}
    ${opt('manual', 'pin', 'Pick on map', 'Any exact spot')}
    ${l.mode === 'simulated' ? `<div class="p-section">City</div><select class="select" id="lCity" style="width:100%">${CITIES.map((c) => `<option value="${c.id}" ${l.city === c.id ? 'selected' : ''}>${esc(c.name)}, ${c.country}</option>`).join('')}</select>
      <div class="p-section">Movement</div><div class="seg full">${[['still', 'Still'], ['walk', 'Walking'], ['drive', 'Driving']].map(([v, t]) => `<button data-mo="${v}" class="${l.motion === v ? 'on' : ''}">${t}</button>`).join('')}</div>` : ''}
    ${l.mode === 'manual' ? `<div class="p-section">Place</div><div class="row"><input class="input" id="lQ" placeholder="Search or lat, lng" style="flex:1;height:30px"><button class="btn sm" data-lq>Find</button></div><div class="pmap" id="lMap"></div><div class="hint" id="lCoords" style="margin-top:6px">${Number.isFinite(l.lat) ? `${l.lat.toFixed(5)}, ${l.lng.toFixed(5)}` : 'Click the map to move the device.'}</div>` : ''}
    ${l.mode === 'actual' ? `<div class="hint" id="lApprox" style="margin-top:6px">Working out your approximate location…</div>` : ''}
    <div class="hint" style="margin-top:12px">Changes apply right away${V.state === 'running' ? '' : ' when the device starts'} and are saved with the device.</div>`);
  if (l.mode === 'actual') call('location:approximate').then((r) => { const h = $('#lApprox'); if (h) h.textContent = `About ${r.label}.`; }).catch(() => { const h = $('#lApprox'); if (h) h.textContent = 'Could not work it out right now.'; });
  if (l.mode === 'manual' && window.L) {
    const start = Number.isFinite(l.lat) ? [l.lat, l.lng] : [29.7604, -95.3698];
    V.map = L.map('lMap').setView(start, Number.isFinite(l.lat) ? 13 : 10);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(V.map);
    let mk = Number.isFinite(l.lat) ? L.marker(start).addTo(V.map) : null;
    const setPin = (lat, lng, label) => { if (mk) mk.setLatLng([lat, lng]); else mk = L.marker([lat, lng]).addTo(V.map); V.map.setView([lat, lng], Math.max(V.map.getZoom(), 13)); $('#lCoords').textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}${label ? ` · ${label.split(',').slice(0, 2).join(',')}` : ''}`; saveLoc({ mode: 'manual', lat, lng, label: label || '' }); };
    V.map.on('click', (e) => setPin(e.latlng.lat, e.latlng.lng, ''));
    const find = async () => { const q = $('#lQ').value.trim(); if (!q) return; const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/); if (m) return setPin(+m[1], +m[2], ''); const r = await call('location:search', q).catch(() => []); if (r[0]) setPin(r[0].lat, r[0].lng, r[0].label); else toast({ kind: 'bad', title: 'No place found', text: q }); };
    $('[data-lq]').onclick = find; $('#lQ').onkeydown = (e) => { if (e.key === 'Enter') find(); };
    setTimeout(() => V.map && V.map.invalidateSize(), 60);
  }
  $('#panel').onclick = (e) => {
    const m = e.target.closest('[data-lm]'); if (m) { const patch = { mode: m.dataset.lm }; if (patch.mode === 'simulated' && !l.city) patch.city = 'houston'; if (patch.mode === 'manual' && !Number.isFinite(l.lat)) { V.dev.location = { ...l, ...patch }; return panelLocation(); } return saveLoc(patch, true); }
    const mo = e.target.closest('[data-mo]'); if (mo) return saveLoc({ motion: mo.dataset.mo }, true);
  };
  const cs = $('#lCity'); if (cs) cs.onchange = () => saveLoc({ city: cs.value }, true);
}
async function saveLoc(patch, rerender) {
  V.dev.location = { ...V.dev.location, ...patch };
  try { const r = await call('devices:update', ID, { location: V.dev.location }); V.dev = r.device; } catch (e) { toast({ kind: 'bad', title: "Couldn't change location", text: e.message }); }
  if (rerender) { if (V.map) { V.map.remove(); V.map = null; } panelLocation(); }
}

// network
function panelNetwork() {
  const n = V.dev.network;
  const opt = (m, ic, t, s) => `<button class="opt ${n.mode === m ? 'on' : ''}" data-nm="${m}">${icon(ic, 18)}<div><b>${t}</b><span>${s}</span></div></button>`;
  panelShell('Network', `
    ${opt('internet', 'wifi', 'Internet', 'Online through your computer')}
    ${opt('isolated', 'shield', 'Isolated', 'No internet at all')}
    ${opt('proxy', 'route', 'Proxy', 'All traffic through an HTTP proxy')}
    ${n.mode === 'proxy' ? `<div class="p-section">Proxy address</div><div class="row"><input class="input" id="nProxy" value="${esc(n.proxy || '')}" placeholder="host:port" style="flex:1;height:30px"><button class="btn sm" data-np>Save</button></div>` : ''}
    <div class="hint" style="margin-top:12px">Switching between Internet and Isolated works right away (airplane mode). Full isolation and proxy changes take effect the next time the device starts.</div>
    ${V.state === 'running' ? `<button class="btn sm" style="margin-top:10px" data-nr>${icon('refresh', 14)}Restart now to apply</button>` : ''}`);
  $('#panel').onclick = async (e) => {
    const m = e.target.closest('[data-nm]');
    if (m) { if (m.dataset.nm === 'proxy' && !n.proxy) { V.dev.network = { ...n, mode: 'proxy' }; return panelNetwork(); } return saveNet({ ...n, mode: m.dataset.nm }); }
    if (e.target.closest('[data-np]')) return saveNet({ ...n, mode: 'proxy', proxy: $('#nProxy').value.trim() });
    if (e.target.closest('[data-nr]')) { V.gotFrame = false; V.startedAt = Date.now(); renderOverlay(); return call('device:restart', ID).catch(showErr); }
  };
}
async function saveNet(net) {
  if (net.mode === 'proxy' && !net.proxy) return toast({ kind: 'bad', title: 'Add the proxy address first' });
  try { const r = await call('devices:update', ID, { network: net }); V.dev = r.device; updateTools(); toast({ kind: 'ok', title: { internet: 'Back online', isolated: 'Device is isolated', proxy: 'Proxy saved' }[net.mode], text: r.restartNeeded ? 'Restart the device to fully apply this.' : '' }); }
  catch (e) { toast({ kind: 'bad', title: "Couldn't change the network", text: e.message }); }
  panelNetwork();
}

// more
async function panelMore() {
  const d = V.dev;
  const live = V.state === 'running';
  V.onTop = await call('view:onTop', ID).catch(() => false);
  panelShell('More', `
    <div class="p-section">This window</div>
    <div class="row" style="justify-content:space-between;margin-bottom:8px"><span class="small">Sound</span><button class="switch ${V.audio ? 'on' : ''}" data-m="audio"></button></div>
    <div class="row" style="justify-content:space-between;margin-bottom:8px"><span class="small">Keep on top</span><button class="switch ${V.onTop ? 'on' : ''}" data-m="top"></button></div>
    <button class="btn sm" data-m="dash" style="width:100%">${icon('dashboard', 14)}Open the dashboard</button>
    <div class="p-section">Saved states</div>
    <div id="snaps" class="small muted">${live ? '<span class="spin"></span>' : 'Available while the device is running.'}</div>
    ${live ? `<div class="row" style="margin-top:8px"><input class="input" id="snapName" placeholder="Name, e.g. Logged in" style="flex:1;height:30px"><button class="btn sm" data-m="snapSave">Save</button></div>` : ''}
    <div class="p-section">Battery</div>
    <div class="row"><input type="range" class="range" id="bat" min="1" max="100" value="100" ${live ? '' : 'disabled'}><span class="small tnum" id="batV" style="width:36px;text-align:right">100%</span></div>
    <div class="row" style="justify-content:space-between;margin-top:6px"><span class="small">Charging</span><button class="switch on" data-m="charge" ${live ? '' : 'disabled'}></button></div>
    <div class="p-section">Text message</div>
    <div class="col" style="gap:6px"><input class="input" id="smsFrom" placeholder="From, e.g. 555-0100" style="height:30px" ${live ? '' : 'disabled'}><div class="row"><input class="input" id="smsText" placeholder="Message" style="flex:1;height:30px" ${live ? '' : 'disabled'}><button class="btn sm" data-m="sms" ${live ? '' : 'disabled'}>Send</button></div></div>
    <div class="p-section">Device</div>
    <dl class="kv"><dt>Android</dt><dd>${esc(d.image.name)} · ${esc(d.image.tagName)}</dd><dt>Screen</dt><dd>${d.screen.w}×${d.screen.h} · ${d.screen.dpi} dpi</dd><dt>Memory</dt><dd>${d.ramMB >= 1024 ? `${+(d.ramMB / 1024).toFixed(1)} GB` : `${d.ramMB} MB`}</dd><dt>Cores</dt><dd>${d.cores}</dd><dt>Storage</dt><dd>${d.storageGB} GB</dd></dl>
    <div class="row" style="margin-top:12px;gap:6px"><button class="btn sm" data-m="restart" ${live ? '' : 'disabled'}>${icon('refresh', 14)}Restart</button><button class="btn sm" data-m="cold">${icon('boot', 14)}Cold boot</button></div>`);
  if (live) loadSnaps();
  const bat = $('#bat');
  let charging = true;
  if (bat) { bat.oninput = () => ($('#batV').textContent = `${bat.value}%`); bat.onchange = () => call('view:battery', ID, +bat.value, charging).catch(() => {}); }
  $('#panel').onclick = async (e) => {
    const b = e.target.closest('[data-m]'); if (!b || b.disabled) return;
    const a = b.dataset.m;
    try {
      if (a === 'audio') { V.audio = !V.audio; b.classList.toggle('on', V.audio); await call('view:audio', ID, V.audio); if (!V.audio && actx) { actx.close(); actx = null; } }
      if (a === 'top') { send('view:win', ID, 'top'); V.onTop = !V.onTop; b.classList.toggle('on', V.onTop); }
      if (a === 'dash') send('view:win', ID, 'dashboard');
      if (a === 'charge') { charging = !charging; b.classList.toggle('on', charging); call('view:battery', ID, +bat.value, charging).catch(() => {}); }
      if (a === 'sms') { const from = $('#smsFrom').value.trim() || '5550100', text = $('#smsText').value.trim(); if (!text) return; await call('view:sms', ID, from, text); $('#smsText').value = ''; toast({ kind: 'ok', title: 'Message sent to the device' }); }
      if (a === 'snapSave') { const n = $('#snapName').value.trim() || undefined; b.disabled = true; b.innerHTML = '<span class="spin"></span>'; await call('view:snapshot', ID, 'save', n); $('#snapName').value = ''; toast({ kind: 'ok', title: 'State saved', text: n || '' }); loadSnaps(); b.disabled = false; b.textContent = 'Save'; }
      if (a === 'snapLoad') { toast({ kind: 'busy', id: 'snap', title: 'Restoring…' }); await call('view:snapshot', ID, 'load', b.dataset.sid); toast({ kind: 'ok', id: 'snap', title: 'Restored', text: b.dataset.sid }); }
      if (a === 'snapDel') { await call('view:snapshot', ID, 'delete', b.dataset.sid); loadSnaps(); }
      if (a === 'restart') { V.gotFrame = false; V.startedAt = Date.now(); renderOverlay(); await call('device:restart', ID); }
      if (a === 'cold') { V.gotFrame = false; V.startedAt = Date.now(); renderOverlay(); await call('device:restart', ID, { coldBoot: true }); }
    } catch (err) { toast({ kind: 'bad', title: 'Something went wrong', text: err.message }); }
  };
}
async function loadSnaps() {
  const box = $('#snaps'); if (!box) return;
  try {
    const list = (await call('view:snapshots', ID)).filter((s) => s.id !== 'default_boot');
    box.innerHTML = list.length ? list.map((s) => `<div class="app-row"><span class="ai" style="background:var(--panel-3);color:var(--fg-2)">${icon('snapshot', 15)}</span><div class="meta"><b>${esc(s.id.replace(/_/g, ' '))}</b><span>${s.size ? fmtBytes(s.size) : ''}${s.created ? ` · ${new Date(s.created * 1000).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}` : ''}</span></div><div class="acts" style="opacity:1"><button class="btn xs" data-m="snapLoad" data-sid="${esc(s.id)}">Restore</button><button class="icon-btn xs" data-m="snapDel" data-sid="${esc(s.id)}" title="Delete">${icon('trash', 13)}</button></div></div>`).join('')
      : 'Save the device exactly as it is now (open apps, signed-in accounts) and come back to it any time.';
  } catch (e) { box.textContent = `Saved states aren't available: ${e.message}`; }
}

// ───────────────────────── toasts
const timers = {};
function toast(t) {
  const host = $('#toasts');
  const id = t.id || `t${Date.now()}${Math.random()}`;
  let el = host.querySelector(`[data-tid="${CSS.escape(id)}"]`);
  if (!el) { el = document.createElement('div'); el.dataset.tid = id; host.appendChild(el); }
  const ic = t.kind === 'ok' ? icon('check', 16, 't-ic') : t.kind === 'bad' ? icon('warning', 16, 't-ic') : t.kind === 'busy' ? '<span class="spin t-ic" style="color:var(--acc)"></span>' : icon('info', 16, 't-ic');
  el.className = `toast ${t.kind || ''}`;
  el.innerHTML = `${ic}<div class="grow"><div class="t-title">${esc(t.title)}</div>${t.text ? `<div class="t-text">${esc(t.text)}</div>` : ''}${t.reveal ? '<button class="link-btn" style="margin-top:3px">Show in folder</button>' : ''}</div>`;
  if (t.reveal) el.querySelector('.link-btn').onclick = () => call('shell:reveal', t.reveal);
  el.onclick = (e) => { if (!e.target.closest('.link-btn')) el.remove(); };
  clearTimeout(timers[id]);
  timers[id] = setTimeout(() => el.remove(), t.kind === 'busy' ? 180000 : t.kind === 'bad' ? 10000 : 4000);
}

window.addEventListener('DOMContentLoaded', () => boot().catch((e) => { document.body.classList.add('ready'); document.body.innerHTML = `<pre style="background:#300;color:#fcc;padding:12px">${esc(e.stack || e.message)}</pre>`; }));
