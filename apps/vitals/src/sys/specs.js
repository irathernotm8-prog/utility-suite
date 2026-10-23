// What this computer is: model, chip, memory, graphics, displays, storage, OS, battery health and network.
'use strict';
const os = require('os');
const { run, out, ps, psJson, isMac, isWin } = require('./run');
let si = null; try { si = require('systeminformation'); } catch (_) {}

const safe = (p, d = null) => Promise.resolve().then(p).catch(() => d);

async function macExtras() {
  const t = await out('system_profiler', ['SPHardwareDataType', 'SPDisplaysDataType', '-json'], { timeout: 20000 });
  try {
    const j = JSON.parse(t); const hw = (j.SPHardwareDataType || [])[0] || {};
    const gpus = (j.SPDisplaysDataType || []).map((g) => ({ model: g.sppci_model || g._name, cores: g.sppci_cores ? +g.sppci_cores : null, vendor: (g.spdisplays_vendor || '').replace(/^sppci_vendor_/, ''), vram: g.spdisplays_vram || g.spdisplays_vram_shared || null,
      displays: (g.spdisplays_ndrvs || []).map((d) => ({ name: d._name, resolution: d._spdisplays_resolution || d.spdisplays_resolution || '', pixels: d._spdisplays_pixels || '', main: d.spdisplays_main === 'spdisplays_yes', internal: d.spdisplays_connection_type === 'spdisplays_internal' })) }));
    return { modelName: hw.machine_name, modelId: hw.machine_model, chip: hw.chip_type || hw.cpu_type, cores: hw.number_processors, memory: hw.physical_memory, serial: hw.serial_number, firmware: hw.boot_rom_version, gpus };
  } catch (_) { return {}; }
}

async function collect() {
  const [system, cpu, mem, memLayout, graphics, osInfo, diskLayout, battery, net, bios, baseboard] = await Promise.all([
    safe(() => si.system()), safe(() => si.cpu()), safe(() => si.mem()), safe(() => si.memLayout(), []), safe(() => si.graphics(), {}), safe(() => si.osInfo()), safe(() => si.diskLayout(), []),
    safe(() => si.battery()), safe(() => si.networkInterfaces(), []), safe(() => si.bios()), safe(() => si.baseboard())
  ]);
  const mac = isMac ? await macExtras() : {};
  const cpus = os.cpus();
  const res = {
    platform: process.platform, arch: process.arch, hostname: os.hostname(),
    model: mac.modelName ? `${mac.modelName}` : [system && system.manufacturer, system && system.model].filter((x) => x && !/To be filled|System Product Name|Default string/i.test(x)).join(' ') || os.hostname(),
    modelId: mac.modelId || (system && system.model) || '', serial: mac.serial || (system && system.serial) || '', uuid: system && system.uuid,
    cpu: {
      name: mac.chip || (cpu ? `${cpu.manufacturer} ${cpu.brand}`.trim() : cpus[0] && cpus[0].model) || '',
      cores: cpu ? cpu.physicalCores : cpus.length, threads: cpus.length, performanceCores: cpu && cpu.performanceCores, efficiencyCores: cpu && cpu.efficiencyCores,
      speed: cpu && cpu.speed ? cpu.speed : null, speedMax: cpu && cpu.speedMax ? cpu.speedMax : null, cache: cpu && cpu.cache ? cpu.cache : {}, virtualization: cpu && cpu.virtualization, socket: cpu && cpu.socket
    },
    memory: { total: os.totalmem(), modules: (memLayout || []).filter((m) => m.size).map((m) => ({ size: m.size, type: m.type, speed: m.clockSpeed, maker: m.manufacturer, part: m.partNum, slot: m.bank, form: m.formFactor })) },
    gpus: (mac.gpus && mac.gpus.length ? mac.gpus.map((g) => ({ model: g.model, cores: g.cores, vendor: g.vendor, vram: g.vram })) : (graphics.controllers || []).map((g) => ({ model: g.model, vendor: g.vendor, vram: g.vram ? g.vram * 1048576 : null, driver: g.driverVersion }))),
    displays: (mac.gpus && mac.gpus.length ? mac.gpus.flatMap((g) => g.displays) : (graphics.displays || []).map((d) => ({ name: d.model || d.deviceName, resolution: d.currentResX ? `${d.currentResX} x ${d.currentResY}${d.currentRefreshRate ? ` @ ${d.currentRefreshRate} Hz` : ''}` : '', main: d.main, internal: d.builtin }))),
    os: { name: osInfo ? osInfo.distro : os.type(), version: osInfo ? osInfo.release : os.release(), build: osInfo ? osInfo.build : '', codename: osInfo ? osInfo.codename : '', kernel: os.release(), arch: osInfo ? osInfo.arch : process.arch, uptime: os.uptime(), bootTime: Date.now() - os.uptime() * 1000 },
    disks: (diskLayout || []).map((d) => ({ name: d.name || d.device, type: d.type, interface: d.interfaceType, size: d.size, vendor: d.vendor, serial: d.serialNum, smart: d.smartStatus, temp: d.temperature })),
    battery: battery && battery.hasBattery ? { cycles: battery.cycleCount, design: battery.designedCapacity, max: battery.maxCapacity, unit: battery.capacityUnit, model: battery.model, maker: battery.manufacturer, type: battery.type } : null,
    network: (net || []).filter((n) => !n.internal && (n.ip4 || n.ip6) && n.operstate !== 'down').map((n) => ({ name: n.ifaceName || n.iface, type: n.type, ip4: n.ip4, mac: n.mac, speed: n.speed, ssid: null })),
    firmware: mac.firmware || (bios ? [bios.vendor, bios.version].filter(Boolean).join(' ') : ''), board: baseboard ? [baseboard.manufacturer, baseboard.model].filter((x) => x && !/Default string/i.test(x)).join(' ') : ''
  };
  if (si) { const w = await safe(() => si.wifiConnections(), []); if (w && w[0]) { const n = res.network.find((x) => x.type === 'wireless') || res.network[0]; if (n) n.ssid = w[0].ssid || null; } }
  return res;
}

module.exports = { collect };
