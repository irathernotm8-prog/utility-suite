// Mixer window: shared state, navigation, sheets, menus, toasts, the song (edit → commit → main), and "Ask Claude".
'use strict';
const D = window.mixer;
const call = D.call;
const SG = MXSong, SND = MXSounds, TH = MXTheory;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const baseName = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || String(p || '');
const tildify = (p) => (S.info && p && String(p).startsWith(S.info.home) ? '~' + String(p).slice(S.info.home.length) : p);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const fmtDb = (d) => (d <= -60 ? '−∞' : (d > 0 ? '+' : d < 0 ? '−' : '') + Math.abs(d).toFixed(1));
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(Math.floor((s % 1) * 10))}`;

const S = { remoteMark: 0, info: null, settings: {}, songId: null, song: null, rev: 0, history: { undo: [], redo: [] }, view: 'arrange', bridge: {}, ai: null, activity: [], sel: { track: null, clip: null }, editor: null, songs: [] };
const VIEWS = {};

function ago(t) { if (!t) return ''; const s = (Date.now() - t) / 1000; if (s < 45) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago'; if (s < 6 * 86400) return new Date(t).toLocaleDateString(undefined, { weekday: 'short' }); return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
const byWho = (b) => (!b || b === 'you' ? 'You' : /codex/i.test(b) ? 'Codex' : /claude/i.test(b) ? (/code/i.test(b) ? 'Claude Code' : 'Claude') : b);

// ───────── toasts
// Claude's activity: one toast that updates instead of a stack
let actToast = null, actTimer = null;
function activityToast(title, text) { if (actToast && actToast.isConnected) { $('.t-title', actToast).textContent = title; $('.t-text', actToast).textContent = text; } else { actToast = toast(title, text, 'info', 0); } clearTimeout(actTimer); actTimer = setTimeout(() => { if (actToast) { actToast.style.transition = 'opacity .2s'; actToast.style.opacity = 0; const t = actToast; setTimeout(() => t.remove(), 220); actToast = null; } }, 3200); }
function toast(title, text = '', kind = 'ok', ms = 4200) {
  const el = document.createElement('div'); el.className = 'toast ' + kind;
  el.innerHTML = `<span class="t-ic">${kind === 'busy' ? '<span class="spin"></span>' : icon(kind === 'bad' ? 'alert' : kind === 'info' ? 'sparkle' : 'check', 16)}</span><div class="grow"><div class="t-title">${esc(title)}</div>${text ? `<div class="t-text">${esc(text)}</div>` : ''}</div>`;
  $('#toasts').appendChild(el);
  if (ms) setTimeout(() => { el.style.transition = 'opacity .2s'; el.style.opacity = 0; setTimeout(() => el.remove(), 220); }, ms);
  return el;
}
const fail = (e) => toast('That didn’t work', e.message || String(e), 'bad', 8000);

// ───────── navigation
function go(view, arg) {
  const v0 = VIEWS[S.view]; if (v0 && v0.leave && S.view !== view) v0.leave();
  S.view = view; S.arg = arg ?? null;
  $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  render();
}
// sliders show their filled part (--p) — set on every render and while dragging
function rangeFill(r) { const min = +r.min || 0, max = +r.max || 100; r.style.setProperty('--p', (((+r.value - min) / (max - min)) * 100).toFixed(1) + '%'); }
function fillRanges(root = document) { $$('input[type=range]', root).forEach(rangeFill); }
document.addEventListener('input', (e) => { if (e.target.type === 'range') rangeFill(e.target); }, true);
new MutationObserver(() => fillRanges()).observe(document.body, { childList: true, subtree: true });
function render() {
  const v = VIEWS[S.view]; if (!v) return;
  const view = $('#view'); view.className = v.flush ? 'flush' : ''; view.scrollTop = 0;
  $('#headLeft').innerHTML = v.head ? v.head() : `<h1>${esc(v.title)}</h1>`;
  $('#headRight').innerHTML = v.actions ? v.actions() : '';
  v.render(view); if (v.after) v.after(); hydrateIcons(document); fitTitles();
}
function refresh() { const v = VIEWS[S.view]; if (!v) return; if (v.update) v.update(); else render(); }
const _mc = document.createElement('canvas').getContext('2d');
function fitTitles() { $$('.title-input').forEach((i) => { const f = () => { const cs = getComputedStyle(i); _mc.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; i.style.width = Math.ceil(_mc.measureText(i.value || ' ').width + 22) + 'px'; }; f(); i.addEventListener('input', f); }); }

// ───────── sheets (dialogs)
function openSheet(html, { onClose, width, cls = '' } = {}) {
  closeSheet(); const host = $('#sheetHost');
  host.innerHTML = `<div class="scrim"><div class="sheet ${cls}"${width ? ` style="width:min(${width}px,calc(100vw - 48px))"` : ''}>${html}</div></div>`;
  const scrim = host.firstChild; scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) closeSheet(); });
  S.sheetClose = onClose; hydrateIcons(host);
  const first = host.querySelector('[autofocus],input:not([type=hidden]):not([type=range]):not([type=checkbox]),textarea'); if (first) setTimeout(() => first.focus(), 30);
  return scrim.firstChild;
}
function closeSheet() { const h = $('#sheetHost'); if (h.firstChild) { h.innerHTML = ''; if (S.sheetClose) { const f = S.sheetClose; S.sheetClose = null; f(); } } }
function confirmBox({ title, text, ok = 'OK', danger = false }) {
  return new Promise((res) => {
    const el = openSheet(`<div class="sheet-head"><h3>${esc(title)}</h3></div><div class="sheet-body"><p class="muted" style="margin:0">${esc(text)}</p></div><div class="sheet-foot"><span class="grow"></span><button class="btn" data-a="no">Cancel</button><button class="btn ${danger ? 'danger-fill' : 'primary'}" data-a="yes">${esc(ok)}</button></div>`, { width: 460, onClose: () => res(false) });
    el.querySelector('[data-a=yes]').onclick = () => { S.sheetClose = null; closeSheet(); res(true); };
    el.querySelector('[data-a=no]').onclick = () => closeSheet();
  });
}
function promptBox({ title, text = '', label, value = '', placeholder = '', ok = 'Save', fields }) {
  return new Promise((res) => {
    const fs = fields || [{ key: 'v', label, value, placeholder }];
    const el = openSheet(`<div class="sheet-head"><h3>${esc(title)}</h3></div><div class="sheet-body">${text ? `<p class="muted" style="margin:0">${esc(text)}</p>` : ''}${fs.map((f) => `<div class="field">${f.label ? `<label>${esc(f.label)}</label>` : ''}${f.options ? `<select class="select" data-k="${f.key}">${f.options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(f.value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>` : `<input class="input" data-k="${f.key}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}" ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} ${f.step != null ? `step="${f.step}"` : ''} spellcheck="false">`}${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`).join('')}</div><div class="sheet-foot"><span class="grow"></span><button class="btn" data-a="no">Cancel</button><button class="btn primary" data-a="yes">${esc(ok)}</button></div>`, { width: 500, onClose: () => res(null) });
    const done = () => { const o = {}; $$('[data-k]', el).forEach((i) => { o[i.dataset.k] = i.value; }); S.sheetClose = null; closeSheet(); res(fields ? o : o.v); };
    el.querySelector('[data-a=yes]').onclick = done; el.querySelector('[data-a=no]').onclick = () => closeSheet();
    $$('input', el).forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(); }));
  });
}
function lightbox(src) { const el = openSheet(`<div class="lightbox"><img src="${src}"></div>`, { width: 1500, cls: 'lb-sheet' }); el.style.background = 'transparent'; el.style.border = '0'; el.style.boxShadow = 'none'; el.onclick = closeSheet; }

// ───────── menus and popovers
function closePop() { $('#popHost').innerHTML = ''; if (S.popClose) { const f = S.popClose; S.popClose = null; f(); } }
function popAt(anchor, html, { width, align = 'left', cls = '', x: px, y: py, onClose } = {}) {
  closePop(); const host = $('#popHost');
  host.innerHTML = `<div class="pop-catch"></div><div class="menu ${cls}"${width ? ` style="width:${width}px"` : ''}>${html}</div>`;
  const m = host.lastChild; const r = anchor ? anchor.getBoundingClientRect() : { left: px, right: px, top: py, bottom: py }; const mw = m.offsetWidth, mh = m.offsetHeight;
  let x = align === 'right' ? r.right - mw : r.left; let y = r.bottom + 6;
  if (y + mh > innerHeight - 10) y = Math.max(10, r.top - mh - 6);
  x = Math.max(10, Math.min(x, innerWidth - mw - 10)); m.style.left = x + 'px'; m.style.top = y + 'px';
  host.firstChild.onmousedown = closePop; hydrateIcons(host); S.popClose = onClose || null; return m;
}
function menu(anchor, items, opts) {
  const m = popAt(anchor, items.map((it, i) => it === '-' ? '<hr>' : it.header ? `<div class="menu-label">${esc(it.label)}</div>` : `<button data-i="${i}" class="${it.danger ? 'danger' : ''}${it.on ? ' on' : ''}" ${it.disabled ? 'disabled' : ''}>${it.icon ? icon(it.icon, 16) : it.swatch ? `<i class="sw" style="background:${it.swatch}"></i>` : ''}<span class="grow">${esc(it.label)}</span>${it.hint ? `<span class="muted tiny">${esc(it.hint)}</span>` : ''}${it.on ? icon('check', 14) : ''}</button>`).join(''), opts);
  $$('button[data-i]', m).forEach((b) => b.onclick = () => { closePop(); const it = items[+b.dataset.i]; if (it.run) it.run(); });
  return m;
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if ($('#popHost').firstChild) closePop(); else if ($('#sheetHost').firstChild) closeSheet(); } });

// ───────── the song: edit a working copy, then commit it to the main process (which keeps the shared history)
let commitChain = Promise.resolve();
function edit(label, fn, { render: rr = true } = {}) {
  let out;
  try { out = fn(S.song); SG.hydrate(S.song); } catch (e) { fail(e); return null; }
  Player.setSong(S.song); if (rr) refresh(); updateSide();
  const snap = JSON.parse(JSON.stringify(S.song)); const mark = S.remoteMark;
  commitChain = commitChain.then(async () => {
    if (mark !== S.remoteMark) { toast('The song changed meanwhile', `“${label}” wasn’t applied — the newer version is shown.`, 'info', 5000); return; }
    try { const r = await call('song:commit', snap, S.rev, label); S.rev = r.rev; S.history = r.history; updateUndo(); }
    catch (e) { if (/stale/.test(e.message)) { toast('The song changed meanwhile', 'Your last change was not applied — the newer version is shown.', 'info', 5000); await reloadSong(); } else fail(e); }
  });
  return out;
}
async function reloadSong() { const s = await call('song:get'); applySnapshot(s); refresh(); }
function applySnapshot(s) {
  const switched = s.id !== S.songId; S.songId = s.id; S.song = s.song; S.rev = s.rev; S.history = s.history || S.history; S.dir = s.dir;
  if (switched) { S.sel = { track: null, clip: null }; S.editor = null; Player.stop(); }
  if (S.sel.clip && !S.song.clips.some((c) => c.id === S.sel.clip)) { S.sel.clip = null; S.editor = null; }
  if (S.sel.track && !S.song.tracks.some((t) => t.id === S.sel.track)) S.sel.track = null;
  Player.setSong(S.song); updateSide(); updateUndo();
}
function updateSide() { if (!S.song) return; $('#songName').textContent = S.song.name; $('#songSub').textContent = `${S.song.bpm} BPM · ${S.song.key}`; $('#trackCount').textContent = S.song.tracks.length || ''; }
function updateUndo() { const u = $('#undoBtn'), r = $('#redoBtn'); if (u) { u.disabled = !S.history.undo.length; u.title = S.history.undo[0] ? `Undo ${S.history.undo[0].label}` : 'Undo'; } if (r) { r.disabled = !S.history.redo.length; r.title = S.history.redo[0] ? `Redo ${S.history.redo[0].label}` : 'Redo'; } }
async function undo() { if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) { document.execCommand('undo'); return; } await commitChain; const d = await call('song:undo'); if (d.length) toast('Undid', d[0], 'ok', 1800); }
async function redo() { if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) { document.execCommand('redo'); return; } await commitChain; const d = await call('song:redo'); if (d.length) toast('Redid', d[0], 'ok', 1800); }
const track = (id) => S.song.tracks.find((t) => t.id === id);
const clip = (id) => S.song.clips.find((c) => c.id === id);

async function songMenu(anchor) {
  const { list, active } = await call('songs:list');
  menu(anchor, [{ header: true, label: 'Songs' }, ...list.slice(0, 12).map((p) => ({ label: p.name, on: p.id === active, hint: `${p.bpm} · ${p.key}`, run: () => openSong(p.id) })), ...(list.length > 12 ? [{ label: 'All songs…', icon: 'folder', run: () => go('songs') }] : []), '-',
    { label: 'New song…', icon: 'plus', run: newSong }, { label: 'Rename…', icon: 'edit', run: renameSong }, { label: 'Duplicate', icon: 'dup', run: async () => { applySnapshot(await call('songs:duplicate')); render(); } }, { label: 'Show the song folder', icon: 'folder', run: () => call('songs:reveal') }], { width: 300 });
}
async function openSong(id) { applySnapshot(await call('songs:open', id)); go(S.view === 'songs' ? 'arrange' : S.view); }
async function renameSong() { const n = await promptBox({ title: 'Rename song', value: S.song.name, ok: 'Rename' }); if (n) edit('Rename song', (s) => { s.name = n.slice(0, 80); }); }
async function newSong() {
  const keys = []; for (const n of ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']) keys.push(`${n} major`, `${n} minor`);
  const r = await promptBox({ title: 'New song', ok: 'Create', fields: [{ key: 'name', label: 'Name', placeholder: 'e.g. Night Drive' }, { key: 'bpm', label: 'Tempo (BPM)', type: 'number', value: 110, min: 30, max: 300 }, { key: 'key', label: 'Key', value: 'A minor', options: keys.map((k) => ({ value: k, label: k })) }, { key: 'ts', label: 'Time signature', value: '4/4', options: ['4/4', '3/4', '6/8', '5/4', '7/8'].map((x) => ({ value: x, label: x })) }] });
  if (!r) return; const [a, b] = r.ts.split('/').map(Number);
  applySnapshot(await call('songs:create', { name: r.name || 'Untitled song', bpm: +r.bpm || 110, key: r.key, timeSig: [a, b], bars: 16 })); go('arrange');
}

// ───────── Claude card + Ask Claude
function renderAiCard() {
  const el = $('#aiCard'); if (!el) return; const b = S.bridge || {}; const last = S.activity[0];
  const who = b.client ? byWho(b.client) : null;
  el.innerHTML = `<div class="ac-row"><span class="dot ${b.connected ? 'on' : ''}"></span><span class="grow ellip">${b.connected ? `${esc(who || 'Claude')} is here` : 'Claude isn’t connected'}</span></div>
    ${last ? `<div class="ac-last"><b>${esc(byWho(last.by || who || 'Claude'))}</b> ${esc(last.msg)}<span class="muted"> · ${esc(ago(last.at))}</span></div>` : `<div class="ac-last muted">${b.connected ? 'Ask in your chat, or right here.' : 'Add the plugin in Connections, or ask from here.'}</div>`}
    <button class="btn sm ac-ask" id="askBtn"><span data-icon="chat" data-size="15"></span>Ask Claude…</button>`;
  hydrateIcons(el); $('#askBtn').onclick = () => askClaude();
}
let asking = false;
async function askClaude(prefill = '') {
  if (!S.ai) S.ai = await call('ai:status').catch(() => ({}));
  const has = S.ai && (S.ai.claude || S.ai.codex);
  const examples = ['Make a 16-bar lo-fi beat at 82 BPM: dusty drums, electric piano chords, a soft bass and vinyl crackle', 'Write a melody for the chorus on a new lead track and check it fits the chords', 'Mix this: fix whatever the mix check finds and get it to −14 LUFS', 'Add a 4-bar build before bar 17 with a riser and a filter sweep on the pads', 'Turn the imported track into a house remix at 124 BPM'];
  const el = openSheet(`<div class="sheet-head">${icon('chat', 20)}<div class="grow"><h3>Ask ${S.ai?.claude ? 'Claude' : S.ai?.codex ? 'Codex' : 'Claude'}</h3><div class="muted small">${has ? `Runs your own ${S.ai.claude ? 'Claude Code' : 'Codex'} with only Mixer’s tools. Watch the song change as it works.` : 'Claude Code or Codex isn’t installed here — copy the prompt into Claude Desktop with the Mixer plugin added instead.'}</div></div></div>
    <div class="sheet-body"><textarea class="input area" id="askText" rows="4" placeholder="Describe what you want to hear…" autofocus>${esc(prefill)}</textarea>
    <div class="examples">${examples.map((x) => `<button class="ex">${esc(x)}</button>`).join('')}</div>
    <div class="ask-log" id="askLog" hidden></div></div>
    <div class="sheet-foot"><button class="btn ghost sm" id="askCopy">${icon('copy', 14)}Copy prompt</button><span class="grow"></span><button class="btn" id="askClose">Close</button><button class="btn primary" id="askGo" ${has ? '' : 'disabled'}>${icon('sparkle', 15)}Ask</button></div>`, { width: 640, cls: 'ask-sheet' });
  $$('.ex', el).forEach((b) => b.onclick = () => { $('#askText').value = b.textContent; $('#askText').focus(); });
  $('#askClose').onclick = closeSheet;
  $('#askCopy').onclick = () => { call('clipboard:write', `${$('#askText').value.trim()}\n\n(Use the Mixer tools. Song: ${S.song.name}.)`); toast('Copied', 'Paste it into Claude with the Mixer plugin added.'); };
  $('#askGo').onclick = async () => {
    if (asking) { await call('ask:stop'); return; }
    const p = $('#askText').value.trim(); if (!p) return;
    const log = $('#askLog'); log.hidden = false; log.innerHTML = ''; asking = true; $('#askGo').innerHTML = `${icon('stop', 14)}Stop`; $('#askGo').classList.remove('primary');
    const add = (cls, html) => { const d = document.createElement('div'); d.className = 'al ' + cls; d.innerHTML = html; log.appendChild(d); log.scrollTop = log.scrollHeight; };
    add('busy', `<span class="spin"></span>Starting…`);
    const off = D.on('ask:event', (ev) => { if (ev.kind === 'tool') add('tool', `${icon('bolt', 13)}${esc(ev.name.replace(/_/g, ' '))}`); else add('text', esc(ev.text)); });
    try { const r = await call('ask:start', p); add('done', `${icon('check', 14)}${esc(r.text ? r.text.slice(0, 600) : 'Done')}`); }
    catch (e) { add('bad', `${icon('alert', 14)}${esc(e.message)}`); }
    finally { off(); asking = false; const g = $('#askGo'); if (g) { g.innerHTML = `${icon('sparkle', 15)}Ask again`; g.classList.add('primary'); } $$('.al.busy', log).forEach((x) => x.remove()); }
  };
}
async function openPath(p) { try { await call('shell:open', p); } catch (e) { fail(e); } }
function reveal(p) { call('shell:reveal', p).catch(fail); }
