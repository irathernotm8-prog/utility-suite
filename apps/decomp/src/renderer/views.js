// Home (open + what Decomp reads), the identify sheet, Jobs, Engines and Settings.
'use strict';

const STACK_SVG = `<svg class="stack" viewBox="0 0 120 120"><defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffc4ad"/><stop offset="1" stop-color="#ff4d6d"/></linearGradient><linearGradient id="g2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e2506c"/><stop offset="1" stop-color="#97213f"/></linearGradient><linearGradient id="g3" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b2c42"/><stop offset="1" stop-color="#4c1626"/></linearGradient></defs>
  <g transform="translate(0 66)"><path d="M60 8 104 30 60 52 16 30Z" fill="url(#g3)"/><path d="M16 30v9l44 22v-9Z" fill="#5c1a2e"/><path d="M104 30v9L60 61v-9Z" fill="#3d1020"/></g>
  <g transform="translate(5 36)"><path d="M60 8 104 30 60 52 16 30Z" fill="url(#g2)"/><path d="M16 30v9l44 22v-9Z" fill="#a52646"/><path d="M104 30v9L60 61v-9Z" fill="#701a33"/></g>
  <g transform="translate(1 4)"><path d="M60 8 104 30 60 52 16 30Z" fill="url(#g1)"/><path d="M16 30v9l44 22v-9Z" fill="#e23c60"/><path d="M104 30v9L60 61v-9Z" fill="#a8233f"/><path d="m51 24-8 6 8 6M69 24l8 6-8 6M63 21l-6 18" stroke="#8f1638" stroke-width="3.4" fill="none" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 0) scale(1 .62) translate(0 18)"/></g></svg>`;

const STATUS_PILL = { running: ['acc', 'Working'], done: ['ok', 'Done'], failed: ['bad', 'Failed'], cancelled: ['', 'Stopped'], queued: ['', 'Waiting'] };
const statusPill = (s) => { const [c, t] = STATUS_PILL[s] || ['', s]; return `<span class="pill ${c}">${s === 'running' ? '<span class="dot busy" style="width:6px;height:6px"></span>' : ''}${t}</span>`; };

// ───────── Home
VIEWS.home = {
  title: 'Open',
  head: () => `<h1>Take it apart <small>Decompile apps, open installers, discs and game packs</small></h1>`,
  render(el) {
    const b = S.info.budget;
    const recent = S.jobs.slice(0, 6);
    const groups = S.info.families.map((f) => ({ ...f, types: Object.values(S.info.types).filter((t) => t.family === f.id && !['folder', 'unknown', 'upx', 'axml'].includes(t.id)) })).filter((g) => g.types.length);
    const total = Object.keys(S.info.types).length;
    el.innerHTML = `
      <div class="drop" id="dropZone">
        ${STACK_SVG}
        <h2>Drop an app, installer or disc image</h2>
        <p>Decomp works out what it is, unpacks every layer and hands the code to the right decompiler. Windows, Mac, Linux, Android, iOS, Java, .NET, Python, Electron, WebAssembly, game discs and firmware.</p>
        <div class="row"><button class="btn primary lg" id="pickFile">${icon('open', 17)}Choose a file…</button><button class="btn lg" id="pickFolder">${icon('folder', 17)}Choose a folder…</button></div>
        <div class="hint">Folders work too: a Mac .app, a game’s install folder or anything already unpacked.</div>
        <div class="machine-line">${icon('cpu', 15)} Runs on ${b.threads} of ${b.cores} threads · ${Math.round(b.heapMB / 1024)} GB for engines · ${esc(b.label)}</div>
      </div>
      ${recent.length ? `<div class="section-title">Recent<span class="grow"></span><button class="link-btn" data-go="jobs">All jobs</button></div>
      <div class="recent">${recent.map((j) => `<div class="rcard" data-job="${j.id}">${kindIcon(j.family)}<div class="grow"><div class="rc-name ellip">${esc(j.name)}</div><div class="rc-sub ellip">${esc(j.label)} · ${j.status === 'running' ? Math.round(j.progress * 100) + '%' : ago(j.endedAt || j.startedAt)}</div></div>${statusPill(j.status)}</div>`).join('')}</div>` : ''}
      <div class="section-title">What Decomp opens <span class="muted" style="font-weight:500">${total} kinds of file</span></div>
      <div class="families">${groups.map((g) => `<div class="fam"><div class="fam-head">${kindIcon(g.id, 'sm')}${esc(g.label)}</div><div class="chips">${g.types.map((t) => `<span class="chip" title="${esc(t.how)}${t.exts.length ? ' · .' + esc(t.exts.join(' .')) : ''}">${esc(t.label)}</span>`).join('')}</div></div>`).join('')}</div>`;
    $('#pickFile').onclick = () => pickAndOpen(false);
    $('#pickFolder').onclick = () => pickAndOpen(true);
    $$('[data-job]', el).forEach((c) => c.onclick = () => go('job', c.dataset.job));
    $$('[data-go]', el).forEach((c) => c.onclick = () => go(c.dataset.go));
  },
};

// ───────── Identify sheet: what it is, what will happen, options
function factsOf(id) {
  const out = [];
  const add = (k, v) => { if (v !== undefined && v !== null && v !== '' && typeof v !== 'object') out.push([k, typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)]); };
  add('Size', id.dir ? `${(id.details.files || 0).toLocaleString()} files` : fmtSize(id.size));
  const nice = { pe: 'Program', version: 'Version info', dotnet: '.NET', elf: 'ELF', macho: 'Mach-O', disc: 'Disc', android: 'Android', ios: 'iOS', java: 'Java', python: 'Python', bundle: 'Bundle', godot: 'Godot', cso: 'CSO', dex: 'DEX', wasm: 'WebAssembly', asar: 'Electron', zip: 'Archive', rom: 'ROM', swf: 'Flash', lua: 'Lua', rgss: 'RPG Maker', plist: 'Info.plist', overlay: 'Appended data' };
  const label = (k) => k.replace(/^CF?Bundle/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
  for (const [g, obj] of Object.entries(id.details || {})) {
    if (!obj || typeof obj !== 'object') continue;
    for (const [k, v] of Object.entries(obj)) {
      if (['sections', 'comment'].includes(k) || (k === 'files' && !['disc', 'bundle', 'zip', 'asar', 'godot'].includes(g))) continue;
      if (['unsupported', 'encrypted', 'unpacked'].includes(k) && !v) continue;
      if (g === 'overlay') { if (k === 'size') add('Appended data', fmtSize(v)); continue; }
      if (g === 'cso' && k === 'size') { add('Uncompressed', fmtSize(v)); continue; }
      add(`${nice[g] || g} · ${label(k)}`, Array.isArray(v) ? v.join(', ') : v);
      if (out.length > 30) break;
    }
  }
  return out;
}

window.showIdentify = (id) => {
  const o = { deep: S.info.settings.deep, native: S.info.settings.native, nativeDeep: S.info.settings.nativeDeep, libraries: S.info.settings.libraries, deobf: S.info.settings.deobf };
  const native = ['pe', 'elf', 'macho', 'app', 'upx', 'unity'].includes(id.kind) || id.family === 'native';
  const android = ['apk', 'aab', 'aar', 'dex', 'apkbundle'].includes(id.kind);
  const draw = () => {
    const missing = id.plan.filter((e) => !e.ready && e.available);
    const unavailable = id.plan.filter((e) => !e.available);
    const sheet = openSheet(`
      <div class="sheet-head">${kindIcon(id.family, 'lg')}<div class="grow" style="min-width:0"><h3 class="ellip">${esc(id.name)}</h3><div class="muted">${esc(id.label)}${id.how ? ' · ' + esc(id.how) : ''}</div>
        ${id.traits.length ? `<div class="traits">${id.traits.map((t) => `<span class="pill">${esc(t)}</span>`).join('')}</div>` : ''}</div>
        <button class="icon-btn" data-x>${icon('x')}</button></div>
      <div class="sheet-body">
        <div class="facts">${factsOf(id).map(([k, v]) => `<div class="fact"><div class="k">${esc(k)}</div><div class="v" title="${esc(v)}">${esc(v)}</div></div>`).join('')}</div>
        ${id.notes.map((n) => `<div class="note">${icon('alert', 16)}<div>${esc(n)}</div></div>`).join('')}
        <div><div class="label" style="margin-bottom:8px">What happens</div><div class="plan">
          <div class="plan-row"><span class="ic-wrap">${icon('search', 16)}</span><div class="grow"><b>Inspect</b><div class="muted small">Hashes, entropy, strings and embedded files — split across ${S.info.budget.workers} worker threads</div></div><span class="pill ok">Built in</span></div>
          ${id.plan.map((e) => `<div class="plan-row"><span class="ic-wrap">${icon('engine', 16)}</span><div class="grow"><b>${esc(e.name)}</b> <span class="muted small">${esc(e.version)}</span><div class="muted small">${esc(e.what)}</div></div>${e.ready ? `<span class="pill ok">${e.system ? 'On this computer' : 'Ready'}</span>` : !e.available ? `<span class="pill">Not on ${D.platform === 'darwin' ? 'Mac' : 'this computer'}</span>` : S.busy[e.id] ? `<span class="pill acc"><span class="spin" style="width:10px;height:10px"></span>Getting</span>` : `<span class="pill warn">${fmtSize(e.size)} download</span>`}</div>`).join('')}
          ${!id.plan.length && !['folder'].includes(id.kind) ? `<div class="plan-row"><span class="ic-wrap">${icon('layers', 16)}</span><div class="grow"><b>Built-in readers</b><div class="muted small">${esc(id.how || 'Unpacked and looked at')}</div></div><span class="pill ok">Built in</span></div>` : ''}
          ${unavailable.map((e) => `<div class="note">${icon('info', 16)}<div>${esc(e.note || e.name + ' isn’t available here')}</div></div>`).join('')}
        </div></div>
        <div class="opts">
          <div class="opt" data-o="deep"><button class="switch ${o.deep ? 'on' : ''}"></button><div><b>Go all the way down</b><span>Open everything found inside: nested archives, DLLs, JARs, scripts</span></div></div>
          ${native ? `<div class="opt" data-o="native"><button class="switch ${o.native ? 'on' : ''}"></button><div><b>Decompile machine code</b><span>Ghidra turns the program into C pseudocode (slow on big apps)</span></div></div>` : ''}
          ${native || id.kind === 'app' || id.kind === 'folder' ? `<div class="opt" data-o="nativeDeep"><button class="switch ${o.nativeDeep ? 'on' : ''}"></button><div><b>Native libraries too</b><span>Also run Ghidra on bundled .dll / .so / .dylib files</span></div></div>` : ''}
          <div class="opt" data-o="libraries"><button class="switch ${o.libraries ? 'on' : ''}"></button><div><b>Include frameworks</b><span>Also decompile system, Unity and standard-library code</span></div></div>
          ${android ? `<div class="opt" data-o="deobf"><button class="switch ${o.deobf ? 'on' : ''}"></button><div><b>Rename obfuscated code</b><span>Give a.b.c-style names readable ones</span></div></div>` : ''}
        </div>
        <div class="row small muted">${icon('folder', 15)}<span class="ellip grow">Saves to ${esc(S.info.settings.outRoot)}</span><button class="link-btn" data-out>Change</button></div>
      </div>
      <div class="sheet-foot"><span class="muted small grow">${esc(S.info.budget.label)} · ${S.info.budget.threads} threads</span><button class="btn" data-x>Cancel</button>
        <button class="btn primary" data-start>${missing.length ? `${icon('download', 16)}Get ${missing.map((e) => e.name).join(', ')} and start` : `${icon('play', 15)}Take it apart`}</button></div>`);
    $$('[data-x]', sheet).forEach((b) => b.onclick = closeSheet);
    $$('[data-o]', sheet).forEach((r) => r.onclick = () => { o[r.dataset.o] = !o[r.dataset.o]; if (r.dataset.o === 'native') { id.plan = o.native ? id.plan : id.plan.filter((e) => e.id !== 'ghidra'); } draw(); });
    $('[data-out]', sheet).onclick = async () => { const p = await call('dialog:outRoot'); if (p) { S.info.settings.outRoot = p; draw(); } };
    $('[data-start]', sheet).onclick = async (ev) => {
      const btn = ev.currentTarget; btn.disabled = true;
      try {
        const need = id.plan.filter((e) => !e.ready && e.available && (o.native || e.id !== 'ghidra'));
        if (need.length) { btn.innerHTML = '<span class="spin"></span>Getting engines…'; await call('engines:install', need.map((e) => e.id)); await loadEngines(); }
        const snap = await call('job:start', { path: id.path, options: o });
        upsertJob(snap); closeSheet(); go('job', snap.id);
      } catch (e) { btn.disabled = false; fail(e); draw(); }
    };
  };
  window.onEnginesChanged = async () => { if ($('#sheetHost .sheet')) { try { const fresh = await call('identify', id.path); id.plan = fresh.plan; } catch {} } };
  draw();
};

// ───────── Jobs
VIEWS.jobs = {
  title: 'Jobs',
  head: () => `<h1>Jobs <small>${S.jobs.length ? S.jobs.length + ' so far' : ''}</small></h1>`,
  render(el) {
    if (!S.jobs.length) { el.innerHTML = `<div class="empty">${icon('jobs', 34)}<b>Nothing taken apart yet</b><span>Open something and it shows up here, with everything Decomp found.</span><button class="btn primary" style="margin-top:10px" id="jOpen">${icon('open', 16)}Open…</button></div>`; $('#jOpen').onclick = () => pickAndOpen(false); return; }
    el.innerHTML = `<div class="jlist">${S.jobs.map((j) => `<div class="jrow" data-job="${j.id}">${kindIcon(j.family)}
      <div style="min-width:0"><div class="jr-name ellip">${esc(j.name)}</div><div class="jr-sub ellip">${esc(j.label)} · ${new Date(j.startedAt || Date.now()).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div></div>
      <div>${j.status === 'running' ? `<div class="bar"><i style="width:${Math.round(j.progress * 100)}%"></i></div><div class="tiny muted" style="margin-top:4px">${Math.round(j.progress * 100)}% · ${j.steps.filter((s) => s.state === 'running').length} running</div>` : `<div class="small">${(j.stats.sources || 0).toLocaleString()} source files</div><div class="tiny muted">${j.stats.seconds != null ? j.stats.seconds + 's' : ''}${j.stats.peakThreads ? ' · up to ' + j.stats.peakThreads + ' threads' : ''}</div>`}</div>
      <div>${statusPill(j.status)}</div>
      <button class="icon-btn sm" data-more="${j.id}" title="Show in folder">${icon('reveal', 16)}</button></div>`).join('')}</div>`;
    $$('[data-job]', el).forEach((r) => r.onclick = (e) => { if (e.target.closest('[data-more]')) return; go('job', r.dataset.job); });
    $$('[data-more]', el).forEach((b) => b.onclick = () => { const j = S.jobs.find((x) => x.id === b.dataset.more); if (j) call('shell:open', j.outDir); });
  },
};

// ───────── Engines
const ENG_ICON = { sevenzip: 'archive', jdk: 'cup', jadx: 'phone', vineflower: 'cup', dotnet: 'dotnet', ilspy: 'dotnet', ghidra: 'chip', upx: 'box' };
VIEWS.engines = {
  title: 'Engines',
  head: () => `<h1>Engines <small>The decompilers Decomp drives</small></h1>`,
  actions: () => { const missing = S.engines.engines.filter((e) => e.available && !e.ready); return missing.length ? `<button class="btn" id="engAll">${icon('download', 16)}Get all (${fmtSize(missing.reduce((a, e) => a + e.size, 0))})</button>` : ''; },
  render(el) {
    const groups = [...new Set(S.engines.engines.map((e) => e.group))];
    const card = (e) => {
      const busy = S.busy[e.id];
      const state = !e.available ? `<span class="pill">Not available here</span>` : e.installed ? `<span class="pill ok">Installed</span>` : e.system ? `<span class="pill ok">On this computer</span>` : busy ? `<span class="pill acc">Getting…</span>` : `<span class="pill">Not installed</span>`;
      const prog = busy ? `<div class="col" style="gap:4px" data-prog="${e.id}"><div class="bar ${busy.total ? '' : 'indet'}"><i style="width:${busy.total ? Math.round((busy.got / busy.total) * 100) : 30}%"></i></div><div class="tiny muted">${esc(busy.phase || '')}${busy.total ? ` · ${fmtSize(busy.got)} of ${fmtSize(busy.total)}` : ''}</div></div>` : '';
      return `<div class="eng"><div class="eng-top"><span class="ic-wrap">${icon(ENG_ICON[e.id] || 'engine', 18)}</span><div class="grow"><b>${esc(e.name)}</b> <span class="muted">${esc(e.version)}</span><div class="muted">${esc(e.license)} · ${e.installed && e.diskBytes ? fmtSize(e.diskBytes) + ' on disk' : fmtSize(e.size) + ' download'}</div></div>${state}</div>
        <p>${esc(e.what)}</p>${e.note ? `<div class="hint">${esc(e.note)}</div>` : ''}${e.system ? `<div class="hint ellip" title="${esc(e.system.path)}">Using ${esc(e.system.path)}${e.system.version && e.system.version !== 'system' ? ' (' + esc(e.system.version) + ')' : ''}</div>` : ''}${prog}
        <div class="eng-foot">${e.available && !e.installed && !busy ? `<button class="btn sm ${e.system ? '' : 'primary'}" data-get="${e.id}">${icon('download', 15)}${e.system ? 'Get Decomp’s own copy' : 'Get'}</button>` : ''}${e.installed ? `<button class="btn sm ghost danger" data-rm="${e.id}">${icon('trash', 15)}Remove</button>` : ''}${e.requires.length ? `<span class="tiny muted">Uses ${e.requires.map((r) => (S.engines.engines.find((x) => x.id === r) || {}).name).join(', ')}${e.java ? ' ' + e.java : ''}</span>` : ''}</div></div>`;
    };
    el.innerHTML = groups.map((g) => `<div class="egroup"><div class="section-title">${esc(g)}</div><div class="eng-grid">${S.engines.engines.filter((e) => e.group === g).map(card).join('')}</div></div>`).join('') +
      `<div class="section-title">Used when they’re on this computer<span class="grow"></span><button class="link-btn" id="rescan">${icon('refresh', 14)}Look again</button></div>
      <div class="tools">${S.engines.tools.map((t) => `<div class="tool">${icon(t.found ? 'check' : 'info', 16)}<div class="grow"><b>${esc(t.name)}</b> <span class="muted small">${esc(t.what)}</span><div class="tiny muted ellip">${t.found ? esc(t.found) : esc(t.hint || 'Not found')}</div></div>${t.found ? '<span class="pill ok">Found</span>' : '<span class="pill">Not found</span>'}</div>`).join('')}</div>
      <div class="row" style="margin-top:18px"><button class="btn sm" id="engFolder">${icon('folder', 15)}Open engines folder</button><span class="hint">Engines live in Decomp’s own folder; nothing is installed system-wide.</span></div>`;
    $$('[data-get]', el).forEach((b) => b.onclick = () => getEngines([b.dataset.get]));
    $$('[data-rm]', el).forEach((b) => b.onclick = async () => { try { S.engines = await call('engines:remove', b.dataset.rm); render(); } catch (e) { fail(e); } });
    $('#rescan').onclick = async () => { S.engines = await call('engines:rescan'); render(); };
    $('#engFolder').onclick = () => call('engines:folder');
    const all = $('#engAll'); if (all) all.onclick = () => getEngines(S.engines.engines.filter((e) => e.available && !e.ready).map((e) => e.id));
  },
};
async function getEngines(ids) {
  for (const id of ids) S.busy[id] = S.busy[id] || { id, phase: 'Starting' };
  render();
  try { await call('engines:install', ids); await loadEngines(); toast(ids.length > 1 ? 'Engines ready' : `${(S.engines.engines.find((e) => e.id === ids[0]) || {}).name} is ready`); }
  catch (e) { for (const id of ids) delete S.busy[id]; fail(e); }
  refresh(['engines']);
}
window.updateEngineProgress = (p) => {
  if (S.view !== 'engines') return;
  const box = $(`[data-prog="${p.id}"]`); if (!box) { render(); return; }
  box.querySelector('.bar').classList.toggle('indet', !p.total);
  box.querySelector('.bar > i').style.width = p.total ? Math.round((p.got / p.total) * 100) + '%' : '30%';
  box.querySelector('.tiny').textContent = `${p.phase || ''}${p.total ? ` · ${fmtSize(p.got)} of ${fmtSize(p.total)}` : ''}${p.rate ? ` · ${fmtSize(p.rate)}/s` : ''}`;
};

// ───────── Settings
VIEWS.settings = {
  title: 'Settings',
  render(el) {
    const s = S.info.settings;
    const sw = (k) => `<button class="switch ${s[k] ? 'on' : ''}" data-sw="${k}"></button>`;
    const seg = (k, opts) => `<div class="seg">${opts.map(([v, l]) => `<button data-seg="${k}" data-v="${v}" class="${String(s[k]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    el.innerHTML = `<div class="settings">
      <div class="section-title">Output</div>
      <div class="srow">${icon('folder')}<div class="grow"><b>Save results to</b><span class="ellip" style="display:block">${esc(s.outRoot)}</span></div><button class="btn sm" id="outOpen">Open</button><button class="btn sm" id="outChange">Change…</button></div>
      <div class="srow"><div class="grow"><b>Open the folder when a job finishes</b><span>Source, Unpacked and Analysis folders plus Overview.md</span></div>${sw('openWhenDone')}</div>
      <div class="section-title">Power</div>
      <div class="srow"><div class="grow"><b>How hard to drive this computer</b><span>${esc(S.info.modes[s.mode].note)} ${S.info.cores} threads, ${fmtSize(S.info.memory)} memory.</span></div>${seg('mode', [['max', 'Full'], ['balanced', 'Balanced'], ['quiet', 'Background']])}</div>
      <div class="section-title">Defaults for new jobs</div>
      <div class="srow"><div class="grow"><b>Go all the way down</b><span>Open everything found inside, then whatever is inside that</span></div>${sw('deep')}</div>
      <div class="srow"><div class="grow"><b>How deep</b><span>Layers of archives inside archives</span></div>${seg('maxDepth', [[2, '2'], [3, '3'], [4, '4'], [6, '6'], [10, '10']])}</div>
      <div class="srow"><div class="grow"><b>Decompile machine code</b><span>Ghidra on the main program of native apps</span></div>${sw('native')}</div>
      <div class="srow"><div class="grow"><b>Native libraries too</b><span>Ghidra on every .dll, .so and .dylib found inside (much slower)</span></div>${sw('nativeDeep')}</div>
      <div class="srow"><div class="grow"><b>Include frameworks</b><span>System, Unity, .NET and Python standard-library code</span></div>${sw('libraries')}</div>
      <div class="srow"><div class="grow"><b>Rename obfuscated Android code</b><span>JADX’s deobfuscation</span></div>${sw('deobf')}</div>
      <div class="section-title">Engines</div>
      <div class="srow"><div class="grow"><b>Use programs already on this computer</b><span>Java, .NET, 7-Zip, UPX, pycdc and innoextract when they’re installed</span></div>${sw('useSystem')}</div>
      <div class="srow"><div class="grow"><b>Get 7-Zip automatically</b><span>A 2 MB download that opens most installers and disc images</span></div>${sw('essentials')}</div>
      <div class="section-title">Appearance</div>
      <div class="srow"><div class="grow"><b>Theme</b></div>${seg('theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']])}</div>
      <div class="hint" style="margin-top:8px">Decomp ${esc(S.info.version)} · ${esc(S.info.platform)} ${esc(S.info.arch)} · Decompiled code is for studying, interoperability and recovering your own work; respect the licences of what you open.</div>
    </div>`;
    const set = async (patch) => { try { S.info.settings = await call('settings:set', patch); if ('theme' in patch) window.applyTheme(); if ('mode' in patch) { S.info.budget = (await call('app:info')).budget; renderPower(); } if ('useSystem' in patch) await loadEngines(); render(); } catch (e) { fail(e); } };
    $$('[data-sw]', el).forEach((b) => b.onclick = () => set({ [b.dataset.sw]: !s[b.dataset.sw] }));
    $$('[data-seg]', el).forEach((b) => b.onclick = () => set({ [b.dataset.seg]: /^\d+$/.test(b.dataset.v) ? +b.dataset.v : b.dataset.v }));
    $('#outChange').onclick = async () => { const p = await call('dialog:outRoot'); if (p) { S.info.settings.outRoot = p; render(); } };
    $('#outOpen').onclick = () => call('shell:open', s.outRoot);
  },
};
