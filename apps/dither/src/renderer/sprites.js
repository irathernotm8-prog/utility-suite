// Dither — Sprites: every sprite document in the project, playing; new, import and pixelize.
'use strict';

VIEWS.sprites = {
  title: 'Sprites',
  actions() { return `<button class="btn" id="spSvg">${icon('code', 15)}From SVG</button><button class="btn" id="spImport">${icon('import', 15)}Import picture</button><button class="btn" id="spAsk">${icon('chat', 15)}Ask Claude</button><button class="btn primary" id="spNew">${icon('plus', 15)}New sprite</button>`; },
  render(view) {
    if (!S.sprites.length) { view.innerHTML = `<div class="hero-empty"><div class="hero-glyph">${icon('sprites', 40)}</div><h2>No sprites yet</h2><p>Characters, items, tiles and icons, drawn by you or by Claude with pixel-precise ops. Bake an effect to hand-polish its frames, or pixelize a picture.</p><div class="row" style="justify-content:center"><button class="btn primary lg" id="heroNew">${icon('plus', 16)}New sprite</button><button class="btn lg" id="heroImp">${icon('import', 16)}Import a picture</button></div></div>`; $('#heroNew').onclick = newSprite; $('#heroImp').onclick = importPicture; return; }
    view.innerHTML = `<div class="card-grid">${S.sprites.map((s) => `<div class="fx-card" data-id="${s.id}"><div class="d-stage loading"></div><div class="d-body"><div class="row"><div class="d-name grow ellip">${esc(s.name)}</div><span class="pill">${s.w}×${s.h}</span><button class="icon-btn xs d-more">${icon('more', 15)}</button></div><div class="d-idea">${plural(s.frames, 'frame')} · ${plural(s.layers, 'layer')} · ${esc(ago(s.updatedAt))}${s.from && s.from.effect ? ' · baked' : s.from && s.from.generated ? ' · generated' : ''}</div></div></div>`).join('')}</div>`;
    $$('.fx-card', view).forEach((el) => {
      const id = el.dataset.id; const st = $('.d-stage', el); const cv = document.createElement('canvas'); st.appendChild(cv);
      const p = new Player(cv, { pad: 10, max: 8, bg: S.settings.previewBg || 'checker' });
      call('sprites:frames', id).then((r) => { if (!p.disposed) p.set(r.frames, r.meta); st.classList.remove('loading'); }).catch(() => st.classList.remove('loading'));
      st.onclick = () => go('editor', id); $('.d-more', el).onclick = (e) => spriteMenu(e.currentTarget, id);
    });
  },
  after() { $('#spNew').onclick = newSprite; $('#spSvg').onclick = newFromSvg; $('#spImport').onclick = importPicture; $('#spAsk').onclick = () => askClaude('Draw a sprite: '); },
};

function spriteMenu(anchor, id) {
  const s = S.sprites.find((x) => x.id === id);
  menu(anchor, [{ label: 'Open in the editor', icon: 'edit', run: () => go('editor', id) }, { label: 'Duplicate', icon: 'dup', run: async () => { await call('sprites:duplicate', id); await loadProject(); render(); } }, { label: 'Record GIF + sheet', icon: 'record', run: async () => filesDone(await call('record', { kind: 'sprite', id }).catch(fail), 'Recorded') }, { label: 'Export…', icon: 'export', run: () => exportMenu(anchor, 'sprite', id, s.name) }, '-', { label: 'Delete', icon: 'trash', danger: true, run: async () => { if (await confirmBox({ title: `Delete “${s.name}”?`, text: 'It moves to the project’s .trash folder.', ok: 'Delete', danger: true })) { await call('sprites:remove', id); await loadProject(); render(); } } }], { width: 230, align: 'right' });
}
async function newSprite() {
  const pals = Object.keys(S.info.palettes);
  const r = await promptBox({ title: 'New sprite', fields: [{ key: 'name', label: 'Name', placeholder: 'e.g. Hero idle' }, { key: 'size', label: 'Size', value: '32×32', options: ['8×8', '12×12', '16×16', '24×24', '32×32', '48×48', '64×64', '96×96', '128×128', '16×24', '32×48', '64×32'].map((v) => ({ value: v, label: v })) }, { key: 'palette', label: 'Palette', value: 'pico8', options: pals.map((p) => ({ value: p, label: `${p} (${S.info.palettes[p].length})` })) }, { key: 'frames', label: 'Frames', type: 'number', value: 1, min: 1, max: 64 }], ok: 'Create' });
  if (!r) return; const [w, h] = r.size.split('×').map(Number);
  const s = await call('sprites:create', { name: r.name.trim() || 'Sprite', w, h, palette: r.palette, frames: Math.max(1, Math.min(64, +r.frames || 1)) }); await loadProject(); go('editor', s.id);
}
async function importPicture() {
  const files = await call('dialog:files', { filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }] }); if (!files) return;
  pixelizeSheet(files[0]);
}

async function newFromSvg() {
  const r = await promptBox({ title: 'New sprite from SVG', text: 'Vectors drawn the pixel-art way: no anti-aliasing, clean 1px lines, dithered gradients. Tag shapes with data-material to shade them in one click.', fields: [{ key: 'name', label: 'Name', placeholder: 'e.g. Knight' }, { key: 'size', label: 'Size (pixels)', value: '48×48', placeholder: '48×48' }, { key: 'svg', label: 'SVG', area: true, placeholder: '<svg viewBox="0 0 48 48">…</svg>' }], ok: 'Create' });
  if (!r || !r.svg.trim()) return; const [w, h] = r.size.split(/[×x*, ]+/).map(Number);
  try { const id = await call('sprites:fromSvg', { svg: r.svg, w: w || 48, h: h || w || 48, name: r.name.trim() || 'Vector sprite' }); await loadProject(); go('editor', id); } catch (e) { fail(e); }
}
