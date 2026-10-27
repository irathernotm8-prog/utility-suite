// A printable health report (saved as PDF or HTML from the Checkup page or File menu).
'use strict';
const { fmtB, fmtMem } = require('./sys/checkup');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dur = (s) => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m`; };

function reportHtml({ specs, sample, checkup, procs, startup, focus, showSerials, version }) {
  const s = sample || {}; const sp = specs || {};
  const lvl = { bad: ['#d6455d', 'Needs attention'], warn: ['#d08a16', 'Worth a look'], info: ['#3d7fd6', 'Good to know'], ok: ['#1f9d6e', 'Fine'] };
  const rows = (pairs) => pairs.filter(([, v]) => v != null && v !== '').map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');
  const topMem = (procs || []).slice().sort((a, b) => b.mem - a.mem).slice(0, 10);
  const topCpu = (procs || []).slice().sort((a, b) => b.cpu - a.cpu).slice(0, 8);
  const week = focus || []; const today = week[week.length - 1] || {};
  const weekActive = week.reduce((a, d) => a + (d.active || 0), 0);
  const appsWeek = {}; for (const d of week) for (const a of d.apps || []) appsWeek[a.name] = (appsWeek[a.name] || 0) + a.secs;
  const topApps = Object.entries(appsWeek).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const t = s.thermal || {}; const b = s.battery || {};
  return `<!doctype html><html><head><meta charset="utf-8"><title>Vitals health report</title><style>
  @page { size: Letter; margin: 14mm; }
  body { font: 11px/1.45 -apple-system, "Segoe UI", Inter, Helvetica, Arial, sans-serif; color: #17211e; margin: 0; }
  header { display: flex; align-items: center; gap: 14px; padding-bottom: 12px; border-bottom: 2px solid #17211e; margin-bottom: 16px; }
  .mark { width: 34px; height: 34px; border-radius: 9px; background: linear-gradient(135deg, #2fe0a6, #34aefc); }
  h1 { font-size: 20px; margin: 0; letter-spacing: -.2px; } h2 { font-size: 13px; margin: 18px 0 8px; text-transform: uppercase; letter-spacing: .6px; color: #4b5a55; }
  .sub { color: #5d6c67; } .score { margin-left: auto; text-align: right; } .score b { font-size: 26px; display: block; line-height: 1; }
  table { width: 100%; border-collapse: collapse; } th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #e3e8e6; vertical-align: top; } th { width: 34%; color: #4b5a55; font-weight: 600; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 22px; }
  .f { display: grid; grid-template-columns: 12px 1fr; gap: 8px; padding: 7px 0; border-bottom: 1px solid #e3e8e6; break-inside: avoid; }
  .f i { width: 10px; height: 10px; border-radius: 50%; margin-top: 3px; } .f b { display: block; } .f span { color: #4b5a55; }
  .num { text-align: right; font-variant-numeric: tabular-nums; } footer { margin-top: 20px; color: #7a8884; font-size: 10px; }
  </style></head><body>
  <header><div class="mark"></div><div><h1>${esc(sp.model || 'Computer')} — health report</h1><div class="sub">${esc(new Date().toLocaleString())} · ${esc(sp.os ? `${sp.os.name} ${sp.os.version}` : '')}</div></div>
  <div class="score"><b>${checkup ? checkup.score : '–'}</b><span class="sub">health score</span></div></header>
  <h2>Checkup</h2>
  ${(checkup ? checkup.findings : []).map((f) => `<div class="f"><i style="background:${lvl[f.level][0]}"></i><div><b>${esc(f.title)}</b><span>${esc(f.detail || '')}</span></div></div>`).join('')}
  <div class="grid"><div>
  <h2>This computer</h2><table>${rows([['Model', sp.model], ['Model ID', sp.modelId], ['Processor', sp.cpu && `${sp.cpu.name} · ${sp.cpu.cores} cores${sp.cpu.threads !== sp.cpu.cores ? ` / ${sp.cpu.threads} threads` : ''}`], ['Memory', sp.memory && fmtMem(sp.memory.total)],
    ['Graphics', (sp.gpus || []).map((g) => g.model + (g.cores ? ` (${g.cores} cores)` : '')).join(', ')], ['Operating system', sp.os && `${sp.os.name} ${sp.os.version}${sp.os.build ? ` (${sp.os.build})` : ''}`],
    ['Serial number', showSerials ? sp.serial : null], ['Up for', s.uptime ? dur(s.uptime) : null]])}</table>
  </div><div>
  <h2>Right now</h2><table>${rows([['Processor', s.cpu ? `${s.cpu.total.toFixed(0)}%` : null], ['Memory', s.mem ? `${fmtMem(s.mem.used)} of ${fmtMem(s.mem.total)} (${s.mem.pressure})` : null], ['Swap', s.mem && s.mem.swap ? fmtMem(s.mem.swap.used) : null],
    ['Graphics', s.gpu && s.gpu.util != null ? `${s.gpu.util.toFixed(0)}%` : null], ['Processor temperature', t.cpu != null ? `${t.cpu.toFixed(0)} °C` : null], ['Thermal pressure', t.state],
    ['Battery', b.present ? `${b.percent ?? '–'}%${b.health != null ? ` · health ${b.health}%` : ''}${b.cycles ? ` · ${b.cycles} cycles` : ''}` : null]])}
    ${(s.volumes || []).map((v) => `<tr><th>${esc(v.name)}</th><td>${fmtB(v.free)} free of ${fmtB(v.size)}</td></tr>`).join('')}</table>
  </div></div>
  <div class="grid"><div>
  <h2>Most memory</h2><table>${topMem.map((g) => `<tr><td>${esc(g.name)}</td><td class="num">${fmtMem(g.mem)}</td></tr>`).join('')}</table>
  </div><div>
  <h2>Most processor</h2><table>${topCpu.map((g) => `<tr><td>${esc(g.name)}</td><td class="num">${g.cpu.toFixed(1)}%</td></tr>`).join('')}</table>
  </div></div>
  <div class="grid"><div>
  <h2>Starts with the computer</h2><table>${(startup || []).filter((x) => x.enabled && !x.apple).slice(0, 18).map((x) => `<tr><td>${esc(x.name)}</td><td class="sub">${esc(x.kind)}</td></tr>`).join('') || '<tr><td class="sub">Nothing found</td></tr>'}</table>
  </div><div>
  <h2>Time this week</h2><table>${rows([['Active time', weekActive ? dur(weekActive) : 'Not tracked yet'], ['Today', today.active ? dur(today.active) : null], ['Focus score today', today.score]])}
  ${topApps.map(([n, secs]) => `<tr><td>${esc(n)}</td><td class="num">${dur(secs)}</td></tr>`).join('')}</table>
  </div></div>
  <footer>Made by Vitals ${esc(version)} — part of the Utility Suite.</footer>
  </body></html>`;
}
module.exports = { reportHtml };
