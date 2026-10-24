// Visual pass: drives the real window through every screen and saves screenshots to $SHOTS
// (default /tmp/decomp-shots). Run: DECOMP_SHOTS=1 SAMPLES=a.iso,b.apk npm start
'use strict';
const fs = require('fs');
const path = require('path');
const OUT = process.env.SHOTS || '/tmp/decomp-shots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async (D) => {
  fs.mkdirSync(OUT, { recursive: true });
  while (!D.win || D.win.webContents.isLoading()) await sleep(200);
  const W = D.win;
  W.webContents.on('console-message', (e, level, msg, line, src) => { if (level >= 2 || /error/i.test(msg)) console.log('[console]', msg, src ? `${String(src).split('/').pop()}:${line}` : ''); });
  const js = (code) => W.webContents.executeJavaScript(code, true);
  const shot = async (name) => { await sleep(350); const img = await W.webContents.capturePage(); fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG()); console.log('shot', name); };
  const waitJob = async (id, ms = 600000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const j = D.jobs.get(id); if (j && j.status !== 'running') return j; await sleep(500); } };
  await sleep(2500);
  if (process.env.THEME) await js(`document.documentElement.dataset.theme=${JSON.stringify(process.env.THEME)}`);
  const samples = (process.env.SAMPLES || '').split(',').filter(Boolean);
  await shot('01-home');
  if (samples[0]) {
    await js(`openPath(${JSON.stringify(samples[0])})`); await sleep(1500); await shot('02-identify');
    await js(`document.querySelector('[data-start]').click()`); await sleep(1200);
    await shot('03-job-running');
    const id = await js('S.jobId'); await waitJob(id); await sleep(1500);
    await js(`JV.tab='overview'; drawTab()`); await sleep(900); await shot('04-job-overview');
    await js(`JV.tab='files'; JV.expanded.clear(); drawTab()`); await sleep(1200);
    // open the first source file we can find
    await js(`(async()=>{ const src=JV.snap.outDir+(navigator.platform.startsWith('Win')?'\\\\':'/')+'Source'; const walk=async(d,depth)=>{ if(depth>8) return null; const l=await call('fs:list',d); for(const f of l){ if(!f.dir && /\\.(java|cs|c|js|py|dis\\.txt)$/.test(f.name)) return f.path; } for(const f of l){ if(f.dir){ const r=await walk(f.path,depth+1); if(r) return r; } } return null; }; const f=await walk(src,0); if(f){ let d=f; while((d=d.replace(/[\\\\/][^\\\\/]+$/,'')) && d.length>JV.snap.outDir.length) JV.expanded.add(d); JV.selected={path:f}; drawTab(); } })()`);
    await sleep(2000); await shot('05-job-files');
    await js(`JV.tab='search'; JV.search.q=${JSON.stringify(process.env.SEARCH || 'Hello')}; drawTab(); document.querySelector('#sGo').click()`); await sleep(2500); await shot('06-job-search');
  }
  for (let i = 1; i < samples.length; i++) {
    await js(`openPath(${JSON.stringify(samples[i])})`); await sleep(1500); await shot(`07-identify-${i}`);
    await js(`document.querySelector('[data-start]').click()`); await sleep(2500); await shot(`08-running-${i}`);
    const id = await js('S.jobId'); await waitJob(id); await sleep(1200);
    await js(`JV.tab='files'; drawTab()`); await sleep(1000);
    await js(`(async()=>{ const src=JV.snap.outDir+'/Source'; const walk=async(d,depth)=>{ if(depth>9) return null; let l=[]; try{l=await call('fs:list',d);}catch{} for(const f of l){ if(!f.dir && /\\.(java|cs|c|js|py|wat|dis\\.txt)$/.test(f.name)) return f.path; } for(const f of l){ if(f.dir){ const r=await walk(f.path,depth+1); if(r) return r; } } return null; }; const f=await walk(src,0); if(f){ let d=f; while((d=d.replace(/[\\\\/][^\\\\/]+$/,'')) && d.length>JV.snap.outDir.length) JV.expanded.add(d); JV.selected={path:f}; drawTab(); } })()`);
    await sleep(2000); await shot(`09-files-${i}`);
  }
  await js(`go('jobs')`); await shot('10-jobs');
  await js(`go('engines')`); await sleep(500); await shot('11-engines');
  await js(`go('settings')`); await shot('12-settings');
  await js(`go('home')`); await sleep(300); await shot('13-home-recent');
  if (!process.env.THEME) { await js(`document.documentElement.dataset.theme='light'`); await shot('14-home-light'); }
  if (samples[0]) { await js(`go('job', S.jobs[S.jobs.length-1].id)`); await sleep(1500); await js(`JV.tab='files'; drawTab()`); await sleep(1500); await shot('15-job-light'); }
  require('electron').app.quit();
};
