// Screenshots of every screen in dark and light, on the pretend neighbourhood (BEAM_DEMO).
//   xvfb-run -a node test/e2e/shots.js        → test/e2e/out/*.png
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');
const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  for (const theme of ['dark', 'light']) {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'beam-shots-'));
    fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ theme, onboarded: true, name: 'Bilal’s MacBook Pro', receiveDir: path.join(ud, 'Received') }));
    const app = await electron.launch({ executablePath: require(path.join(ROOT, 'node_modules', 'electron')), args: [ROOT, '--no-sandbox'], env: { ...process.env, BEAM_DEMO: '1', BEAM_USER_DATA: ud, BEAM_PORT: String(48100 + (theme === 'dark' ? 0 : 1)) } });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1180, height: 760 });
    page.on('console', m => { if (m.type() === 'error') console.log('console:', m.text()); });
    page.on('pageerror', e => console.log('pageerror:', e.message));
    await page.waitForSelector('body.ready');
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, `${theme}-1-nearby.png`) });
    await page.waitForSelector('.ask', { timeout: 8000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `${theme}-2-ask.png`) });
    await page.click('#yes');
    await page.waitForTimeout(300);
    // staged files
    await page.evaluate(() => stage(['/etc/hosts', '/etc']));
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `${theme}-3-staged.png`) });
    await page.evaluate(async () => { await call('unstage'); S.staged = []; S.stagedInfo = []; refresh(['nearby']); });
    // peer menu
    await page.click('.peer[data-id="demo-air"]');
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, `${theme}-4-menu.png`) });
    await page.keyboard.press('Escape');
    for (const [i, v] of [['5', 'activity'], ['6', 'phone'], ['7', 'devices'], ['8', 'settings']]) {
      await page.click(`#nav [data-view="${v}"]`);
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(OUT, `${theme}-${i}-${v}.png`) });
    }
    await page.click('#nav [data-view="nearby"]');
    await page.setViewportSize({ width: 860, height: 580 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `${theme}-9-small.png`) });
    await app.close();
  }
  console.log('shots in', OUT);
})().catch(e => { console.error(e); process.exit(1); });
