// Upgrade tab: what's inside the machine, drivers and updates, external drives (speed test, rename, eject).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { run, out, runAdmin, ps, psJson, isMac, isWin } = require('./run');
const P = require('./parse');
const U = P.upgrade;
let si = null; try { si = require('systeminformation'); } catch (_) {}

async function plistJson(text) {
  if (!text) return null;
  const r = await run('plutil', ['-convert', 'json', '-o', '-', '-'], { input: text, timeout: 8000 });
  if (!r.ok) return null; try { return JSON.parse(r.stdout); } catch { return null; }
}

// ------------------------------------------------------------------ inventory
async function macInventory() {
  const t = await out('system_profiler', ['SPHardwareDataType', 'SPMemoryDataType', 'SPNVMeDataType', 'SPSerialATADataType', 'SPDisplaysDataType', 'SPPowerDataType', '-json'], { timeout: 40000 });
  let j = {}; try { j = JSON.parse(t); } catch (_) {}
  const hw = (j.SPHardwareDataType || [])[0] || {};
  const chip = hw.chip_type || hw.cpu_type || '';
  const appleSilicon = /^Apple/i.test(chip);
  const mem = U.macMemoryInfo(j);
  if (!mem.total) mem.total = os.totalmem();
  const storage = [];
  for (const ctl of [...(j.SPNVMeDataType || []), ...(j.SPSerialATADataType || [])]) {
    for (const d of ctl._items || []) {
      storage.push({ name: d._name || d.device_model, model: d.device_model || d._name, size: d.size_in_bytes || 0, bus: (j.SPNVMeDataType || []).includes(ctl) ? 'NVMe' : 'SATA', media: d.spsata_medium_type === 'Rotational' ? 'HDD' : 'SSD',
        internal: d.detachable_drive !== 'yes', smart: d.smart_status || '', trim: d.spsata_trim_support || d.spnvme_trim_support || '', system: true });
    }
  }
  const gpus = (j.SPDisplaysDataType || []).map((g) => ({ model: g.sppci_model || g._name, cores: g.sppci_cores ? +g.sppci_cores : null, vram: g.spdisplays_vram || g.spdisplays_vram_shared || null, integrated: appleSilicon || /Intel/i.test(g.sppci_model || ''), discrete: !appleSilicon && /AMD|Radeon|NVIDIA/i.test(g.sppci_model || '') }));
  const pw = ((j.SPPowerDataType || []).find((x) => x.sppower_battery_health_info) || {});
  const bh = pw.sppower_battery_health_info || {};
  const battery = pw.sppower_battery_health_info ? { cycles: bh.sppower_battery_cycle_count ?? null, condition: bh.sppower_battery_health || '', health: parseInt(bh.sppower_battery_health_maximum_capacity, 10) || null } : null;
  const model = hw.machine_name || 'Mac';
  const osv = (await out('sw_vers', ['-productVersion'])).trim();
  return {
    platform: 'darwin', maker: 'Apple', model, modelId: hw.machine_model || '', chassis: U.macChassis(model), appleSilicon,
    cpu: { name: chip, cores: os.cpus().length, socket: appleSilicon ? 'Built into the chip' : '' },
    memory: mem, storage, gpus, battery, displays: appleSilicon ? U.macExternalDisplays(chip, model) : null,
    os: { name: 'macOS', version: osv }, board: '', serial: hw.serial_number || ''
  };
}

const WIN_INV = `
$cs = Get-CimInstance Win32_ComputerSystem; $en = Get-CimInstance Win32_SystemEnclosure | Select-Object -First 1; $bb = Get-CimInstance Win32_BaseBoard | Select-Object -First 1
$arr = @(Get-CimInstance Win32_PhysicalMemoryArray | Where-Object { $_.Use -eq 3 -or $_.Use -eq $null }); $mem = @(Get-CimInstance Win32_PhysicalMemory)
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1; $os = Get-CimInstance Win32_OperatingSystem; $bios = Get-CimInstance Win32_BIOS
$vram = @{}; Get-ItemProperty 'HKLM:\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' -ErrorAction SilentlyContinue | ForEach-Object { if ($_.DriverDesc) { $q = $_.'HardwareInformation.qwMemorySize'; if ($q) { $vram[$_.DriverDesc] = [int64]$q } } }
$gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object { [pscustomobject]@{ Name = $_.Name; Vendor = $_.AdapterCompatibility; Ram = $(if ($vram[$_.Name]) { $vram[$_.Name] } else { [int64]$_.AdapterRAM }); Driver = $_.DriverVersion; DriverDate = $(if ($_.DriverDate) { $_.DriverDate.ToString('yyyy-MM-dd') } else { '' }) } })
$rel = @{}; try { Get-PhysicalDisk | Get-StorageReliabilityCounter -ErrorAction Stop | ForEach-Object { $rel[[string]$_.DeviceId] = $_ } } catch {}
$disks = @(Get-PhysicalDisk -ErrorAction SilentlyContinue | ForEach-Object { $r = $rel[[string]$_.DeviceId]; [pscustomobject]@{ Name = $_.FriendlyName; Media = [string]$_.MediaType; Bus = [string]$_.BusType; Size = [int64]$_.Size; Health = [string]$_.HealthStatus; Id = [string]$_.DeviceId; Wear = $(if ($r) { $r.Wear } else { $null }); Temp = $(if ($r) { $r.Temperature } else { $null }); Hours = $(if ($r) { $r.PowerOnHours } else { $null }) } })
$sysDisk = $null; try { $sysDisk = [string](Get-Partition -DriveLetter ($env:SystemDrive.TrimEnd(':')) -ErrorAction Stop).DiskNumber } catch {}
$slots = @(Get-CimInstance Win32_SystemSlot -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ Name = $_.SlotDesignation; Usage = $_.CurrentUsage; Width = $_.MaxDataWidth } })
[pscustomobject]@{
  Maker = $cs.Manufacturer; Model = $cs.Model; Family = $cs.SystemFamily; PCSystemType = $cs.PCSystemType; Chassis = @($en.ChassisTypes)
  Board = $bb.Product; BoardMaker = $bb.Manufacturer; Bios = $bios.SMBIOSBIOSVersion; Serial = $bios.SerialNumber
  MemSlots = ($arr | Measure-Object -Property MemoryDevices -Sum).Sum; MemMaxKB = ($arr | Measure-Object -Property MaxCapacity -Sum).Sum; MemMaxKBEx = ($arr | Measure-Object -Property MaxCapacityEx -Sum).Sum
  Modules = @($mem | Select-Object Capacity, Speed, ConfiguredClockSpeed, SMBIOSMemoryType, FormFactor, Manufacturer, PartNumber, DeviceLocator, BankLabel)
  Cpu = $cpu.Name; Cores = $cpu.NumberOfCores; Threads = $cpu.NumberOfLogicalProcessors; Socket = $cpu.SocketDesignation
  Gpus = $gpus; Disks = $disks; SystemDisk = $sysDisk; Slots = $slots
  Os = $os.Caption; OsVersion = $os.Version; OsBuild = $os.BuildNumber
}`;

async function winInventory() {
  const j = (await psJson(WIN_INV, { shell: 'slow', timeout: 60000 }))[0];
  if (!j) throw new Error('Windows didn’t answer the hardware query. Try again in a moment.');
  const chassis = U.winChassis(j.Chassis, j.PCSystemType);
  const memory = U.winMemoryInfo({ ...j, laptop: chassis === 'laptop' });
  const storage = (j.Disks || []).map((d) => ({ name: d.Name, model: d.Name, size: d.Size, bus: d.Bus, media: d.Media === 'HDD' ? 'HDD' : d.Media === 'SSD' ? 'SSD' : (d.Bus === 'NVMe' ? 'SSD' : d.Media || ''), internal: !/USB|SD|1394/i.test(d.Bus || ''),
    health: d.Health, wear: d.Wear, temp: d.Temp, hours: d.Hours, system: j.SystemDisk != null && String(d.Id) === String(j.SystemDisk) }));
  const gpus = (j.Gpus || []).filter((g) => g.Name && !/Basic Display|Remote Display|Virtual|Parsec|Meta Virtual/i.test(g.Name)).map((g) => {
    const discrete = /NVIDIA|GeForce|RTX|GTX|Quadro|Radeon RX|Radeon Pro|Arc A|Arc B/i.test(g.Name) && !/Radeon\(TM\) Graphics|Vega \d+ Graphics/i.test(g.Name);
    return { model: g.Name, vendor: g.Vendor, vram: g.Ram > 0 ? g.Ram : null, driver: g.Driver, driverDate: g.DriverDate, discrete, integrated: !discrete };
  });
  return {
    platform: 'win32', maker: String(j.Maker || '').trim(), model: [j.Maker, j.Family && !/default|to be filled/i.test(j.Family) ? j.Family : '', j.Model].filter((x) => x && !/System Product Name|To be filled|Default string/i.test(x)).join(' ').replace(/\s+/g, ' ').trim(),
    modelId: j.Model || '', chassis, cpu: { name: String(j.Cpu || '').trim(), cores: j.Cores, threads: j.Threads, socket: j.Socket || '' }, memory, storage, gpus, battery: null,
    board: [j.BoardMaker, j.Board].filter((x) => x && !/Default string|To be filled/i.test(x)).join(' '), bios: j.Bios, slots: j.Slots || [],
    os: { name: j.Os || 'Windows', version: j.OsVersion || '', build: j.OsBuild || '' }, serial: j.Serial || ''
  };
}

async function linuxInventory() {
  const [cpu, layout, disks, graphics, system] = await Promise.all([si.cpu(), si.memLayout().catch(() => []), si.diskLayout().catch(() => []), si.graphics().catch(() => ({})), si.system().catch(() => ({}))]);
  const mods = layout.filter((m) => m.size);
  return {
    platform: 'linux', maker: system.manufacturer || '', model: [system.manufacturer, system.model].filter(Boolean).join(' ') || os.hostname(), modelId: system.model || '', chassis: 'unknown',
    cpu: { name: `${cpu.manufacturer} ${cpu.brand}`.trim(), cores: cpu.physicalCores, socket: cpu.socket || '' },
    memory: { slots: layout.length, used: mods.length, modules: mods.map((m) => ({ slot: m.bank, size: m.size, type: m.type, speed: m.clockSpeed, maker: m.manufacturer, part: m.partNum, form: m.formFactor })), type: (mods[0] || {}).type || '', formFactor: (mods[0] || {}).formFactor || '', speed: (mods[0] || {}).clockSpeed || null, total: os.totalmem(), max: null, soldered: false, upgradeable: null },
    storage: disks.map((d) => ({ name: d.name, model: d.name, size: d.size, bus: d.interfaceType || d.type, media: /SSD|NVMe/i.test(d.type) ? 'SSD' : d.type || '', internal: true, system: false })),
    gpus: (graphics.controllers || []).map((g) => ({ model: g.model, vendor: g.vendor, vram: g.vram ? g.vram * 1048576 : null, discrete: /NVIDIA|Radeon RX/i.test(g.model) })), battery: null, os: { name: 'Linux', version: os.release() }, board: ''
  };
}

async function inventory() { if (isMac) return macInventory(); if (isWin) return winInventory(); return linuxInventory(); }

// ------------------------------------------------------------------ drivers & updates
const WIN_DRIVERS = `
$bad = @(Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue | Where-Object { $_.ConfigManagerErrorCode -ne 0 -and $_.ConfigManagerErrorCode -ne 22 } | ForEach-Object { [pscustomobject]@{ Name = $(if ($_.Name) { $_.Name } else { $_.Description }); Code = $_.ConfigManagerErrorCode; Class = $_.PNPClass; Id = $_.DeviceID } })
$key = @(Get-CimInstance Win32_PnPSignedDriver -ErrorAction SilentlyContinue | Where-Object { $_.DeviceClass -in 'DISPLAY','NET','BLUETOOTH','MEDIA','SCSIADAPTER','HDC','USB','SYSTEM' -and $_.DeviceName -and $_.DriverProviderName -ne 'Microsoft' } | ForEach-Object { [pscustomobject]@{ Name = $_.DeviceName; Class = $_.DeviceClass; Version = $_.DriverVersion; Date = $(if ($_.DriverDate) { $_.DriverDate.ToString('yyyy-MM-dd') } else { '' }); Provider = $_.DriverProviderName; Maker = $_.Manufacturer } })
[pscustomobject]@{ Problems = $bad; Drivers = $key }`;
const PNP_CODES = { 1: 'Not set up correctly', 3: 'Driver is damaged', 10: 'Can’t start', 12: 'Not enough resources', 14: 'Needs a restart', 18: 'Drivers need reinstalling', 19: 'Registry problem', 21: 'Being removed', 24: 'Not present or not working', 28: 'No driver installed', 31: 'Not working properly', 32: 'Driver disabled', 37: 'Driver failed to start', 39: 'Driver missing or damaged', 43: 'Stopped after a problem', 45: 'Not connected', 47: 'Prepared for safe removal', 52: 'Driver not signed' };

async function drivers() {
  if (isWin) {
    const j = (await psJson(WIN_DRIVERS, { shell: 'slow', timeout: 60000 }))[0] || {};
    const problems = (j.Problems || []).filter((p) => p.Code !== 45 && p.Code !== 47).map((p) => ({ name: p.Name || 'Unknown device', code: p.Code, reason: PNP_CODES[p.Code] || `Problem code ${p.Code}`, cls: p.Class || '', id: p.Id }));
    const seen = new Set(); const list = [];
    for (const d of j.Drivers || []) { const k = d.Name + '|' + d.Version; if (seen.has(k)) continue; seen.add(k); if (d.Class === 'SYSTEM' && !/chipset|management engine|serial io|pci|smbus|thermal|gna|dynamic tuning|amd|intel/i.test(d.Name)) continue; list.push({ name: d.Name, cls: d.Class, version: d.Version, date: d.Date, provider: d.Provider, maker: d.Maker }); }
    return { platform: 'win32', problems, drivers: list.sort((a, b) => (a.date || '').localeCompare(b.date || '')) };
  }
  if (isMac) {
    const [ext, kx] = await Promise.all([out('systemextensionsctl', ['list'], { timeout: 10000 }), out('kmutil', ['showloaded', '--list-only'], { timeout: 15000 })]);
    return { platform: 'darwin', extensions: P.upgrade.parseSystemExtensions(ext), kexts: P.upgrade.parseKexts(kx), problems: [], drivers: [] };
  }
  return { platform: process.platform, problems: [], drivers: [] };
}

/** Pending OS and driver updates. Slow (it asks Apple's or Microsoft's servers), so only on request. */
async function updates() {
  if (isMac) {
    const r = await run('softwareupdate', ['--list'], { timeout: 180000 });
    return { platform: 'darwin', ...P.upgrade.parseSoftwareUpdate(r.stdout + '\n' + r.stderr) };
  }
  if (isWin) {
    const rows = await psJson(`$s = (New-Object -ComObject Microsoft.Update.Session).CreateUpdateSearcher(); $s.Online = $true; $res = $s.Search("IsInstalled=0 and IsHidden=0"); @($res.Updates | ForEach-Object { [pscustomobject]@{ Title = $_.Title; Type = $_.Type; Driver = $_.DriverClass; Maker = $_.DriverManufacturer; Size = [int64]$_.MaxDownloadSize; Kb = ($_.KBArticleIDs -join ','); Optional = -not $_.AutoSelectOnWebSites } })`, { shell: 'updates', timeout: 240000 });
    return { platform: 'win32', updates: rows.map((u) => ({ title: u.Title, driver: u.Type === 2, cls: u.Driver || '', maker: u.Maker || '', size: u.Size || 0, kb: u.Kb || '', optional: !!u.Optional })) };
  }
  return { platform: process.platform, updates: [] };
}

// ------------------------------------------------------------------ drives
async function macDrives() {
  const list = await plistJson((await run('diskutil', ['list', '-plist'], { timeout: 15000 })).stdout);
  const ids = [];
  for (const d of (list && list.AllDisksAndPartitions) || []) {
    for (const p of [...(d.Partitions || []), ...(d.APFSVolumes || [])]) if (p.MountPoint) ids.push(p.DeviceIdentifier);
    if (d.MountPoint) ids.push(d.DeviceIdentifier);
  }
  const vols = [];
  for (const id of ids) {
    const info = await plistJson((await run('diskutil', ['info', '-plist', id], { timeout: 10000 })).stdout);
    const v = P.upgrade.macVolumeFromInfo(info); if (!v) continue;
    if (/^\/(System\/Volumes\/(VM|Preboot|Update|xarts|iSCPreboot|Hardware|Data\/home)|private\/var\/vm)/.test(v.mount) || v.mount === '/') continue;
    if (v.mount === '/System/Volumes/Data') { v.name = 'Macintosh HD'; v.system = true; }
    vols.push(v);
  }
  return vols.map((v) => ({ ...v, external: !v.internal }));
}
const WIN_DRIVES = `@(Get-Volume -ErrorAction SilentlyContinue | Where-Object { $_.DriveLetter -and $_.Size -gt 0 } | ForEach-Object {
  $v = $_; $p = Get-Partition -DriveLetter $v.DriveLetter -ErrorAction SilentlyContinue; $d = $null; $pd = $null
  if ($p) { $d = Get-Disk -Number $p.DiskNumber -ErrorAction SilentlyContinue; $pd = Get-PhysicalDisk -ErrorAction SilentlyContinue | Where-Object { $_.DeviceId -eq [string]$p.DiskNumber } | Select-Object -First 1 }
  [pscustomobject]@{ Letter = [string]$v.DriveLetter; Label = $v.FileSystemLabel; FS = $v.FileSystem; Size = [int64]$v.Size; Free = [int64]$v.SizeRemaining; Type = [string]$v.DriveType; Health = [string]$v.HealthStatus; Bus = $(if ($d) { [string]$d.BusType } else { '' }); Model = $(if ($d) { $d.FriendlyName } else { '' }); Media = $(if ($pd) { [string]$pd.MediaType } else { '' }); Boot = $(if ($d) { [bool]$d.IsBoot } else { $false }); System = $(if ($d) { [bool]$d.IsSystem } else { $false }) }
})`;
async function winDrives() {
  const rows = await psJson(WIN_DRIVES, { shell: 'slow', timeout: 30000 });
  return rows.map((r) => ({ id: r.Letter, letter: r.Letter, name: r.Label || (r.Type === 'Removable' ? 'USB Drive' : 'Local Disk'), label: r.Label || '', mount: r.Letter + ':\\', fs: r.FS || '', fsType: r.FS || '', size: r.Size, free: r.Free,
    bus: r.Bus, model: r.Model, ssd: r.Media === 'SSD' ? true : r.Media === 'HDD' ? false : null, health: r.Health, system: !!(r.Boot || r.System) || (process.env.SystemDrive || 'C:').startsWith(r.Letter),
    external: /USB|SD|1394|MMC/i.test(r.Bus || '') || r.Type === 'Removable', removable: r.Type === 'Removable' || /USB|SD/i.test(r.Bus || ''), writable: true }));
}
async function linuxDrives() {
  if (!si) return [];
  const v = await si.fsSize().catch(() => []);
  return v.filter((x) => x.size > 1e8 && !/tmpfs|overlay|squashfs/.test(x.type) && !/^\/(dev|run|proc|sys|snap|boot)/.test(x.mount))
    .map((x) => ({ id: x.mount, name: x.mount === '/' ? 'System' : path.basename(x.mount), mount: x.mount, fs: x.type, size: x.size, free: x.available, bus: '', external: /^\/(media|mnt)\//.test(x.mount), system: x.mount === '/', writable: x.rw !== false }));
}
async function drives() { if (isMac) return macDrives(); if (isWin) return winDrives(); return linuxDrives(); }

// ------------------------------------------------------------------ speed test
// Sequential write then read of a temporary file, bypassing the OS cache where the system allows it:
// Windows uses unbuffered I/O (FILE_FLAG_NO_BUFFERING); a Mac remounts an external volume between write and read.
const WIN_SPEED_CS = `using System; using System.Runtime.InteropServices; using System.Diagnostics; using Microsoft.Win32.SafeHandles;
public static class VitalsDiskSpeed {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern SafeFileHandle CreateFileW(string n, uint access, uint share, IntPtr sa, uint disp, uint flags, IntPtr t);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool WriteFile(SafeFileHandle h, IntPtr b, uint n, out uint w, IntPtr o);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool ReadFile(SafeFileHandle h, IntPtr b, uint n, out uint r, IntPtr o);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr VirtualAlloc(IntPtr a, UIntPtr s, uint t, uint p);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool VirtualFree(IntPtr a, UIntPtr s, uint t);
  public static string Run(string path, long size) {
    uint chunk = 8u << 20; IntPtr buf = VirtualAlloc(IntPtr.Zero, (UIntPtr)chunk, 0x3000, 0x04);
    if (buf == IntPtr.Zero) throw new Exception("Out of memory");
    byte[] rnd = new byte[chunk]; new Random(7).NextBytes(rnd); Marshal.Copy(rnd, 0, buf, (int)chunk);
    Stopwatch sw = Stopwatch.StartNew(); long n = 0; uint io = 0;
    using (SafeFileHandle h = CreateFileW(path, 0x40000000, 0, IntPtr.Zero, 2, 0x20000000 | 0x80000000, IntPtr.Zero)) {
      if (h.IsInvalid) throw new Exception("Can't write to the drive (error " + Marshal.GetLastWin32Error() + ")");
      while (n < size) { if (!WriteFile(h, buf, chunk, out io, IntPtr.Zero)) throw new Exception("Write failed (error " + Marshal.GetLastWin32Error() + ")"); n += io; }
    }
    double w = sw.Elapsed.TotalSeconds; sw.Reset(); sw.Start(); long m = 0;
    using (SafeFileHandle h = CreateFileW(path, 0x80000000, 0, IntPtr.Zero, 3, 0x20000000 | 0x08000000, IntPtr.Zero)) {
      if (h.IsInvalid) throw new Exception("Can't read the test file (error " + Marshal.GetLastWin32Error() + ")");
      while (ReadFile(h, buf, chunk, out io, IntPtr.Zero) && io > 0) { m += io; }
    }
    double r = sw.Elapsed.TotalSeconds; VirtualFree(buf, UIntPtr.Zero, 0x8000);
    try { System.IO.File.Delete(path); } catch { }
    return w.ToString(System.Globalization.CultureInfo.InvariantCulture) + "\\t" + r.ToString(System.Globalization.CultureInfo.InvariantCulture) + "\\t" + n + "\\t" + m;
  }
}`;
function winSpeedScript(file, size) {
  return `if (-not ([System.Management.Automation.PSTypeName]'VitalsDiskSpeed').Type) { Add-Type -TypeDefinition @'\n${WIN_SPEED_CS}\n'@ }\n[VitalsDiskSpeed]::Run('${file.replace(/'/g, "''")}', ${size})`;
}

async function speedTest(drive, { sizeMB = 512, onProgress = () => {}, tempDir } = {}) {
  const size = Math.max(64, Math.min(4096, sizeMB | 0)) * 1048576;
  const free = drive.free || 0;
  if (free && free < size * 1.5) throw new Error(`Needs about ${Math.round(size * 1.5 / 1e6)} MB free on ${drive.name}.`);
  if (drive.writable === false) throw new Error(`${drive.name} is read-only, so Vitals can't test it.`);
  const dir = drive.system && tempDir ? tempDir : drive.mount;
  const name = `.vitals-speedtest-${crypto.randomBytes(4).toString('hex')}.tmp`;
  const file = path.join(dir, name);
  if (isWin) {
    onProgress({ phase: 'running', pct: null });
    const r = await ps(winSpeedScript(file, size), { shell: 'disk', timeout: 600000 });
    try { fs.rmSync(file, { force: true }); } catch (_) {}
    const f = (r.stdout || '').trim().split('\n').pop().split('\t');
    if (!r.ok || f.length < 4) throw new Error((r.stdout || r.error || 'The test didn’t finish').replace(/^.*Exception[^:]*:\s*/s, '').trim().slice(0, 200) || 'The test didn’t finish');
    const [w, rd, n, m] = f.map(Number);
    return { write: n / w / 1e6, read: m / rd / 1e6, size: n, cached: false, at: Date.now() };
  }
  const chunk = 8 * 1048576; const buf = crypto.randomBytes(chunk);
  let fh;
  try {
    // write, with an fsync so the time includes reaching the drive
    fh = await fs.promises.open(file, 'w');
    const t0 = process.hrtime.bigint(); let n = 0;
    while (n < size) { await fh.write(buf, 0, chunk); n += chunk; onProgress({ phase: 'write', pct: n / size * 50 }); }
    await fh.sync(); await fh.close(); fh = null;
    const wSec = Number(process.hrtime.bigint() - t0) / 1e9;
    // clear the cache for this file: remount the volume (external drives on a Mac)
    let cached = true;
    if (isMac && drive.external && drive.id) {
      onProgress({ phase: 'remount', pct: 52 });
      const u = await run('diskutil', ['unmount', drive.id], { timeout: 30000 });
      if (u.ok) { const m = await run('diskutil', ['mount', drive.id], { timeout: 30000 }); cached = !m.ok; if (!m.ok) throw new Error(`${drive.name} didn’t come back after the test. Unplug it and plug it in again.`); }
    }
    const t1 = process.hrtime.bigint(); let m = 0;
    fh = await fs.promises.open(file, 'r');
    while (true) { const r = await fh.read(buf, 0, chunk, null); if (!r.bytesRead) break; m += r.bytesRead; onProgress({ phase: 'read', pct: 50 + m / size * 50 }); }
    await fh.close(); fh = null;
    const rSec = Number(process.hrtime.bigint() - t1) / 1e9;
    return { write: n / wSec / 1e6, read: m / rSec / 1e6, size: n, cached, at: Date.now() };
  } finally {
    try { if (fh) await fh.close(); } catch (_) {}
    try { fs.rmSync(file, { force: true }); } catch (_) {}
  }
}

// ------------------------------------------------------------------ rename & eject
async function rename(drive, name) {
  const err = U.labelError(name, drive.fs); if (err) throw new Error(err);
  if (isMac) {
    const r = await run('diskutil', ['rename', drive.id, name], { timeout: 30000 });
    if (!r.ok) throw new Error((r.stderr || r.stdout || 'macOS wouldn’t rename it').trim().split('\n').pop());
    return { ok: true };
  }
  if (isWin) {
    const letter = String(drive.letter || '').replace(/[^A-Za-z]/g, '').slice(0, 1); if (!letter) throw new Error('No drive letter');
    const r = await ps(`Set-Volume -DriveLetter ${letter} -NewFileSystemLabel '${name.replace(/'/g, "''")}' -ErrorAction Stop; 'ok'`, { shell: 'slow', timeout: 30000 });
    if (r.ok && /ok/.test(r.stdout)) return { ok: true };
    const a = await runAdmin(`label ${letter}: ${name.replace(/[&|<>^%"]/g, '')}`);
    if (!a.ok) throw new Error('Windows didn’t allow the new name (it may need administrator approval).');
    return { ok: true };
  }
  throw new Error('Renaming isn’t supported here.');
}
async function eject(drive) {
  if (isMac) {
    const r = await run('diskutil', ['eject', drive.disk || drive.id], { timeout: 60000 });
    if (!r.ok) throw new Error(/dissent|busy|in use/i.test(r.stderr + r.stdout) ? `${drive.name} is in use. Close any files or apps using it and try again.` : (r.stderr || r.stdout || 'Couldn’t eject').trim().split('\n').pop());
    return { ok: true };
  }
  if (isWin) {
    const letter = String(drive.letter || '').replace(/[^A-Za-z]/g, '').slice(0, 1);
    await ps(`$s = New-Object -ComObject Shell.Application; $s.Namespace(17).ParseName('${letter}:').InvokeVerb('Eject'); 'ok'`, { shell: 'slow', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1500));
    if (fs.existsSync(letter + ':\\')) throw new Error(`${drive.name} is in use. Close any files or apps using it and try again.`);
    return { ok: true };
  }
  throw new Error('Ejecting isn’t supported here.');
}

module.exports = { inventory, drivers, updates, drives, speedTest, rename, eject, winSpeedScript, WIN_INV, WIN_DRIVERS, WIN_DRIVES };
