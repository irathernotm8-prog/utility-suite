// Atrium — PDF export for reviews. Each website page becomes one full-length PDF page (desktop, tablet and/or
// phone), drawn exactly as the preview renders it. Numbered section labels sit in a left margin and a ruled notes
// column sits on the right, so feedback can say "Home §3: tighten the headline" and be written right beside it.
// A contents page lists every page. Long pages continue onto extra PDF pages.
'use strict';
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { slugify } = require('./core/site');

const DEVICES = { desktop: { w: 1440, s: 0.5, label: 'Desktop' }, tablet: { w: 834, s: 0.75, label: 'Tablet' }, phone: { w: 390, s: 1, label: 'Phone' } };
const MAX_H = 14000; // PDF pages top out at 14,400pt
const C = { ink: rgb(0.1, 0.1, 0.14), mut: rgb(0.45, 0.45, 0.52), line: rgb(0.86, 0.86, 0.9), faint: rgb(0.93, 0.93, 0.95), acc: rgb(0.31, 0.37, 0.94), accSoft: rgb(0.93, 0.94, 1), white: rgb(1, 1, 1) };

function stamp() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`; }

async function buildPdf({ siteName, items, devices = ['desktop'], labels = true, notes = true, capture, onStep = () => {} }) {
  const doc = await PDFDocument.create();
  doc.setTitle(`${siteName} — website review`); doc.setCreator('Atrium'); doc.setProducer('Atrium'); doc.setCreationDate(new Date());
  const font = await doc.embedFont(StandardFonts.Helvetica); const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const okCache = new Map();
  const safe = (s) => [...String(s ?? '').replace(/\s+/g, ' ')].map((ch) => { if (!okCache.has(ch)) { try { font.widthOfTextAtSize(ch, 10); okCache.set(ch, ch); } catch { const n = ch.normalize('NFKD').replace(/[^\x20-\x7e]/g, ''); okCache.set(ch, n || '?'); } } return okCache.get(ch); }).join('');
  const wrap = (text, f, size, maxW, maxLines = 3) => { const words = safe(text).split(' '); const lines = []; let cur = ''; for (const w of words) { const t = cur ? cur + ' ' + w : w; if (f.widthOfTextAtSize(t, size) <= maxW) cur = t; else { if (cur) lines.push(cur); cur = w; } } if (cur) lines.push(cur); if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,2}$/, '…'); } return lines; };

  const cover = doc.addPage([792, 612]); // contents page, filled in at the end
  const toc = [];
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  let n = 0; const total = items.length * devices.length;
  for (const it of items) for (const dev of devices) {
    const D = DEVICES[dev] || DEVICES.desktop; n++;
    onStep(`Capturing ${it.title} · ${D.label} (${n}/${total})…`);
    const cap = await capture.captureForPdf(it.url, { width: D.w });
    const s = D.s; const P = 24, H = 54, G = labels ? 150 : 0, N = notes ? 200 : 0;
    const imgW = D.w * s; const pageW = P + G + imgW + (N ? 16 + N : 0) + P;
    const secs = (cap.sections || []).map((x, i) => ({ ...x, n: i + 1, name: it.names[x.id] || 'Section' }));
    // split very long pages into chunks of at most MAX_H points
    const chunkPx = Math.floor(MAX_H / s); const chunks = []; for (let y = 0; y < cap.height; y += chunkPx) chunks.push([y, Math.min(cap.height, y + chunkPx)]);
    let firstPageIndex = null;
    for (let ci = 0; ci < chunks.length; ci++) {
      const [c0, c1] = chunks[ci]; const bodyH = (c1 - c0) * s; const pageH = H + bodyH + P;
      const pg = doc.addPage([pageW, pageH]); if (firstPageIndex == null) firstPageIndex = doc.getPageCount();
      const X = P + G; const top = pageH - H; // y of the image's top edge (PDF y goes up)
      const meta = safe(`${it.file}  ·  ${D.label} ${D.w}px  ·  ${date}`); const mw = font.widthOfTextAtSize(meta, 8.5);
      // the page itself
      for (const sl of cap.slices) {
        if (sl.y + sl.h <= c0 || sl.y >= c1) continue;
        const img = await doc.embedJpg(sl.jpeg);
        // slices never straddle a chunk unless chunk edges fall mid-slice; clip by drawing inside the chunk window
        const yTop = top - (sl.y - c0) * s;
        pg.drawImage(img, { x: X, y: yTop - sl.h * s, width: imgW, height: sl.h * s });
      }
      // trim any slice that crosses the chunk edge, then draw the header on top
      pg.drawRectangle({ x: X - 1, y: 0, width: imgW + 2, height: P, color: C.white });
      pg.drawRectangle({ x: X - 1, y: top, width: imgW + 2, height: H, color: C.white });
      pg.drawText(safe(it.title) + (chunks.length > 1 ? `  (part ${ci + 1} of ${chunks.length})` : ''), { x: P, y: pageH - 40, size: 15, font: bold, color: C.ink });
      pg.drawText(safe(siteName).toUpperCase(), { x: P, y: pageH - 22, size: 7.5, font: bold, color: C.mut });
      pg.drawText(meta, { x: pageW - P - mw, y: pageH - 38, size: 8.5, font, color: C.mut });
      pg.drawLine({ start: { x: P, y: top + 8 }, end: { x: pageW - P, y: top + 8 }, thickness: 0.6, color: C.line });
      pg.drawRectangle({ x: X, y: top - bodyH, width: imgW, height: bodyH, borderColor: C.line, borderWidth: 0.6 });
      // notes column: ruled lines, section boundaries carried across
      if (N) {
        const NX = X + imgW + 16;
        pg.drawText('NOTES', { x: NX, y: top - 12, size: 7.5, font: bold, color: C.mut });
        for (let y = top - 30; y > top - bodyH + 4; y -= 22) pg.drawLine({ start: { x: NX, y }, end: { x: NX + N, y }, thickness: 0.4, color: C.faint });
      }
      // section labels
      if (G) for (const sec of secs) {
        if (sec.top + 4 < c0 || sec.top >= c1) continue;
        const y = top - (sec.top - c0) * s;
        pg.drawLine({ start: { x: P, y }, end: { x: X - 4, y }, thickness: 0.6, color: C.line });
        if (N) pg.drawLine({ start: { x: X + imgW + 16, y }, end: { x: X + imgW + 16 + N, y }, thickness: 0.6, color: C.line });
        const tag = `§${sec.n}`; const tw = bold.widthOfTextAtSize(tag, 8.5);
        pg.drawRectangle({ x: P, y: y - 17, width: tw + 10, height: 13, color: C.accSoft });
        pg.drawText(tag, { x: P + 5, y: y - 13.5, size: 8.5, font: bold, color: C.acc });
        wrap(sec.name, font, 8.5, G - 14, Math.max(1, Math.min(3, Math.floor((sec.height * s - 18) / 11)))).forEach((l, i) => pg.drawText(l, { x: P, y: y - 29 - i * 11, size: 8.5, font, color: C.ink }));
      }
      // footer page number
      const pn = `${doc.getPageCount()}`; pg.drawText(pn, { x: pageW - P - font.widthOfTextAtSize(pn, 7.5), y: 9, size: 7.5, font, color: C.mut });
    }
    toc.push({ title: it.title, file: it.file, device: D.label, page: firstPageIndex, sections: secs.length });
  }

  // contents page
  const W = 792, Hc = 612, M = 54;
  cover.drawRectangle({ x: 0, y: Hc - 8, width: W, height: 8, color: C.acc });
  cover.drawText('WEBSITE REVIEW', { x: M, y: Hc - 70, size: 9, font: bold, color: C.acc });
  wrap(siteName, bold, 30, W - 2 * M, 2).forEach((l, i) => cover.drawText(l, { x: M, y: Hc - 108 - i * 34, size: 30, font: bold, color: C.ink }));
  cover.drawText(safe(`${date}  ·  ${items.length} page${items.length === 1 ? '' : 's'}  ·  ${devices.map((d) => (DEVICES[d] || DEVICES.desktop).label).join(', ')}`), { x: M, y: Hc - 140 - (siteName.length > 40 ? 34 : 0), size: 10.5, font, color: C.mut });
  let y = Hc - 190; const col = (t, x, f = font, c = C.ink, sz = 10) => cover.drawText(safe(t), { x, y, size: sz, font: f, color: c });
  col('PAGE', M, bold, C.mut, 7.5); col('VIEW', M + 300, bold, C.mut, 7.5); col('SECTIONS', M + 400, bold, C.mut, 7.5); col('PDF PAGE', M + 490, bold, C.mut, 7.5); y -= 8;
  cover.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: C.line }); y -= 16;
  for (const t of toc) { if (y < 70) break; col(wrap(t.title, font, 10, 280, 1)[0] || '', M); col(t.device, M + 300, font, C.mut); col(String(t.sections), M + 400, font, C.mut); col(String(t.page), M + 490, bold, C.acc); y -= 18; }
  cover.drawText(safe('Sections are numbered on every page (§1, §2…). Point to them in feedback, e.g. "Home §3: shorter headline", or write in the notes column beside each section.'), { x: M, y: 40, size: 8.5, font, color: C.mut, maxWidth: W - 2 * M, lineHeight: 11 });
  return Buffer.from(await doc.save());
}

// pages: 'all' | 'current' handled by the caller → list of slugs; posts: include blog posts
async function exportPdf({ site, preview, capture, opts = {}, onStep }) {
  const d = site.data; const names = {}; for (const x of site.allSections()) names[x.section.id] = x.section.name;
  let pages = d.pages; if (Array.isArray(opts.pages) && opts.pages.length) pages = opts.pages.map((r) => site.page(r));
  const items = pages.map((p) => ({ title: p.title, file: p.slug === 'index' ? 'index.html' : `${p.slug}.html`, url: preview.pageUrl(site, p.id), names }));
  if (opts.posts) for (const p of d.posts.filter((x) => !x.draft)) items.push({ title: p.title, file: `blog/${p.slug}.html`, url: preview.url(`blog/${p.slug}.html`), names });
  const devices = (Array.isArray(opts.devices) ? opts.devices : [opts.device || 'desktop']).flatMap((x) => (x === 'all' ? ['desktop', 'tablet', 'phone'] : x === 'both' ? ['desktop', 'phone'] : [x])).filter((x) => DEVICES[x]);
  if (!devices.length) devices.push('desktop');
  const buf = await buildPdf({ siteName: d.settings.name || d.name, items, devices, labels: opts.labels !== false, notes: opts.notes !== false, capture, onStep });
  const dir = opts.dest || site.p('exports'); fs.mkdirSync(dir, { recursive: true });
  const base = `${slugify(d.name) || 'site'} review ${stamp()}`; let file = path.join(dir, base + '.pdf'); for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `${base} (${i}).pdf`);
  fs.writeFileSync(file, buf);
  return { path: file, format: 'pdf', count: items.length * devices.length, pages: items.length, devices, bytes: buf.length, notes: [] };
}

module.exports = { exportPdf, buildPdf, DEVICES };
