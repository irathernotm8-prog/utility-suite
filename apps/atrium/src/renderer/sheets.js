// Atrium — sheets: new site, code editor, export, publish, quality check, versions, phone preview, import.
'use strict';

// ───────── new site
function newSiteSheet() {
  const T = S.lib.templates; let pick = T[0] ? T[0].id : 'blank';
  const s = sheet({ title: 'New site', xwide: true, body: `
    <div class="ai-start"><textarea class="input" id="nsAi" placeholder="Describe the site and let the AI build it — e.g. “A site for Lyte Fiber, a Houston fiber internet provider: plans, a coverage check, support and a blog.”"></textarea><button class="btn primary" id="nsAiGo" style="height:auto">${icon('sparkle', 16)} Build it with AI</button></div>
    <div class="row"><div class="field grow"><label>Name</label><input class="input" id="nsName" placeholder="Your brand or project"></div><div class="field" style="width:260px"><label>Theme</label><select class="select" id="nsPreset"><option value="">The template’s own</option>${S.lib.presets.map((p) => `<option value="${p.id}">${esc(p.name)} · ${p.mode}</option>`).join('')}</select></div></div>
    <div class="group-title">Start from</div>
    <div class="tpl-grid">${T.map((t) => `<button class="tpl ${t.id === pick ? 'on' : ''}" data-t="${t.id}"><div class="tpl-thumb"><iframe data-tpl="${t.id}" tabindex="-1" loading="lazy"></iframe></div><div class="tpl-meta"><b>${esc(t.name)}</b><span>${esc(t.description)}</span><span class="tiny">${t.pages.map((p) => esc(p.title)).join(' · ')}${t.posts ? ` · ${plural(t.posts, 'post')}` : ''}</span></div></button>`).join('')}<button class="tpl" data-t="blank"><div class="tpl-thumb blank">${icon('plus', 28)}</div><div class="tpl-meta"><b>Blank</b><span>A header, a hero and a footer. Build the rest yourself or with the AI.</span></div></button></div>`,
  foot: '<button class="btn" data-no>Cancel</button><button class="btn primary" data-yes>Create site</button>' });
  $$('iframe[data-tpl]', s.el).forEach(async (f) => { f.src = (await call('library:previewUrl', f.dataset.tpl)) + '?tpl=1'; });
  $$('[data-t]', s.el).forEach((b) => b.onclick = () => { pick = b.dataset.t; $$('[data-t]', s.el).forEach((x) => x.classList.toggle('on', x === b)); });
  $('[data-no]', s.el).onclick = () => s.close();
  const create = async (template, ai) => {
    const name = $('#nsName', s.el).value.trim() || (ai ? 'New site' : (T.find((t) => t.id === template) || {}).name || 'New site');
    const r = await attempt(() => call('sites:create', { name, template, preset: $('#nsPreset', s.el).value || undefined })); if (!r) return;
    s.close(); await openSite(r.dir);
    if (ai) sendChat(`${ai}\n\n(This is a fresh site called "${name}" — replace the starter content completely: pick a fitting theme with set_theme, build every page with specific copy, and screenshot desktop + phone as you go.)`);
  };
  $('[data-yes]', s.el).onclick = () => create(pick);
  $('#nsAiGo', s.el).onclick = () => { const v = $('#nsAi', s.el).value.trim(); if (!v) { $('#nsAi', s.el).focus(); return; } create('blank', v); };
}

// ───────── code editor (html / css / js of one section) with highlighting
function hl(code, lang) {
  const e = esc(code);
  if (lang === 'html') return e.replace(/(&lt;!--[\s\S]*?--&gt;)|(&lt;\/?)([\w-]+)((?:\s+[\w:-]+(?:=(?:&quot;[^&]*?&quot;|'[^']*'|[^\s&]+))?)*)\s*(\/?&gt;)/g, (m, com, open, tag, attrs, close) => com ? `<span class="tk-com">${com}</span>` : `<span class="tk-tag">${open}${tag}</span>${attrs.replace(/([\w:-]+)(=)(&quot;[^&]*?&quot;)?/g, '<span class="tk-attr">$1</span>$2<span class="tk-str">$3</span>')}<span class="tk-tag">${close}</span>`);
  if (lang === 'css') return e.replace(/(\/\*[\s\S]*?\*\/)|([^{}\n;]+)(\{)|([\w-]+)(\s*:)|(#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw|s|ms|deg)?\b)|(var\([^)]*\))/g, (m, com, sel, br, prop, col, num, v) => com ? `<span class="tk-com">${com}</span>` : sel ? `<span class="tk-sel">${sel}</span>${br}` : prop ? `<span class="tk-prop">${prop}</span>${col}` : num ? `<span class="tk-num">${num}</span>` : `<span class="tk-fn">${v}</span>`);
  return e.replace(/(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(&quot;[^&]*?&quot;|'[^'\n]*'|`[^`]*`)|\b(const|let|var|function|return|if|else|for|while|of|in|new|this|true|false|null|addEventListener|querySelector|querySelectorAll)\b|\b(\d+)\b/g, (m, com, str, kw, num) => com ? `<span class="tk-com">${com}</span>` : str ? `<span class="tk-str">${str}</span>` : kw ? `<span class="tk-kw">${kw}</span>` : `<span class="tk-num">${num}</span>`);
}
function codeEditor(value, lang, onChange) {
  const w = document.createElement('div'); w.className = 'code-wrap'; w.innerHTML = '<pre></pre><textarea spellcheck="false"></textarea>';
  const pre = $('pre', w), ta = $('textarea', w); ta.value = value;
  const paint = () => { pre.innerHTML = hl(ta.value, lang) + '\n'; pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; };
  ta.oninput = () => { paint(); onChange && onChange(ta.value); }; ta.onscroll = () => { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; };
  ta.onkeydown = (e) => {
    if (e.key === 'Tab') { e.preventDefault(); const a = ta.selectionStart, b = ta.selectionEnd; ta.setRangeText('  ', a, b, 'end'); ta.oninput(); }
    if (e.key === 'Enter') { const a = ta.selectionStart; const line = ta.value.slice(0, a).split('\n').pop(); const ind = (/^\s*/.exec(line) || [''])[0] + (/[{>]\s*$/.test(line) && !/<\//.test(line.slice(-6)) ? '  ' : ''); e.preventDefault(); ta.setRangeText('\n' + ind, a, ta.selectionEnd, 'end'); ta.oninput(); }
  };
  paint(); return { el: w, get: () => ta.value, set: (v) => { ta.value = v; paint(); }, focus: () => ta.focus() };
}
function openCode(id) {
  const f = findSec(id); if (!f) return; const sec = f.sec; let tab = 'html'; const vals = { html: sec.html, css: sec.css, js: sec.js || '' };
  const body = document.createElement('div'); body.style.cssText = 'display:flex;flex-direction:column;gap:10px;flex:1;min-height:0';
  body.innerHTML = `<div class="row"><div class="seg code-tabs"><button data-tab="html" class="on">HTML</button><button data-tab="css">CSS</button><button data-tab="js">JS</button></div><span class="tiny muted grow">${'CSS is scoped to this section: <code>&amp;</code> is the section itself. Use theme tokens like <code>var(--at-primary)</code>.'}</span><span class="code-warn" data-warn></span></div>`;
  const ed = codeEditor(vals.html, 'html', (v) => { vals[tab] = v; check(); }); body.appendChild(ed.el);
  const s = sheet({ title: `Code · ${esc(sec.name)}`, xwide: true, body, foot: `<button class="btn" data-ai>${icon('sparkle', 14)} Ask AI to change it</button><span class="grow"></span><span class="tiny muted">⌘S applies</span><button class="btn" data-no>Close</button><button class="btn primary" data-yes>Apply</button>` });
  s.body.style.display = 'flex';
  let ct; const check = () => { clearTimeout(ct); ct = setTimeout(async () => { const w = await call('sections:check', { html: vals.html, css: vals.css }); $('[data-warn]', s.el).textContent = w.join(' '); }, 300); };
  $$('[data-tab]', s.el).forEach((b) => b.onclick = () => { tab = b.dataset.tab; $$('[data-tab]', s.el).forEach((x) => x.classList.toggle('on', x === b)); const n = codeEditor(vals[tab], tab, (v) => { vals[tab] = v; check(); }); ed.el.replaceWith(n.el); Object.assign(ed, n); n.focus(); });
  const apply = () => attempt(async () => { const w = await call('sections:check', { html: vals.html, css: vals.css }); if (w.length && !(await confirmSheet('Apply anyway?', esc(w.join(' ')), 'Apply'))) return; await call('sections:update', id, { html: vals.html, css: vals.css, js: vals.js }); await refreshSite(); toast('Applied'); });
  $('[data-yes]', s.el).onclick = apply; $('[data-no]', s.el).onclick = () => s.close();
  $('[data-ai]', s.el).onclick = () => { s.close(); S.sel = { id, path: [] }; setRtab('ai'); $('#chatText') && $('#chatText').focus(); };
  s.el.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); apply(); } });
  setTimeout(() => ed.focus(), 50); check();
}

// ───────── export
function exportSheet() {
  const F = S.lib.formats; let fmt = 'static';
  const s = sheet({ title: 'Export', wide: true, body: `<div class="prov-list" style="grid-template-columns:1fr 1fr">${F.map((f) => `<div class="prov ${f.id === fmt ? 'on' : ''}" data-f="${f.id}" style="align-items:flex-start;flex-direction:column;gap:4px"><b>${icon({ static: 'globe', wordpress: 'wordpress', embed: 'code', weebly: 'layers', single: 'file', backup: 'archive' }[f.id] || 'file', 15)} ${esc(f.name)}</b><span class="tiny muted">${esc(f.blurb)}</span></div>`).join('')}</div>
    <div class="row" data-opts style="flex-wrap:wrap;gap:14px"><label class="chk" data-zipw><input type="checkbox" data-zip> One .zip file</label><div class="row" data-basew hidden><span class="small">Asset address</span><input class="input sm" style="width:300px" data-base placeholder="https://cdn.example.com (optional)"></div><label class="chk"><input type="checkbox" data-ask> Choose where to save</label></div>
    <div data-result></div>`, foot: '<button class="btn" data-no>Close</button><button class="btn primary" data-yes>Export</button>' });
  const sync = () => { $('[data-zipw]', s.el).style.display = ['static', 'single', 'embed', 'weebly'].includes(fmt) ? '' : 'none'; $('[data-basew]', s.el).hidden = fmt !== 'embed'; };
  $$('[data-f]', s.el).forEach((b) => b.onclick = () => { fmt = b.dataset.f; $$('[data-f]', s.el).forEach((x) => x.classList.toggle('on', x === b)); sync(); }); sync();
  $('[data-no]', s.el).onclick = () => s.close();
  $('[data-yes]', s.el).onclick = async () => {
    const btn = $('[data-yes]', s.el); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Exporting…';
    try {
      const r = await call('export:run', fmt, { zip: $('[data-zip]', s.el).checked, assetBase: $('[data-base]', s.el).value.trim() || undefined, ask: $('[data-ask]', s.el).checked });
      if (!r) return;
      $('[data-result]', s.el).innerHTML = `<div class="card" style="gap:8px"><b>${icon('check', 15)} Exported ${plural(r.count, 'file')}</b><code class="ellip">${esc(tildify(r.path))}</code>${(r.notes || []).map((n) => `<span class="hint">${esc(n)}</span>`).join('')}<div class="row"><button class="btn sm" data-reveal>Show in Finder</button>${r.index ? '<button class="btn sm" data-openi>Open in browser</button>' : ''}${r.theme ? '<button class="btn sm" data-howto>How to install on WordPress</button>' : ''}</div></div>`;
      $('[data-reveal]', s.el).onclick = () => call('shell:reveal', r.theme || r.path);
      if ($('[data-openi]', s.el)) $('[data-openi]', s.el).onclick = () => call('shell:open', r.index);
      if ($('[data-howto]', s.el)) $('[data-howto]', s.el).onclick = () => call('shell:open', r.path + '/HOW TO INSTALL.txt');
    } catch (e) { fail(e); } finally { btn.disabled = false; btn.textContent = 'Export'; }
  };
}

// ───────── publish
async function publishSheet() {
  const st = await call('publish:status'); const pub = st.published || {};
  const s = sheet({ title: 'Publish', wide: true, body: `
    <div class="card"><h3>${icon('globe', 16)} Netlify</h3><p class="sub">Free hosting with HTTPS. Uses a personal access token (Netlify › User settings › Applications).</p>
      ${pub.netlify ? `<div class="row"><span class="pill ok">Live</span><a class="link-btn" data-open="${esc(pub.netlify.url)}">${esc(pub.netlify.url)}</a><span class="tiny muted">${ago(pub.netlify.at)}</span></div>` : ''}
      <div class="row">${st.netlify ? `<button class="btn primary" data-net>${pub.netlify ? 'Publish update' : 'Publish to Netlify'}</button>` : '<input class="input sm grow" type="password" data-tok placeholder="Paste a Netlify token"><button class="btn sm" data-savetok>Save token</button>'}</div></div>
    <div class="card"><h3>${icon('code', 16)} GitHub Pages</h3><p class="sub">Uses the GitHub CLI already signed in on this computer${st.gh ? '' : ' (not found — install it with <code>brew install gh</code> and run <code>gh auth login</code>)'}. Creates a public repository and publishes it at your-name.github.io/repo.</p>
      ${pub.github ? `<div class="row"><span class="pill ok">Live</span><a class="link-btn" data-open="${esc(pub.github.url)}">${esc(pub.github.url)}</a><span class="tiny muted">${ago(pub.github.at)}</span></div>` : ''}
      <div class="row"><input class="input sm" style="width:240px" data-repo value="${esc((pub.github && pub.github.repo) || '')}" placeholder="Repository name (default: site name)"><button class="btn ${st.gh ? 'primary' : ''}" data-gh ${st.gh && st.git ? '' : 'disabled'}>${pub.github ? 'Publish update' : 'Publish to GitHub Pages'}</button></div></div>
    <div class="card"><h3>${icon('wordpress', 16)} WordPress, Weebly, Wix, Squarespace…</h3><p class="sub">Export the site in their format and upload it there.</p><div class="row"><button class="btn sm" data-exp>Open Export…</button></div></div>
    <div data-log class="hint"></div>`, foot: '<button class="btn" data-no>Close</button>' });
  $('[data-no]', s.el).onclick = () => s.close();
  $$('[data-open]', s.el).forEach((a) => a.onclick = () => call('shell:open', a.dataset.open));
  $('[data-exp]', s.el).onclick = () => { s.close(); exportSheet(); };
  if ($('[data-savetok]', s.el)) $('[data-savetok]', s.el).onclick = async () => { await call('settings:netlify', $('[data-tok]', s.el).value); s.close(); publishSheet(); };
  const off = A.on('publish:step', (m) => { const l = $('[data-log]', s.el); if (l) l.textContent = m; });
  const run = async (btn, fn) => { btn.disabled = true; const t = btn.textContent; btn.innerHTML = '<span class="spin"></span> Publishing…'; try { const r = await fn(); toast('Published', r.url, 'ok', 9000); s.close(); off(); publishSheet(); } catch (e) { fail(e); } finally { btn.disabled = false; btn.textContent = t; } };
  if ($('[data-net]', s.el)) $('[data-net]', s.el).onclick = (e) => run(e.currentTarget, () => call('publish:netlify'));
  $('[data-gh]', s.el).onclick = (e) => run(e.currentTarget, () => call('publish:github', $('[data-repo]', s.el).value.trim() || undefined));
}

// ───────── quality check
async function auditSheet() {
  const s = sheet({ title: 'Quality check', wide: true, body: '<div class="empty"><span class="spin"></span><b>Checking every page on desktop and phone…</b><span>SEO, accessibility, contrast measured on the rendered pages, mobile layout, links and image weight.</span></div>', foot: '<button class="btn" data-ai disabled>' + icon('sparkle', 14) + ' Fix these with AI</button><span class="grow"></span><button class="btn" data-no>Close</button>' });
  $('[data-no]', s.el).onclick = () => s.close();
  try {
    const r = await call('audit:run', 'all');
    const col = (n) => (n >= 90 ? 'var(--ok)' : n >= 70 ? 'var(--warn)' : 'var(--bad)');
    const row = (i, page) => `<div class="issue" data-sec="${esc(i.section || '')}" data-page="${esc(page || '')}"><span class="lvl ${i.level}"></span><div class="grow"><div>${esc(i.msg)}${i.sectionName ? ` <span class="tiny muted">· ${esc(i.sectionName)}</span>` : ''}</div>${i.fix ? `<div class="fix">${esc(i.fix)}</div>` : ''}</div><span class="pill">${esc(i.kind)}</span></div>`;
    s.body.innerHTML = `<div class="score"><div class="score-ring" style="--p:${r.score};--c:${col(r.score)}"><b>${r.score}</b></div><div><b style="font-size:15px">${r.score >= 90 ? 'Looking great' : r.score >= 70 ? 'Good, with a few things to fix' : 'Worth a pass before you publish'}</b><div class="hint">${r.pages.map((p) => `${esc(p.page)} ${p.score}`).join(' · ')}</div></div></div>
      ${r.site.length ? `<div class="group-title">Site</div>${r.site.map((i) => row(i)).join('')}` : ''}
      ${r.pages.map((p) => `<div class="group-title">${esc(p.page)} <span class="muted">· ${p.counts.error || 0} errors, ${p.counts.warn || 0} warnings</span></div>${p.issues.map((i) => row(i, p.page)).join('') || '<div class="hint">No issues.</div>'}`).join('')}`;
    $$('.issue', s.body).forEach((el) => el.onclick = async () => { if (!el.dataset.sec) return; s.close(); if (el.dataset.page && el.dataset.page !== S.page) { S.pendingScroll = el.dataset.sec; await setPage(el.dataset.page); } selectSection(el.dataset.sec); });
    const b = $('[data-ai]', s.el); b.disabled = false; b.onclick = () => { s.close(); sendChat('Run audit on the whole site and fix the errors and warnings (contrast, mobile overflow, missing alt text, SEO descriptions, broken links). Screenshot what you change.'); };
  } catch (e) { s.body.innerHTML = `<div class="empty"><b>The check didn’t finish</b><span>${esc(e.message)}</span></div>`; }
}

// ───────── versions
async function historySheet() {
  const v = await call('site:versions');
  const s = sheet({ title: 'Versions', body: `<p class="hint" style="margin:0">Atrium saves a version every time the AI changes something, and every few minutes while you edit. Restoring saves the current state first.</p>${v.map((x) => `<div class="ver"><span data-icon="${/you/i.test(x.by) ? 'user' : 'sparkle'}" data-size="15"></span><div class="grow"><div>${esc(x.label)}</div><div class="tiny muted">${new Date(x.at).toLocaleString()} · ${esc(byWho(x.by))}</div></div><button class="btn xs" data-r="${x.id}">Restore</button></div>`).join('') || '<div class="empty">No versions yet.</div>'}`, foot: '<button class="btn" data-no>Close</button>' });
  $('[data-no]', s.el).onclick = () => s.close();
  $$('[data-r]', s.el).forEach((b) => b.onclick = async () => { if (await confirmSheet('Restore this version?', 'The site goes back to how it was then. The current state is saved first, so you can come back.', 'Restore')) attempt(async () => { await call('site:restore', b.dataset.r); s.close(); await refreshSite(); await loadFrame(); toast('Version restored'); }); });
}

// ───────── phone preview
async function phoneSheet() {
  const info = await call('preview:lan', true);
  const qr = (rows) => { const n = rows.length; let d = ''; rows.forEach((r, y) => { for (let x = 0; x < n; x++) if (r[x] === '1') d += `M${x} ${y}h1v1h-1z`; }); return `<svg viewBox="-1 -1 ${n + 2} ${n + 2}" shape-rendering="crispEdges"><path d="${d}" fill="#111"/></svg>`; };
  const s = sheet({ title: 'Preview on your phone', body: info.url ? `<div class="row" style="gap:20px;align-items:flex-start"><div class="qr">${qr(info.qr)}</div><div class="col"><b>Scan with your phone’s camera</b><span class="hint">Your phone needs to be on the same Wi-Fi. The page updates live as you or the AI edit.</span><code style="user-select:all">${esc(info.url)}</code><span class="hint">On Windows, allow Atrium on private networks if the firewall asks.</span><div data-visits class="hint"></div></div></div>` : `<div class="empty"><b>No network</b><span>${esc(info.note || 'Connect to Wi-Fi to preview on a phone.')}</span></div>`,
  foot: '<button class="btn" data-off>Stop sharing</button><button class="btn primary" data-no>Done</button>' });
  $('[data-no]', s.el).onclick = () => s.close();
  $('[data-off]', s.el).onclick = async () => { await call('preview:lan', false); s.close(); toast('Phone preview off'); };
  const off = A.on('lan:visit', (v) => { const el = $('[data-visits]', s.el); if (el) el.textContent = `Opened on a device ${ago(v.at)}: ${v.path}`; else off(); });
}

// ───────── import
async function importSheet() {
  const s = sheet({ title: 'Import a website', body: `<p style="margin:0;color:var(--fg-2)">Bring in an existing static site — a folder of .html files, one .html file, or an Atrium backup (.atrium). Each page’s blocks become sections you can edit; the first page’s header and footer become the shared ones.</p>
    <div class="row"><button class="btn" data-folder>${icon('folder', 15)} Choose a folder…</button><button class="btn" data-file>${icon('file', 15)} Choose a file…</button></div>
    <div class="group-title">Or rebuild a live site with AI</div><div class="row"><input class="input grow" data-url placeholder="https://www.example.com"><button class="btn primary" data-ai>${icon('sparkle', 14)} Rebuild</button></div><span class="hint">The AI reads the site (text, structure, colours, fonts, screenshots) and rebuilds it here as a modern Atrium site you can export anywhere.</span>`, foot: '<button class="btn" data-no>Cancel</button>' });
  $('[data-no]', s.el).onclick = () => s.close();
  const go = async (p) => { if (!p) return; const t = toast('Importing…', p, 'busy', 0); try { const r = await call('import:run', p); s.close(); await openSite(r.dir); toast('Imported', `${r.pages.length} pages`); } catch (e) { fail(e); } finally { t.remove(); } };
  $('[data-folder]', s.el).onclick = async () => { const f = await call('dialog:folder'); go(f); };
  $('[data-file]', s.el).onclick = async () => { const f = await call('dialog:files', { filters: [{ name: 'Website', extensions: ['html', 'htm', 'atrium', 'zip'] }] }); go(f && f[0]); };
  $('[data-ai]', s.el).onclick = async () => { const u = $('[data-url]', s.el).value.trim(); if (!/^https?:\/\//.test(u)) { toast('Give a full address', 'Starting with https://', 'info'); return; } s.close(); let host = u; try { host = new URL(u).hostname.replace(/^www\./, ''); } catch {} const r = await attempt(() => call('sites:create', { name: host, template: 'blank' })); if (!r) return; await openSite(r.dir); sendChat(`Rebuild ${u} here as a modern, premium site. Use fetch_url on the home page and its main pages to get the content, structure, colours and fonts; keep their real copy and information; set a matching theme; build every page; then screenshot desktop and phone and polish.`); };
}
