// Onward — documents: read text out of resumes/certificates, and write tailored resumes
// and cover letters as PDF (Chromium print) + DOCX (docx package).
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

// ---------- reading ----------
const TEXT_EXT = ['.txt', '.md', '.markdown', '.rtf', '.json'];
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic'];

async function extractText(file) {
  const ext = path.extname(file).toLowerCase();
  try {
    if (TEXT_EXT.includes(ext)) return clean(fs.readFileSync(file, 'utf8'));
    if (ext === '.docx') {
      const mammoth = require('mammoth');
      const { value } = await mammoth.extractRawText({ path: file });
      return clean(value);
    }
    if (ext === '.pdf') return clean(await pdfText(file));
  } catch (e) {
    console.error('extractText', file, e.message);
  }
  return '';
}

async function pdfText(file) {
  const pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true, disableFontFace: true, verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= Math.min(doc.numPages, 30); i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    // Rebuild lines from positioned text runs
    let line = '', lastY = null, out = [];
    for (const it of tc.items) {
      const y = it.transform ? Math.round(it.transform[5]) : lastY;
      if (lastY !== null && y !== lastY && line.trim()) { out.push(line.trim()); line = ''; }
      line += it.str + (it.hasEOL ? '\n' : '');
      lastY = y;
    }
    if (line.trim()) out.push(line.trim());
    pages.push(out.join('\n'));
  }
  try { await doc.destroy(); } catch {}
  return pages.join('\n\n');
}

// Tidy extracted text: plain dashes/quotes, and re-join letter-spaced headings ("S U M M A R Y")
const clean = (s) => String(s || '')
  .replace(/[\u2010-\u2015\u2212]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\u00A0/g, ' ')
  .replace(/\b(?:[A-Z] ){2,}[A-Z]{1,2}\b/g, (m) => m.replace(/ /g, ''))
  .replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const isImage = (file) => IMAGE_EXT.includes(path.extname(file).toLowerCase());

// ---------- normalising what Claude sends ----------
function normResume(r = {}, profile = {}) {
  const arr = (x) => Array.isArray(x) ? x : (x ? [x] : []);
  const contact = r.contact || {};
  const links = arr(contact.links).length ? arr(contact.links) : Object.entries(profile.links || {}).filter(([, v]) => v).map(([k, v]) => ({ label: k[0].toUpperCase() + k.slice(1), url: v }));
  return {
    name: r.name || profile.name || '',
    headline: r.headline || '',
    contact: {
      email: contact.email || profile.email || '',
      phone: contact.phone || profile.phone || '',
      location: contact.location || profile.location || '',
      links: links.map(l => typeof l === 'string' ? { label: '', url: l } : l)
    },
    summary: r.summary || '',
    experience: arr(r.experience).map(e => ({ ...e, bullets: arr(e.bullets) })),
    projects: arr(r.projects).map(p => ({ ...p, bullets: arr(p.bullets) })),
    education: arr(r.education),
    certifications: arr(r.certifications).map(c => typeof c === 'string' ? { name: c } : c),
    skills: arr(r.skills).map(s => typeof s === 'string' ? { group: '', items: [s] } : { group: s.group || '', items: arr(s.items) }),
    extra: arr(r.extra).map(x => ({ heading: x.heading || '', items: arr(x.items) })),
    sectionOrder: arr(r.sectionOrder)
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dates = (a, b) => [a, b].filter(Boolean).join(' – ');
const prettyUrl = (u) => String(u || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

// Skills: merge single-item ungrouped entries into one line
function skillLines(skills) {
  const loose = skills.filter(s => !s.group).flatMap(s => s.items);
  const grouped = skills.filter(s => s.group);
  return [...grouped.map(s => ({ group: s.group, text: s.items.join(', ') })), ...(loose.length ? [{ group: '', text: loose.join(' · ') }] : [])];
}

const DEFAULT_ORDER = ['summary', 'experience', 'projects', 'skills', 'education', 'certifications', 'extra'];
function order(r) {
  const o = r.sectionOrder.filter(s => DEFAULT_ORDER.includes(s));
  return [...o, ...DEFAULT_ORDER.filter(s => !o.includes(s))];
}

// ---------- HTML (for PDF + preview) ----------
function resumeHtml(r, { letter = true } = {}) {
  const c = r.contact;
  const contactBits = [c.email, c.phone, c.location, ...c.links.map(l => prettyUrl(l.url))].filter(Boolean).map(esc).join('<span class="dot">•</span>');
  const sec = {
    summary: () => r.summary ? `<section><h2>Summary</h2><p>${esc(r.summary)}</p></section>` : '',
    experience: () => r.experience.length ? `<section><h2>Experience</h2>${r.experience.map(e => `
      <div class="item"><div class="row"><div><b>${esc(e.title)}</b>${e.company ? `<span class="at">, ${esc(e.company)}</span>` : ''}</div><div class="when">${esc(dates(e.start, e.end))}</div></div>
      ${e.location ? `<div class="sub">${esc(e.location)}</div>` : ''}
      ${e.bullets.length ? `<ul>${e.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}</div>`).join('')}</section>` : '',
    projects: () => r.projects.length ? `<section><h2>Projects</h2>${r.projects.map(p => `
      <div class="item"><div class="row"><div><b>${esc(p.name)}</b>${p.description ? `<span class="at"> — ${esc(p.description)}</span>` : ''}</div><div class="when">${esc(p.date || '')}</div></div>
      ${p.bullets.length ? `<ul>${p.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}</div>`).join('')}</section>` : '',
    skills: () => r.skills.length ? `<section><h2>Skills</h2>${skillLines(r.skills).map(s => `<p class="skill">${s.group ? `<b>${esc(s.group)}:</b> ` : ''}${esc(s.text)}</p>`).join('')}</section>` : '',
    education: () => r.education.length ? `<section><h2>Education</h2>${r.education.map(e => `
      <div class="item"><div class="row"><div><b>${esc([e.degree, e.field].filter(Boolean).join(', '))}</b>${e.school ? `<span class="at">, ${esc(e.school)}</span>` : ''}</div><div class="when">${esc(dates(e.start, e.end || e.date))}</div></div>
      ${e.details ? `<div class="sub">${esc(e.details)}</div>` : ''}</div>`).join('')}</section>` : '',
    certifications: () => r.certifications.length ? `<section><h2>Certifications</h2><ul class="certs">${r.certifications.map(x => `<li><b>${esc(x.name)}</b>${x.issuer ? ` — ${esc(x.issuer)}` : ''}${x.date ? ` <span class="when">(${esc(x.date)})</span>` : ''}</li>`).join('')}</ul></section>` : '',
    extra: () => r.extra.map(x => `<section><h2>${esc(x.heading)}</h2><ul>${x.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></section>`).join('')
  };
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: ${letter ? 'Letter' : 'A4'}; margin: 0.55in 0.6in; }
    * { box-sizing: border-box; }
    body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: #1b1d21; font-size: 10.2pt; line-height: 1.38; margin: 0; }
    header { margin-bottom: 10pt; }
    h1 { font-size: 21pt; letter-spacing: -0.2pt; margin: 0; font-weight: 700; }
    .headline { color: #444a55; font-size: 11pt; margin-top: 1pt; }
    .contact { color: #4a505b; font-size: 9.2pt; margin-top: 4pt; }
    .dot { color: #b0b5be; margin: 0 5pt; }
    h2 { font-size: 10pt; text-transform: uppercase; letter-spacing: 0; color: #c2462a; margin: 12pt 0 5pt; padding-bottom: 2pt; border-bottom: 0.75pt solid #e3e5e9; }
    p { margin: 0 0 3pt; }
    .item { margin-bottom: 7pt; page-break-inside: avoid; }
    .row { display: flex; justify-content: space-between; gap: 12pt; }
    .at { color: #333; }
    .when { color: #6a707b; white-space: nowrap; font-size: 9.2pt; }
    .sub { color: #6a707b; font-size: 9.2pt; }
    ul { margin: 3pt 0 0; padding-left: 13pt; }
    li { margin-bottom: 1.5pt; }
    ul.certs { padding-left: 13pt; }
    .skill { margin-bottom: 2pt; }
  </style></head><body>
    <header><h1>${esc(r.name)}</h1>${r.headline ? `<div class="headline">${esc(r.headline)}</div>` : ''}<div class="contact">${contactBits}</div></header>
    ${order(r).map(k => sec[k]()).join('')}
  </body></html>`;
}

function letterHtml({ text, profile, company, title, date }, { letter = true } = {}) {
  const paras = String(text || '').split(/\n\s*\n/).map(p => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`).join('');
  const contact = [profile.email, profile.phone, profile.location].filter(Boolean).map(esc).join('<span class="dot">•</span>');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: ${letter ? 'Letter' : 'A4'}; margin: 0.9in 1in; }
    body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: #1b1d21; font-size: 10.8pt; line-height: 1.55; margin: 0; }
    h1 { font-size: 17pt; margin: 0; } .contact { color: #4a505b; font-size: 9.4pt; margin: 3pt 0 22pt; } .dot { color: #b0b5be; margin: 0 5pt; }
    .meta { color: #4a505b; margin-bottom: 16pt; } p { margin: 0 0 10pt; }
  </style></head><body>
    <h1>${esc(profile.name || '')}</h1><div class="contact">${contact}</div>
    <div class="meta">${esc(date)}${company ? `<br>${esc(company)}` : ''}${title ? `<br>Re: ${esc(title)}` : ''}</div>
    ${paras}
  </body></html>`;
}

// Chromium prints the HTML to PDF in a hidden window
async function htmlToPdf(html, outFile, tmpDir) {
  const { BrowserWindow } = require('electron');
  const tmp = path.join(tmpDir, 'print-' + Date.now() + '.html');
  fs.writeFileSync(tmp, html);
  const w = new BrowserWindow({ show: false, webPreferences: { javascript: false, offscreen: false } });
  try {
    await w.loadFile(tmp);
    const pdf = await w.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
    fs.writeFileSync(outFile, pdf);
  } finally {
    w.destroy();
    try { fs.unlinkSync(tmp); } catch {}
  }
  return outFile;
}

// ---------- DOCX ----------
async function resumeDocx(r, outFile, { letter = true } = {}) {
  const D = require('docx');
  const { Document, Packer, Paragraph, TextRun, TabStopType, BorderStyle, AlignmentType } = D;
  const ACCENT = 'C2462A', GREY = '6A707B';
  const pageW = letter ? 12240 : 11906, margin = 864; // 0.6in
  const right = pageW - margin * 2;
  const kids = [];
  const run = (text, o = {}) => new TextRun({ text: String(text ?? ''), font: 'Calibri', size: 20, ...o });
  const h2 = (t) => kids.push(new Paragraph({ spacing: { before: 220, after: 80 }, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E3E5E9', space: 2 } }, children: [run(t.toUpperCase(), { bold: true, size: 20, color: ACCENT })] }));
  const row = (left, when) => new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: right }], spacing: { before: 60 }, children: [...left, ...(when ? [run('\t' + when, { color: GREY, size: 18 })] : [])] });
  const bullet = (t) => kids.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 30 }, children: [run(t)] }));
  const c = r.contact;

  kids.push(new Paragraph({ children: [run(r.name, { bold: true, size: 40 })] }));
  if (r.headline) kids.push(new Paragraph({ children: [run(r.headline, { size: 22, color: '444A55' })] }));
  kids.push(new Paragraph({ spacing: { after: 120 }, children: [run([c.email, c.phone, c.location, ...c.links.map(l => prettyUrl(l.url))].filter(Boolean).join('  •  '), { size: 18, color: '4A505B' })] }));

  const sec = {
    summary: () => { if (r.summary) { h2('Summary'); kids.push(new Paragraph({ children: [run(r.summary)] })); } },
    experience: () => { if (!r.experience.length) return; h2('Experience'); for (const e of r.experience) {
      kids.push(row([run(e.title, { bold: true }), ...(e.company ? [run(', ' + e.company)] : [])], dates(e.start, e.end)));
      if (e.location) kids.push(new Paragraph({ children: [run(e.location, { color: GREY, size: 18 })] }));
      e.bullets.forEach(bullet);
    } },
    projects: () => { if (!r.projects.length) return; h2('Projects'); for (const p of r.projects) {
      kids.push(row([run(p.name, { bold: true }), ...(p.description ? [run(' — ' + p.description)] : [])], p.date || ''));
      p.bullets.forEach(bullet);
    } },
    skills: () => { if (!r.skills.length) return; h2('Skills'); for (const s of skillLines(r.skills)) kids.push(new Paragraph({ spacing: { after: 40 }, children: [...(s.group ? [run(s.group + ': ', { bold: true })] : []), run(s.text)] })); },
    education: () => { if (!r.education.length) return; h2('Education'); for (const e of r.education) {
      kids.push(row([run([e.degree, e.field].filter(Boolean).join(', '), { bold: true }), ...(e.school ? [run(', ' + e.school)] : [])], dates(e.start, e.end || e.date)));
      if (e.details) kids.push(new Paragraph({ children: [run(e.details, { color: GREY, size: 18 })] }));
    } },
    certifications: () => { if (!r.certifications.length) return; h2('Certifications'); for (const x of r.certifications) kids.push(new Paragraph({ bullet: { level: 0 }, children: [run(x.name, { bold: true }), ...(x.issuer ? [run(' — ' + x.issuer)] : []), ...(x.date ? [run(` (${x.date})`, { color: GREY })] : [])] })); },
    extra: () => { for (const x of r.extra) { h2(x.heading); x.items.forEach(bullet); } }
  };
  order(r).forEach(k => sec[k]());

  const doc = new Document({
    creator: r.name || 'Onward', title: (r.name || '') + ' — Resume',
    styles: { default: { document: { run: { font: 'Calibri', size: 20 } } } },
    sections: [{ properties: { page: { size: { width: pageW, height: letter ? 15840 : 16838 }, margin: { top: 792, bottom: 792, left: margin, right: margin } } }, children: kids }]
  });
  fs.writeFileSync(outFile, await Packer.toBuffer(doc));
  return outFile;
}

async function letterDocx({ text, profile, company, title, date }, outFile, { letter = true } = {}) {
  const { Document, Packer, Paragraph, TextRun } = require('docx');
  const run = (t, o = {}) => new TextRun({ text: String(t ?? ''), font: 'Calibri', size: 22, ...o });
  const kids = [
    new Paragraph({ children: [run(profile.name, { bold: true, size: 32 })] }),
    new Paragraph({ spacing: { after: 360 }, children: [run([profile.email, profile.phone, profile.location].filter(Boolean).join('  •  '), { size: 18, color: '4A505B' })] }),
    new Paragraph({ children: [run(date)] }),
    ...(company ? [new Paragraph({ children: [run(company)] })] : []),
    ...(title ? [new Paragraph({ spacing: { after: 280 }, children: [run('Re: ' + title)] })] : [new Paragraph({ spacing: { after: 280 }, children: [] })]),
    ...String(text || '').split(/\n\s*\n/).map(p => new Paragraph({ spacing: { after: 200, line: 300 }, children: [run(p.trim().replace(/\n/g, ' '))] }))
  ];
  const doc = new Document({ sections: [{ properties: { page: { size: { width: letter ? 12240 : 11906, height: letter ? 15840 : 16838 }, margin: { top: 1296, bottom: 1296, left: 1440, right: 1440 } } }, children: kids }] });
  fs.writeFileSync(outFile, await Packer.toBuffer(doc));
  return outFile;
}

module.exports = { extractText, isImage, normResume, resumeHtml, letterHtml, htmlToPdf, resumeDocx, letterDocx, IMAGE_EXT };
