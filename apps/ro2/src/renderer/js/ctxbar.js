// The bar above the page: quick controls for whatever is selected, plus the floating mini toolbar and the right-click menu.
import { h, ico, esc, popover, closePopover, slider, seg, menu, MOD, toast, debounce } from './ui.js';
import { app, runStudio } from './app.js';
import { fabric, kindOf, Ro2Line } from './editor/fab.js';
import { open as openPanel, currentPanel, refresh } from './drawer.js';
import { colorPicker, swatchCss } from './panels/color.js';
import { docColors, setAsBackground, detachBackground } from './panels/background.js';
import { makeGradient, fillOf } from './editor/editor.js';
import { bundledFonts, loadSystemFonts, systemFonts, ensureFont, boldWeight } from './fonts.js';
import { colorsOf, setGroupColor } from './editor/objects.js';
import { framesGrid, applyFrame } from './panels/image.js';
import { startCrop } from './editor/crop.js';
import { TOOLS } from './panels/ai.js';

const bar = () => document.getElementById('ctxbar');
const ed = () => app.editor;
const sep = () => h('div.cb-sep');
function cbtn(label, onClick, { icon, title, on, cls } = {}) {
  const b = h('button.cb-btn' + (on ? '.on' : '') + (cls ? '.' + cls : ''), { title: title || label || null, on: { click: (e) => onClick(e, b) } });
  b.innerHTML = (icon ? ico(icon) : '') + (label ? `<span>${esc(label)}</span>` : '');
  return b;
}
function colorDot(value, onPick, { title = 'Colour', kind = '', noGradient = false, allowNone = false } = {}) {
  const b = h('button.cb-color' + (kind ? '.' + kind : ''), { title });
  const paint = (v) => { b.innerHTML = kind === 'text' ? `<b>A</b><i style="background:${swatchCss(v)}"></i>` : `<i style="background:${swatchCss(v)};--c:${typeof v === 'string' ? v : '#888'}"></i>`; };
  paint(value);
  b.onclick = () => colorPicker(b, value, (v, final) => { value = v; paint(v); onPick(v, final); }, { docColors: docColors(ed()), noGradient, allowNone, title });
  return b;
}
const commitSoon = debounce(() => ed().commit(), 400);
function applyFill(list, v, final) {
  for (const o of list) {
    if (o instanceof Ro2Line) o.set({ lineColor: typeof v === 'string' ? v : v.stops[0].color });
    else if (typeof v === 'string') { o.set({ fill: v }); o.ro2Fill = undefined; }
    else { o.set({ fill: makeGradient(v) }); o.ro2Fill = v; }
    if (o.isEditing === false || !o.isEditing) o.removeStyle?.('fill');
    o.dirty = true;
  }
  ed().canvas.requestRenderAll(); if (final) ed().commit();
}
// text helpers: change the selected characters while typing, else the whole box
function textSet(o, props) {
  if (o.isEditing && o.selectionStart !== o.selectionEnd) o.setSelectionStyles(props);
  else { o.set(props); for (const k of Object.keys(props)) o.removeStyle?.(k); }
  o.initDimensions?.(); o.setCoords(); o.dirty = true; ed().canvas.requestRenderAll();
}
const textList = () => ed().selected().filter((o) => kindOf(o) === 'text');

// ───── font picker ─────
async function fontPicker(anchor, current, onPick) {
  const search = h('input.input', { placeholder: 'Search fonts', style: { width: '100%' } });
  const list = h('div.list'); const root = h('div.fontlist', search, list);
  const cats = [['sans', 'Sans serif'], ['serif', 'Serif'], ['display', 'Display'], ['script', 'Handwriting & script'], ['mono', 'Monospace & pixel']];
  let sys = systemFonts();
  const draw = () => {
    const q = search.value.trim().toLowerCase(); list.innerHTML = '';
    const item = (fam, tag) => h('div.f' + (fam === current ? '.on' : ''), { style: { fontFamily: `"${fam}"` }, on: { click: () => { onPick(fam); closePopover(); } } }, h('span', fam), tag ? h('small', tag) : null);
    for (const [cat, label] of cats) {
      const fs = bundledFonts().filter((f) => f.category === cat && (!q || f.family.toLowerCase().includes(q)));
      if (!fs.length) continue; list.append(h('div.grp', label)); fs.forEach((f) => list.append(item(f.family)));
    }
    const ss = sys.filter((f) => !q || f.toLowerCase().includes(q));
    if (ss.length) { list.append(h('div.grp', 'On this computer')); ss.slice(0, q ? 200 : 400).forEach((f) => list.append(item(f, ''))); }
    else if (!sys.length) list.append(h('div.grp', 'Loading this computer’s fonts…'));
  };
  search.addEventListener('input', draw);
  popover(anchor, root); draw(); setTimeout(() => search.focus(), 30);
  if (!sys.length) { sys = await loadSystemFonts(); if (sys.length || document.contains(root)) draw(); }
}

// ───── the bar ─────
export function renderCtx() {
  const el = bar(); if (!el || !ed()) return; el.innerHTML = '';
  const E = ed();
  if (E.cropping) return renderCrop(el);
  const a = E.active(); const k = kindOf(a); const list = E.selected();
  if (!a) {
    const bg = E.pageData.bg || {};
    el.append(colorDot(bg.gradient || bg.color || '#ffffff', (v, f) => E.setBackground(typeof v === 'string' ? { color: v } : { gradient: v }, { commit: f }), { title: 'Page background', allowNone: true }));
    el.append(cbtn('Background', () => openPanel('background'), { icon: 'paint-bucket' }), cbtn('Resize', () => import('./modals/resize.js').then((m) => m.openResize()), { icon: 'scaling' }), sep());
    el.append(h('div.cb-hint', h('span', `Page ${E.page + 1} of ${E.doc.pages.length} · ${E.W} × ${E.H} px`), h('span', 'Click anything to edit it · drop photos anywhere · ', h('kbd', 'Space'), ' + drag to pan')));
    return;
  }
  if (k === 'text') {
    const t = a;
    const isEmoji = /Emoji/.test(t.fontFamily);
    const fb = h('button.cb-font', { title: 'Font' }, h('span', { style: { fontFamily: isEmoji ? null : `"${t.fontFamily}"` } }, isEmoji ? 'Emoji' : t.fontFamily), h('span', { html: ico('chevron-down') }));
    fb.onclick = () => fontPicker(fb, t.fontFamily, async (fam) => { await ensureFont(fam, t.fontWeight); await ensureFont(fam, boldWeight(fam)); textList().forEach((o) => textSet(o, { fontFamily: fam })); E.commit(); renderCtx(); });
    el.append(fb);
    const size = h('input', { value: Math.round(t.fontSize * (t.scaleY || 1)) });
    const setSize = (v) => { v = Math.max(1, Math.min(2000, v)); textList().forEach((o) => textSet(o, { fontSize: v / (o.scaleY || 1) })); size.value = Math.round(v); commitSoon(); };
    size.addEventListener('change', () => setSize(parseFloat(size.value) || t.fontSize));
    size.addEventListener('keydown', (e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); setSize((parseFloat(size.value) || 0) + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1)); } e.stopPropagation(); });
    const step = (d) => { const cur = parseFloat(size.value) || t.fontSize; const s = cur < 20 ? 1 : cur < 60 ? 2 : cur < 150 ? 6 : 12; setSize(cur + d * s); };
    el.append(h('div.cb-size', h('button', { title: 'Smaller', on: { click: () => step(-1) } }, '−'), size, h('button', { title: 'Bigger', on: { click: () => step(1) } }, '+')));
    el.append(colorDot(fillOf(t), (v, f) => applyFill(textList(), v, f), { title: 'Text colour', kind: 'text' }));
    const isBold = (t.fontWeight | 0) >= 600;
    el.append(cbtn('', () => { const w = isBold ? 400 : boldWeight(t.fontFamily); ensureFont(t.fontFamily, w).then(() => { textList().forEach((o) => textSet(o, { fontWeight: w })); E.commit(); renderCtx(); }); }, { icon: 'bold', title: `Bold (${MOD}B)`, on: isBold }));
    el.append(cbtn('', () => { textList().forEach((o) => textSet(o, { fontStyle: t.fontStyle === 'italic' ? 'normal' : 'italic' })); E.commit(); renderCtx(); }, { icon: 'italic', title: `Italic (${MOD}I)`, on: t.fontStyle === 'italic' }));
    el.append(cbtn('', () => { textList().forEach((o) => textSet(o, { underline: !t.underline })); E.commit(); renderCtx(); }, { icon: 'underline', title: `Underline (${MOD}U)`, on: t.underline }));
    el.append(cbtn('', () => { textList().forEach((o) => textSet(o, { linethrough: !t.linethrough })); E.commit(); renderCtx(); }, { icon: 'strikethrough', title: 'Strikethrough', on: t.linethrough }));
    const aligns = ['left', 'center', 'right', 'justify']; const aIcon = { left: 'text-align-start', center: 'text-align-center', right: 'text-align-end', justify: 'text-align-justify' };
    el.append(cbtn('', () => { const n = aligns[(aligns.indexOf(t.textAlign) + 1) % 4]; textList().forEach((o) => { o.set({ textAlign: n }); o.dirty = true; }); E.canvas.requestRenderAll(); E.commit(); renderCtx(); }, { icon: aIcon[t.textAlign] || 'text-align-center', title: 'Alignment' }));
    el.append(cbtn('', (e, b) => menu(b, [
      { label: 'UPPERCASE', run: () => caseAll((s) => s.toUpperCase()) }, { label: 'lowercase', run: () => caseAll((s) => s.toLowerCase()) },
      { label: 'Title Case', run: () => caseAll((s) => s.toLowerCase().replace(/(^|\s|-)\S/g, (m) => m.toUpperCase())) }, { label: 'Sentence case', run: () => caseAll((s) => s.toLowerCase().replace(/(^\s*|[.!?]\s+)\S/g, (m) => m.toUpperCase())) },
      '-', { label: 'Bulleted list', icon: 'list', run: () => listAll() },
    ]), { icon: 'case-sensitive', title: 'Text case & lists' }));
    el.append(sep(), cbtn('Effects', () => openPanel('effects'), { icon: 'wand-sparkles' }));
  } else if (k === 'image') {
    const img = a;
    el.append(cbtn('Edit photo', (e, b) => {
      const m = h('div', { style: { width: '300px' } }, h('div', { style: { fontWeight: 800, marginBottom: '8px' } }, 'AI tools'));
      for (const t of TOOLS) m.append(h('div.ai-card', { on: { click: () => { closePopover(); runStudio(img, t.mode); } } }, h('div.qi', { html: ico(t.icon) }), h('div', h('b', t.name), h('span', t.text))));
      popover(b, m);
    }, { icon: 'sparkles', cls: 'accent' }));
    el.append(cbtn('Adjust', () => openPanel('adjust'), { icon: 'sliders-horizontal' }));
    el.append(cbtn('Crop', () => startCrop(E, img, { onEnd: (applied) => { if (applied && img.ro2Frame) { applyFrame(img, img.ro2Frame); E.canvas.requestRenderAll(); E.commit(); } renderCtx(); } }).then(renderCtx), { icon: 'crop' }));
    el.append(cbtn('Frame', (e, b) => popover(b, h('div', { style: { width: '290px' } }, h('div', { style: { fontWeight: 800, marginBottom: '8px' } }, 'Shape this photo'), framesGrid((id) => { applyFrame(img, id); E.canvas.requestRenderAll(); E.commit(); closePopover(); }, img.ro2Frame))), { icon: 'square-dashed-bottom' }));
    el.append(cbtn('Flip', (e, b) => menu(b, [{ label: 'Flip horizontal', icon: 'flip-horizontal-2', run: () => E.flip('x') }, { label: 'Flip vertical', icon: 'flip-vertical-2', run: () => E.flip('y') }]), { icon: 'flip-horizontal-2' }));
    el.append(cbtn('Effects', () => openPanel('effects'), { icon: 'wand-sparkles' }));
    if (img.ro2Role === 'bgimage') el.append(cbtn('Detach background', () => detachBackground(img), { icon: 'move' }));
    else el.append(cbtn('', () => setAsBackground(img), { icon: 'image-upscale', title: 'Set as page background' }));
    if (img.ro2Credit) el.append(cbtn('', (e, b) => { const c = img.ro2Credit; popover(b, h('div', { style: { width: '280px' } }, h('b', c.title || 'Photo'), h('p.small.muted', `By ${c.creator || 'unknown'} · ${c.license || ''}${c.source ? ' · via ' + c.source : ''}`), h('div', { style: { display: 'flex', gap: '6px' } }, h('button.btn.sm', { on: { click: () => { navigator.clipboard.writeText(`Photo: “${c.title || 'Untitled'}” by ${c.creator || 'unknown'}, ${c.license || ''}${c.url ? ' (' + c.url + ')' : ''}`); toast('Credit copied'); } } }, 'Copy credit'), c.url ? h('button.btn.sm.ghost', { on: { click: () => window.ro2.shell.open(c.url) } }, 'Open source') : null))); }, { icon: 'info', title: 'Photo credit' }));
  } else if (k === 'line') {
    el.append(colorDot(a.lineColor, (v, f) => applyFill(list, v, f), { title: 'Line colour', noGradient: true }));
    el.append(cbtn('Line style', (e, b) => popover(b, lineStyle(a)), { icon: 'spline' }));
    el.append(sep(), cbtn('Effects', () => openPanel('effects'), { icon: 'wand-sparkles' }));
  } else if (k === 'shape' || k === 'icon') {
    const cs = colorsOf(a);
    if (k === 'icon') el.append(colorDot(cs[0]?.value || '#1b1f23', (v, f) => { if (typeof v !== 'string') return; list.forEach((o) => { (o._objects || [o]).forEach((x) => x.set({ stroke: v })); o.dirty = true; }); E.canvas.requestRenderAll(); if (f) E.commit(); }, { title: 'Icon colour', noGradient: true }));
    else el.append(colorDot(fillOf(a), (v, f) => applyFill(list.filter((o) => kindOf(o) === 'shape'), v, f), { title: 'Fill colour', allowNone: true }));
    if (k === 'shape') el.append(colorDot(a.strokeWidth ? a.stroke : 'rgba(0,0,0,0)', (v, f) => { if (typeof v !== 'string') return; list.forEach((o) => { o.set({ stroke: v, strokeUniform: true }); if (!o.strokeWidth) o.set({ strokeWidth: Math.max(2, Math.min(E.W, E.H) / 150) }); o.dirty = true; }); E.canvas.requestRenderAll(); if (f) E.commit(); }, { title: 'Border colour', kind: 'stroke', noGradient: true }));
    el.append(sep(), cbtn('Effects', () => openPanel('effects'), { icon: 'wand-sparkles' }));
  } else if (k === 'group') {
    const cs = colorsOf(a);
    cs.forEach((c) => el.append(colorDot(c.value, (v, f) => { if (typeof v !== 'string') return; setGroupColor(a, c.value, v.toLowerCase()); c.value = v.toLowerCase(); E.canvas.requestRenderAll(); if (f) E.commit(); }, { title: 'Colour', noGradient: true })));
    if (cs.length) el.append(sep());
    el.append(cbtn('Ungroup', () => E.ungroup(), { icon: 'ungroup' }), cbtn('Effects', () => openPanel('effects'), { icon: 'wand-sparkles' }));
  } else if (k === 'multi') {
    el.append(cbtn('Group', () => E.group(), { icon: 'group', title: `Group (${MOD}G)` }));
    el.append(cbtn('Align', (e, b) => popover(b, alignBox()), { icon: 'align-center-vertical' }));
    const shapes = list.filter((o) => kindOf(o) === 'shape');
    if (shapes.length === list.length) el.append(colorDot(fillOf(shapes[0]), (v, f) => applyFill(shapes, v, f), { title: 'Fill colour' }));
    const texts = list.filter((o) => kindOf(o) === 'text');
    if (texts.length === list.length) el.append(colorDot(fillOf(texts[0]), (v, f) => applyFill(texts, v, f), { title: 'Text colour', kind: 'text' }));
    el.append(cbtn('Effects', () => openPanel('effects'), { icon: 'wand-sparkles' }));
  }
  // common
  el.append(sep());
  el.append(cbtn('Position', () => openPanel('position'), { icon: 'move' }));
  el.append(cbtn('', (e, b) => {
    const cur = Math.round((a.opacity ?? 1) * 100);
    popover(b, h('div', { style: { width: '240px' } }, slider('Transparency', { min: 0, max: 100, value: cur, fmt: (v) => v + '%', onInput: (v) => { list.forEach((o) => o.set({ opacity: v / 100 })); if (a instanceof fabric.ActiveSelection) a.set({ opacity: 1 }); E.canvas.requestRenderAll(); }, onChange: () => E.commit() })));
  }, { icon: 'blend', title: 'Transparency' }));
  const locked = list.every((o) => o.ro2Locked);
  el.append(cbtn('', () => { E.toggleLock(); renderCtx(); }, { icon: locked ? 'lock' : 'lock-open', title: locked ? 'Unlock' : 'Lock', on: locked }));
  function caseAll(fn) { textList().forEach((o) => { o.set({ text: fn(o.text) }); o.initDimensions(); }); E.canvas.requestRenderAll(); E.commit(); }
  function listAll() { textList().forEach((o) => { const lines = o.text.split('\n'); const on = lines.every((l) => l.startsWith('• ')); o.set({ text: lines.map((l) => (on ? l.replace(/^• /, '') : '• ' + l.replace(/^• /, ''))).join('\n') }); o.initDimensions(); }); E.canvas.requestRenderAll(); E.commit(); }
}
function lineStyle(a) {
  const E = ed(); const list = E.selected().filter((o) => o instanceof Ro2Line);
  const set = (p) => { list.forEach((o) => { o.set(p); o.setCoords(); }); E.canvas.requestRenderAll(); };
  const caps = [{ value: 'none', label: 'None' }, { value: 'arrow', icon: 'chevron-right' }, { value: 'triangle', icon: 'triangle' }, { value: 'circle', icon: 'circle' }, { value: 'bar', icon: 'minus' }];
  return h('div', { style: { width: '280px' } },
    slider('Thickness', { min: 1, max: Math.max(40, Math.round(Math.min(E.W, E.H) / 30)), value: a.lineWidth, onInput: (v) => set({ lineWidth: v }), onChange: () => E.commit() }),
    h('div.sec', h('h4', 'Style')), seg([{ value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }, { value: 'dotted', label: 'Dotted' }], a.dash, (v) => { set({ dash: v }); E.commit(); }, { block: true }),
    h('div.sec', h('h4', 'Start')), seg(caps, a.startCap, (v) => { set({ startCap: v }); E.commit(); }, { block: true }),
    h('div.sec', h('h4', 'End')), seg(caps, a.endCap, (v) => { set({ endCap: v }); E.commit(); }, { block: true }));
}
function alignBox() {
  const E = ed(); const b = (k, icon, t) => h('button.btn.icon', { title: t, html: ico(icon), on: { click: () => E.align(k) } });
  const n = E.selected().length;
  return h('div', h('div', { style: { display: 'flex', gap: '4px' } }, b('left', 'align-start-vertical', 'Left'), b('hcenter', 'align-center-vertical', 'Centre'), b('right', 'align-end-vertical', 'Right'), b('top', 'align-start-horizontal', 'Top'), b('vcenter', 'align-center-horizontal', 'Middle'), b('bottom', 'align-end-horizontal', 'Bottom')),
    n >= 3 ? h('div', { style: { display: 'flex', gap: '4px', marginTop: '6px' } }, h('button.btn.sm', { html: ico('align-horizontal-space-around') + '<span>Space across</span>', on: { click: () => E.distribute('h') } }), h('button.btn.sm', { html: ico('align-vertical-space-around') + '<span>Space down</span>', on: { click: () => E.distribute('v') } })) : null);
}
function renderCrop(el) {
  const c = ed().cropping;
  el.append(h('span', { style: { fontWeight: 800, padding: '0 8px' } }, 'Crop'));
  for (const [label, r] of [['Free', null], ['Original', 'original'], ['1:1', 1], ['4:5', 4 / 5], ['3:4', 3 / 4], ['16:9', 16 / 9], ['9:16', 9 / 16], ['3:2', 3 / 2]]) el.append(cbtn(label, () => c.setRatio(r)));
  el.append(sep(), cbtn('Reset', () => c.reset(), { icon: 'rotate-ccw' }), h('div', { style: { flex: 1 } }), cbtn('Cancel', () => c.cancel()), h('button.btn.primary.sm', { html: ico('check') + '<span>Done</span>', on: { click: () => c.done() } }));
}

// ───── floating toolbar over the selection ─────
export function placeFloat() {
  const f = document.getElementById('floatbar'); const E = ed();
  const a = E && E.active();
  if (!a || E.cropping || app.transforming || (a.isEditing)) { f.classList.add('hidden'); return; }
  const r = E.screenRect(a); const host = document.getElementById('canvasHost');
  f.innerHTML = '';
  const fb = (icon, title, fn, cls) => { const b = h('button' + (cls ? '.' + cls : ''), { title, html: ico(icon), on: { click: fn } }); f.append(b); };
  if (kindOf(a) === 'image' && !a.ro2Locked) fb('sparkles', 'AI tools', (e) => document.querySelector('#ctxbar .cb-btn.accent')?.click(), 'ai');
  fb(a.ro2Locked ? 'lock' : 'lock-open', a.ro2Locked ? 'Unlock' : 'Lock', () => { E.toggleLock(); renderCtx(); placeFloat(); });
  fb('copy-plus', `Duplicate (${MOD}D)`, () => E.duplicate());
  fb('trash-2', 'Delete', () => E.remove());
  fb('ellipsis', 'More', (e) => contextMenu({ x: e.clientX, y: e.clientY }));
  f.classList.remove('hidden');
  const top = host.offsetTop + r.y - 48; const x = host.offsetLeft + r.x + r.w / 2;
  f.style.left = Math.max(120, Math.min(host.offsetLeft + host.clientWidth - 120, x)) + 'px';
  f.style.top = (top < host.offsetTop + 6 ? host.offsetTop + Math.min(host.clientHeight - 50, r.y + r.h + 46) : top) + 'px';
}

export function contextMenu(at) {
  const E = ed(); const a = E.active(); const k = kindOf(a);
  if (!a) return menu(at, [
    { label: 'Paste', icon: 'clipboard-paste', key: MOD + 'V', run: () => document.execCommand('paste') || E.paste() },
    { label: 'Select all', icon: 'square-dashed-mouse-pointer', key: MOD + 'A', run: () => E.selectAll() },
    '-', { label: 'Add page', icon: 'file-plus-2', run: () => E.addPage() }, { label: 'Duplicate page', icon: 'copy', run: () => E.addPage(E.page, true) },
    { label: 'Background…', icon: 'paint-bucket', run: () => openPanel('background') },
  ]);
  menu(at, [
    { label: 'Copy', icon: 'copy', key: MOD + 'C', run: () => E.copy() }, { label: 'Paste', icon: 'clipboard-paste', key: MOD + 'V', run: () => E.paste() },
    { label: 'Duplicate', icon: 'copy-plus', key: MOD + 'D', run: () => E.duplicate() }, { label: 'Delete', icon: 'trash-2', key: '⌫', run: () => E.remove(), danger: true },
    '-',
    { label: 'Bring forward', icon: 'chevron-up', key: MOD + ']', run: () => E.bringForward() }, { label: 'Bring to front', icon: 'chevrons-up', run: () => E.bringToFront() },
    { label: 'Send backward', icon: 'chevron-down', key: MOD + '[', run: () => E.sendBackward() }, { label: 'Send to back', icon: 'chevrons-down', run: () => E.sendToBack() },
    '-',
    k === 'multi' ? { label: 'Group', icon: 'group', key: MOD + 'G', run: () => E.group() } : null,
    k === 'group' ? { label: 'Ungroup', icon: 'ungroup', key: MOD + '⇧G', run: () => E.ungroup() } : null,
    { label: a.ro2Locked ? 'Unlock' : 'Lock', icon: a.ro2Locked ? 'lock-open' : 'lock', run: () => { E.toggleLock(); renderCtx(); } },
    { label: 'Align to page centre', icon: 'align-center-vertical', run: () => { E.align('hcenter'); E.align('vcenter'); } },
    k === 'image' ? '-' : null,
    k === 'image' ? { label: 'Remove background', icon: 'scissors', run: () => runStudio(a, 'removebg') } : null,
    k === 'image' ? { label: 'Magic eraser', icon: 'eraser', run: () => runStudio(a, 'erase') } : null,
    k === 'image' ? { label: a.ro2Role === 'bgimage' ? 'Detach from background' : 'Set as background', icon: 'image-upscale', run: () => (a.ro2Role === 'bgimage' ? detachBackground(a) : setAsBackground(a)) } : null,
    '-', { label: 'Copy as PNG', icon: 'image-down', key: MOD + '⇧C', run: () => import('./modals/export.js').then((m) => m.copyPng(true)) },
  ]);
}
export { refresh, currentPanel };
