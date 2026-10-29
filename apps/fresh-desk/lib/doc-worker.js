'use strict';
// Runs in a worker thread: turns documents into something the preview pane can show.
// Nothing here executes document code (no macros, formulas or scripts).
const {parentPort, workerData} = require('node:worker_threads');
const fs = require('node:fs/promises');

const MAX_ROWS = 300, MAX_COLS = 40, MAX_SLIDES = 60;

async function docx(file) {
  const mammoth = require('mammoth');
  const r = await mammoth.convertToHtml({path: file}, {
    // Keep images small enough to preview; skip anything huge.
    convertImage: mammoth.images.imgElement(async image => {
      const b64 = await image.read('base64');
      return b64.length > 3_000_000 ? {src: ''} : {src: `data:${image.contentType};base64,${b64}`};
    }),
  });
  return {type: 'html', html: r.value.slice(0, 4_000_000)};
}

function cellText(cell) {
  try { const t = cell.text; return t == null ? '' : String(t).slice(0, 300); } catch { return ''; }
}
async function xlsx(file) {
  const Excel = require('exceljs');
  const book = new Excel.Workbook();
  await book.xlsx.readFile(file);
  const sheets = book.worksheets.map(s => s.name).slice(0, 30);
  const sheet = book.worksheets[workerData.sheet || 0] || book.worksheets[0];
  const rows = [];
  if (sheet) {
    const cols = Math.min(MAX_COLS, sheet.columnCount || 0);
    for (let i = 1; i <= Math.min(sheet.rowCount, MAX_ROWS); i++) {
      const row = sheet.getRow(i), out = [];
      for (let c = 1; c <= cols; c++) out.push(cellText(row.getCell(c)));
      rows.push(out);
    }
    while (rows.length && rows[rows.length - 1].every(v => !v)) rows.pop();
  }
  return {type: 'table', rows, sheets, sheet: sheet?.name || '', truncated: (sheet?.rowCount || 0) > MAX_ROWS || (sheet?.columnCount || 0) > MAX_COLS};
}

const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
async function pptx(file) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  const names = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => +a.match(/(\d+)\.xml/)[1] - +b.match(/(\d+)\.xml/)[1]).slice(0, MAX_SLIDES);
  const slides = [];
  for (const n of names) {
    const xml = await zip.file(n).async('string');
    // Each <a:p> paragraph's runs joined; the first non-empty paragraph is the title.
    const paras = [...xml.matchAll(/<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g)].map(m => decode([...m[1].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(t => t[1]).join(''))).map(s => s.trim()).filter(Boolean);
    slides.push({title: paras[0] || '', lines: paras.slice(1, 14)});
  }
  return {type: 'slides', slides};
}

function rtf(text) {
  // Good enough for a preview: drop groups we can't show, control words and escapes.
  let t = text.replace(/\{\\\*[^{}]*\}/g, '').replace(/\{\\(fonttbl|colortbl|stylesheet|info)[\s\S]*?\}\s*\}/g, '');
  t = t.replace(/\\par[d]?\b ?/g, '\n').replace(/\\line\b ?/g, '\n').replace(/\\tab\b ?/g, '\t')
    .replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u(-?\d+)\??/g, (_, n) => String.fromCharCode((+n + 65536) % 65536))
    .replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '');
  return {type: 'text', text: t.trim().slice(0, 200000)};
}

async function run({file, ext}) {
  if (ext === 'docx' || ext === 'docm') return docx(file);
  if (ext === 'xlsx' || ext === 'xlsm') return xlsx(file);
  if (ext === 'pptx') return pptx(file);
  if (ext === 'rtf') return rtf((await fs.readFile(file, 'latin1')).slice(0, 4_000_000));
  return null;
}
if (parentPort) run(workerData).then(r => parentPort.postMessage({ok: true, result: r}), e => parentPort.postMessage({ok: false, error: e.message}));
module.exports = {rtf};
