// Drives the real app window: Library (with thumbnails), Studio for a scene, a shader and starters, Performance,
// Settings, plus the plugin handlers (create, update, preview). Screenshots go to test/e2e/out/ui-*.png.
const fs = require('fs'); const path = require('path');
module.exports = async ({ app, win, host, library, API }) => {
  const out = path.join(__dirname, 'out'); fs.mkdirSync(out, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const fails = []; const ok = (c, m) => { if (!c) { fails.push(m); console.log('FAIL', m); } else console.log('ok  ', m); };
  const js = (code) => win().webContents.executeJavaScript(code);
  const shot = async (name) => { const img = await win().webContents.capturePage(); fs.writeFileSync(path.join(out, `ui-${name}.png`), img.toPNG()); };
  const errs = []; 
  await wait(2500);
  win().webContents.on('console-message', (e) => { const m = e.message || ''; if (e.level === 'error' || /Uncaught|TypeError|ReferenceError/.test(m)) errs.push(m); });
  // library + thumbnails
  for (let i = 0; i < 80 && library.list().some((w) => !w.thumb); i++) await wait(1000);
  ok(library.list().every((w) => w.thumb), 'every wallpaper got a thumbnail');
  await js(`__mural.go('library')`); await wait(1500); await shot('library');
  ok(await js(`document.querySelectorAll('.card').length`) === library.list().length, 'library shows every wallpaper');
  // apply from the card
  await js(`document.querySelector('.card[data-id="builtin/snowfall"] .apply').click()`); await wait(1500);
  ok([...host.recs.values()][0].wallpaperId === 'builtin/snowfall', 'Set as wallpaper puts it on the desktop');
  // hover preview
  await js(`(() => { const c = document.querySelector('.card[data-id="builtin/fold-xenon"]'); c.dispatchEvent(new MouseEvent('mouseenter')); })()`); await wait(1500);
  ok(await js(`!!document.querySelector('.card[data-id="builtin/fold-xenon"] .live canvas')`), 'hovering a card plays it live');
  // studio: scene
  await js(`__mural.go('studio'); __mural.studio.open('builtin/daybreak')`); await wait(2200);
  await js(`document.querySelector('#hour').value = 20.2; document.querySelector('#hour').dispatchEvent(new Event('input'))`); await wait(800);
  await js(`document.querySelectorAll('#left .layer')[3].click()`); await wait(400);
  await shot('studio-scene');
  ok(await js(`document.querySelectorAll('#left .layer').length`) >= 6, 'studio lists the layers');
  ok(await js(`document.querySelectorAll('#right .field').length`) > 8, 'studio shows the layer’s settings');
  // change a setting and save (built-in -> copy)
  await js(`(() => { const r = document.querySelector('#right input[type=range][data-k="base"]'); r.value = 0.66; r.dispatchEvent(new Event('input')); })()`); await wait(400);
  await js(`document.querySelector('#save').click()`); await wait(2000);
  const mine = library.list().find((w) => !w.builtin && w.name === 'Daybreak Hills');
  ok(!!mine, 'saving a built-in makes the user’s own copy'); 
  ok(await js(`__mural.studio.id`) === (mine && mine.id), 'studio follows the copy');
  // studio: shader
  await js(`__mural.studio.open('builtin/liquid-gold')`); await wait(2200); await shot('studio-shader');
  await js(`(() => { const t = document.querySelector('#code'); t.value = t.value.replace('void mainImage', 'void mainImage(oops'); t.dispatchEvent(new Event('input')); })()`); await wait(900);
  ok(/Line \d+/.test(await js(`(document.querySelector('.stage .err') || {}).textContent || ''`)), 'a shader typo shows the error with a line number');
  await js(`__mural.studio.showStarters()`); await wait(500); await shot('studio-starters');
  // performance + settings
  await js(`__mural.go('performance')`); await wait(4500); await shot('performance');
  ok(await js(`document.querySelectorAll('#perfBody .box').length`) >= 3, 'performance page shows live numbers and limits');
  await js(`document.querySelector('.seg[data-k="fps"] button[data-v="24"]').click()`); await wait(500);
  ok(JSON.parse(await js(`JSON.stringify(__mural.S.settings.fps)`)) === 24, 'frame cap changes from the page');
  await js(`__mural.go('settings')`); await wait(1500); await shot('settings');
  // pause / resume
  host.setUserPaused(true); await wait(400); ok([...host.recs.values()][0].frozen, 'pausing freezes the wallpaper page');
  host.setUserPaused(false); await wait(400); ok(![...host.recs.values()][0].frozen, 'resuming thaws it');
  // covered
  host.onCover([{ bounds: [...host.recs.values()][0].display.bounds, covered: true }]); await wait(300); ok([...host.recs.values()][0].reason === 'covered', 'a full-screen window pauses it');
  host.onCover([{ bounds: [...host.recs.values()][0].display.bounds, covered: false }]); await wait(300); ok(![...host.recs.values()][0].frozen, 'and it comes back when uncovered');
  // the plugin
  const H = global.__muralHandle;
  const g = await H('mural_guide', {}); ok(/Layer kinds/.test(g.content[0].text), 'plugin: guide');
  const c = await H('create_wallpaper', { name: 'Claude test', type: 'scene', scene: { layers: [{ kind: 'gradient', from: '#102040', to: '#401030' }, { kind: 'particles', preset: 'bokeh', count: 40 }] } });
  const cid = JSON.parse(c.content[0].text).id; ok(/^user\//.test(cid), 'plugin: create_wallpaper');
  const u = await H('update_wallpaper', { id: cid, ops: [{ op: 'add', layer: { kind: 'text', text: '{time}', name: 'Clock' } }, { op: 'set', layer: 'Clock', props: { size: 0.12 } }] });
  ok(!u.isError && /Clock/.test(u.content[0].text), 'plugin: update_wallpaper with layer ops');
  const pv = await H('preview', { id: cid, hour: 21, cursor: { x: 0.3, y: 0.4 }, click: { x: 0.5, y: 0.5 }, width: 800 });
  ok(pv.content[0].type === 'image' && pv.content[0].data.length > 5000, 'plugin: preview returns a picture');
  fs.writeFileSync(path.join(out, 'plugin-preview.png'), Buffer.from(pv.content[0].data, 'base64'));
  const sh = await H('create_wallpaper', { name: 'Bad shader', type: 'shader', code: 'void mainImage(out vec4 o, in vec2 p) { o = vec4(nope); }' });
  const sid = JSON.parse(sh.content[0].text).id; const sp = await H('preview', { id: sid });
  ok(sp.isError && /Line/.test(sp.content[1].text), 'plugin: preview reports shader errors');
  const st = await H('status', {}); ok(/displays/.test(st.content[0].text), 'plugin: status');
  await wait(300);
  ok(!errs.length, 'no errors in the app window' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  console.log('RESULT', fails.length ? 'FAILED ' + fails.length : 'ALL PASSED');
  app.exit(fails.length ? 1 : 0);
};
