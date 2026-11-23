// Drives the real app window: Library (with thumbnails), Studio for a scene, a shader and starters, Performance,
// Settings, plus the plugin handlers (create, update, preview). Screenshots go to test/e2e/out/ui-*.png.
const fs = require('fs'); const path = require('path');
module.exports = async ({ app, win, host, library, API, widgets, layer, screen }) => {
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
  // the resolution fix: a wallpaper window that no longer covers its display gets put back
  const rec = [...host.recs.values()][0]; const want = rec.display.bounds;
  rec.win.setBounds({ x: want.x, y: want.y + 40, width: want.width - 200, height: want.height - 120 });
  await wait(6500); const got = rec.win.getBounds();
  ok(got.width === want.width && got.height === want.height && got.y === want.y, 'a wallpaper that stops covering the screen is put back (' + JSON.stringify(got) + ')');
  // widgets: gallery, add, settings, editor, arrange
  await js(`__mural.go('widgets')`); await wait(800);
  for (let i = 0; i < 40 && (await js(`document.querySelectorAll('#wGrid .thumb .ph').length`)) > 0; i++) await wait(700);
  await shot('widgets-gallery');
  ok(await js(`document.querySelectorAll('#wGrid .card').length`) >= 10, 'widget gallery lists the built-ins with previews');
  const d = String(screen.getPrimaryDisplay().id);
  for (const t of ['builtin/clock', 'builtin/weather', 'builtin/notes', 'builtin/todo', 'builtin/system', 'builtin/calendar']) await API['widgets.add'](t, d);
  await wait(3000);
  const L = layer.layers.get(d);
  ok(!!L && (await L.win.webContents.executeJavaScript('window.__muralWidgets().filter(w => w.ready).length')) === 6, 'widgets appear on the desktop layer');
  // click-through: pointer over empty desktop -> clicks pass; over a widget -> it takes them
  const inst = widgets.instances(d)[0];
  ok(L.ignoring === true, 'empty desktop stays click-through');
  layer.hitTest = layer.hitTest.bind(layer); const real = screen.getCursorScreenPoint; screen.getCursorScreenPoint = () => ({ x: inst.x + 10, y: inst.y + 10 }); layer.hitTest(); ok(L.ignoring === false, 'a widget takes clicks when the pointer is over it'); screen.getCursorScreenPoint = () => ({ x: 5, y: 899 }); layer.hitTest(); ok(L.ignoring === true, 'and lets go when it leaves'); screen.getCursorScreenPoint = real;
  // typing into a widget works and is saved
  const notes = widgets.instances(d).find((i) => i.type === 'builtin/notes');
  await layer.call(notes.id, 'storage.set', ['text', 'Pick up the jersey']); ok(widgets.getData(notes.id).text === 'Pick up the jersey', 'widget storage saves');
  // permissions
  let denied = false; try { await layer.call(notes.id, 'system', []); } catch (_) { denied = true; } ok(denied, 'a widget can’t use what it didn’t ask for');
  await js(`__mural.widgetsPage.load().then(() => { __mural.widgetsPage.render(); __mural.widgetsPage.openDrawer(${JSON.stringify(notes.id)}); })`); await wait(900); await shot('widgets-settings');
  await js(`(() => { const x = document.querySelector('#wDrawer input[data-k="title"]'); x.value = 'Today'; x.dispatchEvent(new Event('input')); })()`); await wait(500);
  ok(widgets.instance(notes.id).settings.title === 'Today', 'changing a widget setting saves it');
  layer.setEditing(true); await wait(900);
  fs.writeFileSync(path.join(out, 'ui-widgets-arrange.png'), (await layer.layers.get(d).win.webContents.capturePage()).toPNG());
  ok(layer.layers.get(d).ignoring === false, 'arrange mode takes the whole screen');
  layer.setEditing(false); await wait(400); ok(layer.layers.get(d).ignoring === true, 'and gives it back');
  fs.writeFileSync(path.join(out, 'ui-widgets-desktop.png'), (await layer.layers.get(d).win.webContents.capturePage()).toPNG());
  // pausing the desktop pauses widgets
  host.onCover([{ bounds: rec.display.bounds, covered: true }]); await wait(400); ok(layer.layers.get(d).frozen, 'widgets pause when a full-screen window hides the desktop');
  host.onCover([{ bounds: rec.display.bounds, covered: false }]); await wait(400); ok(!layer.layers.get(d).frozen, 'and come back');
  // editor
  const counter = await API['widgets.create']('Counter'); await js(`__mural.widgetsPage.edit(${JSON.stringify(counter)})`); await wait(2000); await shot('widgets-editor');
  ok(await js(`!!document.querySelector('#eFrame') && document.querySelector('#eErr').textContent === ''`), 'the widget editor runs its live preview');
  // Claude's widget tools
  const Hh = global.__muralHandle;
  ok(/widget-sdk/.test((await Hh('widget_guide', {})).content[0].text), 'plugin: widget_guide');
  const cw = await Hh('create_widget', { name: 'Quote', html: '<!doctype html><link rel="stylesheet" href="mural://app/widget-base.css"><script src="mural://app/widget-sdk.js"></script><body><div class="w-pad"><div class="w-title">Quote</div><p id="q" style="font:500 18px var(--display)"></p></div><script>mural.ready().then(()=>{q.textContent=mural.settings.text})</script></body>', settings: [{ key: 'text', label: 'Text', type: 'text', default: 'Make it simple, but significant.' }], size: { w: 300, h: 140 } });
  const qt = JSON.parse(cw.content[0].text).type; ok(/^user\//.test(qt), 'plugin: create_widget');
  const pw = await Hh('preview_widget', { type: qt }); ok(pw.content[0].type === 'image' && !pw.isError, 'plugin: preview_widget'); fs.writeFileSync(path.join(out, 'plugin-widget.png'), Buffer.from(pw.content[0].data, 'base64'));
  const bad = await Hh('create_widget', { name: 'Broken', html: '<script src="mural://app/widget-sdk.js"></script><script>nope()</script>' });
  const bp = await Hh('preview_widget', { type: JSON.parse(bad.content[0].text).type }); ok(bp.isError && /nope/.test(bp.content[1].text), 'plugin: preview_widget reports page errors');
  const pl = await Hh('place_widget', { type: qt, glass: 'light' }); ok(!pl.isError && widgets.instances().some((i) => i.type === qt), 'plugin: place_widget');
  const offline = await Hh('preview_widget', { type: 'builtin/weather', wait: 1 }); ok(offline.content[0].type === 'image', 'plugin: preview of a network widget still returns a picture');
  await wait(300);
  ok(!errs.length, 'no errors in the app window' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  console.log('RESULT', fails.length ? 'FAILED ' + fails.length : 'ALL PASSED');
  app.exit(fails.length ? 1 : 0);
};
