// Glean — the window. Browser on the left, tray on the right; Library and Batch as their own views.
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const api = window.glean;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (id, s = 16) => `<svg class="ic" width="${s}" height="${s}"><use href="#i-${id}"/></svg>`;
const plural = (n, w, p) => `${n.toLocaleString()} ${n === 1 ? w : (p || w + 's')}`;

const SITES = {
  instagram: { name: 'Instagram', color: 'linear-gradient(45deg,#f9a12e,#e1306c 50%,#8a3ab9)' },
  facebook: { name: 'Facebook', color: '#1877f2' }, patreon: { name: 'Patreon', color: '#ff424d' },
  x: { name: 'X', color: '#111' }, pinterest: { name: 'Pinterest', color: '#e60023' }, threads: { name: 'Threads', color: '#111' }, tiktok: { name: 'TikTok', color: '#111' }
};
const SUPPORTED = ['instagram', 'facebook', 'patreon', 'x', 'pinterest', 'threads'];
function siteOf(url) {
  let h = ''; try { h = new URL(url).hostname.toLowerCase(); } catch { return 'web'; }
  if (/instagram\.com$/.test(h)) return 'instagram'; if (/facebook\.com$|fb\.com$/.test(h)) return 'facebook'; if (/patreon\.com$/.test(h)) return 'patreon';
  if (/(^|\.)x\.com$|twitter\.com$/.test(h)) return 'x'; if (/pinterest\./.test(h)) return 'pinterest'; if (/threads\.(net|com)$/.test(h)) return 'threads'; if (/tiktok\.com$/.test(h)) return 'tiktok';
  return h.replace(/^www\./, '');
}
const siteName = (s) => (SITES[s] && SITES[s].name) || s;

const S = {
  settings: {}, platform: '', items: new Map(), saved: new Set(), off: new Set(), states: new Map(),
  kind: 'all', newOnly: true, showLoose: false, sort: 'date', collecting: false, scrolling: null, batch: null,
  library: [], libDetail: null, libItems: [], view: 'browse', job: null, pageUrl: '', lastClicked: null, lb: null
};

// ---------------------------------------------------------------- helpers
function toast(text, opts = {}) {
  const t = document.createElement('div'); t.className = 'toast' + (opts.error ? ' err' : '');
  t.innerHTML = `<span>${esc(text)}</span>`;
  if (opts.action) { const b = document.createElement('button'); b.className = 'link-btn'; b.textContent = opts.action.label; b.onclick = () => { opts.action.run(); t.remove(); }; t.appendChild(b); }
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), opts.ms || 5200);
}
async function call(name, ...a) { try { return await api.call(name, ...a); } catch (e) { toast(e.message, { error: true }); throw e; } }
const imgUrl = (u, ref) => 'glean-img://t/?u=' + encodeURIComponent(u) + (ref ? '&r=' + encodeURIComponent(ref) : '');
const fileUrl = (p) => 'glean-file://f/?p=' + encodeURIComponent(p);
function ago(ms) {
  const s = (Date.now() - ms) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + 'm ago'; if (s < 86400) return Math.round(s / 3600) + 'h ago';
  if (s < 86400 * 30) return Math.round(s / 86400) + 'd ago'; return new Date(ms).toLocaleDateString();
}
const fmtDate = (ms) => ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(ms).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) : '';
const prettyPath = (p) => String(p || '').replace(/^\/Users\/[^/]+/, '~').replace(/^[A-Z]:\\Users\\[^\\]+/i, '~');
const bytes = (n) => n > 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB';

// ---------------------------------------------------------------- theme
function applyTheme() {
  const t = S.settings.theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : S.settings.theme;
  document.documentElement.dataset.theme = t;
  $('#theme-btn use').setAttribute('href', t === 'dark' ? '#i-sun' : '#i-moon');
  api.call('window:chrome', { color: '#00000000', symbolColor: t === 'dark' ? '#e8e6ef' : '#2a2833', height: 46 }).catch(() => {});
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
async function setSetting(patch) { S.settings = await call('settings:set', patch); return S.settings; }

// ---------------------------------------------------------------- views
function showView(v) {
  S.view = v;
  $$('.view').forEach(x => x.classList.toggle('on', x.id === 'v-' + v));
  $$('.side-nav .nav-btn').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  if (v === 'library') renderLibrary();
}
$$('.side-nav .nav-btn').forEach(b => b.onclick = () => showView(b.dataset.view));

// ---------------------------------------------------------------- browser
const web = $('#web');
let attached = false;
function go(input) {
  let u = String(input || '').trim(); if (!u) return;
  if (!/^[a-z]+:\/\//i.test(u)) u = /^[\w-]+(\.[\w-]+)+(\/|$)/.test(u) ? 'https://' + u : 'https://duckduckgo.com/?q=' + encodeURIComponent(u);
  showView('browse');
  try { web.loadURL(u); } catch { web.src = u; }
}
function updateNav() {
  let url = ''; try { url = web.getURL(); } catch {}
  S.pageUrl = url;
  if (document.activeElement !== $('#url')) $('#url').value = url;
  const site = siteOf(url); const chip = $('#site-chip');
  const sup = SUPPORTED.includes(site);
  chip.className = 'site-chip' + (sup ? ' supported' : '');
  chip.innerHTML = sup ? `<i></i>${esc(siteName(site))}` : icon('globe', 13);
  chip.title = sup ? `Glean reads ${siteName(site)}'s posts directly: full size, grouped, with captions` : 'Glean collects images and videos this page loads';
  try { $('#nav-back').disabled = !web.canGoBack(); $('#nav-fwd').disabled = !web.canGoForward(); } catch {}
  $$('.site').forEach(el => el.classList.toggle('on', !!url && siteOf(el.dataset.url) === site && site !== 'web'));
  clearTimeout(updateNav.t); updateNav.t = setTimeout(() => { if (/^https?:/.test(url)) setSetting({ lastUrl: url }).catch(() => {}); }, 1500);
}
web.addEventListener('dom-ready', async () => {
  if (!attached) { attached = true; try { await api.call('view:attach', web.getWebContentsId()); } catch (e) { attached = false; } }
  updateNav();
});
web.addEventListener('did-navigate', updateNav);
web.addEventListener('did-navigate-in-page', updateNav);
web.addEventListener('page-title-updated', updateNav);
web.addEventListener('did-start-loading', () => $('#url-load').classList.add('on'));
web.addEventListener('did-stop-loading', () => { const l = $('#url-load'); l.style.width = '100%'; setTimeout(() => { l.classList.remove('on'); l.style.width = ''; }, 250); updateNav(); });
$('#url-form').onsubmit = (e) => { e.preventDefault(); go($('#url').value); $('#url').blur(); };
$('#url').onfocus = () => setTimeout(() => $('#url').select(), 0);
$('#nav-back').onclick = () => { try { web.goBack(); } catch {} };
$('#nav-fwd').onclick = () => { try { web.goForward(); } catch {} };
$('#nav-reload').onclick = () => { try { web.reload(); } catch {} };

// ---------------------------------------------------------------- sites (bookmarks)
function renderSites() {
  const list = S.settings.sites || [];
  $('#sites').innerHTML = list.map((s, i) => {
    const site = siteOf(s.url); const meta = SITES[site];
    const letter = (s.title || site).trim()[0] || '?';
    return `<div class="site" data-i="${i}" data-url="${esc(s.url)}" title="${esc(s.url)}"><span class="fav" style="background:${meta ? meta.color : `hsl(${[...site].reduce((a, c) => a + c.charCodeAt(0), 0) % 360} 55% 50%)`}">${esc(letter.toUpperCase())}</span><span>${esc(s.title)}</span>
      <button class="icon-btn xs rm" data-rm="${i}" title="Remove"><svg class="ic" width="12" height="12"><use href="#i-x"/></svg></button></div>`;
  }).join('');
  updateNav();
}
$('#sites').onclick = (e) => {
  const rm = e.target.closest('[data-rm]');
  if (rm) { e.stopPropagation(); const list = [...S.settings.sites]; list.splice(+rm.dataset.rm, 1); setSetting({ sites: list }).then(renderSites); return; }
  const s = e.target.closest('.site'); if (s) go(s.dataset.url);
};
$('#site-add').onclick = async () => {
  const url = S.pageUrl; if (!/^https?:/.test(url)) return;
  let title = ''; try { title = web.getTitle(); } catch {}
  title = (title || siteOf(url)).replace(/\s*[•|·–-]\s*(Instagram|Facebook|Patreon|X).*$/i, '').replace(/\s*\(@[^)]+\).*$/, '').slice(0, 40);
  await setSetting({ sites: [...(S.settings.sites || []), { title, url }] }); renderSites(); toast(`Added ${title} to Sites`);
};

// ---------------------------------------------------------------- collecting
$('#collect-btn').onclick = () => call(S.collecting ? 'collect:stop' : 'collect:start');
$('#scroll-btn').onclick = () => call(S.scrolling ? 'scroll:stop' : 'scroll:start', {});
$('#scan-btn').onclick = async () => { const n = await call('collect:scan'); toast(n ? `Scanned the page: ${plural(n, 'picture')} seen` : 'Nothing new on screen'); };
$('#tray-btn').onclick = () => { document.body.classList.toggle('no-tray'); $('#tray-btn').classList.toggle('on', !document.body.classList.contains('no-tray')); };

function renderState() {
  const b = $('#collect-btn');
  b.classList.toggle('on', S.collecting);
  const n = S.visibleCount != null ? S.visibleCount : S.items.size;
  $('.lbl', b).textContent = S.collecting ? (n ? `Collecting · ${n.toLocaleString()}` : 'Collecting') : 'Collect';
  const sb = $('#scroll-btn'); sb.classList.toggle('scrolling', !!S.scrolling); $('.lbl', sb).textContent = S.scrolling ? 'Stop scrolling' : 'Auto-scroll';
  const pill = $('#pill');
  if (S.sync && S.sync.phase !== 'done') {
    pill.hidden = false; pill.innerHTML = `<span class="spin"></span><span>Checking ${esc(S.sync.title || '')} for new posts${S.scrolling ? ` · ${S.scrolling.found.toLocaleString()} seen` : '…'}</span><button class="btn" id="pill-stop">Stop</button>`;
  } else if (S.batch) {
    const b2 = S.batch; pill.hidden = false;
    pill.innerHTML = `<span class="spin"></span><span>Batch ${b2.index + 1} of ${b2.total} · ${n.toLocaleString()} collected</span><button class="btn" id="pill-stop">Stop</button>`;
  } else if (S.scrolling) {
    pill.hidden = false; pill.innerHTML = `<span class="spin"></span><span>Auto-scrolling · ${S.scrolling.found.toLocaleString()} found</span><button class="btn" id="pill-stop">Stop</button>`;
  } else pill.hidden = true;
  const ps = $('#pill-stop'); if (ps) ps.onclick = () => call(S.batch ? 'batch:stop' : 'scroll:stop');
  const bn = $('#batch-n'); bn.hidden = !S.batch; if (S.batch) bn.textContent = `${S.batch.index + 1}/${S.batch.total}`;
}

// ---------------------------------------------------------------- tray model
function isSmall(m) {
  const min = Number(S.settings.minSide) || 0;
  if (m.width && m.height) return Math.max(m.width, m.height) < min;
  if (m.source === 'net' && m.bytes) return m.bytes < 25000;
  return false;
}
function isLoose(m) { return !m.postId && SUPPORTED.includes(m.site) && S.settings.onlyPosts; }
function visibleItems() {
  const out = [];
  let loose = 0, saved = 0, small = 0;
  for (const m of S.items.values()) {
    if (isSmall(m)) { small++; continue; }
    if (isLoose(m)) { loose++; if (!S.showLoose) continue; }
    const isSaved = S.saved.has(m.key) || S.states.get(m.key) === 'done';
    if (isSaved) saved++;
    if (S.newOnly && S.saved.has(m.key) && S.states.get(m.key) !== 'done') continue;
    if (S.kind !== 'all' && m.kind !== S.kind) continue;
    out.push(m);
  }
  return { out, loose, saved, small };
}
function groups(items) {
  const g = new Map();
  for (const m of items) {
    const k = m.postId ? `${m.site}:${m.postId}` : `loose:${m.site}:${m.account || ''}`;
    let p = g.get(k);
    if (!p) { p = { key: k, postId: m.postId, postUrl: m.postUrl, site: m.site, account: m.account, accountName: m.accountName, caption: '', date: 0, seq: m.seq, items: [] }; g.set(k, p); }
    p.items.push(m); if (!p.caption && m.caption && m.postId) p.caption = m.caption; if (!p.date && m.date) p.date = m.date; if (m.seq < p.seq) p.seq = m.seq;
    if (!p.postUrl && m.postUrl) p.postUrl = m.postUrl; if (!p.account && m.account) p.account = m.account;
  }
  const list = [...g.values()];
  for (const p of list) p.items.sort((a, b) => (a.postIndex || 0) - (b.postIndex || 0) || a.seq - b.seq);
  if (S.sort === 'date') list.sort((a, b) => (!a.postId) - (!b.postId) || (b.date || 0) - (a.date || 0) || a.seq - b.seq);
  else list.sort((a, b) => a.seq - b.seq);
  return list;
}
const selectable = (m) => !(S.saved.has(m.key) || S.states.get(m.key) === 'done');
const isOn = (m) => selectable(m) && !S.off.has(m.key);
function selectedKeys() { return visibleItems().out.filter(isOn).map(m => m.key); }

// ---------------------------------------------------------------- tray rendering (keyed, so pictures don't reload)
const tileEls = new Map(), postEls = new Map();
function tileEl(m) {
  let el = tileEls.get(m.key);
  if (!el) {
    el = document.createElement('div'); el.className = 'tile'; el.dataset.key = m.key;
    el.innerHTML = `<div class="ph">${icon(m.kind === 'video' ? 'film' : 'image', 22)}</div><span class="ck">${icon('check', 12)}</span>`;
    tileEls.set(m.key, el);
  }
  const thumb = m.thumb || (m.kind === 'image' ? m.url : null);
  const want = thumb ? imgUrl(thumb, m.postUrl || S.pageUrl) : null;
  let img = $('img', el);
  if (want && (!img || img.dataset.src !== thumb)) {
    if (!img) { img = document.createElement('img'); img.loading = 'lazy'; img.decoding = 'async'; img.draggable = false; el.prepend(img); img.onload = () => { img.classList.add('ok'); const ph = $('.ph', el); if (ph) ph.remove(); }; img.onerror = () => img.remove(); }
    img.dataset.src = thumb; img.src = want;
  }
  el.classList.toggle('off', selectable(m) && S.off.has(m.key));
  el.classList.toggle('done', !selectable(m));
  const kind = $('.kind', el);
  if (m.kind === 'video' && !kind) el.insertAdjacentHTML('beforeend', `<span class="kind">${icon('play', 10)}Video</span>`);
  let dims = $('.dims', el); if (!dims) { el.insertAdjacentHTML('beforeend', '<span class="dims"></span>'); dims = $('.dims', el); }
  dims.textContent = m.width ? `${m.width}×${m.height}` : (m.bytes ? bytes(m.bytes) : '');
  const st = S.states.get(m.key); let stEl = $('.state', el);
  const savedBefore = S.saved.has(m.key) && !st;
  let sv = $('.saved', el);
  if (savedBefore && !sv) el.insertAdjacentHTML('beforeend', `<span class="saved" title="Already in your library">${icon('check', 12)}</span>`); else if (!savedBefore && sv) sv.remove();
  if (!st || st === 'saved' || st === 'cancelled') { if (stEl) stEl.remove(); }
  else {
    if (!stEl) { el.insertAdjacentHTML('beforeend', '<div class="state"></div>'); stEl = $('.state', el); }
    stEl.className = 'state ' + st;
    stEl.innerHTML = st === 'downloading' ? '<span class="spin"></span>' : st === 'done' ? `<i>${icon('check', 12)}</i>` : st === 'failed' ? 'Failed' : '';
    stEl.title = st === 'failed' ? (S.failures.get(m.key) || '') : '';
  }
  el.title = [m.kind === 'video' ? 'Video' : 'Photo', m.width ? `${m.width}×${m.height}` : '', savedBefore ? 'already saved' : ''].filter(Boolean).join(' · ');
  return el;
}
S.failures = new Map();
function postEl(p) {
  let el = postEls.get(p.key);
  if (!el) {
    el = document.createElement('div'); el.className = 'post'; el.dataset.post = p.key;
    el.innerHTML = `<div class="post-head"><button class="post-check" title="Select this post">${icon('check', 11)}</button><div class="post-meta"><b></b><small></small></div>
      <button class="icon-btn xs post-open" title="Open post">${icon('ext', 13)}</button></div><div class="post-cap"></div><div class="tiles"></div>`;
    postEls.set(p.key, el);
  }
  const loose = !p.postId;
  const who = p.accountName || (p.account ? '@' + p.account : '') || siteName(p.site);
  $('.post-meta b', el).textContent = loose ? `Loose · ${who}` : (fmtDate(p.date) || 'Post');
  $('.post-meta small', el).textContent = [plural(p.items.length, p.items.some(i => i.kind === 'video') ? 'item' : 'photo'), S.manyAccounts || loose ? (loose ? '' : who) : ''].filter(Boolean).join(' · ');
  const cap = $('.post-cap', el); cap.textContent = p.caption || ''; cap.hidden = !p.caption;
  const open = $('.post-open', el); open.hidden = !p.postUrl; open.dataset.url = p.postUrl || '';
  const sel = p.items.filter(selectable); const on = sel.filter(m => !S.off.has(m.key)).length;
  const ck = $('.post-check', el); ck.className = 'post-check' + (sel.length && on === sel.length ? ' on' : on ? ' some' : ''); ck.disabled = !sel.length;
  const tiles = $('.tiles', el);
  const want = p.items.map(tileEl);
  if (tiles.children.length !== want.length || want.some((t, i) => tiles.children[i] !== t)) tiles.replaceChildren(...want);
  return el;
}
function renderTray() {
  cancelAnimationFrame(renderTray.raf);
  renderTray.raf = requestAnimationFrame(() => {
    const { out, loose, saved, small } = visibleItems();
    S.manyAccounts = new Set(out.map(m => m.account || m.accountName)).size > 1;
    const ps = groups(out);
    const list = $('#tray-list');
    list.classList.toggle('flat', S.layout === 'grid');
    const els = ps.map(postEl);
    if (list.children.length !== els.length || els.some((e, i) => list.children[i] !== e)) list.replaceChildren(...els);
    // forget elements that are gone (keeps memory flat on long sessions)
    const live = new Set(out.map(m => m.key)); for (const k of tileEls.keys()) if (!live.has(k) && !S.items.has(k)) tileEls.delete(k);
    const liveP = new Set(ps.map(p => p.key)); for (const k of postEls.keys()) if (!liveP.has(k)) postEls.delete(k);
    S.visibleCount = out.length;
    const any = S.items.size > 0;
    $('#tray-empty').hidden = any; list.hidden = !any;
    const photos = out.filter(m => m.kind !== 'video').length, vids = out.length - photos;
    const posts = ps.filter(p => p.postId).length;
    $('#tray-sum').textContent = any ? [plural(photos, 'photo'), vids ? plural(vids, 'video') : '', posts ? `in ${plural(posts, 'post')}` : ''].filter(Boolean).join(' · ') + (small ? ` · ${small} small hidden` : '') : 'Nothing yet';
    const lb = $('#loose-btn'); lb.hidden = !loose; lb.textContent = `${S.showLoose ? 'Hide' : 'Show'} ${loose} loose`; lb.classList.toggle('on', S.showLoose);
    lb.title = 'Pictures on the page that are not part of a post (profile pictures, suggestions, ads)';
    $('#new-only').classList.toggle('on', S.newOnly); $('#new-only').title = saved ? `${saved} already in your library` : "Hide what's already in your library";
    const n = out.filter(isOn).length;
    const busy = S.job && !S.job.finishedAt;
    $('#dl-btn').disabled = !n;
    $('#dl-btn span').textContent = n ? `Download ${n.toLocaleString()}` : 'Download';
    $('#tray-n').hidden = !out.length; $('#tray-n').textContent = out.length > 999 ? Math.round(out.length / 100) / 10 + 'k' : out.length;
    if (!busy) renderDl();
    renderState();
  });
}
$('#tray-list').addEventListener('click', (e) => {
  const open = e.target.closest('.post-open'); if (open) { go(open.dataset.url); return; }
  const pc = e.target.closest('.post-check');
  if (pc) {
    const key = pc.closest('.post').dataset.post;
    const p = groups(visibleItems().out).find(x => x.key === key); if (!p) return;
    const sel = p.items.filter(selectable); const allOn = sel.every(m => !S.off.has(m.key));
    for (const m of sel) allOn ? S.off.add(m.key) : S.off.delete(m.key);
    renderTray(); return;
  }
  const t = e.target.closest('.tile'); if (!t) return;
  const key = t.dataset.key; const m = S.items.get(key); if (!m) return;
  if (e.detail === 2) return;
  if (!selectable(m)) { openLightbox(key); return; }
  if (e.shiftKey && S.lastClicked) {
    const order = groups(visibleItems().out).flatMap(p => p.items.map(i => i.key));
    const a = order.indexOf(S.lastClicked), b = order.indexOf(key);
    if (a >= 0 && b >= 0) { const turnOn = S.off.has(key); for (const k of order.slice(Math.min(a, b), Math.max(a, b) + 1)) turnOn ? S.off.delete(k) : S.off.add(k); }
  } else S.off.has(key) ? S.off.delete(key) : S.off.add(key);
  S.lastClicked = key;
  renderTray();
});
$('#tray-list').addEventListener('dblclick', (e) => { const t = e.target.closest('.tile'); if (t) { const k = t.dataset.key; S.off.has(k) ? S.off.delete(k) : S.off.add(k); renderTray(); openLightbox(k); } });
$('#kind-seg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; S.kind = b.dataset.kind; $$('#kind-seg button').forEach(x => x.classList.toggle('on', x === b)); renderTray(); };
$('#new-only').onclick = () => { S.newOnly = !S.newOnly; setSetting({ newOnly: S.newOnly }); renderTray(); };
$('#loose-btn').onclick = () => { S.showLoose = !S.showLoose; renderTray(); };
$('#layout-seg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; S.layout = b.dataset.layout; $$('#layout-seg button').forEach(x => x.classList.toggle('on', x === b)); setSetting({ trayLayout: S.layout }); renderTray(); };
$('#sel-all').onclick = () => {
  const vis = visibleItems().out.filter(selectable); const allOn = vis.every(m => !S.off.has(m.key));
  for (const m of vis) allOn ? S.off.add(m.key) : S.off.delete(m.key); renderTray();
};
$('#clear-btn').onclick = async () => { if (S.job && !S.job.finishedAt) return toast('Wait for the download to finish first'); await call('collect:clear'); S.off.clear(); S.states.clear(); renderTray(); };

// ---------------------------------------------------------------- downloading
$('#dl-btn').onclick = async () => {
  const keys = selectedKeys(); if (!keys.length) return;
  for (const k of keys) S.states.set(k, 'queued');
  let title = ''; try { title = web.getTitle(); } catch {}
  S.job = await call('download', keys, { pageUrl: S.pageUrl, pageTitle: title });
  renderTray(); renderDl();
};
$('#dest-btn').onclick = async () => { const p = await call('pick-folder'); if (p) { S.settings.folder = p; renderDest(); refreshLibrary(); } };
function renderDest() { $('#dest-path').textContent = prettyPath(S.settings.folder); $('#dest-btn').title = `Saving to ${S.settings.folder}. Click to change.`; }
function renderDl() {
  const box = $('#dl-status'); const j = S.job;
  const side = $('#side-job');
  if (!j) { box.hidden = true; side.hidden = true; return; }
  const finished = !!j.finishedAt;
  const doneN = j.done + j.skipped + j.failed; const pct = j.total ? Math.round(doneN / j.total * 100) : 0;
  box.hidden = false;
  if (!finished) {
    box.innerHTML = `<div class="dl-line"><b>Saving ${doneN.toLocaleString()} of ${j.total.toLocaleString()}</b><span class="muted grow">${j.bytes ? bytes(j.bytes) : ''}</span>
      <button class="icon-btn xs" id="dl-pause" title="${j.paused ? 'Resume' : 'Pause'}">${icon(j.paused ? 'play' : 'pause', 13)}</button><button class="icon-btn xs" id="dl-cancel" title="Cancel">${icon('x', 13)}</button></div>
      <div class="bar-track"><i style="width:${pct}%"></i></div>`;
    $('#dl-pause').onclick = () => call('download:pause', !j.paused);
    $('#dl-cancel').onclick = () => call('download:cancel');
    side.hidden = false; side.innerHTML = `<div><b>Saving</b> <span class="muted">${doneN}/${j.total}</span></div><div class="bar-track"><i style="width:${pct}%"></i></div>`;
  } else {
    const folder = (j.folders || [])[0];
    box.innerHTML = `<div class="dl-line"><span style="color:var(--ok)">${icon('check', 15)}</span><span class="grow"><b>Saved ${j.done.toLocaleString()}</b>${j.skipped ? ` <span class="muted">· ${j.skipped} already had</span>` : ''}${j.failed ? ` <span style="color:var(--danger)">· ${j.failed} failed</span>` : ''}</span>
      ${folder ? `<button class="link-btn" id="dl-open">Show in folder</button>` : ''}<button class="icon-btn xs" id="dl-x" title="Dismiss">${icon('x', 12)}</button></div>`;
    const o = $('#dl-open'); if (o) o.onclick = () => call('shell:open', folder);
    $('#dl-x').onclick = () => { S.job = null; renderDl(); };
    side.hidden = true;
  }
}

// ---------------------------------------------------------------- events from main
api.on('collection', (d) => {
  if (d.reset) { S.items.clear(); S.off.clear(); S.states.clear(); tileEls.clear(); postEls.clear(); }
  for (const k of d.removed || []) S.items.delete(k);
  for (const m of d.upserts || []) S.items.set(m.key, m);
  renderTray();
});
api.on('state', (st) => { S.collecting = st.collecting; S.scrolling = st.scrolling; S.batch = st.batch; renderState(); if (st.batch) renderBatchRows(st.batch); });
api.on('scroll:done', (info) => {
  if (S.sync || S.batch) return;
  const msg = { 'end of page': 'Reached the end of the page', limit: 'Stopped at your limit', 'caught up': 'Caught up with what you already have', stopped: 'Stopped scrolling' }[info.reason] || 'Stopped scrolling';
  toast(`${msg} · ${plural(info.found, 'item')} collected`);
});
api.on('download', (ev) => {
  if (ev.type === 'item') {
    S.states.set(ev.key, ev.state);
    if (ev.state === 'failed') S.failures.set(ev.key, ev.error);
    if (ev.state === 'done' || ev.state === 'saved') S.saved.add(ev.key);
    if (S.job) { if (ev.state === 'done') S.job.done++; else if (ev.state === 'failed') S.job.failed++; }
    const m = S.items.get(ev.key); if (m) { const el = tileEls.get(ev.key); if (el) tileEl(m); }
    clearTimeout(renderDl.t); renderDl.t = setTimeout(renderDl, 120);
  } else if (ev.type === 'job') { S.job = ev.job; renderDl(); }
  else if (ev.type === 'notice') toast(ev.text, { ms: 9000 });
  else if (ev.type === 'done') {
    S.job = ev.job; renderDl(); renderTray();
    if (ev.job && ev.job.failed) toast(`${plural(ev.job.failed, 'file')} couldn't be saved. Hover a red tile to see why.`, { error: true, ms: 9000 });
  }
});
api.on('library', (list) => { S.library = list; $('#lib-n').hidden = !list.length; $('#lib-n').textContent = list.length; if (S.view === 'library') renderLibrary(); });
api.on('notice', (n) => toast(n.text, n.path ? { action: { label: 'Show', run: () => call('shell:reveal', n.path) } } : {}));
api.on('batch:add', ({ url }) => { const ta = $('#batch-urls'); ta.value = (ta.value.trim() ? ta.value.trim() + '\n' : '') + url; batchCount(); toast('Added to Batch', { action: { label: 'Open Batch', run: () => showView('batch') } }); });
api.on('batch:done', async (info) => {
  renderBatchRows(info);
  $('#batch-go').textContent = 'Start'; $('#batch-go').classList.add('primary');
  const found = info.rows.reduce((a, r) => a + (r.found || 0), 0);
  if ($('#batch-dl').checked && !info.rows.some(r => r.state === 'stopped')) {
    await new Promise(r => setTimeout(r, 400));
    const keys = selectedKeys();
    if (keys.length) { for (const k of keys) S.states.set(k, 'queued'); S.job = await call('download', keys); renderDl(); toast(`Batch finished · downloading ${plural(keys.length, 'item')}`); return; }
  }
  toast(`Batch finished · ${plural(found, 'item')} collected`, { action: { label: 'Review', run: () => showView('browse') } });
});
api.on('sync', (s) => {
  S.sync = s;
  if (s.phase === 'done') { S.sync = null; toast(s.found ? `${s.title}: ${plural(s.found, 'new item')}, downloading now` : `${s.title} is up to date`); }
  renderState();
});

// ---------------------------------------------------------------- lightbox
function openLightbox(key, list) {
  const order = list || groups(visibleItems().out).flatMap(p => p.items);
  const i = order.findIndex(m => m.key === key); if (i < 0) return;
  S.lb = { order, i }; drawLightbox(); $('#lightbox').hidden = false;
}
function drawLightbox() {
  const { order, i } = S.lb; const m = order[i];
  const local = m.path;
  const stage = $('#lb-stage');
  if (m.kind === 'video') {
    stage.innerHTML = local ? `<video src="${fileUrl(local)}" ${m.posterPath ? `poster="${fileUrl(m.posterPath)}"` : ''} controls autoplay></video>` : `<img src="${imgUrl(m.thumb || m.url, m.postUrl)}" alt="">`;
  } else stage.innerHTML = `<img src="${local ? fileUrl(local) : imgUrl(m.url, m.postUrl || S.pageUrl)}" alt="">`;
  $('#lb-info').innerHTML = `<div class="meta"><b>${esc(m.accountName || (m.account ? '@' + m.account : '') || siteName(m.site))}</b><span class="muted">${esc([fmtDate(m.date), m.width ? `${m.width}×${m.height}` : '', m.kind === 'video' ? 'Video' : 'Photo', `${i + 1} of ${order.length}`].filter(Boolean).join(' · '))}</span>
    <div style="display:flex;gap:6px;margin-top:6px">${m.postUrl ? `<button class="btn sm" id="lb-post">${icon('ext', 13)}Open post</button>` : ''}${local ? `<button class="btn sm" id="lb-reveal">${icon('folder', 13)}Show file</button>` : ''}</div></div><div class="cap">${esc(m.caption || '')}</div>`;
  const p = $('#lb-post'); if (p) p.onclick = () => { closeLightbox(); go(m.postUrl); };
  const r = $('#lb-reveal'); if (r) r.onclick = () => call('shell:reveal', local);
}
function closeLightbox() { $('#lightbox').hidden = true; $('#lb-stage').innerHTML = ''; S.lb = null; }
function stepLightbox(d) { if (!S.lb) return; S.lb.i = (S.lb.i + d + S.lb.order.length) % S.lb.order.length; drawLightbox(); }
$('#lightbox').onclick = (e) => { if (e.target.closest('[data-close]') || e.target.id === 'lb-stage' || e.target === $('#lightbox')) closeLightbox(); };
$('.lb-prev').onclick = (e) => { e.stopPropagation(); stepLightbox(-1); };
$('.lb-next').onclick = (e) => { e.stopPropagation(); stepLightbox(1); };

// ---------------------------------------------------------------- library
async function refreshLibrary() { S.library = await call('library:list'); S.saved = new Set(await call('library:saved')); $('#lib-n').hidden = !S.library.length; $('#lib-n').textContent = S.library.length; renderLibrary(); renderTray(); }
function renderLibrary() {
  const body = $('#lib-body');
  if (S.libDetail) return renderLibDetail();
  $('#lib-title').innerHTML = `<h2>Library</h2><span class="muted small">${S.library.length ? plural(S.library.length, 'account') + ' · ' + plural(S.library.reduce((a, h) => a + (h.count || 0), 0), 'file') : ''}</span>`;
  const q = $('#lib-search').value.trim().toLowerCase();
  const list = S.library.filter(h => !q || [h.title, h.account, h.accountName, h.siteName].some(x => String(x || '').toLowerCase().includes(q)));
  if (!S.library.length) {
    body.innerHTML = `<div class="lib-empty"><div class="empty-art"><span></span><span></span><span></span></div><h3>Nothing saved yet</h3><p class="small">Everything you download lands here, one card per account or page, with its captions in a spreadsheet next to the files. Check any card for new posts later and Glean fetches only what's new.</p></div>`;
    return;
  }
  body.innerHTML = `<div class="cards">${list.map(h => {
    const covers = (h.coverPaths || []).slice(0, 3);
    const mosaic = covers.length ? covers.map(p => `<img src="${fileUrl(p)}" loading="lazy" alt="">`).join('') : `<div class="none">${icon('image', 28)}</div>`;
    return `<div class="card" data-id="${h.id}"><div class="mosaic ${covers.length === 1 ? 'one' : ''}">${mosaic}</div>
      <div class="card-body"><div class="card-title"><span>${esc(h.accountName || h.title || h.account)}</span><span class="site-tag">${esc(h.siteName)}</span></div>
      <div class="card-meta">${esc([h.account && h.account !== h.accountName ? '@' + h.account : '', plural(h.photos || 0, 'photo'), h.videos ? plural(h.videos, 'video') : '', h.posts ? plural(h.posts, 'post') : ''].filter(Boolean).join(' · '))}</div>
      <div class="card-meta">Updated ${ago(h.updatedAt)}</div></div>
      <div class="card-actions"><button class="btn" data-act="sync" ${h.sourceUrl ? '' : 'disabled title="Open the page and collect from it once to enable this"'}>${icon('sync', 14)}Check for new</button><button class="btn" data-act="folder" title="Open folder">${icon('folder', 14)}</button><button class="btn" data-act="sheet" title="Contact sheet PDF">${icon('sheet', 14)}</button></div></div>`;
  }).join('')}</div>`;
}
$('#lib-search').oninput = () => renderLibrary();
$('#lib-folder').onclick = () => call('shell:open', S.libDetail ? S.libDetail.folder : S.settings.folder);
$('#lib-body').addEventListener('click', async (e) => {
  const back = e.target.closest('[data-back]'); if (back) { S.libDetail = null; renderLibrary(); return; }
  const act = e.target.closest('[data-act]');
  const card = e.target.closest('[data-id]');
  const id = (act && act.dataset.id) || (card && card.dataset.id) || (S.libDetail && S.libDetail.id);
  const h = S.library.find(x => x.id === id);
  if (act) {
    e.stopPropagation();
    const a = act.dataset.act;
    if (a === 'folder') call('shell:open', h.folder);
    if (a === 'sheet') { act.disabled = true; toast('Making the contact sheet…'); try { await call('library:sheet', id); } finally { act.disabled = false; } }
    if (a === 'sync') { showView('browse'); call('library:sync', id).catch(() => {}); }
    if (a === 'source' && h.sourceUrl) go(h.sourceUrl);
    if (a === 'remove') { if (confirm(`Remove ${h.title || h.account} from the library? The files stay in their folder.`)) { S.library = await call('library:remove', id); S.libDetail = null; refreshLibrary(); } }
    return;
  }
  const t = e.target.closest('.lp[data-key]');
  if (t && S.libDetail) { openLightbox(t.dataset.key, S.libOrder || S.libItems); return; }
  if (card && !S.libDetail) { S.libDetail = h; S.libItems = (await call('library:items', id)).filter(i => i.exists); renderLibrary(); }
});
function renderLibDetail() {
  const h = S.libDetail; const body = $('#lib-body');
  $('#lib-title').innerHTML = `<h2>Library</h2>`;
  const posts = new Map();
  for (const i of S.libItems) { const k = i.postId || 'loose'; if (!posts.has(k)) posts.set(k, { postId: i.postId, postUrl: i.postUrl, date: i.date, caption: i.caption, items: [] }); const p = posts.get(k); p.items.push(i); if (!p.caption) p.caption = i.caption; }
  const list = [...posts.values()].sort((a, b) => (b.date || 0) - (a.date || 0));
  for (const p of list) p.items.sort((a, b) => (a.postIndex || 0) - (b.postIndex || 0));
  S.libOrder = list.flatMap(p => p.items);
  body.innerHTML = `<div class="detail-head"><button class="icon-btn" data-back title="All accounts">${icon('back', 18)}</button>
    <div><h3>${esc(h.accountName || h.title || h.account)}</h3><div class="muted">${esc([h.siteName, h.account ? '@' + h.account : '', plural(S.libItems.length, 'file'), prettyPath(h.folder)].filter(Boolean).join(' · '))}</div></div>
    <div class="acts">${h.sourceUrl ? `<button class="btn" data-act="source" data-id="${h.id}">${icon('globe', 14)}Open page</button><button class="btn" data-act="sync" data-id="${h.id}">${icon('sync', 14)}Check for new</button>` : ''}
      <button class="btn" data-act="sheet" data-id="${h.id}">${icon('sheet', 14)}Contact sheet</button><button class="btn" data-act="folder" data-id="${h.id}">${icon('folder', 14)}Open folder</button>
      <button class="btn danger" data-act="remove" data-id="${h.id}" title="Remove from library (keeps the files)">${icon('trash', 14)}</button></div></div>
    <div class="lib-grid">${list.map(p => { const c = p.items[0]; const vids = p.items.filter(i => i.kind === 'video').length;
      return `<div class="lp" data-key="${esc(c.key)}" title="${esc(p.postUrl || c.file)}"><div class="cover">${c.kind === 'video' ? (c.posterPath ? `<img loading="lazy" src="${fileUrl(c.posterPath)}" alt="">` : `<div class="ph">${icon('film', 30)}</div>`) : `<img loading="lazy" src="${fileUrl(c.path)}" alt="">`}
        ${p.items.length > 1 ? `<span class="count">${icon('library', 12)}${p.items.length}</span>` : vids ? `<span class="count">${icon('play', 10)}Video</span>` : ''}</div>
        <div class="d">${esc(p.postId ? fmtDate(p.date) || 'Undated' : 'Not part of a post')}</div>${p.caption ? `<div class="c">${esc(p.caption)}</div>` : ''}</div>`; }).join('')}</div>`;
}

// ---------------------------------------------------------------- batch
function batchUrls() { return $('#batch-urls').value.split(/\s+/).map(s => s.trim()).filter(u => /^https?:\/\//.test(u)); }
function batchCount() { const n = batchUrls().length; $('#batch-count').textContent = n ? plural(n, 'link') : ''; }
$('#batch-urls').oninput = batchCount;
$('#batch-go').onclick = async () => {
  if (S.batch) { call('batch:stop'); return; }
  const urls = batchUrls(); if (!urls.length) return toast('Paste at least one link');
  await call('batch:start', { urls, scroll: $('#batch-scroll').checked, max: Number($('#batch-max').value) || 0 });
  $('#batch-go').textContent = 'Stop'; $('#batch-go').classList.remove('primary');
};
function renderBatchRows(info) {
  const ICON = { waiting: '', loading: '<span class="spin"></span>', scrolling: '<span class="spin"></span>', done: icon('check', 15), failed: icon('x', 15), skipped: '–', stopped: '–' };
  const LABEL = { waiting: 'Waiting', loading: 'Opening…', scrolling: 'Scrolling…', done: 'Done', failed: 'Failed', skipped: 'Skipped', stopped: 'Stopped' };
  $('#batch-rows').innerHTML = info.rows.map((r, i) => `<div class="brow ${r.state} ${i === info.index && !info.finished ? 'active' : ''}"><span class="ico">${ICON[r.state] || ''}</span><span class="u" title="${esc(r.url)}">${esc(r.url)}</span>
    <span class="st">${esc(r.state === 'failed' ? (r.error || 'Failed') : LABEL[r.state])}${r.found ? ` · ${plural(r.found, 'item')}` : ''}</span></div>`).join('');
}

// ---------------------------------------------------------------- settings
const LAYOUTS = [['account', 'A folder per account', 'Instagram/clientbrand/2026-10-02 C9xYz 01.jpg'], ['post', 'A folder per post', 'Instagram/clientbrand/2026-10-02 C9xYz/2026-10-02 C9xYz 01.jpg'], ['flat', 'Just the account', 'clientbrand/2026-10-02 C9xYz 01.jpg']];
const NAMES = [['date-post-n', 'Date, post and number'], ['account-date-n', 'Account, date and number'], ['post-n', 'Post and number'], ['original', 'Original file name']];
function sw(id, on) { return `<label class="switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><i></i></label>`; }
function segBtns(id, opts, val) { return `<div class="seg big" id="${id}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(v) === String(val) ? 'on' : ''}">${l}</button>`).join('')}</div>`; }
function renderSettings() {
  const s = S.settings;
  $('#settings-body').innerHTML = `
    <div class="set-group"><h4>Saving</h4>
      <div class="set-row"><div class="lbl"><b>Save to</b><div class="path-box">${esc(s.folder)}</div></div><button class="btn" id="s-folder">Change…</button></div>
      <div class="set-row"><div class="lbl"><b>Folders</b></div><select id="s-layout">${LAYOUTS.map(([v, l]) => `<option value="${v}" ${s.layout === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="set-row"><div class="lbl"><b>File names</b></div><select id="s-names">${NAMES.map(([v, l]) => `<option value="${v}" ${s.fileNames === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="example" id="s-example"></div>
      <div class="set-row"><div class="lbl"><b>Save WebP and AVIF as JPG</b><small>So every picture opens anywhere, including older apps and phones</small></div>${sw('s-convert', s.convertWebp)}</div>
      <div class="set-row"><div class="lbl"><b>A caption file next to each post</b><small>Every haul already gets captions.csv; this adds a .txt per post too</small></div>${sw('s-captions', s.captionFiles)}</div>
    </div>
    <div class="set-group"><h4>Collecting</h4>
      <div class="set-row"><div class="lbl"><b>Skip pictures smaller than</b><small>Leaves out icons, avatars and emoji</small></div><select id="s-min">${[[0, 'Keep everything'], [200, '200 px'], [320, '320 px'], [600, '600 px'], [1000, '1000 px']].map(([v, l]) => `<option value="${v}" ${Number(s.minSide) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="set-row"><div class="lbl"><b>Only pictures from posts</b><small>On Instagram, Facebook, Patreon and X, hide what isn't part of a post (you can still show it from the tray)</small></div>${sw('s-posts', s.onlyPosts)}</div>
      <div class="set-row"><div class="lbl"><b>Auto-scroll speed</b><small>Gentle is kinder to sites that watch for fast scrolling</small></div>${segBtns('s-speed', [['gentle', 'Gentle'], ['normal', 'Normal'], ['fast', 'Fast']], s.scrollSpeed)}</div>
      <div class="set-row"><div class="lbl"><b>Downloads at once</b></div>${segBtns('s-conc', [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [6, '6']], s.concurrency)}</div>
    </div>
    <div class="set-group"><h4>App</h4>
      <div class="set-row"><div class="lbl"><b>Appearance</b></div>${segBtns('s-theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], s.theme)}</div>
      <div class="set-row"><div class="lbl"><b>Home page</b><small>Where Glean opens when there's nothing to come back to</small></div><button class="btn sm" id="s-home">Use this page</button></div>
      <div class="set-row"><div class="lbl"><b>Signed-in sites</b><small>Glean keeps its own sign-ins, separate from your other browsers</small></div><button class="btn sm danger" id="s-signout">Sign out of everything</button></div>
      <p class="note">Glean ${esc(S.version)}. It saves what you can already see in its browser, through your own sign-in. Only download what you have the right to use: your clients' accounts with their permission, content you've paid for, or your own.</p>
    </div>`;
  const ex = () => { const l = LAYOUTS.find(x => x[0] === $('#s-layout').value)[2]; const n = $('#s-names').value; const file = { 'date-post-n': '2026-10-02 C9xYz 01', 'account-date-n': 'clientbrand 2026-10-02 01', 'post-n': 'C9xYz 01', original: '462391845_18_n' }[n];
    $('#s-example').textContent = prettyPath(S.settings.folder) + '/' + l.replace(/[^/]+\.jpg$/, file + '.jpg') + '\n' + prettyPath(S.settings.folder) + '/' + l.replace(/[^/]+\.jpg$/, 'captions.csv'); };
  ex();
  $('#s-folder').onclick = async () => { const p = await call('pick-folder'); if (p) { S.settings.folder = p; renderSettings(); renderDest(); refreshLibrary(); } };
  $('#s-layout').onchange = (e) => { setSetting({ layout: e.target.value }); ex(); };
  $('#s-names').onchange = (e) => { setSetting({ fileNames: e.target.value }); ex(); };
  $('#s-convert').onchange = (e) => setSetting({ convertWebp: e.target.checked });
  $('#s-captions').onchange = (e) => setSetting({ captionFiles: e.target.checked });
  $('#s-min').onchange = async (e) => { await setSetting({ minSide: Number(e.target.value) }); renderTray(); };
  $('#s-posts').onchange = async (e) => { await setSetting({ onlyPosts: e.target.checked }); renderTray(); };
  const seg = (id, key, num) => $(`#${id}`).onclick = async (e) => { const b = e.target.closest('button'); if (!b) return; $$(`#${id} button`).forEach(x => x.classList.toggle('on', x === b)); await setSetting({ [key]: num ? Number(b.dataset.v) : b.dataset.v }); if (key === 'theme') applyTheme(); };
  seg('s-speed', 'scrollSpeed'); seg('s-conc', 'concurrency', true); seg('s-theme', 'theme');
  $('#s-home').onclick = () => { if (/^https?:/.test(S.pageUrl)) { setSetting({ homeUrl: S.pageUrl }); toast('Home page set'); } };
  $('#s-signout').onclick = async () => { if (!confirm('Sign out of every site in Glean? Your saved pictures stay where they are.')) return; await call('browser:clear-data'); try { web.reload(); } catch {} toast('Signed out of everything'); };
}
$('#open-settings').onclick = () => { renderSettings(); $('#settings').hidden = false; };
$('#settings').onclick = (e) => { if (e.target.id === 'settings' || e.target.closest('[data-close]')) $('#settings').hidden = true; };
$('#theme-btn').onclick = async () => { const cur = document.documentElement.dataset.theme; await setSetting({ theme: cur === 'dark' ? 'light' : 'dark' }); applyTheme(); };

// ---------------------------------------------------------------- tray resize
(() => {
  const h = $('#tray-resize'); let x0 = 0, w0 = 0;
  const move = (e) => { const w = Math.max(300, Math.min(760, w0 + (x0 - e.clientX))); document.body.style.setProperty('--tray-w', w + 'px'); };
  const up = () => { h.classList.remove('drag'); document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); $('#web').style.pointerEvents = ''; setSetting({ trayWidth: parseInt(getComputedStyle(document.body).getPropertyValue('--tray-w')) || 384 }); };
  h.addEventListener('pointerdown', (e) => { x0 = e.clientX; w0 = $('#tray').offsetWidth; h.classList.add('drag'); $('#web').style.pointerEvents = 'none'; document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); });
})();

// ---------------------------------------------------------------- keyboard
document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!$('#lightbox').hidden) { if (e.key === 'Escape') closeLightbox(); if (e.key === 'ArrowLeft') stepLightbox(-1); if (e.key === 'ArrowRight') stepLightbox(1); return; }
  if (e.key === 'Escape' && !$('#settings').hidden) { $('#settings').hidden = true; return; }
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (mod && e.key.toLowerCase() === 'l') { e.preventDefault(); showView('browse'); $('#url').focus(); }
  else if (mod && e.key.toLowerCase() === 'r' && !e.shiftKey) { e.preventDefault(); try { web.reload(); } catch {} }
  else if (mod && e.key === '[') { try { web.goBack(); } catch {} }
  else if (mod && e.key === ']') { try { web.goForward(); } catch {} }
  else if (mod && e.key === ',') { e.preventDefault(); $('#open-settings').click(); }
  else if (mod && e.key.toLowerCase() === 'a' && !typing && S.view === 'browse') { e.preventDefault(); $('#sel-all').click(); }
  else if (mod && e.key.toLowerCase() === 'd' && !typing) { e.preventDefault(); $('#dl-btn').click(); }
  else if (mod && e.shiftKey && e.key.toLowerCase() === 'c') { e.preventDefault(); $('#collect-btn').click(); }
  else if (mod && e.key === '1') showView('browse'); else if (mod && e.key === '2') showView('library'); else if (mod && e.key === '3') showView('batch');
});

// ---------------------------------------------------------------- start
(async () => {
  const b = await api.call('bootstrap');
  S.settings = b.settings; S.platform = b.platform; S.version = b.version;
  document.documentElement.dataset.platform = b.platform;
  S.saved = new Set(b.saved); S.library = b.library; S.newOnly = b.settings.newOnly !== false;
  S.layout = b.settings.trayLayout === 'grid' ? 'grid' : 'posts'; $$('#layout-seg button').forEach(x => x.classList.toggle('on', x.dataset.layout === S.layout));
  for (const m of b.collection) S.items.set(m.key, m);
  if (b.settings.trayWidth) document.body.style.setProperty('--tray-w', b.settings.trayWidth + 'px');
  $('#lib-n').hidden = !S.library.length; $('#lib-n').textContent = S.library.length;
  applyTheme(); renderSites(); renderDest(); renderTray(); batchCount();
  web.setAttribute('partition', b.partition);
  web.setAttribute('preload', b.preload);
  web.setAttribute('src', b.startUrl);
  document.body.classList.add('ready');
})();
