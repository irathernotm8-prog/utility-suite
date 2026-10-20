const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const fsops = require('../lib/fsops');
const {History} = require('../lib/history');
const settings = require('../lib/settings');
async function fixture(t) { const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fd-explorer-'))); t.after(() => fs.rm(dir, {recursive: true, force: true})); return dir; }

test('list returns kinds, hides dotfiles unless asked, and reports the parent', async t => {
  const dir = await fixture(t);
  await fs.mkdir(path.join(dir, 'Sub')); await fs.writeFile(path.join(dir, 'a.pdf'), 'x'); await fs.writeFile(path.join(dir, '.secret'), 'x');
  const r = await fsops.list(dir);
  assert.deepEqual(r.entries.map(e => e.name).sort(), ['Sub', 'a.pdf']);
  assert.equal(r.entries.find(e => e.name === 'Sub').kind, 'Folder');
  assert.equal(r.entries.find(e => e.name === 'a.pdf').kind, 'PDF');
  assert.equal(r.hiddenCount, 1);
  assert.equal(r.parent, path.dirname(dir));
  assert.equal((await fsops.list(dir, {hidden: true})).entries.length, 3);
});

test('new folders, files and copies get free names instead of overwriting', async t => {
  const dir = await fixture(t);
  assert.equal(path.basename(await fsops.makeFolder(dir)), 'untitled folder');
  assert.equal(path.basename(await fsops.makeFolder(dir)), 'untitled folder 2');
  await fs.writeFile(path.join(dir, 'report.pdf'), 'one');
  const [copy] = await fsops.transfer('copy', [path.join(dir, 'report.pdf')], dir);
  assert.equal(path.basename(copy.to), 'report copy.pdf');
  const [copy2] = await fsops.transfer('copy', [path.join(dir, 'report.pdf')], dir);
  assert.equal(path.basename(copy2.to), 'report copy 2.pdf');
  await fs.mkdir(path.join(dir, 'Box')); await fs.writeFile(path.join(dir, 'Box', 'report.pdf'), 'existing');
  const [moved] = await fsops.transfer('move', [path.join(dir, 'report.pdf')], path.join(dir, 'Box'));
  assert.equal(path.basename(moved.to), 'report 2.pdf');
  assert.equal(await fs.readFile(path.join(dir, 'Box', 'report.pdf'), 'utf8'), 'existing');
});

test('rename validates names and refuses to clobber', async t => {
  const dir = await fixture(t);
  await fs.writeFile(path.join(dir, 'a.txt'), 'a'); await fs.writeFile(path.join(dir, 'b.txt'), 'b');
  await assert.rejects(() => fsops.rename(path.join(dir, 'a.txt'), 'b.txt'), /already exists/);
  await assert.rejects(() => fsops.rename(path.join(dir, 'a.txt'), 'x/y'), /can’t contain/);
  const to = await fsops.rename(path.join(dir, 'a.txt'), 'A.txt');
  assert.equal(path.basename(to), 'A.txt');
  assert.equal(await fs.readFile(to, 'utf8'), 'a');
});

test('a folder cannot be moved into itself', async t => {
  const dir = await fixture(t);
  await fs.mkdir(path.join(dir, 'Outer', 'Inner'), {recursive: true});
  const [r] = await fsops.transfer('move', [path.join(dir, 'Outer')], path.join(dir, 'Outer', 'Inner'));
  assert.equal(r.ok, false);
  assert.ok(await fsops.exists(path.join(dir, 'Outer', 'Inner')));
});

test('search walks subfolders breadth-first, supports wildcards and cancels', async t => {
  const dir = await fixture(t);
  await fs.mkdir(path.join(dir, 'a', 'b'), {recursive: true});
  await fs.writeFile(path.join(dir, 'invoice-1.pdf'), ''); await fs.writeFile(path.join(dir, 'a', 'b', 'Invoice-2.PDF'), ''); await fs.writeFile(path.join(dir, 'a', 'notes.txt'), '');
  const found = []; await fsops.search(dir, 'invoice', {onBatch: b => found.push(...b)});
  assert.deepEqual(found.map(e => e.name), ['invoice-1.pdf', 'Invoice-2.PDF']);
  const wild = []; await fsops.search(dir, '*.txt', {onBatch: b => wild.push(...b)});
  assert.deepEqual(wild.map(e => e.name), ['notes.txt']);
  const r = await fsops.search(dir, 'x', {canceled: () => true});
  assert.equal(r.canceled, true);
});

test('folder size and text preview', async t => {
  const dir = await fixture(t);
  await fs.mkdir(path.join(dir, 's')); await fs.writeFile(path.join(dir, 's', 'a.txt'), 'hello'); await fs.writeFile(path.join(dir, 'b.bin'), Buffer.from([0, 1, 2, 0]));
  assert.deepEqual(await fsops.folderSize(dir), {bytes: 9, files: 2, folders: 1});
  assert.equal((await fsops.readText(path.join(dir, 's', 'a.txt'))).text, 'hello');
  assert.equal((await fsops.readText(path.join(dir, 'b.bin'))).binary, true);
});

test('history undoes moves, renames and new items, newest first, and persists', async t => {
  const dir = await fixture(t);
  const trashed = [];
  const h = new History(dir, async p => { trashed.push(p); await fs.rm(p, {recursive: true}); });
  const docs = path.join(dir, 'docs'); await fs.mkdir(docs);
  await fs.writeFile(path.join(dir, 'a.txt'), 'a');
  const [m] = await fsops.transfer('move', [path.join(dir, 'a.txt')], docs);
  await h.record('Move', [{type: 'move', from: m.from, to: m.to}]);
  const created = await fsops.makeFolder(dir, 'New');
  await h.record('New folder', [{type: 'create', path: created}]);
  const h2 = new History(dir, h.trash); // reload from disk
  assert.equal((await h2.list()).length, 2);
  assert.equal((await h2.undo()).label, 'New folder');
  assert.deepEqual(trashed, [created]);
  const r = await h2.undo();
  assert.equal(r.results[0].ok, true);
  assert.equal(await fs.readFile(path.join(dir, 'a.txt'), 'utf8'), 'a');
  assert.equal((await h2.undo()).label, null);
});

test('history refuses to undo over something new', async t => {
  const dir = await fixture(t);
  const h = new History(dir, async () => {});
  await fs.writeFile(path.join(dir, 'b.txt'), 'b');
  const to = await fsops.rename(path.join(dir, 'b.txt'), 'c.txt');
  await h.record('Rename', [{type: 'rename', from: path.join(dir, 'b.txt'), to}]);
  await fs.writeFile(path.join(dir, 'b.txt'), 'new');
  const r = await h.undo();
  assert.equal(r.results[0].ok, false);
  assert.equal(await fs.readFile(path.join(dir, 'b.txt'), 'utf8'), 'new');
});

test('Fresh Desk 0.x history is still undoable', async t => {
  const dir = await fixture(t);
  await fs.writeFile(path.join(dir, 'history.json'), JSON.stringify([{id: '1', name: 'x.txt', from: '/a/x.txt', to: '/a/TXT/x.txt', fingerprint: '1', status: 'moved'}, {id: '2', status: 'undone'}]));
  const list = await new History(dir, async () => {}).list();
  assert.equal(list.length, 1);
  assert.equal(list[0].type, 'tidy');
  assert.equal(list[0].count, 1);
});

test('prefs are cleaned and saved privately', async t => {
  const dir = await fixture(t);
  const saved = await settings.savePrefs(dir, {view: 'columns', sort: {key: 'size', dir: -1}, pins: ['/x', 5], evil: 'x', theme: 'neon'});
  assert.equal(saved.view, 'columns'); assert.deepEqual(saved.pins, ['/x']); assert.equal(saved.evil, undefined); assert.equal(saved.theme, 'system');
  assert.deepEqual((await settings.loadPrefs(dir)).sort, {key: 'size', dir: -1});
  if (process.platform !== 'win32') assert.equal((await fs.stat(path.join(dir, 'prefs.json'))).mode & 0o077, 0);
});
