// RO2 end-to-end: drives the real window (clicks, typing, drags) and saves screenshots to test/e2e-out.
// Run: npm run e2e   (Linux: under Xvfb via test/e2e.sh). AI checks run when the models are in RO2_MODELS.
'use strict';
const fs = require('fs'); const path = require('path');
const OUT = process.env.RO2_E2E_OUT || path.join(__dirname, 'e2e-out');
const FIX = path.join(__dirname, 'fixtures');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function drive({ win, app }) {
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
  const wc = win.webContents; let n = 0; const results = [];
  const log = (l) => { console.log(l); fs.appendFileSync(path.join(OUT, 'log.txt'), l + '\n'); };
  const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok }); log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' · ' + extra : ''}`); };
  const errors = [];
  wc.on('console-message', (e) => { const level = e.level ?? e.params?.level; const msg = e.message ?? e.params?.message; if (level === 'error' || level === 3) errors.push(msg); });
  const js = (code) => wc.executeJavaScript(`(async () => { ${code} })()`);
  const shot = async (name) => { await sleep(250); const img = await wc.capturePage(); fs.writeFileSync(path.join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`), img.toPNG()); };
  const rect = (sel) => js(`const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height } : null;`);
  const click = async (x, y, { button = 'left', count = 1, mods = [] } = {}) => { wc.sendInputEvent({ type: 'mouseMove', x, y }); await sleep(30); wc.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount: count, modifiers: mods }); await sleep(40); wc.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount: count, modifiers: mods }); await sleep(120); };
  const clickSel = async (sel) => { const r = await rect(sel); if (!r) throw new Error('missing ' + sel); await click(r.x, r.y); return r; };
  const drag = async (x0, y0, x1, y1, steps = 12, mods = []) => { wc.sendInputEvent({ type: 'mouseMove', x: x0, y: y0 }); wc.sendInputEvent({ type: 'mouseDown', x: x0, y: y0, button: 'left', clickCount: 1, modifiers: mods }); for (let i = 1; i <= steps; i++) { wc.sendInputEvent({ type: 'mouseMove', x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps, modifiers: mods, button: 'left' }); await sleep(16); } wc.sendInputEvent({ type: 'mouseUp', x: x1, y: y1, button: 'left', clickCount: 1, modifiers: mods }); await sleep(150); };
  const key = async (keyCode, mods = []) => { wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers: mods }); if (keyCode.length === 1) wc.sendInputEvent({ type: 'char', keyCode, modifiers: mods }); wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers: mods }); await sleep(80); };
  const type = async (text) => { for (const ch of text) { wc.sendInputEvent({ type: 'char', keyCode: ch }); await sleep(8); } await sleep(100); };
  const E = 'window.__ro2.editor';
  const clickText = async (scope, text) => { const r = await js(`const els = [...document.querySelectorAll(${JSON.stringify(scope)})]; const el = els.find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!el) return els.map(b => b.textContent.trim()).join('|'); el.click(); return true;`); if (r !== true) throw new Error(`no "${text}" in ${scope}: ${r}`); await sleep(150); };
  // scene point → window point
  const toScreen = (x, y) => js(`const ed = ${E}; const r = document.getElementById('canvasHost').getBoundingClientRect(); const v = ed.canvas.viewportTransform; return { x: r.left + ${x} * v[0] + v[4], y: r.top + ${y} * v[3] + v[5] };`);
  const fixture = (f) => 'data:image/jpeg;base64,' + fs.readFileSync(path.join(FIX, f)).toString('base64');
  const hasModels = await js(`return (await window.ro2.models.list()).filter(m => m.installed).map(m => m.id)`);

  try {
    await sleep(2500);
    await shot('home');
    check('home shows templates and sizes', await js(`return document.querySelectorAll('.tcard').length === 8 && document.querySelectorAll('.preset').length === 8`));

    // ── new design from a size ──
    await clickSel('.preset');
    await sleep(900);
    check('Instagram post opens the editor at 1080×1080', await js(`return ${E}.W === 1080 && ${E}.H === 1080 && !document.getElementById('editor').classList.contains('hidden')`));
    await shot('editor-empty-templates');

    // ── elements panel: add a shape by clicking a tile, then by dragging ──
    await clickSel('.rail-btn[data-id="elements"]'); await sleep(300);
    await shot('panel-elements');
    await clickSel('#drawerInner .tile[title="Star"]'); await sleep(200);
    check('clicking a shape adds it to the page', await js(`return ${E}.userObjects().length === 1 && ${E}.active()?.ro2Shape === 'star'`));
    await shot('shape-selected');
    // drag it by the mouse to the right
    let o = await js(`const a = ${E}.active(); return { x: a.left, y: a.top }`);
    let p0 = await toScreen(o.x, o.y), p1 = await toScreen(o.x + 220, o.y - 120);
    await drag(p0.x, p0.y, p1.x, p1.y);
    let o2 = await js(`const a = ${E}.active(); return { x: a.left, y: a.top }`);
    check('dragging moves the shape', Math.abs(o2.x - o.x - 220) < 8 && Math.abs(o2.y - o.y + 120) < 8, `${Math.round(o2.x)},${Math.round(o2.y)}`);
    // drag to near the centre: it should snap to the page centre
    p0 = await toScreen(o2.x, o2.y); p1 = await toScreen(543, 538);
    await drag(p0.x, p0.y, p1.x, p1.y);
    o2 = await js(`const a = ${E}.active(); return { x: a.left, y: a.top }`);
    check('snaps to the page centre', Math.abs(o2.x - 540) < 0.6 && Math.abs(o2.y - 540) < 0.6, `${o2.x.toFixed(1)},${o2.y.toFixed(1)}`);
    // resize from the corner handle
    const sz0 = await js(`return ${E}.active().getScaledWidth()`);
    const br = await js(`const a = ${E}.active(); const c = a.oCoords.br; const r = document.getElementById('canvasHost').getBoundingClientRect(); return { x: r.left + c.x, y: r.top + c.y }`);
    await drag(br.x, br.y, br.x + 60, br.y + 60);
    const sz1 = await js(`return ${E}.active().getScaledWidth()`);
    check('corner handle resizes', sz1 > sz0 * 1.1, `${Math.round(sz0)} → ${Math.round(sz1)}`);
    // colour from the bar
    await clickSel('#ctxbar .cb-color'); await sleep(200);
    await shot('color-picker');
    await clickSel('.popover .sw button[title="#ff5757"]');
    check('fill colour from the picker', await js(`return ${E}.active().fill === '#ff5757'`));
    await key('Escape');
    // gradient
    await clickSel('#ctxbar .cb-color'); await sleep(150);
    await js(`[...document.querySelectorAll('.popover .seg button')].find(b => b.textContent === 'Gradient').click()`); await sleep(100);
    await js(`document.querySelectorAll('.popover .sw button')[0].click()`); await sleep(150);
    check('gradient fill', await js(`return !!${E}.active().ro2Fill && ${E}.active().fill.type === 'linear'`));
    await shot('gradient-picker');
    await key('Escape');

    // ── text ──
    await clickSel('.rail-btn[data-id="text"]'); await sleep(400);
    await shot('panel-text');
    await js(`document.querySelector('#drawerInner .text-preset').click()`); await sleep(300);
    check('heading added', await js(`return ${E}.active()?.text === 'Add a heading'`));
    // type into it: double-click enters editing
    o = await js(`const a = ${E}.active(); return { x: a.left, y: a.top }`); p0 = await toScreen(o.x, o.y);
    await click(p0.x, p0.y, { count: 2 }); await sleep(150);
    await js(`const t = ${E}.active(); t.selectAll();`);
    await type('Hello RO2');
    await shot('text-editing');
    await key('Escape'); await sleep(150);
    check('typing replaces the text', await js(`return ${E}.userObjects().some(o => o.text === 'Hello RO2')`));
    await js(`${E}.select(${E}.userObjects().find(o => o.text === 'Hello RO2'))`); await sleep(200);
    await shot('text-selected-ctxbar');
    await clickSel('#ctxbar .cb-font'); await sleep(400);
    await shot('font-picker');
    await js(`[...document.querySelectorAll('.fontlist .f')].find(f => f.textContent.startsWith('Playfair Display')).click()`); await sleep(400);
    check('font change', await js(`return ${E}.active().fontFamily === 'Playfair Display'`));
    await js(`document.querySelector('#ctxbar .cb-size button:last-child').click()`); await sleep(100);
    // text scaled by the corner handle becomes a real font size
    const fs0 = await js(`return ${E}.active().fontSize`);
    const tbr = await js(`const a = ${E}.active(); const c = a.oCoords.br; const r = document.getElementById('canvasHost').getBoundingClientRect(); return { x: r.left + c.x, y: r.top + c.y }`);
    await drag(tbr.x, tbr.y, tbr.x + 40, tbr.y + 20);
    check('scaling text bakes into font size', await js(`const a = ${E}.active(); return a.scaleX === 1 && a.fontSize > ${fs0}`), await js(`return ${E}.active().fontSize.toFixed(1)`));
    await clickSel('.rail-btn[data-id="text"]'); await sleep(200);
    await js(`document.querySelectorAll('#drawerInner .combo')[0].click()`); await sleep(400);
    check('font pairing adds two text boxes selected together', await js(`return ${E}.selected().length === 2`));
    await shot('multi-selected');
    await key('g', ['control']); await sleep(150);
    check('Ctrl+G groups', await js(`return ${E}.kindOf(${E}.active()) === 'group'`));
    await key('g', ['control', 'shift']); await sleep(150);
    check('Ctrl+Shift+G ungroups', await js(`return ${E}.selected().length === 2`));
    await key('Delete'); await sleep(150);

    // ── lines, icons, emoji ──
    await clickSel('.rail-btn[data-id="elements"]'); await sleep(300);
    await js(`document.querySelector('#drawerInner .tile[title="Arrow"]') ? [...document.querySelectorAll('#drawerInner .tile')].find(t => t.title === 'Arrow' && t.innerHTML.includes('<line')).click() : null`); await sleep(200);
    check('arrow line added', await js(`return ${E}.kindOf(${E}.active()) === 'line' && ${E}.active().endCap === 'arrow'`));
    await shot('line-selected');
    await clickSel('#ctxbar .cb-btn[title="Line style"]'); await sleep(200); await shot('line-style'); await key('Escape');
    await js(`[...document.querySelectorAll('#drawerInner .tile')].find(t => t.title === 'rocket').click()`); await sleep(300);
    check('icon added', await js(`return ${E}.active()?.ro2Icon === 'rocket'`));
    await js(`document.querySelector('#drawerInner .search input').value = 'coffee'; document.querySelector('#drawerInner .search input').dispatchEvent(new Event('input'))`); await sleep(400);
    check('icon search finds coffee', await js(`return [...document.querySelectorAll('#drawerInner .tile')].some(t => t.title === 'coffee')`));
    await shot('elements-search');
    await js(`document.querySelector('#drawerInner .search input').value = ''; document.querySelector('#drawerInner .search input').dispatchEvent(new Event('input'))`); await sleep(300);
    await js(`document.querySelector('#drawerInner .tile.emoji').click()`); await sleep(200);
    await shot('page-with-elements');

    // ── photos ──
    await js(`await window.__ro2app.addImage(${JSON.stringify(fixture('person.jpg'))}, { name: 'person.jpg' })`); await sleep(500);
    check('photo added', await js(`return ${E}.kindOf(${E}.active()) === 'image'`));
    await shot('image-selected');
    await clickSel('#ctxbar .cb-btn[title="Edit photo"]'); await sleep(200); await shot('edit-photo-popover'); await key('Escape');
    await clickSel('#ctxbar .cb-btn[title="Adjust"]'); await sleep(800);
    await shot('panel-adjust');
    await js(`[...document.querySelectorAll('#drawerInner .filters button')].find(b => b.textContent === 'Mono').click()`); await sleep(300);
    check('Mono filter applies', await js(`return ${E}.active().filters.length > 0 && ${E}.active().ro2Filter === 'mono'`));
    await js(`[...document.querySelectorAll('#drawerInner .filters button')].find(b => b.textContent === 'Original').click()`); await sleep(200);
    // frame
    await clickSel('#ctxbar .cb-btn[title="Frame"]'); await sleep(200); await shot('frames-popover');
    await js(`document.querySelectorAll('.popover .tile')[1].click()`); await sleep(200);
    check('circle frame masks the photo', await js(`return ${E}.active().ro2Frame === 'circle' && !!${E}.active().clipPath`));
    await shot('framed-photo');
    // crop
    await clickSel('#ctxbar .cb-btn[title="Crop"]'); await sleep(300);
    check('crop mode', await js(`return !!${E}.cropping`));
    await js(`${E}.cropping.setRatio(1)`); await sleep(150);
    await shot('crop-mode');
    await js(`${E}.cropping.done()`); await sleep(200);
    check('crop applied to a square', await js(`const a = ${E}.active(); return Math.abs(a.width - a.height) < 2 && a.visible && !${E}.cropping`), await js(`const a = ${E}.active(); return Math.round(a.width) + 'x' + Math.round(a.height)`));

    // ── position, effects ──
    await clickSel('#ctxbar .cb-btn[title="Position"]'); await sleep(300); await shot('panel-position');
    await clickText('#drawerInner .btn', 'Left');
    check('align left to page', await js(`return Math.abs(${E}.active().getBoundingRect().left) < 1`));
    await clickSel('#ctxbar .cb-btn[title="Effects"]'); await sleep(300);
    await clickText('#drawerInner .chip', 'Soft'); await sleep(150);
    check('soft shadow', await js(`return !!${E}.active().shadow`));
    await shot('panel-effects');

    // ── undo / redo ──
    const before = await js(`return ${E}.userObjects().length`);
    await key('Delete'); await sleep(150);
    await key('z', ['control']); await sleep(400);
    check('undo brings the photo back', await js(`return ${E}.userObjects().length === ${before}`));
    await key('z', ['control', 'shift']); await sleep(400);
    check('redo removes it again', await js(`return ${E}.userObjects().length === ${before - 1}`));
    await key('z', ['control']); await sleep(400);

    // ── background, layers, photos library ──
    await js(`${E}.select(null)`); await clickSel('.rail-btn[data-id="background"]'); await sleep(300);
    await js(`document.querySelectorAll('#drawerInner .tiles.c4 .tile')[2].click()`); await sleep(200);
    check('gradient background', await js(`return !!${E}.pageData.bg.gradient`));
    await shot('panel-background');
    await clickSel('.rail-btn[data-id="layers"]'); await sleep(300); await shot('panel-layers');
    check('layers list every object', await js(`return document.querySelectorAll('#drawerInner .layer').length === ${E}.userObjects().length`));
    await clickSel('.rail-btn[data-id="photos"]'); await sleep(4000);
    const photos = await js(`return document.querySelectorAll('#drawerInner .ph').length`);
    if (photos > 0) check('free photo library loads', true, `${photos} results`);
    else log('  - photo library not reachable from here: ' + (await js(`return document.querySelector('#drawerInner p.small.muted')?.textContent || ''`)));
    await shot('panel-photos');
    await clickSel('.rail-btn[data-id="ai"]'); await sleep(800); await shot('panel-ai');

    // ── pages ──
    await js(`await ${E}.addPage(${E}.page, true)`); await sleep(500);
    check('duplicate page', await js(`return ${E}.doc.pages.length === 2 && ${E}.page === 1 && ${E}.userObjects().length === ${before}`));
    await js(`await ${E}.gotoPage(0)`); await sleep(300);

    // ── resize ──
    await js(`[...document.querySelectorAll('#tbRight .btn')].find(b => b.textContent.trim() === 'Resize').click()`); await sleep(300); await shot('resize-modal');
    await clickText('.size-cats button', 'Social media');
    await js(`[...document.querySelectorAll('.size-opt')].find(b => b.textContent.includes('Instagram story')).click()`); await sleep(100);
    await clickText('.modal-foot .btn', 'Resize'); await sleep(1500);
    check('resized to a story (both pages)', await js(`return ${E}.W === 1080 && ${E}.H === 1920 && ${E}.doc.pages.length === 2`));
    await shot('resized-story');

    // ── export ──
    await js(`document.querySelector('#tbRight .btn.primary').click()`); await sleep(800); await shot('export-modal'); await key('Escape');
    const exp = await js(`
      const R = await import('./js/editor/render.js');
      const c = await R.pageCanvas(${E}, 0, { scale: 0.5 }); const png = await R.toBlob(c, 'image/png');
      const jpg = await R.toBlob(await R.pageCanvas(${E}, 0, { scale: 1, background: '#fff' }), 'image/jpeg', 0.9);
      const webp = await R.toBlob(await R.pageCanvas(${E}, 0, { scale: 1 }), 'image/webp', 0.9);
      const svg = await R.pageSvg(${E}, 0);
      const out = ${JSON.stringify(OUT)};
      await window.ro2.exporter.write(out + '/export.png', new Uint8Array(await png.arrayBuffer()));
      await window.ro2.exporter.write(out + '/export.jpg', new Uint8Array(await jpg.arrayBuffer()));
      await window.ro2.exporter.write(out + '/export.webp', new Uint8Array(await webp.arrayBuffer()));
      await window.ro2.exporter.write(out + '/export.svg', new TextEncoder().encode(svg));
      const svgs = [await R.pageSvg(${E}, 0), await R.pageSvg(${E}, 1)];
      const pdf = await window.ro2.exporter.pdf({ svgs, width: ${E}.W, height: ${E}.H, file: out + '/export.pdf' });
      return { png: c.width + 'x' + c.height, jpg: jpg.size, webp: webp.size, svg: svg.length, pdf: pdf.size };`);
    check('exports PNG / JPG / WebP / SVG / PDF', exp.png === '540x960' && exp.jpg > 1000 && exp.webp > 1000 && exp.svg > 1000 && exp.pdf > 1000, JSON.stringify(exp));

    // ── save, reopen ──
    await js(`await window.__ro2app.saveNow(true)`); await sleep(300);
    const file = await js(`return window.__ro2.file`);
    check('design saved to the designs folder', !!file && fs.existsSync(file), file);
    const count = await js(`return ${E}.userObjects().length`);
    await js(`document.getElementById('brand').click()`); await sleep(1500);
    await shot('home-with-design');
    await js(`document.querySelector('.dcard').click()`); await sleep(1500);
    check('reopened design has the same objects', await js(`return ${E}.userObjects().length === ${count} && ${E}.doc.pages.length === 2`));
    check('reopened photo keeps its frame and crop', await js(`const i = ${E}.userObjects().find(o => o.type === 'image'); return !!i && i.ro2Frame === 'circle' && Math.abs(i.width - i.height) < 2`));


    // ── 0.2: light theme ──
    await js(`(await import('./js/main.js')).setTheme('light')`); await sleep(600);
    check('light theme switches the UI and the workspace', await js(`return document.documentElement.dataset.theme === 'light' && getComputedStyle(document.body).backgroundColor !== 'rgb(11, 13, 16)' && ${E}.canvas.backgroundColor !== '#08090a'`), await js(`return getComputedStyle(document.body).backgroundColor + ' / ' + ${E}.canvas.backgroundColor`));
    await shot('light-editor');
    await clickSel('.rail-btn[data-id="elements"]'); await sleep(400); await shot('light-elements');

    // ── brand kit ──
    const kitId = await js(`const d = await window.ro2.brand.create('Acme Test'); await window.ro2.brand.update(d.active, { name: 'Acme Test', colors: [{ hex: '#ff3366', name: 'Pink' }, { hex: '#1b2a4a', name: 'Navy' }], fonts: { heading: { family: 'Poppins', weight: 800 }, subheading: null, body: { family: 'Inter', weight: 400 } } }); const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="#ff3366"/><rect x="30" y="30" width="40" height="40" fill="#1b2a4a"/></svg>'; await window.ro2.brand.addLogo(d.active, { name: 'Acme mark', bytes: new TextEncoder().encode(svg), ext: 'svg' }); await (await import('./js/panels/brand.js')).loadBrand(); return d.active;`);
    await clickSel('.rail-btn[data-id="brand"]'); await sleep(900); await shot('light-brand-panel');
    check('brand panel shows the kit, logo and colours', await js(`const d = document.getElementById('drawerInner'); return d.textContent.includes('Acme Test') && d.querySelectorAll('.tile.logo').length >= 1 && d.querySelectorAll('[data-hex]').length >= 2`), await js(`const d = document.getElementById('drawerInner'); return d.querySelectorAll('.tile.logo').length + ' logos, ' + d.querySelectorAll('[data-hex]').length + ' colours'`));
    const nb = await js(`return ${E}.userObjects().length`);
    await js(`const B = await import('./js/panels/brand.js'); const k = B.activeKit(); await B.addLogo(k, k.logos[0]);`); await sleep(500);
    check('brand logo goes on the page', await js(`return ${E}.userObjects().length === ${nb} + 1`));
    await js(`(await import('./js/panels/brand.js')).applyColor('#1b2a4a')`); await sleep(200);
    const t1 = await js(`const t = await (await import('./js/panels/brand.js')).addBrandText('heading'); return { f: t.fontFamily, w: t.fontWeight }`);
    check('brand heading uses the kit font', t1.f === 'Poppins' && +t1.w === 800, JSON.stringify(t1));
    await shot('light-brand-added');
    await js(`(await import('./js/main.js')).setTheme('dark')`); await sleep(400);

    // ── QR code ──
    await js(`const O = await import('./js/editor/objects.js'); const g = await O.makeQr(${E}, 'https://example.com/ro2'); ${E}.add(g);`); await sleep(300);
    check('QR code added as an editable group', await js(`const a = ${E}.active(); return a && a.ro2Qr === 'https://example.com/ro2' && a.type === 'group'`));
    await shot('qr');
    // ── curved text ──
    await js(`const O = await import('./js/editor/objects.js'); const t = await O.makeText(${E}, { text: 'CURVED TEXT ROUND', fontFamily: 'Poppins', fontWeight: 800, size: 0.06 }); ${E}.add(t); await O.setCurve(${E}, ${E}.active(), 60);`); await sleep(300);
    check('curve turns text into curved text', await js(`const a = ${E}.active(); return a && a.type.toLowerCase() === 'ro2curvedtext' && a.ro2Curve === 60 && a.width > 50 && a.height > 50`), await js(`const a = ${E}.active(); return a ? a.type + ' ' + Math.round(a.width) + 'x' + Math.round(a.height) : ''`));
    await shot('curved-text');
    const rt = await js(`const f = JSON.parse(JSON.stringify(${E}.toFile())); await window.__ro2app.openDoc(f, window.__ro2.file); await new Promise(r => setTimeout(r, 600)); const c = ${E}.userObjects().find(o => o.ro2Curve === 60); return !!c && c.type.toLowerCase() === 'ro2curvedtext'`);
    check('curved text survives save and reload', rt);
    await js(`const O = await import('./js/editor/objects.js'); const c = ${E}.userObjects().find(o => o.ro2Curve); ${E}.select(c); await O.setCurve(${E}, c, 0);`); await sleep(200);
    check('curve 0 turns it back into a text box', await js(`return ${E}.active()?.type === 'textbox'`));

    // ── several resized copies at once ──
    const nd0 = (await js(`return (await window.ro2.designs.list()).length`));
    await js(`[...document.querySelectorAll('#tbRight .btn')].find(b => b.textContent.trim() === 'Resize').click()`); await sleep(300);
    await js(`[...document.querySelectorAll('.modal label.check')].find(l => l.textContent.includes('copies')).querySelector('input').click()`); await sleep(150);
    await clickText('.size-cats button', 'Social media');
    for (const nm of ['Instagram post', 'Facebook post', 'YouTube thumbnail']) { await js(`[...document.querySelectorAll('.size-opt')].find(b => b.textContent.startsWith(${JSON.stringify(nm)}))?.click()`); await sleep(120); }
    await shot('resize-many');
    const goLabel = await js(`return [...document.querySelectorAll('.modal-foot .btn')].pop().textContent`);
    await js(`[...document.querySelectorAll('.modal-foot .btn')].pop().click()`);
    let okc = false; for (let i = 0; i < 60 && !okc; i++) { await sleep(400); okc = await js(`return !document.querySelector('.busy') && (await window.ro2.designs.list()).length > ${nd0}`); }
    const nd1 = await js(`return (await window.ro2.designs.list()).length`);
    check('resize makes several copies at once', nd1 - nd0 >= 2, `${goLabel}: ${nd0} → ${nd1}`);
    // ── templates panel ──
    await clickSel('.rail-btn[data-id="templates"]'); await sleep(1200); await shot('panel-templates');

    // ── AI studio ──
    if (hasModels.length) {
      log('  models: ' + hasModels.join(', '));
      await js(`await ${E}.addPage(); `); await sleep(300);
      await js(`const i = await window.__ro2app.addImage(${JSON.stringify(fixture('person.jpg'))}, { name: 'person.jpg', fit: 'page' });`); await sleep(500);
      // remove background
      await js(`window.__ro2app.runStudio(${E}.active(), 'removebg')`);
      let ok = false; for (let i = 0; i < 300 && !ok; i++) { await sleep(500); ok = await js(`return !!window.__studio?.alpha && !window.__studio.busyN`); }
      check('background removed', ok);
      await shot('studio-removebg');
      await js(`const s = window.__studio; s.bg.type = 'color'; s.bg.color = '#3fd2ea'; s.buildSide(); s.draw();`); await sleep(300);
      await shot('studio-removebg-colour');
      await js(`const s = window.__studio; s.bg.type = 'transparent'; s.outline.on = true; s.buildSide(); s.draw();`); await sleep(300);
      await shot('studio-removebg-sticker');
      await js(`window.__studio.outline.on = false; window.__studio.doneB.click()`); await sleep(2500);
      const alpha = await js(`const i = ${E}.active(); const c = document.createElement('canvas'); const el = i._originalElement; c.width = el.naturalWidth; c.height = el.naturalHeight; const x = c.getContext('2d'); x.drawImage(el, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let t = 0, o = 0; for (let k = 3; k < d.length; k += 4) { if (d[k] < 10) t++; else if (d[k] > 245) o++; } return { clear: t / (d.length / 4), solid: o / (d.length / 4) };`);
      check('cut-out has a clear background and a solid subject', alpha.clear > 0.4 && alpha.solid > 0.05, JSON.stringify(alpha));
      await shot('editor-after-removebg');
      // magic eraser: a quick brush stroke (erases on release), then click-to-select the whole person and erase
      await js(`${E}.undo()`); await sleep(800);
      await js(`${E}.select(${E}.userObjects().find(o => o.type === 'image'))`);
      await js(`window.__ro2app.runStudio(${E}.active(), 'erase')`); await sleep(1500);
      const st = await js(`const s = window.__studio; const r = s.canvas.getBoundingClientRect(); return { x: r.left + s.view.x, y: r.top + s.view.y, s: s.view.s, W: s.W, H: s.H }`);
      const X = (u) => st.x + u * st.W * st.s, Y = (v) => st.y + v * st.H * st.s;
      await js(`window.__studio.setBrush(40)`);
      await drag(X(0.06), Y(0.95), X(0.14), Y(0.97), 10);
      await shot('studio-erase-painting');
      ok = false; for (let i = 0; i < 300 && !ok; i++) { await sleep(500); ok = await js(`return window.__studio.erased && !window.__studio.busyN`); }
      check('brush stroke erases on release', ok);
      await js(`window.__studio.tool = 'click'; window.__studio.auto = false; window.__studio.buildSide();`); await sleep(400);
      await click(X(0.5), Y(0.55)); ok = false; for (let i = 0; i < 300 && !ok; i++) { await sleep(500); ok = await js(`return window.__studio.hasMask && !window.__studio.busyN`); }
      check('click to select picks the object', ok, await js(`const s = window.__studio; return s.last ? 'iou ' + s.last.masks.map(m => m.iou.toFixed(2)).join('/') : ''`));
      await js(`window.__studio.pickMask(2)`); await sleep(300);
      await click(X(0.5), Y(0.86), { mods: ['shift'] }); for (let i = 0; i < 60; i++) { await sleep(300); if (await js(`return !window.__studio.busyN`)) break; }
      await shot('studio-click-select');
      await js(`window.__studio.eraseNow()`); ok = false; for (let i = 0; i < 300 && !ok; i++) { await sleep(500); ok = await js(`return !window.__studio.hasMask && !window.__studio.busyN`); }
      check('erase the selected person', ok);
      await shot('studio-erased');
      await js(`window.__studio.doneB.click()`); await sleep(2000);
      check('erased photo applied', await js(`return !document.querySelector('.studio')`));
      await shot('editor-after-erase');
      await js(`${E}.undo()`); await sleep(800);
      // grab
      await js(`${E}.select(${E}.userObjects().find(o => o.type === 'image')); window.__ro2app.runStudio(${E}.active(), 'grab')`); await sleep(1500);
      await js(`window.__studio.tool = 'click'; window.__studio.buildSide();`); await sleep(200);
      await click(X(0.5), Y(0.55)); ok = false; for (let i = 0; i < 300 && !ok; i++) { await sleep(500); ok = await js(`return window.__studio.hasMask && !window.__studio.busyN`); }
      await js(`window.__studio.pickMask(2)`); await sleep(200);
      await shot('studio-grab-selected');
      const n0 = await js(`return ${E}.userObjects().length`);
      await js(`window.__studio.grabNow()`); ok = false; for (let i = 0; i < 300 && !ok; i++) { await sleep(500); ok = await js(`return !document.querySelector('.studio') && !document.querySelector('.busy')`); }
      check('grab lifts the object into its own layer', await js(`return ${E}.userObjects().length === ${n0 + 1} && ${E}.active()?.ro2Name === 'Grabbed object'`));
      await js(`const a = ${E}.active(); a.set({ left: a.left + 260 }); a.setCoords(); ${E}.canvas.requestRenderAll();`);
      await shot('editor-after-grab');
      // expand
      await js(`${E}.select(${E}.userObjects().find(o => o.type === 'image' && o.ro2Name !== 'Grabbed object')); window.__ro2app.runStudio(${E}.active(), 'expand')`); await sleep(1200);
      await js(`window.__studio.expand.ratio = 16/9; window.__studio.fit(); window.__studio.buildSide(); window.__studio.draw();`); await sleep(300);
      await shot('studio-expand-frame');
      await js(`window.__studio.expandNow()`); ok = false; for (let i = 0; i < 1200 && !ok; i++) { await sleep(500); ok = await js(`return !!window.__studio.expanded && !window.__studio.busyN`); }
      check('magic expand fills the new space', ok);
      await shot('studio-expanded');
      await js(`window.__studio.doneB.click()`); await sleep(2500);
      check('expanded photo is wider', await js(`const i = ${E}.active(); return i && i.width / i.height > 1.7`), await js(`const i = ${E}.active(); return i ? Math.round(i.width) + 'x' + Math.round(i.height) : 'none'`));
      await shot('editor-after-expand');

      // ── make editable: render a template flat, then take it apart ──
      if (hasModels.includes('ocr')) {
        const flat = await js(`const T = await import('./js/templates.js'); const tpl = T.TEMPLATES.find(t => t.w === t.h) || T.TEMPLATES[0];
          await window.__ro2app.newDesign(tpl.w, tpl.h, 'Flat source', { template: tpl }); await new Promise(r => setTimeout(r, 1200));
          const R = await import('./js/editor/render.js'); const c = await R.pageCanvas(${E}, 0, { scale: 1 }); return c.toDataURL('image/png');`);
        await js(`await window.__ro2app.newDesign(1080, 1080, 'Make editable test')`); await sleep(800);
        await js(`window.__flat = ${JSON.stringify(flat)}; const ed = ${E}; ed.userObjects().forEach(o => ed.canvas.remove(o)); await window.__ro2app.addImage(window.__flat, { name: 'flat.png', fit: 'page' });`); await sleep(600);
        fs.writeFileSync(path.join(OUT, 'flat-source.png'), Buffer.from(flat.split(',')[1], 'base64'));
        await js(`window.__ro2app.runStudio(${E}.active(), 'layers')`);
        let okl = false; for (let i = 0; i < 600 && !okl; i++) { await sleep(500); okl = await js(`return !!window.__layers?.res`); }
        const found = await js(`const r = window.__layers.res; return { texts: r.texts.map(t => t.text), objects: r.objects.map(o => o.kind) }`);
        check('make editable reads the text and finds objects', okl && found.texts.length >= 1, JSON.stringify(found).slice(0, 300));
        await shot('studio-layers');
        await js(`window.__layers.finish()`); okl = false; for (let i = 0; i < 600 && !okl; i++) { await sleep(500); okl = await js(`return !document.querySelector('.studio') && !document.querySelector('.busy')`); }
        const lay = await js(`const u = ${E}.userObjects(); return { n: u.length, text: u.filter(o => o.type === 'textbox').map(o => o.text), hidden: u.filter(o => o.visible === false).length, bg: u.some(o => o.ro2Name === 'Background') }`);
        check('make editable builds real layers', lay.n >= 3 && lay.text.length >= 1 && lay.hidden === 1 && lay.bg, JSON.stringify(lay).slice(0, 300));
        await shot('editor-after-layers');
        await js(`const t = ${E}.userObjects().find(o => o.type === 'textbox'); t.set({ text: 'EDITED', fill: '#ff3366' }); t.set({ left: t.left + 40 }); ${E}.canvas.requestRenderAll();`); await sleep(300);
        await js(`${E}.canvas.discardActiveObject(); ${E}.canvas.requestRenderAll()`); await sleep(200);
        await shot('editor-layers-edited');
        // and a photo
        await js(`const ed = ${E}; await ed.addPage(); await window.__ro2app.addImage(${JSON.stringify(fixture('person.jpg'))}, { name: 'person.jpg', fit: 'page' });`); await sleep(600);
        await js(`window.__ro2app.runStudio(${E}.active(), 'layers')`);
        okl = false; for (let i = 0; i < 600 && !okl; i++) { await sleep(500); okl = await js(`return !!window.__layers?.res && document.querySelector('.studio')`); }
        check('make editable on a photo finds the subject', okl && (await js(`return window.__layers.res.objects.length >= 1`)), await js(`const r = window.__layers.res; return r.objects.length + ' objects, ' + r.texts.length + ' texts'`));
        await shot('studio-layers-photo');
        await js(`window.__layers.finish()`); okl = false; for (let i = 0; i < 600 && !okl; i++) { await sleep(500); okl = await js(`return !document.querySelector('.studio') && !document.querySelector('.busy')`); }
        await shot('editor-after-layers-photo');
      }
    } else log('  (AI checks skipped: no models in RO2_MODELS)');
    // dark mode screenshot of the home with designs
    await js(`document.getElementById('brand').click()`); await sleep(1200); await shot('home-final');
  } catch (e) { log('  ✗ CRASH ' + (e.stack || e)); results.push({ name: 'crash', ok: false }); await shot('crash'); }
  const bad = errors.filter((m) => !/Autofill|DevTools|Electron Security Warning|favicon|Estimating resolution/.test(m));
  check('no console errors', !bad.length, bad.slice(0, 5).join(' || '));
  const fails = results.filter((r) => !r.ok).length;
  log(`\n${results.length - fails}/${results.length} passed`);
};
