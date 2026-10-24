// Beam window: shared state, navigation, sheets, menus, toasts and small helpers used by every view.
'use strict';
const B = window.beam;
const call = B.call;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const baseName = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || String(p || '');

const S = { me: null, settings: {}, peers: [], transfers: new Map(), history: [], staged: [], stagedInfo: [], view: 'nearby', asking: [], phone: null, filter: 'all' };
const VIEWS = {};

// ───────── words and numbers
function human(n) {
  if (n == null || !Number.isFinite(n)) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
  while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
  return (i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)) + ' ' + u[i];
}
function dur(s) {
  s = Math.max(0, Math.round(s));
  if (s < 60) return s + ' s';
  const m = Math.floor(s / 60); if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
const plural = (n, w) => `${Number(n).toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
function clock(t) { return new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
function ago(t) { if (!t) return ''; const s = (Date.now() - t) / 1000; if (s < 45) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return clock(t); return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + clock(t); }
function dayLabel(t) {
  const d = new Date(t), now = new Date();
  const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
  if (days === 0) return 'Today'; if (days === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}
const isLink = (t) => /^https?:\/\/\S+$/.test(String(t || '').trim());

// what a transfer is, in a few words: “Holiday” and 1 more · 403 files
function whatOf(t) {
  if (t.kind === 'text') return isLink(t.text) ? 'A link' : 'Text';
  const n = t.names || [];
  if (!n.length) return plural(t.count || 0, 'file');
  const more = (t.tops || n.length) - 1;
  return more > 0 ? `${n[0]} and ${more} more` : n[0];
}

// ───────── device looks
const TINTS = ['a-sky', 'a-indigo', 'a-mint', 'a-coral', 'a-gold', 'a-cyan', 'a-blue'];
function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const TINT = {};
// a colour per device: from its id, but two devices never share one while there are colours to spare
function tintOf(id) {
  if (TINT[id]) return TINT[id];
  const used = new Set(Object.values(TINT)); let i = hash(id) % TINTS.length;
  for (let k = 0; k < TINTS.length; k++) if (!used.has(TINTS[(i + k) % TINTS.length])) { i = (i + k) % TINTS.length; break; }
  return (TINT[id] = TINTS[i]);
}
function devIcon(p) {
  if (!p) return 'laptop';
  if (p.dev === 'phone') return 'phone'; if (p.dev === 'tablet') return 'tablet'; if (p.dev === 'browser') return 'browser';
  return p.dev === 'desktop' ? 'desktop' : 'laptop';
}
function osName(os) { return { mac: 'Mac', windows: 'Windows', linux: 'Linux', ios: 'iOS', android: 'Android' }[os] || ''; }
function fileIcon(name, dir) {
  if (dir) return 'folder';
  const e = String(name).split('.').pop().toLowerCase();
  if (/^(jpe?g|png|gif|webp|heic|heif|tiff?|bmp|raw|cr2|nef|arw|dng|svg|psd)$/.test(e)) return 'image';
  if (/^(mp4|mov|m4v|mkv|avi|webm|wmv)$/.test(e)) return 'video';
  if (/^(mp3|m4a|wav|flac|aac|ogg|aiff?)$/.test(e)) return 'music';
  if (/^(zip|rar|7z|tar|gz|dmg|iso|pkg|exe|msi|apk)$/.test(e)) return 'zip';
  if (/^(txt|md|pdf|docx?|rtf|pages|csv|xlsx?|pptx?|key|numbers)$/.test(e)) return 'fileText';
  return 'file';
}

// ───────── toasts
function toast(title, text = '', kind = 'ok', ms = 4200, actions) {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = `<span class="t-ic">${kind === 'busy' ? '<span class="spin"></span>' : icon(kind === 'bad' ? 'alert' : kind === 'info' ? 'info' : 'check', 16)}</span><div class="grow"><div class="t-title">${esc(title)}</div>${text ? `<div class="t-text">${esc(text)}</div>` : ''}${actions ? `<div class="row" style="margin-top:7px;gap:6px">${actions.map((a, i) => `<button class="btn xs" data-a="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}</div>`;
  if (actions) el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { actions[+b.dataset.a].run(); el.remove(); });
  $('#toasts').appendChild(el);
  if (ms) setTimeout(() => { el.style.transition = 'opacity .2s'; el.style.opacity = 0; setTimeout(() => el.remove(), 220); }, ms);
  return el;
}
const fail = (e) => toast('That didn’t work', e.message || String(e), 'bad', 8000);

// ───────── navigation
function go(view) {
  S.view = view;
  $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  render();
}
function render() {
  const v = VIEWS[S.view]; if (!v) return;
  const view = $('#view');
  view.className = v.flush ? 'flush' : '';
  $('#headLeft').innerHTML = v.head ? v.head() : `<h1>${esc(v.title)}</h1>`;
  $('#headRight').innerHTML = v.actions ? v.actions() : '';
  v.render(view);
  if (v.after) v.after();
  hydrateIcons(document);
  side();
}
function refresh(views) { if (!views || views.includes(S.view)) render(); }

// ───────── sheets (dialogs)
function openSheet(html, { onClose, width, cls = '' } = {}) {
  closeSheet();
  const host = $('#sheetHost');
  host.innerHTML = `<div class="scrim"><div class="sheet ${cls}"${width ? ` style="width:min(${width}px,calc(100vw - 48px))"` : ''}>${html}</div></div>`;
  const scrim = host.firstChild;
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim && !scrim.firstChild.classList.contains('sticky')) closeSheet(); });
  S.sheetClose = onClose;
  hydrateIcons(host);
  const first = host.querySelector('input:not([type=hidden]):not([type=checkbox]),textarea'); if (first) setTimeout(() => first.focus(), 30);
  return scrim.firstChild;
}
function closeSheet() { const h = $('#sheetHost'); if (h.firstChild) { h.innerHTML = ''; if (S.sheetClose) { const f = S.sheetClose; S.sheetClose = null; f(); } } }
function confirmBox({ title, text, ok = 'OK', danger = false }) {
  return new Promise((res) => {
    const el = openSheet(`<div class="sheet-head"><h3>${esc(title)}</h3></div><div class="sheet-body"><div class="muted">${esc(text)}</div></div>
      <div class="sheet-foot"><span class="grow"></span><button class="btn" data-x>Cancel</button><button class="btn ${danger ? 'danger-fill' : 'primary'}" data-ok>${esc(ok)}</button></div>`, { onClose: () => res(false), width: 440 });
    el.querySelector('[data-x]').onclick = () => closeSheet();
    el.querySelector('[data-ok]').onclick = () => { S.sheetClose = null; closeSheet(); res(true); };
  });
}

// ───────── menus
function menu(anchor, items, { head } = {}) {
  closeMenu();
  const host = $('#popHost');
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  host.innerHTML = `<div class="pop-catch"></div><div class="menu">${head || ''}${items.map((it, i) => it === '-' ? '<hr>' : it.label && it.section ? `<div class="menu-label">${esc(it.label)}</div>` : `<button data-i="${i}" class="${it.danger ? 'danger' : ''}" ${it.disabled ? 'disabled' : ''}>${it.icon ? icon(it.icon, 16) : ''}<span class="grow ellip">${esc(it.label)}</span>${it.hint ? `<span class="muted tiny">${esc(it.hint)}</span>` : ''}</button>`).join('')}</div>`;
  const m = host.querySelector('.menu');
  const w = m.offsetWidth, h = m.offsetHeight;
  let x = r.left, y = r.bottom + 6;
  if (x + w > innerWidth - 10) x = Math.max(10, r.right - w);
  if (y + h > innerHeight - 10) y = Math.max(10, r.top - h - 6);
  m.style.left = x + 'px'; m.style.top = y + 'px';
  host.querySelector('.pop-catch').onmousedown = closeMenu;
  m.querySelectorAll('[data-i]').forEach((b) => b.onclick = () => { closeMenu(); items[+b.dataset.i].run(); });
  hydrateIcons(m);
}
function closeMenu() { $('#popHost').innerHTML = ''; }
addEventListener('keydown', (e) => { if (e.key === 'Escape') { if ($('#popHost').firstChild) closeMenu(); else if (!$('.sheet.sticky')) closeSheet(); } });

// ───────── sidebar: counts and the “this computer” card
function side() {
  const pc = $('#peerCount'); pc.textContent = S.peers.length || '';
  const live = [...S.transfers.values()].filter(t => ['active', 'waiting', 'asking', 'preparing'].includes(t.status)).length;
  const lc = $('#liveCount'); lc.textContent = live || ''; lc.classList.toggle('live', live > 0);
  const st = S.settings, me = S.me || {};
  const recv = st.receive || 'everyone';
  $('#meCard').innerHTML = `
    <div class="mc-top"><span class="tile a-blue" data-icon="${devIcon(me)}" data-size="17"></span>
      <div class="grow" style="min-width:0"><div class="mc-name" title="${esc(st.name)}">${esc(st.name)}</div>
      <div class="mc-sub"><span class="dot ${recv === 'off' ? '' : 'on'}"></span>${recv === 'off' ? 'Hidden · not receiving' : recv === 'trusted' ? 'Trusted devices only' : 'Visible to everyone nearby'}</div></div></div>
    <div class="seg" id="recvSeg">${[['everyone', 'Everyone'], ['trusted', 'Trusted'], ['off', 'Off']].map(([k, l]) => `<button data-k="${k}" class="${recv === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="mc-foot"><span data-icon="inbox" data-size="14"></span><button class="link-plain grow ellip" id="openRecv" title="Open the folder received files go to">${esc(baseName(S.receiveDir))}</button></div>`;
  $$('#recvSeg button').forEach(b => b.onclick = () => setSettings({ receive: b.dataset.k }));
  $('#openRecv').onclick = () => call('openReceived').catch(fail);
  hydrateIcons($('#meCard'));
}

async function setSettings(patch) {
  try { S.settings = await call('set', patch); render(); } catch (e) { fail(e); }
}

// ───────── sending
async function sendTo(peer, paths) {
  if (!paths || !paths.length) return;
  try { await call('send', peer.id, paths); }
  catch (e) { fail(e); }
}
async function pickAndSend(peer, kind) {
  const paths = await call('pick', kind).catch(fail);
  if (paths && paths.length) sendTo(peer, paths);
}
function textSheet(peer) {
  const el = openSheet(`<div class="sheet-head"><span class="tile md ${tintOf(peer.id)}" data-icon="text" data-size="18"></span><div class="grow"><h3>Send text or a link</h3><div class="muted small">To ${esc(peer.name)}${S.settings ? ' — it lands on their clipboard' : ''}</div></div></div>
    <div class="sheet-body"><textarea class="input area" rows="6" id="txt" placeholder="Type or paste anything — a link, an address, a code…"></textarea></div>
    <div class="sheet-foot"><button class="btn sm ghost" id="paste"><span data-icon="clipboard" data-size="15"></span>Paste clipboard</button><span class="grow"></span><button class="btn" data-x>Cancel</button><button class="btn primary" id="go"><span data-icon="send" data-size="15"></span>Send</button></div>`, { width: 520 });
  hydrateIcons(el);
  el.querySelector('[data-x]').onclick = closeSheet;
  el.querySelector('#paste').onclick = async () => { el.querySelector('#txt').value = await call('clipboard'); };
  const go = async () => {
    const text = el.querySelector('#txt').value;
    if (!text.trim()) return;
    try { await call('sendText', peer.id, text); closeSheet(); } catch (e) { fail(e); }
  };
  el.querySelector('#go').onclick = go;
  el.querySelector('#txt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) go(); });
}
async function sendClipboard(peer) {
  const t = await call('clipboard');
  if (!t || !t.trim()) return toast('The clipboard is empty', 'Copy some text or a link first.', 'info');
  call('sendText', peer.id, t).catch(fail);
}

function peerMenu(anchor, peer) {
  const staged = S.staged.length;
  menu(anchor, [
    ...(staged ? [{ label: `Send the ${plural(staged, 'item')} waiting`, icon: 'send', run: () => sendStaged(peer) }, '-'] : []),
    { label: 'Send files…', icon: 'file', run: () => pickAndSend(peer, 'files') },
    { label: 'Send a folder…', icon: 'folder', run: () => pickAndSend(peer, 'folder') },
    { label: 'Send text or a link…', icon: 'text', run: () => textSheet(peer) },
    { label: 'Send what’s on the clipboard', icon: 'clipboard', run: () => sendClipboard(peer) },
    '-',
    peer.trusted
      ? { label: 'Stop trusting', icon: 'shieldOff', run: () => call('trust', peer.id, false).catch(fail) }
      : { label: 'Trust this device', icon: 'shield', hint: 'sends go straight in', run: () => trustSheet(peer) },
  ], { head: `<div class="menu-head"><span class="tile md ${tintOf(peer.id)}" data-icon="${devIcon(peer)}" data-size="17"></span><div class="grow" style="min-width:0"><b class="ellip">${esc(peer.name)}</b><span>${esc([osName(peer.os), peer.address].filter(Boolean).join(' · '))}</span></div></div><hr>` });
}
function trustSheet(peer) {
  const el = openSheet(`<div class="sheet-head"><span class="tile md a-mint" data-icon="shield" data-size="18"></span><div class="grow"><h3>Trust ${esc(peer.name)}?</h3></div></div>
    <div class="sheet-body"><div class="muted">Files from a trusted device come straight in without asking${S.settings.autoAcceptTrusted === false ? ' (turned off in Settings)' : ''}. Trust your own computers and the people you share with every day.</div>
    <div class="row" style="gap:12px;padding:12px 14px;border-radius:12px;background:var(--panel-2);border:1px solid var(--line)"><span data-icon="key" data-size="16" class="muted"></span><div class="grow small">Safety code — check it shows the same on ${esc(peer.name)} (Devices › this computer):</div><span class="code">${esc(peer.code)}</span></div></div>
    <div class="sheet-foot"><span class="grow"></span><button class="btn" data-x>Cancel</button><button class="btn primary" id="ok">Trust</button></div>`, { width: 480 });
  hydrateIcons(el);
  el.querySelector('[data-x]').onclick = closeSheet;
  el.querySelector('#ok').onclick = () => { call('trust', peer.id, true).then(() => { closeSheet(); toast(`${peer.name} is trusted`); }, fail); };
}

async function sendStaged(peer) {
  const paths = S.staged.slice();
  await call('unstage');
  S.staged = []; S.stagedInfo = [];
  sendTo(peer, paths);
  refresh(['nearby']);
}
async function stage(paths) {
  S.staged = [...new Set([...S.staged, ...paths])];
  S.stagedInfo = await call('inspect', S.staged).catch(() => []);
  if (S.view !== 'nearby') go('nearby'); else refresh(['nearby']);
}
