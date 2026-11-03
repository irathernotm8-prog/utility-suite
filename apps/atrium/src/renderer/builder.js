// Atrium — the builder: the preview frame (device sizes, edit/preview), the page and site switchers, and the
// conversation with the editing layer inside the preview.
'use strict';
const DEVICES = { desktop: null, tablet: 834, phone: 390 };
const frame = () => $('#frame');
const toFrame = (m) => { try { frame().contentWindow.postMessage({ src: 'atrium-app', ...m }, '*'); } catch {} };

async function loadFrame(keepScroll) {
  const url = await call('preview:url', S.page, S.mode === 'edit');
  const f = frame(); const u = S.mode === 'edit' ? url : url + (url.includes('?') ? '&' : '?') + 'view=1';
  if (keepScroll && f.src && f.src.split('?')[0] === u.split('?')[0]) { try { f.contentWindow.location.reload(); return; } catch {} }
  f.src = u;
}
function layoutFrame() {
  const wrap = $('#frameWrap'); const stage = $('#stage'); const w = DEVICES[S.device];
  stage.classList.toggle('framed', !!w);
  wrap.classList.toggle('tablet', S.device === 'tablet'); wrap.classList.toggle('phone', S.device === 'phone');
  const avail = stage.clientWidth - (w ? 60 : 36); const availH = stage.clientHeight - (w ? 60 : 36);
  if (!w) { // desktop: a real desktop width (at least 1280px), scaled down to fit when the window is narrower
    const vw = Math.max(1280, avail); const sc = Math.min(1, avail / vw);
    wrap.style.width = vw + 'px'; wrap.style.height = (availH / sc) + 'px'; wrap.style.transform = sc < 1 ? `scale(${sc})` : '';
    stage.style.overflow = sc < 1 ? 'hidden' : ''; $('#widthLabel').textContent = vw + 'px' + (sc < 1 ? ` · ${Math.round(sc * 100)}%` : ''); return;
  }
  stage.style.overflow = '';
  const h = S.device === 'phone' ? Math.min(844, availH) : Math.min(1112, availH);
  const scale = Math.min(1, avail / w);
  wrap.style.width = w + 'px'; wrap.style.height = (scale < 1 ? h / scale : h) + 'px'; wrap.style.transform = scale < 1 ? `scale(${scale})` : '';
  $('#widthLabel').textContent = w + 'px' + (scale < 1 ? ` · ${Math.round(scale * 100)}%` : '');
}
function setDevice(d) { S.device = d; $$('#deviceSeg button').forEach((b) => b.classList.toggle('on', b.dataset.device === d)); layoutFrame(); call('settings:set', { device: d }).catch(() => {}); }
function setMode(m) { S.mode = m; $$('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m)); loadFrame(); if (m === 'view') { S.sel = null; renderRight(); } }

async function setPage(slug, opts = {}) {
  S.page = slug; S.sel = null; const p = curPage(); $('#pageName').textContent = p ? p.title : 'Page';
  if (!opts.noFrame) await loadFrame();
  call('selection:set', { page: S.page }).catch(() => {});
  renderLeft(); renderRight();
}
function updateTop() {
  if (!S.site) return;
  $('#siteName').textContent = S.site.settings.name || S.site.name; const p = curPage(); $('#pageName').textContent = p ? p.title : 'Page';
  document.title = `${S.site.name} — Atrium`;
}

// ───────── messages from the editing layer
const names = () => { const m = {}; if (!S.site) return m; const g = S.site.globals; if (g.header) m[g.header.id] = g.header.name; if (g.footer) m[g.footer.id] = g.footer.name; for (const p of S.site.pages) for (const s of p.sections) m[s.id] = s.name; return m; };
addEventListener('message', async (e) => {
  const m = e.data; if (!m || m.src !== 'atrium-overlay') return;
  if (m.type === 'ready') {
    if (m.page && m.page !== S.page && S.site.pages.some((p) => p.slug === m.page)) { S.page = m.page; updateTop(); renderLeft(); }
    toFrame({ type: 'mode', edit: S.mode === 'edit' }); toFrame({ type: 'names', names: names() });
    if (S.sel && findSec(S.sel.id)) toFrame({ type: 'select', id: S.sel.id, path: S.sel.path });
    if (S.pendingScroll) { toFrame({ type: 'scroll', id: S.pendingScroll }); toFrame({ type: 'flash', id: S.pendingScroll }); S.pendingScroll = null; }
  }
  if (m.type === 'select') { S.sel = m.id ? { id: m.id, path: m.path || [], info: m.info } : null; if (S.rtab !== 'inspect' && m.id && !S.aiBusy) setRtab('inspect'); renderRight(); highlightLayer(); reportSel(); }
  if (m.type === 'commit') { await attempt(async () => { await call('sections:update', m.id, { html: m.html, _label: m.label }, m.nonce); await refreshSite(); }); }
  if (m.type === 'image') pickImage(async (src) => { toFrame({ type: 'apply', id: m.id, path: m.path, attrs: { src }, label: 'Replace image' }); });
  if (m.type === 'action') sectionAction(m.action, m.id);
  if (m.type === 'navigate') { const mm = /^(?:\.\.\/)?([a-z0-9-]+)\.html/.exec(m.href || ''); if (mm && S.site.pages.some((p) => p.slug === mm[1])) setPage(mm[1]); }
});
function reportSel() { const s = S.sel && findSec(S.sel.id); call('selection:set', { page: S.page, section: S.sel ? S.sel.id : null, element: S.sel && S.sel.info && S.sel.path && S.sel.path.length ? `<${S.sel.info.tag}> "${(S.sel.info.text || '').slice(0, 40)}"` : null, name: s ? s.sec.name : null }).catch(() => {}); }
function selectSection(id, scroll = true) { S.sel = { id, path: [], info: null }; toFrame({ type: 'select', id, path: [], scroll, report: true }); renderRight(); highlightLayer(); reportSel(); }

async function sectionAction(action, id) {
  const f = findSec(id); if (!f) return;
  if (action === 'up' || action === 'down') return attempt(async () => { await call('sections:move', id, action); await refreshSite(); });
  if (action === 'dup') return attempt(async () => { await call('sections:duplicate', id); await refreshSite(); });
  if (action === 'delete') { if (await confirmSheet('Delete this section?', `“${esc(f.sec.name)}” will be removed. You can undo it (⌘Z) or restore it from Versions.`, 'Delete', true)) attempt(async () => { await call('sections:remove', id); S.sel = null; await refreshSite(); renderRight(); }); return; }
  if (action === 'code') return openCode(id);
  if (action === 'ai') { setRtab('ai'); const ta = $('#chatText'); if (ta) { ta.focus(); ta.placeholder = `What should change in “${f.sec.name}”?`; } return; }
  if (action === 'add-after') { S.insertAt = { page: f.where === 'page' ? f.page.slug : S.page, position: f.where === 'page' ? { after: id } : f.where === 'header' ? 'start' : 'end', label: f.sec.name }; setPanel('add'); }
}

// refresh from disk after any change (ours or the AI's)
let refreshT = null;
async function refreshSite() { await loadSite(); updateTop(); renderLeft(); renderRight(); toFrame({ type: 'names', names: names() }); }
function refreshSoon() { clearTimeout(refreshT); refreshT = setTimeout(() => refreshSite().catch(() => {}), 180); }

// switchers
function siteMenu(anchor) {
  call('sites:list').then((list) => menu(anchor, [
    { label: 'Sites' },
    ...list.slice(0, 12).map((s) => ({ text: s.name, icon: 'site', on: s.id === S.site.id, run: () => openSite(s.dir) })),
    '-', { text: 'All sites…', icon: 'drafts', run: () => showView('home') }, { text: 'New site…', icon: 'plus', run: () => newSiteSheet() }, { text: 'Rename this site…', icon: 'edit', run: async () => { const n = await promptSheet('Rename site', 'Name', S.site.settings.name || S.site.name, 'Rename'); if (n) attempt(async () => { await call('sites:rename', n); await refreshSite(); }); } }, { text: 'Show in Finder', icon: 'folder', run: () => call('sites:reveal') },
  ]));
}
function pageMenu(anchor) {
  menu(anchor, [{ label: 'Pages' }, ...S.site.pages.map((p) => ({ text: p.title, hint: p.slug === 'index' ? '/' : p.slug + '.html', icon: 'pages', on: p.slug === S.page, run: () => setPage(p.slug) })), '-', { text: 'New page…', icon: 'plus', run: () => newPageSheet() }]);
}
async function openSite(dir) { await call('sites:open', dir); S.page = 'index'; S.sel = null; await loadSite(); showView('builder'); updateTop(); await loadFrame(); renderLeft(); renderRight(); if (typeof loadChat === 'function') loadChat(); }

function showView(v) {
  S.view = v; $('#builder').hidden = v !== 'builder'; $('#home').hidden = v !== 'home'; $('#prefs').hidden = v !== 'prefs';
  $('#topMid').style.visibility = v === 'builder' ? '' : 'hidden'; $$('#topRight > *').forEach((x) => { if (x.id !== 'settingsBtn') x.style.display = v === 'builder' ? '' : 'none'; });
  $('#siteBtn').style.display = $('#pageBtn').style.display = v === 'builder' ? '' : 'none'; $$('.crumb-sep').forEach((x) => (x.style.display = v === 'builder' ? '' : 'none'));
  if (v === 'home') renderHome(); if (v === 'prefs') renderPrefs(); if (v === 'builder') setTimeout(layoutFrame, 0);
}
