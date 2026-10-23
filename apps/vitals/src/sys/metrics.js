// Live metrics: CPU (per core), memory, GPU, network, disk activity, battery and thermals.
// One Sampler runs in the main process; the window subscribes to what it is showing.
'use strict';
const os = require('os');
const fs = require('fs');
const { run, out, ps, psJson, isMac, isWin, withTimeout } = require('./run');
const P = require('./parse');

let si = null; try { si = require('systeminformation'); } catch (_) {}
// The native sensor module runs in a child process (see temp-worker.js): if it ever misbehaves, only the child dies.
const tempWorker = { child: null, fails: 0, pending: null, buf: '' };
function readMacSensors() {
  if (!isMac || process.arch !== 'arm64' || tempWorker.fails >= 3) return Promise.resolve(null);
  return new Promise((resolve) => {
    if (!tempWorker.child) {
      try {
        const { fork } = require('child_process');
        const c = fork(require('path').join(__dirname, 'temp-worker.js'), [], { stdio: ['pipe', 'pipe', 'ignore', 'ipc'] });
        c.stdout.setEncoding('utf8');
        c.stdout.on('data', (d) => {
          tempWorker.buf += d; let i;
          while ((i = tempWorker.buf.indexOf('\n')) >= 0) {
            const line = tempWorker.buf.slice(0, i); tempWorker.buf = tempWorker.buf.slice(i + 1);
            const p = tempWorker.pending; tempWorker.pending = null;
            if (p) { clearTimeout(p.timer); try { const j = JSON.parse(line); if (!j.ok) tempWorker.fails = 3; p.resolve(j.ok ? j : null); } catch { p.resolve(null); } }
          }
        });
        c.on('exit', () => { tempWorker.child = null; tempWorker.fails++; const p = tempWorker.pending; tempWorker.pending = null; if (p) { clearTimeout(p.timer); p.resolve(null); } });
        c.on('error', () => {});
        tempWorker.child = c;
      } catch (_) { tempWorker.fails = 3; return resolve(null); }
    }
    if (tempWorker.pending) return resolve(null);
    tempWorker.pending = { resolve, timer: setTimeout(() => { const p = tempWorker.pending; tempWorker.pending = null; if (p) p.resolve(null); }, 4000) };
    try { tempWorker.child.stdin.write('r\n'); } catch (_) { const p = tempWorker.pending; tempWorker.pending = null; clearTimeout(p.timer); resolve(null); }
  });
}
function stopTempWorker() { try { tempWorker.child && tempWorker.child.kill(); } catch (_) {} tempWorker.child = null; }

// ------------------------------------------------------------------ CPU
let lastTimes = null;
function cpuSample() {
  const cpus = os.cpus();
  const times = cpus.map((c) => c.times);
  let cores = cpus.map(() => 0), total = 0, user = 0, sys = 0;
  if (lastTimes && lastTimes.length === times.length) {
    let T = 0, U = 0, S = 0, I = 0;
    cores = times.map((t, i) => {
      const p = lastTimes[i];
      const d = { user: t.user - p.user, nice: t.nice - p.nice, sys: t.sys - p.sys, idle: t.idle - p.idle, irq: t.irq - p.irq };
      const all = d.user + d.nice + d.sys + d.idle + d.irq;
      T += all; U += d.user + d.nice; S += d.sys + d.irq; I += d.idle;
      return all > 0 ? Math.max(0, Math.min(100, (1 - d.idle / all) * 100)) : 0;
    });
    total = T > 0 ? (1 - I / T) * 100 : 0; user = T > 0 ? U / T * 100 : 0; sys = T > 0 ? S / T * 100 : 0;
  }
  lastTimes = times;
  const speed = cpus.reduce((a, c) => a + (c.speed || 0), 0) / (cpus.length || 1);
  return { total, user, sys, cores, speed: speed || null, load: isWin ? null : os.loadavg() };
}

// ------------------------------------------------------------------ memory
async function memSample() {
  const total = os.totalmem();
  if (isMac) {
    const [vm, swap, press] = await Promise.all([out('vm_stat'), out('sysctl', ['-n', 'vm.swapusage']), out('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'])]);
    const m = P.macMemory(P.parseVmStat(vm), total);
    const lvl = +String(press).trim();
    return { ...m, swap: P.parseSwapUsage(swap), pressure: lvl === 4 ? 'critical' : lvl === 2 ? 'warning' : 'normal', pct: m.used / total * 100 };
  }
  if (process.platform === 'linux') {
    let mi = {}; try { mi = P.parseLinuxMeminfo(fs.readFileSync('/proc/meminfo', 'utf8')); } catch (_) {}
    const avail = mi.MemAvailable ?? os.freemem(); const used = total - avail;
    const cached = (mi.Cached || 0) + (mi.Buffers || 0);
    return { total, used, app: Math.max(0, used - (mi.Shmem || 0)), wired: mi.Unevictable || 0, compressed: 0, cached, free: avail, available: avail,
      swap: { total: mi.SwapTotal || 0, used: (mi.SwapTotal || 0) - (mi.SwapFree || 0) }, pressure: used / total > .92 ? 'critical' : used / total > .8 ? 'warning' : 'normal', pct: used / total * 100 };
  }
  // Windows: instant numbers from Node; the page file is refreshed in the background (winSwap)
  const free = os.freemem(); const used = total - free;
  const swap = winSwapCache || { total: 0, used: 0 }, cached = 0;
  return { total, used, app: used, wired: 0, compressed: 0, cached, free, available: free, swap,
    pressure: used / total > .92 ? 'critical' : used / total > .82 ? 'warning' : 'normal', pct: used / total * 100 };
}

let winSwapCache = null;
async function winSwap() {
  const r = await psJson(`Get-CimInstance Win32_PageFileUsage -ErrorAction SilentlyContinue | Select-Object AllocatedBaseSize, CurrentUsage`, { shell: 'slow', timeout: 15000 });
  if (r.length) winSwapCache = { total: r.reduce((a, x) => a + (+x.AllocatedBaseSize || 0), 0) * 1048576, used: r.reduce((a, x) => a + (+x.CurrentUsage || 0), 0) * 1048576 };
  return winSwapCache;
}

// ------------------------------------------------------------------ GPU
let nvsmi = undefined;
async function nvidiaSmi() {
  if (nvsmi === false) return null;
  const r = await run('nvidia-smi', ['--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,fan.speed,power.draw', '--format=csv,noheader,nounits'], { timeout: 4000 });
  if (!r.ok) { nvsmi = false; return null; }
  nvsmi = true;
  const f = r.stdout.trim().split('\n')[0].split(',').map((s) => s.trim());
  const n = (v) => (v && !/N\/A|\[/.test(v) ? +v : null);
  return { name: f[0], util: n(f[1]), memUsed: n(f[2]) != null ? n(f[2]) * 1048576 : null, memTotal: n(f[3]) != null ? n(f[3]) * 1048576 : null, temp: n(f[4]), fan: n(f[5]), power: n(f[6]) };
}
async function gpuSample() {
  if (isMac) {
    const t = await out('ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator'], { timeout: 4000 });
    const g = P.parseIoregGpu(t);
    return { util: g.util, memUsed: g.mem, name: g.name };
  }
  const nv = await nvidiaSmi(); if (nv) return nv;
  if (isWin) {
    const r = await ps(`$e = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '*engtype_3D*' }; if ($e) { ($e | Measure-Object -Property UtilizationPercentage -Sum).Sum } else { '' }`, { shell: 'slow', timeout: 15000 });
    const v = parseFloat(r.stdout); return { util: isNaN(v) ? null : Math.min(100, v) };
  }
  return { util: null };
}

// ------------------------------------------------------------------ network & disk activity
let lastNet = null;
async function netSample() {
  if (isWin) {
    const r = await psJson(`Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface -ErrorAction SilentlyContinue | Select-Object Name, BytesReceivedPersec, BytesSentPersec`, { shell: 'slow', timeout: 15000 });
    let rx = 0, tx = 0;
    for (const x of r) { if (/loopback|isatap|teredo|vEthernet|pseudo|Hyper-V/i.test(x.Name || '')) continue; rx += +x.BytesReceivedPersec || 0; tx += +x.BytesSentPersec || 0; }
    lastNet = { rx, tx }; return lastNet;
  }
  if (!si) return { rx: 0, tx: 0 };
  try {
    const stats = await si.networkStats('*');
    let rx = 0, tx = 0, rxTotal = 0, txTotal = 0;
    const skip = isMac ? /^(lo\d*|utun\d*|awdl\d*|llw\d*|bridge\d*|gif\d*|stf\d*|anpi\d*|ap\d*)$/ : isWin ? /loopback|vEthernet|isatap|teredo|pseudo/i : /^(lo|docker\d*|veth.*|br-.*|virbr\d*)$/;
    for (const s of stats) { if (skip.test(s.iface) || /loopback/i.test(s.iface)) continue; rx += Math.max(0, s.rx_sec || 0); tx += Math.max(0, s.tx_sec || 0); rxTotal += s.rx_bytes || 0; txTotal += s.tx_bytes || 0; }
    lastNet = { rx, tx, rxTotal, txTotal };
    return lastNet;
  } catch (_) { return lastNet || { rx: 0, tx: 0 }; }
}
let lastDisk = null;
async function diskSample() {
  if (isWin) {
    const d = (await psJson(`Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter "Name='_Total'" -ErrorAction SilentlyContinue | Select-Object DiskReadBytesPersec, DiskWriteBytesPersec, PercentDiskTime`, { shell: 'slow', timeout: 15000 }))[0];
    if (d) { lastDisk = { read: +d.DiskReadBytesPersec || 0, write: +d.DiskWriteBytesPersec || 0, busy: Math.min(100, +d.PercentDiskTime || 0) }; }
    return lastDisk || { read: 0, write: 0 };
  }
  if (!si) return { read: 0, write: 0 };
  try {
    const d = await si.fsStats();
    if (d && d.rx_sec != null) { lastDisk = { read: Math.max(0, d.rx_sec || 0), write: Math.max(0, d.wx_sec || 0) }; return lastDisk; }
  } catch (_) {}
  try { const d = await si.disksIO(); if (d && d.rIO_sec != null) { lastDisk = { read: null, write: null, rIO: d.rIO_sec, wIO: d.wIO_sec }; } } catch (_) {}
  return lastDisk || { read: 0, write: 0 };
}

// ------------------------------------------------------------------ battery
async function batterySample() {
  if (isMac) {
    const t = await out('ioreg', ['-rn', 'AppleSmartBattery', '-w', '0'], { timeout: 4000 });
    const b = P.macBatteryFromIoreg(P.parseIoregProps(t));
    if (b) { b.present = true; return b; }
  }
  if (!si) return { present: false };
  try {
    const b = await si.battery();
    if (!b || !b.hasBattery) return { present: false };
    return { present: true, percent: b.percent, charging: b.isCharging, plugged: b.acConnected, cycles: b.cycleCount || null,
      designCapacity: b.designedCapacity || null, maxCapacity: b.maxCapacity || null,
      health: b.designedCapacity && b.maxCapacity ? Math.min(100, Math.round(b.maxCapacity / b.designedCapacity * 100)) : null,
      timeRemaining: b.timeRemaining > 0 ? b.timeRemaining : null, temperature: null, voltage: b.voltage || null, model: b.model || '', manufacturer: b.manufacturer || '' };
  } catch (_) { return { present: false }; }
}

// ------------------------------------------------------------------ thermals
async function thermalSample(electronThermal) {
  const r = { cpu: null, gpu: null, soc: null, cores: [], fans: [], state: electronThermal || null, zones: [], speedLimit: null, source: null };
  if (isMac) {
    const w = await readMacSensors();
    if (w && w.t) { const t = w.t; r.cpu = t.cpu; r.gpu = t.gpu; r.soc = t.soc > 0 ? t.soc : null; r.cores = t.cpuDieTemps || []; r.source = 'sensors'; }
    if (w && w.f) r.fans = w.f.map((f) => ({ label: f.label, rpm: f.rpm, min: f.min, max: f.max, pct: f.pwm }));
    const th = P.parsePmsetTherm(await out('pmset', ['-g', 'therm'], { timeout: 3000 })); r.speedLimit = th.speedLimit;
    return r;
  }
  if (isWin) {
    // ThermalZoneInformation is readable without admin (tenths of a kelvin)
    const z = await psJson(`Get-CimInstance Win32_PerfFormattedData_Counters_ThermalZoneInformation -ErrorAction SilentlyContinue | Select-Object Name, HighPrecisionTemperature, Temperature, PercentPassiveLimit, ThrottleReasons`, { shell: 'slow', timeout: 15000 });
    r.zones = z.map((x) => ({ name: String(x.Name || '').replace(/^\\_TZ\./, ''), temp: x.HighPrecisionTemperature ? x.HighPrecisionTemperature / 10 - 273.15 : x.Temperature ? x.Temperature - 273.15 : null, limit: x.PercentPassiveLimit, throttle: x.ThrottleReasons }))
      .filter((x) => x.temp != null && x.temp > 5 && x.temp < 130);
    if (r.zones.length) { r.cpu = Math.max(...r.zones.map((x) => x.temp)); r.source = 'acpi'; const lim = Math.min(...r.zones.map((x) => x.limit ?? 100)); r.speedLimit = lim < 100 ? lim : 100; }
    const nv = await nvidiaSmi(); if (nv) { r.gpu = nv.temp; if (nv.fan != null) r.fans.push({ label: 'GPU fan', pct: nv.fan }); }
    return r;
  }
  if (si) { try { const t = await si.cpuTemperature(); if (t.main > 0) { r.cpu = t.main; r.cores = (t.cores || []).filter((x) => x > 0); r.source = 'sensors'; } } catch (_) {} }
  const nv = await nvidiaSmi(); if (nv) r.gpu = nv.temp;
  return r;
}

// ------------------------------------------------------------------ storage volumes
async function volumes() {
  if (!si) return [];
  try {
    const list = (await si.fsSize()).filter((v) => v.size > 1e9 && !/^\/(System\/Volumes\/(VM|Preboot|Update|xarts|iSCPreboot|Hardware)|dev|run|snap|boot|var\/lib|mnt\/wsl)/.test(v.mount) && !/tmpfs|devfs|overlay|squashfs|autofs/.test(v.type));
    // APFS volumes in one container share size and free space: keep the one that holds the data
    const groups = new Map();
    for (const v of list) {
      const free = v.available ?? (v.size - v.used);
      const k = isMac ? `${v.size}|${Math.round(free / 1e8)}` : v.mount;
      const g = groups.get(k); if (!g || (v.used > g.used)) groups.set(k, { ...v, free });
    }
    return [...groups.values()].map((v) => {
      let name = v.mount;
      if (isMac) name = v.mount === '/' || v.mount === '/System/Volumes/Data' ? 'Macintosh HD' : v.mount.replace(/^\/Volumes\//, '');
      else if (process.platform === 'linux' && v.mount === '/') name = 'System';
      return { name, mount: v.mount, fs: v.fs, type: v.type, size: v.size, used: v.size - v.free, free: v.free, pct: (v.size - v.free) / v.size * 100 };
    }).sort((a, b) => (a.name === 'Macintosh HD' ? -1 : 0) - (b.name === 'Macintosh HD' ? -1 : 0) || b.size - a.size);
  } catch (_) { return []; }
}

// ------------------------------------------------------------------ the sampler
class Sampler {
  constructor({ onTick, getThermalState, historyLen = 300 }) {
    this.onTick = onTick; this.getThermalState = getThermalState || (() => null); this.historyLen = historyLen;
    this.interval = 2000; this.timer = null; this.running = false; this.last = null; this.n = 0;
    this.history = { cpu: [], mem: [], gpu: [], rx: [], tx: [], read: [], write: [], temp: [], t: [] };
    this.slow = {}; this.jobs = {};
    this.wantFast = true;
  }
  setInterval(ms) { this.interval = Math.max(1000, ms | 0); if (this.running) { this.stop(); this.start(); } }
  start() { if (this.running) return; this.running = true; cpuSample(); this.loop(); }
  stop() { this.running = false; clearTimeout(this.timer); }
  async loop() {
    if (!this.running) return;
    const t0 = Date.now();
    try { await this.tick(); } catch (e) { /* keep going */ }
    this.timer = setTimeout(() => this.loop(), Math.max(250, this.interval - (Date.now() - t0)));
  }
  /** Start a background collector if it's due and not already running; its latest result lands in this.slow[key]. */
  refresh(key, fn, everyTicks, timeoutMs, n) {
    const st = this.jobs[key] || (this.jobs[key] = { busy: false, last: -1e9 });
    if (st.busy || (n - st.last < everyTicks && this.slow[key] !== undefined)) return;
    st.busy = true; st.last = n;
    withTimeout(fn(), timeoutMs, undefined).then((v) => { if (v !== undefined) this.slow[key] = v; }).finally(() => { st.busy = false; });
  }
  async tick() {
    const n = this.n++;
    const cpu = cpuSample();
    // Only memory is awaited (it is quick everywhere); everything else updates in the background so one slow or
    // stuck system command can never stop the readings.
    const mem = await withTimeout(memSample(), 3000, this.last ? this.last.mem : { total: os.totalmem(), used: os.totalmem() - os.freemem(), free: os.freemem(), pct: (1 - os.freemem() / os.totalmem()) * 100, pressure: 'normal', swap: { total: 0, used: 0 } });
    this.refresh('net', netSample, 1, 15000, n);
    this.refresh('disk', diskSample, 1, 15000, n);
    this.refresh('gpu', () => gpuSample().catch(() => ({ util: null })), 1, 15000, n);
    this.refresh('battery', batterySample, 15, 20000, n);
    this.refresh('thermal', () => thermalSample(this.getThermalState()), 3, 20000, n);
    this.refresh('volumes', volumes, 30, 30000, n);
    if (isWin) this.refresh('swap', winSwap, 15, 20000, n);
    const net = this.slow.net || { rx: 0, tx: 0 }, disk = this.slow.disk || { read: 0, write: 0 }, gpu = this.slow.gpu || { util: null };
    const s = { t: Date.now(), cpu, mem, net, disk, gpu, battery: this.slow.battery || null, thermal: { ...(this.slow.thermal || {}), state: this.getThermalState() || (this.slow.thermal || {}).state || null }, volumes: this.slow.volumes || [], uptime: os.uptime() };
    const H = this.history; const push = (k, v) => { H[k].push(v); if (H[k].length > this.historyLen) H[k].shift(); };
    push('t', s.t); push('cpu', cpu.total); push('mem', mem.pct); push('gpu', gpu.util); push('rx', net.rx); push('tx', net.tx); push('read', disk.read); push('write', disk.write); push('temp', s.thermal.cpu ?? null);
    this.last = s;
    try { this.onTick && this.onTick(s); } catch (_) {}
  }
}

module.exports = { stopTempWorker, Sampler, cpuSample, memSample, gpuSample, batterySample, thermalSample, volumes, nvidiaSmi };
