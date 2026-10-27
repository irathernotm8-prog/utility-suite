// Export: PNG, JPG, WebP, SVG or PDF, at any size; one page or all of them. Also Copy as PNG.
import { h, modal, btn, toggle, slider, toast, toastErr, busy, fmtBytes, seg } from '../ui.js';
import { app } from '../app.js';
import { pageCanvas, toBlob, pageSvg, selectionCanvas, thumb } from '../editor/render.js';
import { isClear } from '../editor/editor.js';

const FORMATS = [
  { id: 'png', name: 'PNG', note: 'Best quality', mime: 'image/png' },
  { id: 'jpg', name: 'JPG', note: 'Small photos', mime: 'image/jpeg' },
  { id: 'webp', name: 'WebP', note: 'Web, small', mime: 'image/webp' },
  { id: 'svg', name: 'SVG', note: 'Vector', mime: 'image/svg+xml' },
  { id: 'pdf', name: 'PDF', note: 'Print, share', mime: 'application/pdf' },
];
const MAX_PIXELS = 16384 * 16384 / 2;

export function openExport() {
  const ed = app.editor; const s = app.settings;
  let fmt = s.exportFormat || 'png', scale = s.exportScale || 1, quality = s.jpgQuality || 0.92, all = ed.doc.pages.length > 1 ? false : false;
  let transparent = isClear(ed.pageData.bg?.color) && !ed.pageData.bg?.gradient;
  const prev = h('div.export-preview', h('img'));
  thumb(ed, ed.page, 480).then((u) => { prev.querySelector('img').src = u; });
  const fgrid = h('div.fmt-grid'); const opts = h('div');
  const drawFmts = () => { fgrid.innerHTML = ''; for (const f of FORMATS) fgrid.append(h('div.fmt' + (f.id === fmt ? '.on' : ''), { on: { click: () => { fmt = f.id; drawFmts(); drawOpts(); } } }, h('b', f.name), h('span', f.note))); };
  const sizeText = () => `${Math.round(ed.W * scale)} × ${Math.round(ed.H * scale)} px`;
  const drawOpts = () => {
    opts.innerHTML = '';
    const raster = ['png', 'jpg', 'webp'].includes(fmt);
    if (raster) {
      const st = h('span.small.muted', sizeText());
      opts.append(h('div.form-row', h('label', 'Size'), st));
      opts.append(seg([0.5, 1, 1.5, 2, 3, 4].map((v) => ({ value: v, label: v + '×' })), scale, (v) => { scale = v; st.textContent = sizeText(); }, { block: true }));
      if (fmt !== 'jpg') opts.append(h('div.form-row', toggle('Transparent background', transparent, (v) => { transparent = v; }), h('span.small.dim', fmt === 'png' ? 'For logos & cut-outs' : '')));
      if (fmt !== 'png') opts.append(slider('Quality', { min: 40, max: 100, value: Math.round(quality * 100), fmt: (v) => v + '%', onInput: (v) => { quality = v / 100; } }));
    } else if (fmt === 'svg') opts.append(h('p.small.muted', 'Shapes, text and lines stay sharp at any size; fonts are embedded. Photos are included as they are.'));
    else opts.append(h('p.small.muted', `A vector PDF (${ed.W} × ${ed.H} px pages) with text and shapes kept sharp. ${ed.doc.pages.length > 1 ? 'Every page goes into one file.' : ''}`));
    if (ed.doc.pages.length > 1 && fmt !== 'pdf') opts.append(h('div.form-row', h('label', 'Pages'), seg([{ value: false, label: `This page (${ed.page + 1})` }, { value: true, label: `All ${ed.doc.pages.length}` }], all, (v) => { all = v; })));
  };
  drawFmts(); drawOpts();
  const m = modal({
    title: 'Export', body: [prev, h('div.sec', h('h4', 'File type')), fgrid, opts],
    foot: [h('div.left', btn('Copy PNG', () => { m.close(); copyPng(false); }, { icon: 'clipboard-copy', cls: 'ghost' })), btn('Cancel', () => m.close(), { cls: 'ghost' }), btn('Export', () => { m.close(); run(); }, { cls: 'primary', icon: 'download' })],
  });
  async function run() {
    window.ro2.settings.set({ exportFormat: fmt, exportScale: scale, jpgQuality: quality }); Object.assign(app.settings, { exportFormat: fmt, exportScale: scale, jpgQuality: quality });
    const name = ed.doc.name || 'Design';
    const pages = fmt === 'pdf' ? ed.doc.pages.map((_, i) => i) : all ? ed.doc.pages.map((_, i) => i) : [ed.page];
    const many = pages.length > 1 && fmt !== 'pdf';
    const target = await window.ro2.exporter.choose({ name, ext: fmt, many }); if (!target) return;
    const b = busy('Exporting…');
    try {
      if (fmt === 'pdf') {
        const svgs = []; for (const i of pages) { b.set(i / pages.length, `Page ${i + 1} of ${pages.length}`); svgs.push(await pageSvg(ed, i)); }
        const r = await window.ro2.exporter.pdf({ svgs, width: ed.W, height: ed.H, file: target });
        done(r.file, r.size);
      } else if (fmt === 'svg') {
        let last; for (const i of pages) { const svg = await pageSvg(ed, i, { transparent: false }); const bytes = new TextEncoder().encode(svg); last = many ? await window.ro2.exporter.writeIn(target, `${name}-${i + 1}.svg`, bytes) : (await window.ro2.exporter.write(target, bytes)).file; }
        done(last);
      } else {
        const f = FORMATS.find((x) => x.id === fmt);
        if (ed.W * scale * ed.H * scale > MAX_PIXELS) throw new Error('That size is too big to export. Pick a smaller size.');
        let last, size = 0;
        for (const i of pages) {
          b.set(pages.length > 1 ? i / pages.length : null, pages.length > 1 ? `Page ${i + 1} of ${pages.length}` : sizeText());
          const c = await pageCanvas(ed, i, { scale, transparent: fmt !== 'jpg' && transparent, background: fmt === 'jpg' ? '#ffffff' : null });
          const blob = await toBlob(c, f.mime, fmt === 'png' ? undefined : quality);
          const bytes = new Uint8Array(await blob.arrayBuffer()); size += bytes.length;
          last = many ? await window.ro2.exporter.writeIn(target, `${name}-${i + 1}.${fmt}`, bytes) : (await window.ro2.exporter.write(target, bytes)).file;
        }
        done(last, size);
      }
    } catch (e) { toastErr(e); } finally { b.close(); }
  }
  function done(file, size) { toast(`Exported${size ? ' · ' + fmtBytes(size) : ''}`, { action: { label: 'Show', run: () => window.ro2.shell.reveal(file) } }); }
}
export async function copyPng(selectionOnly) {
  const ed = app.editor; if (!ed) return;
  try {
    const c = selectionOnly && ed.selected().length ? await selectionCanvas(ed, 2) : await pageCanvas(ed, ed.page, { scale: Math.min(2, 4096 / Math.max(ed.W, ed.H)) });
    const blob = await toBlob(c, 'image/png');
    await window.ro2.exporter.copyPng(new Uint8Array(await blob.arrayBuffer()));
    toast(selectionOnly ? 'Selection copied as PNG' : 'Page copied as PNG. Paste it anywhere.');
  } catch (e) { toastErr(e); }
}
