// A job: live steps and stats on the left; results on the right (files with a code viewer, an
// overview of the file, and a search across everything that came out).
'use strict';

const JV = { tab: 'overview', expanded: new Set(), selected: null, viewer: null, snap: null, overview: null, lastStatus: null, search: { q: '', regex: false, cs: false, res: null } };

const STEP_IC = { done: 'check', failed: 'x', cancelled: 'x', needs: 'download', skipped: 'chevron', waiting: 'clock' };
function stepHtml(s) {
  const ic = s.state === 'running' ? '<span class="spin" style="width:13px;height:13px"></span>' : icon(STEP_IC[s.state] || 'clock', 12);
  const dur = s.startedAt ? fmtDur((s.endedAt || Date.now()) - s.startedAt) : '';
  return `<div class="step ${s.state}${s.depth ? ' sub' : ''}" data-step="${s.id}"><span class="st-ic">${ic}</span><div style="min-width:0">
    <div class="st-title">${esc(s.title)}</div>${s.detail ? `<div class="st-detail">${esc(s.detail)}</div>` : ''}
    ${s.state === 'running' ? `<div class="bar ${s.progress == null ? 'indet' : ''}"><i style="width:${Math.round((s.progress || 0) * 100)}%"></i></div>` : ''}
    <div class="st-meta">${s.engine && s.engine !== 'builtin' ? `<span class="tag">${esc(engineName(s.engine))}</span>` : ''}${s.threads ? `<span class="tag thr">${s.threads} thread${s.threads > 1 ? 's' : ''}</span>` : ''}${dur && s.state !== 'waiting' ? `<span class="tiny muted">${dur}</span>` : ''}
    ${s.state === 'needs' && s.needs && !['pycdc', 'innoextract'].includes(s.needs) ? `<button class="btn xs primary" data-need="${s.needs}">${icon('download', 13)}Get ${esc(engineName(s.needs))}</button>` : ''}</div></div></div>`;
}
const engineName = (id) => (S.engines.engines.find((e) => e.id === id) || { name: { builtin: 'Built in', pycdc: 'pycdc', python: 'Python', innoextract: 'innoextract' }[id] || id }).name;

VIEWS.job = {
  flush: true,
  head() {
    const j = S.jobs.find((x) => x.id === S.jobId) || JV.snap;
    if (!j) return '<h1>Job</h1>';
    return `<button class="icon-btn" id="jBack" title="Back">${icon('back')}</button>${kindIcon(j.family, 'sm')}<h1><span class="ellip">${esc(j.name)}</span> <small>${esc(j.label)}</small></h1><span id="jPill">${statusPill(j.status)}</span>`;
  },
  actions() {
    const j = S.jobs.find((x) => x.id === S.jobId) || JV.snap; if (!j) return '';
    return `<button class="btn sm" id="jFolder">${icon('folderOpen', 15)}Open folder</button>${j.status === 'running' ? `<button class="btn sm danger" id="jStop">${icon('stop', 14)}Stop</button>` : `<button class="btn sm" id="jAgain">${icon('refresh', 15)}Run again</button>`}`;
  },
  async render(el) {
    let j = S.jobs.find((x) => x.id === S.jobId);
    if (!j) { try { j = await call('job:get', S.jobId); } catch {} }
    if (!j) { el.innerHTML = '<div class="empty">This job is gone.</div>'; return; }
    if (!JV.snap || JV.snap.id !== j.id) { JV.expanded = new Set(); JV.selected = null; JV.overview = null; JV.search.res = null; JV.tab = j.status === 'running' ? 'overview' : 'files'; }
    JV.snap = j; JV.lastStatus = j.status;
    el.innerHTML = `<div class="jv"><div class="jv-left"><div class="jv-stats" id="jStats"></div><div class="steps" id="jSteps"></div></div>
      <div class="jv-right"><div class="tabs"><div class="seg" id="jTabs">${[['overview', 'Overview'], ['files', 'Files'], ['search', 'Search']].map(([k, l]) => `<button data-tab="${k}" class="${JV.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div><span class="tiny muted ellip" style="max-width:40%" title="${esc(j.outDir)}">${esc(j.outDir)}</span></div><div class="tab-body" id="jBody"></div></div></div>`;
    $('#jBack').onclick = () => go('jobs');
    $('#jFolder').onclick = () => call('shell:open', j.outDir);
    const stop = $('#jStop'); if (stop) stop.onclick = () => call('job:cancel', j.id);
    const again = $('#jAgain'); if (again) again.onclick = async () => { try { const s = await call('job:rerun', j.id); upsertJob(s); go('job', s.id); } catch (e) { fail(e); } };
    $$('#jTabs button').forEach((b) => b.onclick = () => { JV.tab = b.dataset.tab; $$('#jTabs button').forEach((x) => x.classList.toggle('on', x === b)); drawTab(); });
    drawStats(j); drawSteps(j); drawTab();
  },
};

function drawStats(j) {
  const el = $('#jStats'); if (!el) return;
  const t = j.startedAt ? (j.endedAt || Date.now()) - j.startedAt : 0;
  const running = j.steps.filter((s) => s.state === 'running');
  const threadsNow = running.reduce((a, s) => a + (s.threads || 0), 0);
  el.innerHTML = `<div class="row"><b class="grow">${j.status === 'running' ? `${Math.round(j.progress * 100)}%` : j.status === 'done' ? 'Finished' : j.status === 'failed' ? 'Failed' : 'Stopped'}</b><span class="small muted">${j.steps.filter((s) => s.state === 'done').length} of ${j.steps.filter((s) => s.state !== 'skipped').length} steps</span></div>
    <div class="bar big-bar ${j.status === 'running' && !j.progress ? 'indet' : ''}"><i style="width:${Math.round((j.status === 'done' ? 1 : j.progress) * 100)}%"></i></div>
    <div class="stat-grid">
      <div class="stat"><div class="k">Time</div><div class="v" id="jTime">${fmtDur(t)}</div></div>
      <div class="stat"><div class="k">Sources</div><div class="v">${(j.stats.sources || 0).toLocaleString()}</div></div>
      <div class="stat"><div class="k">Items</div><div class="v">${(j.stats.units || 0).toLocaleString()}</div></div>
      <div class="stat"><div class="k">${j.status === 'running' ? 'Threads' : 'Peak'}</div><div class="v" id="jThreads">${j.status === 'running' ? (S.sample ? S.sample.threadsInUse : threadsNow) : (j.stats.peakThreads || '—')}</div></div>
    </div>
    ${j.error ? `<div class="note">${icon('alert', 16)}<div>${esc(j.error)}</div></div>` : ''}
    ${j.needs && j.needs.filter((n) => !['pycdc', 'innoextract'].includes(n)).length && j.status !== 'running' ? `<div class="note">${icon('download', 16)}<div class="grow">Some parts need ${j.needs.filter((n) => !['pycdc', 'innoextract'].includes(n)).map(engineName).join(', ')}. Get ${j.needs.length > 1 ? 'them' : 'it'}, then run again.</div><button class="btn xs primary" id="jGetAll">Get & run again</button></div>` : ''}`;
  const g = $('#jGetAll'); if (g) g.onclick = async () => { g.disabled = true; g.innerHTML = '<span class="spin"></span>'; try { await call('engines:install', j.needs.filter((n) => !['pycdc', 'innoextract'].includes(n))); await loadEngines(); const s = await call('job:rerun', j.id); upsertJob(s); go('job', s.id); } catch (e) { fail(e); g.disabled = false; } };
}
function drawSteps(j) {
  const el = $('#jSteps'); if (!el) return;
  const top = el.scrollTop;
  el.innerHTML = j.steps.map(stepHtml).join('') || '<div class="empty small">Starting…</div>';
  el.scrollTop = top;
  $$('[data-need]', el).forEach((b) => b.onclick = async () => { b.disabled = true; b.innerHTML = '<span class="spin"></span>Getting'; try { await call('engines:install', [b.dataset.need]); await loadEngines(); toast(`${engineName(b.dataset.need)} is ready`, 'Run the job again to use it.'); drawSteps(JV.snap); } catch (e) { fail(e); b.disabled = false; } });
}
window.updateJobView = (snap) => {
  JV.snap = snap;
  drawStats(snap); drawSteps(snap);
  if (JV.lastStatus !== snap.status) {
    JV.lastStatus = snap.status;
    $('#jPill') && ($('#jPill').innerHTML = statusPill(snap.status));
    $('#headRight').innerHTML = VIEWS.job.actions(); hydrateIcons($('#headRight'));
    $('#jFolder').onclick = () => call('shell:open', snap.outDir);
    const again = $('#jAgain'); if (again) again.onclick = async () => { const s = await call('job:rerun', snap.id); upsertJob(s); go('job', s.id); };
    const stop = $('#jStop'); if (stop) stop.onclick = () => call('job:cancel', snap.id);
    if (snap.status !== 'running') { JV.overview = null; drawTab(); }
  } else if (JV.tab === 'files' && snap.status === 'running') { throttleTree(); }
  else if (JV.tab === 'overview' && !JV.overview) { drawTab(); }
};
window.onSample = (s) => { if (S.view === 'job' && JV.snap && JV.snap.status === 'running') { const t = $('#jThreads'); if (t) t.textContent = s.threadsInUse; const tm = $('#jTime'); if (tm) tm.textContent = fmtDur(Date.now() - JV.snap.startedAt); } };
let treeTimer = null; function throttleTree() { if (treeTimer) return; treeTimer = setTimeout(() => { treeTimer = null; if (JV.tab === 'files') drawTree(); }, 2500); }

// ───────── tabs
function drawTab() {
  const body = $('#jBody'); if (!body) return;
  $$('#jTabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === JV.tab));
  if (JV.tab === 'files') return drawFiles(body);
  if (JV.tab === 'search') return drawSearch(body);
  return drawOverview(body);
}

// files
function drawFiles(body) {
  body.innerHTML = `<div class="files"><div class="tree" id="jTree"></div><div class="viewer" id="jViewer"><div class="vempty">${icon('code', 30)}<div>Pick a file on the left.<br><span class="small">Decompiled code is in <b>Source</b>; everything that was inside is in <b>Unpacked</b>.</span></div></div></div></div>`;
  drawTree();
  if (JV.selected) openFile(JV.selected.path, JV.selected.line);
}
async function drawTree() {
  const el = $('#jTree'); if (!el || !JV.snap) return;
  const root = JV.snap.outDir;
  let top; try { top = await call('fs:list', root); } catch { el.innerHTML = '<div class="empty small">Nothing written yet.</div>'; return; }
  const order = { Source: 0, Unpacked: 1, Analysis: 2 };
  top.sort((a, b) => (order[a.name] ?? 5) - (order[b.name] ?? 5));
  if (!JV.expanded.size) for (const d of top) if (d.dir && d.name === 'Source') JV.expanded.add(d.path);
  const lines = [];
  const rec = async (items, depth) => {
    for (const it of items) {
      const open = it.dir && JV.expanded.has(it.path);
      lines.push(`<div class="tnode ${it.dir ? 'dir' : ''} ${open ? 'open' : ''} ${JV.selected && JV.selected.path === it.path ? 'on' : ''}" data-p="${esc(it.path)}" data-dir="${it.dir ? 1 : ''}" style="padding-left:${6 + depth * 14}px"><span class="tw">${it.dir ? icon('chevron', 12) : ''}</span>${icon(it.dir ? (open ? 'folderOpen' : 'folder') : fileIcon(it.name), 15)}<span class="tname">${esc(it.name)}</span>${!it.dir ? `<span class="tsz">${fmtSize(it.size)}</span>` : ''}</div>`);
      if (open) { let kids = []; try { kids = await call('fs:list', it.path); } catch {} if (kids.length > 2000) { kids = kids.slice(0, 2000); } await rec(kids, depth + 1); }
      if (lines.length > 6000) return;
    }
  };
  await rec(top, 0);
  const sc = el.scrollTop; el.innerHTML = lines.join(''); el.scrollTop = sc;
  $$('.tnode', el).forEach((n) => n.onclick = () => {
    const p = n.dataset.p;
    if (n.dataset.dir) { if (JV.expanded.has(p)) JV.expanded.delete(p); else JV.expanded.add(p); drawTree(); }
    else { JV.selected = { path: p }; $$('.tnode.on', el).forEach((x) => x.classList.remove('on')); n.classList.add('on'); openFile(p); }
  });
}
const fileIcon = (name) => (/\.(png|jpe?g|gif|webp|bmp|ico|svg)$/i.test(name) ? 'image' : /\.(java|kt|cs|c|h|cpp|py|js|mjs|ts|swift|go|rs|smali|wat|gd|lua|dis\.txt)$/i.test(name) ? 'code' : /\.(dll|exe|so|dylib|bin|dex|class|pyc|o)$/i.test(name) ? 'binary' : 'file');

async function openFile(p, line) {
  const v = $('#jViewer'); if (!v) return;
  let r; try { r = await call('fs:read', p); } catch (e) { v.innerHTML = `<div class="vempty">${esc(e.message)}</div>`; return; }
  const rel = p.startsWith(JV.snap.outDir) ? p.slice(JV.snap.outDir.length + 1) : p;
  v.innerHTML = `<div class="vbar"><span class="vpath grow" title="${esc(rel)}">‎${esc(rel)}</span><span class="tiny muted" id="vInfo"></span>
    ${r.kind === 'text' ? `<button class="icon-btn sm ${JV.wrap ? 'on' : ''}" id="vWrap" title="Wrap lines">${icon('wrap', 15)}</button><button class="icon-btn sm" id="vCopy" title="Copy">${icon('copy', 15)}</button>` : ''}
    <button class="icon-btn sm" id="vOpen" title="Open with the default app">${icon('external', 15)}</button><button class="icon-btn sm" id="vReveal" title="Show in folder">${icon('reveal', 15)}</button></div>
    <div class="${r.kind === 'image' ? 'imgview' : 'code'}" id="vCode"></div>`;
  $('#vOpen').onclick = () => call('shell:open', p); $('#vReveal').onclick = () => call('shell:reveal', p);
  const box = $('#vCode');
  if (r.kind === 'image') { box.innerHTML = `<img src="${esc(r.url)}" alt="">`; $('#vInfo').textContent = fmtSize(r.size); return; }
  const cv = new CodeView(box); cv.wrap = !!JV.wrap; JV.viewer = cv;
  if (r.kind === 'hex') { const bin = Uint8Array.from(atob(r.hex), (c) => c.charCodeAt(0)); cv.setHex(bin, r.size); $('#vInfo').textContent = `${r.info ? r.info + ' · ' : ''}${fmtSize(r.size)} · binary`; return; }
  const meta = cv.setText(r.text, baseName(p), { line });
  $('#vInfo').textContent = `${meta.lines.toLocaleString()} lines · ${fmtSize(r.size)}${r.truncated ? ' · first 8 MB' : ''}`;
  $('#vCopy').onclick = () => { navigator.clipboard.writeText(r.text); toast('Copied'); };
  $('#vWrap').onclick = () => { JV.wrap = !JV.wrap; openFile(p, line); };
}

// overview
async function drawOverview(body) {
  const j = JV.snap;
  body.innerHTML = '<div class="ov" id="jOv"><div class="empty"><span class="spin"></span></div></div>';
  if (!JV.overview) { try { JV.overview = await call('job:overview', j.id); } catch {} }
  const ov = JV.overview; const el = $('#jOv'); if (!el) return;
  if (!ov) { el.innerHTML = j.status === 'running' ? `<div class="empty"><span class="spin"></span><span>Inspecting…</span></div>` : `<div class="empty">${icon('folder', 30)}<span>Nothing to show for a folder. Everything Decomp found is under Files.</span></div>`; return; }
  const id = ov.identity; const it = ov.interesting || {};
  const ent = ov.entropy || [];
  const W = 1000, H = 110;
  const pts = ent.map((v, i) => `${(i / Math.max(1, ent.length - 1)) * W},${H - (v / 8) * (H - 6) - 3}`).join(' ');
  const strGroups = [['urls', 'Web addresses'], ['emails', 'Email addresses'], ['ips', 'IP addresses'], ['paths', 'File paths'], ['registry', 'Registry keys'], ['keys', 'Possible API keys']].filter(([k]) => (it[k] || []).length);
  el.innerHTML = `
    <div class="card"><h4>${kindIcon(j.family, 'sm')} ${esc(id.label)} ${id.traits && id.traits.length ? id.traits.map((t) => `<span class="pill">${esc(t)}</span>`).join(' ') : ''}</h4>
      <div class="facts">${factsOf(id).map(([k, v]) => `<div class="fact"><div class="k">${esc(k)}</div><div class="v" title="${esc(v)}">${esc(v)}</div></div>`).join('')}</div></div>
    ${j.notes && j.notes.length ? j.notes.map((n) => `<div class="note">${icon('alert', 16)}<div>${esc(n)}</div></div>`).join('') : ''}
    ${ent.length > 1 ? `<div class="card"><h4>${icon('layers', 15)} Entropy <span class="muted small" style="font-weight:500">average ${ov.avgEntropy} bits/byte · 8 = compressed or encrypted · ${fmtSize(ov.entropyBlock)} blocks</span></h4>
      <svg class="ent" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="eg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--acc)" stop-opacity=".45"/><stop offset="1" stop-color="var(--acc)" stop-opacity="0"/></linearGradient></defs>
      <line x1="0" x2="${W}" y1="${H - (7 / 8) * (H - 6) - 3}" y2="${H - (7 / 8) * (H - 6) - 3}" stroke="var(--line-3)" stroke-dasharray="4 4"/>
      <polygon points="0,${H} ${pts} ${W},${H}" fill="url(#eg)"/><polyline points="${pts}" fill="none" stroke="var(--acc)" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>
      <div class="row tiny muted"><span>0</span><span class="grow"></span><span>${fmtSize(id.size)}</span></div></div>` : ''}
    ${ov.hashes && ov.hashes.sha256 ? `<div class="card"><h4>${icon('hash', 15)} Hashes</h4><div class="hashes">${Object.entries(ov.hashes).map(([k, v]) => `<div><span>${k.toUpperCase()}</span>${v}</div>`).join('')}</div></div>` : ''}
    ${strGroups.length ? `<div class="card"><h4>${icon('globe', 15)} Interesting strings <span class="muted small" style="font-weight:500">from ${ov.stringCount.toLocaleString()} strings · all of them are in Analysis/strings.txt</span></h4>
      ${strGroups.map(([k, l]) => `<div class="label" style="margin:10px 0 4px">${l} <span class="muted">${it[k].length}</span></div><div class="strl">${it[k].slice(0, 150).map((s) => `<div title="${esc(s)}">${esc(s)}</div>`).join('')}</div>`).join('')}</div>` : ''}
    ${ov.signatures && ov.signatures.length ? `<div class="card"><h4>${icon('box', 15)} Embedded files <span class="muted small" style="font-weight:500">${ov.signatures.length} found by signature</span></h4><table class="tbl"><tr><th>Offset</th><th>Looks like</th></tr>${ov.signatures.slice(0, 200).map((s) => `<tr><td class="mono">0x${s.offset.toString(16).padStart(8, '0')}</td><td>${esc(s.type)}</td></tr>`).join('')}</table></div>` : ''}`;
}

// search
function drawSearch(body) {
  const q = JV.search;
  body.innerHTML = `<div class="srch"><div class="srch-bar"><input class="input" id="sQ" placeholder="Search everything that came out — classes, strings, URLs, function names" value="${esc(q.q)}">
    <button class="btn sm ${q.regex ? 'primary' : ''}" id="sRe" title="Regular expression">.*</button><button class="btn sm ${q.cs ? 'primary' : ''}" id="sCs" title="Match case">Aa</button><button class="btn sm primary" id="sGo">${icon('search', 15)}Search</button></div>
    <div class="srch-res" id="sRes">${q.res ? '' : `<div class="empty small">${icon('search', 26)}<span>Searches every text file in Source, Unpacked and Analysis on all worker threads.</span></div>`}</div></div>`;
  const run = async () => {
    q.q = $('#sQ').value.trim(); if (!q.q) return;
    $('#sRes').innerHTML = '<div class="empty"><span class="spin"></span></div>';
    try { q.res = await call('fs:search', { root: JV.snap.outDir, query: q.q, regex: q.regex, cs: q.cs }); drawResults(); } catch (e) { $('#sRes').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  };
  $('#sGo').onclick = run; $('#sQ').onkeydown = (e) => { if (e.key === 'Enter') run(); };
  $('#sRe').onclick = () => { q.regex = !q.regex; drawSearch(body); }; $('#sCs').onclick = () => { q.cs = !q.cs; drawSearch(body); };
  if (q.res) drawResults();
  setTimeout(() => $('#sQ') && $('#sQ').focus(), 30);
}
function drawResults() {
  const q = JV.search, el = $('#sRes'); if (!el || !q.res) return;
  const r = q.res; const by = new Map();
  for (const h of r.results) { if (!by.has(h.file)) by.set(h.file, []); by.get(h.file).push(h); }
  let re; try { re = new RegExp(q.regex ? q.q : q.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), q.cs ? 'g' : 'gi'); } catch { re = null; }
  const mark = (t) => { const e = escHtml(t); if (!re) return e; return e.replace(new RegExp(re.source.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'), re.flags), (m) => `<mark>${m}</mark>`); };
  el.innerHTML = `<div class="tiny muted" style="padding:6px">${r.results.length.toLocaleString()} match${r.results.length === 1 ? '' : 'es'} in ${by.size.toLocaleString()} file${by.size === 1 ? '' : 's'} · searched ${r.files.toLocaleString()} files in ${r.ms} ms on ${r.workers} threads</div>` +
    [...by.entries()].map(([f, hits]) => `<div class="sr-file">${icon(fileIcon(f), 14)}${esc(f.slice(JV.snap.outDir.length + 1))}</div>${hits.slice(0, 50).map((h) => `<div class="sr-hit" data-f="${esc(f)}" data-l="${h.line}"><span class="l">${h.line}</span><span class="ellip">${mark(h.text)}</span></div>`).join('')}`).join('');
  $$('.sr-hit', el).forEach((h) => h.onclick = () => {
    const f = h.dataset.f; JV.selected = { path: f, line: +h.dataset.l };
    // open the folders down to the file
    let d = f; while ((d = d.replace(/[\\/][^\\/]+$/, '')) && d.length > JV.snap.outDir.length) JV.expanded.add(d);
    JV.tab = 'files'; $$('#jTabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === 'files')); drawTab();
  });
}
