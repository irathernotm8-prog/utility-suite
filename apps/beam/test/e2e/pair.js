// Two real copies of Beam on one machine find each other over UDP and move files through the window.
//   xvfb-run -a node test/e2e/pair.js
'use strict';
const path = require('path'); const fs = require('fs'); const os = require('os'); const crypto = require('crypto');
const assert = require('assert');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const BIG = (Number(process.env.BEAM_BIG_MB) || 1500) << 20;

async function start(name, port, theme) {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), `beam-${name}-`));
  fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ name, theme, onboarded: true, receiveDir: path.join(ud, 'Received'), notify: false }));
  const app = await electron.launch({ executablePath: require(path.join(ROOT, 'node_modules', 'electron')), args: [ROOT, '--no-sandbox'], env: { ...process.env, BEAM_MULTI: '1', BEAM_USER_DATA: ud, BEAM_PORT: String(port) } });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1180, height: 760 });
  page.on('pageerror', e => console.log(name, 'pageerror:', e.message));
  await page.waitForSelector('body.ready');
  return { app, page, ud };
}

(async () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'beam-src-'));
  const big = path.join(src, 'Match day edit.mov');
  { const fh = fs.openSync(big, 'w'); const blk = crypto.randomBytes(8 << 20); for (let o = 0; o < BIG; o += blk.length) fs.writeSync(fh, blk, 0, Math.min(blk.length, BIG - o)); fs.closeSync(fh); }
  const A = await start('Mac Studio', 48201, 'dark');
  const B = await start('Gaming PC', 48202, 'dark');
  try {
    await A.page.waitForSelector('.peer', { timeout: 15000 });
    await B.page.waitForSelector('.peer', { timeout: 15000 });
    console.log('  ✓ both copies see each other');
    const peerB = await A.page.evaluate(() => S.peers[0]);
    assert.strictEqual(peerB.name, 'Gaming PC');
    // A stages the file (as if dropped) and clicks the device
    await A.page.evaluate((p) => stage([p]), big);
    await A.page.waitForSelector('.staged');
    await A.page.click('.peer');
    await B.page.waitForSelector('.ask', { timeout: 10000 });
    await B.page.screenshot({ path: path.join(OUT, 'pair-ask.png') });
    console.log('  ✓ receiver is asked');
    await B.page.check('#trust');
    const t0 = Date.now();
    await B.page.click('#yes');
    await A.page.waitForSelector('.xfer.active', { timeout: 10000 });
    await A.page.waitForTimeout(700);
    await A.page.screenshot({ path: path.join(OUT, 'pair-sending.png') });
    await B.page.screenshot({ path: path.join(OUT, 'pair-receiving.png') });
    await A.page.waitForSelector('.xfer.done', { timeout: 120000 });
    const secs = (Date.now() - t0) / 1000;
    const got = path.join(B.ud, 'Received', 'Match day edit.mov');
    await B.page.waitForFunction(() => S.history.some(h => h.status === 'done'), null, { timeout: 20000 });
    assert.strictEqual(fs.statSync(got).size, BIG);
    const h = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    assert.strictEqual(h(got), h(big));
    console.log(`  ✓ ${(BIG / 1e6).toFixed(0)} MB arrived intact in ${secs.toFixed(1)} s (${(BIG / 1e6 / secs).toFixed(0)} MB/s, both ends on one machine)`);
    await B.page.screenshot({ path: path.join(OUT, 'pair-received.png') });
    // now trusted: a text goes straight in
    await A.page.evaluate((id) => call('sendText', id, 'https://example.com/hello'), peerB.id);
    await B.page.waitForFunction(() => S.history.some(h => h.kind === 'text' && h.status === 'done'), null, { timeout: 10000 });
    console.log('  ✓ text from a trusted device arrives without asking');
    const trusted = await B.page.evaluate(() => S.settings.trusted.map(t => t.name));
    assert.deepStrictEqual(trusted, ['Mac Studio']);
    await A.page.click('#nav [data-view="activity"]'); await A.page.waitForTimeout(400);
    await A.page.screenshot({ path: path.join(OUT, 'pair-activity.png') });
    // B turns receiving off → disappears from A
    await B.page.click('#recvSeg [data-k="off"]');
    await A.page.click('#nav [data-view="nearby"]');
    await A.page.waitForFunction(() => S.peers.length === 0, null, { timeout: 15000 });
    console.log('  ✓ turning receiving off hides the computer');
    console.log('\npair: all passed');
  } finally { await A.app.close(); await B.app.close(); fs.rmSync(src, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
