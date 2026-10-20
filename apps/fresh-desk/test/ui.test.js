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
    init: async () => ({platform: 'linux', sep: '/', home: '/u', dark: false, version: '1.0.0', open: [], paths: {home: '/u', desktop: '/u/Desktop', documents: '/u/Documents', downloads: '/u/Downloads'}, prefs: {view: 'list', sort: {key: 'name', dir: 1}, foldersFirst: true, showHidden: false, showPreview: true, iconSize: 104, pins: [], unpinned: [], recents: [], tabs: ['/u/Downloads'], activeTab: 0, sidebarWidth: 212, previewWidth: 300, theme: 'system', collapsed: []}}),
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
  for (const f of ['util.js', 'icons.js', 'review-model.js', 'app.js', 'tidy.js']) w.eval(fs.readFileSync(path.join(R, f), 'utf8'));
  await new Promise(r => setTimeout(r, 120));
  return {w, d: w.document, calls};
}
const wait = ms => new Promise(r => setTimeout(r, ms));

test('explorer lists folders first, selects on click, and previews text', async t => {
  const {w, d} = await setup(t);
  const names = [...d.querySelectorAll('#content .row .nm')].map(n => n.textContent);
  assert.deepEqual(names, ['Clients', 'a-notes.txt', 'b-report.pdf']);
  const row = d.querySelectorAll('#content .row')[1];
  row.dispatchEvent(new w.MouseEvent('mousedown', {bubbles: true, button: 0}));
  await wait(150);
  assert.ok(row.classList.contains('sel'));
  assert.equal(d.querySelector('.pv-name').textContent, 'a-notes.txt');
  assert.equal(d.querySelector('.pv-text').textContent.trim(), 'hello world');
  assert.match(d.getElementById('statusLeft').textContent, /3 items · 1 selected/);
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
