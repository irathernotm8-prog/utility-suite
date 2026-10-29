// Document previews (Word, Excel, PowerPoint, RTF) and batch rename.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const JSZip = require('jszip');
const {docPreview} = require('../lib/docpreview');
const {rtf} = require('../lib/doc-worker');
const fsops = require('../lib/fsops');
const {History} = require('../lib/history');
async function fixture(t) { const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fd-preview-'))); t.after(() => fs.rm(dir, {recursive: true, force: true})); return dir; }

async function docx(file, paragraphs) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map(p => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`);
  await fs.writeFile(file, await zip.generateAsync({type: 'nodebuffer'}));
}

test('Word documents become HTML for the preview pane', async t => {
  const dir = await fixture(t);
  await docx(path.join(dir, 'memo.docx'), ['Quarterly marketing memo', 'Sign-ups grew 12%']);
  const r = await docPreview(path.join(dir, 'memo.docx'));
  assert.equal(r.type, 'html');
  assert.match(r.html, /Quarterly marketing memo/);
  assert.match(r.html, /<p>/);
});

test('spreadsheets preview as a table with sheet names', async t => {
  const dir = await fixture(t);
  const Excel = require('exceljs'); const book = new Excel.Workbook();
  const s = book.addWorksheet('Signups'); s.addRow(['Week', 'Signups']); s.addRow(['Oct 6', 42]);
  book.addWorksheet('Spend').addRow(['Channel', 'Cost']);
  await book.xlsx.writeFile(path.join(dir, 'weekly.xlsx'));
  const r = await docPreview(path.join(dir, 'weekly.xlsx'));
  assert.equal(r.type, 'table');
  assert.deepEqual(r.sheets, ['Signups', 'Spend']);
  assert.deepEqual(r.rows, [['Week', 'Signups'], ['Oct 6', '42']]);
  assert.deepEqual((await docPreview(path.join(dir, 'weekly.xlsx'), {sheet: 1})).rows, [['Channel', 'Cost']]);
});

test('PowerPoint decks preview as slide outlines', async t => {
  const dir = await fixture(t);
  const zip = new JSZip();
  const slide = (title, bullet) => `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:txBody><a:p><a:pPr lvl="0"/><a:r><a:t>${bullet}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  zip.file('ppt/slides/slide2.xml', slide('Results', 'CPA down 8%'));
  zip.file('ppt/slides/slide1.xml', slide('Operations Update', 'Week of Oct 20 &amp; 27'));
  await fs.writeFile(path.join(dir, 'deck.pptx'), await zip.generateAsync({type: 'nodebuffer'}));
  const r = await docPreview(path.join(dir, 'deck.pptx'));
  assert.deepEqual(r.slides, [{title: 'Operations Update', lines: ['Week of Oct 20 & 27']}, {title: 'Results', lines: ['CPA down 8%']}]);
});

test('broken documents fail softly', async t => {
  const dir = await fixture(t);
  await fs.writeFile(path.join(dir, 'bad.docx'), 'not a zip');
  const r = await docPreview(path.join(dir, 'bad.docx'));
  assert.equal(r.type, 'none');
  assert.equal(await docPreview(path.join(dir, 'x.txt')).catch(() => null), null);
});

test('RTF text is extracted', () => {
  assert.equal(rtf('{\\rtf1\\ansi{\\fonttbl{\\f0 Helvetica;}}\\f0 Hello\\par World \\u8212? done}').text, 'Hello\nWorld — done');
});

test('batch rename handles swaps and refuses clashes, and undoes in one step', async t => {
  const dir = await fixture(t);
  for (const n of ['a.txt', 'b.txt', 'c.txt']) await fs.writeFile(path.join(dir, n), n);
  const done = await fsops.renameMany([{from: path.join(dir, 'a.txt'), name: 'b.txt'}, {from: path.join(dir, 'b.txt'), name: 'a.txt'}]);
  assert.equal(done.length, 2);
  assert.equal(await fs.readFile(path.join(dir, 'a.txt'), 'utf8'), 'b.txt');
  await assert.rejects(() => fsops.renameMany([{from: path.join(dir, 'a.txt'), name: 'c.txt'}]), /already exists/);
  await assert.rejects(() => fsops.renameMany([{from: path.join(dir, 'a.txt'), name: 'x.txt'}, {from: path.join(dir, 'b.txt'), name: 'X.txt'}]), /both be named/);
  assert.deepEqual((await fs.readdir(dir)).sort(), ['a.txt', 'b.txt', 'c.txt']);
  const h = new History(dir, async () => {});
  await h.record('Rename 2 items', done.map(d => ({type: 'rename', ...d})));
  const r = await h.undo();
  assert.ok(r.results.every(x => x.ok));
  assert.equal(await fs.readFile(path.join(dir, 'a.txt'), 'utf8'), 'a.txt');
});
