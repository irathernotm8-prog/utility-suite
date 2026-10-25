// Facet — Create: compose (prompt, picture or several views) on the left; ideas, progress and the result on the stage.
import { $, $$, esc, h, toast, menu, fileUrl, fmtNum } from './util.js';
import { ic } from './icons.js';
import { Viewer } from './viewer.js';
import { S, onChange, go, model, installed, fit, FIT_LABEL, speed, deviceLabel, saveSettings, refreshLibrary, setHead } from './app.js';
import { openRig, exportFor } from './rigui.js';

const F = window.facet;
const STYLES = [['object', 'Object'], ['character', 'Character'], ['game', 'Game asset'], ['lowpoly', 'Low-poly'], ['figurine', 'Figurine'], ['prop', 'Prop']];
const PROMPT_IDEAS = ['a brass steampunk owl with gear wings', 'a cozy ceramic mug shaped like a frog', 'a low wooden stool with three legs', 'a cute robot mascot with round eyes', 'a medieval knight helmet with a red plume', 'a potted cactus in a terracotta pot', 'a vintage film camera', 'a treasure chest with iron bands'];
const VIEW_SLOTS = [['front', 'Front'], ['left', 'Left'], ['back', 'Back'], ['right', 'Right']];

let root = null, built = false, viewer = null;
const st = {
  prompt: '', image: null, views: {}, ideas: null, pick: null, ideaJob: null, makeJob: null,
  stage: 'empty', result: null, viewMode: 'shaded', spin: true, grid: false, adv: false
};
const C = () => S.settings.create;
const setC = (p) => saveSettings({ create: p });

export function show(pane) {
  root = pane;
  pane.classList.add('flush');
  if (!built) build();
  renderCompose();
  renderStage();
  renderHead();
}
export function hide() {}

export function useImages(paths) {
  const imgs = paths.filter(Boolean);
  if (!imgs.length) return;
  if (C().mode === 'views') {
    for (const [k] of VIEW_SLOTS) { if (!imgs.length) break; if (!st.views[k]) st.views[k] = imgs.shift(); }
  } else {
    st.image = imgs[0];
    if (C().mode !== 'image') setC({ mode: 'image' });
  }
  renderCompose();
  renderStage();
}

function build() {
  built = true;
  root.innerHTML = `<div class="create"><div class="compose"><div class="compose-scroll" id="cScroll"></div><div class="compose-foot" id="cFoot"></div></div><div class="stage" id="stage"><div class="viewer-host" id="vHost"></div><div id="stageLayer"></div></div></div>`;
  onChange((w) => {
    if (w === 'models' || w === 'settings' || w === 'engine') { renderCompose(); if (st.stage === 'empty') renderStage(); }
    if (w?.job) onJob(w.job);
  });
  addEventListener('paste', async (e) => {
    if (S.view !== 'create' || /input|textarea/i.test(document.activeElement?.tagName || '')) return;
    const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
    if (!f) return;
    e.preventDefault();
    const p = F.pathFor(f) || await F.saveTemp(f.name || 'paste.png', new Uint8Array(await f.arrayBuffer()));
    useImages([p]);
  });
}

/* ───────────────────────── compose panel ───────────────────────── */
function shapeEngines() {
  const multi = C().mode === 'views';
  return S.models.filter((m) => (m.kind === 'shape' && !!m.multiview === multi) || (m.kind === 'cloud' && !multi));
}
function currentEngine() {
  const list = shapeEngines();
  const want = C().engine;
  const m = list.find((x) => x.id === want && x.installed) || list.find((x) => x.installed) || null;
  return m;
}

function renderCompose() {
  if (!root) return;
  const c = C();
  const mode = c.mode;
  const box = $('#cScroll', root);
  const imageModels = S.models.filter((m) => m.kind === 'image');
  const haveImageModel = imageModels.some((m) => m.installed);
  const eng = currentEngine();
  const envReady = S.engine?.installed;

  let input = '';
  if (mode === 'prompt') {
    input = `
      <div class="prompt-box"><textarea class="textarea" id="pText" rows="4" maxlength="400" placeholder="Describe one object… e.g. ${esc(PROMPT_IDEAS[Math.floor(Date.now() / 60000) % PROMPT_IDEAS.length])}">${esc(st.prompt)}</textarea><span class="count" id="pCount">${st.prompt.length}/400</span></div>
      <div class="chips" id="styles">${STYLES.map(([id, label]) => `<button class="chip ${c.style === id ? 'on' : ''}" data-style="${id}">${label}</button>`).join('')}</div>
      <div class="inline-opts">
        <select class="select" id="imgModel">${imageModels.map((m) => `<option value="${m.id}" ${m.id === c.imageModel ? 'selected' : ''} ${m.installed ? '' : 'disabled'}>${esc(m.name)}${m.installed ? '' : ' (not downloaded)'}</option>`).join('')}</select>
        <div class="seg" id="ideaCount">${[1, 2, 4].map((n) => `<button class="${c.ideas === n ? 'on' : ''}" data-n="${n}">${n}</button>`).join('')}</div>
      </div>
      ${eng?.kind === 'cloud' ? '<div class="hint">Tripo can build straight from the prompt, or you can sketch ideas here first and send the one you like.</div>' : haveImageModel ? '<div class="hint">Facet sketches a few ideas first. Pick the one you like and it becomes 3D.</div>' : `<div class="note info">${ic('info', 15)}<div>Prompts need a sketch model. <button class="link-btn" data-go="models">Get SD Turbo</button> (2.6 GB).</div></div>`}`;
  } else if (mode === 'image') {
    input = dropZone('single', st.image, 'Drop a picture of one object', 'Photo, render or drawing · click to browse · or paste');
  } else {
    const mv = S.models.find((m) => m.multiview);
    input = `<div class="views-grid">${VIEW_SLOTS.map(([k, label]) => dropZone(k, st.views[k], label, k === 'front' ? 'Required' : 'Optional', true)).join('')}</div>
      <div class="hint">Photos of the same object from the front and its sides. Two or more views give the best shape.</div>
      ${mv && !mv.installed ? `<div class="note info">${ic('info', 15)}<div>Multi-view needs <b>${esc(mv.name)}</b>. <button class="link-btn" data-go="models">Get it in Models</button></div></div>` : ''}`;
  }

  const engines = shapeEngines();
  const engRows = engines.map((m) => {
    const f = fit(m);
    const sel = eng?.id === m.id;
    return `<button class="eng ${sel ? 'on' : ''} ${m.installed ? '' : 'off'}" data-eng="${m.id}">
      <span class="radio"></span>
      <span class="grow"><b>${esc(m.label)}</b> <span class="e-sub">· ${esc(m.short || m.name)}</span><br><span class="e-sub">${esc(m.tagline)}</span></span>
      <span class="e-right">${m.kind === 'cloud' ? (m.installed ? 'Cloud<br><span>uses credits</span>' : '<span class="link-btn">Add API key</span>') : m.installed ? `${esc(speed(m))}<br><span style="color:var(--${FIT_LABEL[f][0] === 'ok' ? 'mut' : FIT_LABEL[f][0]})">${f === 'great' || f === 'ok' ? '' : esc(FIT_LABEL[f][1])}</span>` : `<span class="link-btn">Get · ${(m.sizeMB / 1024).toFixed(1)} GB</span>`}</span>
    </button>`;
  }).join('');

  const canColor = eng && !eng.colors && installed('triposr');
  const detail = (eng?.detail || model('triposr')?.detail || []);
  box.innerHTML = `
    <div class="seg full" id="modeSeg" style="margin-top:2px">
      <button data-mode="prompt" class="${mode === 'prompt' ? 'on' : ''}">${ic('type', 14)}Prompt</button>
      <button data-mode="image" class="${mode === 'image' ? 'on' : ''}">${ic('image', 14)}Picture</button>
      <button data-mode="views" class="${mode === 'views' ? 'on' : ''}">${ic('views', 14)}Views</button>
    </div>
    ${input}
    ${mode === 'image' && eng?.kind !== 'cloud' ? `<div class="opt-row"><div class="grow"><b>Remove background</b><span>Leave on unless the picture is already cut out</span></div><button class="switch ${c.removeBg ? 'on' : ''}" id="swBg"></button></div>` : ''}
    <div class="block-label"><span class="grow">3D engine</span><button class="link-btn" data-go="models">Manage</button></div>
    <div class="engines">${engRows || '<div class="hint">No engines in this group yet.</div>'}</div>
    ${detail.length ? `<div class="field"><label>Detail</label><div class="seg full" id="detailSeg">${detail.map((d) => `<button data-d="${d.id}" class="${c.detail === d.id ? 'on' : ''}">${d.label}</button>`).join('')}</div></div>` : ''}
    ${surfaceBlock(c, eng)}
    ${eng && eng.kind !== 'cloud' && !eng.colors && (c.texture || 'picture') === 'picture' ? `<div class="opt-row"><div class="grow"><b>Guess the hidden sides</b><span>${canColor ? 'Uses the Fast engine’s colour read for the back and sides. Adds a little time.' : 'Needs the Fast engine (TripoSR) downloaded.'}</span></div><button class="switch ${canColor && c.colorize ? 'on' : ''}" id="swColor" ${canColor ? '' : 'disabled'}></button></div>` : ''}
    ${c.mode === 'prompt' && c.style === 'character' ? `<div class="note info">${ic('person', 15)}<div>Character sketches ask for a full-body A-pose, which rigs best. Pick a sketch with the feet in frame and the arms away from the body.</div></div>` : ''}
    <button class="adv-toggle ${st.adv ? 'open' : ''}" id="advT">${ic('arrow', 13)}More options</button>
    <div class="adv" ${st.adv ? '' : 'hidden'}>
      <div class="field"><label>Polygon budget</label><select class="select" id="faces">${[[0, 'Full detail'], [200000, '200k faces'], [100000, '100k faces'], [50000, '50k faces'], [20000, '20k (game-ready)'], [5000, '5k (low-poly)']].map(([v, l]) => `<option value="${v}" ${Number(c.faces) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>Seed</label><div class="seed-row"><input class="input" id="seed" placeholder="Random" value="${c.seed >= 0 ? c.seed : ''}"><button class="icon-btn" id="seedDice" title="Random">${ic('dice', 16)}</button></div></div>
      ${mode !== 'image' ? `<div class="opt-row" style="grid-column:1/-1"><div class="grow"><b>Remove background</b><span>For pictures that aren't already cut out</span></div><button class="switch ${c.removeBg ? 'on' : ''}" id="swBg"></button></div>` : ''}
    </div>`;
  wireCompose(box);
  renderFoot();
}

function surfaceBlock(c, eng) {
  if (eng?.kind === 'cloud') {
    const t = S.settings.tripo || {};
    return `<div class="note info">${ic('paint', 15)}<div>Tripo paints full PBR textures itself (colour, metal, roughness, normal). Model: <b>${esc(t.model?.startsWith('v3.0') ? 'H3.0 (Tripo 3.0)' : t.model?.startsWith('P1') ? 'P1 low-poly' : 'H3.1')}</b>. <button class="link-btn" data-focus="tripo">Change</button></div></div>`;
  }
  const tex = c.texture || 'picture';
  const painter = model('hy3d-paint');
  const hasPainter = !!painter?.installed;
  const hint = tex === 'picture' ? 'The picture is projected onto the model as a texture. Sides it can’t see are filled in from what it can.'
    : tex === 'ai' ? `Hunyuan3D Paint imagines the sides the picture can’t show and paints every side to match. ${esc(speed(painter) || '')} here.`
      : 'No colour: a clean mesh to paint or sculpt yourself.';
  return `<div class="field"><label>Surface</label><div class="seg full" id="texSeg">
      <button data-t="picture" class="${tex === 'picture' ? 'on' : ''}">From picture</button>
      <button data-t="ai" class="${tex === 'ai' ? 'on' : ''}" title="${hasPainter ? '' : 'Download Hunyuan3D Paint in Models'}">${ic('sparkle', 12)}AI-painted${hasPainter ? '' : ' ↓'}</button>
      <button data-t="none" class="${tex === 'none' ? 'on' : ''}">Clay</button></div>
    <span class="hint">${hint}</span></div>
    ${tex === 'ai' && hasPainter ? `<div class="field"><label>Paint quality</label><div class="seg full" id="pqSeg"><button data-q="fast" class="${c.paintQuality === 'fast' ? 'on' : ''}">Fast · 1K texture</button><button data-q="standard" class="${c.paintQuality !== 'fast' ? 'on' : ''}">Standard · 2K texture</button></div></div>` : ''}`;
}

function dropZone(slot, path, title, sub, small = false) {
  if (path) return `<div class="drop has" data-slot="${slot}"><img src="${fileUrl(path)}" alt="">${small ? `<span class="v-name">${esc(title)}</span>` : ''}<div class="d-actions"><button class="icon-btn sm" data-replace="${slot}" title="Replace">${ic('image', 14)}</button><button class="icon-btn sm" data-clear="${slot}" title="Remove">${ic('x', 14)}</button></div></div>`;
  return `<div class="drop" data-slot="${slot}">${small ? '' : `<span class="d-ic">${ic('upload', 22)}</span>`}<b>${esc(title)}</b><span>${esc(sub)}</span></div>`;
}

function wireCompose(box) {
  for (const b of $$('[data-go]', box)) b.onclick = (e) => { e.stopPropagation(); go(b.dataset.go); };
  for (const b of $$('#modeSeg button', box)) b.onclick = async () => {
    const mode = b.dataset.mode;
    const patch = { mode };
    // pick an engine that fits the mode
    const list = S.models.filter((m) => (m.kind === 'shape' && !!m.multiview === (mode === 'views')) || (m.kind === 'cloud' && mode !== 'views'));
    if (!list.some((m) => m.id === C().engine && m.installed)) { const first = list.find((m) => m.installed); if (first) patch.engine = first.id; }
    await setC(patch);
    renderCompose(); renderStage();
  };
  const ta = $('#pText', box);
  if (ta) {
    ta.oninput = () => { st.prompt = ta.value; $('#pCount', box).textContent = `${ta.value.length}/400`; renderFoot(); };
    ta.onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); primary(); } };
  }
  for (const b of $$('[data-style]', box)) b.onclick = async () => { await setC({ style: b.dataset.style }); renderCompose(); };
  const im = $('#imgModel', box); if (im) im.onchange = () => setC({ imageModel: im.value });
  for (const b of $$('#ideaCount button', box)) b.onclick = async () => { await setC({ ideas: Number(b.dataset.n) }); renderCompose(); };
  for (const b of $$('[data-eng]', box)) b.onclick = async () => {
    const m = model(b.dataset.eng);
    if (!m.installed) { go('models', { focus: m.id }); if (m.kind === 'cloud') setTimeout(() => document.querySelector('[data-tripo]')?.click(), 200); return; }
    await setC({ engine: m.id }); renderCompose();
  };
  for (const b of $$('#detailSeg button', box)) b.onclick = async () => { await setC({ detail: b.dataset.d }); renderCompose(); };
  const sc = $('#swColor', box); if (sc) sc.onclick = async () => { await setC({ colorize: !C().colorize }); renderCompose(); };
  for (const b of $$('#texSeg button', box)) b.onclick = async () => {
    if (b.dataset.t === 'ai' && !installed('hy3d-paint')) { go('models', { focus: 'hy3d-paint' }); return; }
    await setC({ texture: b.dataset.t }); renderCompose();
  };
  for (const b of $$('#pqSeg button', box)) b.onclick = async () => { await setC({ paintQuality: b.dataset.q }); renderCompose(); };
  for (const b of $$('[data-focus]', box)) b.onclick = (e) => { e.stopPropagation(); go('models', { focus: b.dataset.focus }); };
  for (const sb of $$('#swBg', box)) sb.onclick = async () => { await setC({ removeBg: !C().removeBg }); renderCompose(); };
  $('#advT', box).onclick = () => { st.adv = !st.adv; renderCompose(); };
  const fs = $('#faces', box); if (fs) fs.onchange = () => setC({ faces: Number(fs.value) });
  const sd = $('#seed', box); if (sd) sd.onchange = () => { const v = parseInt(sd.value, 10); setC({ seed: Number.isFinite(v) && v >= 0 ? v : -1 }); };
  const dice = $('#seedDice', box); if (dice) dice.onclick = () => { sd.value = ''; setC({ seed: -1 }); };

  for (const d of $$('.drop', box)) {
    const slot = d.dataset.slot;
    d.onclick = async (e) => {
      if (e.target.closest('[data-clear]')) { setSlot(slot, null); return; }
      const files = await F.chooseImages(false);
      if (files[0]) setSlot(slot, files[0]);
    };
    d.ondragover = (e) => { e.preventDefault(); d.classList.add('over'); };
    d.ondragleave = () => d.classList.remove('over');
    d.ondrop = (e) => {
      e.preventDefault(); e.stopPropagation(); d.classList.remove('over');
      document.getElementById('dropVeil').classList.remove('on');
      const p = [...(e.dataTransfer?.files || [])].map((f) => F.pathFor(f)).find((x) => /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(x || ''));
      if (p) setSlot(slot, p); else toast('That is not a picture', 'Use PNG, JPG, WebP, BMP or TIFF', 'bad');
    };
  }
}

function setSlot(slot, p) {
  if (slot === 'single') st.image = p; else st.views[slot] = p;
  if (st.stage === 'error') st.stage = 'empty';
  renderCompose(); renderStage();
}

function readiness() {
  const c = C();
  const eng = currentEngine();
  if (eng?.kind === 'cloud') return { ok: true, eng };
  if (!S.engine?.installed) return { ok: false, why: 'Set up the 3D engine first', fix: 'models' };
  if (!eng) return { ok: false, why: 'Download a 3D engine first', fix: 'models' };
  if (c.removeBg && !installed('cutout')) return { ok: false, why: 'Download the background remover', fix: 'models' };
  if (c.texture === 'ai' && !installed('hy3d-paint')) return { ok: false, why: 'Download Hunyuan3D Paint for AI painting', fix: 'models' };
  return { ok: true, eng };
}

function renderFoot() {
  const foot = $('#cFoot', root);
  const c = C();
  const r = readiness();
  const busy = !!st.makeJob || !!st.ideaJob;
  let main = '', alt = '', est = '';
  if (c.mode === 'prompt') {
    const hasPick = !!st.pick;
    const imgReady = installed(c.imageModel);
    if (hasPick) {
      main = `<button class="btn primary lg block" id="goMake" ${r.ok && !busy ? '' : 'disabled'}>${ic('gem', 17)}Make 3D from this idea</button>`;
      alt = `<button class="btn block" id="goIdeas" ${st.prompt.trim() && imgReady && !busy ? '' : 'disabled'}>${ic('sparkle', 15)}Sketch new ideas</button>`;
    } else if (r.eng?.kind === 'cloud') {
      main = `<button class="btn primary lg block" id="goMake" ${st.prompt.trim() && !busy ? '' : 'disabled'}>${ic('gem', 17)}Make 3D with Tripo</button>`;
      alt = `<button class="btn block" id="goIdeas" ${st.prompt.trim() && imgReady && S.engine?.installed && !busy ? '' : 'disabled'}>${ic('sparkle', 15)}Sketch ideas first</button>`;
    } else {
      main = `<button class="btn primary lg block" id="goIdeas" ${st.prompt.trim() && imgReady && S.engine?.installed && !busy ? '' : 'disabled'}>${ic('sparkle', 17)}Sketch ideas</button>`;
    }
  } else {
    const has = c.mode === 'image' ? !!st.image : !!st.views.front;
    main = `<button class="btn primary lg block" id="goMake" ${has && r.ok && !busy ? '' : 'disabled'}>${ic('gem', 17)}Make 3D</button>`;
  }
  if (r.eng) est = `<div class="est"><span>${esc(r.eng.label)} · ${esc(r.eng.name)}</span><span>${r.eng.kind === 'cloud' ? 'uses Tripo credits' : esc(speed(r.eng)) + ' here'}</span></div>`;
  const fix = !r.ok ? `<div class="est"><span style="color:var(--warn)">${esc(r.why)}</span><button class="link-btn" data-go="models">Open Models</button></div>` : '';
  foot.innerHTML = `${main}${alt}${fix || est}<div class="est"><span>${c.mode === 'prompt' ? `<span class="kbd">${S.info.platform === 'darwin' ? '⌘' : 'Ctrl'} Enter</span> to go` : 'Drop, paste or browse for pictures'}</span><span></span></div>`;
  const gi = $('#goIdeas', foot); if (gi) gi.onclick = sketch;
  const gm = $('#goMake', foot); if (gm) gm.onclick = make;
  for (const b of $$('[data-go]', foot)) b.onclick = () => go(b.dataset.go);
}

function primary() {
  if (C().mode === 'prompt' && !st.pick && currentEngine()?.kind !== 'cloud') sketch(); else make();
}

/* ───────────────────────── actions ───────────────────────── */
async function sketch() {
  const c = C();
  if (!st.prompt.trim()) return;
  try {
    st.pick = null;
    st.ideas = { prompt: st.prompt.trim(), images: [], n: c.ideas, pct: 0, msg: 'Starting' };
    st.stage = 'ideas';
    st.ideaJob = await F.create.imagine({ prompt: st.prompt.trim(), style: c.style, imageModel: c.imageModel, count: c.ideas, seed: c.seed });
    renderStage(); renderFoot();
    if (S.jobs.get(st.ideaJob)) onJob(S.jobs.get(st.ideaJob));   // events that arrived before the id did
  } catch (e) { st.ideaJob = null; toast('Could not sketch', e.message, 'bad'); renderFoot(); }
}

async function make() {
  const c = C();
  const r = readiness();
  if (!r.ok) { go(r.fix); return; }
  let views;
  if (c.mode === 'prompt') {
    if (st.pick) views = { front: st.pick };
    else if (r.eng.kind === 'cloud' && st.prompt.trim()) views = {};
    else return;
  }
  else if (c.mode === 'image') { if (!st.image) return; views = { front: st.image }; }
  else { if (!st.views.front) return; views = Object.fromEntries(Object.entries(st.views).filter(([, v]) => v)); }
  try {
    st.making = { image: views.front, pct: 0, msg: 'Waiting for the engine', stage: 'queued', started: Date.now(), engine: r.eng };
    st.stage = 'making';
    st.makeJob = await F.create.make({
      mode: c.mode, views, prompt: c.mode === 'prompt' ? (st.pick ? st.ideas?.prompt : st.prompt.trim()) : null, paintQuality: c.paintQuality || 'standard', style: c.style, imageModel: c.imageModel,
      engine: r.eng.id, detail: c.detail, faces: c.faces, colorize: c.colorize, removeBg: c.removeBg, seed: c.seed, texture: c.texture || 'picture'
    });
    renderStage(); renderFoot();
    if (S.jobs.get(st.makeJob)) onJob(S.jobs.get(st.makeJob));
  } catch (e) { st.makeJob = null; st.stage = 'empty'; toast('Could not start', e.message, 'bad'); renderStage(); renderFoot(); }
}

function onJob(j) {
  if (j.id === st.ideaJob) {
    st.ideas = { ...st.ideas, images: j.images || [], pct: j.pct, msg: j.msg };
    if (j.status !== 'running') {
      st.ideaJob = null;
      if (j.status === 'failed') { st.stage = 'error'; st.error = { title: 'Sketching stopped', text: j.error }; }
      else if (j.status === 'stopped') { if (!st.ideas.images.length) st.stage = 'empty'; }
      else if (st.ideas.images.length === 1) st.pick = st.ideas.images[0].path;
    }
    if (S.view === 'create') { renderStage(); renderFoot(); }
  }
  if (j.id === st.makeJob) {
    st.making = { ...st.making, pct: j.pct, msg: j.msg, stage: j.stage, image: j.image || st.making?.image };
    if (j.status === 'done') {
      st.makeJob = null; showResult(j.project);
      if (j.project?.stats?.paintError) toast('The AI painter didn’t work this time', `${j.project.stats.paintError} The model was painted from the picture instead; the engine log has details.`, 'bad', 12000);
    }
    else if (j.status !== 'running') {
      st.makeJob = null;
      if (j.status === 'failed') { st.stage = 'error'; st.error = { title: 'That didn’t work', text: j.error }; }
      else st.stage = st.ideas?.images?.length && C().mode === 'prompt' ? 'ideas' : 'empty';
      renderStage(); renderFoot();
    } else if (S.view === 'create') updateMaking();
  }
}

async function showResult(project) {
  st.result = project;
  st.stage = 'result';
  renderStage(); renderFoot(); renderHead();
  if (!viewer) return;
  try {
    await viewer.load(project.paths.model);
    // a thumbnail for the library, taken once the first frames have drawn
    setTimeout(async () => { try { await F.library.thumb(project.id, viewer.snapshot(512)); refreshLibrary(); } catch {} }, 450);
  } catch (e) { toast('Could not show the model', e.message, 'bad'); }
}

/* ───────────────────────── stage ───────────────────────── */
function ensureViewer() {
  if (!viewer && !st.noGL) {
    try {
      viewer = new Viewer($('#vHost', root), { autoRotate: st.spin });
      viewer.setMode(st.viewMode);
    } catch (e) {
      // no WebGL (very old graphics driver, remote desktop): the model is still saved and exportable
      st.noGL = true;
      viewer = null;
    }
  }
  return viewer;
}
function noGLNote(r) {
  return `<div class="stage-layer"><div class="err-card">${r?.paths?.input ? `<img src="${fileUrl(r.paths.input)}" alt="" style="width:220px;height:220px;object-fit:contain">` : ''}<h3>Your model is ready</h3><p>This computer’s graphics driver can’t show a live 3D preview, but the model is saved. Export it or open it in another app.</p></div></div>`;
}

function renderHead() {
  if (S.view !== 'create') return;
  if (st.stage === 'result' && st.result) setHead(`<h1><span class="ellip">${esc(st.result.name)}</span><small>${esc(model(st.result.engine)?.label || '')}</small></h1>`, `<button class="btn sm" id="hNew">${ic('plus', 14)}New</button>`);
  else setHead('<h1>Create<small>from a prompt or a picture</small></h1>', '');
  const n = document.getElementById('hNew');
  if (n) n.onclick = () => { st.stage = C().mode === 'prompt' && st.ideas?.images?.length ? 'ideas' : 'empty'; st.result = null; viewer?.clear(); renderStage(); renderHead(); };
}

function renderStage() {
  if (!root) return;
  const layer = $('#stageLayer', root);
  const vh = $('#vHost', root);
  vh.style.visibility = st.stage === 'result' ? 'visible' : 'hidden';
  if (st.stage === 'result') ensureViewer();
  renderHead();

  if (st.stage === 'ideas' && st.ideas) {
    const n = st.ideas.n;
    const imgs = st.ideas.images;
    const cells = [];
    for (let i = 0; i < n; i++) {
      const im = imgs[i];
      cells.push(im ? `<button class="idea ${st.pick === im.path ? 'on' : ''}" data-p="${esc(im.path)}"><img src="${fileUrl(im.path)}" alt=""><span class="tick">${ic('check', 14)}</span>${im.cropped ? `<span class="crop-flag">${ic('alert', 12)}Cut off at the edge</span>` : ''}</button>` : `<div class="idea wait">${i === imgs.length && st.ideaJob ? '<span class="spin"></span>' : ''}</div>`);
    }
    layer.innerHTML = `<div class="stage-layer"><div class="ideas">
      <div class="ideas-head"><div class="grow"><b>${st.ideaJob ? 'Sketching ideas…' : 'Pick one to build'}</b><br><span class="ellip">${esc(st.ideas.prompt)}</span></div>
        ${st.ideaJob ? `<button class="btn sm" id="stopIdeas">${ic('stop', 13)}Stop</button>` : ''}</div>
      ${st.ideaJob ? `<div class="bar"><i style="width:${Math.round((st.ideas.pct || 0) * 100)}%"></i></div>` : ''}
      <div class="ideas-grid ${n === 1 ? 'n1' : ''}">${cells.join('')}</div>
      ${!st.ideaJob && st.pick ? `<div class="row" style="justify-content:center"><button class="btn primary lg" id="ideaMake">${ic('gem', 17)}Make 3D from this idea</button></div>` : ''}
    </div></div>`;
    for (const b of $$('.idea[data-p]', layer)) {
      b.onclick = () => { st.pick = b.dataset.p; renderStage(); renderFoot(); };
      b.ondblclick = () => { st.pick = b.dataset.p; make(); };
    }
    const s = $('#stopIdeas', layer); if (s) s.onclick = () => F.create.cancel(st.ideaJob);
    const m = $('#ideaMake', layer); if (m) m.onclick = make;
    return;
  }

  if (st.stage === 'making' && st.making) {
    layer.innerHTML = `<div class="stage-layer"><div class="making">
      <div class="scan">${st.making.image ? `<img id="mkImg" src="${fileUrl(st.making.image)}" alt="">` : ''}</div>
      <div><h3 id="mkTitle">Making your model</h3></div>
      <div class="phases" id="mkPhases"></div>
      <div class="bar"><i id="mkBar" style="width:0%"></i></div>
      <div class="m-msg" id="mkMsg"></div>
      <div class="m-foot"><span id="mkTime"></span><span>·</span><span>${esc(st.making.engine?.label || '')} on ${esc(deviceLabel().name)}</span><button class="btn sm" id="mkStop">${ic('stop', 13)}Stop</button></div>
    </div></div>`;
    $('#mkStop', layer).onclick = () => st.makeJob && F.create.cancel(st.makeJob);
    updateMaking();
    clearInterval(st.timer);
    st.timer = setInterval(() => { if (st.stage !== 'making') { clearInterval(st.timer); return; } const t = $('#mkTime', root); if (t) t.textContent = elapsed(st.making.started); }, 1000);
    return;
  }

  if (st.stage === 'error') {
    layer.innerHTML = `<div class="stage-layer"><div class="err-card"><span class="kicon a-rose">${ic('alert', 24)}</span><h3>${esc(st.error?.title || 'Something went wrong')}</h3><p>${esc(st.error?.text || '')}</p>
      <div class="row"><button class="btn" id="errLog">${ic('terminal', 14)}Engine log</button><button class="btn primary" id="errBack">Try again</button></div></div></div>`;
    $('#errBack', layer).onclick = () => { st.stage = st.ideas?.images?.length && C().mode === 'prompt' ? 'ideas' : 'empty'; renderStage(); };
    $('#errLog', layer).onclick = () => go('settings', { log: true });
    return;
  }

  if (st.stage === 'result' && st.result) {
    const r = st.result, s = r.stats || {};
    const eng = model(r.engine);
    layer.innerHTML = `
      <div class="tb top">
        <div class="seg sm" id="vMode">${[['shaded', 'Shaded'], ['clay', 'Clay'], ['wire', 'Wireframe'], ['normals', 'Normals']].map(([k, l]) => `<button data-m="${k}" class="${st.viewMode === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <span class="sep"></span>
        <button class="icon-btn sm ${st.spin ? 'on' : ''}" id="vSpin" title="Turntable">${ic('rotate', 15)}</button>
        <button class="icon-btn sm ${st.grid ? 'on' : ''}" id="vGrid" title="Grid">${ic('grid', 15)}</button>
        <button class="icon-btn sm" id="vFrame" title="Reset view">${ic('frame', 15)}</button>
      </div>
      <div class="tb bl">${r.paths.input ? `<img src="${fileUrl(r.paths.input)}" alt="">` : ''}<div><b>${esc(r.name)}</b><span>${fmtNum(s.faces)} faces · ${s.texture ? 'painted' : s.colors ? 'coloured' : 'clay'} · ${s.seconds != null ? s.seconds + ' s' : ''} · ${esc(eng?.label || r.engine)}</span></div></div>
      <div class="tb br">
        <button class="btn sm ghost" id="vRig">${ic('person', 14)}${r.paths.rigged ? 'Re-rig' : 'Rig'}</button>
        <button class="btn sm ghost" id="vReveal">${ic('folder', 14)}Show</button>
        <button class="btn sm ghost" id="vLib">${ic('grid', 14)}Library</button>
        <button class="btn sm primary" id="vExport">${ic('share', 14)}Export</button>
      </div>`;
    if (!viewer) layer.insertAdjacentHTML('afterbegin', noGLNote(r));
    for (const b of $$('#vMode button', layer)) b.onclick = () => { st.viewMode = b.dataset.m; viewer?.setMode(st.viewMode); for (const x of $$('#vMode button', layer)) x.classList.toggle('on', x === b); };
    $('#vSpin', layer).onclick = (e) => { st.spin = !st.spin; viewer?.setAutoRotate(st.spin); e.currentTarget.classList.toggle('on', st.spin); };
    $('#vGrid', layer).onclick = (e) => { st.grid = !st.grid; viewer?.setGrid(st.grid); e.currentTarget.classList.toggle('on', st.grid); };
    $('#vFrame', layer).onclick = () => viewer?.frame();
    $('#vReveal', layer).onclick = () => F.reveal(r.paths.model);
    $('#vRig', layer).onclick = () => openRig(st.result, (p) => { if (p) go('library', { open: p.id }); });
    $('#vLib', layer).onclick = () => go('library', { open: r.id });
    $('#vExport', layer).onclick = (e) => exportMenu(e.currentTarget, r);
    return;
  }

  // empty
  const d = deviceLabel();
  layer.innerHTML = `<div class="stage-layer"><div class="hero">
    <img class="gem" src="../../build/icon.png" alt="">
    <h2>Make something in 3D</h2>
    <p>Describe an object or drop in a picture. Facet builds a model you can spin, export and print, using this computer’s own ${S.hw?.accel === 'cpu' || S.settings?.device === 'cpu' ? 'processor' : 'graphics chip'}.</p>
    <div class="how"><div>${ic('type', 18)}Describe it, then pick a sketch</div><div>${ic('image', 18)}Or drop a photo or drawing</div><div>${ic('cube', 18)}Get a GLB, OBJ, STL or PLY</div></div>
    <span class="machine-line">${ic('check', 14)}${esc(d.name)} · no tokens · nothing is uploaded</span>
  </div></div>`;
}

const PHASES = [['cutout', 'Prepare'], ['shape', 'Shape'], ['mesh', 'Surface'], ['clean', 'Clean up'], ['export', 'Save']];
function updateMaking() {
  if (!root || st.stage !== 'making') return;
  const m = st.making;
  const bar = $('#mkBar', root); if (!bar) return;
  bar.style.width = Math.round((m.pct || 0) * 100) + '%';
  $('#mkMsg', root).textContent = m.msg || '';
  $('#mkTime', root).textContent = elapsed(m.started);
  const order = PHASES.map((p) => p[0]);
  const stage = m.stage === 'load' ? 'shape' : m.stage;
  const idx = order.indexOf(stage);
  $('#mkPhases', root).innerHTML = PHASES.map(([k, l], i) => `<span class="phase ${i < idx ? 'done' : i === idx ? 'now' : ''}">${i < idx ? ic('check', 12) : i === idx ? '<span class="spin" style="width:11px;height:11px"></span>' : ''}${l}</span>`).join('');
  const img = $('#mkImg', root);
  if (img && m.image && !img.src.endsWith(encodeURIComponent(m.image.split(/[\\/]/).pop()))) img.src = fileUrl(m.image) + '?t=' + Date.now();
}
const elapsed = (t) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`; };

export function exportMenu(anchor, r) {
  const ex = async (fmt, o = {}) => {
    const close = toast('Exporting', fmt.toUpperCase(), 'busy', 0);
    try { const res = await F.library.export(r.id, fmt, o); close(); if (res) toast('Exported', res.path || '', 'ok'); }
    catch (e) { close(); toast('Export failed', e.message, 'bad'); }
  };
  const h0 = S.settings.export.stlHeight;
  const latest = S.library.find((x) => x.id === r.id) || r;
  menu(anchor, [
    { icon: 'sparkle', text: 'Export for an app or engine…', sub: 'Unity, Unreal, Godot…', run: () => exportFor(anchor, latest) },
    '-',
    { label: 'Export as' },
    ...(latest.paths?.rigged ? [{ icon: 'person', text: 'GLB, rigged', sub: 'Skeleton + animations', run: () => ex('glb', { rigged: true }) }] : []),
    { icon: 'cube', text: 'GLB', sub: 'Blender, Unity, web', run: () => ex('glb') },
    { icon: 'cube', text: 'OBJ', sub: 'With .mtl + texture', run: () => ex('obj') },
    { icon: 'printer', text: `STL · ${h0} mm tall`, sub: '3D printing', run: () => ex('stl', { heightMm: h0 }) },
    { icon: 'cube', text: 'PLY', sub: 'Vertex colour', run: () => ex('ply') },
    '-',
    { icon: 'bolt', text: 'GLB, game-ready', sub: '20k faces', run: () => ex('glb', { faces: 20000 }) },
    { icon: 'bolt', text: 'GLB, low-poly', sub: '5k faces', run: () => ex('glb', { faces: 5000 }) }
  ]);
}
