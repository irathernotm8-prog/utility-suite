// Mixer window: Sound FX — design game sounds. Pick a kind to roll a new sound, shape it with the sfxr controls,
// stack up to four layers, roll variations side by side, make it 8-bit, then export a pack (WAV, MP3 or a JavaScript
// module) or drop a sound into the song. Everything plays as you change it.
'use strict';
const FXS = { pack: null, sel: null, layer: 0, vars: null, saveT: null, src: null };
const KIND_GROUPS = [
  ['Classic', ['coin', 'laser', 'explosion', 'powerup', 'hit', 'jump', 'blip', 'random']],
  ['Game', ['select', 'confirm', 'cancel', 'footstep', 'whoosh', 'thud', 'magic', 'teleport', 'alarm', 'death', 'heal', 'charge', 'zap', 'bounce', 'shoot', 'door']],
  ['Layered', ['big-explosion', 'sword', 'level-up', 'game-over', 'pickup-gem', 'hurt-voice']],
];
const GROUP_ORDER = ['Envelope', 'Pitch', 'Vibrato', 'Arpeggio', 'Duty', 'Retrigger', 'Phaser', 'Filters'];
const sfxSel = () => FXS.pack && FXS.pack.sounds.find((s) => s.id === FXS.sel);

VIEWS.sfx = {
  flush: true,
  head() { return `<h1>Sound FX</h1><button class="btn sm" id="packBtn">${icon('folder', 14)}<span class="ellip" style="max-width:220px">${esc(FXS.pack ? FXS.pack.name : 'Pack')}</span>${icon('chevronDown', 13)}</button><span class="muted small">${FXS.pack ? plural(FXS.pack.sounds.length, 'sound') : ''}</span>`; },
  actions() { return `<button class="btn sm" id="sfxToSong" ${sfxSel() ? '' : 'disabled'}>${icon('arrange', 15)}Add to song</button><button class="btn sm primary" id="sfxExport">${icon('export', 15)}Export pack</button>`; },
  async render(view) {
    if (!FXS.pack) { view.innerHTML = '<div class="empty"><span class="spin"></span></div>'; FXS.pack = await call('sfx:open', S.settings.activeSfxPack); if (!FXS.sel && FXS.pack.sounds.length) FXS.sel = FXS.pack.sounds[FXS.pack.sounds.length - 1].id; $('#headLeft').innerHTML = this.head(); this.after(); }
    view.innerHTML = `<div class="sfx"><aside class="sfx-list" id="sfxList"></aside><section class="sfx-main" id="sfxMain"></section></div>`;
    drawSfxList(); drawSfxMain(); hydrateIcons(view);
  },
  after() {
    const pb = $('#packBtn'); if (pb) pb.onclick = (e) => packMenu(e.currentTarget);
    const ex = $('#sfxExport'); if (ex) ex.onclick = sfxExportSheet;
    const ts = $('#sfxToSong'); if (ts) ts.onclick = (e) => sfxToSongMenu(e.currentTarget);
    hydrateIcons($('#head'));
  },
  update() { drawSfxList(); drawSfxMain(); },
};
async function packMenu(anchor) {
  const { list } = await call('sfx:packs');
  menu(anchor, [{ header: true, label: 'Sound packs' }, ...list.map((p) => ({ label: p.name, hint: String(p.count), on: FXS.pack && p.id === FXS.pack.id, run: async () => { FXS.pack = await call('sfx:open', p.id); FXS.sel = FXS.pack.sounds.length ? FXS.pack.sounds[0].id : null; FXS.vars = null; render(); } })), '-',
    { label: 'New pack…', icon: 'plus', run: async () => { const n = await promptBox({ title: 'New sound pack', text: 'One pack per game keeps things tidy.', placeholder: 'e.g. Skyline Protocol', ok: 'Create' }); if (n) { FXS.pack = await call('sfx:create', n); FXS.sel = null; FXS.vars = null; render(); } } },
    { label: 'Rename…', icon: 'edit', run: async () => { const n = await promptBox({ title: 'Rename pack', value: FXS.pack.name }); if (n) { FXS.pack = await call('sfx:rename', FXS.pack.id, n); render(); } } },
    { label: 'Show the pack folder', icon: 'folder', run: () => call('sfx:reveal', FXS.pack.id) }], { width: 280 });
}
function drawSfxList() {
  const el = $('#sfxList'); if (!el) return; const P = FXS.pack;
  el.innerHTML = `<button class="btn sm primary" id="sfxNew" style="width:100%">${icon('plus', 14)}New sound</button>
    <div class="sfx-items">${P.sounds.map((s) => `<div class="sfx-item ${s.id === FXS.sel ? 'on' : ''}" data-id="${s.id}"><button class="icon-btn xs" data-play title="Play">${icon('play', 12)}</button><div class="grow" style="min-width:0"><div class="ellip"><b>${esc(s.name)}</b></div><div class="muted tiny">${esc(MXSfx.KINDS[s.kind] || 'Custom')} · ${MXSfx.describe(s).seconds}s${s.layers.length > 1 ? ` · ${s.layers.length} layers` : ''}${s.bits < 16 ? ' · 8-bit' : ''}</div></div><button class="icon-btn xs" data-more>${icon('more', 13)}</button></div>`).join('') || `<div class="muted small" style="padding:14px 6px">No sounds yet. Pick a kind on the right — coin, jump, explosion… — and one is made for you.</div>`}</div>`;
  hydrateIcons(el);
  $('#sfxNew').onclick = (e) => kindMenu(e.currentTarget);
  $$('.sfx-item', el).forEach((it) => { const s = P.sounds.find((x) => x.id === it.dataset.id);
    it.onclick = (e) => { if (e.target.closest('[data-more]')) return; if (e.target.closest('[data-play]')) { playSfx(s); return; } FXS.sel = s.id; FXS.vars = null; FXS.layer = 0; drawSfxList(); drawSfxMain(); playSfx(s); $('#sfxToSong').disabled = false; };
    $('[data-more]', it).onclick = (e) => menu(e.currentTarget, [
      { label: 'Rename…', icon: 'edit', run: async () => { const n = await promptBox({ title: 'Sound name', value: s.name }); if (n) { s.name = n; await saveSfx(s, true); drawSfxList(); } } },
      { label: 'Duplicate', icon: 'dup', run: async () => { const c = JSON.parse(JSON.stringify(s)); delete c.id; c.name = uniqueSfx(s.name + ' copy'); const n = await call('sfx:save', P.id, c); P.sounds.push(n); FXS.sel = n.id; render(); } },
      { label: 'Export just this…', icon: 'export', run: () => sfxExportSheet([s.id]) },
      '-', { label: 'Delete', icon: 'trash', danger: true, run: async () => { await call('sfx:remove', P.id, s.id); P.sounds = P.sounds.filter((x) => x !== s); if (FXS.sel === s.id) FXS.sel = P.sounds.length ? P.sounds[P.sounds.length - 1].id : null; render(); } }]);
  });
}
function kindMenu(anchor) { const items = []; for (const [g, ks] of KIND_GROUPS) { items.push({ header: true, label: g }); for (const k of ks) items.push({ label: MXSfx.KINDS[k], run: () => rollKind(k) }); } menu(anchor, items, { width: 230 }); }
const uniqueSfx = (n) => { let name = n, i = 2; while (FXS.pack.sounds.some((s) => s.name.toLowerCase() === name.toLowerCase())) name = `${n} ${i++}`; return name; };
async function rollKind(k) { const snd = MXSfx.generate(k, Math.floor(Math.random() * 1e9)); snd.name = uniqueSfx(MXSfx.KINDS[k]); snd.gain = 0; snd.bits = 16; snd.rate = 44100; const saved = await call('sfx:save', FXS.pack.id, snd); FXS.pack.sounds.push(saved); FXS.sel = saved.id; FXS.vars = null; FXS.layer = 0; render(); playSfx(saved); }

function drawSfxMain() {
  const el = $('#sfxMain'); if (!el) return; const s = sfxSel();
  const chips = KIND_GROUPS.map(([g, ks]) => `<div class="kind-row"><span class="kind-h">${g}</span>${ks.map((k) => `<button class="kind" data-k="${k}">${esc(MXSfx.KINDS[k])}</button>`).join('')}</div>`).join('');
  if (!s) { el.innerHTML = `<div class="kinds">${chips}</div><div class="empty"><b>Make your first sound</b><span>Click a kind above. Every click rolls a fresh take you can shape, layer and export for your game.</span></div>`; bindKinds(el); return; }
  const L = s.layers[Math.min(FXS.layer, s.layers.length - 1)]; FXS.layer = s.layers.indexOf(L);
  const groups = {}; for (const [k, v] of Object.entries(MXSfx.PARAMS)) if (k !== 'wave') (groups[v[3]] = groups[v[3]] || []).push(k);
  const slider = (k) => { const [min, max, , , label] = MXSfx.PARAMS[k]; return `<div class="kv sp"><span title="${esc(k)}">${esc(label)}</span><input type="range" data-p="${k}" min="${min}" max="${max}" step="0.001" value="${L.params[k]}"><output>${(+L.params[k]).toFixed(2)}</output></div>`; };
  el.innerHTML = `<div class="kinds">${chips}</div>
    <div class="sfx-stage"><canvas id="sfxCv"></canvas><button class="sfx-play" id="sfxPlay" title="Play (Space)">${icon('play', 22)}</button><div class="sfx-facts" id="sfxFacts"></div></div>
    <div class="sfx-tools"><input class="input sm" id="sfxName" value="${esc(s.name)}" style="width:200px" spellcheck="false"><button class="btn sm" id="sfxMutate" title="Small random changes">${icon('sparkle', 14)}Mutate</button><button class="btn sm" id="sfxVars">${icon('drafts', 14)}Variations</button><span class="vsep"></span>
      <button class="btn sm ${s.bits < 16 || s.rate < 44100 ? 'on-acc' : ''}" id="sfxRetro" title="8-bit, 22 kHz">${icon('zap', 14)}8-bit</button><select class="select sm" id="sfxBits" title="Bit depth">${[16, 8, 6, 4].map((b) => `<option value="${b}" ${s.bits === b ? 'selected' : ''}>${b}-bit</option>`).join('')}</select><select class="select sm" id="sfxRate" title="Sample rate">${[[44100, '44.1 kHz'], [22050, '22 kHz'], [11025, '11 kHz'], [5512, '5.5 kHz']].map(([r, l]) => `<option value="${r}" ${s.rate === r ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label class="tp-field" style="height:28px">Gain<input id="sfxGain" type="number" step="1" min="-30" max="12" value="${s.gain}" style="width:46px"></label></div>
    <div id="sfxVarsHost"></div>
    <div class="layers"><div class="seg" id="layerSeg">${s.layers.map((x, i) => `<button data-l="${i}" class="${i === FXS.layer ? 'on' : ''}">${x.on === false ? '○ ' : ''}Layer ${i + 1}</button>`).join('')}</div>${s.layers.length < 4 ? `<button class="btn xs" id="addLayer">${icon('plus', 12)}Layer</button>` : ''}
      <span class="grow"></span>${s.layers.length > 1 ? `<label class="chk"><input type="checkbox" id="lOn" ${L.on !== false ? 'checked' : ''}>On</label><label class="tp-field" style="height:26px">Delay<input id="lDelay" type="number" min="0" max="4" step="0.01" value="${L.delay}" style="width:52px">s</label><label class="tp-field" style="height:26px">Gain<input id="lGain" type="number" min="-40" max="12" step="1" value="${L.gain}" style="width:44px">dB</label><label class="tp-field" style="height:26px">Pitch<input id="lPitch" type="number" min="-24" max="24" step="1" value="${L.pitch}" style="width:44px">st</label><button class="icon-btn xs" id="rmLayer" title="Remove this layer">${icon('trash', 13)}</button>` : `<label class="tp-field" style="height:26px">Pitch<input id="lPitch" type="number" min="-24" max="24" step="1" value="${L.pitch}" style="width:44px">st</label>`}<button class="btn xs ghost" id="layerKind" title="Replace this layer with a new roll of a kind">${icon('refresh', 12)}Re-roll layer…</button></div>
    <div class="sfx-params"><div class="pg"><div class="pg-h">Wave</div><div class="seg full" id="waveSeg">${MXSfx.WAVES.map((w, i) => `<button data-w="${i}" class="${L.params.wave === i ? 'on' : ''}">${w}</button>`).join('')}</div></div>${GROUP_ORDER.map((g) => `<div class="pg"><div class="pg-h">${g}</div>${groups[g].map(slider).join('')}</div>`).join('')}</div>`;
  hydrateIcons(el); bindKinds(el); bindSfxEditor(s); drawSfxWave(s); if (FXS.vars) drawVariations(s);
}
function bindKinds(el) { $$('.kind', el).forEach((b) => b.onclick = () => rollKind(b.dataset.k)); }
function bindSfxEditor(s) {
  const L = () => s.layers[FXS.layer]; const changed = (play = true, redraw = false) => { saveSfx(s); drawSfxWave(s); if (play) playSfx(s); if (redraw) drawSfxMain(); drawSfxListItem(s); };
  $$('[data-p]').forEach((r) => { r.oninput = () => { L().params[r.dataset.p] = +r.value; r.nextElementSibling.textContent = (+r.value).toFixed(2); }; r.onchange = () => { s.kind = s.kind === 'custom' ? 'custom' : s.kind; changed(); }; r.ondblclick = () => { r.value = MXSfx.PARAMS[r.dataset.p][2]; r.oninput(); changed(); }; });
  $$('#waveSeg [data-w]').forEach((b) => b.onclick = () => { L().params.wave = +b.dataset.w; $$('#waveSeg button').forEach((x) => x.classList.toggle('on', x === b)); changed(); });
  $$('#layerSeg [data-l]').forEach((b) => b.onclick = () => { FXS.layer = +b.dataset.l; drawSfxMain(); });
  const add = $('#addLayer'); if (add) add.onclick = (e) => { const items = [{ header: true, label: 'New layer from' }, { label: 'A copy of this layer', run: () => { s.layers.push({ ...JSON.parse(JSON.stringify(L())), seed: s.layers.length + 1 }); FXS.layer = s.layers.length - 1; changed(true, true); } }]; for (const k of ['thud', 'whoosh', 'blip', 'explosion', 'coin', 'hit', 'magic', 'zap']) items.push({ label: MXSfx.KINDS[k], run: () => { const g = MXSfx.generate(k, Math.floor(Math.random() * 1e9)).layers[0]; s.layers.push({ ...g, seed: s.layers.length + 1, gain: -4 }); FXS.layer = s.layers.length - 1; changed(true, true); } }); menu(e.currentTarget, items, { width: 220 }); };
  const rk = $('#layerKind'); rk.onclick = (e) => { const items = []; for (const [g, ks] of KIND_GROUPS.slice(0, 2)) { items.push({ header: true, label: g }); for (const k of ks) items.push({ label: MXSfx.KINDS[k], run: () => { const g0 = MXSfx.generate(k, Math.floor(Math.random() * 1e9)).layers[0]; s.layers[FXS.layer] = { ...L(), params: g0.params }; if (s.layers.length === 1) s.kind = k; changed(true, true); } }); } menu(e.currentTarget, items, { width: 220 }); };
  const num = (id, key, f = (v) => v) => { const i = $(id); if (i) i.onchange = () => { L()[key] = f(+i.value); changed(true, key === 'on'); }; };
  num('#lDelay', 'delay', (v) => Math.max(0, Math.min(4, v))); num('#lGain', 'gain'); num('#lPitch', 'pitch', (v) => Math.max(-24, Math.min(24, Math.round(v))));
  const on = $('#lOn'); if (on) on.onchange = () => { L().on = on.checked; changed(true, true); };
  const rm = $('#rmLayer'); if (rm) rm.onclick = () => { s.layers.splice(FXS.layer, 1); FXS.layer = Math.max(0, FXS.layer - 1); changed(true, true); };
  $('#sfxPlay').onclick = () => playSfx(s);
  $('#sfxName').onchange = (e) => { s.name = e.target.value.trim() || s.name; changed(false); };
  $('#sfxMutate').onclick = () => { const m = MXSfx.mutateSound(s, 0.3, Math.floor(Math.random() * 1e9)); s.layers = m.layers; s.kind = s.kind; changed(true, true); };
  $('#sfxVars').onclick = () => { FXS.vars = Array.from({ length: 6 }, (_, i) => ({ ...MXSfx.mutateSound(s, 0.35, Math.floor(Math.random() * 1e9) + i), name: `${s.name} ${String.fromCharCode(65 + i)}` })); drawVariations(s); };
  $('#sfxRetro').onclick = () => { const retro = s.bits < 16 || s.rate < 44100; s.bits = retro ? 16 : 8; s.rate = retro ? 44100 : 22050; changed(true, true); };
  $('#sfxBits').onchange = (e) => { s.bits = +e.target.value; changed(true, true); }; $('#sfxRate').onchange = (e) => { s.rate = +e.target.value; changed(true, true); };
  $('#sfxGain').onchange = (e) => { s.gain = Math.max(-30, Math.min(12, +e.target.value || 0)); changed(); };
  const cv = $('#sfxCv'); cv.onclick = () => playSfx(s);
}
function drawSfxListItem(s) { const it = $(`.sfx-item[data-id="${s.id}"] .muted`); if (it) it.textContent = `${MXSfx.KINDS[s.kind] || 'Custom'} · ${MXSfx.describe(s).seconds}s${s.layers.length > 1 ? ` · ${s.layers.length} layers` : ''}${s.bits < 16 ? ' · 8-bit' : ''}`; const n = $(`.sfx-item[data-id="${s.id}"] b`); if (n) n.textContent = s.name; }
function saveSfx(s, now) { clearTimeout(FXS.saveT); const go = () => call('sfx:save', FXS.pack.id, s).catch(fail); if (now) return go(); FXS.saveT = setTimeout(go, 300); }
function drawSfxWave(s) {
  const cv = $('#sfxCv'); if (!cv) return; const { g, w, h } = fitCanvas(cv); const y = MXSfx.render(s); const secs = y.length / MXSfx.SR;
  g.fillStyle = cssv('--lane'); g.fillRect(0, 0, w, h); const half = Math.floor(w * 0.58);
  const pk = MXAnalysis.peaks(y, half - 20); const mid = h / 2; const col = cssv('--acc');
  g.fillStyle = cssv('--grid-2'); g.fillRect(10, mid, half - 20, 1); g.fillStyle = col; for (let x = 0; x < half - 20; x++) { const lo = pk[2 * x], hi = pk[2 * x + 1]; g.fillRect(10 + x, mid - hi * (h / 2 - 12), 1, Math.max(1, (hi - lo) * (h / 2 - 12))); }
  const sw = w - half - 10, sh = h - 20; const S = MXAnalysis.spectrogram(y, MXSfx.SR, sw, 96, 512, 16);
  if (S.cols) { const tmp = document.createElement('canvas'); tmp.width = S.cols; tmp.height = S.rows; const tg = tmp.getContext('2d'); const img = tg.createImageData(S.cols, S.rows); let mx = -120; for (const v of S.data) if (v > mx) mx = v; for (let k = 0; k < S.rows * S.cols; k++) { const r = Math.floor(k / S.cols), cc = k % S.cols; const v = Math.max(0, Math.min(1, (S.data[r * sw + cc] - (mx - 70)) / 70)); img.data.set([Math.round(13 + v * 57), Math.round(17 + v * 210), Math.round(23 + v * 232), 255], k * 4); } tg.putImageData(img, 0, 0); g.drawImage(tmp, half, 10, sw, sh); }
  g.fillStyle = cssv('--mut'); g.font = '600 11px system-ui'; g.fillText(`${secs.toFixed(2)} s`, 14, h - 10); g.fillText('spectrogram', half + 6, h - 4);
  const d = MXSfx.describe(s); const f = $('#sfxFacts'); if (f) f.innerHTML = `<span class="pill">${d.seconds}s</span><span class="pill">${esc(d.wave)}${d.start_hz ? ` · ${d.start_hz} Hz` : ''}</span>${s.layers.length > 1 ? `<span class="pill">${s.layers.length} layers</span>` : ''}${s.bits < 16 || s.rate < 44100 ? `<span class="pill acc">${s.bits}-bit · ${Math.round(s.rate / 100) / 10} kHz</span>` : ''}`;
}
function drawVariations(s) {
  const host = $('#sfxVarsHost'); if (!host || !FXS.vars) return;
  host.innerHTML = `<div class="vars"><div class="row" style="margin-bottom:6px"><b class="small">Variations</b><span class="muted tiny grow">Click to hear · Use replaces the sound · Keep saves it as a new one</span><button class="btn xs" id="varsAgain">${icon('refresh', 12)}Roll again</button><button class="icon-btn xs" id="varsClose">${icon('x', 13)}</button></div><div class="var-grid">${FXS.vars.map((v, i) => `<div class="var" data-i="${i}"><div class="var-cv"><canvas></canvas></div><div class="row"><b class="tiny grow">${String.fromCharCode(65 + i)} · ${MXSfx.describe(v).seconds}s</b><button class="btn xs" data-use>Use</button><button class="btn xs" data-keep>Keep</button></div></div>`).join('')}</div></div>`;
  hydrateIcons(host);
  $$('.var', host).forEach((el) => { const v = FXS.vars[+el.dataset.i]; const cv = $('canvas', el); const { g, w, h } = fitCanvas(cv); const y = MXSfx.render(v); const pk = MXAnalysis.peaks(y, w); g.fillStyle = cssv('--acc'); for (let x = 0; x < w; x++) g.fillRect(x, h / 2 - pk[2 * x + 1] * h * 0.45, 1, Math.max(1, (pk[2 * x + 1] - pk[2 * x]) * h * 0.45));
    el.onclick = (e) => { if (e.target.closest('button')) return; playSfx(v); $$('.var', host).forEach((x) => x.classList.toggle('on', x === el)); };
    $('[data-use]', el).onclick = () => { s.layers = JSON.parse(JSON.stringify(v.layers)); FXS.vars = null; saveSfx(s, true); drawSfxMain(); playSfx(s); };
    $('[data-keep]', el).onclick = async () => { const c = JSON.parse(JSON.stringify({ ...s, ...v })); delete c.id; c.name = uniqueSfx(v.name); const n = await call('sfx:save', FXS.pack.id, c); FXS.pack.sounds.push(n); drawSfxList(); toast('Kept', n.name, 'ok', 1800); };
  });
  $('#varsAgain').onclick = () => $('#sfxVars').click(); $('#varsClose').onclick = () => { FXS.vars = null; host.innerHTML = ''; };
}
function playSfx(s) {
  try { const ctx = Player.ensure(); if (FXS.src) try { FXS.src.stop(); } catch {} const y = MXSfx.render(s); const b = ctx.createBuffer(1, y.length, MXSfx.SR); b.copyToChannel(y, 0); const src = ctx.createBufferSource(); src.buffer = b; src.connect(Player.out); src.start(); FXS.src = src;
    const ph = $('.sfx-stage'); if (ph) { ph.classList.remove('pulse'); void ph.offsetWidth; ph.classList.add('pulse'); } } catch (e) { fail(e); }
}
document.addEventListener('keydown', (e) => { if (S.view !== 'sfx' || e.code !== 'Space' || /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName) || $('#sheetHost').firstChild) return; e.preventDefault(); e.stopImmediatePropagation(); const s = sfxSel(); if (s) playSfx(s); }, true);

function sfxExportSheet(ids) {
  const P = FXS.pack; const only = Array.isArray(ids) ? ids : null;
  const el = openSheet(`<div class="sheet-head">${icon('export', 20)}<div class="grow"><h3>Export ${only ? `“${esc(P.sounds.find((x) => x.id === only[0]).name)}”` : `“${esc(P.name)}”`}</h3><div class="muted small">${only ? '1 sound' : plural(P.sounds.length, 'sound')} · for Godot, Unity, GameMaker, Phaser, or any web game</div></div></div>
    <div class="sheet-body"><div class="opt-grid">
      <label>Format</label><div class="seg" id="sxFmt"><button data-f="wav" class="on">WAV</button><button data-f="mp3">MP3</button><button data-f="js">JS module</button><button data-f="all">All</button></div>
      <label></label><div class="hint" id="sxHint">16-bit mono WAV files and a sounds.json listing them. Works in every engine.</div>
      <label>Variations</label><div class="row"><select class="select sm" id="sxVar">${[0, 2, 3, 4, 6].map((n) => `<option value="${n}">${n ? `${n} extra takes of each (name_1…)` : 'None'}</option>`).join('')}</select></div>
      <label>Folder</label><div class="row"><span class="muted small grow ellip" id="sxDest">${esc(P.exportDir ? tildify(P.exportDir) : 'The pack’s exports folder')}</span><button class="btn xs" id="sxWhere">${icon('folder', 12)}Choose…</button></div>
    </div></div>
    <div class="sheet-foot"><span class="grow"></span><button class="btn" id="sxCancel">Cancel</button><button class="btn primary" id="sxGo">${icon('export', 15)}Export</button></div>`, { width: 600 });
  let fmt = 'wav', folder = P.exportDir || null; const hints = { wav: '16-bit mono WAV files and a sounds.json listing them. Works in every engine.', mp3: 'MP3 files (smaller) and sounds.json — good for web games.', js: 'One small JavaScript module that synthesizes the sounds in the browser: import { play } from it and call play("coin"). No audio files to load.', all: 'WAV, MP3 and the JavaScript module.' };
  $$('#sxFmt [data-f]', el).forEach((b) => b.onclick = () => { fmt = b.dataset.f; $$('#sxFmt button', el).forEach((x) => x.classList.toggle('on', x === b)); $('#sxHint').textContent = hints[fmt]; });
  $('#sxCancel').onclick = closeSheet;
  $('#sxWhere').onclick = async () => { const d = await call('dialog:folder'); if (d) { folder = d; $('#sxDest').textContent = tildify(d); } };
  $('#sxGo').onclick = async () => { try { const r = await call('sfx:export', { pack: P.id, ids: only, format: fmt, folder, variations: +$('#sxVar').value }); closeSheet(); P.exportDir = folder || P.exportDir; const t = toast('Exported', `${plural(r.files.length, 'file')} in ${tildify(r.folder)}`, 'ok', 8000); t.style.cursor = 'pointer'; t.onclick = () => reveal(r.files[0]); } catch (e) { fail(e); } };
}
function sfxToSongMenu(anchor) {
  const s = sfxSel(); if (!s) return; const drums = S.song.tracks.filter((t) => t.kind === 'drums');
  const place = async (o, label) => { try { await call('sfx:toSong', { pack: FXS.pack.id, sound: s.id, ...o }); toast(label, `In “${S.song.name}”`, 'ok', 3000); } catch (e) { fail(e); } };
  menu(anchor, [{ header: true, label: `Put “${s.name}” in ${S.song.name}` }, { label: `As a clip at the playhead (bar ${SG.fmtPos(S.song, Player.position()).split('.')[0]})`, icon: 'wave', run: () => { const b = Player.position(); const bar = Math.floor(b / SG.bpb(S.song)) + 1; place({ at_bar: bar, beat: +(b - SG.barToBeat(S.song, bar)).toFixed(3) }, 'Added as a clip'); } },
    ...(drums.length ? [{ header: true, label: `On a drum pad (${drums[0].name})` }, ...['kick', 'snare', 'clap', 'hat', 'openhat', 'crash', 'perc', 'impact', 'riser'].map((v) => ({ label: v.replace('_', ' '), run: () => place({ pad: v, track: drums[0].id }, `Now on the ${v} pad`) }))] : [{ label: 'Add a drum track to use it on a pad', disabled: true }])], { width: 290 });
}
D.on('sfx:changed', async (e) => { FXS.pack = await call('sfx:open', e.pack); if (e.sound) FXS.sel = e.sound; else if (!FXS.pack.sounds.some((x) => x.id === FXS.sel)) FXS.sel = FXS.pack.sounds.length ? FXS.pack.sounds[FXS.pack.sounds.length - 1].id : null; FXS.vars = null; if (S.view === 'sfx') render(); });
D.on('sfx:play', async (e) => { FXS.pack = await call('sfx:open', e.pack); const s = FXS.pack.sounds.find((x) => x.id === e.sound); if (s) { playSfx(s); FXS.sel = s.id; if (S.view === 'sfx') render(); } });
