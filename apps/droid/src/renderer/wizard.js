// New device / Edit device sheet: Look → Android → Hardware → Network & location → Review, with a live preview.
'use strict';

const STEPS = [
  { id: 'look', label: 'Look' },
  { id: 'android', label: 'Android version' },
  { id: 'hardware', label: 'Hardware' },
  { id: 'connect', label: 'Network & location' },
  { id: 'review', label: 'Review' },
];

function draftFrom(device, styleId) {
  const C = S.init.catalog;
  if (device) return JSON.parse(JSON.stringify({ ...device, start: false }));
  const st = C.styles[styleId] || C.styles.pixel;
  const lim = S.init.host.limits;
  const res = st.defaults.res;
  const long = Math.round((res * st.aspect) / 8) * 8;
  const [w, h] = st.orientation === 'landscape' ? [long, res] : [res, long];
  const used = new Set(S.devices.map((d) => d.accent));
  return {
    style: st.id, finish: st.finishes[0].id, accent: C.accents.find((a) => !used.has(a)) || C.accents[0],
    name: uniqueName(st.short), image: null,
    screen: { w, h, dpi: null, preset: String(res) },
    ramMB: Math.min(st.defaults.ramMB, lim.ramMB), cores: Math.min(st.defaults.cores, lim.cores), storageGB: st.defaults.storageGB,
    network: { mode: 'internet', proxy: '' }, location: { mode: 'actual', city: 'houston', motion: 'still', lat: null, lng: null, label: '' },
    options: { quickBoot: true, audio: true, clipboard: true, microphone: false, gpu: 'auto' }, start: true,
  };
}
function uniqueName(base) {
  const names = new Set(S.devices.map((d) => d.name));
  if (!names.has(base)) return base;
  let n = 2; while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}
function sizeFor(styleId, short) {
  const st = S.init.catalog.styles[styleId];
  const long = Math.round((short * st.aspect) / 8) * 8;
  return st.orientation === 'landscape' ? { w: long, h: short } : { w: short, h: long };
}
function autoDpi(styleId, w, h) {
  const st = S.init.catalog.styles[styleId];
  const ppi = Math.sqrt(w * w + h * h) / st.diag;
  return S.init.catalog.densities.reduce((b, d) => (Math.abs(d - ppi) < Math.abs(b - ppi) ? d : b), 160);
}

let W = null;   // the open wizard
function openWizard({ device = null, style = null } = {}) {
  W = { edit: !!device, id: device?.id || null, original: device?.image?.path || null, step: device ? 'look' : style ? 'android' : 'look', draft: draftFrom(device, style), plan: null, map: null, accepted: false, saving: false };
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.innerHTML = `<div class="sheet a-${W.draft.accent}">
    <div class="sheet-rail"><h3>${W.edit ? 'Edit device' : 'New device'}</h3>${STEPS.map((s, i) => `<button class="step" data-step="${s.id}"><span class="n">${i + 1}</span>${s.label}</button>`).join('')}</div>
    <div class="sheet-main" id="wMain"></div>
    <div class="sheet-side"><div class="preview" id="wPreview"></div><dl class="summary" id="wSummary"></dl></div>
    <div class="sheet-foot" id="wFoot"></div></div>`;
  $('#sheetHost').appendChild(scrim);
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) closeWizard(); });
  scrim.addEventListener('click', wizardClick);
  scrim.addEventListener('input', wizardInput);
  scrim.addEventListener('change', wizardInput);
  document.addEventListener('keydown', wizardKey);
  if (!S.images) loadImages();
  wRender();
}
function closeWizard() {
  if (W?.map) { W.map.remove(); W.map = null; }
  W = null; $('#sheetHost').innerHTML = '';
  document.removeEventListener('keydown', wizardKey);
}
function wizardKey(e) { if (e.key === 'Escape' && W) closeWizard(); }

async function loadImages(force) {
  S.imagesErr = null;
  try { S.images = await call('catalog:images', !!force); }
  catch (e) { S.imagesErr = e.message; }
  if (W) {
    if (!W.draft.image && S.images) { const rec = S.images.images.find((i) => i.path === S.images.recommended); if (rec) W.draft.image = pickImage(rec); }
    wRender();
  }
}
const pickImage = (i) => ({ path: i.path, api: i.api, tag: i.tag, tagName: i.tagName, abi: i.abi, name: i.name, size: i.size });

function wRender() {
  if (!W) return;
  const sheet = $('.sheet');
  sheet.className = `sheet a-${W.draft.accent}`;
  const idx = STEPS.findIndex((s) => s.id === W.step);
  $$('.step').forEach((b, i) => { b.classList.toggle('on', b.dataset.step === W.step); b.classList.toggle('done', !W.edit && i < idx); });
  if (W.map && W.step !== 'connect') { W.map.remove(); W.map = null; }
  const main = $('#wMain');
  main.innerHTML = ({ look: stepLook, android: stepAndroid, hardware: stepHardware, connect: stepConnect, review: stepReview })[W.step]();
  hydrateIcons(main);
  if (W.step === 'connect') mountMap();
  if (W.step === 'review') loadPlan();
  if (W.step === 'look') afterLook();
  wPreview();
  wFoot();
}
function wFoot() {
  const idx = STEPS.findIndex((s) => s.id === W.step);
  const last = idx === STEPS.length - 1;
  const canNext = W.step !== 'android' || !!W.draft.image;
  $('#wFoot').innerHTML = `
    <button class="btn ghost" data-w="cancel">Cancel</button><span class="grow"></span>
    ${idx > 0 ? `<button class="btn" data-w="back">${icon('chevL', 15)}Back</button>` : ''}
    ${W.edit ? `<button class="btn primary" data-w="save" ${W.saving ? 'disabled' : ''}>${W.saving ? '<span class="spin"></span>' : icon('check', 15)}Save changes</button>`
      : last ? `<button class="btn primary" data-w="create" ${W.saving || !createAllowed() ? 'disabled' : ''}>${W.saving ? '<span class="spin"></span>' : icon('sparkle', 15)}${W.draft.start ? 'Create and start' : 'Create device'}</button>`
        : `<button class="btn primary" data-w="next" ${canNext ? '' : 'disabled'}>Next${icon('chevR', 15)}</button>`}`;
}
function createAllowed() { return !!W.draft.image && (!W.plan || !W.plan.licenses.length || W.accepted); }

function wPreview() {
  const d = W.draft;
  const st = S.init.catalog.styles[d.style];
  const fin = st.finishes.find((f) => f.id === d.finish) || st.finishes[0];
  const host = document.createElement('div'); host.style.position = 'relative';
  const pv = $('#wPreview'); pv.innerHTML = ''; pv.appendChild(host);
  const box = { w: 240, h: Math.max(200, pv.clientHeight - 40) };
  const L = Frames.renderFrame(host, { style: d.style, finish: fin, natW: d.screen.w, natH: d.screen.h, rotation: 'PORTRAIT', box });
  const sc = L.screen;
  const ph = document.createElement('div'); ph.className = 'shot-ph';
  Object.assign(ph.style, { left: `${sc.x}px`, top: `${sc.y}px`, width: `${sc.w}px`, height: `${sc.h}px`, borderRadius: `${sc.r}px` });
  ph.innerHTML = `<div style="text-align:center;color:#fff"><div style="font-size:${Math.max(18, sc.w * 0.2)}px;font-weight:300;letter-spacing:-.02em">${clockNow()}</div><div style="font-size:11px;opacity:.8;margin-top:2px">${esc(d.name)}</div></div>`;
  host.appendChild(ph);
  const dpi = d.screen.dpi || autoDpi(d.style, d.screen.w, d.screen.h);
  $('#wSummary').innerHTML = `
    <dt>Look</dt><dd>${esc(st.short)} · ${esc(fin.name)}</dd>
    <dt>Android</dt><dd>${d.image ? `${esc(d.image.name)} · ${esc(d.image.tagName)}` : '—'}</dd>
    <dt>Screen</dt><dd>${d.screen.w}×${d.screen.h} · ${dpi} dpi</dd>
    <dt>Memory</dt><dd>${fmtRam(d.ramMB)}</dd><dt>Cores</dt><dd>${d.cores}</dd><dt>Storage</dt><dd>${d.storageGB} GB</dd>
    <dt>Network</dt><dd>${{ internet: 'Internet', isolated: 'Isolated', proxy: 'Proxy' }[d.network.mode]}</dd>
    <dt>Location</dt><dd class="ellip">${locLabel(d.location)}</dd>`;
}
function locLabel(l) {
  if (l.mode === 'actual') return 'Your location';
  if (l.mode === 'simulated') { const c = S.init.cities.find((x) => x.id === l.city); return `${c ? c.name : 'City'}${l.motion !== 'still' ? ` · ${l.motion === 'walk' ? 'walking' : 'driving'}` : ''}`; }
  return l.label ? esc(l.label.split(',').slice(0, 2).join(',')) : Number.isFinite(l.lat) ? `${l.lat.toFixed(4)}, ${l.lng.toFixed(4)}` : 'Pick a spot';
}

// ── steps
function stepLook() {
  const d = W.draft, C = S.init.catalog;
  const st = C.styles[d.style];
  return `<h2>Choose a look</h2><p class="lead">The frame around the screen. Inside, every look runs real Android.</p>
    <div class="choices c5">${Object.values(C.styles).map((s) => `<button class="choice style-choice ${d.style === s.id ? 'on' : ''}" data-style="${s.id}"><span class="tick">${icon('check', 12)}</span><div class="art" data-art="${s.id}"></div><span class="ch-title">${esc(s.short)}</span></button>`).join('')}</div>
    <p class="hint" style="margin:10px 2px 20px">${esc(st.blurb)}</p>
    <div class="form-row"><div class="label">Finish</div><div class="swatches">${st.finishes.map((f) => `<button class="swatch ${d.finish === f.id ? 'on' : ''}" data-finish="${f.id}" title="${esc(f.name)}" style="background:linear-gradient(145deg, ${f.frame}, ${f.edge})"></button>`).join('')}<span class="small muted" style="margin-left:6px;align-self:center">${esc((st.finishes.find((f) => f.id === d.finish) || st.finishes[0]).name)}</span></div></div>
    <div class="form-row"><div class="label">Name</div><input class="input" id="wName" value="${esc(d.name)}" maxlength="60" style="max-width:340px"></div>
    <div class="form-row"><div class="label">Card colour<small>On your dashboard</small></div><div class="swatches">${C.accents.map((a) => `<button class="swatch a-${a} ${d.accent === a ? 'on' : ''}" data-accent="${a}" style="background:linear-gradient(135deg, var(--c), var(--c2))"></button>`).join('')}</div></div>
    ${d.style === 'island' ? `<div class="notice">${icon('info', 16)}<div>Island-style gives the device an iPhone-like frame. The software inside is still Android, so apps come from Android stores.</div></div>` : ''}`;
}
function afterLook() {
  $$('.sheet [data-art]').forEach((el) => { const s = S.init.catalog.styles[el.dataset.art]; const land = s.orientation === 'landscape'; const w = land ? 1600 : 1080; const h = Math.round(land ? w / s.aspect : w * s.aspect); el.parentElement.classList.add(`a-${W.draft.accent}`); el.style.position = 'relative'; miniStatic(el, s.id, s.id === W.draft.style ? W.draft.finish : s.finishes[0].id, w, h, { w: 92, h: 92 }); });
}

function stepAndroid() {
  if (S.imagesErr) return `<h2>Android version</h2><div class="notice warn" style="margin-top:14px">${icon('warning', 16)}<div><b>Couldn't reach Google's Android catalog.</b><br>${esc(S.imagesErr)}<div style="margin-top:8px"><button class="btn sm" data-w="retryImages">Try again</button></div></div></div>`;
  if (!S.images) return `<h2>Android version</h2><div class="row muted" style="margin-top:20px"><span class="spin"></span>Loading Android versions from Google…</div>`;
  const showAll = !!S.init.settings.showAllImages;
  const list = showAll ? S.images.all : S.images.images;
  const groups = new Map();
  for (const i of list) { const k = i.name; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); }
  const installed = new Set(S.images.installed);
  const cur = W.draft.image?.path;
  const changing = W.edit && cur && W.original !== cur;
  return `<h2>Android version</h2><p class="lead">Each version downloads once (about 1–2 GB) and is shared by every device that uses it.</p>
    <div class="flavors">
      <div class="flavor"><b>Google Play</b>Play Store and Google sign-in. The easiest way to get everyday apps.</div>
      <div class="flavor"><b>Google APIs</b>Google services without the Play Store. Use Aurora Store or APKs.</div>
      <div class="flavor"><b>Pure Android</b>Open-source Android with nothing from Google. Smallest download.</div>
    </div>
    <div class="versions">${[...groups.entries()].map(([name, imgs]) => `
      <div class="ver"><div><b>${esc(name)}</b><span class="tiny muted">${imgs[0].preview ? 'Preview' : `API ${esc(imgs[0].api)}`}${imgs.some((i) => i.path === S.images.recommended) ? ' · <span style="color:var(--acc);font-weight:700">Recommended</span>' : ''}</span></div>
        <div class="chips">${imgs.sort((a, b) => a.tagRank - b.tagRank).map((i) => `<button class="chip ${cur === i.path ? 'on' : ''}" data-image="${esc(i.path)}" title="${esc(i.path)}">${esc(i.tagName)}${i.variant ? ` (${esc(i.variant)})` : ''}<small>${installed.has(i.path) ? '✓ ready' : fmtBytes(i.size)}</small></button>`).join('')}</div></div>`).join('')}
    </div>
    <div class="row" style="margin-top:14px"><label class="check"><input type="checkbox" id="wShowAll" ${showAll ? 'checked' : ''}> Show previews and special builds</label><span class="grow"></span><button class="link-btn" data-w="retryImages">${icon('refresh', 13)}Refresh list</button></div>
    ${W.edit ? `<div class="notice warn" style="margin-top:14px">${icon('warning', 16)}<div>Changing the Android version erases this device's apps and data, because the old data won't start on a different version.</div></div>` : ''}
    ${changing ? '' : ''}`;
}

function stepHardware() {
  const d = W.draft, C = S.init.catalog, st = C.styles[d.style];
  const lim = S.init.host.limits, host = S.init.host;
  const presets = st.tablet ? C.tabletRes : C.res;
  const isPreset = presets.find((p) => { const s = sizeFor(d.style, p.short); return s.w === d.screen.w && s.h === d.screen.h; });
  const custom = !isPreset || d.screen.preset === 'custom';
  const auto = autoDpi(d.style, d.screen.w, d.screen.h);
  const ramOpts = C.ram, coreOpts = C.cores, stoOpts = C.storage;
  return `<h2>Hardware</h2><p class="lead">What this device gets from your ${host.platform === 'darwin' ? 'Mac' : 'PC'} (${fmtRam(host.ramMB)}, ${host.cores} cores). You can change all of this later.</p>
    <div class="form-row"><div class="label">Resolution</div><div class="col" style="gap:10px">
      <div class="chips">${presets.map((p) => { const s = sizeFor(d.style, p.short); return `<button class="chip ${!custom && isPreset === p ? 'on' : ''}" data-res="${p.short}">${p.label}<small>${s.w}×${s.h}</small></button>`; }).join('')}<button class="chip ${custom ? 'on' : ''}" data-res="custom">Custom</button></div>
      ${custom ? `<div class="row"><input class="input tnum" id="wW" type="number" min="320" max="4096" step="2" value="${d.screen.w}" style="width:96px"><span class="muted">×</span><input class="input tnum" id="wH" type="number" min="320" max="4096" step="2" value="${d.screen.h}" style="width:96px"><span class="hint">pixels, width × height</span></div>` : ''}
      <div class="row"><span class="small muted">Density</span><select class="select" id="wDpi" style="height:30px"><option value="">Auto (${auto} dpi)</option>${C.densities.map((x) => `<option value="${x}" ${d.screen.dpi === x ? 'selected' : ''}>${x} dpi</option>`).join('')}</select><span class="hint">Higher makes text and buttons bigger.</span></div>
    </div></div>
    <div class="form-row"><div class="label">Memory<small>RAM</small></div><div class="chips">${ramOpts.map((m) => `<button class="chip ${d.ramMB === m ? 'on' : ''}" data-ram="${m}" ${m > lim.ramMB ? 'disabled title="More than this computer can spare"' : ''}>${fmtRam(m)}</button>`).join('')}</div></div>
    <div class="form-row"><div class="label">Processor<small>Virtual cores</small></div><div class="chips">${coreOpts.map((c) => `<button class="chip ${d.cores === c ? 'on' : ''}" data-cores="${c}" ${c > lim.cores ? 'disabled title="More than this computer can spare"' : ''}>${c} cores</button>`).join('')}</div></div>
    <div class="form-row"><div class="label">Storage<small>Space for apps and files</small></div><div class="col" style="gap:8px"><div class="chips">${stoOpts.map((g) => `<button class="chip ${d.storageGB === g ? 'on' : ''}" data-sto="${g}">${g} GB</button>`).join('')}<button class="chip ${!stoOpts.includes(d.storageGB) ? 'on' : ''}" data-sto="custom">Custom</button></div>
      ${!stoOpts.includes(d.storageGB) || W.customSto ? `<div class="row"><input class="input tnum" id="wSto" type="number" min="8" max="2048" value="${d.storageGB}" style="width:96px"><span class="hint">GB. Disk space is only used as the device fills up.</span></div>` : '<span class="hint">Disk space is only used as the device fills up.</span>'}</div></div>
    <div class="form-row"><div class="label">Graphics</div><div class="col" style="gap:6px"><div class="seg">${[['auto', 'Automatic'], ['host', 'Hardware'], ['swiftshader_indirect', 'Software']].map(([v, l]) => `<button data-gpu="${v}" class="${d.options.gpu === v ? 'on' : ''}">${l}</button>`).join('')}</div><span class="hint">Software is slower but helps if a device shows a black screen.</span></div></div>
    <div class="form-row"><div class="label">Extras</div><div class="col" style="gap:10px">
      ${toggleRow('quickBoot', 'Quick Boot', 'Resume where you left off instead of booting from scratch.')}
      ${toggleRow('audio', 'Sound', 'Play the device\'s sound through your speakers.')}
      ${toggleRow('clipboard', 'Shared clipboard', 'Copy on your computer, paste on the device, and back.')}
      ${toggleRow('microphone', 'Microphone', 'Let apps on the device hear your computer\'s microphone.')}
    </div></div>`;
}
function toggleRow(key, title, sub) {
  return `<div class="row" style="align-items:flex-start;gap:12px"><button class="switch ${W.draft.options[key] ? 'on' : ''}" data-opt="${key}"></button><div><div style="font-weight:600;font-size:13px">${title}</div><div class="hint">${sub}</div></div></div>`;
}

function stepConnect() {
  const d = W.draft, n = d.network, l = d.location;
  return `<h2>Network & location</h2><p class="lead">How the device reaches the internet, and where it thinks it is.</p>
    <div class="label" style="margin-bottom:8px">Network</div>
    <div class="choices c3">
      ${choice('net', 'internet', n.mode, 'wifi', 'Internet', 'Online through your computer\'s connection.')}
      ${choice('net', 'isolated', n.mode, 'shield', 'Isolated', 'No internet at all. Good for testing apps offline.')}
      ${choice('net', 'proxy', n.mode, 'route', 'Proxy', 'Send all traffic through an HTTP proxy.')}
    </div>
    ${n.mode === 'proxy' ? `<div class="row" style="margin-top:10px"><input class="input" id="wProxy" placeholder="host:port, e.g. 127.0.0.1:8080 or user:pass@proxy.example:3128" value="${esc(n.proxy || '')}" style="flex:1"></div>` : ''}
    <div class="label" style="margin:22px 0 8px">Location</div>
    <div class="choices c3">
      ${choice('loc', 'actual', l.mode, 'globe', 'Actual', 'Roughly where you are, from your internet connection.')}
      ${choice('loc', 'simulated', l.mode, 'route', 'Simulated', 'A city of your choice, standing still, walking or driving.')}
      ${choice('loc', 'manual', l.mode, 'pin', 'Pick on map', 'Any exact spot, from search or a click on the map.')}
    </div>
    ${l.mode === 'simulated' ? `<div class="row" style="margin-top:12px;gap:10px"><select class="select" id="wCity" style="min-width:220px">${S.init.cities.map((c) => `<option value="${c.id}" ${l.city === c.id ? 'selected' : ''}>${esc(c.name)}, ${c.country}</option>`).join('')}</select>
      <div class="seg">${[['still', 'Still'], ['walk', 'Walking'], ['drive', 'Driving']].map(([v, t]) => `<button data-motion="${v}" class="${l.motion === v ? 'on' : ''}">${t}</button>`).join('')}</div></div>` : ''}
    ${l.mode === 'manual' ? `<div class="row" style="margin-top:12px"><div class="search-hero" style="height:36px;flex:1;border-radius:10px">${icon('search', 16)}<input id="wPlace" placeholder="Search a place or paste coordinates (29.76, -95.37)"></div><button class="btn" data-w="findPlace">Find</button></div>
      <div class="map" id="wMap"></div><div class="hint" id="wCoords" style="margin-top:6px">${Number.isFinite(l.lat) ? `${l.lat.toFixed(5)}, ${l.lng.toFixed(5)}${l.label ? ` · ${esc(l.label)}` : ''}` : 'Click the map to drop a pin.'}</div>` : ''}
    ${l.mode === 'actual' ? `<div class="hint" style="margin-top:10px" id="wApprox">Uses your approximate location (city level). Nothing is shared beyond the device.</div>` : ''}`;
}
function choice(kind, val, cur, ic, title, sub) {
  return `<button class="choice ${cur === val ? 'on' : ''}" data-${kind}="${val}"><span class="tick">${icon('check', 12)}</span><span class="ch-title"><span class="ch-ic">${icon(ic, 16)}</span>${title}</span><span class="ch-sub">${sub}</span></button>`;
}
function mountMap() {
  const el = $('#wMap'); if (!el || !window.L) return;
  const l = W.draft.location;
  const start = Number.isFinite(l.lat) ? [l.lat, l.lng] : [29.7604, -95.3698];
  W.map = L.map(el, { zoomControl: true, attributionControl: true }).setView(start, Number.isFinite(l.lat) ? 13 : 10);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(W.map);
  W.marker = Number.isFinite(l.lat) ? L.marker(start).addTo(W.map) : null;
  W.map.on('click', (e) => setPin(e.latlng.lat, e.latlng.lng, ''));
  setTimeout(() => W?.map?.invalidateSize(), 50);
}
function setPin(lat, lng, label) {
  const l = W.draft.location;
  l.lat = +lat; l.lng = +lng; l.label = label || '';
  if (W.map) { if (W.marker) W.marker.setLatLng([lat, lng]); else W.marker = L.marker([lat, lng]).addTo(W.map); W.map.setView([lat, lng], Math.max(W.map.getZoom(), 13)); }
  const c = $('#wCoords'); if (c) c.textContent = `${(+lat).toFixed(5)}, ${(+lng).toFixed(5)}${label ? ` · ${label}` : ''}`;
  wPreview();
}
async function findPlace() {
  const q = $('#wPlace').value.trim(); if (!q) return;
  const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) return setPin(+m[1], +m[2], '');
  try { const r = await call('location:search', q); if (!r.length) return toast({ kind: 'bad', title: 'No place found', text: q }); setPin(r[0].lat, r[0].lng, r[0].label); }
  catch (e) { toast({ kind: 'bad', title: 'Search failed', text: e.message }); }
}

function stepReview() {
  const d = W.draft, st = S.init.catalog.styles[d.style];
  const p = W.plan;
  const lic = p?.licenses || [];
  return `<h2>Ready to build</h2><p class="lead">Check the details, then Droid sets everything up.</p>
    <div class="review">
      <div><span class="label">Name</span>${esc(d.name)}</div>
      <div><span class="label">Look</span>${esc(st.name)}</div>
      <div><span class="label">Android</span>${d.image ? `${esc(d.image.name)} · ${esc(d.image.tagName)}` : '<span style="color:var(--bad)">Not chosen</span>'}</div>
      <div><span class="label">Screen</span>${d.screen.w}×${d.screen.h} · ${d.screen.dpi || autoDpi(d.style, d.screen.w, d.screen.h)} dpi</div>
      <div><span class="label">Memory · cores · storage</span>${fmtRam(d.ramMB)} · ${d.cores} core${d.cores === 1 ? '' : 's'} · ${d.storageGB} GB</div>
      <div><span class="label">Network · location</span>${{ internet: 'Internet', isolated: 'Isolated', proxy: `Proxy ${esc(d.network.proxy)}` }[d.network.mode]} · ${locLabel(d.location)}</div>
    </div>
    <div class="need">${!p ? '<div class="row muted"><span class="spin"></span>Checking what needs downloading…</div>'
      : p.items.length ? `<div class="label" style="margin-top:6px">Downloads first (${fmtBytes(p.items.reduce((a, i) => a + (i.size || 0), 0))})</div>${p.items.map((i) => `<div class="need-row"><span>${esc(i.label)}</span><span class="tnum muted">${fmtBytes(i.size)}</span></div>`).join('')}`
        : `<div class="need-row"><span>${icon('check', 15)} Everything this device needs is already downloaded.</span></div>`}</div>
    ${lic.length ? `<label class="check" style="margin-top:14px"><input type="checkbox" id="wLic" ${W.accepted ? 'checked' : ''}><span>I accept the ${lic.map((l) => `<a href="#" data-lic="${esc(l)}" style="color:var(--acc)">${esc(licName(l))}</a>`).join(' and ')} for the Android emulator and system images from Google.</span></label>` : ''}
    <div class="row" style="margin-top:16px;gap:12px"><button class="switch ${d.start ? 'on' : ''}" data-w="toggleStart"></button><div><div style="font-weight:600;font-size:13px">Start it when it's ready</div><div class="hint">Opens the device in its own window once set up.</div></div></div>`;
}
const licName = (id) => ({ 'android-sdk-license': 'Android SDK License', 'android-sdk-preview-license': 'Android SDK Preview License', 'android-sdk-arm-dbt-license': 'Android SDK ARM License' }[id] || id);

async function loadPlan() {
  if (!W.draft.image) return;
  if (W.plan && W.plan.for === W.draft.image.path) return;
  try {
    const items = (await call('sdk:plan', W.draft.image.path)).filter((i) => i.kind !== 'missing');
    const accepted = new Set(S.init.settings.licensesAccepted || []);
    const licenses = [...new Set(items.map((i) => i.license).filter(Boolean))].filter((l) => !accepted.has(l));
    W.plan = { for: W.draft.image.path, items, licenses };
  } catch (e) { W.plan = { for: W.draft.image.path, items: [], licenses: [], err: e.message }; }
  if (W && W.step === 'review') { $('#wMain').innerHTML = stepReview(); hydrateIcons($('#wMain')); wFoot(); }
}

// ── events
function wizardClick(e) {
  if (!W) return;
  const t = e.target;
  const b = (sel) => t.closest(sel);
  const d = W.draft;
  let el;
  if ((el = b('[data-step]'))) { if (W.edit || STEPS.findIndex((s) => s.id === el.dataset.step) <= STEPS.findIndex((s) => s.id === W.step) || (d.image && el.dataset.step !== 'android') || el.dataset.step === 'android') { W.step = el.dataset.step; wRender(); after(); } return; }
  if ((el = b('[data-w]'))) {
    const a = el.dataset.w;
    if (a === 'cancel') return closeWizard();
    if (a === 'next' || a === 'back') { const i = STEPS.findIndex((s) => s.id === W.step) + (a === 'next' ? 1 : -1); W.step = STEPS[Math.max(0, Math.min(STEPS.length - 1, i))].id; wRender(); return after(); }
    if (a === 'retryImages') { S.images = null; wRender(); return loadImages(true); }
    if (a === 'findPlace') return findPlace();
    if (a === 'toggleStart') { d.start = !d.start; el.classList.toggle('on', d.start); return wFoot(); }
    if (a === 'create' || a === 'save') return submit();
  }
  if ((el = b('[data-lic]'))) { e.preventDefault(); return showLicense(el.dataset.lic); }
  if ((el = b('[data-style]'))) {
    const st = S.init.catalog.styles[el.dataset.style];
    const wasTablet = S.init.catalog.styles[d.style].tablet;
    d.style = st.id; d.finish = st.finishes[0].id;
    if (!W.edit || wasTablet !== st.tablet || true) { const s = sizeFor(st.id, st.defaults.res); d.screen = { w: s.w, h: s.h, dpi: null, preset: String(st.defaults.res) }; }
    if (!W.edit && /^(Pixel|Galaxy|Island|Tablet|Custom)/.test(d.name)) d.name = uniqueName(st.short);
    if (!W.edit) { d.ramMB = Math.min(st.defaults.ramMB, S.init.host.limits.ramMB); d.storageGB = st.defaults.storageGB; }
    wRender(); return after();
  }
  if ((el = b('[data-finish]'))) { d.finish = el.dataset.finish; wRender(); return after(); }
  if ((el = b('[data-accent]'))) { d.accent = el.dataset.accent; wRender(); return after(); }
  if ((el = b('[data-image]'))) { const i = (S.images.all || S.images.images).find((x) => x.path === el.dataset.image); if (i) { d.image = pickImage(i); W.plan = null; } wRender(); return; }
  if ((el = b('[data-res]'))) {
    if (el.dataset.res === 'custom') d.screen.preset = 'custom';
    else { const s = sizeFor(d.style, +el.dataset.res); d.screen = { w: s.w, h: s.h, dpi: null, preset: el.dataset.res }; }
    wRender(); return;
  }
  if ((el = b('[data-ram]'))) { d.ramMB = +el.dataset.ram; wRender(); return; }
  if ((el = b('[data-cores]'))) { d.cores = +el.dataset.cores; wRender(); return; }
  if ((el = b('[data-sto]'))) { if (el.dataset.sto === 'custom') W.customSto = true; else { W.customSto = false; d.storageGB = +el.dataset.sto; } wRender(); return; }
  if ((el = b('[data-gpu]'))) { d.options.gpu = el.dataset.gpu; wRender(); return; }
  if ((el = b('[data-opt]'))) { const k = el.dataset.opt; d.options[k] = !d.options[k]; el.classList.toggle('on', d.options[k]); return; }
  if ((el = b('[data-net]'))) { d.network.mode = el.dataset.net; wRender(); if (d.network.mode === 'proxy') setTimeout(() => $('#wProxy')?.focus(), 0); return; }
  if ((el = b('[data-loc]'))) {
    d.location.mode = el.dataset.loc;
    if (d.location.mode === 'simulated' && !d.location.city) d.location.city = 'houston';
    wRender();
    if (d.location.mode === 'actual') call('location:approximate').then((r) => { const h = $('#wApprox'); if (h) h.textContent = `Right now that's about ${r.label}. Nothing is shared beyond the device.`; }).catch(() => {});
    return;
  }
  if ((el = b('[data-motion]'))) { d.location.motion = el.dataset.motion; wRender(); return; }
}
function after() {}
function wizardInput(e) {
  if (!W) return;
  const d = W.draft, t = e.target;
  if (t.id === 'wName') { d.name = t.value; wPreview(); }
  if (t.id === 'wW' || t.id === 'wH') { const v = Math.round(+t.value || 0); if (v >= 320 && v <= 4096) { d.screen[t.id === 'wW' ? 'w' : 'h'] = v - (v % 2); d.screen.preset = 'custom'; wPreview(); } }
  if (t.id === 'wDpi') { d.screen.dpi = t.value ? +t.value : null; wPreview(); }
  if (t.id === 'wSto') { const v = Math.round(+t.value || 0); if (v >= 8) { d.storageGB = Math.min(2048, v); wPreview(); } }
  if (t.id === 'wProxy') d.network.proxy = t.value.trim();
  if (t.id === 'wCity' && e.type === 'change') { d.location.city = t.value; wPreview(); }
  if (t.id === 'wShowAll' && e.type === 'change') { S.init.settings.showAllImages = t.checked; call('settings:set', { showAllImages: t.checked }); $('#wMain').innerHTML = stepAndroid(); hydrateIcons($('#wMain')); }
  if (t.id === 'wLic' && e.type === 'change') { W.accepted = t.checked; wFoot(); }
  if (t.id === 'wPlace' && e.type === 'change') findPlace();
}

async function submit() {
  const d = W.draft;
  if (!d.image) { W.step = 'android'; return wRender(); }
  if (d.network.mode === 'proxy' && !d.network.proxy) { W.step = 'connect'; wRender(); return toast({ kind: 'bad', title: 'Add the proxy address', text: 'Something like 127.0.0.1:8080.' }); }
  if (d.location.mode === 'manual' && !Number.isFinite(d.location.lat)) { W.step = 'connect'; wRender(); return toast({ kind: 'bad', title: 'Pick a spot on the map', text: 'Or search for a place.' }); }
  const payload = { ...d }; delete payload.start; delete payload.state; delete payload.thumb;
  if (!payload.screen.dpi) payload.screen.dpi = autoDpi(d.style, d.screen.w, d.screen.h);
  W.saving = true; wFoot();
  try {
    if (W.plan?.licenses?.length && W.accepted) await call('settings:set', { licensesAccepted: [...new Set([...(S.init.settings.licensesAccepted || []), ...W.plan.licenses])] });
    if (W.edit) {
      const r = await call('devices:update', W.id, payload);
      closeWizard();
      toast({ kind: 'ok', title: 'Saved', text: r.restartNeeded ? 'Restart the device to use the new hardware settings.' : d.name });
    } else {
      await call('devices:create', payload, { start: d.start });
      closeWizard();
    }
    refreshDevices();
  } catch (e) {
    if (W) { W.saving = false; wFoot(); }
    toast({ kind: 'bad', title: 'Could not save the device', text: e.message });
  }
}

function showLicense(id) {
  const text = S.images?.licenses?.[id] || 'The license text could not be loaded.';
  const s = document.createElement('div'); s.className = 'scrim'; s.style.zIndex = 600;
  s.innerHTML = `<div class="panel" style="width:min(720px,90vw);height:min(560px,80vh);display:flex;flex-direction:column;margin:0;box-shadow:var(--shadow-lg)"><h3>${esc(licName(id))}</h3><pre style="flex:1;overflow:auto;white-space:pre-wrap;font-size:11.5px;color:var(--fg-2);background:var(--panel-2);padding:12px;border-radius:10px">${esc(text)}</pre><div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn" data-x>Close</button></div></div>`;
  document.body.appendChild(s);
  s.addEventListener('click', (e) => { if (e.target === s || e.target.closest('[data-x]')) s.remove(); });
}
