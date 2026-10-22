// End-to-end run against test/e2e/mock-server.js. Loaded by main when GLEAN_E2E points here.
// Drives the real window (clicks its buttons), checks files on disk, saves screenshots to GLEAN_SHOTS.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

module.exports = async function drive({ win, app, collection, capture, library, settings }) {
  const shots = process.env.GLEAN_SHOTS || '/tmp/glean-shots';
  fs.mkdirSync(shots, { recursive: true });
  const results = []; let failed = 0;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const click = (sel) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error('no ' + ${JSON.stringify(sel)}); el.click(); return true; })()`);
  const until = async (fn, ms = 30000, what = 'condition') => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch (_) {} await sleep(250); } throw new Error('timed out waiting for ' + what); };
  const shot = async (name) => { await sleep(500); const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(shots, name + '.png'), img.toPNG()); };
  const step = async (name, fn) => { try { await fn(); results.push('✓ ' + name); console.log('✓ ' + name); } catch (e) { failed++; results.push('✗ ' + name + ': ' + e.message); console.log('✗ ' + name + '\n   ' + (e.stack || e).split('\n').slice(0, 4).join('\n   ')); } };
  const folder = settings().folder;
  const filesIn = (dir) => { try { return fs.readdirSync(dir).filter(f => !f.startsWith('.')); } catch { return []; } };
  const media = (dir) => filesIn(dir).filter(f => /\.(jpg|png|webp|mp4)$/.test(f));
  const dlDone = () => until(async () => js(`!!document.querySelector('#dl-status:not([hidden]) #dl-x')`), 60000, 'download to finish');

  await until(() => capture.wc && !capture.wc.isLoading() && /clientbrand/.test(capture.pageUrl()), 30000, 'profile page');
  await sleep(1200);

  await step('Opens on the signed-in browser with Instagram recognised', async () => {
    await js(`document.documentElement.dataset.theme === 'dark' || document.querySelector('#theme-btn').click()`);
    await shot('01-start');
    const chip = await js(`document.querySelector('#site-chip').textContent`);
    assert.strictEqual(chip, 'Instagram');
  });

  await step('Collect picks up posts the page shipped with (inline JSON)', async () => {
    await click('#collect-btn');
    await until(() => collection.items.size >= 8, 10000, 'inline posts');
    const posts = new Set(collection.list().filter(m => m.postId).map(m => m.postId));
    assert.ok(posts.size >= 6, 'posts: ' + posts.size);
  });

  await step('Auto-scroll loads the whole feed through the API; carousels and reels come through whole', async () => {
    await click('#scroll-btn');
    await until(() => !capture.scrolling && collection.items.size >= 26, 90000, 'scroll to finish');
    const items = collection.list().filter(m => m.postId);
    assert.strictEqual(new Set(items.map(m => m.postId)).size, 20);
    assert.strictEqual(items.length, 26, 'media count ' + items.length);
    const car = items.filter(m => m.postId === 'C0098xYz'); assert.strictEqual(car.length, 3);
    assert.ok(items.every(m => m.width === 1080), 'all full size');
    assert.strictEqual(items.filter(m => m.kind === 'video').length, 2);
    assert.ok(items.every(m => m.caption.startsWith('Post number')));
    await sleep(800);
    const n = await js(`document.querySelectorAll('#tray-list .tile').length`);
    assert.strictEqual(n, 26, 'tiles shown ' + n);
    const avatarShown = await js(`[...document.querySelectorAll('#tray-list .tile')].some(t => t.dataset.key.includes('avatar'))`);
    assert.ok(!avatarShown, 'profile picture is hidden');
    await shot('02-collected-dark');
  });

  await step('Lightbox shows a full-size picture with its caption', async () => {
    await js(`(() => { const t = document.querySelector('#tray-list .tile'); for (const d of [1, 2]) t.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: d })); t.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 })); })()`);
    await until(() => js(`(() => { const i = document.querySelector('#lb-stage img'); return i && i.complete && i.naturalWidth === 1080; })()`), 10000, 'lightbox image');
    await shot('03-lightbox');
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  });

  await step('Unticking a post leaves it out; Download saves the rest with captions', async () => {
    const before = await js(`document.querySelector('#dl-btn span').textContent`);
    assert.strictEqual(before, 'Download 26', 'double-click to preview leaves the selection alone');
    await js(`document.querySelector('.post[data-post="instagram:C0100xYz"] .post-check').click()`);
    await sleep(200);
    const label = await js(`document.querySelector('#dl-btn span').textContent`);
    assert.strictEqual(label, 'Download 25');
    await click('#dl-btn');
    await dlDone();
    const dir = path.join(folder, 'Instagram', 'clientbrand');
    const m = media(dir);
    assert.strictEqual(m.length, 25, m.join(', '));
    assert.ok(m.includes('2025-10-07 C0098xYz 03.jpg'), m.slice(0, 5).join(', '));
    assert.strictEqual(m.filter(f => f.endsWith('.mp4')).length, 2);
    const big = fs.statSync(path.join(dir, m.find(f => f.endsWith('.jpg')))).size;
    assert.ok(big > 15000, 'full-size file ' + big);
    const csv = fs.readFileSync(path.join(dir, 'captions.csv'), 'utf8');
    assert.ok(csv.includes('Post number 98') && csv.includes('https://www.instagram.com/p/C0098xYz/'));
    const man = JSON.parse(fs.readFileSync(path.join(dir, 'glean.json'), 'utf8'));
    assert.strictEqual(man.sourceUrl, 'https://www.instagram.com/clientbrand/');
    await shot('04-downloaded');
  });

  await step('New only: saved items drop out of the tray; the skipped post is still there', async () => {
    await js(`(() => { document.querySelector('#dl-x').click(); return 1; })()`);
    await sleep(500);
    const n = await js(`document.querySelectorAll('#tray-list .tile').length`);
    assert.strictEqual(n, 26, 'just-saved items stay visible until cleared: ' + n);
    await click('#clear-btn'); await sleep(3000);
    assert.strictEqual(collection.items.size, 0);
    assert.ok(!collection.active, 'clearing stops collecting');
  });

  await step('Check for new: a new post appears on the account, only it is downloaded', async () => {
    await capture.fetch('https://www.instagram.com/__addpost');
    const h = library.list().find(x => x.site === 'instagram');
    await js(`window.glean.call('library:sync', ${JSON.stringify(h.id)})`);
    const dir = path.join(folder, 'Instagram', 'clientbrand');
    await until(() => media(dir).length === 27, 60000, 'new post to download');
    await sleep(800);
    assert.ok(media(dir).some(f => f.includes('C0101xYz')), 'new post saved');
    assert.ok(media(dir).some(f => f.includes('C0100xYz')), 'the post not saved before is picked up too');
    const log = await (await capture.fetch('https://www.instagram.com/__log')).json();
    const pages = log.filter(l => l.includes('/api/v1/feed/')).length;
    assert.ok(pages <= 6, 'stopped early once caught up (feed pages fetched in total: ' + pages + ')');
  });

  await step('Patreon: posts API, multi-image posts, locked post skipped, WebP saved as JPG', async () => {
    await js(`document.querySelector('#clear-btn').click()`); await sleep(300);
    await js(`(() => { const u = document.querySelector('#url'); u.value = 'https://www.patreon.com/c/artist/posts'; document.querySelector('#url-form').requestSubmit(); })()`);
    await until(() => /patreon/.test(capture.pageUrl()) && !capture.wc.isLoading(), 20000, 'patreon page');
    await sleep(1500);
    if (!collection.active) await click('#collect-btn');
    await click('#scroll-btn');
    await until(() => !capture.scrolling && collection.list().filter(m => m.postId).length >= 5, 60000, 'patreon posts');
    const items = collection.list().filter(m => m.postId);
    assert.strictEqual(items.length, 5, items.map(m => m.postId).join(','));
    assert.ok(!items.some(m => m.postId === '503'));
    assert.strictEqual(items[0].accountName, 'Artist Studio');
    await sleep(600);
    await shot('05-patreon');
    await click('#dl-btn'); await dlDone();
    const dir = path.join(folder, 'Patreon', 'artist');
    const m = media(dir);
    assert.strictEqual(m.length, 5, m.join(', '));
    assert.ok(!m.some(f => f.endsWith('.webp')), 'webp converted');
    const conv = m.find(f => f.includes('502') && f.endsWith('02.jpg'));
    assert.ok(conv, m.join(', '));
    const head = fs.readFileSync(path.join(dir, conv)).subarray(0, 3);
    assert.deepStrictEqual([...head], [0xff, 0xd8, 0xff], 'real JPEG');
  });

  await step('Batch: a gallery page and a direct image link, downloaded when done', async () => {
    await js(`document.querySelector('#dl-x') && document.querySelector('#dl-x').click(); document.querySelector('#clear-btn').click()`); await sleep(300);
    await click('.nav-btn[data-view="batch"]');
    await js(`(() => { const t = document.querySelector('#batch-urls'); t.value = 'https://example.org/lookbook\\nhttps://example.org/img/c10_big.jpg'; t.dispatchEvent(new Event('input')); document.querySelector('#batch-scroll').checked = false; })()`);
    await click('#batch-go');
    await until(() => js(`[...document.querySelectorAll('.brow')].every(r => r.classList.contains('done'))`), 40000, 'batch rows');
    await shot('06-batch');
    await dlDone();
    const site = path.join(folder, 'example.org');
    const sub = filesIn(site);
    assert.ok(sub.length >= 1, 'folders: ' + sub.join(', '));
    const look = sub.find(s => /Lookbook/.test(s));
    assert.ok(look, sub.join(', '));
    const m = media(path.join(site, look));
    assert.ok(m.length >= 4, 'lookbook files: ' + m.join(', '));
    assert.ok(m.some(f => /c6_big/.test(f)), 'srcset picked the large one: ' + m.join(', '));
    assert.ok(!m.some(f => /avatar/.test(f)), 'tiny image skipped');
  });

  await step('Library: cards, an account’s posts, and a contact sheet PDF', async () => {
    await click('.nav-btn[data-view="library"]');
    await sleep(900);
    const cards = await js(`document.querySelectorAll('.card').length`);
    assert.ok(cards >= 3, 'cards ' + cards);
    await shot('07-library');
    await js(`[...document.querySelectorAll('.card')].find(c => c.textContent.includes('Client Brand')).click()`);
    await until(() => js(`document.querySelectorAll('.lib-grid .lp').length >= 21`), 10000, 'detail posts');
    await sleep(900);
    await shot('08-library-detail');
    const h = library.list().find(x => x.site === 'instagram');
    const pdf = await js(`window.glean.call('library:sheet', ${JSON.stringify(h.id)})`);
    assert.ok(fs.existsSync(pdf) && fs.statSync(pdf).size > 20000, 'pdf ' + pdf);
    fs.copyFileSync(pdf, path.join(shots, 'contact-sheet.pdf'));
  });

  await step('Light theme and settings', async () => {
    await js(`window.glean.call('settings:set', { theme: 'light' }).then(s => { document.querySelector('#theme-btn').click(); })`);
    await sleep(300);
    await js(`document.documentElement.dataset.theme === 'light' || document.querySelector('#theme-btn').click()`);
    await click('.nav-btn[data-view="browse"]');
    await js(`(() => { const u = document.querySelector('#url'); u.value = 'https://www.instagram.com/clientbrand/'; document.querySelector('#url-form').requestSubmit(); })()`);
    await until(() => /clientbrand/.test(capture.pageUrl()) && !capture.wc.isLoading(), 20000, 'profile again');
    if (!collection.active) await click('#collect-btn');
    await until(() => collection.items.size >= 6, 10000, 'items');
    await js(`(() => { const b = document.querySelector('#new-only'); if (b.classList.contains('on')) b.click(); })()`);
    await sleep(1500);
    await shot('09-browse-light');
    await click('#layout-seg [data-layout="grid"]'); await sleep(900);
    await shot('09b-grid-light');
    await click('#layout-seg [data-layout="posts"]');
    await click('#open-settings'); await sleep(400);
    await shot('10-settings');
    await js(`document.querySelector('#settings [data-close]').click()`);
  });

  fs.writeFileSync(path.join(shots, 'results.txt'), results.join('\n') + `\n\n${results.length - failed}/${results.length} passed\n`);
  console.log(`\n${results.length - failed}/${results.length} passed`);
  setTimeout(() => app.exit(failed ? 1 : 0), 500);
};
