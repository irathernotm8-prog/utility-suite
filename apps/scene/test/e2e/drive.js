// Drives the real window under Xvfb on the pretend computer: makes scenes from templates and from the screen,
// edits one by clicking and dragging, switches for real, uses the Desktop page and the quick switcher.
const fs = require('fs');
const path = require('path');
const OUT = process.env.SCENE_SHOTS || path.join(__dirname, 'out');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = async ({ win, switcher, app, store, platform, showSwitcher }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const results = [];
  const check = (name, ok, info = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${info}`); };
  const W = () => win();
  const js = (code) => W().webContents.executeJavaScript(code);
  const shot = async (name, w = W()) => { const img = await w.webContents.capturePage(); fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG()); };
  const click = (sel) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
  const rect = (sel) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  const mouse = (type, x, y) => W().webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, modifiers: type === 'mouseMove' ? ['leftButtonDown'] : [] });
  try {
    await wait(2500);
    W().focus();
    await shot('01-scenes-empty');
    check('empty scenes page shows the hero', await js(`!!document.querySelector('.hero')`));

    // template -> editor
    await click('[data-tpl="work"]'); await wait(1200);
    check('template opens the editor', await js(`document.querySelector('.view.on').id`) === 'v-editor');
    const nWin = await js(`document.querySelectorAll('#ed-canvas .win').length`);
    check('work template placed windows', nWin >= 3, String(nWin));
    await shot('02-editor-work');
    // select + snap
    const w0 = await rect('#ed-canvas .win');
    mouse('mouseDown', w0.x + w0.w / 2, w0.y + 30); mouse('mouseUp', w0.x + w0.w / 2, w0.y + 30); await wait(400);
    check('clicking a window selects it', await js(`!!document.querySelector('#ed-canvas .win.sel')`));
    await click('[data-zone="right"]'); await wait(600);
    let sc = store.scenes()[0];
    const selId = await js(`document.querySelector('#ed-canvas .win.sel').dataset.id`);
    let rule = sc.apps.flatMap((a) => a.windows).find((w) => w.id === selId);
    check('zone button snaps to the right half', rule && rule.frac.x === 0.5 && rule.frac.w === 0.5, JSON.stringify(rule && rule.frac));
    // drag it to the left edge
    const w1 = await rect('#ed-canvas .win.sel');
    const wa = await js(`(() => { const r = document.querySelector('#ed-canvas .win.sel').parentElement.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
    const sx = w1.x + 20, sy = w1.y + 8;
    mouse('mouseDown', sx, sy);
    for (let i = 1; i <= 10; i++) { mouse('mouseMove', sx - (w1.x - wa.x + 30) * i / 10, sy + 2); await wait(30); }
    await shot('03-editor-dragging');
    mouse('mouseUp', sx - (w1.x - wa.x + 30), sy + 2); await wait(700);
    sc = store.scenes()[0]; rule = sc.apps.flatMap((a) => a.windows).find((w) => w.id === selId);
    check('dragging moves the window and snaps to the edge', rule && rule.frac.x === 0, JSON.stringify(rule && rule.frac));
    // resize from the right edge
    const w2 = await rect('#ed-canvas .win.sel .hd.e');
    if (w2) { mouse('mouseDown', w2.x + 2, w2.y + w2.h / 2); for (let i = 1; i <= 8; i++) { mouse('mouseMove', w2.x + 2 - 6 * i, w2.y + w2.h / 2); await wait(25); } mouse('mouseUp', w2.x + 2 - 48, w2.y + w2.h / 2); await wait(700); }
    sc = store.scenes()[0]; const rule2 = sc.apps.flatMap((a) => a.windows).find((w) => w.id === selId);
    check('resizing from an edge changes the width', rule2 && rule2.frac.w < rule.frac.w, `${rule.frac.w} -> ${rule2 && rule2.frac.w}`);
    await shot('04-editor-selected');
    // double-click fills
    const w3 = await rect('#ed-canvas .win.sel');
    await js(`document.querySelector('#ed-canvas .win.sel').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`); await wait(700);
    sc = store.scenes()[0]; const rule3 = sc.apps.flatMap((a) => a.windows).find((w) => w.id === selId);
    check('double-click makes it fill the screen', rule3 && rule3.state === 'maximized', rule3 && rule3.state);
    await js(`document.querySelector('#ed-canvas .win.sel').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`); await wait(500);

    // name + hotkey
    await js(`(() => { const i = document.querySelector('#ed-name'); i.value = 'Desk day'; i.dispatchEvent(new Event('input')); })()`);
    await click('#ed-hotkey'); await wait(150);
    W().webContents.sendInputEvent({ type: 'keyDown', keyCode: '1', modifiers: ['control', 'alt'] }); await wait(600);
    sc = store.scenes()[0];
    check('rename saves', sc.name === 'Desk day', sc.name);
    check('hotkey recorder sets a shortcut', /Alt\+1$/.test(sc.hotkey || ''), sc.hotkey);

    // system tab
    await click('#ed-tabs [data-tab="system"]'); await wait(300);
    await click('[data-seg="others"] [data-v="hide"]'); await wait(200);
    await click('#sy-vol-on'); await wait(200);
    await click('[data-seg="appearance"] [data-v="dark"]'); await wait(200);
    await click('#sy-awake'); await wait(700);
    await shot('05-editor-system');
    sc = store.scenes()[0];
    check('system settings save', sc.others === 'hide' && sc.system.volume === 50 && sc.system.appearance === 'dark' && sc.system.keepAwake === true, JSON.stringify(sc.system));
    // actions tab
    await click('#ed-tabs [data-tab="actions"]'); await wait(300);
    await click('[data-add="shortcut"]'); await wait(500);
    await js(`(() => { const s = document.querySelector('#ed-body select[data-val]'); s.value = 'Focus: Work'; s.dispatchEvent(new Event('change')); })()`); await wait(600);
    await shot('06-editor-actions');
    sc = store.scenes()[0]; check('shortcut action saves', sc.actions[0] && sc.actions[0].value === 'Focus: Work');
    // triggers tab
    await click('#ed-tabs [data-tab="triggers"]'); await wait(300);
    await click('[data-add="display"]'); await wait(300);
    await click('[data-add="schedule"]'); await wait(700);
    await shot('07-editor-triggers');
    sc = store.scenes()[0]; check('triggers save', sc.triggers.length === 2 && sc.triggers[0].display && sc.triggers[0].display.label === 'LG UltraFine', JSON.stringify(sc.triggers[0]));
    // apps tab: open a URL with Chrome
    await click('#ed-tabs [data-tab="apps"]'); await wait(300);
    await js(`(() => { const i = document.querySelector('[data-openin]'); i.value = 'analytics.google.com'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); })()`); await wait(600);
    await shot('08-editor-apps');
    sc = store.scenes()[0]; check('open-with link saves with https', (sc.apps[0].open || [])[0] && sc.apps[0].open[0].target === 'https://analytics.google.com', JSON.stringify(sc.apps[0].open));

    // gaming template + capture
    await click('#ed-back'); await wait(600);
    await click('[data-tpl="gaming"]'); await wait(900); await click('#ed-back'); await wait(400);
    await click('[data-tpl="matchday"]'); await wait(900); await click('#ed-back'); await wait(400);
    await click('#sc-capture'); await wait(1200);
    await shot('09-capture');
    check('capture lists the open apps', await js(`document.querySelectorAll('#cp-list label').length`) >= 4);
    await js(`(() => { const i = document.querySelector('#cp-name'); i.value = 'As it was'; })()`);
    await click('#cp-save'); await wait(1200);
    const cap = store.scenes().find((s) => s.name === 'As it was');
    check('capture saves a scene with windows', cap && cap.apps.length >= 3 && cap.apps.every((a) => a.windows.length), cap && cap.apps.map((a) => a.name).join(', '));
    check('capture leaves out Finder', cap && !cap.apps.some((a) => a.name === 'Finder'));
    await click('#ed-back'); await wait(800);
    await shot('10-scenes');
    check('scenes page lists 4 scenes', await js(`document.querySelectorAll('.sc').length`) === 4);

    // switch for real
    const desk = store.scenes()[0];
    await js(`document.querySelector('.sc[data-id="${desk.id}"] [data-go]').click()`);
    await wait(1600); await shot('11-switching');
    for (let i = 0; i < 40 && !(store.history()[0] && store.history()[0].sceneId === desk.id); i++) await wait(300);
    await wait(500); await shot('12-switched');
    const h = store.history()[0];
    check('switch finishes and is logged', h && h.sceneId === desk.id, h && `${h.ms} ms ok=${h.ok}`);
    const snap = await platform.snapshot();
    const chromeNew = snap.windows.filter((w) => w.app.name === 'Google Chrome' && /analytics/.test(w.title));
    check('Chrome opened the link in a new window', chromeNew.length === 1);
    const slack = snap.windows.find((w) => w.app.name === 'Slack');
    const lg = platform.DISPLAYS[1].workArea;
    check('Slack moved to the right third of the LG', slack && Math.abs(slack.bounds.x - (lg.x + lg.width * 2 / 3)) <= 2 && Math.abs(slack.bounds.width - lg.width / 3) <= 2, slack && JSON.stringify(slack.bounds));
    check('other apps were hidden', snap.windows.filter((w) => ['Visual Studio Code', 'Notes'].includes(w.app.name)).every((w) => w.state === 'minimized'));
    check('volume and dark mode applied', (await platform.getVolume()).volume === 50 && (await platform.getAppearance()) === 'dark');
    check('shortcut ran', platform.log.some((l) => l[0] === 'shortcut' && l[1] === 'Focus: Work'));
    check('active scene marked', await js(`!!document.querySelector('.sc.active[data-id="${desk.id}"]')`) && store.state().activeId === desk.id);
    check('Restore previous offered', await js(`!!document.querySelector('#now-undo')`));

    // desktop page
    await js(`document.querySelector('[data-view="desktop"]').click()`); await wait(1500);
    await shot('13-desktop');
    const nd = await js(`document.querySelectorAll('#dk-canvas .win').length`);
    check('desktop shows live windows', nd >= 4, String(nd));
    await js(`(() => { const r = [...document.querySelectorAll('#dk-list .wl-w')].find((x) => /Slack/.test(x.closest('.wl-app').textContent)); r.click(); })()`); await wait(400);
    await click('#dk-tools [data-zone="left"]'); await wait(1200);
    const slack2 = (await platform.snapshot()).windows.find((w) => w.app.name === 'Slack');
    check('desktop snap moves the real window', slack2 && slack2.bounds.x === lg.x && Math.abs(slack2.bounds.width - lg.width / 2) <= 1, JSON.stringify(slack2 && slack2.bounds));
    await shot('14-desktop-selected');

    // automations + history
    await js(`document.querySelector('[data-view="automations"]').click()`); await wait(700); await shot('15-automations');
    check('automations lists the triggers', await js(`document.querySelectorAll('#au-page .list .li').length`) >= 2);
    await js(`document.querySelector('[data-view="history"]').click()`); await wait(700);
    await js(`document.querySelector('#hi-page .li').click()`); await wait(300); await shot('16-history');
    check('history shows steps', await js(`document.querySelectorAll('#hi-page .steps .step').length`) >= 3);

    // restore previous
    await js(`document.querySelector('[data-view="scenes"]').click()`); await wait(500);
    await click('#now-undo'); for (let i = 0; i < 40 && store.history()[0].sceneId !== 'previous'; i++) await wait(300); await wait(400);
    const snap2 = await platform.snapshot();
    check('restore previous closes what the scene opened', !snap2.windows.some((w) => ['Relay', 'Docket'].includes(w.app.name)), snap2.windows.map((w) => w.app.name).join(','));
    check('restore previous puts VS Code back', snap2.windows.some((w) => w.app.name === 'Visual Studio Code' && w.state === 'normal'));

    // switcher
    showSwitcher('pick'); await wait(1200);
    await shot('17-switcher', switcher());
    check('switcher lists scenes', await switcher().webContents.executeJavaScript(`document.querySelectorAll('.sw-row').length`) >= 4);
    switcher().webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' }); await wait(200);
    switcher().webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' }); await wait(900);
    await shot('18-switcher-hud', switcher());
    for (let i = 0; i < 40 && store.history()[0].trigger !== 'switcher'; i++) await wait(300);
    check('switcher switches', store.history()[0].trigger === 'switcher', store.history()[0].name);
    await wait(2500);

    // settings + light theme
    W().focus();
    await click('#open-settings'); await wait(800); await shot('19-settings'); await js(`document.querySelector('.modal [data-close]').click()`);
    await click('#theme-btn'); await wait(600); await shot('20-scenes-light');
    const work = store.scenes()[0]; await js(`document.querySelector('.sc[data-id="${work.id}"] [data-edit]').click()`); await wait(900); await shot('21-editor-light');
    await click('#ed-back'); await click('#theme-btn'); await wait(300);
    // second scene's editor (match day) for a look at a stream layout
    const md = store.scenes().find((s) => s.name === 'Match day'); await js(`document.querySelector('.ss[data-id="${md.id}"]').click()`); await wait(900); await shot('22-editor-matchday');
  } catch (e) { console.log('FAIL exception', e && e.stack); results.push({ ok: false }); }
  const bad = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - bad}/${results.length} checks passed`);
  setTimeout(() => app.exit(bad ? 1 : 0), 300);
};
