// Dither — Tiles & scenes: autotile tilesets built from five drawn pieces, and parallax scenes made of sprite layers
// and terrain layers you paint cell by cell. Claude builds the same things with make_tileset / paint_scene / edit_scene.
'use strict';

const TS = { scenes: [], scene: null, cam: 0, layer: null, paint: false, playing: false, saveT: null, raf: 0, renderSeq: 0 };
const tilesets = () => S.sprites.filter((s) => s.tileset);
const pieceSprites = () => S.sprites.filter((s) => !s.tileset && s.frames >= 5 && s.w === s.h && s.w <= 64);
function pictureTo(cv, img, max = 4, fitBox) {
  const box = fitBox || cv.parentElement.getBoundingClientRect(); const fit = Math.min((box.width - 16) / img.w, (box.height - 16) / img.h); const s = fit >= 1 ? Math.min(max, Math.floor(fit)) : Math.max(0.25, fit);
  cv.width = img.w; cv.height = img.h; cv.style.width = img.w * s + 'px'; cv.style.height = img.h * s + 'px'; cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), 0, 0); return s;
}

VIEWS.tiles = {
  title: 'Tiles & scenes',
  actions() { return `<button class="btn" id="tsAsk">${icon('chat', 15)}Ask Claude</button><button class="btn" id="tsNewSet">${icon('tiles', 15)}New tileset</button><button class="btn primary" id="tsNewScene">${icon('plus', 15)}New scene</button>`; },
  async render(view) {
    try { TS.scenes = await call('scenes:list'); } catch { TS.scenes = []; }
    const sets = tilesets();
    view.innerHTML = `<div class="ts-wrap">
      <div class="ts-sec"><div class="ts-h"><h2>Scenes</h2><span class="muted small">Parallax layers and painted terrain — levels, title screens, backdrops for your sites.</span></div>
        ${TS.scenes.length ? `<div class="card-grid wide">${TS.scenes.map((sc) => `<div class="fx-card" data-scene="${sc.id}"><div class="d-stage ts-stage loading"><canvas></canvas></div><div class="d-body"><div class="row"><div class="d-name grow ellip">${esc(sc.name)}</div><span class="pill">${sc.w}×${sc.h}</span><button class="icon-btn xs d-more">${icon('more', 15)}</button></div><div class="d-idea">${plural(sc.layers, 'layer')} · world ${sc.length}px · ${esc(ago(sc.updatedAt))}</div></div></div>`).join('')}</div>`
          : `<div class="ts-empty">${icon('scene', 26)}<b>No scenes yet</b><span>A scene is a camera over a wide world: a sky that stays put, hills that drift slowly, terrain you paint in tiles, and anything else at its own depth.</span><button class="btn" id="tsEmptyScene">${icon('plus', 14)}New scene</button></div>`}</div>
      <div class="ts-sec"><div class="ts-h"><h2>Tilesets</h2><span class="muted small">Draw five tiles; Dither builds every edge and corner (47 tiles) so terrain paints itself.</span></div>
        ${sets.length ? `<div class="card-grid">${sets.map((s) => `<div class="fx-card" data-set="${s.id}"><div class="d-stage ts-stage loading"><canvas></canvas></div><div class="d-body"><div class="row"><div class="d-name grow ellip">${esc(s.name)}</div><span class="pill">${s.tileset.count} × ${s.tileset.tile}px</span><button class="icon-btn xs d-more">${icon('more', 15)}</button></div><div class="d-idea">${s.tileset.kind === 'sides16' ? 'Sides only (16)' : 'Corners + sides (47)'} · ${esc(ago(s.updatedAt))}</div></div></div>`).join('')}</div>`
          : `<div class="ts-empty">${icon('tiles', 26)}<b>No tilesets yet</b><span>Start a pieces sprite — fill, top edge, left edge, outer corner, inner corner — draw them (or ask Claude), then build the set.</span><button class="btn" id="tsEmptySet">${icon('tiles', 14)}New tileset</button></div>`}</div></div>`;
    $$('[data-scene]', view).forEach((el) => {
      const id = el.dataset.scene; const st = $('.d-stage', el); const cv = $('canvas', st);
      call('scenes:render', id, 0).then((img) => { pictureTo(cv, img, 3); st.classList.remove('loading'); }).catch(() => st.classList.remove('loading'));
      st.onclick = () => go('scene', id); $('.d-more', el).onclick = (e) => sceneMenu(e.currentTarget, id);
    });
    $$('[data-set]', view).forEach((el) => {
      const id = el.dataset.set; const st = $('.d-stage', el); const cv = $('canvas', st);
      call('tiles:demo', id).then((img) => { pictureTo(cv, img, 2); st.classList.remove('loading'); }).catch(() => st.classList.remove('loading'));
      st.onclick = () => go('editor', id); $('.d-more', el).onclick = (e) => tilesetMenu(e.currentTarget, id);
    });
    const ne = $('#tsEmptyScene'); if (ne) ne.onclick = newScene; const nt = $('#tsEmptySet'); if (nt) nt.onclick = newTileset;
  },
  after() { $('#tsNewSet').onclick = newTileset; $('#tsNewScene').onclick = newScene; $('#tsAsk').onclick = () => askClaude('Make a tileset and a parallax scene for '); },
};

function tilesetMenu(anchor, id) {
  const s = S.sprites.find((x) => x.id === id);
  menu(anchor, [{ label: 'Open the sheet in the editor', icon: 'edit', run: () => go('editor', id) }, '-', { label: 'Export for Tiled (.tsx + demo map)', icon: 'export', run: async () => filesDone(await call('export', { kind: 'tileset', id, format: 'tiled', ask: true }).catch(fail), 'Exported') }, { label: 'Export for Godot 4 (.tres)', icon: 'export', run: async () => filesDone(await call('export', { kind: 'tileset', id, format: 'godot', ask: true }).catch(fail), 'Exported') }, { label: 'Export sheet + mask JSON', icon: 'export', run: async () => filesDone(await call('export', { kind: 'tileset', id, format: 'sheet', ask: true }).catch(fail), 'Exported') }, '-', { label: 'Delete', icon: 'trash', danger: true, run: async () => { if (await confirmBox({ title: `Delete “${s.name}”?`, text: 'It moves to the project’s .trash folder. Scenes that use it will show nothing for that layer.', ok: 'Delete', danger: true })) { await call('sprites:remove', id); await loadProject(); render(); } } }]);
}
function sceneMenu(anchor, id) {
  const sc = TS.scenes.find((x) => x.id === id) || TS.scene;
  menu(anchor, [{ label: 'Open', icon: 'edit', run: () => go('scene', id) }, { label: 'Record a pan (GIF)', icon: 'record', run: async () => filesDone(await call('record', { kind: 'scene', id, formats: ['gif'] }).catch(fail), 'Recorded') }, '-', { label: 'Export layers + scene.json', icon: 'export', run: async () => filesDone(await call('export', { kind: 'scene', id, format: 'layers', ask: true }).catch(fail), 'Exported') }, { label: 'Export for Tiled', icon: 'export', run: async () => filesDone(await call('export', { kind: 'scene', id, format: 'tiled', ask: true }).catch(fail), 'Exported') }, { label: 'Export PNG (2×)', icon: 'export', run: async () => filesDone(await call('export', { kind: 'scene', id, format: 'png', scale: 2, ask: true }).catch(fail), 'Exported') }, '-', { label: 'Delete', icon: 'trash', danger: true, run: async () => { if (await confirmBox({ title: `Delete “${sc.name}”?`, text: 'It moves to the project’s .trash folder. The sprites it uses stay.', ok: 'Delete', danger: true })) { await call('scenes:remove', id); go('tiles'); } } }]);
}

async function newTileset() {
  const pieces = pieceSprites();
  const el = openSheet(`<div class="sheet-head">${icon('tiles', 20)}<div class="grow"><h3>New tileset</h3><div class="muted small">Five tiles in, a whole autotile set out.</div></div></div>
    <div class="sheet-body"><div class="ts-howto">${['Fill', 'Top edge', 'Left edge', 'Outer corner', 'Inner corner'].map((n, i) => `<div><i class="tsh tsh${i}"></i><span>${n}</span></div>`).join('')}</div>
      <p class="muted small" style="margin:10px 0 14px">Draw the terrain as seen from the top-left: the top edge has open space above it, the left edge open space to its left, the outer corner both, and the inner corner a notch of open space in its top-left. Leave open space transparent. Dither mirrors these into every edge and corner.</p>
      <div class="field"><label>Pieces</label><select class="select" id="tnSrc"><option value="__new">Start a new pieces sprite…</option>${pieces.map((s) => `<option value="${s.id}">${esc(s.name)} · ${s.w}px · ${s.frames} frames</option>`).join('')}</select></div>
      <div class="row" id="tnNewRow" style="gap:12px"><div class="field grow"><label>Name</label><input class="input" id="tnName" value="Grass"></div><div class="field"><label>Tile size</label><select class="select" id="tnTile">${[8, 12, 16, 24, 32, 48].map((n) => `<option ${n === 16 ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>
      <div class="field" id="tnKindRow" hidden><label>Set</label><div class="seg" id="tnKind"><button data-k="blob47" class="on">Corners + sides (47)</button><button data-k="sides16">Sides only (16)</button></div></div>
      <div class="ts-demo" id="tnDemo" hidden><canvas></canvas></div></div>
    <div class="sheet-foot"><span class="grow"></span><button class="btn" id="tnCancel">Cancel</button><button class="btn primary" id="tnGo">${icon('check', 15)}Create pieces</button></div>`, { width: 620 });
  let kind = 'blob47';
  const sync = () => { const fresh = $('#tnSrc', el).value === '__new'; $('#tnKindRow', el).hidden = fresh; $('#tnTile', el).closest('.field').hidden = !fresh; $('#tnGo', el).innerHTML = `${icon('check', 15)}${fresh ? 'Create pieces' : 'Build tileset'}`; if (!fresh) $('#tnName', el).value = S.sprites.find((s) => s.id === $('#tnSrc', el).value).name.replace(/ pieces$/i, ''); };
  $('#tnSrc', el).onchange = sync; if (pieces.length) { $('#tnSrc', el).value = pieces[0].id; } sync();
  $$('#tnKind [data-k]', el).forEach((b) => (b.onclick = () => { kind = b.dataset.k; $$('#tnKind button', el).forEach((x) => x.classList.toggle('on', x === b)); }));
  $('#tnCancel', el).onclick = closeSheet;
  $('#tnGo', el).onclick = async () => {
    const src = $('#tnSrc', el).value, name = $('#tnName', el).value.trim() || 'Terrain';
    try {
      if (src === '__new') { const id = await call('tiles:pieces', { name: `${name} pieces`, tile: +$('#tnTile', el).value }); closeSheet(); await loadProject(); toast('Draw the five pieces', 'Frames 1–5: fill, top edge, left edge, outer corner, inner corner. Then Tiles & scenes › New tileset › Build.', 'info', 9000); go('editor', id); return; }
      const j = await call('tool', 'make_tileset', { name, sprite: src, kind }); await loadProject(); closeSheet(); toast('Tileset built', `${j.tiles} tiles of ${j.tile_px}px. Use it in a scene’s terrain layer.`); render();
    } catch (e) { fail(e); }
  };
}
async function newScene() {
  const r = await promptBox({ title: 'New scene', text: 'The viewport is what the camera sees; the world is how far it can pan.', fields: [{ key: 'name', label: 'Name', placeholder: 'e.g. Level 1 — Forest' }, { key: 'size', label: 'Viewport', value: '320×180', options: ['160×144', '256×144', '320×180', '384×216', '480×270', '640×360'].map((v) => ({ value: v, label: v })) }, { key: 'len', label: 'World width (px)', type: 'number', value: '960' }, { key: 'bg', label: 'Sky colour', value: '#29366f' }], ok: 'Create' });
  if (!r) return; const [w, h] = r.size.split('×').map(Number);
  try { const sc = await call('scenes:create', { name: r.name.trim() || 'Scene', w, h, length: Math.max(w, +r.len || w * 3), background: r.bg }); go('scene', sc.id); } catch (e) { fail(e); }
}

// ───────── the scene editor
VIEWS.scene = {
  flush: true,
  head() { return `<button class="icon-btn" id="scBack" title="Tiles & scenes">${icon('back', 18)}</button><input class="title-input" id="scName" spellcheck="false"><span class="pill" id="scSize"></span><span class="save-state" id="scState"></span>`; },
  actions() { return `<button class="btn" id="scPlay">${icon('play', 15)}Pan</button><button class="btn" id="scAsk">${icon('chat', 15)}Ask Claude</button><button class="btn" id="scExport">${icon('export', 15)}Export</button>`; },
  async render(view) {
    try { TS.scene = await call('scenes:get', S.arg); } catch (e) { view.innerHTML = `<div class="empty"><b>Couldn’t open that scene</b><span>${esc(e.message)}</span></div>`; return; }
    if (TS.forId !== S.arg) { TS.cam = 0; TS.layer = null; TS.paint = false; TS.forId = S.arg; }
    view.innerHTML = `<div class="scene-ed"><div class="sc-center"><div class="sc-stage" id="scStage"><canvas id="scCv"></canvas><canvas id="scGrid"></canvas></div>
        <div class="sc-bar"><span class="eo-l">Camera</span><input type="range" id="scCam" min="0" value="0" class="grow"><span class="tnum small muted" id="scCamV"></span><span class="muted tiny" id="scHint"></span></div></div>
      <div class="ed-side"><div class="panel"><div class="panel-h">Layers<span class="grow"></span><button class="btn xs" id="scAddS">${icon('plus', 13)}Sprite</button><button class="btn xs" id="scAddT">${icon('plus', 13)}Terrain</button></div><div class="layers" id="scLayers"></div></div>
        <div class="panel grow-panel" id="scProps"></div></div></div>`;
    $('#scName').value = TS.scene.name; fitTitles(); $('#scSize').textContent = `${TS.scene.w}×${TS.scene.h}`;
    drawSceneLayers(); drawSceneProps(); wireScene(); paintScene();
    TS.ro = new ResizeObserver(() => paintScene(true)); TS.ro.observe($('#scStage'));
  },
  leave() { if (TS.saveT) { clearTimeout(TS.saveT); saveScene(); } if (TS.ro) TS.ro.disconnect(); TS.playing = false; cancelAnimationFrame(TS.raf); },
};
const scLayer = () => TS.scene.layers.find((l) => l.id === TS.layer);
function sceneChanged() { TS.scene.updatedAt = Date.now(); $('#scState').textContent = 'Editing…'; clearTimeout(TS.saveT); TS.saveT = setTimeout(saveScene, 500); paintScene(); }
async function saveScene() { TS.saveT = null; try { await call('scenes:save', TS.scene); const st = $('#scState'); if (st) st.textContent = 'Saved'; } catch (e) { fail(e); } }
async function paintScene(layoutOnly) {
  const sc = TS.scene; if (!sc || S.view !== 'scene') return; const stage = $('#scStage'); if (!stage) return; const cam = $('#scCam');
  cam.max = Math.max(0, (sc.length || sc.w) - sc.w); cam.value = TS.cam; $('#scCamV').textContent = `${Math.round(TS.cam)} px`;
  const my = ++TS.renderSeq; let img; try { img = await call('scenes:render', sc, TS.cam, TS.ms || 0); } catch (e) { return; } if (my !== TS.renderSeq) return;
  const cv = $('#scCv'); if (!cv) return; const box = stage.getBoundingClientRect(); const s = TS.scale = Math.max(1, Math.floor(Math.min((box.width - 24) / img.w, (box.height - 24) / img.h)));
  cv.width = img.w; cv.height = img.h; cv.style.width = img.w * s + 'px'; cv.style.height = img.h * s + 'px'; cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), 0, 0);
  drawPaintGrid(); void layoutOnly;
}
// the terrain grid you paint on (only while painting a terrain layer)
function drawPaintGrid() {
  const g = $('#scGrid'), cv = $('#scCv'); if (!g || !cv) return; const L = scLayer(); const on = TS.paint && L && L.kind === 'tiles' && L.tile;
  g.width = cv.width * TS.scale; g.height = cv.height * TS.scale; g.style.width = cv.style.width; g.style.height = cv.style.height; const c = g.getContext('2d'); c.clearRect(0, 0, g.width, g.height); g.style.pointerEvents = on ? 'auto' : 'none';
  $('#scHint').textContent = on ? 'Click or drag to paint terrain · right-click or Alt to erase' : '';
  if (!on) return; const T = L.tile * TS.scale, ox = ((L.x || 0) - TS.cam * (L.depth ?? 1)) * TS.scale, oy = (L.y || 0) * TS.scale; const rows = L.rows.length, cols = L.rows[0].length;
  c.strokeStyle = 'rgba(255,111,125,.45)'; c.lineWidth = 1; c.beginPath(); for (let x = 0; x <= cols; x++) { c.moveTo(ox + x * T + 0.5, oy); c.lineTo(ox + x * T + 0.5, oy + rows * T); } for (let y = 0; y <= rows; y++) { c.moveTo(ox, oy + y * T + 0.5); c.lineTo(ox + cols * T, oy + y * T + 0.5); } c.stroke();
  c.fillStyle = 'rgba(255,111,125,.12)'; L.rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === '#') c.fillRect(ox + x * T + 1, oy + y * T + 1, T - 1, T - 1); }));
}
function cellOf(e) { const L = scLayer(); const g = $('#scGrid').getBoundingClientRect(); const T = L.tile * TS.scale; return [Math.floor((e.clientX - g.left - ((L.x || 0) - TS.cam * (L.depth ?? 1)) * TS.scale) / T), Math.floor((e.clientY - g.top - (L.y || 0) * TS.scale) / T)]; }
function setCell(x, y, on) { const L = scLayer(); if (y < 0 || x < 0 || y >= L.rows.length || x >= L.rows[0].length) return false; const r = L.rows[y]; const ch = on ? '#' : '.'; if (r[x] === ch) return false; L.rows[y] = r.slice(0, x) + ch + r.slice(x + 1); return true; }
function drawSceneLayers() {
  const host = $('#scLayers'); if (!host) return;
  host.innerHTML = [...TS.scene.layers].reverse().map((l) => `<div class="ly ${l.id === TS.layer ? 'on' : ''}" data-id="${l.id}"><button class="icon-btn xs ly-eye" title="Show/hide">${icon(l.visible === false ? 'eyeOff' : 'eye', 14)}</button>${icon(l.kind === 'tiles' ? 'tiles' : 'sprites', 13)}<span class="grow ellip ly-name">${esc(l.name)}</span><span class="muted tiny tnum">${(l.depth ?? 1).toFixed(2)}</span></div>`).join('') || `<div class="muted small" style="padding:10px">Add layers back to front: a sky, distant hills, terrain, then foreground.</div>`;
  $$('.ly', host).forEach((el) => { const l = TS.scene.layers.find((x) => x.id === el.dataset.id); el.onclick = () => { TS.layer = l.id; if (l.kind === 'tiles' && !l.tile) { const t = S.sprites.find((x) => x.id === l.tileset); if (t && t.tileset) l.tile = t.tileset.tile; } TS.paint = l.kind === 'tiles' && TS.paint; drawSceneLayers(); drawSceneProps(); drawPaintGrid(); }; $('.ly-eye', el).onclick = (e) => { e.stopPropagation(); l.visible = l.visible === false; drawSceneLayers(); sceneChanged(); }; });
}
function drawSceneProps() {
  const host = $('#scProps'); if (!host) return; const L = scLayer(); const sc = TS.scene;
  if (!L) { host.innerHTML = `<div class="panel-h">Scene</div><div class="sc-props"><div class="field"><label>Sky colour</label><input type="color" id="spBg" value="${sc.background || '#000000'}"></div><div class="field"><label>World width <b id="spLenV">${sc.length}</b> px</label><input type="range" id="spLen" min="${sc.w}" max="${sc.w * 12}" step="16" value="${sc.length}"></div><p class="muted tiny">Select a layer to change it. Depth 0 never moves (sky), 0.2–0.5 drifts (far hills), 1 moves with the world, above 1 is foreground.</p></div>`;
    $('#spBg').oninput = (e) => { sc.background = e.target.value; sceneChanged(); }; $('#spLen').oninput = (e) => { sc.length = +e.target.value; $('#spLenV').textContent = sc.length; sceneChanged(); }; return; }
  const sprites = S.sprites.filter((s) => !s.tileset), sets = tilesets();
  host.innerHTML = `<div class="panel-h">${esc(L.name)}<span class="grow"></span><button class="icon-btn xs" id="lpUp" title="Bring forward">${icon('up', 14)}</button><button class="icon-btn xs" id="lpDown" title="Send back">${icon('down', 14)}</button><button class="icon-btn xs" id="lpDel" title="Remove layer">${icon('trash', 14)}</button></div><div class="sc-props">
    ${L.kind === 'tiles' ? `<div class="field"><label>Tileset</label><select class="select sm" id="lpSet">${sets.map((s) => `<option value="${s.id}" ${s.id === L.tileset ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      <button class="btn ${TS.paint ? 'primary' : ''}" id="lpPaint">${icon('pencil', 14)}${TS.paint ? 'Painting — click cells' : 'Paint terrain'}</button>
      <div class="row" style="gap:8px"><div class="field"><label>Columns</label><input class="input sm" type="number" id="lpCols" value="${L.rows[0].length}"></div><div class="field"><label>Rows</label><input class="input sm" type="number" id="lpRows" value="${L.rows.length}"></div></div>`
      : `<div class="field"><label>Sprite</label><select class="select sm" id="lpSprite">${sprites.map((s) => `<option value="${s.id}" ${s.id === L.sprite ? 'selected' : ''}>${esc(s.name)} · ${s.w}×${s.h}</option>`).join('')}</select></div>
      <div class="field"><label>Repeat</label><div class="seg sm" id="lpRep">${[['', 'Off'], ['x', 'Across'], ['y', 'Down'], ['both', 'Both']].map(([k, n]) => `<button data-r="${k}" class="${(L.repeat || '') === k ? 'on' : ''}">${n}</button>`).join('')}</div></div>
      <label class="chk"><input type="checkbox" id="lpAnim" ${L.animate ? 'checked' : ''}> Play its frames</label>`}
    <div class="field"><label>Depth <b id="lpDepthV">${(L.depth ?? 1).toFixed(2)}</b></label><input type="range" id="lpDepth" min="0" max="1.6" step="0.05" value="${L.depth ?? 1}"></div>
    <div class="row" style="gap:8px"><div class="field"><label>X</label><input class="input sm" type="number" id="lpX" value="${L.x || 0}"></div><div class="field"><label>Y</label><input class="input sm" type="number" id="lpY" value="${L.y || 0}"></div></div></div>`;
  const num = (id, k) => { const i = $(id); if (i) i.onchange = () => { L[k] = +i.value || 0; sceneChanged(); }; }; num('#lpX', 'x'); num('#lpY', 'y');
  $('#lpDepth').oninput = (e) => { L.depth = +e.target.value; $('#lpDepthV').textContent = L.depth.toFixed(2); drawSceneLayers(); sceneChanged(); };
  $('#lpDel').onclick = () => { TS.scene.layers = TS.scene.layers.filter((x) => x !== L); TS.layer = null; TS.paint = false; drawSceneLayers(); drawSceneProps(); sceneChanged(); };
  const mv = (d) => { const a = TS.scene.layers, i = a.indexOf(L), j = Math.max(0, Math.min(a.length - 1, i + d)); a.splice(i, 1); a.splice(j, 0, L); drawSceneLayers(); sceneChanged(); }; $('#lpUp').onclick = () => mv(1); $('#lpDown').onclick = () => mv(-1);
  if (L.kind === 'tiles') {
    $('#lpSet').onchange = async (e) => { L.tileset = e.target.value; L.tile = S.sprites.find((s) => s.id === L.tileset).tileset.tile; sceneChanged(); };
    $('#lpPaint').onclick = () => { TS.paint = !TS.paint; drawSceneProps(); drawPaintGrid(); };
    const resize = () => { const c = Math.max(1, Math.min(400, +$('#lpCols').value | 0)), r = Math.max(1, Math.min(200, +$('#lpRows').value | 0)); L.rows = Array.from({ length: r }, (_, y) => (L.rows[y] || '').padEnd(c, '.').slice(0, c)); sceneChanged(); };
    $('#lpCols').onchange = resize; $('#lpRows').onchange = resize;
  } else {
    $('#lpSprite').onchange = (e) => { L.sprite = e.target.value; L.name = S.sprites.find((s) => s.id === L.sprite).name; drawSceneLayers(); sceneChanged(); };
    $$('#lpRep [data-r]').forEach((b) => (b.onclick = () => { L.repeat = b.dataset.r || null; $$('#lpRep button').forEach((x) => x.classList.toggle('on', x === b)); sceneChanged(); }));
    $('#lpAnim').onchange = (e) => { L.animate = e.target.checked; sceneChanged(); };
  }
}
function wireScene() {
  $('#scBack').onclick = () => go('tiles');
  $('#scName').onchange = (e) => { TS.scene.name = e.target.value.trim() || TS.scene.name; sceneChanged(); };
  $('#scCam').oninput = (e) => { TS.cam = +e.target.value; paintScene(); };
  $('#scStage').onclick = (e) => { if (e.target.id === 'scStage' || e.target.id === 'scCv') { if (!TS.paint) { TS.layer = null; drawSceneLayers(); drawSceneProps(); } } };
  $('#scAddS').onclick = async () => { const sp = S.sprites.filter((s) => !s.tileset); if (!sp.length) { toast('No sprites yet', 'Draw a sky, hills or props in Sprites first (or ask Claude).', 'info'); return; } const s = sp[0]; const l = { id: 'sl' + Math.random().toString(16).slice(2, 12), kind: 'sprite', name: s.name, sprite: s.id, x: 0, y: Math.max(0, TS.scene.h - s.h), depth: 1, repeat: null }; TS.scene.layers.push(l); TS.layer = l.id; drawSceneLayers(); drawSceneProps(); sceneChanged(); };
  $('#scAddT').onclick = () => { const sets = tilesets(); if (!sets.length) { toast('No tilesets yet', 'Build one first: Tiles & scenes › New tileset.', 'info'); return; } const t = sets[0], T = t.tileset.tile, cols = Math.ceil((TS.scene.length || TS.scene.w) / T), rows = Math.ceil(TS.scene.h / T); const l = { id: 'sl' + Math.random().toString(16).slice(2, 12), kind: 'tiles', name: t.name, tileset: t.id, tile: T, x: 0, y: 0, depth: 1, rows: Array.from({ length: rows }, (_, y) => (y >= rows - 2 ? '#' : '.').repeat(cols)) }; TS.scene.layers.push(l); TS.layer = l.id; TS.paint = true; drawSceneLayers(); drawSceneProps(); sceneChanged(); };
  const g = $('#scGrid'); let drag = null;
  g.oncontextmenu = (e) => e.preventDefault();
  g.onpointerdown = (e) => { const L = scLayer(); if (!L || !TS.paint) return; g.setPointerCapture(e.pointerId); const [x, y] = cellOf(e); const on = !(e.button === 2 || e.altKey); drag = { on }; if (setCell(x, y, on)) sceneChanged(); };
  g.onpointermove = (e) => { if (!drag) return; const [x, y] = cellOf(e); if (setCell(x, y, drag.on)) sceneChanged(); };
  g.onpointerup = () => { drag = null; };
  $('#scPlay').onclick = () => { TS.playing = !TS.playing; $('#scPlay').innerHTML = `${icon(TS.playing ? 'pause' : 'play', 15)}${TS.playing ? 'Stop' : 'Pan'}`; if (TS.playing) { let last = performance.now(), busy = false; const tick = async (t) => { if (!TS.playing || S.view !== 'scene') return; const dt = t - last; last = t; TS.ms = (TS.ms || 0) + dt; const max = Math.max(0, (TS.scene.length || TS.scene.w) - TS.scene.w); TS.cam = max ? (TS.cam + dt * 0.06) % (max + 1) : 0; if (!busy) { busy = true; await paintScene(); busy = false; } TS.raf = requestAnimationFrame(tick); }; TS.raf = requestAnimationFrame(tick); } };
  $('#scAsk').onclick = () => askClaude(`Look at my scene “${TS.scene.name}” (id ${TS.scene.id}) with view kind "scene", then `);
  $('#scExport').onclick = (e) => { saveScene(); sceneMenu(e.currentTarget, TS.scene.id); };
}
