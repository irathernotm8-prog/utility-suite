// Dither — end-to-end: seeds a project the way Claude would (a drafts board, kept effects, sprites, a reference),
// starts the app on it, clicks through every screen in dark and light, and saves screenshots.
// xvfb-run node test/e2e/shots.js [outDir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron } = require('playwright');
const { Library } = require('../../src/core/project');
const SP = require('../../src/core/sprite');
const FX = require('../../src/core/fxruntime');
const png = require('../../src/core/png');
const sheets = require('../../src/core/sheets');
const { LIB } = require('../../src/core/fxlib');

const WIZARD = `<svg viewBox="0 0 64 64">
<path d="M48 10 L50 10 L50 60 L48 60 Z" fill="#8a5a3a" data-material="wood" data-form="cylinder"/>
<polygon points="49,2 54,8 49,14 44,8" fill="#41a6f6" data-material="crystal"/>
<path d="M20 34 Q32 28 44 34 L48 58 Q32 62 16 58 Z" fill="#5d275d" data-material="cloth"/>
<path d="M22 34 L42 34 L40 44 L24 44 Z" fill="#8f3f8f" data-material="cloth"/>
<rect x="21" y="44" width="22" height="3" fill="#c8a040" data-material="gold" data-form="cylinder-h"/>
<ellipse cx="32" cy="27" rx="7" ry="7" fill="#e8b796" data-material="skin"/>
<path d="M25 28 Q32 46 39 28 Q36 33 32 33 Q28 33 25 28 Z" fill="#e6e6ee" data-material="hair"/>
<path d="M18 23 Q32 18 46 23 L44 25 Q32 21 20 25 Z" fill="#3b2a6b" data-material="cloth"/>
<path d="M22 22 L34 2 L42 21 Z" fill="#3b2a6b" data-material="cloth"/>
<rect x="29" y="25" width="2" height="2" fill="#1a1c2c"/><rect x="34" y="25" width="2" height="2" fill="#1a1c2c"/>
<ellipse cx="47" cy="40" rx="3" ry="3" fill="#e8b796" data-material="skin"/>
</svg>`;
const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'shots'));
const lib = (id) => LIB.find((l) => l.id === id).code;

function seed(root) {
  const L = new Library(path.join(root, 'Dither'));
  const p = L.create('Skyline Protocol');
  const b = p.createBoard({ idea: 'Boss lightning strike', brief: 'Top-down, cold palette, has to read at 2× on a dark arena. Big anticipation, a held strike frame, crackling afterglow.', by: 'claude-code' });
  const takes = [
    ['Classic fork', lib('lightning'), 'Jagged main bolt, three branches, dithered halo'],
    ['Twin strike', lib('lightning').replace('seed: 21', 'seed: 4').replace("branches: { value: 3", "branches: { value: 5"), 'Two near-parallel channels, more branching'],
    ['Pillar of light', lib('lightning').replace('jag: { value: 4', 'jag: { value: 1').replace('seed: 21', 'seed: 9'), 'Almost straight, reads as a column from above'],
    ['Arcane bolt', lib('lightning').replace("palette: 'energy'", "palette: 'arcane'").replace('seed: 21', 'seed: 33'), 'Same timing in the arcane ramp, for the shadow boss'],
    ['Ground burst', lib('impact').replace("palette: 'pico8'", "palette: 'energy'").replace(/\b10\b/g, '1').replace(/\b9\b/g, '2'), 'Starts at the impact point and throws sparks out'],
    ['Long wind-up', lib('lightning').replace('holds: [1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 2]', 'holds: [3, 2, 3, 1, 1, 1, 1, 1, 1, 1, 1, 2]').replace('seed: 21', 'seed: 12'), 'Holds the leader longer so players can dodge'],
  ];
  const ids = takes.map(([name, code, note]) => p.createEffect({ name, code, by: 'claude-code', note, boardId: b.id }).id);
  p.feedback(ids[0], { verdict: 'pick', note: 'Love the halo. Frame 3 could hold one frame longer.', frame: 3 });
  p.feedback(ids[2], { verdict: 'pick' }); p.feedback(ids[2], { note: 'Reads great from above. Add two small branches near the ground?', frame: 2 });
  p.feedback(ids[3], { verdict: 'maybe' }); p.feedback(ids[4], { verdict: 'no' });
  p.updateEffect(ids[0], { code: lib('lightning').replace('holds: [1, 1, 2,', 'holds: [1, 1, 3,'), note: 'Held the strike frame one more beat (your note on frame 3)', by: 'claude-code' });
  for (const id of ['explosion', 'fire-loop', 'pickup-sparkle', 'black-hole', 'slash', 'heal']) { const l = LIB.find((x) => x.id === id); p.createEffect({ name: l.name, code: l.code, by: id === 'fire-loop' ? 'you' : 'claude', from: 'library:' + id }); }
  // a sprite drawn the way Claude draws: pixel rows + ops, four frames of a slime bounce
  const s = SP.create({ name: 'Slime idle', w: 16, h: 16, palette: 'sweetie16', frames: 4, fps: 6 });
  const rows = ['......0000......', '....00555500....', '...0555666650...', '..05c566666650..', '..0cc666666660..', '.05666666666660.', '.06606666606660.', '.06666666666670.', '.07666666666770.', '..077777777770..', '...0000000000...'];
  [0, 1, 2, 1].forEach((sq, f) => { const r = sq ? [rows[0], ...rows.slice(1 + sq)] : rows; SP.apply(s, [{ op: 'pixels', x: 0, y: 15 - r.length, rows: r }, { op: 'line', x1: 4, y1: 15, x2: 11, y2: 15, color: 15 }], { frame: f }); });
  p.saveSprite(s);
  const wz = SP.create({ name: 'Wizard', w: 64, h: 64, palette: [], frames: 1 }); SP.apply(wz, [{ op: 'svg', svg: WIZARD }]); delete wz._warnings; p.saveSprite(wz);
  const ex = FX.render(lib('explosion')); const bs = SP.fromFrames({ name: 'Explosion (baked)', w: ex.meta.w, h: ex.meta.h, frames: ex.frames, durations: ex.meta.durations, palette: ex.meta.palette }); bs.from = { effect: 'explosion' }; p.saveSprite(bs);
  const coin = SP.create({ name: 'Coin spin', w: 12, h: 12, palette: 'pico8', frames: 6, fps: 10 });
  [5, 4, 2, 1, 2, 4].forEach((rx, f) => SP.apply(coin, [{ op: 'ellipse', x: 5.5, y: 5.5, rx: rx + 0.01, ry: 5, color: 9, fill: true }, { op: 'ellipse', x: 5.5, y: 5.5, rx: Math.max(0.5, rx - 1.5), ry: 3.5, color: 10, fill: true }, { op: 'outline', color: 4 }], { frame: f })); p.saveSprite(coin);
  // a reference picture
  const ref = path.join(root, 'poe2-lightning.png'); const r = FX.render(lib('lightning')); fs.writeFileSync(ref, png.encode(sheets.scaleImage({ w: r.meta.w, h: r.meta.h, data: sheets.onBackground(r.frames[1], r.meta.w, r.meta.h, '#0b0f2e') }, 6)));
  p.addRef(ref, 'The white core and the cyan rim — keep the core 1px wide.'); p.patchRef(p.meta.refs[0].id, { title: 'Path of Exile 2 — arc' });
  // 0.4: a tileset built from five pieces, a big backdrop drawn as SVG and textured, and a parallax scene
  const TL = require('../../src/core/tiles'), DT = require('../../src/core/detail');
  const T = 16, G = '#38b764', Lt = '#a7f070', Dk = '#257179', Dirt = '#8a5a3a';
  const piece = (f) => { const c = new FX.Canvas(T, T, ['#000']); f(c); return { w: T, h: T, data: DT.texture(c.data, T, T, { kind: 'grass', scale: 3, colors: [G] }).data }; };
  const P5 = { fill: piece((c) => c.fillRect(0, 0, T, T, G)), top: piece((c) => { c.fillRect(0, 4, T, T - 4, G); c.line(0, 4, T - 1, 4, Lt); c.fillRect(0, 5, T, 1, Lt); }), left: piece((c) => { c.fillRect(4, 0, T - 4, T, G); c.line(4, 0, 4, T - 1, Dk); }),
    outer: piece((c) => { c.fillRect(6, 6, T - 6, T - 6, G).fillRect(4, 8, 2, T - 8, G).fillRect(8, 4, T - 8, 2, G).fillCircle(8, 8, 3.2, G); c.line(8, 4, T - 1, 4, Lt).line(4, 8, 4, T - 1, Dk).px(5, 6, Dk).px(6, 5, Lt).px(5, 7, Dk).px(7, 5, Lt).px(6, 6, G); }),
    inner: piece((c) => { c.fillRect(0, 0, T, T, G).fillRect(0, 0, 4, 4, null).line(0, 4, 3, 4, Lt).line(4, 0, 4, 3, Dk); }) };
  const pieces = SP.create({ name: 'Grass pieces', w: T, h: T, palette: [G, Lt, Dk, Dirt], frames: 5 }); ['fill', 'top', 'left', 'outer', 'inner'].forEach((k, i) => SP.setCel(pieces, pieces.layers[0].id, pieces.frames[i].id, P5[k].data)); p.saveSprite(pieces);
  const ts = TL.autotile(P5); const tset = SP.create({ name: 'Grass', w: ts.sheet.w, h: ts.sheet.h, palette: [G, Lt, Dk], frames: 1 }); SP.setCel(tset, tset.layers[0].id, tset.frames[0].id, ts.sheet.data); tset.tileset = { tile: T, kind: ts.kind, cols: ts.cols, masks: ts.masks, count: ts.count, terrain: 'Grass' }; p.saveSprite(tset);
  const skySvg = `<svg viewBox="0 0 640 180"><rect width="640" height="180" fill="#29366f"/><rect y="70" width="640" height="110" fill="#3b5dc9"/><rect y="120" width="640" height="60" fill="#41a6f6"/><circle cx="470" cy="60" r="26" fill="#ffcd75"/><circle cx="470" cy="60" r="20" fill="#f4f4f4"/></svg>`;
  const sky = SP.create({ name: 'Sky', w: 640, h: 180, palette: [], frames: 1 }); SP.apply(sky, [{ op: 'svg', svg: skySvg, mode: 'replace' }]); delete sky._warnings; p.saveSprite(sky);
  const hillsSvg = `<svg viewBox="0 0 320 90"><path d="M0 90 L0 50 Q40 20 80 46 Q120 70 160 40 Q200 12 240 42 Q280 66 320 50 L320 90 Z" fill="#257179"/><path d="M0 90 L0 70 Q50 52 100 68 Q150 82 200 64 Q260 46 320 70 L320 90 Z" fill="#38b764"/></svg>`;
  const hills = SP.create({ name: 'Hills', w: 320, h: 90, palette: [], frames: 1 }); SP.apply(hills, [{ op: 'svg', svg: hillsSvg, mode: 'replace' }, { op: 'texture', kind: 'grass', scale: 4, colors: ['#38b764'] }]); delete hills._warnings; p.saveSprite(hills);
  const castleSvg = `<svg viewBox="0 0 512 384"><rect x="96" y="120" width="320" height="240" fill="#8b9bb4"/><rect x="64" y="64" width="96" height="296" fill="#94b0c2"/><rect x="352" y="64" width="96" height="296" fill="#94b0c2"/><path d="M64 64 L112 8 L160 64 Z" fill="#b13e53"/><path d="M352 64 L400 8 L448 64 Z" fill="#b13e53"/><rect x="216" y="248" width="80" height="112" rx="38" fill="#333c57"/><rect x="112" y="150" width="24" height="40" fill="#1a1c2c"/><rect x="376" y="150" width="24" height="40" fill="#1a1c2c"/><rect x="0" y="352" width="512" height="32" fill="#38b764"/></svg>`;
  const castle = SP.create({ name: 'Castle backdrop', w: 512, h: 384, palette: [], frames: 1 }); SP.apply(castle, [{ op: 'svg', svg: castleSvg, mode: 'replace' }, { op: 'texture', kind: 'bricks', scale: 5, colors: ['#8b9bb4', '#94b0c2'] }, { op: 'texture', kind: 'grass', colors: ['#38b764'] }, { op: 'outline', color: '#1a1c2c' }]); delete castle._warnings; p.saveSprite(castle);
  const terr = Array.from({ length: 12 }, (_, y) => (y < 7 ? '.'.repeat(60) : y === 7 ? '.'.repeat(14) + '######' + '.'.repeat(16) + '#####' + '.'.repeat(19) : y === 8 ? '####' + '.'.repeat(8) + '##########' + '.'.repeat(10) + '###########' + '.'.repeat(4) + '#'.repeat(13) : '#'.repeat(60)));
  p.saveScene({ name: 'Level 1 — Meadow', w: 320, h: 180, background: '#29366f', length: 960, layers: [{ id: 'sl1', kind: 'sprite', name: 'Sky', sprite: sky.id, x: 0, y: 0, depth: 0, repeat: 'x' }, { id: 'sl2', kind: 'sprite', name: 'Hills', sprite: hills.id, x: 0, y: 92, depth: 0.35, repeat: 'x' }, { id: 'sl3', kind: 'tiles', name: 'Grass', tileset: tset.id, tile: T, x: 0, y: -12, depth: 1, rows: terr }, { id: 'sl4', kind: 'sprite', name: 'Slime', sprite: s.id, x: 120, y: 100, depth: 1, animate: true }] });
  // 0.5: two character pictures (a side-view knight, a front-view hero) and a sword
  const kn = new FX.Canvas(40, 52, ['#000']); kn.fillRect(15, 34, 5, 12, '#333c57').fillRect(19, 34, 5, 12, '#333c57').fillRect(15, 45, 8, 3, '#5a3a24').fillRect(19, 45, 8, 3, '#5a3a24').fillRect(13, 18, 12, 17, '#5d6b8c').fillRect(14, 19, 4, 15, '#8b9bb4').fillRect(13, 31, 12, 3, '#b13e53').fillRect(14, 5, 11, 12, '#e8b796').fillRect(13, 3, 13, 5, '#8b9bb4').fillRect(22, 9, 2, 2, '#1a1c2c').fillRect(13, 8, 3, 9, '#8b9bb4').fillRect(17, 19, 4, 9, '#8b9bb4').fillRect(17, 28, 4, 7, '#5d6b8c').fillRect(17, 35, 4, 3, '#e8b796').outline('#1a1c2c');
  p.saveSprite(SP.fromFrames({ name: 'Knight (side)', w: 40, h: 52, frames: [kn.data] }));
  const hf = new FX.Canvas(40, 52, ['#000']); hf.fillRect(13, 33, 6, 13, '#29366f').fillRect(21, 33, 6, 13, '#29366f').fillRect(12, 45, 7, 3, '#333c57').fillRect(21, 45, 7, 3, '#333c57').fillRect(12, 17, 16, 17, '#5d6b8c').fillRect(8, 18, 4, 13, '#5d6b8c').fillRect(28, 18, 4, 13, '#5d6b8c').fillRect(8, 31, 4, 4, '#e8b796').fillRect(28, 31, 4, 4, '#e8b796').fillRect(13, 31, 14, 3, '#b13e53').fillRect(14, 4, 12, 12, '#e8b796').fillRect(13, 2, 14, 5, '#8b9bb4').fillRect(16, 9, 2, 2, '#1a1c2c').fillRect(22, 9, 2, 2, '#1a1c2c').outline('#1a1c2c');
  p.saveSprite(SP.fromFrames({ name: 'Knight (front)', w: 40, h: 52, frames: [hf.data] }));
  const sw = new FX.Canvas(5, 16, ['#000']); sw.fillRect(2, 0, 1, 11, '#f4f4f4').fillRect(1, 1, 1, 10, '#c0cbdc').fillRect(3, 1, 1, 10, '#8b9bb4').fillRect(0, 11, 5, 1, '#ffcd75').fillRect(2, 12, 1, 4, '#5a3a24'); p.saveSprite(SP.fromFrames({ name: 'Sword', w: 5, h: 16, frames: [sw.data] }));
  L.create('Football Hub site');
  return { L, p, board: b, ids };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dither-e2e-'));
  const sd = seed(tmp);
  const app = await _electron.launch({ executablePath: require('electron'), args: ['--no-sandbox', path.join(__dirname, '..', '..')], env: { ...process.env, DITHER_E2E: '1', DITHER_USER_DATA: path.join(tmp, 'data'), DITHER_PROJECTS: path.join(tmp, 'Dither'), HOME: tmp, DITHER_CLAUDE: path.join(tmp, 'none'), DITHER_CODEX: path.join(tmp, 'none') } });
  const errors = []; app.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  let win = null; for (let i = 0; i < 100 && !win; i++) { win = app.windows().find((w) => w.url().includes('renderer/index.html')); if (!win) await new Promise((r) => setTimeout(r, 200)); } win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); win.on('pageerror', (e) => errors.push(String(e)));
  await win.setViewportSize({ width: 1440, height: 900 });
  await win.waitForSelector('body.ready');
  await win.evaluate((id) => call('projects:open', id), sd.p.id); await win.evaluate(() => loadProject().then(() => go('drafts')));
  const theme = async (t) => { await win.evaluate((x) => { document.documentElement.dataset.theme = x; for (const p of Players.set) p.draw(); }, t); };
  const shot = async (name, wait = 900) => { await win.waitForTimeout(wait); await win.screenshot({ path: path.join(OUT, name + '.png') }); console.log('shot', name); };
  const go = (v, a) => win.evaluate(([v, a]) => go(v, a), [v, a]);

  for (const t of ['dark', 'light']) {
    await theme(t); const k = t === 'dark' ? '' : '-light';
    await go('drafts'); await win.waitForSelector('.draft canvas'); await shot('01-drafts' + k, 1500);
    if (t === 'dark') { await win.click('.draft:first-child .d-stage'); await win.waitForSelector('.review canvas'); await shot('02-review', 1200); await win.keyboard.press('Escape'); }
    await go('effects'); await shot('03-effects' + k, 1500);
    await go('lab', sd.ids[0]); await win.waitForSelector('#labStrip .fs'); await shot('04-lab' + k, 1500);
    if (t === 'dark') { await win.click('.lab-tabs [data-tab=notes]'); await shot('05-lab-notes', 500); await win.click('.lab-tabs [data-tab=versions]'); await shot('05b-lab-versions', 500); }
    await go('sprites'); await shot('06-sprites' + k, 1200);
    const sid = await win.evaluate(() => S.sprites.find((s) => s.name === 'Slime idle').id);
    await go('editor', sid); await win.waitForSelector('#tlFrames .tf'); await shot('07-editor' + k, 900);
    if (t === 'dark') {
      // draw something with the pencil and a box, check undo
      const box = await win.$eval('#edCanvas', (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; });
      const cell = await win.evaluate(() => ({ z: E.zoom, ox: E.ox, oy: E.oy }));
      const at = (x, y) => [box.x + cell.ox + (x + 0.5) * cell.z, box.y + cell.oy + (y + 0.5) * cell.z];
      await win.click('[data-tool=pencil]'); await win.mouse.move(...at(2, 2)); await win.mouse.down(); await win.mouse.move(...at(6, 2), { steps: 4 }); await win.mouse.up();
      const filled = await win.evaluate(() => { const c = E.s.cels[`${E.li}/${E.s.frames[E.fi].id}`]; return c[(2 * 16 + 4) * 4 + 3]; });
      console.log('pencil drew:', filled === 255);
      await win.keyboard.press('Control+z'); const undone = await win.evaluate(() => { const c = E.s.cels[`${E.li}/${E.s.frames[E.fi].id}`]; return c[(2 * 16 + 4) * 4 + 3]; }); console.log('undo works:', undone === 0);
      await win.keyboard.press('Control+Shift+z');
      await shot('07b-editor-drawn', 600);
    }
    await go('refs'); await shot('08-refs' + k, 900);
    await go('library'); await shot('09-library' + k, 1800);
    await go('make'); await shot('10-make' + k, 1500);
    await go('connections'); await shot('11-connections' + k, 1200);
    if (t === 'dark') { await go('settings'); await shot('12-settings', 600); }
  }
  // the detail kit in the editor: Shade sheet, then Critique
  await theme('dark'); const wid = await win.evaluate(() => S.sprites.find((s) => s.name === 'Wizard').id);
  await go('editor', wid); await win.waitForSelector('#tlFrames .tf'); await shot('17-wizard-flats', 600);
  await win.click('#edShade'); await win.waitForSelector('.sh-row'); await shot('18-shade-sheet', 1400);
  await win.click('#shGo'); await win.waitForTimeout(800); await shot('19-wizard-shaded', 600);
  await win.click('#edCrit'); await win.waitForSelector('.crit-h'); await shot('20-critique', 800);
  await win.click('.crit-it'); await shot('21-critique-focus', 500);
  await theme('light'); await shot('20-critique-light', 600); await theme('dark');
  // Animate: an empty view, the engine sheet, a real H.264 import through the sandbox, a local run on a stand-in ComfyUI, the convert sheet
  const comfy = await require('../fixtures/fake-comfy').start();
  await win.evaluate((u) => call('settings:set', { comfyUrl: u, animateEngine: 'local' }).then((s) => (S.settings = s)), comfy.url);
  await go('animate'); await win.waitForSelector('#anGo'); await shot('22-animate-empty', 1500);
  await win.click('#anEngine'); await win.waitForSelector('#egClose'); await shot('23-engines', 1200); await win.click('#egClose');
  const vdir = path.join(tmp, 'v'); fs.mkdirSync(vdir);
  for (let i = 0; i < 36; i++) { const t = (i % 24) / 24, W = 320; const g = new FX.Canvas(W, W, ['#00ff00']); g.clear('#1fd640'); const cx = 150, bob = Math.sin(t * Math.PI * 2) * 8, by = 270;
    g.fillRect(cx - 30, by - 10 - Math.max(0, bob), 24, 10, '#3b2a1a').fillRect(cx + 6, by - 10 - Math.max(0, -bob), 24, 10, '#3b2a1a').fillEllipse(cx, by - 70 + bob, 40, 60, '#b13e53').fillCircle(cx, by - 150 + bob, 28, '#e8b796').fillRect(cx - 14, by - 160 + bob, 10, 10, '#1a1c2c').fillRect(cx + 6, by - 160 + bob, 10, 10, '#1a1c2c');
    fs.writeFileSync(path.join(vdir, `f${String(i).padStart(3, '0')}.png`), png.encode({ w: W, h: W, data: g.data })); }
  const mp4 = path.join(tmp, 'Hero bob.mp4'); require('child_process').execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '24', '-i', path.join(vdir, 'f%03d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mp4]);
  await win.evaluate((f) => importClip(f), mp4); await win.waitForSelector('#cvKeep'); await win.waitForFunction(() => !/Working/.test(document.querySelector('#cvBi').textContent), null, { timeout: 30000 });
  console.log('import (H.264 via sandbox):', await win.evaluate(() => document.querySelector('#cvBi').textContent));
  await win.click('#cvL'); await win.waitForTimeout(400); await win.waitForFunction(() => !/Working/.test(document.querySelector('#cvBi').textContent));
  await shot('24-convert', 1500);
  await win.click('#cvKeep'); await win.waitForSelector('#tlFrames .tf'); await shot('25-clip-sprite-editor', 900);
  await go('animate'); const slime = await win.evaluate(() => S.sprites.find((s) => s.name === 'Slime idle').id);
  await win.selectOption('#anSprite', slime); await win.waitForTimeout(600); await win.click('#anPresets [data-p=idle]').catch(() => {});
  await win.click('#anGo'); await win.waitForSelector('#cvKeep', { timeout: 60000 }); await win.waitForFunction(() => !/Working/.test(document.querySelector('#cvBi').textContent), null, { timeout: 30000 });
  console.log('local Animate (stand-in ComfyUI):', comfy.seen.graphs.length, 'graph(s),', await win.evaluate(() => document.querySelector('#cvBi').textContent));
  await win.keyboard.press('Escape'); await win.waitForTimeout(400); await shot('26-animate-clips', 1500);
  await theme('light'); await shot('26-animate-clips-light', 900); await theme('dark'); comfy.close();
  // 0.4: tiles & scenes, a big canvas in the editor, the texture brush, normal map sheet, more starter effects
  await go('tiles'); await win.waitForSelector('[data-scene] canvas'); await shot('27-tiles', 1800);
  const scId = await win.evaluate(() => TS.scenes[0].id); await go('scene', scId); await win.waitForSelector('#scCv'); await shot('28-scene', 1500);
  await win.click('#scLayers .ly:nth-child(2)'); await win.waitForSelector('#lpPaint'); await win.click('#lpPaint'); await win.waitForTimeout(500);
  const gb = await win.$('#scGrid'); const bb = await gb.boundingBox(); await win.mouse.move(bb.x + bb.width * 0.62, bb.y + bb.height * 0.45); await win.mouse.down(); await win.mouse.move(bb.x + bb.width * 0.8, bb.y + bb.height * 0.45, { steps: 8 }); await win.mouse.up();
  await shot('29-scene-paint', 1500);
  await win.evaluate(() => { TS.cam = 400; paintScene(); }); await shot('29b-scene-pan', 1200);
  await theme('light'); await shot('28-scene-light', 900); await theme('dark');
  await go('tiles'); await win.click('#tsNewSet'); await win.waitForSelector('#tnGo'); await shot('30-new-tileset', 700); await win.keyboard.press('Escape');
  const cid = await win.evaluate(() => S.sprites.find((s) => s.name === 'Castle backdrop').id); await go('editor', cid); await win.waitForSelector('#tlFrames .tf'); await shot('31-big-canvas', 1200);
  const t0 = Date.now(); await win.evaluate(() => { setTool('pencil'); }); const cvb = await (await win.$('#edCanvas canvas')).boundingBox(); await win.mouse.move(cvb.x + cvb.width * 0.3, cvb.y + cvb.height * 0.3); await win.mouse.down(); for (let i = 0; i < 30; i++) await win.mouse.move(cvb.x + cvb.width * (0.3 + i * 0.01), cvb.y + cvb.height * (0.3 + i * 0.006)); await win.mouse.up(); console.log('big canvas: 30 pencil moves in', Date.now() - t0, 'ms');
  console.log('big canvas undo keeps a box:', await win.evaluate(() => { const u = E.undo[E.undo.length - 1]; return u && u.kind === 'box' ? `${u.w}×${u.h}` : u && u.kind; }));
  await win.evaluate(() => setTool('texture')); await win.waitForSelector('#eoTex'); await win.selectOption('#eoTex', 'scales'); await win.click('#edOpts [data-tb="32"]');
  await win.mouse.move(cvb.x + cvb.width * 0.45, cvb.y + cvb.height * 0.62); await win.mouse.down(); await win.waitForTimeout(400); for (let i = 0; i < 12; i++) await win.mouse.move(cvb.x + cvb.width * (0.45 + i * 0.006), cvb.y + cvb.height * 0.62); await win.mouse.up(); await win.waitForTimeout(300);
  console.log('texture brush painted:', await win.evaluate(() => { const u = E.undo[E.undo.length - 1]; return u && u.kind === 'box' ? `${u.w}×${u.h}` : String(u && u.kind); }));
  await shot('32-texture-brush', 600);
  await go('editor', wid); await win.waitForSelector('#tlFrames .tf'); await win.evaluate(() => lightSheet()); await win.waitForSelector('#lmApply'); await shot('33-light-sheet', 1500); await win.keyboard.press('Escape');
  await go('library'); await shot('34-library-more', 2500);
  // 0.5: characters — make one from a sprite, rig view, animate with a bone dragged, directions, skins & gear, export
  const knId = await win.evaluate(() => S.sprites.find((x) => x.name === 'Knight (side)').id), knF = await win.evaluate(() => S.sprites.find((x) => x.name === 'Knight (front)').id), swId = await win.evaluate(() => S.sprites.find((x) => x.name === 'Sword').id);
  await go('characters'); await shot('35-characters-empty', 800);
  await win.click('#chNew'); await win.waitForSelector('#ncGo'); await win.selectOption('#ncSprite', knId); await win.click('#ncDirs [data-d="4"]'); await win.waitForTimeout(400); await shot('36-new-character', 700);
  await win.click('#ncGo'); await win.waitForSelector('#ceOv', { timeout: 60000 }); await win.waitForTimeout(1500); await shot('37-rig', 900);
  const cId = await win.evaluate(() => CHS.c.id); console.log('character notes:', await win.evaluate(() => [...$$('.toast')].map((t) => t.textContent).join(' | ').slice(0, 300)));
  // drag the near elbow a little, then show the parts
  const ovb = await (await win.$('#ceOv')).boundingBox(); const jt = await win.evaluate(() => CHS.overlay.joints.elbow_f); const sc0 = await win.evaluate(() => CHS.scale);
  await win.mouse.move(ovb.x + jt[0] * sc0, ovb.y + jt[1] * sc0); await win.mouse.down(); await win.mouse.move(ovb.x + (jt[0] + 2) * sc0, ovb.y + (jt[1] + 1) * sc0, { steps: 5 }); await win.mouse.up(); await win.waitForTimeout(1500);
  console.log('elbow moved to', await win.evaluate(() => CHS.c.views.side.joints.elbow_f));
  await win.click('#crParts'); await win.waitForTimeout(900); await shot('38-rig-parts', 600);
  // add the front view from a sprite and mirror it for the back, via IPC (the menus do the same)
  await win.evaluate(async ([id, f]) => { CHS.c = (await call('chars:addView', id, 'front', { sprite: f }, {})).character; CHS.c = (await call('chars:addView', id, 'back', { mirrorOf: 'front' }, {})).character; }, [cId, knF]);
  await win.click('#ceTabs [data-t="animate"]'); await win.waitForTimeout(1200); await shot('39-animate', 900);
  // key a pose: click the near upper arm and turn it
  const bones = await win.evaluate(() => CHS.overlay && CHS.overlay.bones.find((b) => b.name === 'upper_arm_f')); const ox = await win.evaluate(() => [CHS.overlay.ox, CHS.overlay.oy, CHS.scale]); const ovb2 = await (await win.$('#ceOv')).boundingBox();
  const mid = [(bones.start[0] + bones.end[0]) / 2, (bones.start[1] + bones.end[1]) / 2]; await win.mouse.move(ovb2.x + (mid[0] - ox[0]) * ox[2], ovb2.y + (mid[1] - ox[1]) * ox[2]); await win.mouse.down(); await win.mouse.move(ovb2.x + (mid[0] - ox[0] + 6) * ox[2], ovb2.y + (mid[1] - ox[1] - 2) * ox[2], { steps: 6 }); await win.mouse.up(); await win.waitForTimeout(1200);
  console.log('keyed:', await win.evaluate(() => JSON.stringify((CHS.c.animations.find((a) => a.id === CHS.anim).keys || {}).side)));
  await shot('40-pose-key', 600);
  await win.click('#ceTabs [data-t="dirs"]'); await win.waitForTimeout(1500); await shot('41-directions', 900);
  await win.evaluate(async ([id, sw]) => { CHS.c = await call('chars:skin', id, { action: 'attach', sprite: sw, bone: 'hand_f', py: 13 }); CHS.c = await call('chars:skin', id, { action: 'add', name: 'Gold', recolor: { '#5d6b8c': '#ffcd75', '#8b9bb4': '#f4f4f4' } }); }, [cId, swId]);
  await win.click('#ceTabs [data-t="skins"]'); await win.waitForTimeout(1600); await shot('42-skins', 900);
  await win.evaluate(() => { CHS.dir = 'down'; CHS.previewFrames = null; drawBar(); loadPreview(); }); await win.waitForTimeout(1500); await shot('42b-skin-down', 600);
  await theme('light'); await shot('42c-skins-light', 700); await theme('dark');
  const ex = await win.evaluate(async (id) => call('export', { kind: 'character', id, format: 'all', dest: undefined }), cId); console.log('character export:', ex.files.length, 'files, e.g.', ex.files.slice(0, 6).join(', '));
  await go('characters'); await win.waitForTimeout(1500); await shot('43-characters', 900);
  // the pose model on a real photo (if given) and motion from video
  if (process.env.DITHER_POSE_PHOTO && fs.existsSync(process.env.DITHER_POSE_PHOTO)) {
    const r = await win.evaluate(async (f) => call('chars:create', { name: 'Yoga', source: { file: f }, view: 'front', pixel: true, height: 96, directions: 4 }), process.env.DITHER_POSE_PHOTO);
    console.log('photo → joints:', r.notes.join(' | '));
    const vdir2 = path.join(tmp, 'pv'); fs.mkdirSync(vdir2); require('child_process').execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-i', process.env.DITHER_POSE_PHOTO, '-t', '1', '-vf', "scale=640:-2,rotate='0.06*sin(2*PI*t)':c=white", '-r', '12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(vdir2, 'pose.mp4')]);
    const v = await win.evaluate(async ([id, f]) => { const x = await call('chars:fromVideo', id, { file: f, name: 'from video', view: 'front', frames: 8 }); return { detected: x.detected, of: x.of, frames: x.anim.frames }; }, [r.character.id, path.join(vdir2, 'pose.mp4')]);
    console.log('motion from video:', JSON.stringify(v));
    await go('character', r.character.id); await win.waitForSelector('#ceOv'); await win.waitForTimeout(1500); await shot('44-photo-rig', 900);
  }
  await go('drafts');
  await win.evaluate(() => askClaude('Make 6 drafts of a coin pickup')); await shot('13-ask', 600); await win.keyboard.press('Escape');
  // the pixelize sheet on a soft AI-ish picture
  const soft = path.join(tmp, 'soft-knight.png'); const c = new FX.Canvas(24, 24, 'sweetie16'); c.clear(12).fillCircle(12, 9, 5, 9).fillRect(8, 13, 9, 8, 3).fillRect(9, 21, 3, 2, 15).fillRect(13, 21, 3, 2, 15).outline(0); fs.writeFileSync(soft, png.encode(sheets.scaleImage(c.toImage(), 9)));
  await win.evaluate((f) => pixelizeSheet(f), soft); await win.waitForSelector('#pxOutBox canvas'); await shot('14-pixelize', 1500); await win.keyboard.press('Escape');
  // the plugin end to end through the app: create drafts the way Claude does, and watch the board update
  const r = await win.evaluate(async (code) => { const res = await call('record', { kind: 'effect', id: S.effects[0].id }); return res; }, null);
  console.log('record:', r.files.map((f) => path.basename(f)).join(', '));
  const webm = await win.evaluate(async () => { const r = await call('fx:renderEffect', S.effects[0].id, {}); return call('save:webm', r.frames, r.meta, 'e2e'); }).catch((e) => 'webm failed: ' + e.message);
  console.log('webm:', typeof webm === 'string' && webm.endsWith('.webm') ? `${path.basename(webm)} ${fs.statSync(webm).size} bytes` : webm);
  const bad = await win.evaluate(() => call('fx:render', 'effect({ size:[8,8], draw(g){ while(true){} } })').then(() => 'no error', (e) => e.message));
  console.log('endless loop stopped:', bad);
  const net = await win.evaluate(() => call('fx:render', "effect({ size:[8,8], frames:1, draw(g){ if (typeof fetch !== 'undefined') { try { importScripts('https://example.com/x.js'); g.px(0,0,7); } catch (e) {} } } })").then((r) => r.frames[0][3], (e) => e.message));
  console.log('sandbox blocks network (expect 0):', net);
  // the real plugin path: the stdio MCP server → the app's bridge → the sandbox → the window updates live
  const { spawn } = require('child_process');
  const mcp = spawn(process.execPath, [path.join(__dirname, '..', '..', 'mcp', 'dither-mcp.js')], { env: { ...process.env, DITHER_BRIDGE: path.join(tmp, 'data', 'bridge.json') }, stdio: ['pipe', 'pipe', 'inherit'] });
  const replies = {}; let buf = ''; mcp.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); replies[m.id] = m; buf = buf.slice(i + 1); } });
  const rpc = async (id, method, params) => { mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); for (let k = 0; k < 300 && !replies[id]; k++) await new Promise((r) => setTimeout(r, 100)); return replies[id]; };
  await rpc(1, 'initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'claude-code' } });
  const drafts = ['pickup-sparkle', 'impact', 'heal'].map((id, i) => ({ name: ['Burst pop', 'Star hit', 'Rising cross'][i], code: lib(id), note: 'take ' + (i + 1) }));
  const cd = await rpc(2, 'tools/call', { name: 'create_drafts', arguments: { idea: 'Coin pickup', drafts } });
  const cdText = cd.result.content.find((c) => c.type === 'text').text; const cdImg = cd.result.content.find((c) => c.type === 'image');
  console.log('MCP create_drafts:', JSON.parse(cdText).drafts.map((d) => d.ok).join(','), 'image', cdImg ? cdImg.data.length + ' b64 chars' : 'missing');
  fs.writeFileSync(path.join(OUT, '16-mcp-board-image.png'), Buffer.from(cdImg.data, 'base64'));
  await win.waitForTimeout(1500); await shot('15-board-from-claude', 1500);
  const sp = await rpc(3, 'tools/call', { name: 'create_sprite', arguments: { name: 'Key', w: 12, h: 12, palette: 'pico8' } }); const sid2 = JSON.parse(sp.result.content[0].text).id;
  const dr = await rpc(4, 'tools/call', { name: 'draw_sprite', arguments: { sprite: sid2, ops: [{ op: 'pixels', x: 1, y: 3, rows: ['.aaa......', 'a...a.....', 'a...aaaaaa', 'a...a..a.a', '.aaa......'] }, { op: 'outline', color: 4 }] } });
  console.log('MCP draw_sprite:', dr.result.isError ? dr.result.content[0].text : 'ok, image ' + !!dr.result.content.find((c) => c.type === 'image'));
  mcp.kill();
  console.log(errors.length ? 'console errors:\n' + errors.join('\n') : 'no console errors');
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
