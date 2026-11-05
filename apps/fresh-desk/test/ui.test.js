// Renderer smoke test in jsdom: the explorer renders a folder, selects, previews,
// and Tidy turns a plan into folder groups and clean-up sections.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const model = require('../renderer/review-model');
const R = path.join(__dirname, '../renderer');

const entries = [
  {name: 'Clients', path: '/u/Downloads/Clients', isDir: true, size: null, mtime: Date.parse('2026-01-02'), kind: 'Folder', ext: ''},
  {name: 'b-report.pdf', path: '/u/Downloads/b-report.pdf', isDir: false, size: 2000, mtime: Date.parse('2025-05-01'), kind: 'PDF', ext: 'pdf'},
  {name: 'a-notes.txt', path: '/u/Downloads/a-notes.txt', isDir: false, size: 10, mtime: Date.parse('2026-10-01'), kind: 'Document', ext: 'txt'},
];
function mockDesk(calls) {
  const record = name => (...a) => { (calls[name] ||= []).push(a); return Promise.resolve(); };
  return new Proxy({
    init: async () => ({platform: 'linux', sep: '/', home: '/u', dark: false, version: '1.0.0', open: [], paths: {home: '/u', desktop: '/u/Desktop', documents: '/u/Documents', downloads: '/u/Downloads'}, prefs: {view: 'list', sort: {key: 'name', dir: 1}, foldersFirst: true, showHidden: false, showPreview: true, iconSize: 104, pins: [], unpinned: [], recents: [], tabs: ['/u/Downloads'], activeTab: 0, sidebarWidth: 212, previewWidth: 300, theme: 'system', collapsed: [], accent: 'blue', oled: false, favMeta: {}, favOrder: []}}),
    places: async () => ({favorites: [{name: 'Downloads', path: '/u/Downloads', icon: 'download'}], volumes: []}),
    launchers: async () => ({terminals: [{id: 'Terminal', label: 'Terminal'}], editors: []}),
    list: async p => ({path: p, parent: '/u', entries: p === '/u/Downloads' ? entries : [], hiddenCount: 0}),
    info: async p => ({...entries.find(e => e.path === p) || {isDir: true}, items: 3, mtime: 0, ctime: 0}),
    diskSpace: async () => ({free: 5e9, total: 1e10}),
    readText: async () => ({text: 'hello world'}),
    thumb: async () => null, icon: async () => null, watch: async () => {}, savePrefs: async v => v, history: async () => [],
    profiles: async () => ({profiles: [{id: 'default', name: 'Everyday', rules: []}]}),
    tidyScan: async () => ({root: '/u/Downloads', emptyDirs: [], warnings: [], rows: [
      {id: '1', name: 'b-report.pdf', ext: 'pdf', from: '/u/Downloads/b-report.pdf', folder: 'Documents', canMove: true, bytes: 2000, modified: '2025-05-01T00:00:00Z', source: 'metadata', confidence: 'metadata', reason: '.pdf → Documents', flags: []},
      {id: '2', name: 'Zoom.pkg', ext: 'pkg', from: '/u/Downloads/Zoom.pkg', folder: 'Installers', canMove: true, bytes: 5e7, modified: '2024-05-01T00:00:00Z', source: 'metadata', confidence: 'metadata', reason: '.pkg → Installers', flags: ['installer', 'old']},
      {id: '3', name: 'scan.pdf', ext: 'pdf', from: '/u/Downloads/scan.pdf', folder: 'Receipts & invoices', canMove: true, bytes: 10, modified: '2026-01-01T00:00:00Z', source: 'content', confidence: 'review', reason: 'Receipt text', flags: []},
    ]}),
    on: () => {}, cancel: () => {}, cancelScan: () => {}, startDrag: () => {}, pathForFile: () => '',
  }, {get: (t, k) => k in t ? t[k] : record(k)});
}
async function setup(t) {
  const dom = new JSDOM(fs.readFileSync(path.join(R, 'index.html'), 'utf8'), {runScripts: 'outside-only', url: 'file:///fresh-desk/renderer/index.html', pretendToBeVisual: true});
  t.after(() => dom.window.close());
  const w = dom.window, calls = {};
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  w.ResizeObserver = class { observe() {} };
  w.desk = mockDesk(calls);
  for (const f of ['util.js', 'icons.js', 'glyphs.js', 'docview.js', 'review-model.js', 'app.js', 'tidy.js', 'extras.js']) w.eval(fs.readFileSync(path.join(R, f), 'utf8'));
  await new Promise(r => setTimeout(r, 120));
  return {w, d: w.document, calls};
}
const wait = ms => new Promise(r => setTimeout(r, ms));

test('explorer lists folders first, selects on click, and previews text', async t => {
  const {w, d} = await setup(t);
  const names = [...d.querySelectorAll('#content .row .nm')].map(n => n.textContent);
  assert.deepEqual(names, ['Clients', 'a-notes.txt', 'b-report.pdf']);
  const row = d.querySelectorAll('#content .row')[1];
  row.querySelector('.grab').dispatchEvent(new w.MouseEvent('mousedown', {bubbles: true, button: 0}));
  await wait(150);
  assert.ok(row.classList.contains('sel'));
  assert.equal(d.querySelector('.pv-name').textContent, 'a-notes.txt');
  assert.equal(d.querySelector('.pv-text').textContent.trim(), 'hello world');
  assert.match(d.getElementById('statusLeft').textContent, /3 items · 1 selected/);
});

test('dragging a box over empty space selects every row it touches', async t => {
  const {w, d} = await setup(t);
  const scroller = d.querySelector('#content .scroller');
  scroller.dispatchEvent(new w.MouseEvent('mousedown', {bubbles: true, button: 0, clientX: 400, clientY: 300}));
  w.dispatchEvent(new w.MouseEvent('mousemove', {clientX: 300, clientY: 40}));
  assert.ok(d.querySelector('.marquee'), 'box is drawn');
  w.dispatchEvent(new w.MouseEvent('mousemove', {clientX: 300, clientY: 40}));
  w.dispatchEvent(new w.MouseEvent('mouseup', {clientX: 300, clientY: 40}));
  await wait(50);
  assert.equal(d.querySelector('.marquee'), null);
  assert.equal(d.querySelectorAll('#content .row.sel').length, 2, 'rows 2 and 3 (y 32–88) are inside the box');
});

test('a plain click on the blank part of a row still selects it', async t => {
  const {w, d} = await setup(t);
  const date = d.querySelectorAll('#content .row')[2].querySelector('.c-date');
  date.dispatchEvent(new w.MouseEvent('mousedown', {bubbles: true, button: 0, clientX: 600, clientY: 70}));
  w.dispatchEvent(new w.MouseEvent('mouseup', {clientX: 600, clientY: 70}));
  await wait(50);
  assert.ok(d.querySelectorAll('#content .row')[2].classList.contains('sel'));
});

test('typing in search filters this folder instantly', async t => {
  const {w, d} = await setup(t);
  const s = d.getElementById('search'); s.value = 'report'; s.dispatchEvent(new w.Event('input'));
  await wait(150);
  assert.deepEqual([...d.querySelectorAll('#content .row .nm')].map(n => n.textContent), ['b-report.pdf']);
});

test('tidy groups the plan, leaves heuristic matches unticked and offers clean-up', async t => {
  const {w, d} = await setup(t);
  w.Tidy.open('/u/Downloads');
  await wait(150);
  const groups = [...d.querySelectorAll('.g-name')].map(n => n.textContent);
  assert.deepEqual(groups.sort(), ['Documents', 'Installers', 'Receipts & invoices']);
  assert.match(d.querySelector('.tidy-foot').textContent, /2 files into 2 folders/);
  assert.ok([...d.querySelectorAll('.c-head strong')].some(n => n.textContent === 'Old installers'));
});

test('tidy model helpers', () => {
  const rows = [{id: 'a', folder: 'X', canMove: true, confidence: 'metadata', bytes: 1, name: 'a'}, {id: 'b', folder: 'X', canMove: true, confidence: 'review', bytes: 2, name: 'b'}, {id: 'c', keep: true, folder: null, bytes: 3, name: 'c'}, {id: 'd', folder: 'Y', conflict: 'Destination already exists', bytes: 4, name: 'd'}];
  const g = model.groupPlan(rows);
  assert.equal(g.moves.length, 1); assert.equal(g.staying.length, 1); assert.equal(g.blocked.length, 1);
  assert.deepEqual([...model.defaultChecked(rows)], ['a']);
  assert.deepEqual(model.summary(rows, new Set(['a', 'b', 'c', 'd'])), {files: 2, folders: 1, bytes: 3});
});

test('markdown and CSV previews are built as plain DOM', async t => {
  const {w} = await setup(t);
  const md = w.DocView.markdown('# Plan\n\n- **Ship** Fresh Desk\n- [ ] Test on Windows\n\n<script>alert(1)</script>\n\n| a | b |\n|---|---|\n| 1 | 2 |');
  assert.equal(md.querySelector('h1').textContent, 'Plan');
  assert.equal(md.querySelector('li strong').textContent, 'Ship');
  assert.equal(md.querySelectorAll('li')[1].textContent, '☐ Test on Windows');
  assert.equal(md.querySelector('script'), null, 'raw HTML stays text');
  assert.equal(md.querySelectorAll('td').length, 2);
  assert.equal(JSON.stringify(w.DocView.parseCsv('a,"b, c"\n1,"say ""hi"""\n', ',')), JSON.stringify([['a', 'b, c'], ['1', 'say "hi"']]));
  const safe = w.DocView.safeHtml('<p onclick="x()">Hi <a href="https://evil">link</a><img src="https://x/y.png"><script>bad()</script></p>');
  assert.equal(safe.querySelector('[onclick]'), null);
  assert.equal(safe.querySelector('a'), null);
  assert.equal(safe.querySelector('img'), null);
  assert.equal(safe.querySelector('script'), null);
  assert.match(safe.textContent, /Hi link/);
});

test('batch rename previews names: replace, number, case', async t => {
  const {w} = await setup(t);
  const es = [{name: 'IMG_001.JPG', path: '/u/a', isDir: false}, {name: 'IMG_002.JPG', path: '/u/b', isDir: false}];
  const base = {keepExt: true, caseSensitive: false, regex: false};
  assert.deepEqual(w.Extras.computeNames(es, {...base, mode: 'replace', find: 'img_', replace: 'Trip '}).map(r => r.name), ['Trip 001.JPG', 'Trip 002.JPG']);
  assert.deepEqual(w.Extras.computeNames(es, {...base, mode: 'format', base: 'Houston', start: 1, digits: 2, joiner: ' ', numberFirst: false}).map(r => r.name), ['Houston 01.JPG', 'Houston 02.JPG']);
  assert.deepEqual(w.Extras.computeNames(es, {...base, mode: 'case', caseMode: 'lower'}).map(r => r.name), ['img_001.JPG', 'img_002.JPG']);
});

test('adding a favorite asks for an icon and remembers it', async t => {
  const {w, d} = await setup(t);
  w.App.pin('/u/Projects');
  await wait(50);
  assert.ok(d.querySelector('.fav-dialog'), 'editor opens');
  assert.ok(d.querySelectorAll('.glyph').length > 60, 'plenty of icons');
  d.querySelector('.glyph[title="Rocket"]').click();
  d.querySelector('.fav-dialog .btn.primary').click();
  await wait(50);
  assert.equal(w.App.S.prefs.favMeta['/u/Projects'].icon, 'rocket');
  assert.equal(w.App.favorites().find(f => f.path === '/u/Projects').icon, 'rocket');
  assert.ok([...d.querySelectorAll('.place-name')].some(n => n.textContent === 'Projects'), 'shows in the sidebar');
});

test('share menu offers Beam devices when Beam is running', async t => {
  const {w} = await setup(t);
  w.desk.beamStatus = async () => ({installed: true, running: true, peers: [{id: 'pc1', name: 'Bilal’s PC', os: 'windows'}]});
  const items = await w.App.shareItems(['/u/Downloads/a-notes.txt']);
  const beam = items.find(i => i.submenu);
  assert.equal(beam.label, 'Beam To');
  assert.equal(beam.submenu[0].id, 'beam:pc1');
  assert.equal(beam.submenu[0].label, 'Bilal’s PC · PC');
  w.desk.beamStatus = async () => ({installed: true, running: false, peers: []});
  assert.equal((await w.App.shareItems(['/a', '/b'])).find(i => i.id === 'beamOpen').label, 'Send 2 Items with Beam…');
});
