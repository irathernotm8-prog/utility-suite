// Facet — Library: every model made (or added), as a grid; open one to inspect, rename, export or remix.
import { $, $$, esc, toast, menu, fileUrl, fmtNum, ago, confirmSheet, sheet } from './util.js';
import { ic } from './icons.js';
import { Viewer } from './viewer.js';
import { S, onChange, go, model, refreshLibrary, setHead, defaultHead } from './app.js';
import { exportMenu, useImages } from './create.js';
import { openRig } from './rigui.js';

const F = window.facet;
let root = null, wired = false, viewer = null;
const st = { q: '', sort: 'new', open: null, viewMode: 'shaded', rigged: true, clip: 'Idle', skel: false };

export function show(pane, arg) {
  root = pane;
  if (arg?.open) st.open = arg.open;
  if (!wired) {
    wired = true;
    onChange((w) => {
      if (S.view !== 'library') return;
      if (w === 'library') { if (st.open) renderDetailSide(); else renderGrid(); }
      if (w?.job && w.job.kind === 'make' && !st.open) renderGrid();
    });
  }
  render();
}
export function hide() { closeViewer(); }

function closeViewer() { if (viewer) { viewer.dispose(); viewer = null; } }

function render() {
  if (st.open && S.library.find((m) => m.id === st.open)) renderDetail();
  else { st.open = null; closeViewer(); renderGrid(); }
}

/* ── grid ── */
function filtered() {
  const q = st.q.trim().toLowerCase();
  let list = S.library.filter((m) => !q || m.name.toLowerCase().includes(q) || (m.source?.prompt || '').toLowerCase().includes(q));
  if (st.sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
  if (st.sort === 'fav') list = [...list].sort((a, b) => (b.favorite - a.favorite) || (b.createdAt - a.createdAt));
  return list;
}

function renderGrid() {
  root.classList.remove('flush');
  setHead(`<h1>Library<small>${S.library.length} model${S.library.length === 1 ? '' : 's'}</small></h1>`,
    `<div class="lib-tools"><input class="input" id="lq" placeholder="Search" value="${esc(st.q)}"><div class="seg" id="lsort">${[['new', 'Newest'], ['name', 'A–Z'], ['fav', 'Favourites']].map(([k, l]) => `<button data-s="${k}" class="${st.sort === k ? 'on' : ''}">${l}</button>`).join('')}</div><button class="btn sm" id="ladd">${ic('plus', 14)}Add 3D file</button><button class="icon-btn" id="lfolder" title="Show the library folder">${ic('folder', 16)}</button></div>`);
  const q = $('#lq'); q.oninput = () => { st.q = q.value; renderCards(); };
  for (const b of $$('#lsort button')) b.onclick = () => { st.sort = b.dataset.s; for (const x of $$('#lsort button')) x.classList.toggle('on', x === b); renderCards(); };
  $('#ladd').onclick = async () => {
    const files = await F.chooseModelFile();
    if (!files.length) return;
    const close = toast('Adding to your library', '', 'busy', 0);
    try { await F.library.import(files); close(); await refreshLibrary(); } catch (e) { close(); toast('Could not add that file', e.message, 'bad'); }
  };
  $('#lfolder').onclick = () => F.openPath(S.info.paths.output);
  root.innerHTML = '<div id="lgrid"></div>';
  renderCards();
}

function renderCards() {
  const host = $('#lgrid', root);
  if (!host) return;
  const making = [...S.jobs.values()].filter((j) => j.kind === 'make' && j.status === 'running');
  const list = filtered();
  if (!list.length && !making.length) {
    host.innerHTML = `<div class="empty">${ic('gem', 40)}<b>${st.q ? 'Nothing matches' : 'No models yet'}</b><span>${st.q ? 'Try another word.' : 'Everything you make in Create lands here, saved in your Documents › Facet folder.'}</span>${st.q ? '' : `<button class="btn primary" id="toCreate" style="margin-top:8px">${ic('sparkle', 15)}Make one</button>`}</div>`;
    const b = $('#toCreate', host); if (b) b.onclick = () => go('create');
    return;
  }
  host.innerHTML = `<div class="lib-grid">${making.map((j) => `<div class="card making"><div class="thumb">${j.image ? `<img src="${fileUrl(j.image)}" alt="" style="opacity:.55">` : ic('cube', 36)}</div><div class="meta"><b>${esc(j.name || 'Making…')}</b><span><span class="spin" style="width:10px;height:10px"></span>${Math.round((j.pct || 0) * 100)}% · ${esc(j.msg || '')}</span></div></div>`).join('')}
    ${list.map((m) => `<button class="card" data-id="${m.id}"><div class="thumb">${m.paths.thumb ? `<img src="${fileUrl(m.paths.thumb)}?v=${m.updatedAt || 0}" alt="" loading="lazy">` : m.paths.input ? `<img src="${fileUrl(m.paths.input)}" alt="" style="opacity:.7" loading="lazy">` : ic('cube', 36)}${m.favorite ? `<span class="fav">${ic('star', 15)}</span>` : ''}</div>
      <div class="meta"><b>${esc(m.name)}</b><span>${esc(model(m.engine)?.label || (m.engine === 'import' ? 'Added' : m.engine))} · ${m.stats?.faces ? fmtNum(m.stats.faces) + ' faces · ' : ''}${ago(m.createdAt)}</span></div></button>`).join('')}</div>`;
  for (const c of $$('.card[data-id]', host)) {
    c.onclick = () => { st.open = c.dataset.id; renderDetail(); };
    c.oncontextmenu = (e) => { e.preventDefault(); cardMenu(c, S.library.find((m) => m.id === c.dataset.id)); };
  }
}

function cardMenu(anchor, m) {
  if (!m) return;
  menu(anchor, [
    { icon: 'share', text: 'Export…', run: () => exportMenu(anchor, m) },
    { icon: 'folder', text: 'Show in folder', run: () => F.reveal(m.paths.model) },
    { icon: 'star', text: m.favorite ? 'Unfavourite' : 'Favourite', run: async () => { await F.library.update(m.id, { favorite: !m.favorite }); refreshLibrary(); } },
    '-',
    { icon: 'trash', text: 'Move to Trash', danger: true, run: () => del(m) }
  ]);
}

async function del(m) {
  if (!await confirmSheet({ title: `Delete “${m.name}”?`, text: 'Its folder (model, pictures and settings) goes to the Trash.', ok: 'Move to Trash', danger: true })) return;
  await F.library.trash(m.id);
  if (st.open === m.id) { st.open = null; closeViewer(); }
  await refreshLibrary();
  if (!st.open) renderGrid();
}

/* ── detail ── */
function renderDetail() {
  const m = S.library.find((x) => x.id === st.open);
  if (!m) { st.open = null; renderGrid(); return; }
  root.classList.add('flush');
  setHead(`<button class="icon-btn" id="dBack" title="Back">${ic('back', 17)}</button><h1><span class="ellip">${esc(m.name)}</span><small>${esc(model(m.engine)?.name || '')}</small></h1>`,
    `<button class="btn sm" id="dRig">${ic('person', 14)}${m.paths.rigged ? 'Re-rig' : 'Rig'}</button><button class="btn sm" id="dShow">${ic('folder', 14)}Show</button><button class="btn sm primary" id="dExport">${ic('share', 14)}Export</button>`);
  $('#dRig').onclick = () => openRig(m, () => { st.rigged = true; st.clip = 'Idle'; renderDetail(); });
  $('#dBack').onclick = () => { st.open = null; closeViewer(); renderGrid(); };
  $('#dShow').onclick = () => F.reveal(m.paths.model);
  $('#dExport').onclick = (e) => exportMenu(e.currentTarget, m);
  closeViewer();
  root.innerHTML = `<div class="detail"><div class="stage"><div class="viewer-host" id="dv"></div>
      <div class="tb top"><div class="seg sm" id="dMode">${[['shaded', 'Shaded'], ['clay', 'Clay'], ['wire', 'Wireframe'], ['normals', 'Normals']].map(([k, l]) => `<button data-m="${k}" class="${st.viewMode === k ? 'on' : ''}">${l}</button>`).join('')}</div><span class="sep"></span><button class="icon-btn sm on" id="dSpin">${ic('rotate', 15)}</button><button class="icon-btn sm" id="dFrame">${ic('frame', 15)}</button></div>
      <div class="tb clips" id="dClips" hidden></div>
    </div><div class="d-side" id="dSide"></div></div>`;
  try {
    viewer = new Viewer($('#dv', root));
    viewer.setMode(st.viewMode);
    const showRig = !!m.paths.rigged && st.rigged;
    viewer.load(showRig ? m.paths.rigged : m.paths.model).then((info) => {
      renderClips(m, info);
      if (!m.paths.thumb) setTimeout(async () => { try { await F.library.thumb(m.id, viewer.snapshot(512)); refreshLibrary(); } catch {} }, 450);
    }).catch((e) => toast('Could not open the model', e.message, 'bad'));
  } catch {
    viewer = null;
    $('#dv', root).innerHTML = `<div class="stage-layer"><div class="err-card">${m.paths.thumb || m.paths.input ? `<img src="${fileUrl(m.paths.thumb || m.paths.input)}" alt="" style="width:240px;height:240px;object-fit:contain">` : ''}<p>This computer’s graphics driver can’t show a live 3D preview. Export the model or open it in another app.</p></div></div>`;
  }
  for (const b of $$('#dMode button', root)) b.onclick = () => { st.viewMode = b.dataset.m; viewer?.setMode(st.viewMode); for (const x of $$('#dMode button', root)) x.classList.toggle('on', x === b); };
  $('#dSpin', root).onclick = (e) => { const on = !e.currentTarget.classList.contains('on'); viewer?.setAutoRotate(on); e.currentTarget.classList.toggle('on', on); };
  $('#dFrame', root).onclick = () => viewer?.frame();
  renderDetailSide();
}

function renderClips(m, info) {
  const bar = $('#dClips', root);
  if (!bar) return;
  if (!m.paths.rigged) { bar.hidden = true; return; }
  bar.hidden = false;
  const clips = info?.rigged ? info.clips : [];
  if (info?.rigged && !clips.includes(st.clip)) st.clip = null;
  bar.innerHTML = `<div class="seg sm" id="dRigSeg"><button data-r="static" class="${!st.rigged ? 'on' : ''}">Static</button><button data-r="rigged" class="${st.rigged ? 'on' : ''}">Rigged</button></div>
    ${info?.rigged ? `<span class="sep"></span><div class="seg sm" id="dClipSeg"><button data-c="" class="${!st.clip ? 'on' : ''}">Pose</button>${clips.map((c) => `<button data-c="${esc(c)}" class="${st.clip === c ? 'on' : ''}">${esc(c)}</button>`).join('')}</div>
    <button class="icon-btn sm ${st.skel ? 'on' : ''}" id="dSkel" title="Show bones">${ic('person', 15)}</button>` : ''}`;
  for (const b of $$('#dRigSeg button', bar)) b.onclick = () => { st.rigged = b.dataset.r === 'rigged'; renderDetail(); };
  for (const b of $$('#dClipSeg button', bar)) b.onclick = () => { st.clip = b.dataset.c || null; viewer?.setClip(st.clip); for (const x of $$('#dClipSeg button', bar)) x.classList.toggle('on', x === b); };
  const sk = $('#dSkel', bar); if (sk) sk.onclick = () => { st.skel = !st.skel; viewer?.setSkeleton(st.skel); sk.classList.toggle('on', st.skel); };
  if (info?.rigged) { viewer?.setClip(st.clip); viewer?.setSkeleton(st.skel); }
}

function renderDetailSide() {
  const m = S.library.find((x) => x.id === st.open);
  const side = $('#dSide', root);
  if (!m || !side) return;
  const s = m.stats || {};
  const eng = model(m.engine);
  const p = m.params || {};
  side.innerHTML = `
    <input class="d-name" id="dName" value="${esc(m.name)}" spellcheck="false">
    <div class="row" style="margin-top:-8px"><span class="pill acc">${esc(eng?.label || (m.engine === 'import' ? 'Added file' : m.engine))}</span>${s.texture ? '<span class="pill info">Painted</span>' : s.colors ? '<span class="pill info">Coloured</span>' : m.engine !== 'import' ? '<span class="pill">Clay</span>' : ''}${m.rig ? `<span class="pill ok">Rigged · ${m.rig.joints || ''} bones</span>` : ''}${s.watertight ? '<span class="pill ok">Watertight</span>' : ''}<span class="muted small" style="margin-left:auto">${ago(m.createdAt)}</span></div>
    ${m.source?.prompt ? `<div class="field"><label>Prompt</label><div class="quote">${esc(m.source.prompt)}</div></div>` : ''}
    ${m.paths.input ? `<div class="field"><label>${m.source?.mode === 'prompt' ? 'Sketch it was built from' : 'Picture'}</label><div class="sources"><img src="${fileUrl(m.paths.input)}" alt="" id="dInput"></div></div>` : ''}
    <div class="facts">
      <div class="fact"><div class="k">Faces</div><div class="v">${fmtNum(s.faces)}</div></div>
      <div class="fact"><div class="k">Vertices</div><div class="v">${fmtNum(s.vertices)}</div></div>
      <div class="fact"><div class="k">Time</div><div class="v">${s.seconds != null ? s.seconds + ' s' : '—'}</div></div>
      <div class="fact"><div class="k">On</div><div class="v">${esc(s.device === 'cuda' ? 'NVIDIA GPU' : s.device === 'mps' ? 'Apple GPU' : s.device === 'cpu' ? 'CPU' : '—')}</div></div>
      <div class="fact"><div class="k">Detail</div><div class="v">${esc(p.detail || '—')}</div></div>
      <div class="fact"><div class="k">Seed</div><div class="v">${s.seed ?? '—'}</div></div>
    </div>
    <div class="field"><label>Notes</label><textarea class="textarea" id="dNotes" rows="3" placeholder="Anything to remember about this model">${esc(m.notes || '')}</textarea></div>
    <div class="d-actions">
      ${m.paths.input ? `<button class="btn" id="dRemix">${ic('wand', 14)}Make again</button>` : ''}
      ${m.paths.input && !s.texture ? `<button class="btn" id="dPaint">${ic('paint', 14)}Paint from picture</button>` : ''}
      <button class="btn" id="dFav">${ic('star', 14)}${m.favorite ? 'Unfavourite' : 'Favourite'}</button>
      <button class="btn" id="dOpen">${ic('external', 14)}Open in app</button>
      <button class="btn danger" id="dDel">${ic('trash', 14)}Delete</button>
    </div>`;
  const name = $('#dName', side);
  name.onchange = async () => { await F.library.update(m.id, { name: name.value }); refreshLibrary(); };
  name.onkeydown = (e) => { if (e.key === 'Enter') name.blur(); };
  const notes = $('#dNotes', side); notes.onchange = () => F.library.update(m.id, { notes: notes.value });
  const remix = $('#dRemix', side); if (remix) remix.onclick = () => { go('create'); useImages([m.paths.input]); toast('Picture loaded in Create', 'Try another engine or detail level', 'info'); };
  const paint = $('#dPaint', side);
  if (paint) paint.onclick = async () => {
    paint.disabled = true;
    const close = toast('Painting from the picture', 'Unwrapping and projecting; this takes a minute', 'busy', 0);
    try { await F.library.repaint(m.id); close(); toast('Painted', m.rig ? 'The rig was removed because the surface changed. Rig it again.' : 'The old version is kept as model-before-paint.glb'); await refreshLibrary(); renderDetail(); }
    catch (e) { close(); paint.disabled = false; toast('Could not paint', e.message, 'bad'); }
  };
  $('#dFav', side).onclick = async () => { await F.library.update(m.id, { favorite: !m.favorite }); refreshLibrary(); };
  $('#dOpen', side).onclick = () => F.openPath(m.paths.model);
  $('#dDel', side).onclick = () => del(m);
  const inp = $('#dInput', side);
  if (inp) inp.onclick = () => sheet({ title: m.name, body: `<img src="${fileUrl(m.paths.input)}" style="width:100%;max-height:60vh;object-fit:contain;border-radius:12px">`, foot: '' });
}
