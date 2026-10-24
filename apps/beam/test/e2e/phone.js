// The phone page in a phone-sized browser: loads, sends a file and text, lists what the computer put up.
//   node test/e2e/phone.js
'use strict';
const path = require('path'); const fs = require('fs'); const os = require('os'); const assert = require('assert');
const { chromium, devices } = require('playwright');
const { Engine } = require('../../src/core/engine');
const { loadIdentity } = require('../../src/core/identity');
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beam-ph-'));
  const settings = { name: 'Bilal’s MacBook Pro', receiveDir: path.join(dir, 'in'), receive: 'everyone', trusted: [], saved: [], phone: { enabled: true } };
  const e = new Engine({ dataDir: dir, identity: loadIdentity(dir), settings: () => settings, port: 0, discovery: false, phoneHtml: () => fs.readFileSync(path.join(__dirname, '../../src/phone/index.html'), 'utf8'), iconPath: path.join(__dirname, '../../build/icon.png') });
  await e.start();
  const shared = path.join(dir, 'Ops update.pdf'); fs.writeFileSync(shared, 'pdf');
  await e.phone.share([shared]); e.phone.shareText('https://lytefiber.com/plans');
  const texts = []; e.on('text', t => texts.push(t.text));
  const browser = await chromium.launch();
  for (const scheme of ['dark', 'light']) {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], colorScheme: scheme });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${e.port}/m/${settings.phone.token}/`);
    await page.waitForSelector('[data-copy]');
    if (scheme === 'dark') {
      const f = path.join(dir, 'IMG_2041.HEIC'); fs.writeFileSync(f, Buffer.alloc(2_500_000, 7));
      await page.setInputFiles('#pick', [f]);
      await page.waitForSelector('.item.done');
      await page.fill('#text', 'meet at 6');
      await page.click('#tsend');
      await page.waitForFunction(() => document.querySelector('#tmsg').textContent.includes('Sent'));
    }
    await page.screenshot({ path: path.join(OUT, `phone-${scheme}.png`), fullPage: true });
    await ctx.close();
  }
  assert.strictEqual(fs.statSync(path.join(settings.receiveDir, 'IMG_2041.HEIC')).size, 2_500_000);
  assert.deepStrictEqual(texts, ['meet at 6']);
  await browser.close(); await e.stop();
  console.log('phone page: all passed');
})().catch(err => { console.error(err); process.exit(1); });
