// Quick visual pass: open each screen in demo mode and save screenshots to $SHOTS (default /tmp/droid-shots).
'use strict';
const fs = require('fs');
const path = require('path');
const OUT = process.env.SHOTS || '/tmp/droid-shots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async (D) => {
  const { app } = require('electron');
  fs.mkdirSync(OUT, { recursive: true });
  const js = (win, code) => win.webContents.executeJavaScript(code, true);
  const shot = async (win, name) => { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG()); console.log('shot', name); };
  while (!D.mainWin || D.mainWin.webContents.isLoading()) await sleep(200);
  await sleep(1200);
  const W = D.mainWin;
  const { BrowserWindow } = require('electron');
  const logc = (wc) => wc.on('console-message', (e, level, msg, line, src) => { if (level >= 2 || /error/i.test(msg)) console.log('[console]', msg, src ? `${src.split('/').pop()}:${line}` : ''); });
  logc(W.webContents);
  require('electron').app.on('browser-window-created', (e, w) => logc(w.webContents));
  await shot(W, '01-empty');
  for (const step of (process.env.STEPS || 'wizard,devices,apps,library,system,settings,device').split(',')) {
    if (step === 'wizard') {
      await js(W, "openWizard({})"); await sleep(600); await shot(W, '02-wizard-look');
      await js(W, "document.querySelector('.sheet [data-style=\"island\"]').click()"); await sleep(400); await shot(W, '03-wizard-island');
      await js(W, "document.querySelector('[data-w=\"next\"]').click()"); await sleep(1500); await shot(W, '04-wizard-android');
      await js(W, "document.querySelector('[data-w=\"next\"]').click()"); await sleep(500); await shot(W, '05-wizard-hardware');
      await js(W, "document.querySelector('[data-w=\"next\"]').click()"); await sleep(500);
      await js(W, "document.querySelector('[data-loc=\"simulated\"]').click()"); await sleep(400); await shot(W, '06-wizard-connect');
      await js(W, "document.querySelector('[data-loc=\"manual\"]').click()"); await sleep(1500); await shot(W, '06b-wizard-map');
      await js(W, "document.querySelector('[data-loc=\"simulated\"]').click()"); await sleep(300);
      await js(W, "document.querySelector('[data-w=\"next\"]').click()"); await sleep(1200); await shot(W, '07-wizard-review');
      await js(W, "W.draft.start = false; document.querySelector('[data-w=\"create\"]').click()"); await sleep(1200);
      // a few more devices for the dashboard
      await js(W, `(async () => { const imgs = S.images.images; const pick = (p) => imgs.find((i) => i.path.includes(p));
        await call('devices:create', { style: 'pixel', finish: 'bay', accent: 'mint', name: 'Pixel 9 test', image: pick('android-36;google_apis_playstore'), screen: { w: 1080, h: 2400, dpi: 420 }, ramMB: 4096, cores: 4, storageGB: 64 }, {});
        await call('devices:create', { style: 'tablet', finish: 'graphite', accent: 'sky', name: 'Tab for media', image: pick('android-35;google_apis;'), screen: { w: 2560, h: 1600, dpi: 320 }, ramMB: 8192, cores: 4, storageGB: 128, network: { mode: 'isolated' } }, {});
        await call('devices:create', { style: 'galaxy', finish: 'titanium-violet', accent: 'violet', name: 'Galaxy QA', image: pick('android-34;default'), screen: { w: 1440, h: 3120, dpi: 500 }, ramMB: 8192, cores: 6, storageGB: 256, network: { mode: 'proxy', proxy: '127.0.0.1:8888' }, location: { mode: 'manual', lat: 51.5, lng: -0.12, label: 'London' } }, {});
        await refreshDevices(); })()`);
      await sleep(1500);
    }
    if (step === 'devices') { await js(W, "go('devices')"); await sleep(900); await shot(W, '08-dashboard'); }
    if (step === 'apps') { await js(W, "go('apps')"); await sleep(900); await shot(W, '09-apps'); await js(W, "doSearch('vlc')"); await sleep(3500); await shot(W, '10-apps-search'); await js(W, "S.results=null;S.query='';"); }
    if (step === 'library') { await js(W, "go('library')"); await sleep(900); await shot(W, '11-library'); }
    if (step === 'system') { await js(W, "go('system')"); await sleep(1500); await shot(W, '12-system'); }
    if (step === 'settings') { await js(W, "go('settings')"); await sleep(700); await shot(W, '13-settings'); }
    if (step === 'device') {
      const devs = D.store.all();
      const target = devs.find((d) => d.style === 'pixel') || devs[0];
      await D.startDevice(target.id);
      await sleep(400);
      let v = D.views.get(target.id);
      await sleep(600); await shot(v.win, '14-device-booting');
      for (let i = 0; i < 40 && D.runner.session(target.id)?.state !== 'running'; i++) await sleep(250);
      await sleep(1500);
      await js(W, "go('devices')"); await sleep(600);
      await shot(v.win, '15-device-running');
      await shot(W, '16-dashboard-running');
      await js(v.win, "togglePanel('files')"); await sleep(1500); await shot(v.win, '17-device-files');
      await js(v.win, "togglePanel('location')"); await sleep(1500); await shot(v.win, '18-device-location');
      await js(v.win, "togglePanel('more')"); await sleep(1200); await shot(v.win, '19-device-more');
      await js(v.win, "togglePanel('more')"); await sleep(400);
      await js(v.win, "rotate(1)"); await sleep(1500); await shot(v.win, '20-device-rotated');
      const tab = devs.find((d) => d.style === 'tablet');
      if (tab) { await D.startDevice(tab.id); for (let i = 0; i < 40 && D.runner.session(tab.id)?.state !== 'running'; i++) await sleep(250); await sleep(1500); await shot(D.views.get(tab.id).win, '21-tablet'); }
      const isl = devs.find((d) => d.style === 'island');
      if (isl) { await D.startDevice(isl.id); for (let i = 0; i < 40 && D.runner.session(isl.id)?.state !== 'running'; i++) await sleep(250); await sleep(1500); await shot(D.views.get(isl.id).win, '22-island'); }
      await js(W, "go('devices')"); await sleep(5000); await shot(W, '23-dashboard-many');
    }
  }
  await D.runner.stopAll();
  app.exit(0);
};
