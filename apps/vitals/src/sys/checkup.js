// The Checkup: plain-language findings from everything Vitals knows, worst first.
'use strict';
const DAY = 86400000;
const fmtB = (b) => { if (b == null) return '—'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1000 && i < u.length - 1) { b /= 1000; i++; } return `${b.toFixed(b >= 100 || i === 0 ? 0 : 1)} ${u[i]}`; };

/**
 * ctx: { sample, procs, apps, startup, perms, platform, history, now }
 * returns [{ id, level: 'bad'|'warn'|'ok'|'info', title, detail, action?: { label, go } }]
 */
function run(ctx) {
  const f = []; const now = ctx.now || Date.now(); const s = ctx.sample || {}; const mac = ctx.platform === 'darwin';
  const add = (level, id, title, detail, action) => f.push({ id, level, title, detail, action });

  // storage
  for (const v of s.volumes || []) {
    const freePct = v.size ? v.free / v.size * 100 : 100;
    if (freePct < 6 || v.free < 8e9) add('bad', 'disk-' + v.mount, `${v.name} is almost full`, `${fmtB(v.free)} free of ${fmtB(v.size)}. Under about 10% free, ${mac ? 'macOS' : 'Windows'} slows down and updates can fail.`, { label: 'Find big apps', go: 'apps:size' });
    else if (freePct < 15) add('warn', 'disk-' + v.mount, `${v.name} is getting full`, `${fmtB(v.free)} free (${freePct.toFixed(0)}%).`, { label: 'Find big apps', go: 'apps:size' });
  }
  if ((s.volumes || []).length && !f.some((x) => x.id.startsWith('disk-'))) add('ok', 'disk', 'Plenty of storage', (s.volumes || []).map((v) => `${v.name}: ${fmtB(v.free)} free`).join(' · '));

  // memory
  const m = s.mem;
  if (m) {
    if (m.pressure === 'critical') add('bad', 'mem', 'Memory is under heavy pressure', `${fmtB(m.used)} of ${fmtB(m.total)} in use${m.swap && m.swap.used ? `, plus ${fmtB(m.swap.used)} swapped to disk` : ''}. Quitting the biggest apps will speed things up.`, { label: 'See what’s using it', go: 'activity:mem' });
    else if (m.pressure === 'warning') add('warn', 'mem', 'Memory is running tight', `${fmtB(m.used)} of ${fmtB(m.total)} in use.`, { label: 'See what’s using it', go: 'activity:mem' });
    else if (m.swap && m.swap.used > Math.max(4e9, m.total * 0.5)) add('warn', 'swap', 'A lot of memory has been swapped to disk', `${fmtB(m.swap.used)} in swap. A restart clears it; quitting heavy apps helps too.`, { label: 'See what’s using it', go: 'activity:mem' });
    else add('ok', 'mem', 'Memory is fine', `${fmtB(m.used)} of ${fmtB(m.total)} in use.`);
  }

  // CPU hogs over the last minutes
  const H = ctx.history || {};
  const recent = (H.cpu || []).slice(-60).filter((x) => x != null);
  const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
  const top = (ctx.procs || []).filter((g) => !g.self).sort((a, b) => b.cpu - a.cpu)[0];
  if (avg > 80) add('bad', 'cpu', 'The processor has been flat out', `Averaging ${avg.toFixed(0)}% for the last few minutes${top ? `; ${top.name} is the busiest` : ''}.`, { label: 'See what’s busy', go: 'activity:cpu' });
  else if (top && top.cpu > (ctx.cores || 4) * 100 * 0.5) add('warn', 'cpu-top', `${top.name} is using a lot of processor`, `${top.cpu.toFixed(0)}% right now.`, { label: 'See it', go: 'activity:cpu' });
  else if (recent.length > 5) add('ok', 'cpu', 'Processor load is normal', `Averaging ${avg.toFixed(0)}% recently.`);

  // thermals
  const t = s.thermal || {};
  if (t.state === 'critical' || t.state === 'serious') add('bad', 'therm', 'Your computer is running hot', `${mac ? 'macOS' : 'The system'} reports thermal pressure as ${t.state}, so it is slowing itself down to cool off.`, { label: 'Thermals', go: 'thermals' });
  else if (t.cpu != null && t.cpu >= 95) add('bad', 'therm', 'The processor is very hot', `${t.cpu.toFixed(0)} °C.`, { label: 'Thermals', go: 'thermals' });
  else if ((t.speedLimit != null && t.speedLimit < 100) || t.state === 'fair') add('warn', 'therm', 'The processor is being slowed to keep cool', t.speedLimit != null && t.speedLimit < 100 ? `Speed limited to ${t.speedLimit}%.` : 'Thermal pressure is fair.', { label: 'Thermals', go: 'thermals' });
  else if (t.cpu != null || t.state) add('ok', 'therm', 'Temperatures are normal', t.cpu != null ? `Processor ${t.cpu.toFixed(0)} °C.` : 'Thermal pressure is nominal.');

  // battery
  const b = s.battery;
  if (b && b.present) {
    if (b.health != null && b.health < 80) add('warn', 'bat', 'The battery has worn down', `It holds ${b.health}% of its original charge${b.cycles ? ` after ${b.cycles} cycles` : ''}. Below 80% most batteries are due for service.`, { label: 'Battery', go: 'thermals' });
    else if (b.health != null) add('ok', 'bat', 'Battery health is good', `${b.health}% of original capacity${b.cycles ? `, ${b.cycles} cycles` : ''}.`);
  }

  // uptime
  if (s.uptime > 14 * 86400) add('warn', 'uptime', 'It’s been a while since a restart', `Up for ${Math.floor(s.uptime / 86400)} days. A restart clears memory leaks, swap and pending updates.`);

  // startup
  const st = (ctx.startup || []).filter((x) => x.enabled && !x.apple);
  if (st.length > 15) add('warn', 'startup', `${st.length} things start with your computer`, 'Each one slows sign-in a little and may run in the background all day.', { label: 'Review startup', go: 'startup' });
  else if (ctx.startup) add('ok', 'startup', `${st.length} startup items`, 'A reasonable number.', { label: 'Review', go: 'startup' });
  const broken = (ctx.startup || []).filter((x) => x.missing && x.enabled);
  if (broken.length) add('warn', 'startup-broken', `${broken.length} startup item${broken.length > 1 ? 's point' : ' points'} to an app that’s gone`, broken.slice(0, 4).map((x) => x.name).join(', ') + '. They fail at every sign-in and can be turned off.', { label: 'Review startup', go: 'startup:broken' });

  // unused apps
  if (ctx.apps) {
    const old = ctx.apps.filter((a) => !a.protected && a.source !== 'system' && a.lastUsed && now - a.lastUsed > 180 * DAY);
    const bytes = old.reduce((x, a) => x + (a.size || 0), 0);
    if (old.length >= 3) add('info', 'unused', `${old.length} apps haven’t been opened in 6 months`, `${bytes ? `Together about ${fmtB(bytes)}. ` : ''}Uninstalling them frees space and startup clutter.`, { label: 'See them', go: 'apps:unused' });
  }

  // permissions worth a look
  if (ctx.perms && ctx.perms.length) {
    const sensitive = ctx.perms.filter((p) => p.allowed && !p.global && /Screen|Full Disk|Accessibility|Input Monitoring|Camera|Microphone|File system/.test(p.label));
    const apps = new Set(sensitive.map((p) => p.client));
    if (apps.size) add('info', 'perms', `${apps.size} apps can see your screen, files, camera or keystrokes`, 'Worth a look now and then — remove access from anything you don’t recognise.', { label: 'Review permissions', go: 'permissions' });
    const live = ctx.perms.filter((p) => p.inUse);
    if (live.length) add('warn', 'perm-live', `${live.map((p) => p.label).join(' and ')} in use right now`, [...new Set(live.map((p) => p.client.split('\\').pop()))].join(', '), { label: 'Review', go: 'permissions' });
  }

  const order = { bad: 0, warn: 1, info: 2, ok: 3 };
  f.sort((a, b) => order[a.level] - order[b.level]);
  const bad = f.filter((x) => x.level === 'bad').length, warn = f.filter((x) => x.level === 'warn').length;
  const score = Math.max(0, 100 - bad * 22 - warn * 8 - f.filter((x) => x.level === 'info').length * 2);
  return { findings: f, score, bad, warn };
}

module.exports = { run, fmtB };
