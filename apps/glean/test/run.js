// Glean — quick Node checks for the parts that don't need Electron. Run: npm test
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const X = require('../src/collect/extract');
const { Collection } = require('../src/collect/collection');
const N = require('../src/library/naming');
const { Library } = require('../src/library/library');
const { Downloader } = require('../src/library/downloader');
const F = require('./fixtures');

let passed = 0; const tests = [];
const t = (name, fn) => tests.push([name, fn]);

t('Instagram feed (v1 API): one item per photo, carousel kept in order, biggest size wins', () => {
  const r = X.harvestJson(F.igFeed, 'https://www.instagram.com/api/v1/feed/user/123/', 'https://www.instagram.com/clientbrand/');
  assert.strictEqual(r.length, 4);
  const car = r.filter(m => m.postId === 'CAR0USEL1');
  assert.deepStrictEqual(car.map(m => m.postIndex), [1, 2, 3]);
  assert.strictEqual(car[0].width, 1440); assert.ok(car[0].url.includes('1440'));
  assert.ok(car[0].thumb.includes('320'));
  assert.strictEqual(car[2].kind, 'video'); assert.ok(car[2].url.endsWith('.mp4?x=1'));
  assert.strictEqual(car[0].account, 'clientbrand');
  assert.strictEqual(car[0].caption, 'Fall launch ✨ #new');
  assert.strictEqual(car[0].postUrl, 'https://www.instagram.com/p/CAR0USEL1/');
  assert.strictEqual(car[0].date, 1760000000000);
  const reel = r.find(m => m.postId === 'REEL1');
  assert.strictEqual(reel.kind, 'video'); assert.strictEqual(reel.postUrl, 'https://www.instagram.com/reel/REEL1/');
});
t('Instagram GraphQL (older shape with shortcode, sidecar)', () => {
  const r = X.harvestJson(F.igGraph, 'https://www.instagram.com/graphql/query', 'https://www.instagram.com/clientbrand/');
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0].postId, 'SIDE1'); assert.strictEqual(r[1].postIndex, 2);
  assert.strictEqual(r[0].width, 1080); assert.strictEqual(r[0].caption, 'Old style');
});
t('Patreon JSON:API: media from included, title + text as caption, locked posts give nothing', () => {
  const r = X.harvestJson(F.patreon, 'https://www.patreon.com/api/posts?filter[campaign_id]=9', 'https://www.patreon.com/c/artist/posts');
  assert.strictEqual(r.length, 3);
  const p = r.filter(m => m.postId === '111');
  assert.strictEqual(p.length, 2); assert.ok(p[0].url.includes('original'));
  assert.strictEqual(p[0].caption, 'WIP pack\n\nHello patrons');
  assert.strictEqual(p[0].account, 'artist'); assert.strictEqual(p[0].accountName, 'Artist Name');
  assert.strictEqual(r.find(m => m.postId === '222').kind, 'video');
  assert.ok(!r.some(m => m.postId === '333'));
});
t('Facebook GraphQL: "for (;;);" prefix, several JSON lines, photo grouped under its story', () => {
  const r = X.harvestText(F.fbText, 'https://www.facebook.com/api/graphql/', 'https://www.facebook.com/clientpage');
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0].postId, 'S1'); assert.strictEqual(r[0].caption, 'Grand opening!'); assert.strictEqual(r[0].width, 2048);
  assert.strictEqual(r[1].kind, 'video'); assert.ok(r[1].url.includes('hd'));
});
t('X: original-size images and the best mp4', () => {
  const r = X.harvestJson(F.x, 'https://x.com/i/api/graphql/abc/UserMedia', 'https://x.com/brand/media');
  assert.strictEqual(r.length, 2);
  assert.ok(r[0].url.includes('name=orig')); assert.strictEqual(r[0].postUrl, 'https://x.com/Brand/status/42');
  assert.ok(r[1].url.includes('1080'));
});
t('Generic JSON: url+width+height objects', () => {
  const r = X.harvestJson({ gallery: [{ url: 'https://cdn.site.com/a/photo-123456789.jpg', width: 1600, height: 900 }, { url: 'https://cdn.site.com/icon.png', width: 32, height: 32 }] }, 'https://site.com/api', 'https://site.com/gallery');
  assert.strictEqual(r.length, 1);
});
t('Dedupe keys: same picture at different sizes shares a key', () => {
  assert.strictEqual(X.keyOf('https://scontent-a.cdninstagram.com/v/t51.2885-15/4567890123_n.jpg?stp=dst-jpg_e35_p640x640&_nc=1'), X.keyOf('https://scontent-b.cdninstagram.com/v/t51.2885-15/4567890123_n.jpg?stp=dst-jpg_e35&_nc=2'));
  assert.strictEqual(X.keyOf('https://pbs.twimg.com/media/AbCdEf123?format=jpg&name=small'), X.keyOf('https://pbs.twimg.com/media/AbCdEf123.jpg'));
  assert.strictEqual(X.upgradeUrl('https://i.pinimg.com/236x/aa/bb/hash1234567890.jpg'), 'https://i.pinimg.com/originals/aa/bb/hash1234567890.jpg');
  assert.strictEqual(X.upgradeUrl('https://blog.com/wp-content/uploads/2024/05/shot-1024x683.jpg'), 'https://blog.com/wp-content/uploads/2024/05/shot.jpg');
});
t('Accounts from addresses', () => {
  assert.strictEqual(X.accountFromUrl('https://www.instagram.com/ClientBrand/'), 'clientbrand');
  assert.strictEqual(X.accountFromUrl('https://www.instagram.com/p/ABC/'), null);
  assert.strictEqual(X.accountFromUrl('https://www.patreon.com/c/artist/posts'), 'artist');
  assert.strictEqual(X.accountFromUrl('https://www.patreon.com/artist'), 'artist');
  assert.strictEqual(X.accountFromUrl('https://www.facebook.com/profile.php?id=1000'), '1000');
  assert.strictEqual(X.accountFromUrl('https://x.com/Brand/media'), 'brand');
  assert.strictEqual(X.accountFromUrl('https://example.com/a/b'), null);
});
t('DOM scan: post links group images, srcset picks largest', () => {
  const r = X.harvestDom({ images: [{ src: 'https://scontent.cdninstagram.com/v/x/9876543210_n.jpg', w: 1080, h: 1350, link: 'https://www.instagram.com/p/DOMPOST/' }], videos: [{ src: 'blob:https://x/1' }], backgrounds: [], links: [] }, 'https://www.instagram.com/clientbrand/');
  assert.strictEqual(r.length, 1); assert.strictEqual(r[0].postId, 'DOMPOST'); assert.strictEqual(r[0].account, 'clientbrand');
});
t('Merge keeps the biggest file and the richest post info', () => {
  const dom = X.harvestDom({ images: [{ src: 'https://scontent.cdninstagram.com/v/t51/4567890123_n.jpg?stp=p320', w: 320, h: 320, link: null }] }, 'https://www.instagram.com/clientbrand/')[0];
  const api = X.harvestJson(F.igFeed, 'https://www.instagram.com/api/v1/feed/', 'https://www.instagram.com/clientbrand/').find(m => m.key === dom.key);
  assert.ok(api, 'fixture shares a key');
  const m = X.merge(dom, api);
  assert.strictEqual(m.width, 1440); assert.strictEqual(m.postId, 'CAR0USEL1'); assert.strictEqual(m.source, 'api');
  const back = X.merge(api, dom); assert.strictEqual(back.width, 1440); assert.strictEqual(back.postId, 'CAR0USEL1');
});
t('Collection: page buffer is taken in on Start, filtered to the account on screen', async () => {
  let last = null; const c = new Collection(ev => { last = ev; });
  c.offer(X.harvestJson(F.igFeed, 'https://www.instagram.com/api/v1/feed/', 'https://www.instagram.com/clientbrand/'));
  c.offer([{ ...X.harvestJson(F.igFeed, 'x', 'https://www.instagram.com/')[0], key: 'other', account: 'someoneelse' }]);
  assert.strictEqual(c.items.size, 0);
  c.start('https://www.instagram.com/clientbrand/');
  assert.strictEqual(c.items.size, 4);
  await new Promise(r => setTimeout(r, 300));
  assert.strictEqual(last.upserts.length, 4);
});
t('Naming: layouts, tokens, unique names, CSV', () => {
  const m = { key: 'k1', url: 'https://cdn/x/abc.jpg?stp=1', kind: 'image', site: 'instagram', account: 'clientbrand', postId: 'CAR0USEL1', postIndex: 2, date: Date.UTC(2026, 9, 2, 12), caption: 'Hi' };
  const p = N.placeFor(m, { layout: 'account', fileNames: 'date-post-n' });
  assert.deepStrictEqual(p.root, ['Instagram', 'clientbrand']); assert.strictEqual(p.base, '2026-10-02 CAR0USEL1 02'); assert.strictEqual(p.ext, 'jpg');
  const q = N.placeFor(m, { layout: 'post', fileNames: 'post-n' }); assert.strictEqual(q.sub, '2026-10-02 CAR0USEL1');
  const loose = N.placeFor({ ...m, postId: null, url: 'https://site.com/img/Sunset%20Beach.webp' }, { layout: 'flat' }, { pageTitle: 'My: Page' });
  assert.strictEqual(loose.base, '2026-10-02 Sunset Beach'); assert.strictEqual(loose.ext, 'webp'); assert.deepStrictEqual(loose.root, ['clientbrand']);
  const taken = new Set(['a.jpg']); assert.strictEqual(N.uniqueName('a', 'jpg', taken), 'a (2).jpg');
  assert.ok(N.captionsCsv([{ file: 'a.jpg', caption: 'say "hi", ok', url: 'u', kind: 'image' }]).includes('"say ""hi"", ok"'));
  assert.strictEqual(N.clean('a/b:c*?'), 'a b c');
});
t('Downloader: saves through fetch, names files, records the manifest, skips what is saved, writes captions', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glean-test-'));
  const lib = new Library(path.join(dir, 'library.json'));
  const settings = { folder: path.join(dir, 'Glean'), layout: 'account', fileNames: 'date-post-n', concurrency: 2, captionFiles: true, convertWebp: false };
  let fetched = 0;
  const fakeFetch = async (url) => { fetched++; return new Response(Buffer.from('JPEGDATA' + url), { status: 200, headers: { 'content-type': /\.mp4/.test(url) ? 'video/mp4' : 'image/jpeg' } }); };
  const run = (items) => new Promise(res => { const d = new Downloader({ fetch: fakeFetch, library: lib, settings: () => settings, onEvent: ev => { if (ev.type === 'done') res(ev.job); } }); d.enqueue(items, { pageUrl: 'https://www.instagram.com/clientbrand/' }); });
  const items = X.harvestJson(F.igFeed, 'x', 'https://www.instagram.com/clientbrand/');
  const job = await run(items);
  assert.strictEqual(job.done, 4); assert.strictEqual(fetched, 6, 'four files and two video covers');
  const folder = path.join(settings.folder, 'Instagram', 'clientbrand');
  const files = fs.readdirSync(folder).sort();
  assert.ok(files.includes('2025-10-09 CAR0USEL1 01.jpg'), files.join(', '));
  assert.ok(files.includes('2025-10-09 CAR0USEL1 03.mp4'), files.join(', '));
  assert.ok(files.includes('2025-10-09 CAR0USEL1.txt')); assert.ok(files.includes('glean.json')); assert.ok(files.includes('captions.csv'));
  const again = await run(items);
  assert.strictEqual(again.skipped, 4); assert.strictEqual(fetched, 6);
  assert.strictEqual(fs.readdirSync(path.join(folder, '.glean', 'posters')).length, 2);
  const h = lib.list()[0]; assert.strictEqual(h.count, 4); assert.strictEqual(h.posts, 2); assert.strictEqual(h.sourceUrl, 'https://www.instagram.com/clientbrand/');
  assert.ok(lib.savedKeys().has(items[0].key));
  const lib2 = new Library(path.join(dir, 'library2.json')); assert.strictEqual(lib2.rescan(settings.folder), 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
t('Downloader: a page served instead of the file is a clear failure', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glean-test-'));
  const lib = new Library(path.join(dir, 'l.json'));
  const job = await new Promise(res => new Downloader({ fetch: async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }), library: lib, settings: () => ({ folder: dir, concurrency: 1 }), onEvent: ev => ev.type === 'done' && res(ev.job) })
    .enqueue([{ key: 'z', url: 'https://a.com/z.jpg', kind: 'image', site: 'a.com' }], { pageUrl: 'https://a.com/' }));
  assert.strictEqual(job.failed, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log('  ✓ ' + name); }
    catch (e) { console.log('  ✗ ' + name + '\n    ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n    ')); process.exitCode = 1; }
  }
  console.log(`\n${passed}/${tests.length} passed`);
})();
