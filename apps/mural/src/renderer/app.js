// Mural — the app window: Library, Studio, Performance, Settings. Talks to main only through window.mural.call().
import { icon, TYPE_ICON } from './icons.js';
import { CITIES } from './runtime/sun.js';
import { createPlayer } from './runtime/player.js';
import { Studio } from './studio.js';

const M = window.mural;
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
if (M.platform === 'win32') document.body.classList.add('win');

export const S = { settings: null, library: [], state: null, page: 'library', filter: 'all', query: '', target: null, info: null };

// ---------------------------------------------------------------------------------------------------- helpers
export function toast(msg, err = false) { const t = h(`<div class="toast ${err ? 'err' : ''}">${err ? '' : icon('check')}${esc(msg)}</div>`); $('#toasts').appendChild(t); setTimeout(() => t.remove(), err ? 6000 : 2800); }
export async function call(name, ...args) { try { return await M.call(name, ...args); } catch (e) { toast(String(e.message || e).replace(/^Error invoking remote method 'mural:call': (Error: )?/, ''), true); throw e; } }
export function menu(x, y, items) {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  const m = h(`<div class="menu"></div>`);
  for (const it of items) {
    if (it === '-') { m.appendChild(h('<hr>')); continue; }
    const b = h(`<button class="${it.danger ? 'danger' : ''}">${it.icon ? icon(it.icon) : ''}<span>${esc(it.label)}${it.hint ? `<span class="hint">${esc(it.hint)}</span>` : ''}</span></button>`);
    b.onclick = () => { m.remove(); it.run(); }; m.appendChild(b);
  }
  document.body.appendChild(m);
  const r = m.getBoundingClientRect(); m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px'; m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', off); } }), 0);
}
const typeLabel = { scene: 'Scene', shader: 'Shader', video: 'Video', image: 'Picture', web: 'Web' };

// ---------------------------------------------------------------------------------------------------- shell
const PAGES = [['library', 'Library'], ['studio', 'Studio'], ['performance', 'Performance'], ['settings', 'Settings']];
function nav() {
  $('#nav').innerHTML = PAGES.map(([id, label]) => `<button data-p="${id}" class="${S.page === id ? 'on' : ''}">${icon(id)}${label}</button>`).join('');
  $('#nav').querySelectorAll('button').forEach((b) => (b.onclick = () => go(b.dataset.p)));
}
export function go(page) {
  S.page = page; nav();
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('on', p.id === page));
  if (page === 'library') renderLibrary(); if (page === 'performance') renderPerf(); if (page === 'settings') renderSettings();
  if (page === 'studio') studio.show(); else studio.hide();
  if (page !== 'library') stopHover();
}
function renderSide() {
  const st = S.state, s = S.settings; if (!st || !s) return;
  const running = st.displays.filter((d) => d.state === 'running').length;
  const cur = S.library.find((w) => w.id === s.wallpaper);
  const dot = !s.enabled ? 'off' : st.userPaused || !running ? 'paused' : '';
  const what = !s.enabled ? 'Off' : st.userPaused ? 'Paused by you' : running ? `Running on ${running} display${running > 1 ? 's' : ''}` : reasonText(st.displays[0] && st.displays[0].reason) || 'Paused';
  $('#now').innerHTML = `<div class="lbl">On the desktop</div><div class="nm">${esc(s.sameOnAll ? (cur ? cur.name : '—') : 'Per display')}</div><div class="meta"><span class="dot ${dot}"></span>${esc(what)}${s.enabled && running ? ` · ${st.totalCpu}% CPU` : ''}</div>`;
  const pb = $('#pauseBtn'); pb.innerHTML = st.userPaused ? `${icon('play')}Resume` : `${icon('pause')}Pause`;
  pb.onclick = async () => { await call('host.pause', !st.userPaused); };
}
export const reasonText = (r) => ({ paused: 'Paused by you', covered: 'Hidden by a full-screen window', locked: 'Screen locked', sleeping: 'Sleeping', battery: 'On battery', hot: 'Computer is hot', idle: 'Nobody’s using it' }[r] || '');

// ---------------------------------------------------------------------------------------------------- library
const FILTERS = [['all', 'All'], ['fav', 'Favorites'], ['mine', 'Mine'], ['scene', 'Scenes'], ['shader', 'Shaders'], ['media', 'Videos & pictures'], ['web', 'Web'], ['tod', 'Time of day'], ['interactive', 'Interactive']];
function libraryFrame() {
  const el = $('#library'); if (el.dataset.built) return el;
  el.dataset.built = 1;
  el.innerHTML = `
    <div class="head"><h1>Library</h1><span class="sub" id="libCount"></span><div class="spacer"></div>
      <div class="search">${icon('search')}<input id="q" placeholder="Search wallpapers"></div>
      <button class="btn" id="addBtn">${icon('plus')}Add</button><button class="btn primary" id="newBtn">${icon('wand')}Make one</button></div>
    <div class="toolbar"><div class="chips" id="chips"></div><div class="spacer"></div><div id="targets"></div></div>
    <div class="scroll"><div class="grid" id="grid"></div></div>`;
  $('#q', el).oninput = (e) => { S.query = e.target.value.toLowerCase(); renderGrid(); };
  $('#addBtn', el).onclick = () => importFiles();
  $('#newBtn', el).onclick = () => { go('studio'); studio.showStarters(); };
  return el;
}
async function importFiles(paths) {
  const r = await call('library.import', paths || []);
  if (r.imported.length) toast(`Added ${r.imported.length} wallpaper${r.imported.length > 1 ? 's' : ''}`);
  for (const s of r.skipped) toast(`${s.path.split(/[\\/]/).pop()}: ${s.why}`, true);
}
function renderLibrary() {
  const el = libraryFrame();
  $('#chips', el).innerHTML = FILTERS.map(([k, l]) => `<button class="chip ${S.filter === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('');
  $('#chips', el).querySelectorAll('.chip').forEach((b) => (b.onclick = () => { S.filter = b.dataset.f; renderLibrary(); }));
  const ds = (S.state && S.state.displays) || [];
  $('#targets', el).innerHTML = ds.length > 1 ? `<div class="seg" id="tseg"><button data-k="" class="${!S.target ? 'on' : ''}">All displays</button>${ds.map((d) => `<button data-k="${esc(d.key)}" class="${S.target === d.key ? 'on' : ''}">${esc(d.label)}</button>`).join('')}</div>` : '';
  el.querySelectorAll('#tseg button').forEach((b) => (b.onclick = () => { S.target = b.dataset.k || null; renderLibrary(); }));
  renderGrid();
}
function shown() {
  const favs = new Set(S.settings.favorites || []);
  return S.library.filter((w) => {
    if (S.query && !(`${w.name} ${w.tags.join(' ')} ${w.type}`).toLowerCase().includes(S.query)) return false;
    switch (S.filter) {
      case 'fav': return favs.has(w.id); case 'mine': return !w.builtin; case 'scene': return w.type === 'scene'; case 'shader': return w.type === 'shader';
      case 'media': return w.type === 'video' || w.type === 'image'; case 'web': return w.type === 'web'; case 'tod': return w.traits.timeOfDay; case 'interactive': return w.traits.cursor || w.traits.click;
      default: return true;
    }
  });
}
function onDesktop(id) {
  const ds = (S.state && S.state.displays) || [];
  if (S.target) return ds.some((d) => d.key === S.target && d.wallpaperId === id);
  return S.settings.sameOnAll ? S.settings.wallpaper === id : ds.some((d) => d.wallpaperId === id);
}
function renderGrid() {
  const grid = $('#grid'); if (!grid) return;
  const list = shown(); const favs = new Set(S.settings.favorites || []);
  $('#libCount').textContent = `${S.library.length} wallpapers`;
  if (!list.length) { grid.innerHTML = `<div class="empty">${S.filter === 'mine' ? 'Nothing of your own yet. Drop a video or picture here, or make one in the Studio.' : 'Nothing matches.'}</div>`; return; }
  grid.innerHTML = '';
  for (const w of list) {
    const cur = onDesktop(w.id);
    const tr = w.traits;
    const card = h(`<div class="card ${cur ? 'current' : ''}" data-id="${esc(w.id)}">
      <div class="thumb" style="${w.thumb ? `background-image:url('${w.thumb}')` : ''}">${w.thumb ? '' : `<div class="ph">${icon(TYPE_ICON[w.type] || 'layers')}</div>`}
        <div class="tl">${cur ? `<span class="badge cur">${icon('display')}On desktop</span>` : ''}</div>
        <div class="tr ${favs.has(w.id) ? 'fav' : ''}"><button class="round star ${favs.has(w.id) ? 'on' : ''}" title="Favorite">${icon('star')}</button><button class="round more" title="More">${icon('more')}</button></div>
        <div class="over"><button class="btn sm primary apply">${icon('display')}${S.target ? 'Use here' : 'Set as wallpaper'}</button><button class="btn sm edit">${icon('studio')}Edit</button></div>
      </div>
      <div class="meta-row"><span class="nm">${esc(w.name)}</span><span class="traits">${tr.timeOfDay ? `<span title="Changes with the time of day">${icon('sun')}</span>` : ''}${tr.cursor ? `<span title="Reacts to the cursor">${icon('cursor')}</span>` : ''}${tr.click ? `<span title="Reacts to clicks">${icon('click')}</span>` : ''}</span><span class="ty">${typeLabel[w.type] || ''}</span></div>
    </div>`);
    $('.apply', card).onclick = async (e) => { e.stopPropagation(); await call('apply', w.id, S.target); toast(`${w.name} is on your desktop`); };
    $('.edit', card).onclick = (e) => { e.stopPropagation(); go('studio'); studio.open(w.id); };
    $('.star', card).onclick = async (e) => { e.stopPropagation(); await call('favorite', w.id, !favs.has(w.id)); };
    $('.more', card).onclick = (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); cardMenu(w, r.left, r.bottom + 4); };
    card.oncontextmenu = (e) => { e.preventDefault(); cardMenu(w, e.clientX, e.clientY); };
    card.ondblclick = () => call('apply', w.id, S.target).then(() => toast(`${w.name} is on your desktop`));
    card.onmouseenter = () => { card.dataset.hover = '1'; hoverStart(card, w); };
    card.onmouseleave = () => { delete card.dataset.hover; stopHover(card); };
    grid.appendChild(card);
  }
  queueThumbs(list.filter((w) => !w.thumb));
}
function cardMenu(w, x, y) {
  const ds = (S.state && S.state.displays) || [];
  menu(x, y, [
    { label: 'Set as wallpaper', icon: 'display', run: () => call('apply', w.id, null).then(() => toast(`${w.name} is on your desktop`)) },
    ...(ds.length > 1 ? ds.map((d) => ({ label: `Use on ${d.label}`, icon: 'display', run: () => call('apply', w.id, d.key) })) : []),
    { label: 'Edit in Studio', icon: 'studio', hint: w.builtin ? 'Saving makes your own copy' : '', run: () => { go('studio'); studio.open(w.id); } },
    { label: 'Duplicate', icon: 'copy', run: () => call('library.duplicate', w.id).then(() => toast('Duplicated')) },
    { label: 'Export .mural…', icon: 'export', run: () => call('library.export', w.id) },
    { label: 'Show files', icon: 'folder', run: () => call('library.reveal', w.id) },
    ...(w.builtin ? [] : ['-', { label: 'Move to Trash', icon: 'trash', danger: true, run: () => call('library.remove', w.id) }])
  ]);
}
// live preview on hover: one at a time, after a short pause so sweeping the mouse across the grid costs nothing
let hover = null, hoverTimer = 0;
function hoverStart(card, w) {
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(async () => {
    stopHover();
    const full = await M.call('library.get', w.id).catch(() => null); if (!full || !card.dataset.hover) return;
    const box = h('<div class="live"></div>'); $('.thumb', card).prepend(box);
    try {
      const p = await createPlayer(box, { manifest: { ...full.manifest, code: full.code || full.manifest.code }, base: full.base, fps: 30, scale: 1, location: S.settings.location });
      hover = { card, box, p };
      const th = $('.thumb', card);
      th.onmousemove = (e) => { const r = th.getBoundingClientRect(); p.pointer((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, true); };
      th.onmousedown = (e) => { if (e.target.closest('button')) return; const r = th.getBoundingClientRect(); p.click((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); };
    } catch (_) { box.remove(); }
  }, 260);
}
function stopHover(card) {
  clearTimeout(hoverTimer);
  if (hover && (!card || hover.card === card)) { hover.p.destroy(); hover.box.remove(); hover = null; }
}
let thumbBusy = false; const thumbTried = new Set();
async function queueThumbs(list) {
  if (thumbBusy) return; thumbBusy = true;
  try {
    for (const w of list) {
      if (thumbTried.has(w.id)) continue; thumbTried.add(w.id);
      const url = await M.call('library.thumb', w.id).catch(() => null);
      const card = document.querySelector(`.card[data-id="${CSS.escape(w.id)}"] .thumb`);
      if (url && card) { card.style.backgroundImage = `url('${url}')`; const ph = $('.ph', card); if (ph) ph.remove(); }
    }
  } finally { thumbBusy = false; }
}

// drag and drop anywhere
let dragDepth = 0;
addEventListener('dragenter', (e) => { if (S.page === 'studio') return; if ([...e.dataTransfer.types].includes('Files')) { dragDepth++; $('#drop').classList.add('on'); } });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop').classList.remove('on'); } });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; $('#drop').classList.remove('on'); if (S.page === 'studio') return;
  const paths = [...e.dataTransfer.files].map((f) => M.pathFor(f)).filter(Boolean);
  if (paths.length) { go('library'); S.filter = 'all'; importFiles(paths); }
});

// ---------------------------------------------------------------------------------------------------- performance
const cpuHist = [];
function renderPerf() {
  const el = $('#performance'); const st = S.state, s = S.settings; if (!st || !s) return;
  if (!el.dataset.built) {
    el.dataset.built = 1;
    el.innerHTML = `<div class="head"><h1>Performance</h1><span class="sub">Wallpapers stop the moment you can’t see them</span><div class="spacer"></div><button class="btn" id="reloadWp">${icon('refresh')}Reload wallpapers</button></div><div class="scroll"><div class="settings-wrap" id="perfBody"></div></div>`;
    $('#reloadWp', el).onclick = () => call('host.reload');
  }
  const body = $('#perfBody', el);
  const lvl = st.governor.level;
  const head = `
  <div class="box"><h3>${icon('bolt')}Right now</h3>
    <p class="desc">${!s.enabled ? 'Wallpapers are off.' : st.userPaused ? 'Paused by you — nothing is drawing.' : lvl ? `Over the ${st.governor.budget} budget, so Mural is drawing less (step ${lvl}). It eases back up when there’s room.` : `Inside the ${st.governor.budget} budget.`}</p>
    <div class="kpis"><div class="kpi"><div class="v">${st.totalCpu}<small>%</small></div><div class="k">CPU, wallpapers${st.governor.limit !== null && isFinite(st.governor.limit) ? ` (budget ${st.governor.limit}%)` : ''}</div></div>
      <div class="kpi"><div class="v">${st.displays.reduce((a, d) => a + d.memMB, 0)}<small>MB</small></div><div class="k">Memory, wallpapers</div></div>
      <div class="kpi"><div class="v">${st.gpuCpu}<small>%</small></div><div class="k">Graphics process</div></div>
      <div class="kpi"><div class="v">${st.power.onBattery ? 'Battery' : 'Power'}</div><div class="k">${st.power.onBattery ? (s.battery === 'eco' ? 'Eco: 15 fps' : s.battery === 'pause' ? 'Paused' : 'Normal') : 'Plugged in'}</div></div></div>
    <canvas class="spark" id="spark"></canvas></div>
  ${st.displays.map((d) => `<div class="box"><h3>${icon('display')}${esc(d.label)} <span class="pill ${d.state}">${d.state === 'running' ? 'Running' : d.state === 'paused' ? 'Paused' : d.state === 'freed' ? 'Memory freed' : 'Off'}</span></h3>
    <p class="desc">${esc(d.name || '—')}${d.reason ? ' · ' + esc(reasonText(d.reason)) : ''}${d.error ? ` · <span style="color:var(--danger)">${esc(d.error)}</span>` : ''}</p>
    <div class="kpis"><div class="kpi"><div class="v">${d.fps}<small>/${d.quality.fps}</small></div><div class="k">Frames / second</div></div><div class="kpi"><div class="v">${d.frameMs}<small>ms</small></div><div class="k">Work per frame</div></div>
    <div class="kpi"><div class="v">${d.cpu}<small>%</small></div><div class="k">CPU</div></div><div class="kpi"><div class="v">${d.memMB}<small>MB</small></div><div class="k">Memory</div></div></div></div>`).join('')}`;
  body.innerHTML = head + `
  <div class="box"><h3>${icon('performance')}Limits</h3>
    <div class="row"><div class="t"><b>Frame rate cap</b><span>Most wallpapers look smooth at 30. Mural sleeps between frames.</span></div><div class="seg" data-k="fps">${[15, 24, 30, 60].map((f) => `<button data-v="${f}" class="${s.fps === f ? 'on' : ''}">${f}</button>`).join('')}</div></div>
    <div class="row"><div class="t"><b>Resolution</b><span>${Math.round(s.scale * 100)}% of the screen’s pixels (shaders use their own lower setting on top)</span></div><input type="range" min="0.4" max="1" step="0.05" value="${s.scale}" id="scale" style="max-width:200px"></div>
    <div class="row"><div class="t"><b>CPU budget</b><span>When wallpapers use more than this, Mural lowers the frame rate, then the resolution.</span></div><div class="seg" data-k="budget">${[['light', 'Light 4%'], ['balanced', 'Balanced 8%'], ['generous', 'Generous 16%'], ['unlimited', 'No limit']].map(([v, l]) => `<button data-v="${v}" class="${s.budget === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="row"><div class="t"><b>On battery</b><span>Eco drops to 15 fps and lower resolution.</span></div><div class="seg" data-k="battery">${[['normal', 'Normal'], ['eco', 'Eco'], ['pause', 'Pause']].map(([v, l]) => `<button data-v="${v}" class="${s.battery === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
  </div>
  <div class="box"><h3>${icon('pause')}Pause when</h3>
    ${[['pauseCovered', 'A full-screen or maximized window hides the desktop', 'Games, videos and full-screen apps get the whole computer'], ['pauseLocked', 'The screen is locked or asleep', ''], ['pauseHot', 'The computer is running hot', 'Mac only; Windows doesn’t report it'], ['pauseIdle', 'Nobody’s used the computer for 5 minutes', '']].map(([k, t, d]) => `<div class="row"><div class="t"><b>${t}</b>${d ? `<span>${d}</span>` : ''}</div><button class="switch ${s[k] !== false ? 'on' : ''}" data-sw="${k}"></button></div>`).join('')}
    <div class="row"><div class="t"><b>Free memory after a long pause</b><span>Swaps a still of the wallpaper in as your normal wallpaper and closes the window. Your old wallpaper comes back when you quit or turn this off.</span></div><div class="seg" data-k="freeAfter">${[[0, 'Never'], [2, '2 min'], [5, '5 min'], [15, '15 min']].map(([v, l]) => `<button data-v="${v}" class="${s.freeAfter === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
  </div>`;
  bindSettingControls(body);
  drawSpark();
}
function drawSpark() {
  const c = $('#spark'); if (!c) return; const dpr = devicePixelRatio || 1; const W = c.clientWidth, H = c.clientHeight; c.width = W * dpr; c.height = H * dpr;
  const g = c.getContext('2d'); g.scale(dpr, dpr);
  const lim = S.state.governor.limit; const max = Math.max(4, ...cpuHist, isFinite(lim) ? lim * 1.2 : 0);
  g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 1; for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(0, H * i / 4); g.lineTo(W, H * i / 4); g.stroke(); }
  if (isFinite(lim)) { const y = H - (lim / max) * H; g.setLineDash([4, 4]); g.strokeStyle = 'rgba(255,179,107,.6)'; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); g.setLineDash([]); g.fillStyle = 'rgba(255,179,107,.8)'; g.font = '10px system-ui'; g.fillText('budget', 4, y - 4); }
  if (cpuHist.length < 2) return;
  const pts = cpuHist.map((v, i) => [W * i / 44, H - (v / max) * H]);
  const grad = g.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, 'rgba(139,123,255,.35)'); grad.addColorStop(1, 'rgba(139,123,255,0)');
  g.beginPath(); g.moveTo(pts[0][0], H); pts.forEach(([x, y]) => g.lineTo(x, y)); g.lineTo(pts[pts.length - 1][0], H); g.fillStyle = grad; g.fill();
  g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.strokeStyle = '#a597ff'; g.lineWidth = 1.6; g.stroke();
}
function bindSettingControls(root) {
  root.querySelectorAll('.seg[data-k] button').forEach((b) => (b.onclick = () => { const k = b.parentElement.dataset.k; const v = isNaN(Number(b.dataset.v)) ? b.dataset.v : Number(b.dataset.v); call('settings.set', { [k]: v }); }));
  root.querySelectorAll('.switch[data-sw]').forEach((b) => (b.onclick = () => { const k = b.dataset.sw; call('settings.set', { [k]: !(S.settings[k] !== false) }); }));
  const sc = $('#scale', root); if (sc) sc.onchange = () => call('settings.set', { scale: Number(sc.value) });
}

// ---------------------------------------------------------------------------------------------------- settings
let aiStatus = null;
async function renderSettings() {
  const el = $('#settings'); const s = S.settings; if (!s) return;
  if (!el.dataset.built) { el.dataset.built = 1; el.innerHTML = `<div class="head"><h1>Settings</h1><div class="spacer"></div></div><div class="scroll"><div class="settings-wrap" id="setBody"></div></div>`; }
  const ds = (S.state && S.state.displays) || [];
  const loc = s.location;
  const body = $('#setBody', el);
  const scroll = body.parentElement.scrollTop;
  body.innerHTML = `
  <div class="box"><h3>${icon('display')}Displays</h3>
    <div class="row"><div class="t"><b>Wallpapers on the desktop</b><span>Turn off to go back to your normal wallpaper. Mural keeps running in the ${M.platform === 'darwin' ? 'menu bar' : 'tray'}.</span></div><button class="switch ${s.enabled ? 'on' : ''}" data-sw="enabled"></button></div>
    <div class="row"><div class="t"><b>Same wallpaper on every display</b></div><button class="switch ${s.sameOnAll ? 'on' : ''}" data-sw="sameOnAll"></button></div>
    ${!s.sameOnAll ? `<div class="disp-map" style="margin-top:8px">${ds.map((d) => `<div class="disp"><div class="nm">${icon('display')}${esc(d.label)}<span class="res">${d.bounds.width}×${d.bounds.height}${d.scale > 1 ? ' @' + d.scale + 'x' : ''}</span></div><select class="txt" data-disp="${esc(d.key)}">${S.library.map((w) => `<option value="${esc(w.id)}" ${w.id === d.wallpaperId ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></div>`).join('')}</div>` : ''}
  </div>
  <div class="box"><h3>${icon('cursor')}Reacting</h3>
    <div class="row"><div class="t"><b>Follow the cursor</b><span>Depth, lights and particles respond to where the pointer is.</span></div><button class="switch ${s.cursor !== false ? 'on' : ''}" data-sw="cursor"></button></div>
    <div class="row"><div class="t"><b>React to clicks on the desktop</b><span>Only clicks on the bare desktop count, never clicks in your apps.</span></div><button class="switch ${s.clicks !== false ? 'on' : ''}" data-sw="clicks"></button></div>
  </div>
  <div class="box"><h3>${icon('sun')}Time of day</h3>
    <p class="desc">Dynamic wallpapers follow the real sun where you are. ${loc ? `Using <b>${esc(loc.name)}</b> (${loc.lat.toFixed(2)}, ${loc.lon.toFixed(2)}).` : 'Using a guess from your time zone.'}</p>
    <div style="display:flex;gap:8px"><input class="txt" id="citySearch" placeholder="Search a city" style="flex:1"><input class="txt" id="lat" placeholder="Latitude" style="width:100px" value="${loc ? loc.lat : ''}"><input class="txt" id="lon" placeholder="Longitude" style="width:100px" value="${loc ? loc.lon : ''}"><button class="btn" id="setLL">Set</button>${loc ? `<button class="btn ghost" id="clearLoc">Use time zone</button>` : ''}</div>
    <div class="city-list" id="cities"></div>
  </div>
  <div class="box"><h3>${icon('refresh')}Rotate</h3>
    <div class="row"><div class="t"><b>Change wallpaper on a timer</b><span>Goes through your favorites${(s.favorites || []).length < 2 ? ' (star at least two in the Library)' : ` (${s.favorites.length})`}.</span></div><button class="switch ${s.rotate.on ? 'on' : ''}" id="rotOn"></button></div>
    <div class="row"><div class="t"><b>Every</b></div><div class="seg" id="rotMin">${[15, 30, 60, 180, 1440].map((m) => `<button data-v="${m}" class="${s.rotate.minutes === m ? 'on' : ''}">${m < 60 ? m + ' min' : m === 1440 ? 'Day' : m / 60 + ' h'}</button>`).join('')}</div></div>
  </div>
  <div class="box"><h3>${icon('claude')}Claude & Codex</h3>
    <p class="desc">Let Claude or Codex build and tune wallpapers for you: it can read the library, make scenes and shaders, look at a preview of what it made, and put it on your desktop.</p>
    <div id="aiRows"><div class="hint">Checking…</div></div>
  </div>
  <div class="box"><h3>${icon('settings')}General</h3>
    <div class="row"><div class="t"><b>Open at login</b><span>Starts quietly in the ${M.platform === 'darwin' ? 'menu bar' : 'tray'} and puts your wallpaper back.</span></div><button class="switch ${s.startAtLogin ? 'on' : ''}" data-sw="startAtLogin"></button></div>
    <div class="row"><div class="t"><b>Show frame rate on the desktop</b></div><button class="switch ${s.showStats ? 'on' : ''}" data-sw="showStats"></button></div>
    <div class="row"><div class="t"><b>Your wallpapers folder</b><span>${esc(S.info ? S.info.library : '')}</span></div><button class="btn" id="openLib">${icon('folder')}Open</button></div>
    <div class="row"><div class="t"><b>Mural ${esc(S.info ? S.info.version : '')}</b><span>Part of the Utility Suite.</span></div></div>
  </div>`;
  body.parentElement.scrollTop = scroll;
  bindSettingControls(body);
  body.querySelectorAll('select[data-disp]').forEach((sel) => (sel.onchange = () => call('apply', sel.value, sel.dataset.disp)));
  const cities = $('#cities', body);
  const listCities = (q) => { cities.innerHTML = CITIES.filter((c) => !q || c.name.toLowerCase().includes(q)).map((c) => `<button data-n="${esc(c.name)}" class="${loc && loc.name === c.name ? 'on' : ''}">${esc(c.name)}<span>${c.lat.toFixed(1)}, ${c.lon.toFixed(1)}</span></button>`).join(''); cities.querySelectorAll('button').forEach((b) => (b.onclick = () => { const c = CITIES.find((x) => x.name === b.dataset.n); call('settings.set', { location: c }); })); };
  listCities(''); $('#citySearch', body).oninput = (e) => listCities(e.target.value.toLowerCase());
  $('#setLL', body).onclick = () => { const lat = Number($('#lat', body).value), lon = Number($('#lon', body).value); if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return toast('Latitude −90…90, longitude −180…180', true); call('settings.set', { location: { name: 'Custom place', lat, lon } }); };
  if ($('#clearLoc', body)) $('#clearLoc', body).onclick = () => call('settings.set', { location: null });
  $('#rotOn', body).onclick = () => call('settings.set', { rotate: { on: !s.rotate.on, ids: s.favorites || [] } });
  $('#rotMin', body).querySelectorAll('button').forEach((b) => (b.onclick = () => call('settings.set', { rotate: { minutes: Number(b.dataset.v), ids: s.favorites || [] } })));
  $('#openLib', body).onclick = () => call('library.openFolder');
  aiStatus = await M.call('ai.status').catch(() => null); renderAi();
}
function renderAi() {
  const box = $('#aiRows'); if (!box || !aiStatus) return;
  const st = aiStatus; const b = st.bridge || {};
  const row = (key, name, x, note) => `<div class="row"><div class="t"><b>${name}</b><span>${x.added ? (x.current ? 'Connected' : 'Connected to an older copy — reconnect') : note}</span></div>${x.added && x.current ? `<span class="pill">${icon('check')} Added</span>` : `<button class="btn sm" data-ai="${key}">${x.added ? 'Reconnect' : 'Connect'}</button>`}</div>`;
  box.innerHTML = row('desktop', 'Claude Desktop', st.desktop, st.desktop.installed ? 'Adds Mural to Claude’s tools. Restart Claude afterwards.' : 'Claude Desktop isn’t installed — this still works once it is.')
    + row('code', 'Claude Code', st.code, st.code.installed ? `Found ${st.code.version || 'claude'}` : 'Not found on this computer')
    + row('codex', 'Codex', st.codex, st.codex.installed ? 'Adds Mural to Codex (CLI, IDE and app)' : 'Not found on this computer')
    + `<div class="hint">${b.connected ? `${esc(b.client || 'An AI')} is talking to Mural right now.` : 'Then ask, for example: “Make me a rainy Tokyo night wallpaper with neon reflections that ripple when I click.”'}</div>`;
  box.querySelectorAll('[data-ai]').forEach((btn) => (btn.onclick = async () => { aiStatus = await call('ai.connect', btn.dataset.ai); renderAi(); toast('Connected — restart that app to pick it up'); }));
}

// ---------------------------------------------------------------------------------------------------- start
const studio = new Studio($('#studio'), { call, toast, menu, go, S, raw: M });
M.on('library', (l) => { S.library = l; if (S.page === 'library') renderGrid(); renderSide(); studio.libraryChanged(); });
M.on('settings', (s) => { S.settings = s; renderSide(); if (S.page === 'library') renderLibrary(); if (S.page === 'settings') renderSettings(); if (S.page === 'performance') renderPerf(); });
M.on('state', (st) => { const prev = S.state; S.state = st; renderSide(); if (S.page === 'performance') { if (!prev || prev.totalCpu !== st.totalCpu || true) { cpuHist.push(st.totalCpu); if (cpuHist.length > 45) cpuHist.shift(); } renderPerf(); } if (S.page === 'library' && (!prev || JSON.stringify(prev.displays.map((d) => d.wallpaperId)) !== JSON.stringify(st.displays.map((d) => d.wallpaperId)))) renderGrid(); });
M.on('goto', (p) => go(p));
M.on('bridge', () => { if (S.page === 'settings') M.call('ai.status').then((s) => { aiStatus = s; renderAi(); }); });
(async () => {
  [S.info, S.settings, S.library, S.state] = await Promise.all([M.call('app.info'), M.call('settings.get'), M.call('library.list'), M.call('host.status')]);
  nav(); renderSide();
  go((location.hash || '#library').slice(1) || 'library');
  window.__mural = { S, go, studio };
})();
