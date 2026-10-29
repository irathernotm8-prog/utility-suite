// Helm — Settings window.
'use strict';
const { icon, glyph, family, esc } = window.HelmUI;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
let B = null, S = null, ST = null, frame = null, view = 'home', pad = null;
const fam = () => { const d = ST && ST.devices.find((x) => x.active); return family(d ? d.kind : 'dualsense'); };
const isMac = () => B.platform === 'darwin';
const label = (id) => { const a = B.actions.find((x) => x.id === id); return a ? a.label : id; };
const bind = (layer, k) => (S.bindings[layer] && S.bindings[layer][k]) || B.defaults[layer][k] || 'none';
const layerBtn = () => Object.keys(B.defaults.base).find((k) => bind('base', k) === 'layer') || 'r2';

const NAV = [['home', 'Home', 'home'], ['buttons', 'Buttons', 'buttons'], ['pointer', 'Pointer & touchpad', 'pointer'], ['games', 'Games', 'game'], ['settings', 'Settings', 'gear']];
function nav() {
  $('#nav').innerHTML = NAV.map(([id, t, ic]) => `<button class="nav-btn${id === view ? ' on' : ''}" data-v="${id}">${icon(ic)}<span>${t}</span></button>`).join('');
  $$('.view').forEach((v) => v.classList.toggle('on', v.dataset.view === view));
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) { view = b.dataset.v; nav(); render(); } });

async function set(patch) { S = await window.helm.call('set', patch); }

// ---------------------------------------------------------------- side status
function stateText() {
  const dev = ST.devices.find((d) => d.active) || ST.devices[0];
  if (!ST.enabled) return { dot: '', t: 'Helm is off', s: 'Hold Create + Options on the controller, or switch it on here.' };
  if (ST.paused) return { dot: 'warn', t: 'Resting for a game', s: `${ST.paused} has the controller. Hold Create + Options to use Helm anyway.` };
  if (!ST.access.accessibility) return { dot: 'warn', t: 'Needs permission', s: 'Allow Helm in Accessibility so it can move the pointer.' };
  if (!dev) return { dot: '', t: 'No controller yet', s: 'Connect a DualSense or Xbox controller by USB or Bluetooth.' };
  return { dot: 'ok', t: 'Driving', s: `${dev.name}${dev.battery != null ? ` · ${dev.battery}%` : ''}` };
}
function side() {
  const st = stateText();
  $('#side-state').innerHTML = `<div class="row"><span class="dot ${st.dot}"></span><b class="grow">${esc(st.t)}</b><button class="switch${ST.enabled ? ' on' : ''}" id="side-toggle" title="Helm on / off"></button></div><div class="sub">${esc(st.s)}</div>`;
  $('#side-toggle').onclick = async () => { ST = await window.helm.call('setEnabled', !ST.enabled); refresh(); };
}

// ---------------------------------------------------------------- home
function home() {
  const dev = ST.devices.find((d) => d.active) || ST.devices[0];
  const st = stateText();
  $('#home-sub').textContent = dev ? `${dev.name} over ${dev.conn === 'usb' ? 'USB' : dev.conn === 'bt' ? 'Bluetooth' : 'XInput'}` : 'Waiting for a controller';
  const f = fam();
  const devCard = dev ? `<div class="dev"><span class="ico">${icon('controller')}</span><div class="grow"><b>${esc(dev.name)}</b><span class="muted">${icon(dev.conn === 'usb' ? 'usb' : 'bt')}${dev.conn === 'usb' ? 'USB' : dev.conn === 'bt' ? 'Bluetooth' : 'XInput'}${dev.touch ? ' · touchpad ready' : ''}</span></div>${dev.battery != null ? `<div style="text-align:right"><div class="tnum small">${dev.charging ? icon('bolt') : ''} ${dev.battery}%</div><div class="bat${dev.battery < 25 ? ' low' : ''}"><i style="width:${dev.battery}%"></i></div></div>` : ''}</div>`
    : `<div class="dev"><span class="ico">${icon('bt')}</span><div class="grow"><b>Connect a controller</b><span class="muted">PS5 DualSense, DualSense Edge, PS4 or Xbox — USB or Bluetooth</span></div></div>`;
  const banner = !ST.access.accessibility ? `<div class="banner">${icon('info')}<div class="grow"><b>Let Helm control the pointer</b>macOS asks you to allow Helm under Privacy &amp; Security › Accessibility. Turn Helm on there, then come back.</div><button class="btn primary sm" id="grant">Open Settings</button></div>` : '';
  const paused = ST.paused ? `<div class="paused-note"><div><b>${esc(ST.paused)}</b> has the controller, so Helm is resting.</div><div><button class="btn sm" id="override">Use Helm here anyway</button></div></div>` : '';
  const sheet = (title, ic, items) => `<div class="card"><div class="card-h">${icon(ic)}${title}</div><div class="map">${items.map(([g, t]) => `<div class="it"><span class="gls">${g}</span><span class="lab">${esc(t)}</span></div>`).join('')}</div></div>`;
  const base = ['cross', 'square', 'circle', 'triangle', 'l1', 'r1', 'create', 'options', 'ps'].map((k) => [glyph(k, f), label(bind('base', k))]);
  base.unshift([`<span class="gl txt wide">L stick</span>`, 'Move the pointer'], [`<span class="gl txt wide">R stick</span>`, 'Scroll'], [glyph('l2', f), 'Hold to slow the pointer for precision'], [glyph('up', f), 'D-pad: arrow keys']);
  const L = layerBtn();
  const layer = ['up', 'down', 'left', 'right', 'l1', 'r1', 'cross', 'circle', 'square', 'triangle', 'options', 'create'].map((k) => [glyph(k, f), label(bind('layer', k))]).filter(([, t]) => t !== 'Nothing');
  layer.splice(4, 0, [`<span class="gl txt wide">R stick</span>`, 'Volume']);
  const touch = [[icon('pointer'), 'One finger: move the pointer'], [icon('touch'), 'Tap or press: click · press and slide: drag'], [icon('touch'), 'Two-finger tap or press: right-click'],
    [icon('swipe'), 'Two fingers up / down: scroll'], [icon('swipe'), S.twoFingerSideways === 'desktops' ? 'Two-finger swipe sideways: switch desktops' : 'Two fingers sideways: scroll sideways']];
  $('#home').innerHTML = `${banner}
    <div class="card hero">
      <div class="hero-pad" id="pad-host"></div>
      <div class="hero-side">
        <div class="big-state"><button class="switch big${ST.enabled ? ' on' : ''}" id="big-toggle"></button><div><h2>${ST.enabled ? (ST.paused ? 'Resting' : 'Helm is on') : 'Helm is off'}</h2><div class="sub">${esc(st.s)}</div></div></div>
        ${devCard}${paused}
        <div class="chord">${glyph('create', f)}+${glyph('options', f)}<span>Hold both for a moment to turn Helm on or off from the couch.</span></div>
        <div class="tryrow"><button class="btn sm" data-try="keyboard">${icon('keyboard')}Keyboard</button><button class="btn sm" data-try="panel">${icon('grid')}Quick panel</button><button class="btn sm" data-try="hint">${icon('buttons')}Command layer</button><button class="btn sm" data-try="feel">${icon('wave')}Buzz</button></div>
      </div>
    </div>
    <div class="sec-h">How it works<span class="grow"></span></div>
    <div class="sheets">
      ${sheet('Everyday', 'controller', base)}
      ${sheet(`Hold ${L === 'r2' ? (f === 'xbox' ? 'RT' : 'R2') : 'the command button'}`, 'buttons', layer)}
      ${sheet('Touchpad', 'touch', touch)}
      ${sheet('On-screen keyboard', 'keyboard', [[glyph('triangle', f), 'Open it (any time)'], [`<span class="gl txt wide">L stick</span>`, 'Pick a key — or slide on the touchpad'], [glyph('cross', f), 'Type the key · press the touchpad too'], [glyph('square', f), 'Delete'], [glyph('triangle', f), 'Space'], [glyph('r2', f), 'Return'], [glyph('l2', f), 'Hold for capitals'], [glyph('circle', f), 'Done']])}
    </div>`;
  pad = new window.PadView($('#pad-host')); pad.update(frame, { on: ST.enabled && !ST.paused });
  $('#big-toggle').onclick = async () => { ST = await window.helm.call('setEnabled', !ST.enabled); refresh(); };
  const g = $('#grant'); if (g) g.onclick = async () => { await window.helm.call('openAccess'); };
  const o = $('#override'); if (o) o.onclick = async () => { await window.helm.call('override'); };
  $$('[data-try]').forEach((b) => { b.onclick = () => (b.dataset.try === 'feel' ? window.helm.call('testFeel') : window.helm.call('preview', b.dataset.try)); });
}

// ---------------------------------------------------------------- buttons
function options(layer, k) {
  const cur = bind(layer, k), def = B.defaults[layer][k];
  const groups = B.groups.map((gname) => {
    const acts = B.actions.filter((a) => a.group === gname && (layer === 'base' || a.id !== 'layer') && !(a.id === 'precision' && layer === 'layer'));
    return `<optgroup label="${gname}">${acts.map((a) => `<option value="${a.id}"${a.id === cur ? ' selected' : ''}${!a.available ? ' disabled' : ''}>${esc(a.label)}${a.id === def ? ' (default)' : ''}${!a.available ? ' — not on this computer' : ''}</option>`).join('')}</optgroup>`;
  }).join('');
  return `<select class="sel${cur !== def ? ' changed' : ''}" data-layer="${layer}" data-k="${k}">${groups}</select>`;
}
function buttons() {
  const f = fam(); const L = layerBtn();
  const edge = ST.devices.some((d) => d.kind === 'edge');
  const rows = B.bindable.filter(([k]) => edge || !/^(paddle|fn)/.test(k)).filter(([k, , x]) => f !== 'xbox' || x);
  const nm = (row) => (f === 'xbox' ? row[2] : row[1]);
  $('#buttons').innerHTML = `<div class="card binds">
    <div class="h">Button</div><div class="h">Everyday</div><div class="h">While holding ${glyph(L, f)}</div>
    ${rows.map((row, i) => { const k = row[0]; const last = i === rows.length - 1 ? ' last' : ''; const hot = frame && frame.b[k] ? ' hot' : '';
      return `<div class="c btn-name${last}${hot}" data-row="${k}">${glyph(k, f)}<span>${esc(nm(row))}</span></div><div class="c${last}${hot}" data-row="${k}">${options('base', k)}</div><div class="c${last}${hot}" data-row="${k}">${k === L ? '<span class="note">This is the command button</span>' : options('layer', k)}</div>`; }).join('')}
  </div>
  <p class="muted small" style="margin-top:14px">Sticks and the touchpad aren’t buttons: set them up under Pointer &amp; touchpad. Holding ${glyph('create', f)} + ${glyph('options', f)} always turns Helm on or off, whatever they’re set to.</p>`;
  $$('#buttons select').forEach((s) => { s.onchange = async () => { S = await window.helm.call('bind', s.dataset.layer, s.dataset.k, s.value); render(); }; });
}
$('#reset-binds').onclick = async () => { S = await window.helm.call('resetBindings'); render(); };

// ---------------------------------------------------------------- pointer & touchpad
function range(key, title, sub, min, max, step, fmt = (v) => v.toFixed(2)) {
  const v = S[key]; const p = ((v - min) / (max - min)) * 100;
  return `<div class="srow"><div class="txt"><b>${title}</b><span>${sub}</span></div><div class="ctl range"><input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${v}" style="--p:${p}%"><span class="val" data-val="${key}">${fmt(v)}</span></div></div>`;
}
function toggle(key, title, sub, invert = false) {
  const on = invert ? !S[key] : !!S[key];
  return `<div class="srow"><div class="txt"><b>${title}</b><span>${sub}</span></div><div class="ctl"><button class="switch${on ? ' on' : ''}" data-tk="${key}" data-inv="${invert ? 1 : 0}"></button></div></div>`;
}
function seg(key, title, sub, opts) {
  return `<div class="srow"><div class="txt"><b>${title}</b><span>${sub}</span></div><div class="ctl"><div class="seg">${opts.map(([v, t]) => `<button data-sk="${key}" data-sv="${v}" class="${S[key] === v ? 'on' : ''}">${t}</button>`).join('')}</div></div></div>`;
}
const pct = (v) => Math.round(v * 100) + '%';
const FMT = { pointerSpeed: pct, scrollSpeed: pct, touchSpeed: pct, touchScrollSpeed: pct, precisionStrength: pct, deadzone: pct, pointerCurve: (v) => v.toFixed(1) };
function pointer() {
  $('#pointer').innerHTML = `<div class="grid2">
    <div class="card" style="padding:4px 0"><div class="card-h" style="padding:12px 18px 0">${icon('pointer')}Sticks</div><div class="rows">
      ${range('pointerSpeed', 'Pointer speed', 'How fast the pointer moves at full tilt', 0.3, 2.5, 0.05, pct)}
      ${range('pointerCurve', 'Acceleration curve', 'Higher is gentler near the centre and quicker at the edge', 1, 3.5, 0.1, FMT.pointerCurve)}
      ${range('precisionStrength', 'Precision', 'How much holding L2 slows the pointer', 0.3, 0.95, 0.05, pct)}
      ${range('deadzone', 'Dead zone', 'Raise it if the pointer drifts on its own', 0.05, 0.35, 0.01, pct)}
      ${range('scrollSpeed', 'Scroll speed', 'Right stick', 0.3, 3, 0.05, pct)}
      ${toggle('invertScroll', 'Reverse stick scrolling', 'Push up to scroll down')}
      ${toggle('swapSticks', 'Swap sticks', 'Pointer on the right stick, scrolling on the left')}
    </div></div>
    <div class="card" style="padding:4px 0"><div class="card-h" style="padding:12px 18px 0">${icon('touch')}Touchpad</div><div class="rows">
      ${range('touchSpeed', 'Tracking speed', 'One finger moves the pointer, faster when you swipe quicker', 0.3, 2.5, 0.05, pct)}
      ${range('touchScrollSpeed', 'Scroll speed', 'Two fingers', 0.3, 3, 0.05, pct)}
      ${toggle('tapToClick', 'Tap to click', 'Tap with one finger to click, two to right-click')}
      ${toggle('naturalTouchScroll', 'Natural scrolling', 'Content follows your fingers, like a trackpad')}
      ${toggle('touchMomentum', 'Momentum', 'Scrolling glides on after a flick')}
      ${seg('twoFingerSideways', 'Two fingers sideways', 'What a sideways swipe does', [['desktops', 'Switch desktops'], ['scroll', 'Scroll sideways']])}
      ${toggle('rightHalfClick', 'Right side clicks right', 'Pressing the right part of the pad right-clicks')}
    </div></div></div>
    <p class="muted small" style="margin-top:14px">The touchpad needs a PlayStation controller (DualSense, DualSense Edge or DualShock 4). Xbox controllers get everything else.</p>`;
  wire('#pointer');
}
function wire(root) {
  $$(root + ' input[type=range]').forEach((r) => {
    r.oninput = () => { const v = Number(r.value); r.style.setProperty('--p', ((v - r.min) / (r.max - r.min)) * 100 + '%'); const l = $(`[data-val="${r.dataset.k}"]`); if (l) l.textContent = (FMT[r.dataset.k] || ((x) => x))(v); };
    r.onchange = () => set({ [r.dataset.k]: Number(r.value) });
  });
  $$(root + ' [data-tk]').forEach((b) => { b.onclick = async () => { const inv = b.dataset.inv === '1'; const now = !b.classList.contains('on'); b.classList.toggle('on', now); await set({ [b.dataset.tk]: inv ? !now : now }); if (b.dataset.rerender) render(); }; });
  $$(root + ' [data-sk]').forEach((b) => { b.onclick = async () => { await set({ [b.dataset.sk]: b.dataset.sv }); render(); }; });
}

// ---------------------------------------------------------------- games
function chips(key) {
  return `<div class="chips">${(S[key] || []).map((n, i) => `<span class="chip">${esc(n)}<button data-rm="${key}" data-i="${i}" title="Remove">${icon('x')}</button></span>`).join('') || '<span class="muted small">Nothing here yet</span>'}</div>
  <div class="add-row"><label class="field"><input data-add-in="${key}" placeholder="App name, bundle ID or .exe name"></label><button class="btn sm" data-add="${key}">${icon('plus')}Add</button>${ST.front && ST.front.name ? `<button class="btn sm ghost" data-add-front="${key}">Add “${esc(ST.front.name)}”</button>` : ''}</div>`;
}
function games() {
  const front = ST.front ? `<div class="front">${icon('windows')}<span class="grow">In front now: <b>${esc(ST.front.name || 'unknown')}</b>${ST.front.full ? ' · full screen' : ''}</span>${ST.paused ? `<span class="pill warn">Helm resting</span>` : `<span class="pill ok">Helm driving</span>`}</div>` : '';
  const claims = ST.claims.length ? ST.claims.map((c) => `<div class="front">${icon('link')}<span class="grow"><b>${esc(c.label)}</b> is holding the controller over the Utility Suite link</span></div>`).join('') : '';
  $('#games').innerHTML = `${front}${claims}
    <div class="card" style="padding:4px 0"><div class="rows">
      ${toggle('gameMode', 'Step aside for games', 'While a game is in front, Helm sends nothing — your controller only plays the game')}
      ${toggle('fullscreenGames', 'Treat full-screen apps as games', 'Anything filling the screen, except the apps on the “keep Helm on” list below')}
    </div></div>
    <div class="sec-h">Games<span class="grow"></span></div>
    <div class="card">${chips('gameApps')}<p class="muted small" style="margin:12px 0 0">Game Hub and its games are on the list from the start. A name matches the app’s name, its bundle ID on a Mac, or its .exe on Windows.</p></div>
    <div class="sec-h">Keep Helm on, even full screen<span class="grow"></span></div>
    <div class="card">${chips('keepApps')}</div>
    <div class="sec-h">Coming back in<span class="grow"></span></div>
    <div class="card small" style="display:grid;gap:8px;color:var(--fg-2)">
      <div style="display:flex;align-items:center;gap:8px">${glyph('create', fam())}+${glyph('options', fam())}<span>While Helm is resting, hold both to bring it back over that app (until you switch to another one).</span></div>
      <div>Suite apps can also hand the controller over: Game Hub calls <span class="code">helm.claim('gamehub', 15, 'Game Hub')</span> on the Utility Suite link every few seconds while a game runs, and <span class="code">helm.release('gamehub')</span> when it ends. A claim lapses on its own if the app quits.</div>
    </div>`;
  wire('#games');
  $$('[data-rm]').forEach((b) => { b.onclick = async () => { const k = b.dataset.rm; const list = [...S[k]]; list.splice(Number(b.dataset.i), 1); await set({ [k]: list }); render(); }; });
  const add = async (k, name) => { name = String(name || '').trim(); if (!name) return; const list = [...(S[k] || [])]; if (!list.some((x) => x.toLowerCase() === name.toLowerCase())) list.push(name); await set({ [k]: list }); render(); };
  $$('[data-add]').forEach((b) => { b.onclick = () => add(b.dataset.add, $(`[data-add-in="${b.dataset.add}"]`).value); });
  $$('[data-add-in]').forEach((i) => { i.onkeydown = (e) => { if (e.key === 'Enter') add(i.dataset.addIn, i.value); }; });
  $$('[data-add-front]').forEach((b) => { b.onclick = () => add(b.dataset.addFront, ST.front.name); });
}

// ---------------------------------------------------------------- settings
const SWATCHES = ['#38d6ff', '#7f7bff', '#ff5fd2', '#45d99b', '#ffb44f', '#ff5f6d', '#ffffff'];
async function settings() {
  $('#settings').innerHTML = `<div class="grid2">
    <div class="card" style="padding:4px 0"><div class="card-h" style="padding:12px 18px 0">${icon('gear')}General</div><div class="rows">
      ${seg('theme', 'Appearance', 'Helm’s windows', [['system', 'Auto'], ['dark', 'Dark'], ['light', 'Light']])}
      ${toggle('openAtLogin', 'Open at login', 'Helm starts quietly in the menu bar / tray')}
      ${toggle('keepRunning', 'Keep running when closed', 'Closing the window leaves Helm working')}
      ${toggle('showHud', 'Show what happened', 'A small note at the bottom of the screen: “Desktop →”, “Mission Control”…')}
      ${toggle('showHints', 'Command layer cheat sheet', 'Shows what each button does while you hold the command button')}
    </div></div>
    <div class="card" style="padding:4px 0"><div class="card-h" style="padding:12px 18px 0">${icon('controller')}Controller</div><div class="rows">
      ${toggle('haptics', 'Haptics', 'A small buzz when Helm turns on or off and when you switch desktops')}
      ${toggle('lightbar', 'Light bar', 'Colour the controller’s light while Helm is driving')}
      <div class="srow"><div class="txt"><b>Light colour</b><span>DualSense and DualShock 4</span></div><div class="ctl"><div class="swatches">${SWATCHES.map((c) => `<button class="sw${S.lightbarColor === c ? ' on' : ''}" data-col="${c}" style="background:${c}"></button>`).join('')}</div><input type="color" id="col" value="${S.lightbarColor}"></div></div>
    </div></div></div>
    <div class="sec-h">About<span class="grow"></span></div>
    <div class="card" style="display:grid;gap:12px">
      <div style="display:flex;align-items:center;gap:10px"><b>Helm ${esc(B.version)}</b><span class="muted small">${isMac() ? 'macOS' : 'Windows'}${B.demo ? ' · demo' : ''}</span><span class="grow"></span>
        <span class="pill ${ST.helper ? 'ok' : 'warn'}">${icon(ST.helper ? 'check' : 'info')}Input ${ST.helper ? 'ready' : 'starting'}</span>
        ${isMac() ? `<span class="pill ${ST.access.accessibility ? 'ok' : 'warn'}">${icon(ST.access.accessibility ? 'check' : 'info')}Accessibility</span>` : ''}
        <span class="pill ${ST.linked ? 'acc' : ''}">${icon('link')}Suite link${ST.linked ? ` · ${ST.linked}` : ''}</span>
        <button class="btn sm" id="show-logs">Diagnostics</button><button class="btn sm" id="quit">Quit Helm</button></div>
      <pre class="logs" id="logs" hidden></pre>
    </div>`;
  wire('#settings');
  $$('[data-col]').forEach((b) => { b.onclick = async () => { await set({ lightbarColor: b.dataset.col }); render(); }; });
  $('#col').onchange = async (e) => { await set({ lightbarColor: e.target.value }); render(); };
  $('#quit').onclick = () => window.helm.call('quit');
  $('#show-logs').onclick = async () => { const l = $('#logs'); l.hidden = !l.hidden; if (!l.hidden) l.textContent = (await window.helm.call('logs')).join('\n') || 'Nothing logged yet.'; };
}

// ---------------------------------------------------------------- live updates
function render() {
  nav(); side();
  if (view === 'home') home(); else if (view === 'buttons') buttons(); else if (view === 'pointer') pointer(); else if (view === 'games') games(); else settings();
}
let refreshT = null;
function refresh() { clearTimeout(refreshT); refreshT = setTimeout(render, 40); }
let hotKeys = '';
window.helm.on('frame', (f) => {
  frame = f;
  if (view === 'home' && pad) pad.update(f, { on: ST.enabled && !ST.paused });
  if (view === 'buttons') {
    const k = f ? Object.keys(f.b).filter((x) => f.b[x]).join(',') : '';
    if (k !== hotKeys) { hotKeys = k; $$('#buttons [data-row]').forEach((c) => c.classList.toggle('hot', !!(f && f.b[c.dataset.row]))); }
  }
});
window.helm.on('status', (s) => {
  const before = JSON.stringify([ST.enabled, ST.paused, ST.access, ST.devices.map((d) => [d.key, d.active, d.battery, d.conn]), ST.front && ST.front.name, ST.claims.length, ST.helper, ST.linked]);
  ST = s;
  const after = JSON.stringify([ST.enabled, ST.paused, ST.access, ST.devices.map((d) => [d.key, d.active, d.battery, d.conn]), ST.front && ST.front.name, ST.claims.length, ST.helper, ST.linked]);
  if (before !== after && !(document.activeElement && /INPUT|SELECT/.test(document.activeElement.tagName))) refresh(); else side();
});
window.helm.on('settings', (s) => { S = s; });
// the app in front isn't pushed (it changes all the time); the Games page asks for it
setInterval(async () => {
  if (view !== 'games') return;
  const s = await window.helm.call('status'); const changed = (ST.front && ST.front.name) !== (s.front && s.front.name);
  ST = s; if (changed && !(document.activeElement && document.activeElement.tagName === 'INPUT')) refresh();
}, 2000);

(async () => {
  B = await window.helm.call('bootstrap'); S = B.settings; ST = B.status;
  document.documentElement.dataset.platform = B.platform;
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const theme = () => { document.documentElement.dataset.theme = S.theme === 'system' ? (mq.matches ? 'dark' : 'light') : S.theme; };
  theme(); mq.addEventListener('change', theme);
  window.helm.on('settings', (s) => { S = s; theme(); });
  render(); document.body.classList.add('ready');
})();
