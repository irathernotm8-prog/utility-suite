// Atrium — the left panels: Layers (pages + sections), Add (section library), Theme, Assets, Blog, Site, Code.
'use strict';
function setPanel(p) {
  if (S.panel === p && !$('#builder').classList.contains('no-left') && p !== 'add') { $('#builder').classList.add('no-left'); $$('#rail button').forEach((b) => b.classList.remove('on')); setTimeout(layoutFrame, 10); return; }
  $('#builder').classList.remove('no-left'); S.panel = p; $$('#rail button').forEach((b) => b.classList.toggle('on', b.dataset.panel === p)); renderLeft(); setTimeout(layoutFrame, 10);
}
function renderLeft() {
  const host = $('#leftBody'); if (!S.site || !host) return;
  const fn = { layers: panelLayers, add: panelAdd, theme: panelTheme, assets: panelAssets, blog: panelBlog, site: panelSite, code: panelCode }[S.panel] || panelLayers;
  const keep = host.scrollTop; host.innerHTML = ''; fn(host); hydrateIcons(host); host.scrollTop = keep;
}
const head = (title, right = '') => `<div class="pane-head"><h3>${title}</h3>${right}</div>`;

// ───────── Layers
function panelLayers(host) {
  const p = curPage(); const g = S.site.globals;
  host.innerHTML = head('Pages', `<button class="icon-btn sm" data-new-page title="New page">${icon('plus', 17)}</button>`) + `<div class="pane"><div class="page-list">${S.site.pages.map((x) => `<div class="page-item ${x.slug === S.page ? 'on' : ''}" data-page="${esc(x.slug)}"><span data-icon="${x.slug === 'index' ? 'home' : 'pages'}" data-size="15"></span><span class="ellip">${esc(x.title)}</span>${x.nav ? '' : `<span class="hidden-nav" title="Not in the menu">${icon('hide', 13)}</span>`}<span class="slug">${x.slug === 'index' ? '/' : esc(x.slug)}</span><button class="icon-btn xs" data-page-menu="${esc(x.slug)}">${icon('more', 15)}</button></div>`).join('')}</div>
  <div class="group-title" style="margin-top:8px"><span class="grow">Layers · ${esc(p.title)}</span><span class="tiny muted">${plural(p.sections.length, 'section')}</span></div>
  <div class="layer-list" id="layerList">
    ${g.header ? layerRow(g.header, 'header') : `<button class="btn sm ghost" data-add-global="header">${icon('plus', 14)} Add a header</button>`}
    ${p.sections.map((s) => layerRow(s, 'page')).join('')}
    ${!p.sections.length ? '<div class="empty"><b>Empty page</b><span>Add a section, or ask the AI to build it.</span></div>' : ''}
    ${g.footer ? layerRow(g.footer, 'footer') : `<button class="btn sm ghost" data-add-global="footer">${icon('plus', 14)} Add a footer</button>`}
  </div>
  <div class="add-row"><button class="btn sm" data-add-section>${icon('plus', 15)} Add section</button><button class="btn sm" data-ask-page>${icon('sparkle', 15)} Build with AI</button></div></div>`;
  $('[data-new-page]', host).onclick = () => newPageSheet();
  $$('[data-page]', host).forEach((el) => el.onclick = (e) => { if (e.target.closest('[data-page-menu]')) return; setPage(el.dataset.page); });
  $$('[data-page-menu]', host).forEach((b) => b.onclick = (e) => { e.stopPropagation(); pageItemMenu(b, S.site.pages.find((x) => x.slug === b.dataset.pageMenu)); });
  $$('[data-add-global]', host).forEach((b) => b.onclick = () => { S.insertAt = { page: b.dataset.addGlobal, position: 'end', label: b.dataset.addGlobal }; S.libCat = b.dataset.addGlobal === 'header' ? 'Header' : 'Footer'; setPanel('add'); });
  $('[data-add-section]', host).onclick = () => { S.insertAt = null; setPanel('add'); };
  $('[data-ask-page]', host).onclick = () => { setRtab('ai'); const t = $('#chatText'); if (t) { t.value = p.sections.length ? `Improve the ${p.title} page: ` : `Build the ${p.title} page for this site: `; t.focus(); } };
  // layers: click selects, drag reorders
  let dragId = null;
  $$('.layer', host).forEach((el) => {
    el.onclick = (e) => { if (e.target.closest('[data-la]')) return; selectSection(el.dataset.id); };
    el.ondblclick = () => openCode(el.dataset.id);
    $$('[data-la]', el).forEach((b) => b.onclick = (e) => { e.stopPropagation(); sectionAction(b.dataset.la, el.dataset.id); });
    if (el.dataset.where !== 'page') return;
    el.draggable = true;
    el.ondragstart = (e) => { dragId = el.dataset.id; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; };
    el.ondragend = () => { el.classList.remove('dragging'); $$('.layer', host).forEach((x) => x.classList.remove('drag-over')); };
    el.ondragover = (e) => { if (!dragId || dragId === el.dataset.id) return; e.preventDefault(); $$('.layer', host).forEach((x) => x.classList.toggle('drag-over', x === el)); };
    el.ondrop = (e) => { e.preventDefault(); const to = p.sections.findIndex((s) => s.id === el.dataset.id); const from = p.sections.findIndex((s) => s.id === dragId); if (from < 0 || to < 0) return; attempt(async () => { await call('sections:move', dragId, from < to ? to : to); await refreshSite(); }); dragId = null; };
  });
  highlightLayer();
}
function layerRow(s, where) {
  const sub = where === 'page' ? (s.type === 'custom' ? 'Custom' : s.type) : where === 'header' ? 'Shared header · every page' : 'Shared footer · every page';
  return `<div class="layer ${where !== 'page' ? 'global' : ''}" data-id="${s.id}" data-where="${where}">${where === 'page' ? `<span class="grip">${icon('grip', 14)}</span>` : `<span class="grip">${icon(where === 'header' ? 'arrowUp' : 'arrowDown', 13)}</span>`}<div class="l-name"><b>${esc(s.name)}</b><span>${esc(sub)}</span></div><div class="l-acts"><button class="icon-btn xs" data-la="code" title="Code">${icon('code', 14)}</button>${where === 'page' ? `<button class="icon-btn xs" data-la="dup" title="Duplicate">${icon('dup', 14)}</button>` : ''}<button class="icon-btn xs" data-la="delete" title="Delete">${icon('trash', 14)}</button></div></div>`;
}
function highlightLayer() { $$('.layer').forEach((l) => l.classList.toggle('on', !!S.sel && l.dataset.id === S.sel.id)); }
function pageItemMenu(anchor, p) {
  menu(anchor, [
    { text: 'Page settings & SEO…', icon: 'sliders', run: () => pageSheet(p) },
    { text: p.nav ? 'Hide from the menu' : 'Show in the menu', icon: p.nav ? 'hide' : 'eye', run: () => attempt(async () => { await call('pages:update', p.id, { nav: !p.nav }); await refreshSite(); }) },
    { text: 'Duplicate', icon: 'dup', run: () => attempt(async () => { await call('pages:duplicate', p.id); await refreshSite(); }) },
    { text: 'Move up', icon: 'arrowUp', run: () => attempt(async () => { await call('pages:move', p.id, Math.max(0, S.site.pages.indexOf(p) - 1)); await refreshSite(); }) },
    { text: 'Move down', icon: 'arrowDown', run: () => attempt(async () => { await call('pages:move', p.id, S.site.pages.indexOf(p) + 1); await refreshSite(); }) },
    ...(p.slug !== 'index' ? ['-', { text: 'Delete page', icon: 'trash', danger: true, run: async () => { if (await confirmSheet('Delete this page?', `“${esc(p.title)}” and its sections will be removed. Undo with ⌘Z or from Versions.`, 'Delete', true)) attempt(async () => { await call('pages:remove', p.id); if (S.page === p.slug) S.page = 'index'; await refreshSite(); await loadFrame(); }); } }] : []),
  ]);
}
function newPageSheet() {
  const s = sheet({ title: 'New page', body: `<div class="field"><label>Title</label><input class="input" data-t placeholder="e.g. Pricing"></div>
    <div class="field"><label>Start from</label><select class="select" data-from><option value="">An empty page</option>${S.site.pages.map((p) => `<option value="${p.id}">A copy of ${esc(p.title)}</option>`).join('')}<option value="ai">Describe it and let the AI build it</option></select></div>
    <div class="field" data-ai-wrap hidden><label>What should be on it?</label><textarea class="input" rows="3" data-ai placeholder="e.g. Three plans with a monthly/yearly switch, a comparison table and FAQs about billing"></textarea></div>
    <label class="chk"><input type="checkbox" data-nav checked> Show in the menu</label>`, foot: '<button class="btn" data-no>Cancel</button><button class="btn primary" data-yes>Create page</button>' });
  const t = $('[data-t]', s.el); setTimeout(() => t.focus(), 30);
  $('[data-from]', s.el).onchange = (e) => { $('[data-ai-wrap]', s.el).hidden = e.target.value !== 'ai'; };
  $('[data-no]', s.el).onclick = () => s.close();
  $('[data-yes]', s.el).onclick = () => attempt(async () => {
    const title = t.value.trim() || 'New page'; const from = $('[data-from]', s.el).value;
    const p = await call('pages:add', { title, nav: $('[data-nav]', s.el).checked, template: from && from !== 'ai' ? from : undefined });
    s.close(); await refreshSite(); await setPage(p.slug);
    if (from === 'ai') sendChat(`Build the "${title}" page (slug ${p.slug}): ${$('[data-ai]', s.el).value.trim() || 'make it great for this site'}`);
  });
}
function pageSheet(p) {
  const s = sheet({ title: `Page · ${esc(p.title)}`, body: `
    <div class="field"><label>Title (also the menu label)</label><input class="input" data-t value="${esc(p.title)}"></div>
    <div class="field"><label>Address</label><div class="row"><span class="muted small">/</span><input class="input grow" data-slug value="${esc(p.slug)}" ${p.slug === 'index' ? 'disabled' : ''}><span class="muted small">.html</span></div></div>
    <label class="chk"><input type="checkbox" data-nav ${p.nav ? 'checked' : ''}> Show in the menu</label>
    <div class="group-title">Search & social</div>
    <div class="field"><label>Search title <span class="muted" data-tl></span></label><input class="input" data-st value="${esc(p.seo.title)}" placeholder="Default: ${esc(p.title)} — ${esc(S.site.settings.name || S.site.name)}"></div>
    <div class="field"><label>Description <span class="muted" data-dl></span></label><textarea class="input" rows="3" data-sd placeholder="One or two sentences for Google and link previews (120–160 characters)">${esc(p.seo.description)}</textarea></div>
    <div class="field"><label>Share image</label><div class="row"><input class="input grow" data-og value="${esc(p.seo.ogImage)}" placeholder="assets/… (1200×630)"><button class="btn sm" data-pick>Choose…</button></div></div>
    <label class="chk"><input type="checkbox" data-ni ${p.seo.noindex ? 'checked' : ''}> Hide from search engines (noindex)</label>`,
  foot: '<button class="btn" data-no>Cancel</button><button class="btn primary" data-yes>Save</button>' });
  const cnt = () => { $('[data-tl]', s.el).textContent = `· ${$('[data-st]', s.el).value.length}/60`; $('[data-dl]', s.el).textContent = `· ${$('[data-sd]', s.el).value.length}/160`; };
  $('[data-st]', s.el).oninput = cnt; $('[data-sd]', s.el).oninput = cnt; cnt();
  $('[data-pick]', s.el).onclick = () => pickImage((src) => { $('[data-og]', s.el).value = src; });
  $('[data-no]', s.el).onclick = () => s.close();
  $('[data-yes]', s.el).onclick = () => attempt(async () => {
    const r = await call('pages:update', p.id, { title: $('[data-t]', s.el).value.trim() || p.title, slug: p.slug === 'index' ? undefined : $('[data-slug]', s.el).value.trim(), nav: $('[data-nav]', s.el).checked, seo: { title: $('[data-st]', s.el).value.trim(), description: $('[data-sd]', s.el).value.trim(), ogImage: $('[data-og]', s.el).value.trim(), noindex: $('[data-ni]', s.el).checked } });
    s.close(); if (S.page === p.slug) S.page = r.slug; await refreshSite(); await loadFrame(); toast('Page saved');
  });
}

// ───────── Add (library)
function panelAdd(host) {
  const L = S.lib; const cat = S.libCat || 'All'; const q = (S.libQ || '').toLowerCase();
  const list = L.sections.filter((x) => (cat === 'All' || x.category === cat) && (!q || (x.name + x.description + x.type + (x.tags || []).join(' ')).toLowerCase().includes(q)));
  const target = S.insertAt ? `Adding ${S.insertAt.page === 'header' || S.insertAt.page === 'footer' ? 'the ' + S.insertAt.page : `after “${esc(S.insertAt.label || '')}”`}` : S.sel && findSec(S.sel.id) && findSec(S.sel.id).where === 'page' ? `Adding after “${esc(findSec(S.sel.id).sec.name)}”` : `Adding to the end of ${esc(curPage().title)}`;
  host.innerHTML = head('Add a section', S.insertAt ? `<button class="link-btn" data-clear>Reset</button>` : '') + `<div class="insert-hint">${icon('plus', 14)}<span>${target}</span></div><input class="input sm lib-search" placeholder="Search sections…" value="${esc(S.libQ || '')}" data-q>
    <div class="lib-cats">${['All', ...L.categories].map((c) => `<button class="${c === cat ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <div class="lib-grid">${list.map((x) => `<div class="lib-card" data-type="${esc(x.type)}" title="${esc(x.description)}"><div class="lib-thumb"><div class="lib-load"><span class="spin"></span></div><iframe loading="lazy" data-src="${esc(x.type)}" tabindex="-1"></iframe><button class="btn xs primary lib-insert">${icon('plus', 13)} Add</button></div><div class="lib-meta"><b>${esc(x.name)}</b><span>${esc(x.category)} · ${esc(x.description)}</span></div></div>`).join('') || '<div class="empty">Nothing matches.</div>'}
    <button class="btn sm" data-custom>${icon('code', 14)} Write my own section…</button></div>`;
  const qi = $('[data-q]', host); qi.oninput = () => { S.libQ = qi.value; clearTimeout(S.libT); S.libT = setTimeout(() => { renderLeft(); const n = $('[data-q]'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 220); };
  $$('[data-cat]', host).forEach((b) => b.onclick = () => { S.libCat = b.dataset.cat; renderLeft(); });
  if ($('[data-clear]', host)) $('[data-clear]', host).onclick = () => { S.insertAt = null; renderLeft(); };
  $('[data-custom]', host).onclick = () => addCustomSection();
  // lazy previews
  const io = new IntersectionObserver((es) => es.forEach(async (e) => { if (!e.isIntersecting) return; io.unobserve(e.target); const f = e.target; f.src = await call('library:previewUrl', f.dataset.src); f.onload = () => { const l = f.parentElement.querySelector('.lib-load'); if (l) l.remove(); }; }), { root: host });
  $$('iframe[data-src]', host).forEach((f) => io.observe(f));
  $$('.lib-card', host).forEach((c) => c.onclick = () => insertSection({ type: c.dataset.type }));
}
function insertTarget() {
  if (S.insertAt) return S.insertAt;
  const f = S.sel && findSec(S.sel.id);
  if (f && f.where === 'page' && f.page.slug === S.page) return { page: S.page, position: { after: f.sec.id } };
  return { page: S.page, position: 'end' };
}
async function insertSection(spec) {
  const t = insertTarget(); const L = S.lib.sections.find((x) => x.type === spec.type);
  if (L && (L.category === 'Header' || L.category === 'Footer') && !(t.page === 'header' || t.page === 'footer')) { const g = L.category.toLowerCase(); if (S.site.globals[g] && !(await confirmSheet(`Replace the ${g}?`, `The site has one shared ${g}. “${esc(L.name)}” will replace “${esc(S.site.globals[g].name)}” on every page.`, 'Replace'))) return; t.page = g; }
  await attempt(async () => { const sec = await call('sections:add', t.page, spec, t.position); S.insertAt = null; S.sel = { id: sec.id, path: [] }; S.pendingScroll = sec.id; await refreshSite(); toast(`Added ${sec.name}`); });
}
function addCustomSection() { insertSection({ name: 'Custom section', html: '<section>\n  <div class="at-container at-stack">\n    <h2 class="at-h2">A new section</h2>\n    <p class="at-lead">Write your own html and css, or ask the AI.</p>\n  </div>\n</section>', css: '& {\n  padding: var(--at-pad) 0;\n}' }).then(() => { if (S.sel) openCode(S.sel.id); }); }

// ───────── Theme
function panelTheme(host) {
  const t = S.site.theme; const L = S.lib; const c = t.colors;
  const sw = (p) => `<div class="sw-row"><i style="background:${p.colors.bg}"></i><i style="background:${p.colors.surface}"></i><i style="background:${p.colors.primary}"></i><i style="background:${p.colors.accent}"></i><i style="background:${p.colors.text}"></i></div>`;
  const COLORS = [['bg', 'Background'], ['surface', 'Cards'], ['surface2', 'Alt background'], ['text', 'Text'], ['muted', 'Muted text'], ['primary', 'Primary'], ['primaryText', 'Text on primary'], ['accent', 'Accent'], ['border', 'Borders']];
  const fontOpts = (v) => L.fonts.map((f) => `<option ${f.name === v ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
  host.innerHTML = head('Theme', `<span class="pill">${esc(t.preset || 'custom')}</span>`) + `<div class="pane">
    <div class="group"><div class="group-title">Presets</div><div class="preset-grid">${L.presets.map((p) => `<button class="preset ${p.id === t.preset ? 'on' : ''}" data-preset="${p.id}">${sw(p)}<b>${esc(p.name)}</b><span>${esc(p.fonts.heading)} · ${p.mode}</span></button>`).join('')}</div></div>
    <div class="group"><div class="group-title">From your brand colour</div><div class="row"><div class="color-in"><input type="color" data-brand value="${c.primary}"></div><div class="seg sm"><button data-bm="dark" class="${t.mode === 'dark' ? 'on' : ''}">Dark</button><button data-bm="light" class="${t.mode === 'light' ? 'on' : ''}">Light</button></div><button class="btn xs" data-gen>Make palette</button></div></div>
    <div class="group"><div class="group-title">Colours</div>${COLORS.map(([k, n]) => `<div class="color-row"><span>${n}</span><span class="color-in"><input type="color" data-col="${k}" value="${c[k]}"><input type="text" data-colt="${k}" value="${c[k]}"></span></div>`).join('')}<div class="contrast" id="contrastBox"></div></div>
    <div class="group"><div class="group-title">Fonts</div>
      <div class="kv"><label>Headings</label><select class="select sm" data-font="heading">${fontOpts(t.fonts.heading)}</select></div>
      <div class="kv"><label>Body</label><select class="select sm" data-font="body">${fontOpts(t.fonts.body)}</select></div>
      <div class="kv"><label>Weight</label><select class="select sm" data-hw>${[400, 500, 600, 700, 800, 900].map((w) => `<option ${+t.fonts.headingWeight === w ? 'selected' : ''}>${w}</option>`).join('')}</select></div>
      <div class="kv"><label>Pairings</label><select class="select sm" data-pair><option value="">Pick a pairing…</option>${L.pairs.map((p, i) => `<option value="${i}">${esc(p.label || p.heading + ' + ' + p.body)}</option>`).join('')}</select></div>
      <div class="kv"><label>Tracking</label><input type="range" min="-0.06" max="0.04" step="0.005" value="${t.headingTracking}" data-num="headingTracking"></div></div>
    <div class="group"><div class="group-title">Shape & space</div>
      <div class="kv"><label>Corners</label><input type="range" min="0" max="32" step="1" value="${t.radius}" data-num="radius"></div>
      <div class="kv"><label>Buttons</label><div class="seg sm full">${['pill', 'rounded', 'square'].map((x) => `<button data-opt="buttonShape" data-v="${x}" class="${t.buttonShape === x ? 'on' : ''}">${x}</button>`).join('')}</div></div>
      <div class="kv"><label>Spacing</label><div class="seg sm full">${['compact', 'comfortable', 'airy'].map((x) => `<button data-opt="density" data-v="${x}" class="${t.density === x ? 'on' : ''}">${x}</button>`).join('')}</div></div>
      <div class="kv"><label>Shadows</label><div class="seg sm full">${['none', 'soft', 'deep'].map((x) => `<button data-opt="shadow" data-v="${x}" class="${t.shadow === x ? 'on' : ''}">${x}</button>`).join('')}</div></div>
      <div class="kv"><label>Width</label><input type="range" min="960" max="1520" step="20" value="${t.maxWidth}" data-num="maxWidth"></div>
      <div class="kv"><label>Mode</label><div class="seg sm full">${['dark', 'light'].map((x) => `<button data-opt="mode" data-v="${x}" class="${t.mode === x ? 'on' : ''}">${x}</button>`).join('')}</div></div></div>
  </div>`;
  const set = (patch) => attempt(async () => { await call('theme:set', patch); await refreshSite(); });
  $$('[data-preset]', host).forEach((b) => b.onclick = () => set({ preset: b.dataset.preset }));
  let bm = t.mode; $$('[data-bm]', host).forEach((b) => b.onclick = () => { bm = b.dataset.bm; $$('[data-bm]', host).forEach((x) => x.classList.toggle('on', x === b)); });
  $('[data-gen]', host).onclick = async () => { const pal = await call('theme:palette', $('[data-brand]', host).value, bm); set({ colors: pal, mode: bm }); };
  let ct; const colSet = (k, v) => { if (!/^#[0-9a-f]{6}$/i.test(v)) return; clearTimeout(ct); ct = setTimeout(() => set({ colors: { [k]: v } }), 160); };
  $$('[data-col]', host).forEach((i) => i.oninput = () => { $(`[data-colt="${i.dataset.col}"]`, host).value = i.value; colSet(i.dataset.col, i.value); });
  $$('[data-colt]', host).forEach((i) => i.onchange = () => colSet(i.dataset.colt, i.value.trim()));
  $$('[data-font]', host).forEach((s) => s.onchange = () => set({ fonts: { [s.dataset.font]: s.value } }));
  $('[data-hw]', host).onchange = (e) => set({ fonts: { headingWeight: +e.target.value } });
  $('[data-pair]', host).onchange = (e) => { const p = L.pairs[+e.target.value]; if (p) set({ fonts: { heading: p.heading, body: p.body } }); };
  $$('[data-num]', host).forEach((r) => r.onchange = () => set({ [r.dataset.num]: +r.value }));
  $$('[data-opt]', host).forEach((b) => b.onclick = () => set({ [b.dataset.opt]: b.dataset.v }));
  call('site:checks').then((cs) => { const box = $('#contrastBox'); if (box) box.innerHTML = `<div class="group-title" style="margin-top:6px">Contrast</div>` + cs.map((x) => `<div><span>${esc(x.pair)}</span><span class="${x.ok ? 'ok-t' : 'bad-t'}">${x.ratio}:1 ${x.ok ? '✓' : '✕'}</span></div>`).join(''); });
}

// ───────── Assets
async function panelAssets(host) {
  host.innerHTML = head('Images & files', `<button class="icon-btn sm" data-up title="Add files">${icon('plus', 17)}</button>`) + `<div class="pane"><div class="drop-zone" data-drop>Drop images here, or <button class="link-btn" data-up2>choose files</button><br><span class="tiny">Big photos are resized for the web.</span></div><div class="row"><input class="input sm grow" data-q placeholder="Find free photos (Openverse)…"><button class="btn sm" data-find>${icon('search', 14)}</button></div><div id="assetGrid" class="asset-grid"></div></div>`;
  const up = async () => { const f = await call('dialog:files', { multi: true, filters: [{ name: 'Images & media', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif', 'mp4', 'webm', 'pdf', 'woff2', 'ico'] }] }); if (f) { await attempt(() => call('assets:add', f), `Added ${plural(f.length, 'file')}`); renderLeft(); } };
  $('[data-up]', host).onclick = up; $('[data-up2]', host).onclick = up;
  const find = () => { const q = $('[data-q]', host).value.trim(); if (q) photoSheet(q); };
  $('[data-find]', host).onclick = find; $('[data-q]', host).onkeydown = (e) => { if (e.key === 'Enter') find(); };
  const list = await call('assets:list'); const port = S.info.previewPort;
  $('#assetGrid').innerHTML = list.length ? list.map((a) => `<div class="asset" data-a="${esc(a.path)}" title="${esc(a.path)} · ${(a.size / 1024).toFixed(0)} KB${a.used.length ? '\nUsed in: ' + esc(a.used.join(', ')) : ''}"><div class="a-img" style="${a.kind === 'image' ? `background-image:url('http://127.0.0.1:${port}/${encodeURI(a.path)}')` : ''}">${a.kind !== 'image' ? icon('file', 22) : ''}</div><div class="a-name">${esc(a.name)}</div>${a.used.length ? '<span class="pill ok a-used">used</span>' : ''}</div>`).join('') : '<div class="empty" style="grid-column:1/-1">No images yet.</div>';
  hydrateIcons(host);
  $$('.asset', host).forEach((el) => el.onclick = () => menu(el, [
    { text: 'Copy path', icon: 'copy', run: () => call('clipboard:write', el.dataset.a).then(() => toast('Copied', el.dataset.a)) },
    { text: 'Use as logo', icon: 'star', run: () => attempt(async () => { await call('settings:site', { logo: el.dataset.a }); await refreshSite(); }, 'Logo set') },
    { text: 'Use as favicon', icon: 'globe', run: () => attempt(async () => { await call('assets:favicon', el.dataset.a); await refreshSite(); }, 'Favicon made') },
    { text: 'Use as share image', icon: 'image', run: () => attempt(async () => { await call('settings:site', { ogImage: el.dataset.a }); await refreshSite(); }, 'Share image set') },
    '-', { text: 'Delete', icon: 'trash', danger: true, run: async () => { if (await confirmSheet('Delete this file?', esc(el.dataset.a), 'Delete', true)) { await attempt(() => call('assets:remove', el.dataset.a)); renderLeft(); } } },
  ]));
}
// picker used by the inspector, the overlay and SEO fields
async function pickImage(done) {
  const list = (await call('assets:list')).filter((a) => a.kind === 'image'); const port = S.info.previewPort;
  const s = sheet({ title: 'Choose an image', wide: true, body: `<div class="row"><button class="btn sm" data-up>${icon('upload', 14)} From this computer…</button><input class="input sm grow" data-q placeholder="Or find free photos…"><button class="btn sm" data-find>Search</button><input class="input sm" style="width:220px" data-url placeholder="Paste an image URL"><button class="btn sm" data-dl>Add</button></div><div class="asset-grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))" data-grid>${list.map((a) => `<div class="asset pick" data-a="${esc(a.path)}"><div class="a-img" style="background-image:url('http://127.0.0.1:${port}/${encodeURI(a.path)}')"></div><div class="a-name">${esc(a.name)}</div></div>`).join('') || '<div class="empty" style="grid-column:1/-1">No images yet. Add one above.</div>'}</div>`, foot: false });
  const pick = (p) => { s.close(); done(p); };
  $$('[data-a]', s.el).forEach((el) => el.onclick = () => pick(el.dataset.a));
  $('[data-up]', s.el).onclick = async () => { const f = await call('dialog:files', { filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif'] }] }); if (f) { const r = await attempt(() => call('assets:add', f)); if (r) pick(r[0]); } };
  $('[data-dl]', s.el).onclick = async () => { const u = $('[data-url]', s.el).value.trim(); if (u) { const r = await attempt(() => call('assets:url', u)); if (r) pick(r); } };
  const find = () => { const q = $('[data-q]', s.el).value.trim(); if (q) { s.close(); photoSheet(q, done); } };
  $('[data-find]', s.el).onclick = find; $('[data-q]', s.el).onkeydown = (e) => { if (e.key === 'Enter') find(); };
}
async function photoSheet(q, done) {
  const s = sheet({ title: `Free photos · ${esc(q)}`, wide: true, body: '<div class="empty"><span class="spin"></span>Searching Openverse…</div>', foot: false });
  try {
    const res = await call('photos:search', q);
    s.body.innerHTML = `<p class="hint" style="margin:0">Openly licensed photos (Creative Commons / public domain) that allow commercial use. Credit the creator where the licence says CC BY.</p><div class="asset-grid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))">${res.map((r, i) => `<div class="asset pick" data-i="${i}" title="${esc(r.title || '')} — ${esc(r.creator || '')} · ${esc(r.license)}"><div class="a-img" style="background-image:url('${esc(r.thumb)}')"></div><div class="a-name">${esc(r.creator || 'Unknown')} · ${esc(r.license)}</div></div>`).join('') || '<div class="empty">Nothing found.</div>'}</div>`;
    $$('[data-i]', s.body).forEach((el) => el.onclick = async () => { const r = res[+el.dataset.i]; el.style.opacity = .5; const p = await attempt(() => call('assets:url', r.url)); if (p) { s.close(); toast('Added photo', r.credit || '', 'ok', 7000); if (done) done(p); else renderLeft(); } else el.style.opacity = 1; });
  } catch (e) { s.body.innerHTML = `<div class="empty"><b>Search didn’t work</b><span>${esc(e.message)}</span></div>`; }
}

// ───────── Blog
function panelBlog(host) {
  const posts = S.site.posts;
  host.innerHTML = head('Blog', `<button class="icon-btn sm" data-new title="New post">${icon('plus', 17)}</button>`) + `<div class="pane"><p class="hint" style="margin:0">Posts show up in any “Latest posts” section and get their own pages. On WordPress they become real posts.</p>${posts.map((p) => `<div class="layer" data-post="${p.id}"><div class="l-name"><b>${esc(p.title)}</b><span>${esc(p.date)}${p.draft ? ' · draft' : ''}${(p.tags || []).length ? ' · ' + esc(p.tags.join(', ')) : ''}</span></div><div class="l-acts"><button class="icon-btn xs" data-view="${esc(p.slug)}" title="Preview">${icon('eye', 14)}</button></div></div>`).join('') || '<div class="empty"><b>No posts yet</b><span>Write one, or ask the AI to draft a few.</span></div>'}
  <div class="add-row"><button class="btn sm" data-new2>${icon('plus', 14)} New post</button><button class="btn sm" data-ai>${icon('sparkle', 14)} Draft with AI</button></div></div>`;
  $('[data-new]', host).onclick = () => postSheet(null); $('[data-new2]', host).onclick = () => postSheet(null);
  $('[data-ai]', host).onclick = () => { setRtab('ai'); const t = $('#chatText'); if (t) { t.value = 'Write a blog post about '; t.focus(); } };
  $$('[data-post]', host).forEach((el) => el.onclick = (e) => { if (e.target.closest('[data-view]')) return; postSheet(posts.find((p) => p.id === el.dataset.post)); });
  $$('[data-view]', host).forEach((b) => b.onclick = async (e) => { e.stopPropagation(); frame().src = await call('preview:post', b.dataset.view); });
}
function postSheet(p) {
  p = p || { title: '', slug: '', date: new Date().toISOString().slice(0, 10), excerpt: '', cover: '', body: '', tags: [], draft: false, author: '' };
  const s = sheet({ title: p.id ? 'Edit post' : 'New post', wide: true, body: `
    <div class="field"><label>Title</label><input class="input" data-k="title" value="${esc(p.title)}"></div>
    <div class="row" style="gap:12px;align-items:flex-start"><div class="field grow"><label>Date</label><input type="date" class="input" data-k="date" value="${esc(p.date)}"></div><div class="field grow"><label>Tags (comma separated)</label><input class="input" data-k="tags" value="${esc((p.tags || []).join(', '))}"></div><div class="field grow"><label>Author</label><input class="input" data-k="author" value="${esc(p.author || '')}"></div></div>
    <div class="field"><label>Excerpt</label><input class="input" data-k="excerpt" value="${esc(p.excerpt)}" placeholder="One or two sentences for cards and search results"></div>
    <div class="field"><label>Cover image</label><div class="row"><input class="input grow" data-k="cover" value="${esc(p.cover)}"><button class="btn sm" data-pick>Choose…</button></div></div>
    <div class="field"><label>Body (Markdown)</label><textarea class="input mono" rows="16" data-k="body">${esc(p.body)}</textarea></div>
    <label class="chk"><input type="checkbox" data-draft ${p.draft ? 'checked' : ''}> Draft (hidden from the site)</label>`,
  foot: `${p.id ? '<button class="btn danger" data-del>Delete</button><span class="grow"></span>' : ''}<button class="btn" data-no>Cancel</button><button class="btn primary" data-yes>Save post</button>` });
  $('[data-pick]', s.el).onclick = () => pickImage((src) => { $('[data-k=cover]', s.el).value = src; });
  $('[data-no]', s.el).onclick = () => s.close();
  if (p.id) $('[data-del]', s.el).onclick = async () => { s.close(); if (await confirmSheet('Delete this post?', esc(p.title), 'Delete', true)) attempt(async () => { await call('posts:remove', p.id); await refreshSite(); }); };
  $('[data-yes]', s.el).onclick = () => attempt(async () => {
    const v = (k) => $(`[data-k=${k}]`, s.el).value;
    await call('posts:save', { id: p.id, title: v('title') || 'Untitled post', date: v('date'), excerpt: v('excerpt'), cover: v('cover'), body: v('body'), author: v('author'), tags: v('tags').split(',').map((x) => x.trim()).filter(Boolean), draft: $('[data-draft]', s.el).checked });
    s.close(); await refreshSite(); toast('Post saved');
  });
}

// ───────── Site settings (SEO, brand, analytics, forms, social)
function panelSite(host) {
  const st = S.site.settings; const a = st.analytics || {}; const f = st.forms || {}; const so = st.social || {};
  const inp = (k, label, ph = '', val) => `<div class="field"><label>${label}</label><input class="input sm" data-s="${k}" value="${esc(val ?? st[k] ?? '')}" placeholder="${esc(ph)}"></div>`;
  host.innerHTML = head('Site settings') + `<div class="pane">
    <div class="group"><div class="group-title">Brand</div>${inp('name', 'Site name')}${inp('tagline', 'Tagline', 'A short line about what you do')}
      <div class="field"><label>Logo</label><div class="row"><input class="input sm grow" data-s="logo" value="${esc(st.logo)}" placeholder="Uses the site name when empty"><button class="btn xs" data-pick="logo">Choose…</button></div></div>
      <div class="field"><label>Favicon</label><div class="row"><input class="input sm grow" data-s="favicon" value="${esc(st.favicon)}"><button class="btn xs" data-pick="favicon">Choose…</button></div></div></div>
    <div class="group"><div class="group-title">Search & sharing</div>${inp('url', 'Live address', 'https://www.example.com')}
      <div class="field"><label>Description</label><textarea class="input sm" rows="3" data-s="description" placeholder="Used when a page has no description">${esc(st.description)}</textarea></div>
      <div class="field"><label>Share image</label><div class="row"><input class="input sm grow" data-s="ogImage" value="${esc(st.ogImage)}" placeholder="1200×630"><button class="btn xs" data-pick="ogImage">Choose…</button></div></div>
      <div class="field"><label>Business type (structured data)</label><select class="select sm" data-s="schema">${['Organization', 'LocalBusiness', 'Restaurant', 'ProfessionalService', 'Store', 'Person', 'none'].map((x) => `<option ${st.schema === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      ${inp('phone', 'Phone')}${inp('email', 'Email')}${inp('address', 'Address')}${inp('lang', 'Language code', 'en')}</div>
    <div class="group"><div class="group-title">Analytics & tracking</div>
      <div class="field"><label>Google Analytics 4</label><input class="input sm" data-a="ga4" value="${esc(a.ga4)}" placeholder="G-XXXXXXX"></div>
      <div class="field"><label>Google Tag Manager</label><input class="input sm" data-a="gtm" value="${esc(a.gtm)}" placeholder="GTM-XXXXXX"></div>
      <div class="field"><label>Meta Pixel</label><input class="input sm" data-a="metaPixel" value="${esc(a.metaPixel)}" placeholder="Pixel ID"></div>
      <div class="field"><label>Plausible</label><input class="input sm" data-a="plausible" value="${esc(a.plausible)}" placeholder="yourdomain.com"></div>
      <span class="hint">Added to exported and published sites only, never to the preview.</span></div>
    <div class="group"><div class="group-title">Forms</div>
      <div class="field"><label>Send form messages with</label><select class="select sm" data-f="provider">${[['formspree', 'Formspree (or any form endpoint)'], ['netlify', 'Netlify Forms'], ['mailto', 'The visitor’s email app'], ['wordpress', 'WordPress (on the WordPress export)']].map(([v, n]) => `<option value="${v}" ${f.provider === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="field"><label>Form endpoint</label><input class="input sm" data-f="endpoint" value="${esc(f.endpoint)}" placeholder="https://formspree.io/f/…"></div>
      <div class="field"><label>Email (for “email app”)</label><input class="input sm" data-f="email" value="${esc(f.email)}"></div>
      <span class="hint">The WordPress export always emails the site admin unless you set an endpoint.</span></div>
    <div class="group"><div class="group-title">Social profiles</div>${['instagram', 'facebook', 'x', 'linkedin', 'youtube', 'tiktok', 'github'].map((k) => `<div class="kv"><label>${k}</label><input class="input sm" data-so="${k}" value="${esc(so[k] || '')}" placeholder="https://…"></div>`).join('')}</div>
    <div class="group"><div class="group-title">Behaviour</div><label class="chk"><input type="checkbox" data-reveal ${st.reveal !== false ? 'checked' : ''}> Scroll animations</label></div>
  </div>`;
  const save = (patch) => attempt(async () => { await call('settings:site', patch); await refreshSite(); });
  $$('[data-s]', host).forEach((i) => i.onchange = () => save({ [i.dataset.s]: i.value.trim() }));
  $$('[data-a]', host).forEach((i) => i.onchange = () => save({ analytics: { [i.dataset.a]: i.value.trim() } }));
  $$('[data-f]', host).forEach((i) => i.onchange = () => save({ forms: { [i.dataset.f]: i.value.trim() } }));
  $$('[data-so]', host).forEach((i) => i.onchange = () => save({ social: { [i.dataset.so]: i.value.trim() } }));
  $('[data-reveal]', host).onchange = (e) => save({ reveal: e.target.checked });
  $$('[data-pick]', host).forEach((b) => b.onclick = () => pickImage((src) => save({ [b.dataset.pick]: src })));
}

// ───────── Code (site-wide)
function panelCode(host) {
  const st = S.site.settings;
  host.innerHTML = head('Custom code') + `<div class="pane"><p class="hint" style="margin:0">Site-wide additions. Section code lives with each section (double-click a layer).</p>
    <div class="field"><label>Global CSS (not scoped)</label><textarea class="input mono" rows="9" data-k="customCss" spellcheck="false">${esc(S.site.customCss)}</textarea></div>
    <div class="field"><label>Global JavaScript</label><textarea class="input mono" rows="6" data-k="customJs" spellcheck="false">${esc(S.site.customJs)}</textarea></div>
    <div class="field"><label>Code in &lt;head&gt;</label><textarea class="input mono" rows="5" data-k="headCode" spellcheck="false" placeholder="Verification tags, fonts, scripts…">${esc(st.headCode)}</textarea></div>
    <div class="field"><label>Code before &lt;/body&gt; (export only)</label><textarea class="input mono" rows="4" data-k="bodyCode" spellcheck="false">${esc(st.bodyCode)}</textarea></div>
    <button class="btn sm primary" data-save>Save code</button></div>`;
  $('[data-save]', host).onclick = () => attempt(async () => { const v = (k) => $(`[data-k=${k}]`, host).value; await call('settings:site', { customCss: v('customCss'), customJs: v('customJs'), headCode: v('headCode'), bodyCode: v('bodyCode') }); await refreshSite(); }, 'Code saved');
}
