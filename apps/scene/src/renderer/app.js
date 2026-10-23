// Scene — the window. Talks to the main process only through window.scene.call / window.scene.on.
'use strict';
const api = window.scene;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ic = (n, s = 16) => `<svg class="ic" width="${s}" height="${s}"><use href="#i-${n}"/></svg>`;
const gl = (n, s = 16) => `<svg class="ic" width="${s}" height="${s}"><use href="#g-${n || 'spark'}"/></svg>`;
const clone = (o) => JSON.parse(JSON.stringify(o));
const uid = (p = '') => p + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const COLORS = ['amber', 'rose', 'violet', 'blue', 'teal', 'green', 'red', 'slate'];
const GLYPHS = ['spark', 'briefcase', 'gamepad', 'ball', 'tv', 'film', 'target', 'brush', 'code', 'chart', 'mic', 'music', 'coffee', 'book', 'home', 'moon'];
const APP_HUES = ['#ffb648', '#ff6f91', '#9d86ff', '#4fa3ff', '#2fd3c0', '#56d67a', '#ff8a5c', '#c86bff', '#38d4e0', '#e6c84f', '#ff5f5f', '#7fb2ff'];
const ZONES = {
  left: { x: 0, y: 0, w: 0.5, h: 1 }, right: { x: 0.5, y: 0, w: 0.5, h: 1 },
  'left-third': { x: 0, y: 0, w: 1 / 3, h: 1 }, 'center-third': { x: 1 / 3, y: 0, w: 1 / 3, h: 1 }, 'right-third': { x: 2 / 3, y: 0, w: 1 / 3, h: 1 },
  'left-two-thirds': { x: 0, y: 0, w: 2 / 3, h: 1 }, 'right-two-thirds': { x: 1 / 3, y: 0, w: 2 / 3, h: 1 },
  'top-left': { x: 0, y: 0, w: 0.5, h: 0.5 }, 'top-right': { x: 0.5, y: 0, w: 0.5, h: 0.5 }, 'bottom-left': { x: 0, y: 0.5, w: 0.5, h: 0.5 }, 'bottom-right': { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
  center: { x: 0.15, y: 0.1, w: 0.7, h: 0.8 }
};
const ZONE_LABEL = { left: 'Left half', right: 'Right half', 'left-third': 'Left third', 'center-third': 'Middle third', 'right-third': 'Right third', 'left-two-thirds': 'Left two thirds', 'right-two-thirds': 'Right two thirds', 'top-left': 'Top left', 'top-right': 'Top right', 'bottom-left': 'Bottom left', 'bottom-right': 'Bottom right', center: 'Centre' };
const STATE_LABEL = { normal: 'Placed', maximized: 'Fills the screen', fullscreen: 'Full screen', minimized: 'Minimised' };

let B = null;          // bootstrap data
let view = 'scenes';
const icons = {};      // path -> data url | null
let iconQueue = new Set(); let iconTimer = null;

// ---------------------------------------------------------------- small helpers
const isMac = () => B.platform === 'darwin';
const hueOf = (name) => { let h = 0; for (const c of String(name || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return APP_HUES[h % APP_HUES.length]; };
const initials = (name) => String(name || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
function appIcon(a, cls = 'appic') {
  const p = a && a.path;
  if (p && icons[p]) return `<img class="${cls}" src="${esc(icons[p])}" alt="">`;
  if (p && !(p in icons)) wantIcon(p);
  return `<span class="${cls} ph" style="--ac:${hueOf(a && a.name)}">${esc(initials(a && a.name))}</span>`;
}
function wantIcon(p) { iconQueue.add(p); clearTimeout(iconTimer); iconTimer = setTimeout(loadIcons, 60); }
async function loadIcons() {
  const list = [...iconQueue]; iconQueue = new Set(); if (!list.length) return;
  for (const p of list) icons[p] = icons[p] || null;
  const got = await api.call('icons', list).catch(() => ({}));
  let any = false; for (const [k, v] of Object.entries(got)) { if (v) any = true; icons[k] = v; }
  if (any) rerender();
}
function sameApp(s, l) {
  if (!s || !l) return false;
  const lc = (x) => String(x || '').toLowerCase().replace(/\\/g, '/');
  if (s.bundleId && l.bundleId) return lc(s.bundleId) === lc(l.bundleId);
  if (s.path && l.path && lc(s.path) === lc(l.path)) return true;
  if (s.aumid && l.aumid) return lc(s.aumid) === lc(l.aumid);
  return lc(s.name) === lc(l.name);
}
function displayForRect(r, ds) {
  let best = ds[0], bestA = -1;
  for (const d of ds) { const b = d.bounds; const w = Math.min(r.x + r.width, b.x + b.width) - Math.max(r.x, b.x); const h = Math.min(r.y + r.height, b.y + b.height) - Math.max(r.y, b.y); const a = Math.max(0, w) * Math.max(0, h); if (a > bestA) { bestA = a; best = d; } }
  return best;
}
const toFrac = (r, d) => { const wa = d.workArea; return { x: (r.x - wa.x) / wa.width, y: (r.y - wa.y) / wa.height, w: r.width / wa.width, h: r.height / wa.height }; };
function ago(t) {
  if (!t) return 'never'; const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = new Date(t); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
const clock = (t) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
function prettyAccel(a) {
  if (!a) return '';
  const mac = isMac();
  return a.split('+').map((p) => (mac ? ({ CommandOrControl: '⌘', Command: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧', Space: 'Space', Return: '↩', Up: '↑', Down: '↓', Left: '←', Right: '→' })[p] || p
    : ({ CommandOrControl: 'Ctrl', Control: 'Ctrl', Super: 'Win', Space: 'Space', Return: 'Enter' })[p] || p)).join(mac ? '' : '+');
}
function accelFromKey(e) {
  const k = e.key; if (!k || ['Shift', 'Control', 'Alt', 'Meta', 'Fn', 'CapsLock'].includes(k)) return null;
  const mac = isMac(); const parts = [];
  if (mac ? e.metaKey : e.ctrlKey) parts.push('CommandOrControl');
  if (mac && e.ctrlKey) parts.push('Control');
  if (!mac && e.metaKey) parts.push('Super');
  if (e.altKey) parts.push('Alt'); if (e.shiftKey) parts.push('Shift');
  if (!parts.length || (parts.length === 1 && parts[0] === 'Shift')) return null;
  let key;
  if (/^Key[A-Z]$/.test(e.code || '')) key = e.code.slice(3); else if (/^Digit\d$/.test(e.code || '')) key = e.code.slice(5); else if (/^F\d{1,2}$/.test(k)) key = k;
  else key = ({ ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Return' })[k] || (k.length === 1 ? k.toUpperCase() : null);
  if (!key) return null; parts.push(key); return parts.join('+');
}
function toast(msg, err) {
  const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.innerHTML = msg;
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), err ? 6000 : 3200);
}
const fail = (e) => toast(esc(e.message || e), true);

function modal(html, { wide, tall, onClose } = {}) {
  const back = document.createElement('div'); back.className = 'modal-back';
  back.innerHTML = `<div class="modal${wide ? ' wide' : ''}${tall ? ' tall' : ''}">${html}</div>`;
  document.body.appendChild(back);
  const close = () => { back.remove(); document.removeEventListener('keydown', key); onClose && onClose(); };
  const key = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  $$('[data-close]', back).forEach((b) => b.addEventListener('click', close));
  return { el: $('.modal', back), close };
}
function confirmBox(title, body, okLabel = 'OK', danger) {
  return new Promise((res) => {
    const m = modal(`<h2>${title}</h2><p>${body}</p><div class="foot"><button class="btn ghost" data-close>Cancel</button><button class="btn ${danger ? 'danger-fill' : 'primary'}" id="cb-ok">${okLabel}</button></div>`, { onClose: () => res(false) });
    $('#cb-ok', m.el).onclick = () => { res(true); m.close(); };
  });
}
let popEl = null;
function pop(anchor, html, { align = 'left' } = {}) {
  closePop();
  popEl = document.createElement('div'); popEl.className = 'pop'; popEl.innerHTML = html; document.body.appendChild(popEl);
  const r = anchor.getBoundingClientRect(); const pr = popEl.getBoundingClientRect();
  let x = align === 'right' ? r.right - pr.width : r.left; x = clamp(x, 8, innerWidth - pr.width - 8);
  let y = r.bottom + 6; if (y + pr.height > innerHeight - 8) y = r.top - pr.height - 6;
  Object.assign(popEl.style, { left: x + 'px', top: y + 'px' });
  setTimeout(() => document.addEventListener('mousedown', outside), 0);
  return popEl;
}
function outside(e) { if (popEl && !popEl.contains(e.target)) closePop(); }
function closePop() { if (popEl) { popEl.remove(); popEl = null; } document.removeEventListener('mousedown', outside); }
function menuPop(anchor, items) {
  const el = pop(anchor, `<div class="menu">${items.map((it, i) => it === '-' ? '<hr>' : `<button data-i="${i}" class="${it.danger ? 'danger' : ''}" ${it.disabled ? 'disabled' : ''}>${it.icon ? ic(it.icon, 15) : ''}${esc(it.label)}</button>`).join('')}</div>`, { align: 'right' });
  el.querySelectorAll('button[data-i]').forEach((b) => b.onclick = () => { closePop(); items[+b.dataset.i].run(); });
}

// ---------------------------------------------------------------- theme
function applyTheme() {
  const t = B.settings.theme; const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('#theme-btn use').setAttribute('href', dark ? '#i-sun' : '#i-moon');
  api.call('window:chrome', { color: '#00000000', symbolColor: dark ? '#ece8e1' : '#2a2620', height: 46 }).catch(() => {});
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => B && applyTheme());
async function setSettings(p) { B.settings = await api.call('settings:set', p); applyTheme(); return B.settings; }

// ---------------------------------------------------------------- navigation
function go(v, opts = {}) {
  if (view === 'desktop' && v !== 'desktop') stopDesk();
  view = v;
  $$('.view').forEach((x) => x.classList.toggle('on', x.id === 'v-' + v));
  $$('#nav .nav-btn').forEach((b) => b.classList.toggle('on', b.dataset.view === v || (v === 'editor' && b.dataset.view === 'scenes' && false)));
  if (v === 'scenes') renderScenes();
  if (v === 'desktop') startDesk();
  if (v === 'automations') renderAuto();
  if (v === 'history') renderHistory();
  if (v === 'editor') renderEditor(opts);
  renderSide();
}
function rerender() {
  renderSide();
  if (view === 'scenes') renderScenes(); else if (view === 'editor') { renderTools(); renderCanvas(); renderTab(); } else if (view === 'desktop') renderDesk(); else if (view === 'automations') renderAuto(); else if (view === 'history') renderHistory();
}

// ---------------------------------------------------------------- sidebar
function renderSide() {
  const st = B.state || {};
  $('#side-scenes').innerHTML = B.scenes.map((s) => `
    <button class="ss c-${s.color || 'amber'}${s.id === st.activeId ? ' active' : ''}${view === 'editor' && ED && ED.id === s.id ? ' sel' : ''}${switching === s.id ? ' busy' : ''}" data-id="${s.id}" title="${esc(s.name)}">
      <span class="gl">${gl(s.glyph, 14)}</span><span class="nm">${esc(s.name)}</span>${s.hotkey ? `<span class="kbd">${esc(prettyAccel(s.hotkey))}</span>` : ''}
    </button>`).join('') || '<div class="small muted" style="padding:6px 10px">No scenes yet</div>';
  $$('#side-scenes .ss').forEach((b) => {
    b.onclick = () => openEditor(b.dataset.id);
    b.oncontextmenu = (e) => { e.preventDefault(); sceneMenu(b, B.scenes.find((s) => s.id === b.dataset.id)); };
  });
  const act = B.scenes.find((s) => s.id === st.activeId);
  $('#now').className = 'now' + (act ? ' c-' + (act.color || 'amber') : '');
  $('#now').innerHTML = `
    <div class="now-h"><span class="dot"></span><b>${act ? esc(act.name) : 'No scene active'}</b></div>
    ${act ? `<div class="row">${ic('clock', 13)}Since ${clock(st.activeAt || Date.now())}</div>` : `<div class="row">Pick a scene to switch to it</div>`}
    ${B.awake ? `<div class="row">${ic('eye', 13)}Keeping the screen awake</div>` : ''}
    ${st.previous ? `<button class="link-btn" id="now-undo">${ic('undo', 13)}Restore previous layout</button>` : ''}`;
  const u = $('#now-undo'); if (u) u.onclick = () => switchTo('previous');
  const nTrig = B.scenes.reduce((n, s) => n + (s.triggers || []).length, 0);
  $('#nb-auto').hidden = !nTrig; $('#nb-auto').textContent = nTrig;
}

// ---------------------------------------------------------------- switching
let switching = null; let progEl = null; let progTimer = null;
async function switchTo(id) {
  try { switching = id; renderSide(); await api.call('scene:activate', id); }
  catch (e) { fail(e); } finally { switching = null; renderSide(); }
}
function showProgress(p) {
  const sc = B.scenes.find((s) => s.id === p.scene) || { color: 'slate', glyph: 'undo', name: p.name };
  if (!progEl) { progEl = document.createElement('div'); progEl.className = 'prog'; document.body.appendChild(progEl); }
  clearTimeout(progTimer);
  progEl.className = 'prog c-' + (sc.color || 'amber');
  const done = p.steps.filter((s) => s.status !== 'run').length; const pct = p.done ? 100 : Math.min(95, 10 + (done / Math.max(4, p.steps.length + 1)) * 90);
  const sym = (st) => st === 'run' ? '<span class="spin"></span>' : st === 'ok' ? ic('check', 14) : ic('alert', 14);
  progEl.innerHTML = `
    <div class="prog-h"><span class="gl">${sc.glyph === 'undo' ? ic('undo', 16) : gl(sc.glyph, 16)}</span><div class="grow"><b>${p.done ? (p.ok ? 'Switched to ' : 'Switched, with notes: ') : 'Switching to '}${esc(p.name)}</b><span>${p.done ? `${(p.ms / 1000).toFixed(1)} s` : 'One moment…'}</span></div>${p.done ? `<button class="icon-btn sm" id="prog-x">${ic('x', 15)}</button>` : ''}</div>
    <div class="prog-steps">${p.steps.map((s) => `<div class="step ${s.status}"><span class="si">${sym(s.status)}</span><div>${esc(s.label)}${s.detail ? `<span class="sd" title="${esc(s.detail)}">${esc(s.detail)}</span>` : ''}</div></div>`).join('')}</div>
    <div class="prog-bar"><i style="width:${pct}%"></i></div>`;
  const x = $('#prog-x', progEl); if (x) x.onclick = hideProgress;
  if (p.done) progTimer = setTimeout(hideProgress, p.ok ? 2600 : 9000);
}
function hideProgress() { if (progEl) { progEl.remove(); progEl = null; } }

// ---------------------------------------------------------------- scenes page
function sceneItems(s) {
  const out = [];
  for (const a of s.apps || []) for (const [i, w] of (a.windows || []).entries()) out.push({ id: w.id, appId: a.id, display: w.display, frac: w.frac, state: w.state, label: a.name, title: w.title && w.match !== 'any' ? w.title : (a.windows.length > 1 ? `Window ${i + 1}` : ''), icon: a.path ? icons[a.path] : null, color: hueOf(a.name), initials: initials(a.name) });
  return out;
}
function sceneDisplays(s) {
  const cur = B.displays || [];
  return (s.displays && s.displays.length ? s.displays : cur).map((d) => ({ ...d, missing: !cur.some((c) => c.id === d.id || c.key === d.key) }));
}
function sceneTags(s) {
  const t = []; const sys = s.system || {};
  if (s.others === 'quit') t.push([ 'x', 'Quits other apps' ]); else if (s.others === 'hide') t.push(['eye', 'Hides other apps']);
  if (sys.volume != null) t.push(['vol', `Volume ${sys.volume}%`]); if (sys.mute === true) t.push(['vol', 'Muted']);
  if (sys.appearance) t.push([sys.appearance === 'dark' ? 'moon' : 'sun', sys.appearance === 'dark' ? 'Dark mode' : 'Light mode']);
  if (sys.wallpaper) t.push(['image', 'Wallpaper']); if (sys.keepAwake) t.push(['eye', 'Stays awake']);
  const n = (s.triggers || []).length; if (n) t.push(['bolt', `${n} trigger${n === 1 ? '' : 's'}`]);
  const o = (s.extras || []).length + (s.apps || []).reduce((k, a) => k + (a.open || []).length, 0); if (o) t.push(['link', `Opens ${o} link${o === 1 ? '' : 's'}`]);
  return t.map(([i, l]) => `<span class="tag">${ic(i, 12)}${esc(l)}</span>`).join('');
}
function renderScenes() {
  const page = $('#sc-page'); const st = B.state || {};
  $('#sc-sub').textContent = B.scenes.length ? `${B.scenes.length} scene${B.scenes.length === 1 ? '' : 's'} · ${B.displays.length} display${B.displays.length === 1 ? '' : 's'} connected` : '';
  $('#ax-banner').hidden = !!(B.access && B.access.accessibility);
  const tpls = `<div class="tpl-grid">${B.templates.filter((t) => t.id !== 'blank').map((t) => `<button class="tpl c-${t.color}" data-tpl="${t.id}"><span class="gl">${gl(t.glyph, 18)}</span><b>${esc(t.name)}</b><span>${esc(t.blurb)}</span></button>`).join('')}</div>`;
  if (!B.scenes.length) {
    page.innerHTML = `
      <div class="hero"><div><h2>Set the scene</h2><p>A scene is a whole setup: the apps that should be open, where each window sits on which screen, the sites and files that open with them, plus volume, dark mode, wallpaper and whether the screen stays awake. Switch with one click, a shortcut, or automatically when you plug in a monitor.</p>
      <div class="acts"><button class="btn primary" id="hero-capture">${ic('camera')}Save what’s on screen now</button><button class="btn" id="hero-blank">${ic('plus')}Start empty</button></div></div></div>
      <div class="sec-h">Or start from one of these<span class="grow"></span></div>${tpls}`;
    $('#hero-capture').onclick = captureFlow; $('#hero-blank').onclick = () => newFromTemplate('blank');
  } else {
    const recent = (B.history || []).slice(0, 6);
    page.innerHTML = `
      <div class="scene-grid" id="sc-grid">${B.scenes.map((s) => `
        <div class="sc c-${s.color || 'amber'}${s.id === st.activeId ? ' active' : ''}" data-id="${s.id}">
          ${s.id === st.activeId ? '<span class="pill acc live">Active</span>' : ''}
          <div class="sc-prev" data-edit><div class="lc"></div></div>
          <div class="sc-body">
            <div class="sc-top"><span class="gl">${gl(s.glyph, 17)}</span><div class="grow"><h3>${esc(s.name)}</h3><div class="s">${(s.apps || []).length} app${(s.apps || []).length === 1 ? '' : 's'} · ${s.lastUsed ? 'used ' + ago(s.lastUsed) : 'not used yet'}</div></div>${s.hotkey ? `<span class="kbd">${esc(prettyAccel(s.hotkey))}</span>` : ''}</div>
            <div class="tags">${sceneTags(s)}</div>
            <div class="sc-foot"><button class="btn sm go" data-go>${ic('play', 13)}Switch</button><button class="btn sm ghost" data-edit>Edit</button><span class="grow"></span><span class="sc-apps">${(s.apps || []).slice(0, 7).map((a) => appIcon(a)).join('')}</span><button class="icon-btn sm" data-more>${ic('dots', 16)}</button></div>
          </div>
        </div>`).join('')}</div>
      <div class="sec-h">Start from a template<span class="grow"></span></div>${tpls}
      ${recent.length ? `<div class="sec-h">Recent switches<span class="grow"></span><button class="link-btn" data-goto="history">See all</button></div><div class="card recent">${recent.map(histRow).join('')}</div>` : ''}`;
    $$('.sc', page).forEach((c) => {
      const s = B.scenes.find((x) => x.id === c.dataset.id);
      const cv = new LayoutCanvas($('.lc', c), { mini: true }); cv.set({ displays: sceneDisplays(s), items: sceneItems(s) });
      $$('[data-edit]', c).forEach((b) => b.onclick = () => openEditor(s.id));
      $('[data-go]', c).onclick = () => switchTo(s.id);
      $('[data-more]', c).onclick = (e) => sceneMenu(e.currentTarget, s);
    });
    const ga = $('[data-goto]', page); if (ga) ga.onclick = () => go('history');
  }
  $$('[data-tpl]', page).forEach((b) => b.onclick = () => newFromTemplate(b.dataset.tpl));
}
function histRow(h) {
  const trig = { manual: 'by you', hotkey: 'shortcut', menu: 'menu bar', display: 'display change', schedule: 'schedule', app: 'app opened', ask: 'notification', switcher: 'quick switcher' }[h.trigger] || h.trigger;
  return `<div class="rc c-${h.color || 'slate'}"><span class="gl">${h.sceneId === 'previous' ? ic('undo', 13) : gl(h.glyph, 13)}</span><div class="t">${esc(h.sceneId === 'previous' ? h.name : 'Switched to ' + h.name)}<span>${esc(trig)}</span></div><span class="small muted tnum">${(h.ms / 1000).toFixed(1)} s</span><span class="small muted">${ago(h.at)}</span></div>`;
}
function sceneMenu(anchor, s) {
  menuPop(anchor, [
    { label: 'Switch now', icon: 'play', run: () => switchTo(s.id) },
    { label: 'Edit', icon: 'scenes', run: () => openEditor(s.id) },
    { label: 'Duplicate', icon: 'copy', run: async () => { try { const c = await api.call('scene:duplicate', s.id); await reloadScenes(); openEditor(c.id); } catch (e) { fail(e); } } },
    { label: 'Export…', icon: 'export', run: () => api.call('export', [s.id]).catch(fail) },
    '-',
    { label: 'Delete', icon: 'trash', danger: true, run: async () => { if (await confirmBox(`Delete “${esc(s.name)}”?`, 'This removes the scene and its shortcut and triggers. Your apps aren’t touched.', 'Delete', true)) { B.scenes = await api.call('scene:delete', s.id); if (view === 'editor') go('scenes'); else rerender(); } } }
  ]);
}
async function reloadScenes() { B.scenes = await api.call('scenes:list'); }
async function newFromTemplate(tid) {
  try { const s = await api.call('scene:from-template', tid); await reloadScenes(); openEditor(s.id); if (tid !== 'blank' && !(s.apps || []).length) toast('None of this template’s apps are installed, so it starts empty. Add your own on the right.'); }
  catch (e) { fail(e); }
}
function newSceneFlow() {
  const m = modal(`<h2>New scene</h2><p>Start from what’s on your screens now, or from a template that picks apps you have installed.</p>
    <button class="tpl c-amber" id="ns-cap" style="width:100%;margin-bottom:10px"><span class="gl">${ic('camera', 18)}</span><b>Save what’s on screen now</b><span>Every open window, exactly where it is. Untick what you don’t want.</span></button>
    <div class="tpl-grid">${B.templates.map((t) => `<button class="tpl c-${t.color}" data-tpl="${t.id}"><span class="gl">${gl(t.glyph, 18)}</span><b>${esc(t.name)}</b><span>${esc(t.blurb)}</span></button>`).join('')}</div>
    <div class="foot"><button class="btn ghost" data-close>Cancel</button></div>`, { wide: true });
  $('#ns-cap', m.el).onclick = () => { m.close(); captureFlow(); };
  $$('[data-tpl]', m.el).forEach((b) => b.onclick = () => { m.close(); newFromTemplate(b.dataset.tpl); });
}

// ---------------------------------------------------------------- capture
async function captureFlow() {
  let snap;
  try { snap = await api.call('capture'); } catch (e) { return fail(e); }
  if (snap.error === 'accessibility') { B.access = { accessibility: false }; renderScenes(); return toast('Scene needs Accessibility access to see your windows. The banner at the top opens the right setting.', true); }
  const groups = []; for (const w of snap.windows) { let g = groups.find((x) => sameApp(x.app, w.app)); if (!g) groups.push(g = { app: w.app, wins: [] }); g.wins.push(w); }
  const key = (a) => a.bundleId ? 'b:' + a.bundleId.toLowerCase() : a.path ? 'p:' + a.path.toLowerCase().replace(/\\/g, '/') : 'n:' + String(a.name).toLowerCase();
  const on = new Set(groups.filter((g) => g.wins.some((w) => w.state !== 'minimized' && !w.hidden)).map((g) => key(g.app)));
  const m = modal(`<h2>Save current layout</h2><p>Scene takes each window’s place on your ${snap.displays.length > 1 ? snap.displays.length + ' displays' : 'screen'}. You can fine-tune it afterwards.</p>
    <div style="display:flex;gap:8px"><div class="field grow"><input id="cp-name" placeholder="Name this scene" value="My setup" maxlength="40"></div></div>
    <div class="card" style="height:170px;margin-top:12px;padding:12px 16px 4px"><div class="lc" id="cp-canvas" style="position:absolute;inset:12px 16px 8px"></div></div>
    <div class="pick-list" id="cp-list">${groups.map((g) => `<label><input type="checkbox" data-k="${esc(key(g.app))}" ${on.has(key(g.app)) ? 'checked' : ''}>${appIcon(g.app)}<span class="nm">${esc(g.app.name)}<div class="s">${g.wins.map((w) => esc(w.title || 'Untitled')).join(' · ')}</div></span><span class="small muted">${g.wins.length} window${g.wins.length === 1 ? '' : 's'}</span></label>`).join('') || '<div class="empty">No windows to save. Open a few apps first.</div>'}</div>
    <div class="foot"><span class="small muted grow" id="cp-count"></span><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="cp-save">Save scene</button></div>`, { wide: true, tall: true });
  const cv = new LayoutCanvas($('#cp-canvas', m.el), { mini: true });
  const draw = () => {
    const items = snap.windows.filter((w) => on.has(key(w.app))).map((w) => { const d = displayForRect(w.bounds, snap.displays); return { id: w.id, display: d.id, frac: toFrac(w.bounds, d), state: w.state, label: w.app.name, icon: w.app.path ? icons[w.app.path] : null, color: hueOf(w.app.name), initials: initials(w.app.name) }; });
    cv.set({ displays: snap.displays, items }); $('#cp-count', m.el).textContent = `${on.size} app${on.size === 1 ? '' : 's'} · ${items.length} window${items.length === 1 ? '' : 's'}`;
  };
  setTimeout(draw, 30);
  $$('#cp-list input', m.el).forEach((i) => i.onchange = () => { if (i.checked) on.add(i.dataset.k); else on.delete(i.dataset.k); draw(); });
  $('#cp-name', m.el).select();
  $('#cp-save', m.el).onclick = async () => {
    try {
      const s = await api.call('scene:from-capture', { name: $('#cp-name', m.el).value.trim() || 'My setup', include: [...on], color: COLORS[B.scenes.length % COLORS.length], glyph: 'spark' });
      m.close(); await reloadScenes(); openEditor(s.id); toast(`Saved <b>${esc(s.name)}</b> with ${s.apps.length} app${s.apps.length === 1 ? '' : 's'}`);
    } catch (e) { fail(e); }
  };
}

// ---------------------------------------------------------------- editor
let ED = null; let edSel = null; let edTab = 'apps'; let edCanvas = null; let saveTimer = null; let shortcuts = null;
function openEditor(id, tab) { const s = B.scenes.find((x) => x.id === id); if (!s) return; ED = clone(s); edSel = null; if (tab) edTab = tab; go('editor'); }
function findRule(id) { for (const a of ED.apps) for (const w of a.windows) if (w.id === id) return { a, w }; return null; }
function changed(what = 'all') {
  $('#ed-saved').textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try { const s = await api.call('scene:save', ED); const i = B.scenes.findIndex((x) => x.id === s.id); if (i >= 0) B.scenes[i] = s; else B.scenes.push(s); ED.updatedAt = s.updatedAt; $('#ed-saved').textContent = 'Saved'; renderSide(); }
    catch (e) { $('#ed-saved').textContent = ''; fail(e); }
  }, 350);
  if (what === 'all' || what === 'canvas') renderCanvas();
  if (what === 'all' || what === 'tools') renderTools();
  if (what === 'all' || what === 'tab') renderTab();
  if (what === 'all' || what === 'head') renderHead();
}
function renderEditor() {
  if (!ED) return go('scenes');
  if (!edCanvas) edCanvas = new LayoutCanvas($('#ed-canvas'), { editable: true, onChange: onCanvasChange, onSelect: (id) => { edSel = id; renderCanvas(); renderTools(); if (edTab === 'apps') renderTab(); } });
  $('#ed-saved').textContent = '';
  renderHead(); renderTools(); renderTab(); setTimeout(renderCanvas, 0);
}
function renderHead() {
  $('#v-editor').className = 'view on c-' + (ED.color || 'amber');
  $('#ed-glyph').innerHTML = gl(ED.glyph, 18);
  if (document.activeElement !== $('#ed-name')) $('#ed-name').value = ED.name;
  const hk = $('#ed-hotkey'); hk.classList.toggle('set', !!ED.hotkey); hk.classList.remove('rec');
  hk.innerHTML = ED.hotkey ? `${ic('keyboard', 14)}<span>${esc(prettyAccel(ED.hotkey))}</span>` : `${ic('keyboard', 14)}<span>Add shortcut</span>`;
  const bad = (B.hotkeyProblems || []).some((p) => p.acc === ED.hotkey);
  hk.title = bad ? 'Another app already uses this shortcut, so it won’t work. Pick another.' : 'A keyboard shortcut that switches to this scene from anywhere';
  hk.style.borderColor = bad ? 'var(--bad)' : '';
  $('#tb-apps').textContent = ED.apps.length;
  $('#tb-trig').hidden = !(ED.triggers || []).length; $('#tb-trig').textContent = (ED.triggers || []).length;
}
function edDisplays() { return sceneDisplays(ED); }
function renderCanvas() { if (view !== 'editor' || !edCanvas) return; edCanvas.set({ displays: edDisplays(), items: sceneItems(ED), selected: edSel }); }
function onCanvasChange(id, patch) {
  const r = findRule(id); if (!r) return;
  Object.assign(r.w, patch); edSel = id; changed();
}
function zoneIcon(f) { return `<span class="zone-ic"><i style="left:${f.x * 100}%;top:${f.y * 100}%;width:${f.w * 100}%;height:${f.h * 100}%"></i></span>`; }
const QUICK_ZONES = ['left', 'right', 'left-third', 'center-third', 'right-third', 'left-two-thirds', 'right-two-thirds', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
function zoneBar(cur, state) {
  const eq = (a, b) => a && b && Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.w - b.w) < 0.01 && Math.abs(a.h - b.h) < 0.01;
  return `<div class="zone-btns">${QUICK_ZONES.map((z) => `<button data-zone="${z}" title="${ZONE_LABEL[z]}" class="${state === 'normal' && eq(cur, ZONES[z]) ? 'on' : ''}">${zoneIcon(ZONES[z])}</button>`).join('')}</div>
    <div class="zone-btns"><button data-state="maximized" title="Fill the screen" class="${state === 'maximized' ? 'on' : ''}">${zoneIcon({ x: 0, y: 0, w: 1, h: 1 })}</button>${B.supports.fullscreen ? `<button data-state="fullscreen" title="Full screen (its own Space)" class="${state === 'fullscreen' ? 'on' : ''}">${ic('target2', 16)}</button>` : ''}<button data-state="minimized" title="Minimised" class="${state === 'minimized' ? 'on' : ''}"><span class="zone-ic" style="border-style:dashed"></span></button></div>`;
}
function renderTools() {
  const t = $('#ed-tools'); const ds = edDisplays(); const cur = B.displays || [];
  const mismatch = ds.some((d) => d.missing) || cur.some((c) => !ds.some((d) => d.id === c.id || d.key === c.key));
  const r = edSel && findRule(edSel);
  if (r) {
    t.innerHTML = `<span class="sel-name">${appIcon(r.a)}${esc(r.a.name)}</span>${zoneBar(r.w.frac, r.w.state || 'normal')}
      ${ds.length > 1 ? `<div class="field sm" style="width:auto"><select id="ed-disp">${ds.map((d) => `<option value="${esc(d.id)}" ${d.id === r.w.display ? 'selected' : ''}>${esc(d.label)}${d.missing ? ' (not connected)' : ''}</option>`).join('')}</select></div>` : ''}
      <span class="grow"></span><button class="icon-btn sm" id="ed-desel" title="Done (Esc)">${ic('x', 15)}</button>`;
    $$('[data-zone]', t).forEach((b) => b.onclick = () => { r.w.frac = { ...ZONES[b.dataset.zone] }; r.w.state = 'normal'; changed(); });
    $$('[data-state]', t).forEach((b) => b.onclick = () => { r.w.state = r.w.state === b.dataset.state ? 'normal' : b.dataset.state; changed(); });
    const sel = $('#ed-disp', t); if (sel) sel.onchange = () => { r.w.display = sel.value; changed(); };
    $('#ed-desel', t).onclick = () => { edSel = null; renderCanvas(); renderTools(); renderTab(); };
  } else {
    const n = ED.apps.reduce((k, a) => k + a.windows.length, 0);
    t.innerHTML = `<span class="small muted">${n ? `Click a window to snap it to a half, third or corner.` : 'No windows yet. Add an app, or take positions from your screen.'}</span><span class="grow"></span>
      ${mismatch ? `<span class="small muted" title="Windows from a display that isn't connected go to your main display when you switch.">Set up for ${ds.length} display${ds.length === 1 ? '' : 's'}, you have ${cur.length} now</span><button class="btn sm" id="ed-refit">${ic('display', 14)}Fit to these displays</button>` : ''}
      <button class="btn sm" id="ed-addapp">${ic('plus', 14)}Add app</button>`;
    const rf = $('#ed-refit', t); if (rf) rf.onclick = async () => { try { ED = await api.call('scene:refit', ED.id); const i = B.scenes.findIndex((x) => x.id === ED.id); B.scenes[i] = clone(ED); renderEditor(); toast('Moved every window onto the displays you have now'); } catch (e) { fail(e); } };
    $('#ed-addapp', t).onclick = addAppFlow;
  }
}
// ---- tabs
function renderTab() {
  $$('#ed-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === edTab));
  const body = $('#ed-body');
  ({ apps: tabApps, open: tabOpen, system: tabSystem, actions: tabActions, triggers: tabTriggers })[edTab](body);
}
function tabApps(body) {
  const stateOpts = (s) => ['normal', 'maximized', ...(B.supports.fullscreen ? ['fullscreen'] : []), 'minimized'].map((x) => `<option value="${x}" ${s === x ? 'selected' : ''}>${STATE_LABEL[x]}</option>`).join('');
  body.innerHTML = ED.apps.map((a) => `
    <div class="blk${edSel && a.windows.some((w) => w.id === edSel) ? ' sel' : ''}" data-app="${a.id}">
      <div class="blk-h">${appIcon(a)}<div class="main"><div class="t">${esc(a.name)}</div><div class="s">${a.windows.length} window${a.windows.length === 1 ? '' : 's'} · ${a.launch === false ? 'only if already open' : 'opens if it isn’t running'}</div></div>
        <button class="icon-btn sm" data-addwin title="Add another window">${ic('plus', 15)}</button><button class="icon-btn sm" data-amore title="More">${ic('dots', 16)}</button></div>
      <div class="blk-b">
        ${a.windows.map((w, i) => `<div class="wrow" data-w="${w.id}"><span class="wn" data-selw>${esc(w.match !== 'any' && w.title ? w.title : `Window ${i + 1}`)}</span><select data-wstate>${stateOpts(w.state || 'normal')}</select><button class="icon-btn xs" data-delw title="Remove this window">${ic('x', 13)}</button></div>`).join('') || '<div class="hint">No window placement. The app just opens.</div>'}
        ${(a.open || []).length ? `<div class="lbl">Opens with it</div><div class="openlist">${a.open.map((o, i) => `<div class="oi">${ic(/^[a-z]+:/i.test(o.target) ? 'link' : 'file', 14)}<span title="${esc(o.target)}">${esc(o.target)}</span><button class="icon-btn xs" data-delopen="${i}">${ic('x', 13)}</button></div>`).join('')}</div>` : ''}
        <div style="display:flex;gap:6px"><div class="field sm grow"><input data-openin placeholder="${/browser|chrome|safari|edge|firefox|arc|brave/i.test(a.name) ? 'Add a web address to open in a new window' : 'Add a link or file to open with it'}"></div><button class="icon-btn sm" data-openfile title="Choose a file">${ic('file', 15)}</button></div>
      </div>
    </div>`).join('') + `
    <button class="btn" id="ta-add" style="width:100%">${ic('plus', 15)}Add app</button>
    ${ED.apps.length ? `<div class="set-row" style="margin-top:8px"><div><div>Bring to front</div><div class="s">The app that ends up on top after switching</div></div><div class="field sm" style="width:160px"><select id="ta-front"><option value="">None</option>${ED.apps.map((a) => `<option value="${a.id}" ${ED.focusApp === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div></div>` : ''}`;
  $('#ta-add', body).onclick = addAppFlow;
  const fr = $('#ta-front', body); if (fr) fr.onchange = () => { ED.focusApp = fr.value || null; changed('none'); };
  $$('.blk', body).forEach((el) => {
    const a = ED.apps.find((x) => x.id === el.dataset.app);
    $('[data-addwin]', el).onclick = () => { const d = edDisplays().find((x) => x.primary) || edDisplays()[0]; const w = { id: uid('w'), title: '', match: 'any', display: d.id, frac: { ...ZONES.center }, state: 'normal' }; a.windows.push(w); edSel = w.id; changed(); };
    $('[data-amore]', el).onclick = (e) => menuPop(e.currentTarget, [
      { label: a.launch === false ? 'Open it if it isn’t running' : 'Only place it if it’s already open', icon: 'app', run: () => { a.launch = a.launch === false; changed(); } },
      { label: 'Launch options…', icon: 'terminal', run: () => argsFlow(a) },
      '-',
      { label: 'Remove from scene', icon: 'trash', danger: true, run: () => { ED.apps = ED.apps.filter((x) => x !== a); if (ED.focusApp === a.id) ED.focusApp = ED.apps[0] ? ED.apps[0].id : null; edSel = null; changed(); } }
    ]);
    $$('.wrow', el).forEach((row) => {
      const w = a.windows.find((x) => x.id === row.dataset.w);
      $('[data-selw]', row).onclick = () => { edSel = w.id; renderCanvas(); renderTools(); renderTab(); };
      $('[data-wstate]', row).onchange = (e) => { w.state = e.target.value; changed(); };
      $('[data-delw]', row).onclick = () => { a.windows = a.windows.filter((x) => x !== w); if (edSel === w.id) edSel = null; changed(); };
    });
    $$('[data-delopen]', el).forEach((b) => b.onclick = () => { a.open.splice(+b.dataset.delopen, 1); changed('tab'); renderHead(); });
    const inp = $('[data-openin]', el);
    inp.onkeydown = (e) => { if (e.key === 'Enter' && inp.value.trim()) { let v = inp.value.trim(); if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(v)) v = 'https://' + v; a.open = a.open || []; a.open.push({ target: v }); changed('tab'); } };
    $('[data-openfile]', el).onclick = async () => { const p = await api.call('pick', 'file').catch(() => null); if (p) { a.open = a.open || []; a.open.push({ target: p }); changed('tab'); } };
  });
}
function argsFlow(a) {
  const m = modal(`<h2>Launch options for ${esc(a.name)}</h2><p>Extra command-line arguments Scene passes when it opens the app. Most apps don’t need any.</p>
    <div class="field"><input id="ar-in" value="${esc(a.args || '')}" placeholder="--profile-directory=&quot;Profile 1&quot;"></div>
    <div class="foot"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="ar-ok">Save</button></div>`);
  $('#ar-ok', m.el).onclick = () => { a.args = $('#ar-in', m.el).value.trim(); m.close(); changed('none'); };
}
let installedCache = null;
async function addAppFlow() {
  const m = modal(`<h2>Add an app</h2><p>Pick an app that belongs to this scene. You can place its window on the left afterwards.</p>
    <div style="display:flex;gap:8px"><div class="field grow">${ic('search', 15)}<input id="ap-q" placeholder="Search apps"></div><button class="btn" id="ap-browse">Browse…</button></div>
    <div class="pick-list" id="ap-list"><div class="empty">Loading your apps…</div></div>
    <div class="foot"><button class="btn ghost" data-close>Close</button></div>`, { wide: true, tall: true });
  let running = [];
  try { [installedCache, running] = await Promise.all([installedCache ? Promise.resolve(installedCache) : api.call('apps:installed'), api.call('apps:running').catch(() => [])]); } catch (e) { fail(e); }
  const all = installedCache || [];
  const list = () => {
    const q = $('#ap-q', m.el).value.trim().toLowerCase();
    const isRun = (a) => running.some((r) => sameApp(a, r));
    const rows = all.filter((a) => !q || a.name.toLowerCase().includes(q)).filter((a) => !ED.apps.some((x) => sameApp(x, a))).sort((a, b) => (isRun(b) - isRun(a)) || a.name.localeCompare(b.name)).slice(0, 300);
    $('#ap-list', m.el).innerHTML = rows.map((a, i) => `<div class="pi" data-i="${all.indexOf(a)}">${appIcon(a)}<span class="nm">${esc(a.name)}${a.path ? `<div class="s">${esc(a.path)}</div>` : ''}</span>${isRun(a) ? '<span class="pill ok">Open</span>' : '<span></span>'}</div>`).join('') || '<div class="empty">No apps match.</div>';
    $$('.pi', m.el).forEach((r) => r.onclick = () => { add(all[+r.dataset.i]); });
  };
  const add = (a) => {
    const d = edDisplays().find((x) => x.primary) || edDisplays()[0];
    const n = ED.apps.length; const z = [ZONES.left, ZONES.right, ZONES['left-third'], ZONES['right-two-thirds'], ZONES.center][n % 5];
    const app = { id: uid('a'), name: a.name, bundleId: a.bundleId || null, path: a.path || null, aumid: a.aumid || null, launch: true, args: '', open: [], windows: [{ id: uid('w'), title: '', match: 'any', display: d ? d.id : '1', frac: { ...z }, state: 'normal' }] };
    ED.apps.push(app); if (!ED.focusApp) ED.focusApp = app.id; edSel = app.windows[0].id; m.close(); changed();
  };
  $('#ap-q', m.el).oninput = list; $('#ap-q', m.el).focus(); list();
  $('#ap-browse', m.el).onclick = async () => { const a = await api.call('pick', 'app').catch(fail); if (a) add(a); };
}
function tabOpen(body) {
  const ex = ED.extras || (ED.extras = []);
  body.innerHTML = `<div class="hint" style="margin-bottom:10px">Links, files and folders that open with their usual app when you switch. To open web pages in a particular browser window you’re placing, add them to that browser on the Apps tab instead.</div>
    <div class="openlist" style="margin-bottom:10px">${ex.map((o, i) => `<div class="oi">${ic(/^[a-z]+:/i.test(o.target) && !/^[a-z]:\\/i.test(o.target) ? 'link' : /\.[a-z0-9]{1,5}$/i.test(o.target) ? 'file' : 'folder', 14)}<span title="${esc(o.target)}">${esc(o.target)}</span><button class="icon-btn xs" data-test="${i}" title="Open it now">${ic('play', 12)}</button><button class="icon-btn xs" data-del="${i}">${ic('x', 13)}</button></div>`).join('') || '<div class="empty" style="padding:24px">Nothing extra opens yet.</div>'}</div>
    <div class="field"><input id="op-in" placeholder="Paste a link, like https://… or steam://rungameid/…"></div>
    <div style="display:flex;gap:6px;margin-top:8px"><button class="btn sm" id="op-file">${ic('file', 14)}Add a file</button><button class="btn sm" id="op-folder">${ic('folder', 14)}Add a folder</button></div>`;
  const add = (t) => { ex.push({ target: t }); changed('tab'); };
  $('#op-in', body).onkeydown = (e) => { const v = e.target.value.trim(); if (e.key === 'Enter' && v) add(/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(v) ? 'https://' + v : v); };
  $('#op-file', body).onclick = async () => { const p = await api.call('pick', 'file').catch(() => null); if (p) add(p); };
  $('#op-folder', body).onclick = async () => { const p = await api.call('pick', 'folder').catch(() => null); if (p) add(p); };
  $$('[data-del]', body).forEach((b) => b.onclick = () => { ex.splice(+b.dataset.del, 1); changed('tab'); });
  $$('[data-test]', body).forEach((b) => b.onclick = () => api.call('test-open', ex[+b.dataset.test].target).catch(fail));
}
function seg(name, opts, cur) { return `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`; }
function tabSystem(body) {
  const sys = ED.system || (ED.system = {});
  const others = ED.others || 'leave';
  body.innerHTML = `
    <div class="blk"><div class="blk-h" style="display:block">
      <div class="t" style="margin-bottom:8px">Apps that aren’t in this scene</div>
      <div class="seg full" data-seg="others">${[['leave', 'Leave open'], ['hide', isMac() ? 'Hide' : 'Minimise'], ['quit', 'Quit']].map(([v, l]) => `<button data-v="${v}" class="${others === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="hint" style="margin-top:8px">${others === 'quit' ? 'Apps are asked to quit the normal way, so anything unsaved still asks first. Apps on your keep-open list in Settings are never touched.' : others === 'hide' ? `They stay open, just out of the way. ${isMac() ? 'Hidden apps come back from the Dock.' : 'They go to the taskbar.'}` : 'Everything else stays as it is.'}</div>
    </div></div>
    <div class="blk"><div class="blk-h" style="display:block">
      <div class="set-row" style="padding-top:2px"><div><div>Volume</div><div class="s">${sys.volume == null ? 'Left as it is' : 'Set when you switch'}</div></div><button class="switch ${sys.volume != null ? 'on' : ''}" id="sy-vol-on"></button></div>
      ${sys.volume != null ? `<div class="vol" style="padding-bottom:10px">${ic('vol', 16)}<input type="range" min="0" max="100" step="5" id="sy-vol" value="${sys.volume}"><b id="sy-vol-v">${sys.volume}%</b></div>` : ''}
      <div class="set-row"><div><div>Sound</div></div>${seg('mute', [['', 'Leave'], ['false', 'On'], ['true', 'Muted']], sys.mute == null ? '' : sys.mute)}</div>
      <div class="set-row"><div><div>Appearance</div></div>${seg('appearance', [['', 'Leave'], ['light', 'Light'], ['dark', 'Dark']], sys.appearance || '')}</div>
      <div class="set-row"><div><div>Keep the screen awake</div><div class="s">Until you switch to another scene</div></div><button class="switch ${sys.keepAwake ? 'on' : ''}" id="sy-awake"></button></div>
      <div class="set-row col"><div><div>Wallpaper</div><div class="s">${sys.wallpaper ? 'Set on every display' : 'Left as it is'}</div></div>
        <div class="wallthumb" id="sy-wall">${sys.wallpaper ? `<span style="padding:0 10px;text-align:center;word-break:break-all">${esc(sys.wallpaper.split(/[\\/]/).pop())}</span>` : ic('image', 22)}</div>
        <div style="display:flex;gap:6px"><button class="btn sm" id="sy-wall-pick">Choose image…</button>${sys.wallpaper ? '<button class="btn sm ghost" id="sy-wall-clear">Don’t change</button>' : ''}</div></div>
    </div></div>
    <div class="hint" id="sy-now"></div>`;
  $$('[data-seg]', body).forEach((sg) => $$('button', sg).forEach((b) => b.onclick = () => {
    const k = sg.dataset.seg, v = b.dataset.v;
    if (k === 'others') ED.others = v;
    else if (k === 'mute') sys.mute = v === '' ? null : v === 'true';
    else if (k === 'appearance') sys.appearance = v || null;
    changed('tab'); renderScenesLater();
  }));
  $('#sy-vol-on', body).onclick = () => { sys.volume = sys.volume == null ? 50 : null; changed('tab'); };
  const vr = $('#sy-vol', body); if (vr) { vr.oninput = () => { $('#sy-vol-v', body).textContent = vr.value + '%'; }; vr.onchange = () => { sys.volume = +vr.value; changed('none'); }; }
  $('#sy-awake', body).onclick = () => { sys.keepAwake = !sys.keepAwake; changed('tab'); };
  $('#sy-wall-pick', body).onclick = async () => { const p = await api.call('pick', 'image').catch(() => null); if (p) { sys.wallpaper = p; changed('tab'); } };
  const wc = $('#sy-wall-clear', body); if (wc) wc.onclick = () => { sys.wallpaper = null; changed('tab'); };
  api.call('system:state').then((s) => { const el = $('#sy-now'); if (el && s && s.volume != null) el.textContent = `Right now: volume ${s.volume}%${s.muted ? ' (muted)' : ''}${s.appearance ? `, ${s.appearance} mode` : ''}.`; }).catch(() => {});
}
function renderScenesLater() { /* the scenes grid redraws when you go back */ }
function tabActions(body) {
  const acts = ED.actions || (ED.actions = []);
  body.innerHTML = `<div class="hint" style="margin-bottom:10px">Run these after the windows are in place, top to bottom. ${isMac() ? 'Shortcuts can turn on a Focus, dim the lights or anything else the Shortcuts app does.' : 'Commands run in the Command Prompt, so batch files and scripts work too.'}</div>
    ${acts.map((a, i) => `<div class="blk" data-i="${i}"><div class="blk-h"><span class="gl" style="width:28px;height:28px;border-radius:8px;display:grid;place-items:center;background:var(--panel-2);color:var(--fg-2)">${ic(a.kind === 'shortcut' ? 'spark' : a.kind === 'delay' ? 'hourglass' : 'terminal', 15)}</span>
      <div class="main">${a.kind === 'shortcut' ? `<div class="field sm"><select data-val><option value="">Choose a shortcut…</option>${(shortcuts || (a.value ? [a.value] : [])).map((s) => `<option ${s === a.value ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>`
        : a.kind === 'delay' ? `<div style="display:flex;align-items:center;gap:8px"><span>Wait</span><div class="field sm" style="width:70px"><input type="number" min="1" max="60" data-val value="${esc(a.value)}"></div><span class="muted">seconds</span></div>`
        : `<div class="field sm"><input data-val value="${esc(a.value)}" placeholder="${isMac() ? 'open -a Music' : 'start "" "C:\\path\\to\\script.bat"'}" spellcheck="false"></div>`}</div>
      ${a.kind !== 'delay' ? `<label class="chk small muted" title="Wait for it to finish before the next action" style="display:flex;align-items:center;gap:4px;white-space:nowrap"><input type="checkbox" data-wait ${a.wait ? 'checked' : ''}>Wait</label>` : ''}
      <button class="icon-btn xs" data-up ${i === 0 ? 'disabled' : ''}>${ic('back', 13).replace('class="ic"', 'class="ic" style="transform:rotate(90deg)"')}</button><button class="icon-btn xs" data-del>${ic('x', 13)}</button></div></div>`).join('') || '<div class="empty" style="padding:24px">No actions.</div>'}
    <div style="display:flex;gap:6px;flex-wrap:wrap">${B.supports.shortcuts ? `<button class="btn sm" data-add="shortcut">${ic('spark', 14)}Run a Shortcut</button>` : ''}<button class="btn sm" data-add="command">${ic('terminal', 14)}Run a command</button><button class="btn sm" data-add="delay">${ic('hourglass', 14)}Wait</button></div>`;
  if (B.supports.shortcuts && !shortcuts) api.call('shortcuts').then((l) => { shortcuts = l || []; if (edTab === 'actions' && view === 'editor') renderTab(); }).catch(() => { shortcuts = []; });
  $$('[data-add]', body).forEach((b) => b.onclick = () => { acts.push({ kind: b.dataset.add, value: b.dataset.add === 'delay' ? '2' : '', wait: false }); changed('tab'); });
  $$('.blk[data-i]', body).forEach((el) => {
    const i = +el.dataset.i; const a = acts[i];
    const v = $('[data-val]', el); v.onchange = () => { a.value = v.value.trim(); changed('none'); };
    const w = $('[data-wait]', el); if (w) w.onchange = () => { a.wait = w.checked; changed('none'); };
    $('[data-del]', el).onclick = () => { acts.splice(i, 1); changed('tab'); };
    $('[data-up]', el).onclick = () => { if (i > 0) { [acts[i - 1], acts[i]] = [acts[i], acts[i - 1]]; changed('tab'); } };
  });
}
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
function trigText(t) {
  if (t.kind === 'display') return `When ${t.display ? esc(t.display.label) : 'any display'} is ${t.when === 'disconnected' ? 'disconnected' : 'connected'}`;
  if (t.kind === 'schedule') { const d = t.days && t.days.length && t.days.length < 7 ? (t.days.join() === '1,2,3,4,5' ? 'weekdays' : t.days.join() === '0,6' ? 'weekends' : t.days.map((x) => DAYS[x]).join(' ')) : 'every day'; return `At ${esc(t.time || '—')}, ${d}`; }
  if (t.kind === 'app') return `When ${t.app ? esc(t.app.name) : 'an app'} opens`;
  return '';
}
function tabTriggers(body) {
  const tr = ED.triggers || (ED.triggers = []);
  const known = [...(B.displays || [])]; for (const d of ED.displays || []) if (!known.some((k) => k.key === d.key)) known.push(d);
  body.innerHTML = `<div class="hint" style="margin-bottom:10px">Switch to this scene on its own. Scene waits 20 seconds after any switch before a trigger can fire again, so they never fight.</div>
    <div class="blk"><div class="blk-h" style="display:block"><div class="t" style="margin-bottom:8px">When a trigger fires</div>
      <div class="seg full" data-seg="mode">${[['auto', 'Switch right away'], ['ask', 'Ask me first']].map(([v, l]) => `<button data-v="${v}" class="${(ED.triggerMode || 'auto') === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="hint" style="margin-top:8px">${(ED.triggerMode || 'auto') === 'ask' ? 'You get a notification. Click it to switch.' : 'You get a notification after it switches, when Scene’s window isn’t open.'}</div></div></div>
    ${tr.map((t, i) => `<div class="blk" data-i="${i}"><div class="blk-h"><span class="gl" style="width:28px;height:28px;border-radius:8px;display:grid;place-items:center;background:color-mix(in srgb,var(--c) 16%,transparent);color:var(--c)">${ic(t.kind === 'display' ? 'display' : t.kind === 'schedule' ? 'clock' : 'app', 15)}</span><div class="main"><div class="t">${trigText(t)}</div></div><button class="icon-btn xs" data-del>${ic('x', 13)}</button></div>
      <div class="blk-b">${t.kind === 'display' ? `<div class="trig-row"><div class="field sm" style="width:130px"><select data-when><option value="connected" ${t.when !== 'disconnected' ? 'selected' : ''}>Connected</option><option value="disconnected" ${t.when === 'disconnected' ? 'selected' : ''}>Disconnected</option></select></div><div class="field sm grow" style="min-width:150px"><select data-disp><option value="">Any display</option>${known.map((d) => `<option value="${esc(d.key)}" ${t.display && t.display.key === d.key ? 'selected' : ''}>${esc(d.label)} · ${d.bounds.width}×${d.bounds.height}</option>`).join('')}</select></div></div>`
        : t.kind === 'schedule' ? `<div class="trig-row"><div class="field sm" style="width:118px"><input type="time" data-time value="${esc(t.time || '09:00')}"></div><div class="days-pick">${DAYS.map((d, k) => `<button data-day="${k}" class="${(t.days || []).includes(k) ? 'on' : ''}">${d}</button>`).join('')}</div></div>`
        : `<div style="display:flex;gap:6px;align-items:center">${t.app ? appIcon(t.app) : ''}<span class="grow">${t.app ? esc(t.app.name) : '<span class="muted">No app chosen</span>'}</span><button class="btn sm" data-pickapp>Choose…</button></div>`}</div></div>`).join('')}
    <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn sm" data-add="display">${ic('display', 14)}Display plugged in</button><button class="btn sm" data-add="schedule">${ic('clock', 14)}Time of day</button><button class="btn sm" data-add="app">${ic('app', 14)}App opens</button></div>`;
  $$('[data-seg="mode"] button', body).forEach((b) => b.onclick = () => { ED.triggerMode = b.dataset.v; changed('tab'); });
  $$('[data-add]', body).forEach((b) => b.onclick = () => {
    const k = b.dataset.add;
    const ext = (B.displays || []).find((d) => !d.primary);
    tr.push(k === 'display' ? { kind: 'display', when: 'connected', display: ext ? { label: ext.label, key: ext.key } : null } : k === 'schedule' ? { kind: 'schedule', time: '09:00', days: [1, 2, 3, 4, 5] } : { kind: 'app', app: null });
    changed('tab'); renderHead(); if (k === 'app') setTimeout(() => { const btns = $$('[data-pickapp]', $('#ed-body')); if (btns.length) btns[btns.length - 1].click(); }, 50);
  });
  $$('.blk[data-i]', body).forEach((el) => {
    const t = tr[+el.dataset.i];
    $('[data-del]', el).onclick = () => { tr.splice(+el.dataset.i, 1); changed('tab'); renderHead(); };
    const wh = $('[data-when]', el); if (wh) wh.onchange = () => { t.when = wh.value; changed('tab'); };
    const ds = $('[data-disp]', el); if (ds) ds.onchange = () => { const d = known.find((x) => x.key === ds.value); t.display = d ? { label: d.label, key: d.key } : null; changed('tab'); };
    const tm = $('[data-time]', el); if (tm) tm.onchange = () => { t.time = tm.value; changed('tab'); };
    $$('[data-day]', el).forEach((b) => b.onclick = () => { const k = +b.dataset.day; t.days = t.days || []; t.days = t.days.includes(k) ? t.days.filter((x) => x !== k) : [...t.days, k].sort(); changed('tab'); });
    const pa = $('[data-pickapp]', el); if (pa) pa.onclick = async () => {
      const all = installedCache || (installedCache = await api.call('apps:installed').catch(() => []));
      const m = modal(`<h2>Which app?</h2><div class="field">${ic('search', 15)}<input id="tp-q" placeholder="Search apps"></div><div class="pick-list" id="tp-l"></div><div class="foot"><button class="btn ghost" data-close>Cancel</button></div>`, { tall: true });
      const draw = () => { const q = $('#tp-q', m.el).value.toLowerCase(); $('#tp-l', m.el).innerHTML = all.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 200).map((a) => `<div class="pi" data-i="${all.indexOf(a)}">${appIcon(a)}<span class="nm">${esc(a.name)}</span><span></span></div>`).join(''); $$('.pi', m.el).forEach((r) => r.onclick = () => { const a = all[+r.dataset.i]; t.app = { name: a.name, bundleId: a.bundleId || null, path: a.path || null, aumid: a.aumid || null }; m.close(); changed('tab'); }); };
      $('#tp-q', m.el).oninput = draw; draw(); $('#tp-q', m.el).focus();
    };
  });
}
// ---- header controls
function bindEditorHead() {
  $('#ed-back').onclick = () => { ED = null; go('scenes'); };
  $('#ed-name').oninput = (e) => { ED.name = e.target.value; changed('none'); };
  $('#ed-name').onblur = (e) => { if (!e.target.value.trim()) { ED.name = 'Untitled scene'; e.target.value = ED.name; changed('none'); } };
  $('#ed-name').onkeydown = (e) => { if (e.key === 'Enter') e.target.blur(); };
  $('#ed-glyph').onclick = (e) => {
    const el = pop(e.currentTarget, `<div class="colors">${COLORS.map((c) => `<button class="c-${c}${ED.color === c ? ' on' : ''}" data-c="${c}" title="${c}"></button>`).join('')}</div><div class="glyphs c-${ED.color}">${GLYPHS.map((g) => `<button data-g="${g}" class="${ED.glyph === g ? 'on' : ''}">${gl(g, 17)}</button>`).join('')}</div>`);
    $$('[data-c]', el).forEach((b) => b.onclick = () => { ED.color = b.dataset.c; changed('head'); closePop(); });
    $$('[data-g]', el).forEach((b) => b.onclick = () => { ED.glyph = b.dataset.g; changed('head'); closePop(); });
  };
  $('#ed-hotkey').onclick = (e) => recordHotkey(e.currentTarget);
  $('#ed-go').onclick = () => switchTo(ED.id);
  $('#ed-update').onclick = async () => {
    const m = modal(`<h2>Update from screen</h2><p>Scene takes the current position of every window that belongs to <b>${esc(ED.name)}</b>. Apps that aren’t open keep their saved place.</p>
      <label class="chk" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="uf-new"> Also add apps that are open now but aren’t in the scene</label>
      <div class="foot"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="uf-ok">Update</button></div>`);
    $('#uf-ok', m.el).onclick = async () => { try { ED = await api.call('scene:update-from-current', ED.id, { addNew: $('#uf-new', m.el).checked }); await reloadScenes(); m.close(); renderEditor(); toast('Window positions updated'); } catch (e2) { fail(e2); } };
  };
  $('#ed-more').onclick = (e) => sceneMenu(e.currentTarget, B.scenes.find((s) => s.id === ED.id) || ED);
  $$('#ed-tabs button').forEach((b) => b.onclick = () => { edTab = b.dataset.tab; renderTab(); });
}
let recording = null;
function recordHotkey(btn) {
  if (recording) return;
  btn.classList.add('rec'); btn.innerHTML = `${ic('keyboard', 14)}<span>Press keys… (Esc cancels, Delete clears)</span>`;
  api.call('hotkeys:pause', true).catch(() => {});
  recording = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') return stop();
    if (e.key === 'Backspace' || e.key === 'Delete') { ED.hotkey = ''; stop(); changed('head'); return; }
    const acc = accelFromKey(e); if (!acc) return;
    const clash = B.scenes.find((s) => s.id !== ED.id && s.hotkey === acc) || (B.settings.switcherHotkey === acc ? { name: 'the quick switcher' } : null);
    if (clash) { toast(`${esc(prettyAccel(acc))} already switches to ${esc(clash.name)}`, true); return; }
    ED.hotkey = acc; stop(); changed('head');
  };
  const stop = () => { document.removeEventListener('keydown', recording, true); recording = null; api.call('hotkeys:pause', false).catch(() => {}); renderHead(); };
  document.addEventListener('keydown', recording, true);
}

// ---------------------------------------------------------------- desktop page
let DK = { snap: null, sel: null, timer: null, canvas: null, busy: false };
function startDesk() {
  if (!DK.canvas) DK.canvas = new LayoutCanvas($('#dk-canvas'), { editable: true, onChange: deskMove, onSelect: (id) => { DK.sel = id; renderDesk(); } });
  refreshDesk(); clearInterval(DK.timer); DK.timer = setInterval(() => { if (!document.hidden && !DK.canvas.dragging && !DK.busy) refreshDesk(); }, 3500);
}
function stopDesk() { clearInterval(DK.timer); DK.timer = null; }
async function refreshDesk() {
  try { DK.snap = await api.call('capture'); B.displays = DK.snap.displays; } catch (e) { return; }
  if (view === 'desktop') renderDesk();
}
function deskItems() {
  const s = DK.snap; if (!s) return [];
  return s.windows.filter((w) => w.state !== 'minimized').reverse().map((w) => { const d = displayForRect(w.bounds, s.displays); return { id: w.id, display: d.id, frac: toFrac(w.bounds, d), state: w.state, hidden: w.hidden, label: w.app.name, title: w.title, icon: w.app.path ? icons[w.app.path] : null, color: hueOf(w.app.name), initials: initials(w.app.name), locked: w.state === 'minimized' } ; });
}
function renderDesk() {
  const s = DK.snap; $('#ax-banner2').hidden = !(s && s.error === 'accessibility');
  if (!s) return;
  for (const w of s.windows) if (w.app.path && !(w.app.path in icons)) wantIcon(w.app.path);
  DK.canvas.set({ displays: s.displays, items: deskItems(), selected: DK.sel });
  $('#dk-sub').textContent = `${s.windows.length} window${s.windows.length === 1 ? '' : 's'} on ${s.displays.length} display${s.displays.length === 1 ? '' : 's'}`;
  const w = s.windows.find((x) => x.id === DK.sel);
  const t = $('#dk-tools');
  if (w) {
    const d = displayForRect(w.bounds, s.displays); const f = toFrac(w.bounds, d);
    t.innerHTML = `<span class="sel-name">${appIcon(w.app)}${esc(w.app.name)}</span>${zoneBar(f, w.state === 'maximized' ? 'maximized' : w.state)}${s.displays.length > 1 ? `<div class="field sm" style="width:auto"><select id="dk-disp">${s.displays.map((x) => `<option value="${esc(x.id)}" ${x.id === d.id ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></div>` : ''}<span class="grow"></span><button class="btn sm" id="dk-focus">Bring to front</button>`;
    $$('[data-zone]', t).forEach((b) => b.onclick = () => deskArrange(w, { zone: ZONES[b.dataset.zone], displayId: d.id, state: 'normal' }));
    $$('[data-state]', t).forEach((b) => b.onclick = () => deskArrange(w, { displayId: d.id, state: b.dataset.state, zone: f }));
    const ds = $('#dk-disp', t); if (ds) ds.onchange = () => deskArrange(w, { zone: f, displayId: ds.value, state: w.state === 'minimized' ? 'normal' : w.state });
    $('#dk-focus', t).onclick = () => api.call('focus', w.app, w).catch(fail);
  } else {
    t.innerHTML = `<span class="small muted">Click a window to snap it, or tidy a whole display into a grid.</span><span class="grow"></span>${s.displays.map((x) => `<button class="btn sm" data-tidy="${esc(x.id)}">${ic('grid', 14)}Tidy ${s.displays.length > 1 ? esc(x.label) : 'windows'}</button>`).join('')}`;
    $$('[data-tidy]', t).forEach((b) => b.onclick = async () => { DK.busy = true; try { await api.call('tidy', b.dataset.tidy); } catch (e) { fail(e); } DK.busy = false; refreshDesk(); });
  }
  const groups = []; for (const x of s.windows) { let g = groups.find((y) => sameApp(y.app, x.app)); if (!g) groups.push(g = { app: x.app, wins: [] }); g.wins.push(x); }
  $('#dk-list').innerHTML = groups.map((g) => `<div class="wl-app"><div class="wl-h">${appIcon(g.app)}<span>${esc(g.app.name)}</span></div>${g.wins.map((x) => `<div class="wl-w${x.id === DK.sel ? ' sel' : ''}" data-id="${esc(x.id)}"><span>${esc(x.title || 'Untitled')}</span>${x.state !== 'normal' ? `<span class="small muted" style="flex:none">${x.state === 'minimized' ? 'min' : x.state === 'maximized' ? 'max' : 'full'}</span>` : ''}</div>`).join('')}</div>`).join('') || `<div class="empty">${s.error === 'accessibility' ? 'Waiting for Accessibility access.' : 'No windows open.'}</div>`;
  $$('#dk-list .wl-w').forEach((r) => { r.onclick = () => { DK.sel = r.dataset.id; renderDesk(); }; r.ondblclick = () => { const x = s.windows.find((y) => y.id === r.dataset.id); if (x) api.call('focus', x.app, x).catch(fail); }; });
}
async function deskArrange(w, o) {
  DK.busy = true;
  try { const r = await api.call('arrange', w, o); if (r && r.ok === false) toast(esc(r.error === 'accessibility' ? 'Scene needs Accessibility access to move windows' : `Couldn’t move it: ${r.error}`), true); }
  catch (e) { fail(e); }
  DK.busy = false; setTimeout(refreshDesk, 250);
}
function deskMove(id, patch) {
  const w = DK.snap && DK.snap.windows.find((x) => x.id === id); if (!w) return;
  DK.sel = id; deskArrange(w, { zone: patch.frac, displayId: patch.display, state: patch.state === 'minimized' ? 'normal' : patch.state });
}

// ---------------------------------------------------------------- automations
function renderAuto() {
  $('#au-toggle').classList.toggle('on', !!B.settings.triggers);
  const rows = []; for (const s of B.scenes) for (const [i, t] of (s.triggers || []).entries()) rows.push({ s, t, i });
  $('#au-page').innerHTML = `
    ${!B.settings.triggers ? `<div class="banner" style="margin:0 0 14px">${ic('alert', 18)}<div class="grow"><b>Automations are paused</b><span class="muted">Nothing switches on its own until you turn them back on.</span></div></div>` : ''}
    <div class="sec-h">Triggers<span class="grow"></span><button class="btn sm" id="au-add">${ic('plus', 14)}Add a trigger</button></div>
    <div class="list">${rows.map(({ s, t, i }) => `<div class="li c-${s.color || 'amber'}${B.settings.triggers ? '' : ' off'}"><span class="gl">${ic(t.kind === 'display' ? 'display' : t.kind === 'schedule' ? 'clock' : 'app', 15)}</span><div><div class="t">${trigText(t)}</div><div class="s">Switches to <b>${esc(s.name)}</b> · ${s.triggerMode === 'ask' ? 'asks first' : 'right away'}</div></div><div class="acts"><button class="btn sm ghost" data-edit="${s.id}">Edit</button></div></div>`).join('') || '<div class="empty"><b>No triggers yet</b>Make a scene switch itself when you plug in a monitor, at a time of day, or when an app like Steam opens.</div>'}</div>
    <div class="sec-h">Your displays right now<span class="grow"></span></div>
    <div class="dispcards">${(B.displays || []).map((d) => `<div class="dc"><b>${esc(d.label)}${d.primary ? ' <span class="pill acc" style="margin-left:4px">Main</span>' : ''}</b><span>${d.bounds.width}×${d.bounds.height} points · ${d.scale}× · ${d.internal ? 'built in' : 'external'}</span></div>`).join('')}</div>
    <div class="sec-h">Keyboard<span class="grow"></span></div>
    <div class="list"><div class="li c-amber"><span class="gl">${ic('keyboard', 15)}</span><div><div class="t">Quick switcher</div><div class="s">Opens a small picker over whatever you’re doing. Type to filter, Enter to switch.</div></div><div class="acts"><span class="kbd">${esc(prettyAccel(B.settings.switcherHotkey) || 'Off')}</span></div></div>
    ${B.scenes.filter((s) => s.hotkey).map((s) => `<div class="li c-${s.color}"><span class="gl">${gl(s.glyph, 15)}</span><div><div class="t">${esc(s.name)}</div><div class="s">Switches from anywhere${(B.hotkeyProblems || []).some((p) => p.acc === s.hotkey) ? ' · <span style="color:var(--bad)">another app has this shortcut</span>' : ''}</div></div><div class="acts"><span class="kbd">${esc(prettyAccel(s.hotkey))}</span></div></div>`).join('')}</div>`;
  $$('[data-edit]', $('#au-page')).forEach((b) => b.onclick = () => openEditor(b.dataset.edit, 'triggers'));
  $('#au-add').onclick = (e) => { if (!B.scenes.length) return toast('Make a scene first'); menuPop(e.currentTarget, B.scenes.map((s) => ({ label: s.name, run: () => openEditor(s.id, 'triggers') }))); };
}

// ---------------------------------------------------------------- history
let histOpen = null;
function renderHistory() {
  const h = B.history || [];
  const trig = { manual: 'by you', hotkey: 'shortcut', menu: 'menu bar', display: 'display change', schedule: 'schedule', app: 'app opened', ask: 'notification', switcher: 'quick switcher' };
  $('#hi-page').innerHTML = h.length ? `<div class="list hist">${h.map((x) => `<div class="li c-${x.color || 'slate'}" data-id="${x.id}"><span class="gl">${x.sceneId === 'previous' ? ic('undo', 15) : gl(x.glyph, 15)}</span><div style="min-width:0"><div class="t">${esc(x.sceneId === 'previous' ? x.name : 'Switched to ' + x.name)}</div><div class="s">${esc(trig[x.trigger] || x.trigger)} · placed ${x.placed} window${x.placed === 1 ? '' : 's'}${x.missed && x.missed.length ? ` · missed ${esc(x.missed.join(', '))}` : ''}</div></div><span class="small muted">${new Date(x.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span><span class="small muted tnum">${(x.ms / 1000).toFixed(1)} s</span><span class="pill ${x.ok ? 'ok' : 'warn'}">${x.ok ? 'Done' : 'Notes'}</span>
    ${histOpen === x.id ? `<div class="steps">${(x.steps || []).map((s) => `<div class="step ${s.status}"><span class="si">${s.status === 'ok' ? ic('check', 13) : ic('alert', 13)}</span><div>${esc(s.label)}${s.detail ? `<span class="sd">${esc(s.detail)}</span>` : ''}</div></div>`).join('')}</div>` : ''}</div>`).join('')}</div>`
    : '<div class="empty"><b>No switches yet</b>Every time a scene switches, it shows up here with what happened.</div>';
  $$('#hi-page .li').forEach((r) => r.onclick = () => { histOpen = histOpen === r.dataset.id ? null : r.dataset.id; renderHistory(); });
}

// ---------------------------------------------------------------- settings
async function openSettings() {
  const s = B.settings;
  let running = []; try { running = await api.call('apps:running'); } catch (_) {}
  const m = modal(`<h2>Settings</h2>
    <div class="set-row"><div><div>Appearance</div></div>${seg('theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], s.theme)}</div>
    <div class="set-row"><div><div>Keep running when the window closes</div><div class="s">Needed for shortcuts, triggers and the ${isMac() ? 'menu bar' : 'tray'} menu</div></div><button class="switch ${s.keepRunning ? 'on' : ''}" data-k="keepRunning"></button></div>
    <div class="set-row"><div><div>Open at login</div><div class="s">Starts quietly in the ${isMac() ? 'menu bar' : 'tray'}</div></div><button class="switch ${s.openAtLogin ? 'on' : ''}" data-k="openAtLogin"></button></div>
    ${isMac() ? `<div class="set-row"><div><div>Show the scene’s name in the menu bar</div></div><button class="switch ${s.menuBarName ? 'on' : ''}" data-k="menuBarName"></button></div>` : ''}
    <div class="set-row"><div><div>Notify after automatic switches</div></div><button class="switch ${s.notify ? 'on' : ''}" data-k="notify"></button></div>
    <div class="set-row"><div><div>Quick switcher shortcut</div><div class="s">Opens the scene picker from anywhere</div></div><button class="hk set" id="st-hk">${esc(prettyAccel(s.switcherHotkey) || 'Off')}</button></div>
    <div class="set-row"><div><div>Wait for windows</div><div class="s">How long a switch waits for slow apps to open their windows</div></div><div class="field sm" style="width:110px"><select id="st-wait">${[10, 20, 30, 45, 60].map((n) => `<option value="${n}" ${s.waitSeconds === n ? 'selected' : ''}>${n} seconds</option>`).join('')}</select></div></div>
    <div class="set-row col"><div><div>Never hide or quit</div><div class="s">Apps that stay open whatever a scene says</div></div>
      <div class="openlist" id="st-keep">${(s.keepApps || []).map((a, i) => `<div class="oi">${appIcon(a)}<span>${esc(a.name)}</span><button class="icon-btn xs" data-delkeep="${i}">${ic('x', 13)}</button></div>`).join('') || '<span class="hint">None</span>'}</div>
      <div class="field sm"><select id="st-addkeep"><option value="">Add an app that’s open now…</option>${running.filter((a) => !(s.keepApps || []).some((k) => sameApp(k, a))).map((a, i) => `<option value="${i}">${esc(a.name)}</option>`).join('')}</select></div></div>
    ${isMac() ? `<div class="set-row"><div><div>Accessibility access</div><div class="s">Lets Scene read and move windows</div></div>${B.access.accessibility ? '<span class="pill ok">Allowed</span>' : '<button class="btn sm" data-ax-open>Allow…</button>'}</div>` : ''}
    <div class="set-row"><div><div>Scenes file</div><div class="s">Move scenes to another computer, or keep a copy</div></div><div style="display:flex;gap:6px"><button class="btn sm" id="st-imp">${ic('import', 14)}Import…</button><button class="btn sm" id="st-exp">${ic('export', 14)}Export…</button><button class="btn sm ghost" id="st-data">${ic('folder', 14)}</button></div></div>
    <div class="foot"><span class="small muted grow">Scene ${esc(B.version)}${B.demo ? ' · demo mode' : ''}</span><button class="btn primary" data-close>Done</button></div>`, { wide: true });
  $$('[data-seg="theme"] button', m.el).forEach((b) => b.onclick = async () => { await setSettings({ theme: b.dataset.v }); $$('[data-seg="theme"] button', m.el).forEach((x) => x.classList.toggle('on', x === b)); });
  $$('[data-k]', m.el).forEach((b) => b.onclick = async () => { const k = b.dataset.k; await setSettings({ [k]: !B.settings[k] }); b.classList.toggle('on', !!B.settings[k]); });
  $('#st-wait', m.el).onchange = (e) => setSettings({ waitSeconds: +e.target.value });
  $('#st-addkeep', m.el).onchange = async (e) => { const a = running[+e.target.value]; if (!a) return; await setSettings({ keepApps: [...(B.settings.keepApps || []), { name: a.name, bundleId: a.bundleId || null, path: a.path || null }] }); m.close(); openSettings(); };
  $$('[data-delkeep]', m.el).forEach((b) => b.onclick = async () => { const k = (B.settings.keepApps || []).slice(); k.splice(+b.dataset.delkeep, 1); await setSettings({ keepApps: k }); m.close(); openSettings(); });
  $('#st-imp', m.el).onclick = async () => { try { const n = await api.call('import'); if (n != null) { await reloadScenes(); rerender(); toast(`Imported ${n} scene${n === 1 ? '' : 's'}`); } } catch (e) { fail(e); } };
  $('#st-exp', m.el).onclick = () => api.call('export').catch(fail);
  $('#st-data', m.el).onclick = () => api.call('reveal-data');
  $('#st-hk', m.el).onclick = (e) => {
    const b = e.currentTarget; b.classList.add('rec'); b.textContent = 'Press keys…'; api.call('hotkeys:pause', true).catch(() => {});
    const h = async (ev) => { ev.preventDefault(); ev.stopPropagation(); if (ev.key === 'Escape') return done(); if (ev.key === 'Backspace' || ev.key === 'Delete') { await setSettings({ switcherHotkey: '' }); return done(); } const acc = accelFromKey(ev); if (!acc) return; await setSettings({ switcherHotkey: acc }); done(); };
    const done = () => { document.removeEventListener('keydown', h, true); api.call('hotkeys:pause', false).catch(() => {}); b.classList.remove('rec'); b.textContent = prettyAccel(B.settings.switcherHotkey) || 'Off'; };
    document.addEventListener('keydown', h, true);
  };
  bindAx(m.el);
}
function bindAx(root = document) { $$('[data-ax-open]', root).forEach((b) => b.onclick = axOpen); }
async function axOpen() { try { B.access = await api.call('access:request'); } catch (_) {} rerender(); }

// ---------------------------------------------------------------- boot
async function boot() {
  B = await api.call('bootstrap');
  document.documentElement.dataset.platform = B.platform;
  applyTheme();
  $$('#nav .nav-btn').forEach((b) => b.onclick = () => go(b.dataset.view));
  $('#side-new').onclick = newSceneFlow; $('#sc-new').onclick = newSceneFlow; $('#sc-capture').onclick = captureFlow;
  $('#dk-refresh').onclick = refreshDesk; $('#dk-save').onclick = captureFlow;
  $('#open-settings').onclick = openSettings;
  $('#theme-btn').onclick = () => setSettings({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' });
  $('#ax-open').onclick = axOpen; $('#ax-check').onclick = async () => { B.access = await api.call('access:check'); rerender(); if (B.access.accessibility) toast('Thanks, Scene can move windows now'); };
  bindAx();
  $('#au-toggle').onclick = async () => { await setSettings({ triggers: !B.settings.triggers }); renderAuto(); };
  $('#hi-clear').onclick = async () => { if (await confirmBox('Clear history?', 'This only clears the list. Scenes aren’t touched.', 'Clear')) { B.history = await api.call('history:clear'); renderHistory(); } };
  bindEditorHead();
  api.on('progress', showProgress);
  api.on('switched', (d) => { B.state = d.state; B.scenes = d.scenes; B.history = d.history; if (ED) { const s = B.scenes.find((x) => x.id === ED.id); if (s) { ED.lastUsed = s.lastUsed; ED.uses = s.uses; } } rerender(); if (view === 'desktop') setTimeout(refreshDesk, 300); });
  api.on('awake', (n) => { B.awake = n; renderSide(); });
  api.on('displays', (d) => { B.displays = d; if (view === 'scenes' || view === 'automations') rerender(); });
  api.on('hotkeys', (p) => { B.hotkeyProblems = p; if (view === 'editor') renderHead(); });
  api.on('need-access', () => { B.access = { accessibility: false }; rerender(); });
  api.on('navigate', (v) => { closePop(); go(v); });
  api.on('menu', (k) => { if (k === 'new') newSceneFlow(); if (k === 'capture') captureFlow(); if (k === 'import') api.call('import').then(async (n) => { if (n != null) { await reloadScenes(); rerender(); toast(`Imported ${n} scene${n === 1 ? '' : 's'}`); } }).catch(fail); if (k === 'export') api.call('export').catch(fail); });
  document.addEventListener('keydown', (e) => {
    if (recording || e.target.matches('input, textarea, select')) return;
    if (view === 'editor' && edSel && (e.key === 'Delete' || e.key === 'Backspace')) { const r = findRule(edSel); if (r) { r.a.windows = r.a.windows.filter((w) => w !== r.w); edSel = null; changed(); } }
    if (e.key === 'Escape' && view === 'editor' && edSel) { edSel = null; renderCanvas(); renderTools(); renderTab(); }
  });
  go('scenes');
  document.body.classList.add('ready');
}
boot().catch((e) => { document.body.classList.add('ready'); document.body.innerHTML = `<pre style="padding:30px;color:#f66">${esc(e.stack || e)}</pre>`; });
