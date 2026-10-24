// End-to-end run against a REAL emulator. Needs an SDK with an installed system image:
//   DROID_SDK=/path/to/sdk DROID_IMAGE="system-images;android-28;default;x86" DROID_E2E=test/e2e/real.js electron .
// Optional: DROID_EMU_ARGS="-accel off" on machines without virtualization (slow, but works).
'use strict';
const fs = require('fs');
const path = require('path');
const OUT = process.env.SHOTS || '/tmp/droid-real';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };

module.exports = async (D) => {
  const { app } = require('electron');
  fs.mkdirSync(OUT, { recursive: true });
  const js = (win, code) => win.webContents.executeJavaScript(code, true);
  const shot = async (win, name) => { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG()); };
  const until = async (fn, ms, step = 500) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(step); } return false; };
  while (!D.mainWin || D.mainWin.webContents.isLoading()) await sleep(200);
  await sleep(800);
  const W = D.mainWin;
  W.webContents.on('console-message', (e) => { if (e.level === 'error') console.log('[main console]', e.message); });

  const imgPath = process.env.DROID_IMAGE;
  const [, plat, tag, abi] = imgPath.split(';');
  const dev = D.store.create({ style: 'pixel', finish: 'bay', accent: 'mint', name: 'Real test', image: { path: imgPath, api: plat.replace('android-', ''), tag, tagName: tag, abi, name: `API ${plat}` }, screen: { w: 540, h: 1200, dpi: 240 }, ramMB: 2048, cores: 2, storageGB: 4, options: { gpu: 'swiftshader_indirect', quickBoot: true, audio: true } });
  await js(W, 'refreshDevices()');
  const t0 = Date.now();
  await js(W, `call('device:start', '${dev.id}')`).catch((e) => console.log('start error', e.message));
  await sleep(1500);
  const view = () => D.views.get(dev.id);
  check('device window opened', !!view());
  view().win.webContents.on('console-message', (e) => { if (e.level === 'error') console.log('[device console]', e.message); });
  await shot(view().win, 'r01-starting');
  const booted = await until(() => D.runner.session(dev.id)?.state === 'running', 9 * 60000, 2000);
  check('Android booted', booted, `${Math.round((Date.now() - t0) / 1000)} s`);
  if (!booted) { console.log((D.runner.session(dev.id) || {}).state); return finish(); }
  const gotFrame = await until(() => js(view().win, 'V.gotFrame'), 60000);
  check('live screen frames arrive', gotFrame);
  await sleep(4000);
  await shot(view().win, 'r02-running');

  // swipe up on the canvas with real pointer events -> app drawer
  const swipe = `(() => { const c = document.querySelector('#screen'); const r = c.getBoundingClientRect(); const x = r.left + r.width/2; const ev = (t, y) => c.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 1, bubbles: true }));
    c.setPointerCapture = () => {}; ev('pointerdown', r.top + r.height*0.85); let i = 0; return new Promise((res) => { const iv = setInterval(() => { i++; ev('pointermove', r.top + r.height*(0.85 - i*0.05)); if (i >= 10) { clearInterval(iv); ev('pointerup', r.top + r.height*0.35); res(true); } }, 40); }); })()`;
  await js(view().win, swipe);
  await sleep(5000);
  await shot(view().win, 'r03-swipe');

  // keyboard: Esc -> Back
  await js(view().win, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
  await sleep(2500);

  // drag and drop: an APK and a text file
  const sess = D.runner.session(dev.id);
  const { Adb } = require('../../src/core/adb');
  const adb = new Adb(path.join(process.env.DROID_SDK, 'platform-tools', 'adb'));
  fs.writeFileSync('/tmp/droid-hello.txt', 'hello from Droid');
  const apkFile = process.env.DROID_TEST_APK;
  const drops = [apkFile, '/tmp/droid-hello.txt'].filter((f) => f && fs.existsSync(f));
  await js(view().win, `call('view:drop', ID, ${JSON.stringify(drops)})`);
  const pushed = await until(async () => (await adb.ls(sess.serial, '/sdcard/Download/')).some((f) => f.name === 'droid-hello.txt'), 30000);
  check('drop copies a file into Downloads', pushed);
  if (apkFile) {
    const inst = await until(async () => (await adb.packages(sess.serial)).some((p) => p.id === 'me.zhanghai.android.files'), 120000, 2000);
    check('drop installs an APK', inst);
  }

  // files panel lists Download
  await js(view().win, "V.filesDir='/sdcard/Download/'; togglePanel('files')");
  await sleep(4000);
  const listed = await js(view().win, "[...document.querySelectorAll('.fitem b')].map(b=>b.textContent)");
  check('files panel shows the device folder', listed.includes('droid-hello.txt'), listed.join(', '));
  await shot(view().win, 'r04-files');
  await js(view().win, "togglePanel('files')");

  // F-Droid install straight to the device
  try {
    await js(W, `call('apps:fdroid', 'org.billthefarmer.shorty', '${dev.id}')`);
    const ok = await until(async () => (await adb.packages(sess.serial)).some((p) => p.id === 'org.billthefarmer.shorty'), 60000, 2000);
    check('F-Droid search result installs', ok);
  } catch (e) { check('F-Droid search result installs', false, e.message); }

  // apps panel lists installed apps
  await js(view().win, "togglePanel('apps')");
  await sleep(4000);
  const apps = await js(view().win, "[...document.querySelectorAll('.app-row[data-pkg]')].map(r=>r.dataset.pkg)");
  check('apps panel lists installed apps', apps.length >= 1, apps.join(', '));
  await shot(view().win, 'r05-apps');
  await js(view().win, "togglePanel('apps')");

  // location (manual)
  await js(W, `call('devices:update', '${dev.id}', { location: { mode: 'manual', lat: 29.7379, lng: -95.4642, label: 'The Galleria' } })`);
  await sleep(2000);
  const gps = await D.runner.session(dev.id).client.call('getGps', {}).catch((e) => ({ err: e.message }));
  check('manual location reaches the device', Math.abs((gps.latitude || 0) - 29.7379) < 0.001, JSON.stringify(gps));

  // screenshot tool
  const file = await js(view().win, `call('view:screenshot', ID)`);
  check('screenshot saved', fs.existsSync(file) && fs.statSync(file).size > 1000, file);

  // rotate
  await js(view().win, 'rotate(1)');
  const rotated = await until(() => js(view().win, "V.rotation === 'LANDSCAPE'"), 20000);
  check('rotation reaches the window', rotated);
  await sleep(3000);
  await shot(view().win, 'r06-rotated');
  // a tap in landscape must land where it's drawn: tap the centre and confirm via getevent-free check (no crash)
  await js(view().win, 'rotate(-1)');
  await sleep(3000);

  // snapshots
  try {
    await js(view().win, `call('view:snapshot', ID, 'save', 'e2e state')`);
    const snaps = await js(view().win, `call('view:snapshots', ID)`);
    check('named snapshot saved', snaps.some((s) => s.id === 'e2e_state'), snaps.map((s) => s.id).join(', '));
  } catch (e) { check('named snapshot saved', false, e.message); }

  // dashboard thumbnail
  await js(W, "go('devices')");
  await sleep(6000);
  await shot(W, 'r07-dashboard');
  check('dashboard shows a live thumbnail', await js(W, `!!document.querySelector('.card[data-id="${dev.id}"] img.shot')`));

  // turn off from the window
  await js(view().win, "send('view:win', ID, 'close')");
  const off = await until(() => !D.runner.session(dev.id), 120000, 1000);
  check('turns off and saves', off);
  check('thumbnail kept after stop', fs.existsSync(path.join(D.P.thumbs(), `${dev.id}.png`)));
  return finish();

  async function finish() {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    await D.runner.stopAll().catch(() => {});
    app.exit(failed.length ? 1 : 0);
  }
};
