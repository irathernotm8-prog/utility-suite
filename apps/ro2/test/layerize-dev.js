// Dev loop for Make editable: renders a few templates flat, runs the whole thing on each, saves before/after shots.
// RO2_E2E=test/layerize-dev.js (via test/e2e.sh with E2E overridden). Output in test/layerize-out.
'use strict';
const fs = require('fs'); const path = require('path');
const OUT = path.join(__dirname, 'layerize-out');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = async function drive({ win }) {
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
  const wc = win.webContents; const log = (l) => { console.log(l); fs.appendFileSync(path.join(OUT, 'log.txt'), l + '\n'); };
  const js = (code) => wc.executeJavaScript(`(async () => { ${code} })()`);
  const shot = async (name) => { await sleep(300); fs.writeFileSync(path.join(OUT, name + '.png'), (await wc.capturePage()).toPNG()); };
  const E = 'window.__ro2.editor';
  const which = (process.env.LZ_TPL || '0,1,3,5').split(',').map((v) => (v === 'p' ? 'p' : Number(v)));
  const photo = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, 'fixtures', 'person.jpg')).toString('base64');
  try {
    await sleep(2500);
    for (const ti of which) {
      const t0 = Date.now();
      const flat = ti === 'p' ? await js(`await window.__ro2app.newDesign(1080, 1350, 'src'); return ${JSON.stringify(photo)};`) : await js(`const T = await import('./js/templates.js'); const tpl = T.TEMPLATES[${ti}];
        await window.__ro2app.newDesign(tpl.w, tpl.h, 'src', { template: tpl }); await new Promise(r => setTimeout(r, 1200));
        const R = await import('./js/editor/render.js'); return (await R.pageCanvas(${E}, 0, { scale: 1 })).toDataURL('image/png');`);
      fs.writeFileSync(path.join(OUT, `t${ti}-src.${ti === 'p' ? 'jpg' : 'png'}`), Buffer.from(flat.split(',')[1], 'base64'));
      await js(`window.__flat = ${JSON.stringify(flat)}; const ed = ${E}; ed.userObjects().forEach(o => ed.canvas.remove(o)); ed.doc.pages[ed.page].background = { type: 'color', color: '#ffffff' }; await window.__ro2app.addImage(window.__flat, { name: 'flat', fit: 'page' }); window.__lzDebug = true; window.__ro2app.runStudio(${E}.active(), 'layers');`);
      let ok = false; for (let i = 0; i < 600 && !ok; i++) { await sleep(500); ok = await js(`return !!window.__layers?.res && !!document.querySelector('.studio')`); }
      const r = await js(`const r = window.__layers.res; return { texts: r.texts.map(t => [t.text, t.fontFamily, t.fontWeight, Math.round(t.fontSize), t.charSpacing, t.conf].concat(t.rot ? [JSON.stringify({ a: +t.rot.angle.toFixed(1), cx: Math.round(t.rot.cx), cy: Math.round(t.rot.cy), w: Math.round(t.rot.inkW), h: Math.round(t.rot.inkH), bw: Math.round(t.rot.box.w), bh: Math.round(t.rot.box.h) })] : [])), objects: r.objects.map(o => [o.kind, o.color, +(o.frac).toFixed(3), o.on]), photo: r.photo, fg: !!r.fg }`);
      log(`T${ti} analyse ${((Date.now() - t0) / 1000).toFixed(1)}s\n  texts: ${JSON.stringify(r.texts)}\n  objects: ${JSON.stringify(r.objects)} photo=${r.photo} fg=${r.fg}`);
      log('  raw: ' + JSON.stringify(await js('return window.__lzRaw')));
      log('  font: ' + JSON.stringify(await js('const f = window.__lzFont || []; window.__lzFont = []; const by = {}; for (const r of f) (by[r[0]] ||= []).push(r); return Object.values(by).map(a => a.sort((x, y) => y[5] - x[5]).slice(0, 4))')));
      await shot(`t${ti}-studio`);
      await js(`window.__layers.finish()`); ok = false; for (let i = 0; i < 600 && !ok; i++) { await sleep(500); ok = await js(`return !document.querySelector('.studio') && !document.querySelector('.busy')`); }
      await js(`${E}.canvas.discardActiveObject(); ${E}.canvas.requestRenderAll()`);
      const lay = await js(`return ${E}.userObjects().map(o => o.type + ':' + (o.text || o.ro2Name || '') + (o.type === 'rect' ? '(rx ' + Math.round(o.rx) + ')' : '')).join(' | ')`);
      log(`  layers: ${lay}  (${((Date.now() - t0) / 1000).toFixed(1)}s total)`);
      log('  shapes: ' + JSON.stringify(await js('return window.__lzShape || []')));
      await shot(`t${ti}-after`);
      { const u = await js(`const R = await import('./js/editor/render.js'); return (await R.pageCanvas(${E}, 0, { scale: 1 })).toDataURL('image/png');`); fs.writeFileSync(path.join(OUT, `t${ti}-page.png`), Buffer.from(u.split(',')[1], 'base64')); }
      const bgUrl = await js(`const b = ${E}.userObjects().find(o => o.ro2Name === 'Background'); const el = b._originalElement; const c = document.createElement('canvas'); c.width = el.naturalWidth; c.height = el.naturalHeight; c.getContext('2d').drawImage(el, 0, 0); return c.toDataURL('image/png');`);
      const hu = await js('return window.__lzHole || ""'); if (hu) fs.writeFileSync(path.join(OUT, `t${ti}-hole.png`), Buffer.from(hu.split(',')[1], 'base64'));
      fs.writeFileSync(path.join(OUT, `t${ti}-bgfull.png`), Buffer.from(bgUrl.split(',')[1], 'base64'));
      // the rebuilt background alone
      await js(`${E}.userObjects().forEach(o => { if (o.ro2Name !== 'Background') o.visible = false; }); ${E}.canvas.requestRenderAll();`); await shot(`t${ti}-bg`);
    }
  } catch (e) { log('CRASH ' + (e.stack || e)); await shot('crash'); }
  log('done');
};
