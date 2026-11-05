// Dither — Characters: one picture becomes a rigged 2D character. The list, the "new character" sheet and the
// character editor: Rig (drag joints, re-cut parts), Animate (motions, pose keys by dragging bones, motion from
// video), Directions (front/back/three-quarter views, turnarounds) and Skins & gear. Claude does the same through
// create_character, set_joints, character_animation, motion_from_video, character_view and character_skin.
'use strict';

const CHS = { list: [], c: null, tab: 'rig', view: 'side', anim: null, dir: null, frame: 0, playing: false, timer: 0, previewFrames: null, motions: null, seq: 0, showParts: false, sel: null };
const VIEW_NAMES = { side: 'Side', front: 'Front', back: 'Back', front34: '¾ front', back34: '¾ back' };
const DIR_NAMES = { right: 'Right', left: 'Left', down: 'Down', up: 'Up', down_right: 'Down-right', down_left: 'Down-left', up_right: 'Up-right', up_left: 'Up-left' };

VIEWS.characters = {
  title: 'Characters',
  actions() { return `<button class="btn" id="chAsk">${icon('chat', 15)}Ask Claude</button><button class="btn primary" id="chNew">${icon('plus', 15)}New character</button>`; },
  async render(view) {
    try { CHS.list = await call('chars:list'); } catch { CHS.list = []; }
    if (!CHS.list.length) { view.innerHTML = `<div class="ts-empty ch-empty">${icon('person', 30)}<b>Make a character from one picture</b><span>Drop in a full-body picture: a sprite you drew, an AI image, or concept art. Dither finds the joints, cuts it into parts on a skeleton, and gives it idle, walk, run, jump, attack, hurt and death straight away. Then add top-down directions, skins and gear, and export sprite sheets, Spine or Godot.</span><button class="btn primary" id="chEmptyNew">${icon('plus', 14)}New character</button></div>`; $('#chEmptyNew').onclick = newCharacter; return; }
    view.innerHTML = `<div class="card-grid">${CHS.list.map((c) => `<div class="fx-card" data-ch="${c.id}"><div class="d-stage loading"><canvas></canvas></div><div class="d-body"><div class="row"><div class="d-name grow ellip">${esc(c.name)}</div><span class="pill">${c.directions === 1 ? 'Side' : c.directions + ' dirs'}</span><button class="icon-btn xs d-more">${icon('more', 15)}</button></div><div class="d-idea">${plural(c.animations, 'animation')} · ${c.views.map((v) => VIEW_NAMES[v]).join(', ')} · ${esc(ago(c.updatedAt))}</div></div></div>`).join('')}</div>`;
    $$('[data-ch]', view).forEach((el) => {
      const id = el.dataset.ch; const st = $('.d-stage', el); const p = new Player($('canvas', st), { pad: 14, max: 6, bg: 'checker' });
      call('chars:preview', id, { anim: 'walk' }).then((r) => { p.set(r.frames, { w: r.w, h: r.h, durations: r.frames.map(() => Math.round(1000 / r.fps)) }); p.play(); st.classList.remove('loading'); }).catch(() => call('chars:preview', id, {}).then((r) => { p.set(r.frames, { w: r.w, h: r.h, durations: [200] }); st.classList.remove('loading'); }).catch(() => st.classList.remove('loading')));
      st.onclick = () => go('character', id); $('.d-more', el).onclick = (e) => charMenu(e.currentTarget, id);
    });
  },
  after() { $('#chNew').onclick = newCharacter; $('#chAsk').onclick = () => askClaude('Make a rigged character from '); },
};
function charMenu(anchor, id) {
  const c = CHS.list.find((x) => x.id === id) || CHS.c;
  menu(anchor, [{ label: 'Open', icon: 'edit', run: () => go('character', id) }, { label: 'Export…', icon: 'export', run: () => exportCharacter(id) }, '-', { label: 'Delete', icon: 'trash', danger: true, run: async () => { if (await confirmBox({ title: `Delete “${c.name}”?`, text: 'The character and its parts sprites move to the project’s .trash folder.', ok: 'Delete', danger: true })) { await call('chars:remove', id); await loadProject(); go('characters'); } } }]);
}
function exportCharacter(id) {
  const run = async (format) => { try { const r = await call('export', { kind: 'character', id, format, ask: true }); if (r) filesDone({ files: [r.folder] }, `Exported ${r.files.length} files`); } catch (e) { fail(e); } };
  const el = openSheet(`<div class="sheet-head">${icon('export', 20)}<div class="grow"><h3>Export character</h3><div class="muted small">Pick a folder next. Every direction and animation goes in.</div></div></div><div class="sheet-body ex-list">
    ${[['sheets', 'Sprite sheets', 'One PNG per direction (a row per animation), every frame the same size with the feet at the same point. Plus JSON with hitboxes, hand/head/feet points and events, a Godot SpriteFrames file and GIF previews. Best for pixel art.'], ['spine', 'Spine 4.1', 'A skeleton per view with bones, parts in an atlas and every animation — runs in Unity, Godot, Phaser and the web through the Spine runtimes.'], ['godot', 'Godot 4 scene', 'A .tscn per view: Node2D bones with Sprite2D parts and an AnimationPlayer. Put the folder at res://characters/<name>/.'], ['all', 'Everything', 'All of the above.']].map(([k, t, d]) => `<button class="ex-row" data-f="${k}"><b>${t}</b><span>${d}</span></button>`).join('')}</div><div class="sheet-foot"><span class="grow"></span><button class="btn" id="exClose">Close</button></div>`, { width: 560 });
  $$('[data-f]', el).forEach((b) => (b.onclick = () => { closeSheet(); run(b.dataset.f); })); $('#exClose', el).onclick = closeSheet;
}
async function newCharacter() {
  const sprites = S.sprites.filter((s) => !s.tileset && !s.partsOf);
  const el = openSheet(`<div class="sheet-head">${icon('person', 20)}<div class="grow"><h3>New character</h3><div class="muted small">A full-body picture, standing, arms a little away from the body, on a plain background.</div></div></div>
    <div class="sheet-body"><div class="nc-src"><div class="an-src-box" id="ncBox"><span class="muted small">No picture yet</span></div><div class="nc-src-btns"><select class="select" id="ncSprite"><option value="">Use a sprite…</option>${sprites.map((s) => `<option value="${s.id}">${esc(s.name)} · ${s.w}×${s.h}</option>`).join('')}</select><button class="btn" id="ncFile">${icon('image', 15)}Choose a picture…</button></div></div>
      <div class="field"><label>Name</label><input class="input" id="ncName" placeholder="e.g. Knight"></div>
      <div class="row" style="gap:14px;flex-wrap:wrap"><div class="field"><label>The picture shows</label><div class="seg" id="ncView">${[['side', 'Side'], ['front', 'Front'], ['back', 'Back']].map(([k, n]) => `<button data-v="${k}" class="${k === 'side' ? 'on' : ''}">${n}</button>`).join('')}</div></div>
        <div class="field"><label>Game</label><div class="seg" id="ncDirs"><button data-d="1" class="on">Side-scroller</button><button data-d="4">Top-down · 4</button><button data-d="8">Top-down · 8</button></div></div></div>
      <div class="row" style="gap:14px"><div class="field"><label>Style</label><div class="seg" id="ncPix"><button data-p="1" class="on">Pixel art</button><button data-p="0">Smooth</button></div></div><div class="field" id="ncHRow"><label>Height (pixel art)</label><select class="select" id="ncH">${[32, 48, 64, 96, 128].map((n) => `<option ${n === 64 ? 'selected' : ''}>${n}</option>`).join('')}<option value="0">Keep the picture’s size</option></select></div></div></div>
    <div class="sheet-foot"><span class="muted tiny grow" id="ncNote"></span><button class="btn" id="ncCancel">Cancel</button><button class="btn primary" id="ncGo" disabled>${icon('check', 15)}Make character</button></div>`, { width: 640 });
  const st = { src: null, view: 'side', dirs: 1, pixel: true };
  const showSrc = async () => { const box = $('#ncBox', el); box.classList.add('has'); box.innerHTML = '<canvas></canvas>'; try { const r = st.src.sprite ? await call('sprites:frames', st.src.sprite, 136) : await call('image:preview', st.src.file, 136); new Player($('canvas', box), { pad: 6, max: 4, bg: 'checker' }).set([r.frames ? r.frames[0] : r.data], { w: r.meta ? r.meta.w : r.w, h: r.meta ? r.meta.h : r.h, durations: [100] }); } catch { box.innerHTML = '<span class="muted small">Picked</span>'; } $('#ncGo', el).disabled = false; };
  $('#ncSprite', el).onchange = (e) => { if (!e.target.value) return; st.src = { sprite: e.target.value }; if (!$('#ncName', el).value) $('#ncName', el).value = S.sprites.find((s) => s.id === e.target.value).name; showSrc(); };
  $('#ncFile', el).onclick = async () => { const f = await call('dialog:files', { filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] }); if (!f) return; st.src = { file: f[0] }; if (!$('#ncName', el).value) $('#ncName', el).value = baseName(f[0]).replace(/\.[^.]+$/, ''); showSrc(); };
  const seg = (sel, attr, set) => $$(`${sel} [${attr}]`, el).forEach((b) => (b.onclick = () => { $$(`${sel} button`, el).forEach((x) => x.classList.toggle('on', x === b)); set(b.getAttribute(attr)); }));
  seg('#ncView', 'data-v', (v) => (st.view = v)); seg('#ncDirs', 'data-d', (v) => (st.dirs = +v)); seg('#ncPix', 'data-p', (v) => { st.pixel = v === '1'; $('#ncHRow', el).hidden = !st.pixel; });
  $('#ncCancel', el).onclick = closeSheet;
  $('#ncGo', el).onclick = async () => {
    const b = $('#ncGo', el); b.disabled = true; b.innerHTML = `<span class="spin"></span>Finding joints…`;
    try { const h = +$('#ncH', el).value; const r = await call('chars:create', { name: $('#ncName', el).value.trim() || 'Character', source: st.src, view: st.view, pixel: st.pixel, height: st.pixel && h ? h : undefined, directions: st.dirs }); closeSheet(); await loadProject(); toast('Character made', r.notes.slice(0, 2).join(' · '), 'ok', 7000); CHS.tab = 'rig'; go('character', r.character.id); }
    catch (e) { b.disabled = false; b.innerHTML = `${icon('check', 15)}Make character`; fail(e); }
  };
}

// ───────── the character editor
VIEWS.character = {
  flush: true,
  head() { return `<button class="icon-btn" id="ceBack" title="Characters">${icon('back', 18)}</button><input class="title-input" id="ceName" spellcheck="false"><span class="pill" id="ceViews"></span><span class="save-state" id="ceState"></span>`; },
  actions() { return `<button class="btn" id="ceAsk">${icon('chat', 15)}Ask Claude</button><button class="btn" id="ceExport">${icon('export', 15)}Export</button>`; },
  async render(view) {
    try { CHS.c = await call('chars:get', S.arg); CHS.motions ||= await call('chars:motions'); } catch (e) { view.innerHTML = `<div class="empty"><b>Couldn’t open that character</b><span>${esc(e.message)}</span></div>`; return; }
    if (CHS.forId !== S.arg) { CHS.forId = S.arg; CHS.view = Object.keys(CHS.c.views)[0]; CHS.anim = (CHS.c.animations.find((a) => a.name === 'walk') || CHS.c.animations[0] || {}).id; CHS.frame = 0; CHS.dir = null; CHS.sel = null; }
    if (!CHS.c.views[CHS.view]) CHS.view = Object.keys(CHS.c.views)[0];
    view.innerHTML = `<div class="ce"><div class="ce-center"><div class="ce-stage" id="ceStage"><canvas id="ceCv"></canvas><canvas id="ceOv"></canvas></div><div class="ce-bar" id="ceBar"></div></div>
      <div class="ed-side ce-side"><div class="seg ce-tabs" id="ceTabs">${[['rig', 'Rig'], ['animate', 'Animate'], ['dirs', 'Directions'], ['skins', 'Skins & gear']].map(([k, n]) => `<button data-t="${k}" class="${CHS.tab === k ? 'on' : ''}">${n}</button>`).join('')}</div><div class="ce-panel" id="cePanel"></div></div></div>`;
    $('#ceName').value = CHS.c.name; fitTitles(); $('#ceViews').textContent = CHS.c.directions === 1 ? 'Side-scroller' : `${CHS.c.directions} directions`;
    $$('#ceTabs [data-t]').forEach((b) => (b.onclick = () => { CHS.tab = b.dataset.t; stopPlay(); $$('#ceTabs button').forEach((x) => x.classList.toggle('on', x === b)); drawCE(); }));
    $('#ceBack').onclick = () => go('characters'); $('#ceExport').onclick = () => exportCharacter(CHS.c.id);
    $('#ceAsk').onclick = () => askClaude(`Look at my character “${CHS.c.name}” (id ${CHS.c.id}) with view kind "character", then `);
    $('#ceName').onchange = async (e) => { CHS.c.name = e.target.value.trim() || CHS.c.name; await saveChar(); };
    CHS.ro = new ResizeObserver(() => drawStage()); CHS.ro.observe($('#ceStage')); wireStage(); drawCE();
  },
  leave() { stopPlay(); if (CHS.ro) CHS.ro.disconnect(); },
};
async function saveChar() { $('#ceState').textContent = 'Saving…'; try { CHS.c = await call('chars:save', CHS.c); $('#ceState').textContent = 'Saved'; } catch (e) { fail(e); } }
const curAnim = () => CHS.c.animations.find((a) => a.id === CHS.anim);
function stopPlay() { CHS.playing = false; clearTimeout(CHS.timer); }
function drawCE() { stopPlay(); CHS.previewFrames = null; const dl = dirsOf(CHS.c); if (!CHS.dir || !dl.some((d) => d.dir === CHS.dir)) CHS.dir = (dl.find((d) => d.dir === 'right') || dl[0]).dir; ({ rig: panelRig, animate: panelAnim, dirs: panelDirs, skins: panelSkins })[CHS.tab](); drawBar(); drawStage(); }

// the stage: rig tab = the picture with joints; animate = the posed frame with bone handles; other tabs = playback
async function drawStage() {
  const cv = $('#ceCv'), ov = $('#ceOv'), stage = $('#ceStage'); if (!cv || !CHS.c) return; const my = ++CHS.seq;
  let img, overlay = null;
  try {
    if (CHS.tab === 'rig') { const r = await call('chars:rest', CHS.c.id, CHS.view); img = r; overlay = { kind: 'joints', joints: r.joints, bones: r.bones, ox: 0, oy: 0 }; if (CHS.showParts) img = await partsTint(r); }
    else if (CHS.tab === 'animate' && curAnim() && !CHS.playing) { const a = curAnim(); const pose = poseOfFrame(a, CHS.frame); const r = await call('chars:pose', CHS.c.id, CHS.view, pose, CHS.box); CHS.box ||= r.box; img = r; overlay = { kind: 'bones', bones: r.bones, ox: r.box.x, oy: r.box.y }; }
    else { const f = CHS.previewFrames; if (!f) { await loadPreview(); return; } img = { w: f.w, h: f.h, data: f.frames[CHS.frame % f.frames.length] }; }
  } catch (e) { return; }
  if (my !== CHS.seq || !img) return;
  const box = stage.getBoundingClientRect(); const s = CHS.scale = Math.max(1, Math.floor(Math.min((box.width - 40) / img.w, (box.height - 40) / img.h)));
  cv.width = img.w; cv.height = img.h; cv.style.width = img.w * s + 'px'; cv.style.height = img.h * s + 'px'; cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), 0, 0);
  ov.width = img.w * s * devicePixelRatio; ov.height = img.h * s * devicePixelRatio; ov.style.width = cv.style.width; ov.style.height = cv.style.height; CHS.overlay = overlay; drawOverlay();
}
async function partsTint(r) {
  // colour each part (from the parts sprite's layers) so you can see how the picture was cut
  const c = CHS.c, v = c.views[CHS.view]; const fr = await call('sprites:get', v.sprite); const d = new Uint8ClampedArray(r.w * r.h * 4); const hues = {};
  fr.layers.forEach((l, i) => { hues[l.id] = (i * 137) % 360; });
  for (const l of fr.layers) { const cel = fr.cels[`${l.id}/${fr.frames[0].id}`]; if (!cel) continue; const data = cel instanceof Uint8ClampedArray ? cel : new Uint8ClampedArray(cel); const [hr, hg, hb] = hsl(hues[l.id], 70, 60); for (let i = 0; i < data.length; i += 4) if (data[i + 3]) { const L = (data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11) / 255; d[i] = hr * (0.45 + L * 0.6); d[i + 1] = hg * (0.45 + L * 0.6); d[i + 2] = hb * (0.45 + L * 0.6); d[i + 3] = 255; } }
  return { ...r, data: d };
}
function hsl(h, s, l) { s /= 100; l /= 100; const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return [f(0) * 255, f(8) * 255, f(4) * 255]; }
function drawOverlay() {
  const ov = $('#ceOv'); if (!ov) return; const c = ov.getContext('2d'); c.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); c.clearRect(0, 0, ov.width, ov.height); const o = CHS.overlay; if (!o) { ov.style.pointerEvents = 'none'; return; } ov.style.pointerEvents = 'auto';
  const s = CHS.scale, P = (p) => [(p[0] - o.ox) * s, (p[1] - o.oy) * s]; const col = (n) => (/_f$/.test(n) ? '#ff6f7d' : /_b$/.test(n) ? '#5dbdff' : '#ffcd75');
  c.lineCap = 'round';
  for (const b of o.bones) { if (!b.parent || b.name === 'hips') continue; const a = P(b.start), e = P(b.end); c.strokeStyle = 'rgba(10,8,16,.55)'; c.lineWidth = 6; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(e[0], e[1]); c.stroke(); c.strokeStyle = CHS.sel === b.name ? '#ffffff' : col(b.name); c.lineWidth = CHS.sel === b.name ? 3.5 : 2.2; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(e[0], e[1]); c.stroke(); }
  if (o.kind === 'joints') for (const [k, p] of Object.entries(o.joints)) { const [x, y] = P(p); c.fillStyle = col(k); c.strokeStyle = '#16141e'; c.lineWidth = 2; c.beginPath(); c.arc(x, y, CHS.drag && CHS.drag.joint === k ? 7 : 5.5, 0, Math.PI * 2); c.fill(); c.stroke(); }
  if (o.kind === 'bones') for (const b of o.bones) { if (!b.parent || b.name === 'hips') continue; const [x, y] = P(b.start); c.fillStyle = CHS.sel === b.name ? '#fff' : 'rgba(255,255,255,.75)'; c.strokeStyle = '#16141e'; c.lineWidth = 1.5; c.beginPath(); c.arc(x, y, 3.5, 0, Math.PI * 2); c.fill(); c.stroke(); }
}
function segD(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy; const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0; return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); }
function wireStage() {
  const ov = $('#ceOv');
  const at = (e) => { const r = ov.getBoundingClientRect(); const o = CHS.overlay; return [(e.clientX - r.left) / CHS.scale + o.ox, (e.clientY - r.top) / CHS.scale + o.oy]; };
  ov.onpointerdown = (e) => {
    const o = CHS.overlay; if (!o) return; const p = at(e);
    if (o.kind === 'joints') { let best = null, bd = 10 / CHS.scale; for (const [k, q] of Object.entries(o.joints)) { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = k; } } if (!best) return; ov.setPointerCapture(e.pointerId); CHS.drag = { joint: best }; $('#ceHint') && ($('#ceHint').textContent = best.replace(/_/g, ' ')); }
    else if (o.kind === 'bones') { let best = null, bd = 6 / CHS.scale; for (const b of o.bones) { if (!b.parent || b.name === 'hips') continue; const d = segD(p, b.start, b.end); if (d < bd) { bd = d; best = b; } } CHS.sel = best ? best.name : null; drawOverlay(); drawAnimSel(); if (!best) return; ov.setPointerCapture(e.pointerId); CHS.drag = { bone: best.name, start: best.start, a0: Math.atan2(p[1] - best.start[1], p[0] - best.start[0]), r0: (keyOf(curAnim(), CHS.frame)?.pose.bones?.[best.name]?.r) || 0, keyR: (keyOf(curAnim(), CHS.frame)?.pose.bones?.[best.name]?.r) || 0 }; }
  };
  ov.onpointermove = (e) => {
    const d = CHS.drag; if (!d) return; const p = at(e);
    if (d.joint) { CHS.overlay.joints[d.joint] = [Math.round(p[0] * 2) / 2, Math.round(p[1] * 2) / 2]; drawOverlay(); }
    else if (d.bone) { const a = Math.atan2(p[1] - d.start[1], p[0] - d.start[0]); d.delta = ((a - d.a0) * 180) / Math.PI; const tip = $('#ceHint'); if (tip) tip.textContent = `${d.bone.replace(/_/g, ' ')} ${Math.round(d.r0 + d.delta)}°`; }
  };
  ov.onpointerup = async () => {
    const d = CHS.drag; CHS.drag = null; if (!d) return;
    if (d.joint) { $('#ceState').textContent = 'Re-cutting…'; try { const r = await call('chars:joints', CHS.c.id, CHS.view, { [d.joint]: CHS.overlay.joints[d.joint] }); CHS.c = r.character; $('#ceState').textContent = 'Saved'; await loadProject(); drawStage(); } catch (e) { fail(e); } }
    else if (d.bone && d.delta) { const a = curAnim(); const r = Math.round((d.keyR + d.delta) * 10) / 10; try { CHS.c = await call('chars:anim', CHS.c.id, { action: 'pose', anim: a.id, view: CHS.view, frame: CHS.frame, pose: { bones: { [d.bone]: { r } } } }); CHS.previewFrames = null; drawBar(); drawStage(); drawAnimSel(); } catch (e) { fail(e); } }
  };
}
// the pose the editor shows for a frame (the main process computes motions; keys we can add here)
function keyOf(a, f) { const ks = (a.keys || {})[CHS.view] || []; return ks.find((k) => k.f === f); }
function poseOfFrame(a, f) { return { __anim: a.id, __frame: f }; }

// ───────── bottom bar: view/direction pickers + frame strip + play
async function loadPreview() {
  const a = curAnim(); const my = ++CHS.seq;
  try { const r = await call('chars:preview', CHS.c.id, CHS.tab === 'animate' ? { anim: a && a.id, view: CHS.view } : { anim: a && a.id, dir: CHS.dir || undefined }); if (my !== CHS.seq) return; CHS.previewFrames = r; ceDrawStrip(); drawStage(); if (CHS.tab !== 'rig' && CHS.tab !== 'animate' && !CHS.playing) play(); } catch (e) { fail(e); }
}
function drawBar() {
  const bar = $('#ceBar'); if (!bar) return; const c = CHS.c; const views = Object.keys(c.views);
  const viewSeg = `<div class="seg sm">${views.map((v) => `<button data-view="${v}" class="${CHS.view === v ? 'on' : ''}">${VIEW_NAMES[v]}</button>`).join('')}</div>`;
  if (CHS.tab === 'rig') { bar.innerHTML = `${viewSeg}<span class="muted tiny" id="ceHint">Drag a joint to move it — the parts are re-cut when you let go.</span>`; }
  else { const a = curAnim(); bar.innerHTML = `${CHS.tab === 'animate' ? viewSeg : `<select class="select sm" id="ceDir">${dirsOf(c).map((d) => `<option value="${d.dir}" ${CHS.dir === d.dir ? 'selected' : ''}>${DIR_NAMES[d.dir] || d.dir}${d.mirror ? ' (mirrored)' : d.fallback ? ` (stand-in: ${VIEW_NAMES[d.view]})` : ''}</option>`).join('')}</select>`}
      <select class="select sm" id="ceAnimSel">${c.animations.map((x) => `<option value="${x.id}" ${x.id === CHS.anim ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      <button class="icon-btn" id="cePlay" title="Play">${icon(CHS.playing ? 'pause' : 'play', 16)}</button><div class="ce-strip" id="ceStrip"></div><span class="muted tiny" id="ceHint">${CHS.tab === 'animate' ? (a ? 'Click a bone, drag to turn it: that frame gets a key' : '') : ''}</span>`;
    $('#ceAnimSel').onchange = (e) => { CHS.anim = e.target.value; CHS.frame = 0; CHS.box = null; drawCE(); };
    $('#cePlay').onclick = () => (CHS.playing ? (stopPlay(), drawBar(), drawStage()) : play());
    const ds = $('#ceDir'); if (ds) ds.onchange = (e) => { CHS.dir = e.target.value; CHS.previewFrames = null; stopPlay(); loadPreview(); };
    ceDrawStrip(); }
  $$('#ceBar [data-view]').forEach((b) => (b.onclick = () => { CHS.view = b.dataset.view; CHS.box = null; CHS.previewFrames = null; drawCE(); }));
}
function ceDrawStrip() {
  const host = $('#ceStrip'); const a = curAnim(); if (!host || !a) return; const keyed = new Set(((a.keys || {})[CHS.view] || []).map((k) => k.f));
  host.innerHTML = Array.from({ length: a.frames }, (_, f) => `<button class="ce-f ${f === CHS.frame % a.frames ? 'on' : ''} ${keyed.has(f) && CHS.tab === 'animate' ? 'key' : ''}" data-f="${f}">${f + 1}</button>`).join('');
  $$('.ce-f', host).forEach((b) => (b.onclick = () => { stopPlay(); CHS.frame = +b.dataset.f; drawBar(); drawStage(); }));
}
async function play() {
  if (!CHS.previewFrames) { await loadPreview(); }
  const f = CHS.previewFrames; if (!f) return; CHS.playing = true; const b = $('#cePlay'); if (b) b.innerHTML = icon('pause', 16); const ov = $('#ceOv'); CHS.overlay = null; drawOverlay();
  const tick = () => { if (!CHS.playing || !['character'].includes(S.view)) return; const f = CHS.previewFrames; if (!f) { CHS.timer = setTimeout(tick, 100); return; } CHS.frame = (CHS.frame + 1) % f.frames.length; const cv = $('#ceCv'); if (cv && cv.width === f.w) cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(f.frames[CHS.frame]), f.w, f.h), 0, 0); else drawStage(); $$('#ceStrip .ce-f').forEach((x, i) => x.classList.toggle('on', i === CHS.frame)); CHS.timer = setTimeout(tick, Math.round(1000 / (f.fps || 10))); };
  void ov; CHS.timer = setTimeout(tick, 60); drawStage();
}

// ───────── panels
function panelRig() {
  const c = CHS.c, v = c.views[CHS.view];
  $('#cePanel').innerHTML = `<div class="panel-h">Rig · ${VIEW_NAMES[CHS.view]}</div><div class="ce-p">
    <p class="muted small">Red joints are the near side, blue the far side, yellow the spine and head. Drag any that are off; the picture is re-cut into parts when you let go.</p>
    <label class="chk"><input type="checkbox" id="crParts" ${CHS.showParts ? 'checked' : ''}> Show the parts in colour</label>
    <label class="chk"><input type="checkbox" id="crRobe" ${v.robe ? 'checked' : ''}> Robe or long dress (the legs barely swing)</label>
    <div class="field"><label>Far arm and leg (side views)</label><div class="seg sm" id="crBack">${[['auto', 'Auto'], ['copy', 'Copy the near ones'], ['own', 'Cut from picture']].map(([k, n]) => `<button data-b="${k}" class="${(v.backLimbs || 'auto') === k ? 'on' : ''}">${n}</button>`).join('')}</div></div>
    <div class="ce-btns"><button class="btn" id="crAuto">${icon('wand', 14)}Find joints again</button><button class="btn" id="crEdit">${icon('edit', 14)}Draw on the parts</button></div>
    <p class="muted tiny">Parts are layers of an ordinary sprite (“${esc(c.name)} · ${CHS.view}”): fix a hole, redraw a hand, shade them — animations pick it up.</p></div>`;
  $('#crParts').onchange = (e) => { CHS.showParts = e.target.checked; drawStage(); };
  $('#crRobe').onchange = async (e) => { try { const r = await call('chars:joints', c.id, CHS.view, {}, { recut: false, robe: e.target.checked }); CHS.c = r.character; CHS.previewFrames = null; toast(e.target.checked ? 'Legs softened' : 'Legs move freely', 'Every animation in this view follows.'); } catch (x) { fail(x); } };
  $$('#crBack [data-b]').forEach((b) => (b.onclick = async () => { $$('#crBack button').forEach((x) => x.classList.toggle('on', x === b)); try { const r = await call('chars:joints', c.id, CHS.view, {}, { backLimbs: b.dataset.b }); CHS.c = r.character; drawStage(); } catch (e) { fail(e); } }));
  $('#crAuto').onclick = async () => { $('#crAuto').innerHTML = '<span class="spin"></span>Looking…'; try { const r = await call('chars:autoJoints', c.id, CHS.view); CHS.c = r.character; toast('Joints found', r.notes.slice(0, 2).join(' · ')); panelRig(); drawStage(); } catch (e) { fail(e); panelRig(); } };
  $('#crEdit').onclick = () => go('editor', v.sprite);
}
function panelAnim() {
  const c = CHS.c; const a = curAnim();
  $('#cePanel').innerHTML = `<div class="panel-h">Animations<span class="grow"></span><button class="btn xs" id="caAdd">${icon('plus', 13)}Add</button><button class="btn xs" id="caVideo">${icon('film', 13)}From video</button></div>
    <div class="ce-anims">${c.animations.map((x) => `<button class="ce-anim ${x.id === CHS.anim ? 'on' : ''}" data-a="${x.id}"><b>${esc(x.name)}</b><span>${x.motion ? CHS.motions[x.motion]?.label || x.motion : 'keyed'}${Object.keys(x.keys || {}).length && x.motion ? ' + keys' : ''} · ${x.frames}f · ${x.fps}fps${x.loop ? ' · loop' : ''}</span></button>`).join('')}</div>
    ${a ? `<div class="panel-h" style="margin-top:6px">${esc(a.name)}<span class="grow"></span><button class="icon-btn xs" id="caMore">${icon('more', 15)}</button></div><div class="ce-p">
      <div class="row" style="gap:8px"><div class="field"><label>Frames</label><input class="input sm" type="number" id="caFrames" min="1" max="64" value="${a.frames}"></div><div class="field"><label>FPS</label><input class="input sm" type="number" id="caFps" min="1" max="60" value="${a.fps}"></div></div>
      ${a.motion ? `<div class="field"><label>Motion <b>${esc(CHS.motions[a.motion]?.label || a.motion)}</b> · strength <b id="caAmpV">${(a.amp ?? 1).toFixed(2)}</b></label><input type="range" id="caAmp" min="0.2" max="1.6" step="0.05" value="${a.amp ?? 1}"></div>` : ''}
      <label class="chk"><input type="checkbox" id="caLoop" ${a.loop ? 'checked' : ''}> Loops</label>
      <div class="ce-sel" id="caSel"></div></div>` : ''}`;
  $$('.ce-anim').forEach((b) => (b.onclick = () => { CHS.anim = b.dataset.a; CHS.frame = 0; CHS.box = null; drawCE(); }));
  $('#caAdd').onclick = addAnim; $('#caVideo').onclick = animFromVideo;
  if (!a) return;
  const upd = async (patch) => { try { CHS.c = await call('chars:anim', c.id, { action: 'update', anim: a.id, ...patch }); CHS.previewFrames = null; CHS.box = null; drawBar(); drawStage(); } catch (e) { fail(e); } };
  $('#caFrames').onchange = (e) => upd({ frames: Math.max(1, Math.min(64, +e.target.value | 0)) }); $('#caFps').onchange = (e) => upd({ fps: Math.max(1, Math.min(60, +e.target.value | 0)) });
  const amp = $('#caAmp'); if (amp) { amp.oninput = (e) => { $('#caAmpV').textContent = (+e.target.value).toFixed(2); }; amp.onchange = (e) => upd({ amp: +e.target.value }); }
  $('#caLoop').onchange = (e) => upd({ loop: e.target.checked });
  $('#caMore').onclick = (e) => menu(e.currentTarget, [{ label: 'Rename…', icon: 'edit', run: async () => { const n = await promptBox({ title: 'Rename animation', value: a.name }); if (n) upd({ name: n.trim() }).then(panelAnim); } }, a.motion ? { label: `Turn the motion into keys (${VIEW_NAMES[CHS.view]})`, icon: 'wand', run: async () => { CHS.c = await call('chars:anim', c.id, { action: 'bake', anim: a.id, view: CHS.view }); drawCE(); } } : null, { label: `Clear keys (${VIEW_NAMES[CHS.view]})`, icon: 'undo', run: async () => { CHS.c = await call('chars:anim', c.id, { action: 'clear_keys', anim: a.id, view: CHS.view }); drawCE(); } }, '-', { label: 'Delete animation', icon: 'trash', danger: true, run: async () => { CHS.c = await call('chars:anim', c.id, { action: 'remove', anim: a.id }); CHS.anim = (CHS.c.animations[0] || {}).id; drawCE(); } }].filter(Boolean));
  drawAnimSel();
}
function drawAnimSel() {
  const host = $('#caSel'); if (!host) return; const a = curAnim(); if (!CHS.sel) { host.innerHTML = `<p class="muted tiny">Click a bone on the stage, then drag it round its joint. The frame gets a key (a dot in the strip); keys play on top of the motion and blend between frames.</p>`; return; }
  const k = keyOf(a, CHS.frame); const r = k?.pose.bones?.[CHS.sel]?.r || 0;
  host.innerHTML = `<div class="field"><label>${CHS.sel.replace(/_/g, ' ')} · frame ${CHS.frame + 1} key <b id="csV">${r}°</b></label><input type="range" id="csR" min="-180" max="180" step="1" value="${r}"></div>`;
  $('#csR').oninput = (e) => { $('#csV').textContent = e.target.value + '°'; };
  $('#csR').onchange = async (e) => { try { CHS.c = await call('chars:anim', CHS.c.id, { action: 'pose', anim: a.id, view: CHS.view, frame: CHS.frame, pose: { bones: { [CHS.sel]: { r: +e.target.value } } } }); ceDrawStrip(); drawStage(); } catch (x) { fail(x); } };
}
async function addAnim() {
  const have = new Set(CHS.c.animations.map((a) => a.motion)); const opts = Object.entries(CHS.motions).map(([k, m]) => ({ value: k, label: `${m.label}${have.has(k) ? ' (another)' : ''}` }));
  const r = await promptBox({ title: 'Add an animation', fields: [{ key: 'motion', label: 'Start from', value: opts.find((o) => !have.has(o.value))?.value || 'walk', options: [...opts, { value: '', label: 'Nothing — pose it myself' }] }, { key: 'name', label: 'Name', placeholder: 'e.g. heavy attack' }], ok: 'Add' });
  if (!r) return; const name = r.name.trim() || (r.motion ? (have.has(r.motion) ? `${r.motion} 2` : r.motion) : 'custom');
  try { CHS.c = await call('chars:anim', CHS.c.id, { action: 'add', motion: r.motion || null, name, frames: r.motion ? undefined : 8 }); CHS.anim = CHS.c.animations[CHS.c.animations.length - 1].id; CHS.frame = 0; CHS.box = null; drawCE(); } catch (e) { fail(e); }
}
async function animFromVideo() {
  let clips = []; try { clips = await call('clips:list'); } catch {}
  const r = await promptBox({ title: 'Motion from video', text: 'A clip of a person doing the move — side-on for side views, facing the camera for front views. The pose model reads it offline and keys the bones of this view.', fields: [{ key: 'src', label: 'Video', value: clips[0] ? clips[0].id : '__file', options: [...clips.map((x) => ({ value: x.id, label: `Clip: ${x.name}` })), { value: '__file', label: 'Choose a video file…' }] }, { key: 'name', label: 'Animation name', placeholder: 'e.g. uppercut' }, { key: 'frames', label: 'Frames to keep', type: 'number', value: '12' }, { key: 'loop', label: 'Loop', value: 'yes', options: [{ value: 'yes', label: 'Loops' }, { value: 'no', label: 'Plays once' }] }], ok: 'Read the motion' });
  if (!r) return; let src = { clip: r.src }; if (r.src === '__file') { const f = await call('dialog:files', { filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'webm', 'gif', 'm4v'] }] }); if (!f) return; src = { file: f[0] }; }
  const t = toast('Reading the motion…', 'The pose model is going through every frame.', 'info', 60000);
  try { const x = await call('chars:fromVideo', CHS.c.id, { ...src, name: r.name.trim() || undefined, view: CHS.view, frames: Math.max(2, Math.min(48, +r.frames || 12)), loop: r.loop === 'yes' }); t.remove(); CHS.c = x.character; CHS.anim = x.anim.id; CHS.frame = 0; CHS.box = null; toast('Motion added', `A person was found in ${x.detected} of ${x.of} frames.`); drawCE(); } catch (e) { t.remove(); fail(e); }
}
async function panelDirs() {
  const c = CHS.c;
  const DIR_VIEWS = { 1: ['side'], 4: ['side', 'front', 'back'], 8: ['side', 'front', 'back', 'front34', 'back34'] };
  $('#cePanel').innerHTML = `<div class="panel-h">Directions</div><div class="ce-p">
    <div class="seg" id="cdN">${[[1, 'Side-scroller'], [4, '4 directions'], [8, '8 directions']].map(([n, l]) => `<button data-n="${n}" class="${c.directions === n ? 'on' : ''}">${l}</button>`).join('')}</div>
    <p class="muted tiny">${c.directions === 1 ? 'Right, and left mirrored.' : c.directions === 4 ? 'Down uses the front view, up the back view, right the side view, left the side view mirrored.' : 'Adds ¾ views for the diagonals (mirrored for the left ones).'} Missing views stand in with the nearest one until you add them.</p>
    <div class="cd-grid">${(DIR_VIEWS[c.directions] || DIR_VIEWS[1]).map((v) => `<div class="cd-slot ${c.views[v] ? 'has' : ''}" data-v="${v}"><div class="cd-pic"><canvas></canvas>${c.views[v] ? '' : `<span class="muted tiny">No ${VIEW_NAMES[v].toLowerCase()} view</span>`}</div><div class="cd-name">${VIEW_NAMES[v]}</div><button class="btn xs cd-set">${c.views[v] ? 'Replace…' : 'Add…'}</button></div>`).join('')}</div>
    <div class="cd-turn"><b>No other pictures?</b><span>Make a turnaround: a video model turns your character on the spot (Animate), then you pick the frames for each view.</span><button class="btn" id="cdTurn">${icon('film', 14)}Make a turnaround</button><button class="btn ghost" id="cdPick">${icon('check', 14)}Pick views from a clip…</button></div></div>`;
  $$('#cdN [data-n]').forEach((b) => (b.onclick = async () => { c.directions = +b.dataset.n; await saveChar(); CHS.dir = null; drawCE(); }));
  $$('.cd-slot').forEach(async (el) => { const v = el.dataset.v; if (c.views[v]) { const r = await call('chars:preview', c.id, { view: v }); const cv = $('canvas', el); new Player(cv, { pad: 4, max: 4, bg: 'checker' }).set(r.frames, { w: r.w, h: r.h, durations: [200] }); } $('.cd-set', el).onclick = (e) => setViewMenu(e.currentTarget, v); });
  $('#cdTurn').onclick = async () => { try { toast('Turnaround started', 'It runs in Animate (the video engine you picked there). This takes a few minutes; pick the views when the clip is ready.', 'info', 9000); await call('chars:turnaround', c.id, {}); toast('Turnaround ready', 'Now pick a frame for each view.'); pickViews(); } catch (e) { fail(e); } };
  $('#cdPick').onclick = pickViews;
}
function dirsOf(c) { const DIRS = { 1: [['right', 'side', false], ['left', 'side', true]], 4: [['down', 'front', false], ['up', 'back', false], ['right', 'side', false], ['left', 'side', true]], 8: [['down', 'front', false], ['down_right', 'front34', false], ['right', 'side', false], ['up_right', 'back34', false], ['up', 'back', false], ['up_left', 'back34', true], ['left', 'side', true], ['down_left', 'front34', true]] }; const FB = { front34: ['side', 'front'], back34: ['side', 'back'], back: ['front', 'side'], front: ['side'], side: ['front'] }; const list = (DIRS[c.directions] || DIRS[1]).map(([dir, view, mirror]) => { const have = c.views[view] ? view : (FB[view] || []).find((v) => c.views[v]) || Object.keys(c.views)[0]; return { dir, view: have, mirror, fallback: have !== view }; }); return list; }
function setViewMenu(anchor, v) {
  const c = CHS.c; const others = Object.keys(c.views).filter((x) => x !== v);
  menu(anchor, [{ label: 'From a picture…', icon: 'image', run: async () => { const f = await call('dialog:files', { filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] }); if (f) addViewFrom(v, { file: f[0] }); } }, { label: 'From a sprite…', icon: 'sprites', run: async () => { const sp = S.sprites.filter((s) => !s.tileset && !s.partsOf); const r = await promptBox({ title: `${VIEW_NAMES[v]} view from a sprite`, fields: [{ key: 's', label: 'Sprite', value: sp[0] && sp[0].id, options: sp.map((s) => ({ value: s.id, label: `${s.name} · ${s.w}×${s.h}` })) }], ok: 'Use it' }); if (r) addViewFrom(v, { sprite: r.s }); } }, ...others.map((o) => ({ label: `Mirror the ${VIEW_NAMES[o].toLowerCase()} view`, icon: 'flip', run: () => addViewFrom(v, { mirrorOf: o }) }))]);
}
async function addViewFrom(v, src) { const t = toast('Adding the view…', 'Finding joints and cutting parts.', 'info', 30000); try { const r = await call('chars:addView', CHS.c.id, v, src, {}); t.remove(); CHS.c = r.character; toast(`${VIEW_NAMES[v]} view added`, r.notes.slice(0, 2).join(' · ')); CHS.view = v; drawCE(); } catch (e) { t.remove(); fail(e); } }
async function pickViews() {
  let clips = []; try { clips = await call('clips:list'); } catch {} if (!clips.length) { toast('No clips yet', 'Make a turnaround first, or import a video of the character turning in Animate.', 'info'); return; }
  const st = { clip: clips[0].id, picks: {} };
  const el = openSheet(`<div class="sheet-head">${icon('film', 20)}<div class="grow"><h3>Pick views from a clip</h3><div class="muted small">Click a frame, then the view it shows. Frames are keyed off the green screen and scaled to the character.</div></div></div>
    <div class="sheet-body"><div class="field"><label>Clip</label><select class="select" id="pvClip">${clips.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></div><div class="pv-strip" id="pvStrip"></div><div class="pv-picks" id="pvPicks"></div></div>
    <div class="sheet-foot"><span class="grow"></span><button class="btn" id="pvCancel">Cancel</button><button class="btn primary" id="pvGo">${icon('check', 15)}Make views</button></div>`, { width: 860 });
  let sel = null;
  const drawPicks = () => { $('#pvPicks', el).innerHTML = ['front', 'side', 'back', 'front34', 'back34'].map((v) => `<button class="btn sm ${st.picks[v] !== undefined ? 'primary' : ''}" data-v="${v}">${VIEW_NAMES[v]}${st.picks[v] !== undefined ? ` · frame ${st.picks[v] + 1}` : ''}</button>`).join(''); $$('#pvPicks [data-v]', el).forEach((b) => (b.onclick = () => { if (sel === null) { toast('Pick a frame first', '', 'info'); return; } st.picks[b.dataset.v] = sel; drawPicks(); })); };
  const load = async () => { const r = await call('animate:raw', st.clip, { count: 24, max: 120 }); const host = $('#pvStrip', el); host.innerHTML = r.frames.map((_, i) => `<button class="pv-f" data-i="${i}"><canvas width="${r.w}" height="${r.h}"></canvas><span>${i + 1}</span></button>`).join(''); const step = Math.max(1, Math.round(r.durations[0] * r.clip.fps / 1000)); $$('.pv-f', host).forEach((b, i) => { $('canvas', b).getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(r.frames[i]), r.w, r.h), 0, 0); b.dataset.src = i * step; b.onclick = () => { sel = +b.dataset.src; $$('.pv-f', host).forEach((x) => x.classList.toggle('on', x === b)); }; }); };
  const auto = async () => { const c0 = st.clip; try { const r = await call('chars:autoPick', c0); if (st.clip !== c0 || Object.keys(st.picks).length) return; st.picks = { ...r.picks }; drawPicks(); toast('Views suggested', r.notes[r.notes.length - 1] || '', 'info'); } catch (e) { /* manual picking still works */ } };
  $('#pvClip', el).onchange = (e) => { st.clip = e.target.value; st.picks = {}; drawPicks(); load(); auto(); };
  $('#pvCancel', el).onclick = closeSheet; drawPicks(); load(); auto();
  $('#pvGo', el).onclick = async () => { if (!Object.keys(st.picks).length) return; const b = $('#pvGo', el); b.disabled = true; b.innerHTML = '<span class="spin"></span>Making views…'; try { const r = await call('chars:pick', CHS.c.id, st.clip, st.picks); closeSheet(); CHS.c = r.character; toast('Views added', Object.keys(st.picks).map((v) => VIEW_NAMES[v]).join(', ')); drawCE(); } catch (e) { b.disabled = false; b.innerHTML = 'Make views'; fail(e); } };
}
function panelSkins() {
  const c = CHS.c; const bones = ['hand_f', 'hand_b', 'head', 'torso', 'lower_arm_f', 'lower_arm_b', 'foot_f', 'foot_b', 'hips'];
  $('#cePanel').innerHTML = `<div class="panel-h">Skins<span class="grow"></span><button class="btn xs" id="csAdd">${icon('plus', 13)}Skin</button></div>
    <div class="ce-anims">${c.skins.map((k) => `<button class="ce-anim ${c.skin === k.name ? 'on' : ''}" data-k="${esc(k.name)}"><b>${esc(k.name)}</b><span>${k.frame ? `parts frame ${k.frame + 1}` : 'the picture'}${k.recolor ? ` · ${Object.keys(k.recolor).length} recolours` : ''}</span></button>`).join('')}</div>
    <div class="ce-p"><button class="btn sm" id="csRecolor">${icon('palette', 13)}Recolour this skin…</button><p class="muted tiny">A skin’s parts are a frame of each view’s parts sprite: draw replacement parts there. Empty layers use the default parts.</p></div>
    <div class="panel-h">Gear<span class="grow"></span><button class="btn xs" id="cgAdd">${icon('plus', 13)}Attach</button></div>
    <div class="ce-anims">${(c.attachments || []).map((a) => `<div class="ce-anim static"><b>${esc(a.name)}</b><span>on ${a.bone.replace(/_/g, ' ')} · ${a.z}${a.skin ? ` · ${esc(a.skin)} only` : ''}</span><button class="icon-btn xs" data-del="${a.id}" title="Remove">${icon('x', 13)}</button></div>`).join('') || '<p class="muted tiny" style="padding:4px 2px">Weapons, hats, shields: a sprite pinned to a bone. It moves with every animation and exports with the rig.</p>'}</div>`;
  const op = async (o) => { try { CHS.c = await call('chars:skin', c.id, o); CHS.previewFrames = null; panelSkins(); loadPreview(); } catch (e) { fail(e); } };
  $$('.ce-anim[data-k]').forEach((b) => (b.onclick = () => op({ action: 'use', name: b.dataset.k })));
  $$('[data-del]').forEach((b) => (b.onclick = () => op({ action: 'detach', id: b.dataset.del })));
  $('#csAdd').onclick = async () => { const n = await promptBox({ title: 'New skin', text: 'Adds a frame to every view’s parts sprite for this skin’s parts. Start by recolouring, or draw new parts.', placeholder: 'e.g. Gold armour' }); if (n) op({ action: 'add', name: n.trim() }); };
  $('#csRecolor').onclick = async () => { const s = await call('sprites:get', c.views[CHS.view].sprite); const pal = s.palette.slice(0, 12); const sk = c.skins.find((k) => k.name === c.skin) || {}; const r = await promptBox({ title: `Recolour “${c.skin}”`, text: 'Pick a colour for any of the character’s colours (leave as is to keep it).', fields: pal.map((h, i) => ({ key: 'c' + i, label: h, value: (sk.recolor || {})[h] || h, type: 'color' })), ok: 'Apply' }); if (!r) return; const map = {}; pal.forEach((h, i) => { if (r['c' + i] && r['c' + i].toLowerCase() !== h.toLowerCase()) map[h] = r['c' + i]; }); op({ action: 'recolor', name: c.skin, recolor: map }); };
  $('#cgAdd').onclick = async () => { const sp = S.sprites.filter((s) => !s.tileset && !s.partsOf); if (!sp.length) { toast('No item sprites', 'Draw a sword or hat as a sprite first.', 'info'); return; } const r = await promptBox({ title: 'Attach gear', fields: [{ key: 's', label: 'Item', value: sp[0].id, options: sp.map((s) => ({ value: s.id, label: `${s.name} · ${s.w}×${s.h}` })) }, { key: 'b', label: 'Bone', value: 'hand_f', options: bones.map((b) => ({ value: b, label: b.replace(/_f$/, ' (near)').replace(/_b$/, ' (far)').replace(/_/g, ' ') })) }, { key: 'z', label: 'Layer', value: 'front', options: [{ value: 'front', label: 'In front of the body' }, { value: 'back', label: 'Behind the body' }] }, { key: 'rot', label: 'Rotation (degrees)', type: 'number', value: '0' }, { key: 'y', label: 'Grip: rows from the item’s bottom', type: 'number', value: '2' }], ok: 'Attach' }); if (!r) return; const s = S.sprites.find((x) => x.id === r.s); op({ action: 'attach', sprite: r.s, bone: r.b, z: r.z, rot: +r.rot || 0, py: Math.max(0, s.h - (+r.y || 0)) }); };
}
