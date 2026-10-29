// End-to-end run on the pretend computer: drives the demo DualSense, checks what reached the "computer",
// and saves screenshots of every page and overlay to test/e2e-out.
'use strict';
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'e2e-out');

module.exports = async ({ app, win, overlay, mapper, controllers, platform, guard, ui }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = []; const check = (name, ok, info = '') => { results.push({ name, ok: !!ok, info }); console.log(`${ok ? '  ✓' : '  ✗'} ${name}${info ? ' — ' + info : ''}`); };
  const shot = async (w, name) => { const img = await w.webContents.capturePage(); fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG()); };
  const js = (code) => win().webContents.executeJavaScript(code);
  const demo = controllers.demo;
  const hold = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { demo.push(fn); await wait(16); } };
  try {
    await wait(1800);
    win().setSize(1240, 860);
    await wait(300);
    // ---- driving
    platform.log.length = 0;
    await hold((f) => { f.a.lx = 0.9; f.a.ly = -0.2; }, 400); demo.push();
    await wait(80);
    const moves = platform.log.filter((e) => e[0] === 'move');
    check('left stick moves the pointer', moves.length > 10, `${moves.length} moves`);
    platform.log.length = 0;
    await hold((f) => { f.b.r2 = true; f.a.rt = 1; }, 60); await hold((f) => { f.b.r2 = true; f.a.rt = 1; f.b.right = true; }, 60); await hold((f) => { f.b.r2 = true; f.a.rt = 1; }, 60); demo.push(); await wait(60);
    check('hold R2 + d-pad right switches desktop', platform.log.some((e) => e[0] === 'combo' && e[1] === 'right' && e[2] === 'ctrl'));
    platform.log.length = 0;
    let x = 0.85; for (let i = 0; i < 16; i++) { x -= 0.035; demo.push((f) => { f.t = [{ down: true, id: 7, x, y: 0.4 }, { down: true, id: 8, x: x - 0.12, y: 0.6 }]; }); await wait(16); }
    demo.push(); await wait(60);
    check('two-finger swipe switches desktop', platform.log.some((e) => e[0] === 'combo' && e[1] === 'right'));
    platform.log.length = 0;
    await hold((f) => { f.b.cross = true; }, 50); demo.push(); await wait(40);
    check('Cross clicks', JSON.stringify(platform.log.filter((e) => e[0] === 'mouse')) === JSON.stringify([['mouse', 'left', true], ['mouse', 'left', false]]));
    // ---- game guard
    platform.setFront({ pid: 4242, name: 'Skyline Protocol', id: 'com.bilal.skyline' }); await guard.check();
    check('pauses for a game on the list', mapper.paused === 'Skyline Protocol');
    platform.log.length = 0; await hold((f) => { f.a.lx = 1; f.b.cross = true; }, 200); demo.push(); await wait(40);
    check('sends nothing while a game plays', platform.log.length === 0, `${platform.log.length} events`);
    await hold((f) => { f.b.create = true; f.b.options = true; }, 850); demo.push(); await wait(60);
    check('Create + Options brings Helm back over the game', mapper.paused === null);
    platform.setFront({ pid: 1, name: 'Finder', id: 'com.apple.finder' }); await guard.check();
    // ---- screenshots: pages
    demo.push((f) => { f.b.cross = true; f.b.r1 = true; f.a.lx = 0.6; f.a.ly = -0.4; f.a.lt = 0.6; f.t = [{ down: true, id: 1, x: 0.3, y: 0.45 }, { down: true, id: 2, x: 0.72, y: 0.6 }]; });
    await wait(500); await shot(win(), '1-home');
    for (const v of ['buttons', 'pointer', 'games', 'settings']) { await js(`document.querySelector('[data-v="${v}"]').click()`); await wait(450); await shot(win(), '2-' + v); }
    await js(`document.querySelector('[data-v="home"]').click()`); await wait(300);
    const other = await js(`document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'`);
    await js("document.documentElement.dataset.theme='" + other + "'"); await wait(300); await shot(win(), '3-home-' + other);
    demo.push();
    // ---- overlays
    mapper.setMode('keyboard'); await wait(150);
    for (const d of ['right', 'right', 'up']) { demo.push((f) => { f.b[d] = true; }); await wait(40); demo.push(); await wait(40); }
    await wait(350); await shot(overlay(), '4-keyboard');
    platform.log.length = 0;
    await hold((f) => { f.b.cross = true; }, 40); demo.push(); await wait(40);
    check('keyboard types the highlighted key', platform.log.some((e) => e[0] === 'text'), JSON.stringify(platform.log.find((e) => e[0] === 'text')));
    await hold((f) => { f.b.circle = true; }, 40); demo.push(); await wait(40);
    check('Circle closes the keyboard', mapper.mode === 'pointer');
    await hold((f) => { f.b.ps = true; }, 40); demo.push(); await wait(60);
    check('PS opens the quick panel', mapper.mode === 'panel');
    demo.push((f) => { f.b.right = true; }); await wait(40); demo.push(); await wait(400); await shot(overlay(), '5-panel');
    await hold((f) => { f.b.circle = true; }, 40); demo.push(); await wait(300);
    ui.layerHint(mapper.s().bindings.layer); await wait(400); await shot(overlay(), '6-hint'); ui.layerHint(null);
    ui.hud('Desktop →', { icon: 'desktop' }); await wait(350); await shot(overlay(), '7-hud');
  } catch (e) { check('e2e ran', false, e.stack); }
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  app.exit(failed ? 1 : 0);
};
