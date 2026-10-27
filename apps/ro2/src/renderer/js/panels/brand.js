// Brand: kits of logos, colours and fonts, one click away. Click a colour to paint the selection (or the page),
// click a logo to drop it in, add text in brand fonts, or restyle the whole page to the brand.
import { h, ico, menu, promptBox, confirmBox, toast, toastErr, esc } from '../ui.js';
import { app, ensureEditor, addImage } from '../app.js';
import { register, refresh } from '../drawer.js';
import { colorPicker, setBrandColors, parse, toHex } from './color.js';
import { fabric, kindOf, Ro2Line } from '../editor/fab.js';
import { makeText, TEXT_PRESETS } from '../editor/objects.js';
import { ensureFont, boldWeight } from '../fonts.js';
import { fontPicker } from '../ctxbar.js';
import { draggable } from './elements.js';

export async function loadBrand() { app.brand = await window.ro2.brand.get(); syncBrand(); return app.brand; }
export const activeKit = () => app.brand && (app.brand.kits.find((k) => k.id === app.brand.active) || app.brand.kits[0]);
function syncBrand() { setBrandColors(activeKit()?.colors || []); }
async function save(patch) { const k = activeKit(); app.brand = await window.ro2.brand.update(k.id, patch); syncBrand(); refresh(['brand', 'text']); }

// Paint the selection with a colour (or the page when nothing is selected)
export function applyColor(hex) {
  const ed = ensureEditor(); const sel = ed.selected();
  if (!sel.length) { ed.setBackground({ color: hex }); return; }
  for (const o of sel) {
    if (o instanceof Ro2Line) o.set({ lineColor: hex });
    else if (o.ro2Icon) (o._objects || [o]).forEach((x) => x.set({ stroke: hex }));
    else if (o instanceof fabric.FabricImage) { o.set({ stroke: hex, strokeWidth: o.strokeWidth || Math.max(2, Math.min(ed.W, ed.H) / 150) }); }
    else if (o instanceof fabric.Group) o.getObjects().forEach((x) => { if (x.fill && x.fill !== 'none') x.set({ fill: hex }); });
    else { o.set({ fill: hex }); o.ro2Fill = undefined; }
    o.dirty = true;
  }
  ed.canvas.requestRenderAll(); ed.commit(); ed.emit('modified', sel);
}
export async function addLogo(kit, l, at) {
  try { const d = await window.ro2.brand.logo(kit.id, l.id); const o = await addImage(d.dataUrl, { name: d.name, svg: d.svg, at }); return o; } catch (e) { toastErr(e); }
}
export function brandTextPreset(role) {
  const k = activeKit(); const f = k?.fonts?.[role]; const base = TEXT_PRESETS[role];
  return f ? { ...base, fontFamily: f.family, fontWeight: f.weight || base.fontWeight, text: role === 'heading' ? 'Brand heading' : role === 'subheading' ? 'Brand subheading' : 'Brand body text', fill: f.color || base.fill } : base;
}
export async function addBrandText(role, at) { const ed = ensureEditor(); const p = brandTextPreset(role); const t = await makeText(ed, p); ed.add(t, { at: at || ed.dropPoint() }); return t; }

// Main colours of a logo (k-means on its visible pixels)
async function paletteOf(url, k = 6) {
  const im = new Image(); im.src = url; await im.decode();
  const s = 64 / Math.max(im.naturalWidth || 64, im.naturalHeight || 64); const w = Math.max(1, Math.round((im.naturalWidth || 64) * s)), hh = Math.max(1, Math.round((im.naturalHeight || 64) * s));
  const c = document.createElement('canvas'); c.width = w; c.height = hh; const x = c.getContext('2d'); x.drawImage(im, 0, 0, w, hh);
  const d = x.getImageData(0, 0, w, hh).data; const px = [];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 160) px.push([d[i], d[i + 1], d[i + 2]]);
  if (!px.length) return [];
  const dist = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const cs = [px[0]]; while (cs.length < Math.min(k, px.length)) { let best = null, bd = -1; for (const p of px) { const m = Math.min(...cs.map((q) => dist(p, q))); if (m > bd) { bd = m; best = p; } } if (bd < 400) break; cs.push(best); }
  let groups;
  for (let it = 0; it < 8; it++) {
    groups = cs.map(() => []); for (const p of px) { let bi = 0, bd = Infinity; cs.forEach((q, i) => { const dd = dist(p, q); if (dd < bd) { bd = dd; bi = i; } }); groups[bi].push(p); }
    groups.forEach((g, i) => { if (g.length) cs[i] = [0, 1, 2].map((j) => g.reduce((s2, p) => s2 + p[j], 0) / g.length); });
  }
  return cs.map((q, i) => ({ hex: toHex({ r: q[0], g: q[1], b: q[2] }), n: groups[i].length })).filter((c2) => c2.n > px.length * 0.02).sort((a, b) => b.n - a.n).map((c2) => c2.hex);
}

// Restyle the page: the design's colours become brand colours (by how much they're used), text takes brand fonts by size
export async function applyBrandToPage() {
  const ed = ensureEditor(); const k = activeKit(); if (!k) return;
  const brandCols = k.colors.map((c) => c.hex); const fonts = k.fonts || {};
  if (!brandCols.length && !fonts.heading && !fonts.body) return toast('Add some colours or fonts to the brand kit first.', { type: 'info' });
  const neutral = (hex) => { const { r, g, b } = parse(hex); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx - mn < 18 && (mx > 235 || mx < 40); };
  const use = new Map(); const bump = (c, w) => { if (typeof c !== 'string' || !c || neutral(c) || parse(c).a < 0.05) return; const hx = toHex(parse(c)); use.set(hx, (use.get(hx) || 0) + w); };
  const objs = ed.userObjects();
  for (const o of objs) {
    const area = Math.max(1, o.getScaledWidth() * o.getScaledHeight());
    if (o instanceof Ro2Line) bump(o.lineColor, area); else if (o.ro2Icon) bump((o._objects || [o])[0].stroke, area); else if (!(o instanceof fabric.FabricImage)) bump(o.fill, area);
  }
  if (ed.pageData.bg?.color) bump(ed.pageData.bg.color, ed.W * ed.H);
  const order = [...use.entries()].sort((a, b) => b[1] - a[1]).map(([c2]) => c2);
  const map = new Map(); const pal = brandCols.filter((c2) => !neutral(c2)).concat(brandCols.filter(neutral));
  if (pal.length) order.forEach((c2, i) => map.set(c2, pal[i % pal.length]));
  const re = (c2) => { if (typeof c2 !== 'string') return c2; const hx = toHex(parse(c2)); return map.get(hx) || c2; };
  for (const o of objs) {
    if (o instanceof Ro2Line) o.set({ lineColor: re(o.lineColor) });
    else if (o.ro2Icon) (o._objects || [o]).forEach((x) => x.set({ stroke: re(x.stroke) }));
    else if (!(o instanceof fabric.FabricImage) && typeof o.fill === 'string') o.set({ fill: re(o.fill) });
    o.dirty = true;
  }
  if (ed.pageData.bg?.color && map.has(toHex(parse(ed.pageData.bg.color)))) ed.setBackground({ color: re(ed.pageData.bg.color) }, { commit: false });
  // fonts by size tier
  const texts = objs.filter((o) => kindOf(o) === 'text' && !/Emoji/.test(o.fontFamily)); const max = Math.max(0, ...texts.map((t) => t.fontSize * (t.scaleY || 1)));
  for (const t of texts) {
    const sz = t.fontSize * (t.scaleY || 1); const role = sz >= max * 0.7 ? 'heading' : sz >= max * 0.4 ? 'subheading' : 'body';
    const f = fonts[role] || fonts.body || fonts.heading; if (!f) continue;
    await ensureFont(f.family, f.weight || 400);
    t.set({ fontFamily: f.family, fontWeight: f.weight || t.fontWeight }); t.removeStyle?.('fontFamily'); t.initDimensions(); t.setCoords();
  }
  ed.canvas.requestRenderAll(); ed.commit(); toast('Page restyled with your brand.');
}

register('brand', {
  label: 'Brand', icon: 'badge-check',
  async render(root) {
    if (!app.brand) await loadBrand();
    const k = activeKit();
    const sel = h('select.input', { style: { flex: 1 }, on: { change: async () => { app.brand = await window.ro2.brand.setActive(sel.value); syncBrand(); refresh(['brand']); } } },
      ...app.brand.kits.map((x) => h('option', { value: x.id, selected: x.id === k.id }, x.name)));
    const more = h('button.btn.icon', { title: 'Brand kits', html: ico('ellipsis'), on: { click: () => menu(more, [
      { label: 'New brand kit', icon: 'plus', run: async () => { const n = await promptBox('New brand kit', 'New brand', 'Create'); if (n) { app.brand = await window.ro2.brand.create(n); syncBrand(); refresh(['brand']); } } },
      { label: 'Rename', icon: 'pencil', run: async () => { const n = await promptBox('Rename brand kit', k.name); if (n) save({ name: n }); } },
      '-', { label: 'Delete this kit', icon: 'trash-2', danger: true, disabled: app.brand.kits.length < 2, run: async () => { if (await confirmBox('Delete this brand kit?', `“${k.name}” and its logos are removed from RO2. Designs that use them keep their copies.`, 'Delete', true)) { try { app.brand = await window.ro2.brand.remove(k.id); syncBrand(); refresh(['brand']); } catch (e) { toastErr(e); } } } },
    ]) } });
    root.append(h('div.p-title', 'Brand'), h('div', { style: { display: 'flex', gap: '8px' } }, sel, more));

    // logos
    root.append(h('div.sec', h('h4', 'Logos'), h('a', { on: { click: async () => { app.brand = await window.ro2.brand.pickLogos(k.id); refresh(['brand']); } } }, 'Add')));
    const lg = h('div.tiles.c3');
    for (const l of k.logos) {
      const t = draggable(h('button.tile.logo', { title: `${l.name} · click to add, right-click to remove`, style: { background: 'repeating-conic-gradient(var(--chk-a) 0 25%, var(--chk-b) 0 50%) 0 0/12px 12px' } }, h('img', { src: `ro2://brand/${k.id}/${l.file}`, style: { objectFit: 'contain', padding: '8px' } })), { kind: 'logo', kit: k.id, id: l.id });
      t.addEventListener('contextmenu', (e) => { e.preventDefault(); menu({ x: e.clientX, y: e.clientY }, [{ label: 'Remove logo', icon: 'trash-2', danger: true, run: async () => { app.brand = await window.ro2.brand.removeLogo(k.id, l.id); refresh(['brand']); } }, { label: 'Get colours from this logo', icon: 'pipette', run: () => fromLogo(l) }]); });
      lg.append(t);
    }
    const add = h('button.tile', { title: 'Add logos (PNG, SVG, JPG)', html: ico('plus'), on: { click: async () => { app.brand = await window.ro2.brand.pickLogos(k.id); refresh(['brand']); } } });
    lg.append(add);
    lg.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
    lg.addEventListener('drop', async (e) => { e.preventDefault(); e.stopPropagation(); for (const f of e.dataTransfer.files) { try { app.brand = await window.ro2.brand.addLogo(k.id, { name: f.name.replace(/\.[^.]+$/, ''), bytes: new Uint8Array(await f.arrayBuffer()), ext: f.name.split('.').pop() }); } catch (er) { toastErr(er); } } refresh(['brand']); });
    root.append(lg);
    if (!k.logos.length) root.append(h('p.tiny.dim', { style: { marginTop: '6px' } }, 'Drop logo files here. Transparent PNG or SVG works best.'));

    // colours
    root.append(h('div.sec', h('h4', 'Colours'), k.logos.length ? h('a', { on: { click: () => fromLogo(k.logos[0]) } }, 'From logo') : null));
    const cg = h('div.tiles.c6');
    k.colors.forEach((c, i) => {
      const t = h('button.tile', { 'data-hex': c.hex, title: `${c.name || c.hex} · click to apply, right-click to edit`, style: { background: c.hex, boxShadow: 'inset 0 0 0 1px rgba(127,127,127,.25)' }, on: { click: () => applyColor(c.hex) } });
      t.addEventListener('contextmenu', (e) => { e.preventDefault(); menu({ x: e.clientX, y: e.clientY }, [
        { label: 'Change colour', icon: 'palette', run: () => colorPicker(t, c.hex, (v, final) => { if (typeof v === 'string' && final) { const cols = k.colors.slice(); cols[i] = { ...c, hex: toHex(parse(v)) }; save({ colors: cols }); } }, { noGradient: true }) },
        { label: 'Name it', icon: 'pencil', run: async () => { const n = await promptBox('Colour name', c.name || ''); if (n != null) { const cols = k.colors.slice(); cols[i] = { ...c, name: n }; save({ colors: cols }); } } },
        { label: 'Copy hex', icon: 'copy', run: () => { navigator.clipboard.writeText(c.hex); toast(`${c.hex} copied`); } },
        '-', { label: 'Remove', icon: 'trash-2', danger: true, run: () => save({ colors: k.colors.filter((_, j) => j !== i) }) }]); });
      cg.append(t);
    });
    const addC = h('button.tile', { title: 'Add a colour', html: ico('plus') });
    addC.onclick = () => { let picked = null; colorPicker(addC, '#46e6a2', (v, final) => { if (typeof v === 'string') picked = v; if (final && picked) { save({ colors: [...k.colors, { hex: toHex(parse(picked)), name: '' }] }); } }, { noGradient: true, title: 'Add a brand colour' }); };
    cg.append(addC); root.append(cg);
    root.append(h('p.tiny.dim', { style: { marginTop: '6px' } }, 'Click a colour to paint what’s selected, or the page if nothing is. Brand colours also show first in every colour picker.'));

    // fonts
    root.append(h('div.sec', h('h4', 'Fonts')));
    for (const [role, label] of [['heading', 'Heading'], ['subheading', 'Subheading'], ['body', 'Body']]) {
      const f = k.fonts?.[role];
      const pick = h('button.btn.block', { style: { justifyContent: 'space-between', height: '44px', marginBottom: '6px' } }, h('span', { style: { fontFamily: f ? `"${f.family}"` : null, fontWeight: f?.weight || 400, fontSize: role === 'heading' ? '18px' : role === 'subheading' ? '15px' : '13px' } }, f ? f.family : `Choose a ${label.toLowerCase()} font`), h('span.small.dim', label));
      pick.onclick = () => fontPicker(pick, f?.family, async (fam) => { const w = role === 'body' ? 400 : boldWeight(fam); await ensureFont(fam, w); save({ fonts: { ...k.fonts, [role]: { family: fam, weight: w } } }); });
      const addT = h('button.btn.icon', { title: `Add ${label.toLowerCase()} text`, html: ico('plus'), on: { click: () => addBrandText(role) } });
      root.append(h('div', { style: { display: 'flex', gap: '6px' } }, pick, addT));
    }
    root.append(h('div.sec', h('h4', 'Use it')));
    root.append(h('button.btn.primary.block', { html: ico('wand-sparkles') + '<span>Apply brand to this page</span>', on: { click: () => applyBrandToPage() } }));
    root.append(h('p.tiny.dim', { style: { marginTop: '6px', lineHeight: 1.5 } }, 'Swaps the page’s colours for your brand colours (most-used first) and sets text to your brand fonts by size. Undo puts it back.'));
    async function fromLogo(l) {
      try { const d = await window.ro2.brand.logo(k.id, l.id); const pal = await paletteOf(d.dataUrl); const have = new Set(k.colors.map((c) => c.hex.toLowerCase())); const add2 = pal.filter((c) => !have.has(c.toLowerCase())).map((hex) => ({ hex, name: '' })); if (!add2.length) return toast('No new colours found in that logo.', { type: 'info' }); save({ colors: [...k.colors, ...add2] }); toast(`Added ${add2.length} colour${add2.length > 1 ? 's' : ''} from ${l.name}.`); } catch (e) { toastErr(e); }
    }
  },
});
export { esc };
