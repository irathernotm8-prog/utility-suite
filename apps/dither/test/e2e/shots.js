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
