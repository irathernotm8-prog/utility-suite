// Touchline — drives the real window through every page and saves screenshots.
// Run (Linux): TOUCHLINE_E2E=/tmp/shots TOUCHLINE_USER_DATA=/tmp/tl-ud xvfb-run -s "-screen 0 1440x960x24" npx electron .
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = function drive(win, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const errors = [];
  win.webContents.on('console-message', (e) => { const m = e.message ?? e; const lvl = e.level ?? ''; if (/error|warn/i.test(String(lvl)) || /Error/.test(String(m))) errors.push(String(m)); });
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shotWin = async (w, name) => { const img = await w.webContents.capturePage(); fs.writeFileSync(path.join(outDir, `${name}.png`), img.toPNG()); };
  const widgetWin = () => require('electron').BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Touchline Live');
  const shot = async (name) => { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(outDir, `${name}.png`), img.toPNG()); };
  const go = (r, p = []) => js(`App.go(${JSON.stringify(r)}, ${JSON.stringify(p)})`);
  const tab = (seg, v) => js(`(document.querySelector('[data-seg="${seg}"] button[data-v="${v}"]')||{click(){}}).click()`);
  const steps = [
    ['01-today', async () => { await wait(6000); }],
    ['02-today-all', async () => { await tab('scope', 'all'); await wait(800); }],
    ['03-leagues', async () => { await go('leagues'); await wait(3500); }],
    ['04-epl-table', async () => { await go('league', ['47']); await wait(4000); }],
    ['05-epl-xg', async () => { await tab('tview', 'xg'); await wait(500); }],
    ['06-epl-matches', async () => { await tab('ltab', 'matches'); await wait(600); }],
    ['07-epl-stats', async () => { await tab('ltab', 'stats'); await wait(1500); }],
    ['08-epl-leaders-sheet', async () => { await js(`document.querySelector('[data-leaders]').click()`); await wait(3000); }],
    ['09-epl-history', async () => { await js(`document.querySelector('#overlay').innerHTML=''`); await tab('ltab', 'history'); await wait(1500); }],
    ['10-ucl-knockout', async () => { await go('league', ['77', '2022', 'knockout']); await wait(5000); }],
    ['11-wc2022-table', async () => { await tab('ltab', 'table'); await wait(800); }],
    ['12-match-facts', async () => { await go('match', ['5795477']); await wait(4500); }],
    ['13-match-lineups', async () => { await tab('mtab', 'lineups'); await wait(2500); }],
    ['14-match-stats', async () => { await tab('mtab', 'stats'); await wait(600); }],
    ['15-match-shots', async () => { await tab('mtab', 'shots'); await wait(600); }],
    ['16-match-h2h', async () => { await tab('mtab', 'h2h'); await wait(1500); }],
    ['17-match-table', async () => { await tab('mtab', 'table'); await wait(3000); }],
    ['18-team-overview', async () => { await go('team', ['8650']); await wait(5000); }],
    ['19-team-matches', async () => { await tab('ttab', 'matches'); await wait(800); }],
    ['20-team-squad', async () => { await tab('ttab', 'squad'); await wait(2500); }],
    ['21-team-history', async () => { await tab('ttab', 'history'); await wait(1000); }],
    ['21b-team-history-chart', async () => { await js(`document.querySelector('.main').scrollTop = 900`); await wait(600); }],
    ['22-team-legends', async () => { await tab('ttab', 'legends'); await wait(1500); }],
    ['23-player-overview', async () => { await go('player', ['737066']); await wait(5000); }],
    ['24-player-stats', async () => { await tab('ptab', 'stats'); await wait(1500); }],
    ['25-player-career', async () => { await tab('ptab', 'career'); await wait(9000); }],
    ['26-player-trophies', async () => { await tab('ptab', 'trophies'); await wait(600); }],
    ['27-henry-career', async () => { await go('player', ['30626', 'career']); await wait(10000); }],
    ['28-legends', async () => { await go('legends'); await wait(2500); }],
    ['29-legend', async () => { await go('legend', ['thierry-henry']); await wait(9000); }],
    ['30-follow-team', async () => { await js(`window.tl.store.follow('teams',{id:8650,name:'Liverpool'}).then(s=>{UI.store=s;App.renderRail()})`); await go('following'); await wait(5000); }],
    ['31-builder', async () => { await go('builder'); await wait(800); await tab('src', 'team'); await wait(3500); await js(`[...document.querySelectorAll('[data-pick]')].slice(0,3).forEach(e=>e.click())`); await wait(1500); }],
    ['32-palette', async () => { await js(`Palette.open()`); await wait(300); await js(`(()=>{const i=document.querySelector('#pal-q');i.value='messi';i.dispatchEvent(new Event('input'))})()`); await wait(3500); }],
    ['33-settings', async () => { await js(`document.querySelector('#overlay').innerHTML=''`); await go('settings'); await wait(1500); }],
    ['34-light-today', async () => { await js(`window.tl.store.set({theme:'light'}).then(s=>{UI.store=s;UI.applyTheme(false)})`); await go('today'); await wait(3000); }],
    ['35-light-match', async () => { await go('match', ['5795477', 'lineups']); await wait(3000); }],
    ['37-widget-open', async () => { await js(`window.tl.store.set({theme:'dark'}).then(s=>{UI.store=s;UI.applyTheme(true)})`); await js(`window.tl.widget.toggle()`); await wait(5000); }],
    ['38-widget', async () => { const w = widgetWin(); if (w) await shotWin(w, '38-widget-today'); await w.webContents.executeJavaScript(`document.querySelector('[data-seg="wf"] button[data-v="live"]').click()`); await wait(800); await shotWin(w, '38-widget-live'); await w.webContents.executeJavaScript(`document.querySelector('[data-seg="wf"] button[data-v="mine"]').click()`); await wait(800); await shotWin(w, '38-widget-mine'); await w.webContents.executeJavaScript(`document.querySelector('#w-prev').click()`); await wait(4000); await shotWin(w, '38-widget-yesterday'); await w.webContents.executeJavaScript(`document.querySelector('[data-seg="wf"] button[data-v="today"]').click()`); await wait(800); await shotWin(w, '38-widget-yesterday-all'); }],
    ['36-light-player', async () => { await go('player', ['737066']); await wait(2500); await js(`window.tl.store.set({theme:'dark'})`); }]
  ];
  (async () => {
    await wait(1500);
    const only = process.env.TOUCHLINE_E2E_ONLY ? new RegExp(process.env.TOUCHLINE_E2E_ONLY) : null;
    for (const [name, fn] of steps) {
      if (only && !only.test(name)) continue;
      try { await fn(); await shot(name); console.log('shot', name); }
      catch (err) { console.log('step failed', name, err.message); }
    }
    const pageErrors = await js(`window.__errors || []`).catch(() => []);
    fs.writeFileSync(path.join(outDir, 'errors.json'), JSON.stringify({ console: errors, page: pageErrors }, null, 2));
    console.log('E2E DONE', errors.length, 'console errors');
    require('electron').app.exit(0);
  })();
};
