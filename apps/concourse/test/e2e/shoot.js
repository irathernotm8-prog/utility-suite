'use strict';
// Screenshots of every screen with the demo company. Run (Linux, Xvfb):
//   CONCOURSE_DEMO=1 CONCOURSE_SCREENSHOT=1 CONCOURSE_USER_DATA=/tmp/cc-ud xvfb-run -s "-screen 0 1600x1000x24" npx electron .
// Writes PNGs to test/e2e/out and exits. Also fails (exit 1) on any error logged in the window.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

module.exports = async function shoot(win) {
  const out = path.join(__dirname, 'out'); fs.mkdirSync(out, { recursive: true });
  const errors = [];
  win.webContents.on('console-message', (e) => { const lvl = e.level, msg = e.message; if (process.env.CONCOURSE_DEBUG) console.log('[console]', lvl, msg); if (lvl === 'error' || lvl === 3) errors.push(msg); });
  win.webContents.on('render-process-gone', (_e, d) => errors.push('renderer gone ' + d.reason));
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const js = (code) => win.webContents.executeJavaScript(code);
  win.setSize(1480, 920); win.show();
  await new Promise(r => win.webContents.once('did-finish-load', r)).catch(() => {});
  await wait(2500);
  const snap = async (name) => { await wait(900); const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(out, name + '.png'), img.toPNG()); console.log('shot', name); };

  if (process.env.CONCOURSE_EVAL) { console.log('EVAL', JSON.stringify(await js(process.env.CONCOURSE_EVAL), null, 1)); app.exit(0); return; }
  if (!(await js('S.state.demo'))) {
    await snap('00-welcome');
    await js(`go('settings')`); await wait(300); await js(`document.querySelector('details').open = true`);
    await snap('00-settings-setup');
    if (errors.length) { console.error('WINDOW ERRORS:\n' + errors.join('\n')); app.exit(1); return; }
    app.exit(0); return;
  }
  if (process.env.CONCOURSE_LAMP) await js(`concourse.call('setSettings', { lamp: '${process.env.CONCOURSE_LAMP}' })`);
  await snap('01-board');
  await js(`go('chats')`); await wait(300);
  await js(`document.querySelector('.crow.unread').click()`); await wait(1200);
  await snap('02-chats');
  await js(`(() => { const i = document.querySelector('.cinput'); i.value = 'Pulling them now — **sign-ups by channel** coming up. @Ma'; i.dispatchEvent(new Event('input')); })()`);
  await snap('03-composer-mention');
  await js(`(() => { const i = document.querySelector('.cinput'); i.value = 'On it — **by channel** before 2'; i.dispatchEvent(new Event('input')); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); })()`);
  await wait(1500);
  await snap('04-sent');
  await js(`go('teams')`); await wait(1200);
  await js(`document.querySelector('.chan').click()`); await wait(1200);
  await snap('05-teams');
  await js(`go('calendar')`); await wait(800);
  await snap('06-timetable-week');
  await js(`document.querySelector('.stn.s-boarding, .stn.s-live').click()`); await wait(600);
  await snap('07-meeting-drawer');
  await js(`document.querySelectorAll('.drawer').forEach(d => d.remove()); [...document.querySelectorAll('.seg button')].find(b => b.textContent === 'day').click()`); await wait(800);
  await snap('08-timetable-day');
  await js(`window.newMeeting()`); await wait(500);
  await snap('09-new-meeting');
  await js(`document.querySelector('.scrim').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); document.querySelector('.scrim') && document.querySelector('.scrim').remove(); go('tasks')`); await wait(800);
  await snap('10-manifest');
  await js(`go('settings')`); await wait(800);
  await snap('11-settings-accounts');
  await js(`[...document.querySelectorAll('.snav button')].find(b => b.textContent === 'Board').click()`); await wait(500);
  await snap('12-settings-board');
  await js(`go('home'); palette(); (() => { const i = document.querySelector('.palette input'); i.value = 'mid'; i.dispatchEvent(new Event('input')); })()`); await wait(500);
  await snap('13-palette');
  await js(`document.querySelectorAll('.scrim').forEach(s => s.remove()); concourse.call('setSettings', { lamp: 'cyan' })`); await wait(800);
  await snap('14-board-cyan');
  await js(`concourse.call('setSettings', { lamp: 'amber' })`);
  if (errors.length) { console.error('WINDOW ERRORS:\n' + errors.join('\n')); app.exit(1); return; }
  app.exit(0);
};
