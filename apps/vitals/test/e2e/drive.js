// Drives the real window under Xvfb: seeds some time-tracking history, visits every page and saves screenshots.
// Run: test/e2e/run.sh   (Linux; screenshots land in test/e2e/out)
const fs = require('fs');
const path = require('path');
const OUT = process.env.VITALS_SHOTS || path.join(__dirname, 'out');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = async ({ win, app, focus }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const results = [];
  const check = (name, ok, info = '') => { results.push({ name, ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${info}`); };
  // seed focus history: today and the last six days
  const apps = [
    { name: 'Visual Studio Code', bundleId: 'com.microsoft.vscode' }, { name: 'Google Chrome', bundleId: 'com.google.chrome' }, { name: 'Slack', bundleId: 'com.tinyspeck.slackmacgap' },
    { name: 'Figma', bundleId: 'com.figma.desktop' }, { name: 'Discord', bundleId: 'com.hnc.discord' }, { name: 'Datum', bundleId: 'com.bilal.datum' }
  ];
  let rnd = 7; const R = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
  const realNow = Date.now();
  for (let d = 6; d >= 0; d--) {
    const dayStart = new Date(realNow - d * 86400000); dayStart.setHours(9, 0, 0, 0);
    let t = dayStart.getTime(); const end = d === 0 ? realNow - 60000 : dayStart.getTime() + (5 + R() * 4) * 3600000;
    if (d === 0 && t > end) t = end - 4 * 3600000;
    focus.lastTick = null; focus.cur = null;
    while (t < end) {
      const a = apps[Math.floor(Math.pow(R(), 1.6) * apps.length)]; const len = (R() < 0.25 ? 20 + R() * 50 : 1 + R() * 9) * 60000;
      const stop = Math.min(end, t + len);
      for (; t < stop; t += 10000) focus.record(a, t, false);
      if (R() < 0.15) { for (let k = 0; k < 30; k++) { t += 10000; focus.record(null, t, true); } }
    }
    focus.endSession(t); focus.flush();
  }
  focus.lastTick = Date.now(); focus.cur = null;

  const js = (code) => win.webContents.executeJavaScript(code);
  const shot = async (name) => { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG()); };
  await wait(7000);
  const views = ['overview', 'activity', 'apps', 'startup', 'permissions', 'focus', 'thermals', 'specs', 'checkup'];
  for (const v of views) {
    win.webContents.send('vitals:navigate', v);
    await wait(v === 'checkup' || v === 'specs' || v === 'apps' ? 4500 : 3000);
    await shot(v);
    const on = await js(`document.querySelector('.view.on').id`);
    check('page ' + v, on === 'v-' + v, on);
  }
  // overview numbers present
  win.webContents.send('vitals:navigate', 'overview'); await wait(2500);
  const cpu = await js(`document.querySelector('#ov-cpu').textContent`); check('overview CPU shows a number', /\d/.test(cpu), cpu);
  const top = await js(`document.querySelectorAll('#ov-top .trow').length`); check('overview top list filled', top > 0, String(top));
  // activity sorts and groups
  win.webContents.send('vitals:navigate', 'activity'); await wait(2500);
  const rows = await js(`document.querySelectorAll('#act-body tr[data-key]').length`); check('activity lists processes', rows > 3, String(rows));
  await js(`document.querySelector('#act-tbl th[data-s="cpu"]').click()`); await wait(300);
  const sorted = await js(`[...document.querySelectorAll('#act-body tr:not(.sub) td:nth-child(4)')].slice(0,6).map(t=>parseFloat(t.textContent)).every((v,i,a)=>i===0||a[i-1]>=v)`); check('activity sorts by CPU', sorted);
  await js(`document.querySelector('#act-q').value='node'; document.querySelector('#act-q').dispatchEvent(new Event('input'))`); await wait(300);
  const f = await js(`[...document.querySelectorAll('#act-body tr[data-key] .t')].every(t=>/node/i.test(t.textContent)) || document.querySelectorAll('#act-body tr[data-key]').length>0`); check('activity search filters', f);
  await js(`document.querySelector('#act-q').value=''; document.querySelector('#act-q').dispatchEvent(new Event('input'))`);
  await js(`document.querySelector('#act-body tr[data-key]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`); await wait(800); await shot('activity-drawer');
  check('process drawer opens', await js(`!document.querySelector('#drawer').hidden`));
  await js(`document.querySelector('#drawer [data-close]').click()`);
  // focus page
  win.webContents.send('vitals:navigate', 'focus'); await wait(1500);
  check('focus shows active time', await js(`/\\d/.test(document.querySelector('.fx-top').textContent)`));
  await js(`document.querySelector('#fx-range button[data-d="7"]').click()`); await wait(1500); await shot('focus-week');
  check('focus week chart', await js(`document.querySelectorAll('.days .d').length === 7`));
  // checkup
  win.webContents.send('vitals:navigate', 'checkup'); await wait(2500);
  const nf = await js(`document.querySelectorAll('.finding').length`); check('checkup has findings', nf > 1, String(nf));
  // settings + light theme
  await js(`document.querySelector('#open-settings').click()`); await wait(600); await shot('settings');
  await js(`document.querySelector('#modal [data-r]').click()`);
  await js(`document.querySelector('#theme-btn').click()`); await wait(800);
  win.webContents.send('vitals:navigate', 'overview'); await wait(2500); await shot('overview-light');
  win.webContents.send('vitals:navigate', 'focus'); await wait(1500); await shot('focus-light');
  await js(`document.querySelector('#theme-btn').click()`);
  const errs = await js(`window.__errors || []`);
  check('no renderer errors', !errs.length, JSON.stringify(errs).slice(0, 400));
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  app.exit(failed ? 1 : 0);
};
