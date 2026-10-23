// The process list, grouped into apps, plus quitting them.
'use strict';
const { run, out, ps, isMac, isWin } = require('./run');
const P = require('./parse');
let si = null; try { si = require('systeminformation'); } catch (_) {}

const cache = { lsapp: new Map(), lsappAt: 0, topMem: new Map(), topAt: 0, windows: new Set(), descs: new Map(), winAt: 0, users: new Map() };

async function rawProcesses() {
  if (isMac) {
    const t = await out('ps', ['-axww', '-o', 'pid=,ppid=,pcpu=,rss=,user=,comm='], { timeout: 6000 });
    const list = P.parsePsMac(t);
    // footprint memory (what Activity Monitor shows) every ~6 s; it costs about a second of `top`
    if (Date.now() - cache.topAt > 6000 && !cache.topBusy) {
      cache.topBusy = true;
      out('top', ['-l', '1', '-stats', 'pid,mem', '-n', '2000'], { timeout: 8000 }).then((x) => { const m = P.parseTopMem(x); if (m.size) cache.topMem = m; cache.topAt = Date.now(); cache.topBusy = false; });
    }
    if (cache.topMem.size) for (const p of list) { const f = cache.topMem.get(p.pid); if (f != null) p.mem = f; }
    return list;
  }
  if (!si) return [];
  const r = await si.processes();
  return (r.list || []).map((p) => ({ pid: p.pid, ppid: p.parentPid, cpu: p.cpu || 0, mem: (p.memRss || 0) * 1024, user: p.user || '', path: isWin ? (p.path || '') : (p.path ? (p.path + '/' + p.name).replace(/\/\/+/g, '/') : ''), name: p.name, command: p.command || '', started: p.started, state: p.state }));
}

async function refreshContext() {
  if (isMac && Date.now() - cache.lsappAt > 3000) {
    cache.lsappAt = Date.now();
    const t = await out('lsappinfo', ['list'], { timeout: 4000 });
    const m = P.parseLsappinfo(t); if (m.size) cache.lsapp = m;
  }
  if (isWin && Date.now() - cache.winAt > 4000) {
    cache.winAt = Date.now();
    const r = await ps(`Get-Process -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id)\`t$([int64]$_.MainWindowHandle)\`t$($_.Description)" }`, { timeout: 8000 });
    if (r.ok) {
      const w = new Set(), d = new Map();
      for (const l of r.stdout.split('\n')) { const f = l.split('\t'); if (f.length < 3) continue; const pid = +f[0]; if (+f[1] !== 0) w.add(pid); if (f[2].trim()) d.set(pid, f[2].trim()); }
      cache.windows = w; cache.descs = d;
    }
  }
}

async function snapshot() {
  const [procs] = await Promise.all([rawProcesses(), refreshContext()]);
  const groups = P.groupProcesses(procs, { platform: process.platform, lsapp: cache.lsapp, windows: cache.windows, descriptions: cache.descs, selfPid: process.pid });
  return { groups: groups.map(slim), count: procs.length };
}
function slim(g) {
  return { key: g.key, name: g.name, path: g.path, bundleId: g.bundleId, kind: g.kind, cpu: g.cpu, mem: g.mem, count: g.count, mainPid: g.mainPid, self: g.self, users: g.users,
    procs: g.procs.slice(0, 60).map((p) => ({ pid: p.pid, ppid: p.ppid, name: p.name, cpu: p.cpu, mem: p.mem, user: p.user, path: p.path })) };
}

/** Quit (or force quit) a list of pids. Mac sends TERM/KILL; Windows uses taskkill. */
async function quit(pids, { force = false } = {}) {
  pids = [...new Set((pids || []).map(Number).filter((p) => p > 1 && p !== process.pid && p !== process.ppid))];
  const failed = [];
  if (isWin) {
    const args = []; for (const p of pids) args.push('/PID', String(p)); if (force) args.push('/F'); args.push('/T');
    const r = await run('taskkill', args, { timeout: 15000 });
    if (!r.ok && !force) return { ok: false, error: (r.stderr || r.stdout || r.error || '').trim() || 'Windows would not close it. Try Force quit.' };
    if (!r.ok) return { ok: false, error: (r.stderr || '').trim() || 'Could not end it (it may need administrator rights)' };
    return { ok: true };
  }
  for (const p of pids) { try { process.kill(p, force ? 'SIGKILL' : 'SIGTERM'); } catch (e) { failed.push({ pid: p, error: e.code }); } }
  if (failed.length && failed.length === pids.length) return { ok: false, error: failed.some((f) => f.error === 'EPERM') ? 'That process belongs to the system or another user, so macOS won’t let Vitals close it.' : 'It had already quit.' };
  return { ok: true, failed };
}

module.exports = { snapshot, quit, rawProcesses };
