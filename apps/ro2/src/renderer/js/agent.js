// What Claude, Codex and the in-app models do inside RO2. main.js forwards each tool call (mcp/tools.js) here,
// because the design lives in this window; the answer goes back as MCP content (text, and screenshots as images).
// Coordinates: design px from the page's top-left; x/y are a layer's top-left corner (fabric uses centres).
import { app, ensureEditor, newDesign, openFile, openDoc, saveNow, autosave, applyGrade } from './app.js';
import { fabric, uid, kindOf, Ro2Line } from './editor/fab.js';
import { makeShape, makeText, makeImage, makeIcon, loadImage } from './editor/objects.js';
import { makeGradient } from './editor/editor.js';
import { SHAPES, byId } from './editor/shapes.js';
import { pageCanvas, pageSvg, toBlob } from './editor/render.js';
import { SIZE_CATS } from './sizes.js';
import { bundledFonts, ensureFont, ensureFontsFor } from './fonts.js';
import { iconData, h } from './ui.js';
import { activeKit } from './panels/brand.js';
import { makeHtml, updateHtml } from './html-layer.js';
import { htmlToLayers } from './html-to-layers.js';
import { addVideoLayer } from './video-layer.js';
import { setPageTiming, setMusic, renderTimeline } from './timeline.js';
import { pageDuration, transitionOf, isMovingPage, totalDuration, exportVideo, designMoves, TRANSITIONS } from './video-export.js';
import { DEFAULT as GRADE_DEFAULT, LOOKS, isIdentity } from './grade.js';

const text = (t) => ({ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 1) });
const img = (b64) => ({ type: 'image', data: b64, mimeType: 'image/jpeg' });
const ok = (...c) => ({ content: c.flat().filter(Boolean) });
const fail = (msg) => ({ content: [text(msg)], isError: true });
class Oops extends Error {}
const need = (v, msg) => { if (v == null || v === '' || (typeof v === 'number' && !isFinite(v))) throw new Oops(msg); return v; };
const r1 = (n) => Math.round(n * 10) / 10;

// ───── activity pill: the user sees what the AI is doing ─────
let pill, pillT;
function activity(client, what) {
  if (!pill) { pill = h('div#agentPill.agent-pill'); document.body.append(pill); }
  pill.innerHTML = ''; pill.append(h('span.dot'), h('b', client || 'AI'), h('span', ' ' + what));
  pill.classList.add('on'); clearTimeout(pillT); pillT = setTimeout(() => pill.classList.remove('on'), 4000);
}
const LABEL = {
  new_design: 'is starting a design', open_design: 'is opening a design', resize_design: 'is resizing', add_page: 'is adding a page', go_to_page: 'is changing page', delete_page: 'is deleting a page',
  set_background: 'is setting the background', add_html: 'is building a page in HTML', update_html: 'is changing the HTML', html_to_layers: 'is making the HTML editable', add_text: 'is adding text',
  add_shape: 'is adding a shape', add_image: 'is adding a picture', add_icon: 'is adding an icon', add_video: 'is adding a video', update_layer: 'is adjusting a layer', delete_layer: 'is deleting a layer',
  arrange_layer: 'is reordering layers', color_grade: 'is colour grading', set_timeline: 'is setting the timeline', screenshot: 'is looking at the design', preview_animation: 'is watching the animation',
  export: 'is exporting', undo: 'is undoing',
};
const READONLY = new Set(['__info', 'get_state', 'list_designs', 'list_sizes', 'read_html', 'list_layers', 'brand_kit', 'screenshot', 'preview_animation']);

// ───── helpers ─────
const ed = () => { const e = app.editor; if (!e || app.view !== 'editor') throw new Oops('No design is open in RO2. Use new_design or open_design first.'); return e; };
async function onPage(p) { const e = ed(); if (p != null) { const i = Math.round(p) - 1; if (i < 0 || i >= e.doc.pages.length) throw new Oops(`There is no page ${p}. The design has ${e.doc.pages.length} page(s).`); if (i !== e.page) await e.gotoPage(i); } return e; }
const pageIdx = (e, p) => { if (p == null) return e.page; const i = Math.round(p) - 1; if (i < 0 || i >= e.doc.pages.length) throw new Oops(`There is no page ${p}.`); return i; };
function findLayer(id) {
  const e = ed(); need(id, 'Give the layer id (list_layers shows them).');
  const o = e.userObjects().find((x) => x.id === id);
  if (o) return { e, o };
  const elsewhere = e.doc.pages.findIndex((p, i) => i !== e.page && JSON.stringify(p.objects || []).includes(`"id":"${id}"`));
  throw new Oops(elsewhere >= 0 ? `Layer ${id} is on page ${elsewhere + 1}. go_to_page ${elsewhere + 1} first.` : `There is no layer ${id} on this page. Use list_layers.`);
}
function boxOf(o) { const c = o.getCenterPoint(); const w = o.getScaledWidth(), hh = o.getScaledHeight(); return { x: r1(c.x - w / 2), y: r1(c.y - hh / 2), width: r1(w), height: r1(hh) }; }
// size first (text: wrap width; others: scale), then top-left
function place(e, o, { x, y, width, height } = {}, { keepRatio = false } = {}) {
  const isText = o instanceof fabric.Textbox;
  if (isText) { if (width > 0) o.set({ width: width / (o.scaleX || 1) }); o.initDimensions && o.initDimensions(); }
  else if (o instanceof Ro2Line) { if (width > 0) o.set({ width: width / (o.scaleX || 1) }); }
  else if (width > 0 || height > 0) {
    const ow = o.width || 1, oh = o.height || 1;
    let sx = width > 0 ? width / ow : null, sy = height > 0 ? height / oh : null;
    if (keepRatio || sx == null || sy == null) { const s = sx ?? sy; if (keepRatio && sx && sy) { sx = sy = Math.min(sx, sy); } else { sx = sx ?? s; sy = sy ?? s; } }
    o.set({ scaleX: sx * Math.sign(o.scaleX || 1), scaleY: sy * Math.sign(o.scaleY || 1) });
  }
  o.setCoords();
  const b = boxOf(o); const nx = x ?? (e.W - b.width) / 2, ny = y ?? (e.H - b.height) / 2;
  o.setPositionByOrigin(new fabric.Point(nx + b.width / 2, ny + b.height / 2), 'center', 'center'); o.setCoords();
  return o;
}
function describe(o) {
  const k = kindOf(o); const d = { id: o.id, kind: k, name: o.ro2Name || k, ...boxOf(o) };
  if (o.angle) d.angle = r1(o.angle); if (o.opacity != null && o.opacity < 1) d.opacity = +o.opacity.toFixed(2);
  if (o.visible === false) d.visible = false; if (o.ro2Locked) d.locked = true;
  if (k === 'text') Object.assign(d, { text: o.text.length > 300 ? o.text.slice(0, 300) + '…' : o.text, font: o.fontFamily, size: r1(o.fontSize * (o.scaleY || 1)), weight: o.fontWeight, color: typeof o.fill === 'string' ? o.fill : 'gradient', align: o.textAlign });
  else if (k === 'html') Object.assign(d, { html_size: `${o.ro2Html.w}×${o.ro2Html.h}`, animated: !!o.ro2Html.animated, duration: o.ro2Html.animated ? o.ro2Html.duration : undefined, code_length: o.ro2Html.html.length });
  else if (k === 'video') Object.assign(d, { file: o.ro2Video.path, start: o.ro2Video.in, end: o.ro2Video.out, muted: !!o.ro2Video.muted });
  else if (k === 'shape') { d.shape = o.ro2Shape || o.type; d.fill = o.ro2Fill ? 'gradient' : o.fill; if (o.strokeWidth) { d.stroke = o.stroke; d.stroke_width = o.strokeWidth; } if (o.rx) d.radius = r1(o.rx * (o.scaleX || 1)); }
  else if (k === 'icon') d.icon = o.ro2Icon;
  else if (k === 'image' && o.ro2Credit) d.credit = [o.ro2Credit.creator, o.ro2Credit.license].filter(Boolean).join(' · ');
  return d;
}
const pageObjs = (e, i) => (i === e.page ? e.userObjects().map((o) => describe(o)) : (e.doc.pages[i].objects || []).map((j) => ({ id: j.id, kind: j.ro2Html ? 'html' : j.ro2Video ? 'video' : j.type, name: j.ro2Name })));

// a moment of a page as a canvas: animated HTML at time t, video clips at their frame
async function frameCanvas(e, i, t, scale) {
  const p = i === e.page ? { ...e.pageData, ...e.pageSnapshot() } : e.doc.pages[i];
  const objs = e.resolveAssets(p.objects || []);
  if (t != null) {
    for (const j of objs) {
      if (j.visible === false) continue;
      if (j.ro2Html && j.ro2Html.animated) {
        const need2 = Math.max(1, (j.width * Math.abs(j.scaleX || 1) * scale) / j.ro2Html.w);
        const r = await window.ro2.html.render({ html: j.ro2Html.html, w: j.ro2Html.w, h: j.ro2Html.h }, { scale: Math.min(3, need2), t: Math.min(t, j.ro2Html.duration) * 1000 });
        const sw = j.width * (j.scaleX || 1), sh = j.height * (j.scaleY || 1);
        Object.assign(j, { src: r.dataUrl, width: r.w, height: r.h, scaleX: sw / r.w, scaleY: sh / r.h, cropX: 0, cropY: 0 });
      } else if (j.ro2Video) {
        const v = j.ro2Video; const at = (v.in || 0) + Math.min(t, Math.max(0, (v.out ?? v.duration) - (v.in || 0) - 0.05));
        try { const u = await window.ro2.media.poster(v.path, at); const el = await loadImage(u); const sw = j.width * (j.scaleX || 1), sh = j.height * (j.scaleY || 1); Object.assign(j, { src: u, width: el.naturalWidth, height: el.naturalHeight, scaleX: sw / el.naturalWidth, scaleY: sh / el.naturalHeight, cropX: 0, cropY: 0 }); } catch {}
      }
    }
  }
  await ensureFontsFor(objs);
  const sc = new fabric.StaticCanvas(document.createElement('canvas'), { width: e.W, height: e.H, enableRetinaScaling: false, renderOnAddRemove: false });
  sc.add(e.makeBgObject(p.bg || { color: '#ffffff' }));
  sc.add(...(await fabric.util.enlivenObjects(objs)).filter((o) => o.visible !== false));
  const c = sc.toCanvasElement(scale); sc.dispose(); return c;
}
const jpeg = (c, q = 0.86) => c.toDataURL('image/jpeg', q).split(',')[1];
async function shot(e, i, { t, size = 1100 } = {}) {
  const scale = Math.min(2, Math.max(64, Math.min(2000, size)) / Math.max(e.W, e.H));
  const c = t != null ? await frameCanvas(e, i, t, scale) : await pageCanvas(e, i, { scale, background: '#ffffff' });
  return jpeg(c);
}
const look = async (e, a, note) => (a.look === false ? ok(text(note)) : ok(text(note), img(await shot(e, e.page))));

function findSize(name) {
  const q = String(name).toLowerCase().trim(); const all = SIZE_CATS.flatMap((c) => c.items);
  return all.find((s) => s[0].toLowerCase() === q) || all.find((s) => s[0].toLowerCase().includes(q)) || all.find((s) => q.includes(s[0].toLowerCase()));
}
function readSize(a) {
  if (a.size) { const s = findSize(a.size); if (!s) throw new Oops(`Unknown size "${a.size}". Use list_sizes, or give width and height.`); return { w: s[1], h: s[2], name: s[0] }; }
  if (a.width > 0 && a.height > 0) { if (a.width < 16 || a.height < 16 || a.width > 20000 || a.height > 20000) throw new Oops('Sizes go from 16 to 20,000 px.'); return { w: Math.round(a.width), h: Math.round(a.height) }; }
  return null;
}
const SHAPE_ALIAS = { rect: 'square', rectangle: 'square', box: 'square', 'rounded-rect': 'rounded', roundrect: 'rounded', ellipse: 'circle', oval: 'circle' };
const fontOk = (f) => bundledFonts().find((b) => b.family.toLowerCase() === String(f).toLowerCase());

// ───── the tools ─────
const T = {
  async __info() { const k = activeKit(); return { fonts: bundledFonts().map((f) => f.family), shapes: SHAPES.map((s) => s.id), brand: k ? brandOf(k) : null }; },

  async get_state() {
    const out = { open: null, brand: activeKit() ? activeKit().name : null };
    const e = app.editor;
    if (e && app.view === 'editor') {
      e.syncPage();
      out.open = {
        name: e.doc.name, file: app.file || '(not saved yet)', width: e.W, height: e.H, current_page: e.page + 1,
        pages: e.doc.pages.map((p, i) => ({ page: i + 1, layers: pageObjs(e, i).length, duration: pageDuration(e, i), transition_in: i ? transitionOf(e, i).type : undefined, moves: isMovingPage(e, i) || undefined })),
        layers_on_current_page: e.userObjects().map((o) => describe(o)),
        selected: e.selected().map((o) => o.id),
        video: designMoves(e) ? { total_seconds: r1(totalDuration(e)), fps: (e.doc.timeline || {}).fps || 30, music: (e.doc.timeline || {}).music ? (e.doc.timeline.music.name || e.doc.timeline.music.path) : null } : undefined,
      };
    }
    const list = await window.ro2.designs.list().catch(() => []);
    out.recent_designs = list.slice(0, 8).map((d) => ({ name: d.name, size: `${d.w}×${d.h}`, pages: d.pages, file: d.file }));
    return ok(text(out));
  },
  async list_designs() { const l = await window.ro2.designs.list(); return ok(text(l.map((d) => ({ name: d.name, size: `${d.w}×${d.h}`, pages: d.pages, updated: new Date(d.updated).toISOString().slice(0, 16).replace('T', ' '), file: d.file })))); },
  async list_sizes() { return ok(text(SIZE_CATS.map((c) => ({ category: c.name, sizes: c.items.map((s) => `${s[0]}: ${s[1]}×${s[2]}${s[3] ? ` (${s[3]})` : ''}`) })))); },

  async new_design(a) {
    const s = readSize(a) || { w: 1080, h: 1080, name: 'Instagram post' };
    const e = await newDesign(s.w, s.h, a.name || s.name || 'AI design');
    if (a.background) e.setBackground({ color: a.background });
    await saveNow(true);
    return ok(text(`Opened a new ${s.w}×${s.h} design "${e.doc.name}". It has one ${a.background ? a.background : 'white'} page.`));
  },
  async open_design(a) {
    const q = String(need(a.design, 'Which design?')); const l = await window.ro2.designs.list();
    const d = l.find((x) => x.file === q) || l.find((x) => x.name.toLowerCase() === q.toLowerCase()) || l.find((x) => x.name.toLowerCase().includes(q.toLowerCase()));
    if (!d) throw new Oops(`No design called "${q}". Use list_designs.`);
    await openFile(d.file); if (!app.editor || app.file !== d.file) throw new Oops('RO2 could not open that design.');
    return ok(text(`Opened "${d.name}" (${app.editor.W}×${app.editor.H}, ${app.editor.doc.pages.length} page(s)).`));
  },
  async resize_design(a) {
    let e = ed(); const s = readSize(a); if (!s) throw new Oops('Give a size name or width and height.');
    const mode = a.mode === 'keep' ? 'keep' : 'scale';
    if (a.copy) { await saveNow(false); const data = e.toFile(); data.id = uid(); data.name = `${data.name} (${s.name || `${s.w}×${s.h}`})`; data.thumb = null; await openDoc(data, null); e = app.editor; }
    await e.resize(s.w, s.h, mode); app.emit('doc', e.doc); await saveNow(true);
    return look(e, a, `${a.copy ? 'Made a copy' : 'Resized the design'} at ${s.w}×${s.h}${mode === 'scale' ? ', content scaled to fit' : ''}. Check every page: things may need moving.`);
  },
  async add_page(a) {
    const e = ed(); await e.addPage(e.page, !!a.duplicate);
    if (a.background && !a.duplicate) e.setBackground({ color: a.background });
    return ok(text(`Added page ${e.page + 1} of ${e.doc.pages.length}${a.duplicate ? ' (a copy)' : ''} and went to it.`));
  },
  async go_to_page(a) { const e = await onPage(need(a.page, 'Which page?')); return ok(text(`On page ${e.page + 1} of ${e.doc.pages.length}.`), img(await shot(e, e.page, { size: 700 }))); },
  async delete_page(a) { const e = ed(); const i = pageIdx(e, need(a.page, 'Which page?')); if (e.doc.pages.length < 2) throw new Oops('A design needs at least one page.'); await e.deletePage(i); return ok(text(`Deleted page ${i + 1}. ${e.doc.pages.length} page(s) left.`)); },
  async set_background(a) {
    const e = await onPage(a.page);
    if (a.gradient) { const g = a.gradient; if (!Array.isArray(g.stops) || g.stops.length < 2) throw new Oops('A gradient needs at least two stops [{offset, color}].'); e.setBackground({ gradient: { type: g.type === 'radial' ? 'radial' : 'linear', angle: g.angle ?? 90, stops: g.stops.map((s, k) => ({ offset: s.offset ?? k / (g.stops.length - 1), color: s.color })) } }); }
    else e.setBackground({ color: need(a.color, 'Give a color or a gradient.') });
    return look(e, a, 'Background set.');
  },

  // HTML
  async add_html(a) {
    const e = await onPage(a.page); need(a.html, 'Give the HTML.');
    const width = a.width > 0 ? a.width : e.W, height = a.height > 0 ? a.height : e.H;
    const { o, info } = await makeHtml(e, { html: a.html, name: a.name || 'HTML', x: a.x ?? (e.W - width) / 2, y: a.y ?? (e.H - height) / 2, width, height, duration: a.duration > 0 ? a.duration : undefined });
    e.add(o, { index: e.canvas.getObjects().length, select: false });
    autosave();
    const note = [`Added HTML layer ${o.id} (${o.ro2Html.w}×${o.ro2Html.h} CSS px).`, info.animated ? `It animates: ${info.duration} s. The canvas shows ${o.ro2Html.poster != null ? `t=${o.ro2Html.poster}s` : 'its last frame'}; use screenshot {t} or preview_animation to see the motion.` : 'It is still.', info.logs && info.logs.length ? `Console: ${info.logs.join(' | ')}` : ''].filter(Boolean).join(' ');
    return look(e, a, note);
  },
  async update_html(a) {
    const { e, o } = findLayer(a.id); if (!o.ro2Html) throw new Oops(`${a.id} is not an HTML layer.`);
    let code = o.ro2Html.html;
    if (a.html) code = a.html;
    else if (a.find != null) { const n = code.split(a.find).length - 1; if (!n) throw new Oops('The find text is not in the code. Use read_html to see it exactly.'); code = code.split(a.find).join(a.replace ?? ''); }
    else if (!(a.duration > 0)) throw new Oops('Give html, or find and replace, or duration.');
    const r = await updateHtml(e, o, { html: code, ...(a.duration > 0 ? { duration: a.duration } : {}) });
    e.commit(); e.emit('modified', [o]); autosave();
    return look(e, a, `Updated ${o.id}. ${r.animated ? `Animates for ${r.duration} s.` : 'Still.'}${r.logs && r.logs.length ? ' Console: ' + r.logs.join(' | ') : ''}`);
  },
  async read_html(a) { const { o } = findLayer(a.id); if (!o.ro2Html) throw new Oops(`${a.id} is not an HTML layer.`); return ok(text(`${o.ro2Html.w}×${o.ro2Html.h} px · ${o.ro2Html.animated ? `animated, ${o.ro2Html.duration} s` : 'still'}\n\n` + o.ro2Html.html)); },
  async html_to_layers(a) {
    const { e, o } = findLayer(a.id); if (!o.ro2Html) throw new Oops(`${a.id} is not an HTML layer.`);
    const r = await htmlToLayers(e, o, { remove: !!a.remove, t: a.t });
    autosave();
    return look(e, a, `Made ${r.layers.length} editable layers (${r.texts} text, ${r.boxes} shapes, ${r.images + r.svgs} pictures).${a.remove ? '' : ' The HTML layer is hidden, not deleted.'} New layer ids: ${r.layers.map((l) => `${l.id} ${l.name}`).join(', ')}`);
  },

  // layers
  async add_text(a) {
    const e = await onPage(a.page); need(a.text, 'Give the text.');
    const fam = a.font ? (fontOk(a.font) ? fontOk(a.font).family : a.font) : 'Inter';
    const t = await makeText(e, { text: a.uppercase ? String(a.text).toUpperCase() : String(a.text), fontFamily: fam, fontWeight: a.weight || 400, fill: a.color || '#111418', textAlign: a.align || 'left', lineHeight: a.line_height || 1.2, charSpacing: a.letter_spacing || 0, fontStyle: a.italic ? 'italic' : 'normal' });
    await ensureFont(fam, a.weight || 400).catch(() => {});
    if (a.size > 0) t.set({ fontSize: a.size });
    if (!(a.width > 0)) { const c = document.createElement('canvas').getContext('2d'); c.font = `${t.fontStyle} ${t.fontWeight} ${t.fontSize}px "${fam}"`; t.set({ width: Math.min(e.W, Math.max(...t.text.split('\n').map((l) => c.measureText(l).width)) * (1 + (t.charSpacing || 0) / 1000) + t.fontSize * 0.3) }); }
    t.initDimensions(); place(e, t, a); t.id = t.id || uid(); e.add(t, { select: false }); autosave();
    return ok(text(`Added text ${t.id} at ${JSON.stringify(boxOf(t))}.${fontOk(fam) ? '' : ` "${fam}" is not one of RO2's bundled fonts; it shows only if installed on this computer.`}`));
  },
  async add_shape(a) {
    const e = await onPage(a.page); const id = String(need(a.shape, 'Which shape?')).toLowerCase(); const s = byId(SHAPE_ALIAS[id] || id);
    if (!s) throw new Oops(`Unknown shape "${a.shape}". Shapes: ${SHAPES.map((x) => x.id).join(', ')}`);
    let o = makeShape(e, s, { fill: a.fill || '#7c8b98' });
    const w = a.width > 0 ? a.width : a.height > 0 ? a.height : Math.min(e.W, e.H) * 0.3, hh = a.height > 0 ? a.height : w;
    if (o instanceof fabric.Rect) { const rx = a.radius != null ? Math.min(a.radius, Math.min(w, hh) / 2) : Math.min((o.rx || 0) * (w / o.width), Math.min(w, hh) / 2); o.set({ width: w, height: hh, rx, ry: rx, scaleX: 1, scaleY: 1 }); }
    else if (o instanceof fabric.Circle && Math.abs(w - hh) > 0.5) { o = new fabric.Ellipse({ rx: w / 2, ry: hh / 2, fill: o.fill, strokeWidth: 0, stroke: '#1b1f23', strokeUniform: true, ro2Shape: 'ellipse', ro2Name: 'Ellipse' }); }
    else place(e, o, { width: w, height: hh });
    if (a.stroke || a.stroke_width) o.set({ stroke: a.stroke || '#1b1f23', strokeWidth: a.stroke_width || 2 });
    if (a.opacity != null) o.set({ opacity: Math.max(0, Math.min(1, a.opacity)) });
    place(e, o, { x: a.x, y: a.y }); o.id = uid(); e.add(o, { select: false }); autosave();
    return ok(text(`Added ${s.name.toLowerCase()} ${o.id} at ${JSON.stringify(boxOf(o))}.`));
  },
  async add_image(a) {
    const e = await onPage(a.page); let dataUrl, svg = null, name = a.name, credit;
    if (a.url) { if (!/^https:\/\//.test(a.url)) throw new Oops('Image addresses must start with https://'); dataUrl = await window.ro2.library.fetch(a.url); }
    else if (a.path) { const r = await window.ro2.files.readImage(a.path); dataUrl = r.dataUrl; svg = r.svg; name = name || r.name; }
    else if (a.search) {
      const r = await window.ro2.library.search({ q: a.search, page: 1, kind: 'photo' }); const p = (r.results || []).find((x) => !(a.width && a.height) || !x.w || (x.w >= x.h) === (a.width >= a.height)) || (r.results || [])[0];
      if (!p) throw new Oops(`No free photos for "${a.search}". Try other words.`);
      dataUrl = await window.ro2.library.fetch(p.url).catch(() => window.ro2.library.fetch(p.thumb)); name = name || p.title; credit = { title: p.title, creator: p.creator, license: p.license, url: p.page, source: p.source };
    } else throw new Oops('Give url, path or search.');
    let o;
    if (svg) { const { makeSvg } = await import('./editor/objects.js'); o = await makeSvg(e, svg, name || 'Graphic'); place(e, o, a, { keepRatio: true }); }
    else {
      o = await makeImage(e, dataUrl, { fit: 'contain', name: name || 'Picture', credit });
      const iw = o.width, ih = o.height;
      if (a.width > 0 && a.height > 0 && a.fit !== 'contain') { const s = Math.max(a.width / iw, a.height / ih); const cw = a.width / s, ch = a.height / s; o.set({ cropX: (iw - cw) / 2, cropY: (ih - ch) / 2, width: cw, height: ch, scaleX: s, scaleY: s }); place(e, o, { x: a.x, y: a.y }); }
      else place(e, o, a, { keepRatio: true });
    }
    o.id = o.id || uid(); e.add(o, { select: false }); autosave();
    return ok(text(`Added picture ${o.id} at ${JSON.stringify(boxOf(o))}.${credit && credit.license && !/CC0|PDM|public domain/i.test(credit.license) ? ` License ${credit.license}: credit ${credit.creator || credit.source}.` : ''}`));
  },
  async add_icon(a) {
    const e = await onPage(a.page); const n = String(need(a.name, 'Which icon?')).toLowerCase().replace(/\s+/g, '-');
    if (!iconData(n)) throw new Oops(`No Lucide icon called "${a.name}". Try a simpler name (e.g. star, heart, rocket, map-pin, circle-check).`);
    const o = await makeIcon(e, n, a.color || '#1b1f23'); const s = a.size > 0 ? a.size : Math.min(e.W, e.H) * 0.15;
    place(e, o, { x: a.x, y: a.y, width: s, height: s }, { keepRatio: true }); o.id = uid(); e.add(o, { select: false }); autosave();
    return ok(text(`Added icon ${o.id} at ${JSON.stringify(boxOf(o))}.`));
  },
  async add_video(a) {
    const e = await onPage(a.page); const info = await window.ro2.media.import(need(a.path, 'Give the video file.'));
    if (!info.duration) throw new Oops('That file has no video RO2 can play.');
    const o = await addVideoLayer(e, info, { x: a.x, y: a.y, width: a.width, height: a.height, start: a.start || 0, end: a.end, muted: !!a.muted });
    e.add(o, { select: false }); autosave(); renderTimeline();
    return ok(text(`Added video ${o.id} (${info.width}×${info.height}, plays ${o.ro2Video.in}–${r1(o.ro2Video.out)} s${info.hasAudio && !a.muted ? ', with sound' : ''}) at ${JSON.stringify(boxOf(o))}. The page now plays for ${pageDuration(e, e.page)} s.`));
  },
  async list_layers(a) { const e = await onPage(a.page); return ok(text({ page: e.page + 1, size: `${e.W}×${e.H}`, background: e.pageData.bg, layers_bottom_to_top: e.userObjects().map((o) => describe(o)) })); },
  async update_layer(a) {
    const { e, o } = findLayer(a.id); const k = kindOf(o); const p = {};
    if (a.name != null) o.ro2Name = a.name;
    if (a.visible != null) p.visible = !!a.visible;
    if (a.opacity != null) p.opacity = Math.max(0, Math.min(1, a.opacity));
    if (a.angle != null) { const c = o.getCenterPoint(); o.rotate(a.angle); o.setPositionByOrigin(c, 'center', 'center'); }
    if (k === 'text') {
      if (a.text != null) p.text = String(a.text);
      if (a.font) { p.fontFamily = fontOk(a.font) ? fontOk(a.font).family : a.font; }
      if (a.weight) p.fontWeight = a.weight;
      if (p.fontFamily || p.fontWeight) await ensureFont(p.fontFamily || o.fontFamily, p.fontWeight || o.fontWeight).catch(() => {});
      if (a.size > 0) p.fontSize = a.size / (o.scaleY || 1);
      if (a.color) p.fill = a.color; if (a.align) p.textAlign = a.align;
      if (a.line_height) p.lineHeight = a.line_height; if (a.letter_spacing != null) p.charSpacing = a.letter_spacing;
    } else if (k === 'icon') { if (a.color) (o._objects || [o]).forEach((x) => x.set({ stroke: a.color })); }
    else if (k === 'line') { if (a.color || a.stroke) p.lineColor = a.color || a.stroke; if (a.stroke_width) p.lineWidth = a.stroke_width; }
    else {
      if (a.fill || a.color) { if (o instanceof fabric.Group) o.getObjects().forEach((x) => { if (x.fill && x.fill !== 'none') x.set({ fill: a.fill || a.color }); }); else { p.fill = a.fill || a.color; o.ro2Fill = undefined; } }
      if (a.stroke) { p.stroke = a.stroke; if (!o.strokeWidth && a.stroke_width == null) p.strokeWidth = 2; }
      if (a.stroke_width != null) p.strokeWidth = a.stroke_width;
      if (a.radius != null && o instanceof fabric.Rect) { p.rx = a.radius / (o.scaleX || 1); p.ry = a.radius / (o.scaleY || 1); }
    }
    o.set(p); if (o.initDimensions) o.initDimensions();
    if (a.x != null || a.y != null || a.width > 0 || a.height > 0) { const b = boxOf(o); place(e, o, { x: a.x ?? b.x, y: a.y ?? b.y, width: a.width, height: a.height }, { keepRatio: k === 'icon' || (k === 'html' && !(a.width > 0 && a.height > 0)) }); }
    if (a.locked != null && !!o.ro2Locked !== !!a.locked) e._applyLock(o, !!a.locked);
    o.dirty = true; o.setCoords(); e.canvas.requestRenderAll(); e.commit(); e.emit('modified', [o]); autosave();
    return look(e, { look: a.look ?? false }, `Updated ${o.id}: ${JSON.stringify(describe(o))}`);
  },
  async delete_layer(a) { const { e, o } = findLayer(a.id); e.remove([o]); autosave(); return ok(text(`Deleted ${a.id}.`)); },
  async arrange_layer(a) {
    const { e, o } = findLayer(a.id); e.select(o);
    ({ front: () => e.bringToFront(), back: () => e.sendToBack(), forward: () => e.bringForward(), backward: () => e.sendBackward() }[a.to] || (() => { throw new Oops('to must be front, back, forward or backward.'); }))();
    e.select(null); autosave();
    return ok(text(`Moved ${a.id} ${a.to}. Order now (bottom → top): ${e.userObjects().map((x) => x.id).join(', ')}`));
  },

  async brand_kit() { const k = activeKit(); if (!k) return ok(text('No brand kit yet. The user can make one in the Brand tab.')); return ok(text(brandOf(k))); },
  async color_grade(a) {
    const { e, o } = findLayer(a.id); if (kindOf(o) !== 'image') throw new Oops('color_grade works on a photo layer (kind image). For the whole page, pass a photo id and whole_page:true.');
    const lk = a.look || 'none'; if (!LOOKS.some((l) => l.id === lk)) throw new Oops(`Unknown look. Looks: ${LOOKS.map((l) => l.id).join(', ')}`);
    const grade = { ...GRADE_DEFAULT, ...(o.ro2Grade || {}), look: lk, amount: a.amount ?? 100, hue: a.hue || 0, sat: a.saturation || 0, swaps: [] };
    await applyGrade(e, o, { grade, identity: isIdentity(grade), page: !!a.whole_page, dataUrl: null });
    autosave();
    return look(e, a, isIdentity(grade) ? 'Removed the grade.' : `Graded ${a.whole_page ? 'the whole page' : o.id}: ${lk}${a.hue ? `, hue ${a.hue}°` : ''}${a.saturation ? `, saturation ${a.saturation}` : ''}.`);
  },
  async set_timeline(a) {
    const e = ed(); e.syncPage(); const notes = [];
    for (const p of a.pages || []) {
      const i = pageIdx(e, need(p.page, 'Each pages entry needs page.'));
      if (p.transition && !TRANSITIONS.some((x) => x[0] === p.transition)) throw new Oops(`Unknown transition "${p.transition}".`);
      setPageTiming(e, i, { duration: p.duration, transition: p.transition, transitionDuration: p.transition_duration });
    }
    if (a.fps) e.doc.timeline = { ...(e.doc.timeline || {}), fps: [24, 25, 30, 60].includes(+a.fps) ? +a.fps : 30 };
    if (a.remove_music) setMusic(e, null);
    if (a.music) {
      const m = typeof a.music === 'string' ? { path: a.music } : a.music; const info = await window.ro2.media.import(need(m.path, 'music needs path'));
      setMusic(e, { path: info.path, name: info.name, duration: info.duration, volume: m.volume ?? 0.8, fadeIn: m.fade_in ?? 0, fadeOut: m.fade_out ?? 1.5, in: m.start || 0 });
      notes.push(`Music: ${info.name} (${r1(info.duration)} s).`);
    }
    e.emit('change'); renderTimeline(); autosave();
    const tl = e.doc.pages.map((_, i) => `page ${i + 1}: ${pageDuration(e, i)} s${i ? `, in with ${transitionOf(e, i).type}` : ''}`).join('; ');
    return ok(text(`Timeline: ${tl}. Total ${r1(totalDuration(e))} s at ${(e.doc.timeline || {}).fps || 30} fps. ${notes.join(' ')}`));
  },

  async screenshot(a) {
    const e = ed(); const i = pageIdx(e, a.page);
    return ok(text(`Page ${i + 1} of ${e.doc.pages.length}, ${e.W}×${e.H}${a.t != null ? `, at ${a.t} s` : ''}.`), img(await shot(e, i, { t: a.t, size: a.size || 1100 })));
  },
  async preview_animation(a) {
    const e = ed(); const i = pageIdx(e, a.page); const n = Math.max(2, Math.min(16, Math.round(a.frames || 8)));
    const dur = pageDuration(e, i); const times = Array.from({ length: n }, (_, k) => r1(Math.min(dur - 1 / 30, (dur * k) / (n - 1))));
    const cols = n <= 4 ? n : n <= 9 ? 3 : 4; const rows = Math.ceil(n / cols);
    const cell = Math.min(420, Math.round(1500 / cols)); const sc = cell / Math.max(e.W, e.H); const cw = Math.round(e.W * sc), ch = Math.round(e.H * sc);
    const pad = 10, lab = 22; const out = document.createElement('canvas'); out.width = cols * (cw + pad) + pad; out.height = rows * (ch + pad + lab) + pad;
    const x = out.getContext('2d'); x.fillStyle = '#1b1f23'; x.fillRect(0, 0, out.width, out.height); x.font = '600 14px Inter, sans-serif'; x.fillStyle = '#e8ecef';
    for (const [k, t] of times.entries()) {
      const c = await frameCanvas(e, i, t, sc); const cx = pad + (k % cols) * (cw + pad), cy = pad + Math.floor(k / cols) * (ch + pad + lab);
      x.fillText(`${t.toFixed(1)} s`, cx, cy + 15); x.drawImage(c, cx, cy + lab, cw, ch);
    }
    return ok(text(`Page ${i + 1}: ${dur} s${isMovingPage(e, i) ? '' : ' (nothing on this page moves)'}. Frames at ${times.join(', ')} s, left to right, top to bottom.`), img(jpeg(out, 0.82)));
  },
  async export(a, client) {
    const e = ed(); const fmt = String(a.format || 'png').toLowerCase().replace('jpeg', 'jpg');
    const name = e.doc.name || 'Design';
    if (['mp4', 'webm', 'gif'].includes(fmt)) {
      const output = a.path || (await window.ro2.agentFiles.outPath(name, fmt));
      const pages = a.pages === 'current' || (fmt === 'webm' && a.transparent) ? [e.page] : undefined;
      const r = await exportVideo(e, { output, pages, scale: fmt === 'gif' ? 1 : Math.max(0.25, Math.min(2, a.scale || 1)), fps: a.fps || (fmt === 'gif' ? 15 : undefined), quality: 'high', transparent: fmt === 'webm' && !!a.transparent, gif: { fps: Math.min(24, a.fps || 15), width: Math.min(720, e.W) } }, (p, t) => activity(client, `is exporting ${fmt.toUpperCase()} · ${Math.round(p * 100)}%`));
      return ok(text(`Saved ${fmt.toUpperCase()}: ${r.output} (${r1(r.duration || 0)} s, ${Math.round((r.bytes || 0) / 1024)} KB).`));
    }
    if (!['png', 'jpg', 'webp', 'svg', 'pdf'].includes(fmt)) throw new Oops('Formats: png, jpg, webp, svg, pdf, mp4, webm, gif.');
    const pages = fmt === 'pdf' || a.pages === 'all' ? e.doc.pages.map((_, i) => i) : [e.page];
    if (fmt === 'pdf') { const svgs = []; for (const i of pages) svgs.push(await pageSvg(e, i)); const file = a.path || (await window.ro2.agentFiles.outPath(name, 'pdf')); const r = await window.ro2.exporter.pdf({ svgs, width: e.W, height: e.H, file }); return ok(text(`Saved PDF (${pages.length} page(s)): ${r.file}`)); }
    const scale = Math.max(0.1, Math.min(4, a.scale || 1)); const files = [];
    for (const i of pages) {
      let bytes;
      if (fmt === 'svg') bytes = new TextEncoder().encode(await pageSvg(e, i));
      else { const c = await pageCanvas(e, i, { scale, transparent: fmt !== 'jpg' && !!a.transparent, background: fmt === 'jpg' ? '#ffffff' : null }); bytes = new Uint8Array(await (await toBlob(c, { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[fmt], fmt === 'png' ? undefined : 0.92)).arrayBuffer()); }
      const file = a.path && pages.length === 1 ? a.path : await window.ro2.agentFiles.outPath(pages.length > 1 ? `${name}-${i + 1}` : name, fmt, a.path && pages.length > 1 ? a.path : undefined);
      await window.ro2.exporter.write(file, bytes); files.push(file);
    }
    return ok(text(`Saved ${files.length} ${fmt.toUpperCase()} file(s) at ${Math.round(e.W * scale)}×${Math.round(e.H * scale)}: ${files.join(', ')}`));
  },
  async undo(a) { const e = ed(); const n = Math.max(1, Math.min(20, a.steps || 1)); let k = 0; for (; k < n && e.canUndo(); k++) await e.undo(); autosave(); return look(e, { look: a.look ?? true }, k ? `Undid ${k} step(s) on page ${e.page + 1}.` : 'Nothing to undo on this page.'); },
};
function brandOf(k) {
  return { name: k.name, colors: (k.colors || []).map((c) => c.hex || c), fonts: k.fonts || {}, logos: (k.logos || []).map((l) => ({ name: l.name, url: `ro2://brand/${l.file}` })) };
}

// ───── wiring ─────
let queue = Promise.resolve();
export function initAgent() {
  window.ro2.agent.onCall(({ id, name, args, client }) => {
    // one call at a time: tools change shared state (the open page)
    queue = queue.then(async () => {
      let result;
      try {
        const fn = T[name]; if (!fn) throw new Oops(`RO2 doesn't have a tool called ${name}.`);
        if (!READONLY.has(name) && LABEL[name]) activity(client, LABEL[name]);
        result = await fn(args || {}, client);
      } catch (e) { result = fail(e instanceof Oops ? e.message : `RO2 hit an error: ${String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`); if (!(e instanceof Oops)) console.warn('[agent]', name, e); }
      window.ro2.agent.reply(id, result);
    });
  });
  window.ro2.agent.ready();
}
