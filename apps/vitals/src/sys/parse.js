// Pure parsers for the text that system tools print. Kept free of I/O so test/run.js can check them with fixtures.
'use strict';

const UNITS = { B: 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 };
function sizeStr(s) { // "152M", "1.2G+", "980K-", "12B"
  const m = String(s || '').trim().match(/^([\d.]+)\s*([BKMGT])?/i); if (!m) return 0;
  return Math.round(parseFloat(m[1]) * (UNITS[(m[2] || 'B').toUpperCase()] || 1));
}

// ------------------------------------------------------------------ macOS memory
function parseVmStat(text) {
  const t = String(text || '');
  const ps = +(t.match(/page size of (\d+) bytes/) || [])[1] || 16384;
  const get = (label) => { const m = t.match(new RegExp('^' + label + ':\\s+(\\d+)', 'm')); return m ? +m[1] : 0; };
  return {
    pageSize: ps,
    free: get('Pages free'), active: get('Pages active'), inactive: get('Pages inactive'), speculative: get('Pages speculative'),
    wired: get('Pages wired down'), purgeable: get('Pages purgeable'), compressed: get('Pages occupied by compressor'),
    fileBacked: get('File-backed pages'), anonymous: get('Anonymous pages'), throttled: get('Pages throttled')
  };
}
/** Same buckets Activity Monitor shows. */
function macMemory(vm, total) {
  const p = vm.pageSize;
  const app = Math.max(0, (vm.anonymous ? vm.anonymous - vm.purgeable : vm.active + vm.inactive - vm.fileBacked)) * p;
  const wired = vm.wired * p; const compressed = vm.compressed * p;
  const cached = (vm.fileBacked + vm.purgeable) * p;
  const used = Math.min(total, app + wired + compressed);
  return { total, used, app, wired, compressed, cached, free: Math.max(0, total - used), available: Math.max(0, total - used) };
}
function parseSwapUsage(text) { // vm.swapusage: total = 2048.00M  used = 1023.25M  free = 1024.75M  (encrypted)
  const g = (k) => { const m = String(text || '').match(new RegExp(k + '\\s*=\\s*([\\d.]+[BKMGT]?)', 'i')); return m ? sizeStr(m[1]) : 0; };
  return { total: g('total'), used: g('used'), free: g('free') };
}
function parseLinuxMeminfo(text) {
  const o = {}; for (const l of String(text || '').split('\n')) { const m = l.match(/^(\w+(?:\(\w+\))?):\s+(\d+)\s*kB/); if (m) o[m[1]] = +m[2] * 1024; }
  return o;
}

// ------------------------------------------------------------------ macOS processes
/** `ps -axww -o pid=,ppid=,pcpu=,rss=,user=,comm=` — comm is the full executable path and may contain spaces. */
function parsePsMac(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+([\d.,]+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/); if (!m) continue;
    const exe = m[6]; const name = exe.split('/').pop();
    out.push({ pid: +m[1], ppid: +m[2], cpu: parseFloat(m[3].replace(',', '.')) || 0, mem: +m[4] * 1024, user: m[5], path: exe, name });
  }
  return out;
}
/** `top -l 1 -stats pid,mem` → Map(pid → bytes). The MEM column is the footprint Activity Monitor uses. */
function parseTopMem(text) {
  const map = new Map(); let inRows = false;
  for (const line of String(text || '').split('\n')) {
    if (/^\s*PID\s+MEM/.test(line)) { inRows = true; continue; }
    if (!inRows) continue;
    const m = line.match(/^\s*(\d+)\s+([\d.]+[BKMGT]?)[+-]?\s*$/); if (m) map.set(+m[1], sizeStr(m[2]));
  }
  return map;
}
/** `lsappinfo list` → Map(pid → { name, bundleId, bundlePath, type }) — type is Foreground, UIElement or BackgroundOnly. */
function parseLsappinfo(text) {
  const map = new Map();
  const blocks = ('\n' + String(text || '')).split(/\n\s*(?:\d+\)\s+)?(?="[^"\n]*"\s+ASN:)/);
  for (const b of blocks) {
    const name = (b.match(/^"([^"]*)"/) || [])[1];
    const pid = +(b.match(/\bpid\s*=\s*(\d+)/) || [])[1];
    if (!pid) continue;
    map.set(pid, {
      name: name || '', pid,
      bundleId: (b.match(/bundleID="([^"]*)"/) || [])[1] || '',
      bundlePath: (b.match(/bundle path="([^"]*)"/) || [])[1] || '',
      type: (b.match(/\btype="([^"]*)"/) || [])[1] || ''
    });
  }
  return map;
}
/** `lsappinfo info -only name -only bundleid -only pid -only bundlepath <front ASN>` */
function parseLsappFront(text) {
  const t = String(text || '');
  const g = (k) => (t.match(new RegExp('"' + k + '"\\s*=\\s*"?([^"\\n]*)"?')) || [])[1] || '';
  const pid = +g('pid');
  const name = g('LSDisplayName') || g('name');
  if (!name && !pid) return null;
  return { name, bundleId: g('CFBundleIdentifier'), pid, path: g('LSBundlePath') };
}

// ------------------------------------------------------------------ macOS ioreg
/** GPU busy % from `ioreg -r -d 1 -w 0 -c IOAccelerator` (no admin needed). */
function parseIoregGpu(text) {
  let util = null, mem = null, name = null;
  for (const m of String(text || '').matchAll(/"PerformanceStatistics"\s*=\s*\{([^}]*)\}/g)) {
    const s = m[1];
    const u = s.match(/"Device Utilization %"\s*=\s*(\d+)/) || s.match(/"GPU Activity\(%\)"\s*=\s*(\d+)/);
    if (u) util = Math.max(util ?? 0, +u[1]);
    const mm = s.match(/"In use system memory"\s*=\s*(\d+)/); if (mm) mem = Math.max(mem ?? 0, +mm[1]);
  }
  const n = String(text || '').match(/"model"\s*=\s*"([^"]+)"/) || String(text || '').match(/"IOGLBundleName"\s*=\s*"([^"]+)"/); if (n) name = n[1];
  return { util, mem, name };
}
/** Top-level scalar keys from `ioreg -rn AppleSmartBattery` */
function parseIoregProps(text) {
  const o = {};
  for (const m of String(text || '').matchAll(/^\s*"([\w ]+)"\s*=\s*(.+?)\s*$/gm)) {
    const v = m[2];
    if (/^\d{16,}$/.test(v)) { const b = BigInt(v); o[m[1]] = Number(b >= 2n ** 63n ? b - 2n ** 64n : b); }
    else if (/^-?\d+$/.test(v)) o[m[1]] = +v; else if (v === 'Yes') o[m[1]] = true; else if (v === 'No') o[m[1]] = false;
    else if (/^"/.test(v)) o[m[1]] = v.replace(/^"|"$/g, ''); else if (!(m[1] in o)) o[m[1]] = v;
  }
  return o;
}
function macBatteryFromIoreg(o) {
  if (!o || !('CycleCount' in o || 'DesignCapacity' in o)) return null;
  const design = o.DesignCapacity || null;
  const maxRaw = o.AppleRawMaxCapacity || o.NominalChargeCapacity || (o.MaxCapacity > 100 ? o.MaxCapacity : null);
  return {
    cycles: o.CycleCount ?? null, designCapacity: design, maxCapacity: maxRaw,
    health: design && maxRaw ? Math.min(100, Math.round(maxRaw / design * 100)) : null,
    temperature: o.Temperature ? o.Temperature / 100 : (o.VirtualTemperature ? o.VirtualTemperature / 100 : null),
    voltage: o.Voltage ? o.Voltage / 1000 : null, amperage: o.Amperage ?? o.InstantAmperage ?? null,
    charging: !!o.IsCharging, plugged: !!o.ExternalConnected, fullyCharged: !!o.FullyCharged,
    percent: o.CurrentCapacity != null && o.MaxCapacity != null && o.MaxCapacity <= 100 ? o.CurrentCapacity : (o.CurrentCapacity && maxRaw ? Math.round(o.CurrentCapacity / maxRaw * 100) : null),
    timeRemaining: o.TimeRemaining && o.TimeRemaining < 65535 ? o.TimeRemaining : null,
    serial: o.Serial || null
  };
}
/** `pmset -g therm` → { speedLimit, warning } */
function parsePmsetTherm(text) {
  const t = String(text || '');
  const lim = t.match(/CPU_Speed_Limit\s*=\s*(\d+)/);
  const warn = /No thermal warning level has been recorded/i.test(t) ? null : ((t.match(/thermal warning level.*?:\s*(\w+)/i) || [])[1] || null);
  return { speedLimit: lim ? +lim[1] : null, warning: warn };
}
/** mdls -raw with several -name flags and several files: NUL-separated values, file by file. */
function parseMdlsRaw(text, files, names) {
  const parts = String(text || '').split('\0');
  const out = {};
  files.forEach((f, i) => {
    const o = {};
    names.forEach((n, j) => { const v = parts[i * names.length + j]; o[n] = v == null || v === '(null)' ? null : v; });
    out[f] = o;
  });
  return out;
}
function mdDate(s) { if (!s) return null; const d = new Date(String(s).replace(' +0000', 'Z').replace(' ', 'T')); return isNaN(d) ? null : d.getTime(); }

// ------------------------------------------------------------------ macOS launchd
function parseLaunchctlList(text) {
  const map = new Map();
  for (const l of String(text || '').split('\n').slice(1)) {
    const m = l.match(/^(\S+)\s+(\S+)\s+(.+)$/); if (!m) continue;
    map.set(m[3].trim(), { pid: m[1] === '-' ? null : +m[1], status: m[2] === '-' ? null : +m[2] });
  }
  return map;
}
function parsePrintDisabled(text) {
  const map = new Map();
  for (const m of String(text || '').matchAll(/"([^"]+)"\s*=>\s*(\w+)/g)) map.set(m[1], m[2] === 'disabled' || m[2] === 'true');
  return map;
}
/** Login items from our osascript: one "name<TAB>path" per line. */
function parseLoginItems(text) {
  return String(text || '').split(/\r?\n/).map((l) => l.split('\t')).filter((f) => f[0] && f[0].trim())
    .map(([name, p]) => ({ name: name.trim(), path: p && p.trim() && p.trim() !== 'missing value' ? p.trim() : null }));
}

// ------------------------------------------------------------------ macOS privacy (TCC)
const TCC = {
  kTCCServiceCamera: { label: 'Camera', group: 'Devices', reset: 'Camera', pane: 'Privacy_Camera' },
  kTCCServiceMicrophone: { label: 'Microphone', group: 'Devices', reset: 'Microphone', pane: 'Privacy_Microphone' },
  kTCCServiceScreenCapture: { label: 'Screen Recording', group: 'Screen & input', reset: 'ScreenCapture', pane: 'Privacy_ScreenCapture' },
  kTCCServiceAccessibility: { label: 'Accessibility', group: 'Screen & input', reset: 'Accessibility', pane: 'Privacy_Accessibility' },
  kTCCServiceListenEvent: { label: 'Input Monitoring', group: 'Screen & input', reset: 'ListenEvent', pane: 'Privacy_ListenEvent' },
  kTCCServicePostEvent: { label: 'Control the keyboard & mouse', group: 'Screen & input', reset: 'PostEvent', pane: 'Privacy_Accessibility' },
  kTCCServiceSystemPolicyAllFiles: { label: 'Full Disk Access', group: 'Files', reset: 'SystemPolicyAllFiles', pane: 'Privacy_AllFiles' },
  kTCCServiceSystemPolicyDesktopFolder: { label: 'Desktop folder', group: 'Files', reset: 'SystemPolicyDesktopFolder', pane: 'Privacy_FilesAndFolders' },
  kTCCServiceSystemPolicyDocumentsFolder: { label: 'Documents folder', group: 'Files', reset: 'SystemPolicyDocumentsFolder', pane: 'Privacy_FilesAndFolders' },
  kTCCServiceSystemPolicyDownloadsFolder: { label: 'Downloads folder', group: 'Files', reset: 'SystemPolicyDownloadsFolder', pane: 'Privacy_FilesAndFolders' },
  kTCCServiceSystemPolicyRemovableVolumes: { label: 'Removable drives', group: 'Files', reset: 'SystemPolicyRemovableVolumes', pane: 'Privacy_FilesAndFolders' },
  kTCCServiceSystemPolicyNetworkVolumes: { label: 'Network drives', group: 'Files', reset: 'SystemPolicyNetworkVolumes', pane: 'Privacy_FilesAndFolders' },
  kTCCServiceSystemPolicyAppBundles: { label: 'App Management', group: 'Files', reset: 'SystemPolicyAppBundles', pane: 'Privacy_AppBundles' },
  kTCCServiceSystemPolicyAppData: { label: 'Other apps’ data', group: 'Files', reset: 'SystemPolicyAppData', pane: 'Privacy_AppData' },
  kTCCServiceFileProviderDomain: { label: 'File Provider', group: 'Files', reset: 'FileProviderDomain', pane: 'Privacy_FilesAndFolders' },
  kTCCServiceAddressBook: { label: 'Contacts', group: 'Personal data', reset: 'AddressBook', pane: 'Privacy_Contacts' },
  kTCCServiceCalendar: { label: 'Calendars', group: 'Personal data', reset: 'Calendar', pane: 'Privacy_Calendars' },
  kTCCServiceReminders: { label: 'Reminders', group: 'Personal data', reset: 'Reminders', pane: 'Privacy_Reminders' },
  kTCCServicePhotos: { label: 'Photos', group: 'Personal data', reset: 'Photos', pane: 'Privacy_Photos' },
  kTCCServicePhotosAdd: { label: 'Add to Photos', group: 'Personal data', reset: 'PhotosAdd', pane: 'Privacy_Photos' },
  kTCCServiceMediaLibrary: { label: 'Media & Apple Music', group: 'Personal data', reset: 'MediaLibrary', pane: 'Privacy_Media' },
  kTCCServiceSpeechRecognition: { label: 'Speech Recognition', group: 'Devices', reset: 'SpeechRecognition', pane: 'Privacy_SpeechRecognition' },
  kTCCServiceBluetoothAlways: { label: 'Bluetooth', group: 'Devices', reset: 'BluetoothAlways', pane: 'Privacy_Bluetooth' },
  kTCCServiceAppleEvents: { label: 'Automation', group: 'Screen & input', reset: 'AppleEvents', pane: 'Privacy_Automation' },
  kTCCServiceDeveloperTool: { label: 'Developer Tools', group: 'Screen & input', reset: 'DeveloperTool', pane: 'Privacy_DevTools' },
  kTCCServiceFocusStatus: { label: 'Focus status', group: 'Personal data', reset: 'FocusStatus', pane: 'Privacy_Focus' },
  kTCCServiceUserTracking: { label: 'Tracking', group: 'Personal data', reset: 'UserTracking', pane: 'Privacy_Advertising' }
};
/** sqlite3 -separator '|' rows: service|client|client_type|auth_value|last_modified[|indirect] */
function parseTccRows(text, source) {
  const rows = [];
  for (const l of String(text || '').split('\n')) {
    const f = l.split('|'); if (f.length < 5) continue;
    const [service, client, clientType, auth, modified, indirect] = f;
    const info = TCC[service]; if (!info) continue;
    rows.push({ service, label: info.label, group: info.group, client, clientType: +clientType, allowed: +auth >= 2, limited: +auth === 3, modified: +modified ? +modified * 1000 : null, target: indirect && indirect !== 'UNUSED' ? indirect : null, source });
  }
  return rows;
}

// ------------------------------------------------------------------ Windows registry
/** `reg query <key> /s` → [{ key, values: { name: { type, data } } }] */
function parseRegQuery(text) {
  const out = []; let cur = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    if (/^HKEY_/.test(raw)) { cur = { key: raw.trim(), values: {} }; out.push(cur); continue; }
    const m = raw.match(/^\s{4}(.+?)\s{4}(REG_[A-Z_]+)(?:\s{4}(.*))?$/);
    if (m && cur) cur.values[m[1]] = { type: m[2], data: regData(m[2], m[3] ?? '') };
  }
  return out;
}
function regData(type, s) {
  if (type === 'REG_DWORD' || type === 'REG_QWORD') { const v = String(s).trim(); return v.startsWith('0x') ? Number(BigInt(v)) : +v; }
  if (type === 'REG_MULTI_SZ') return String(s).split('\\0').filter(Boolean);
  return s;
}
const rv = (k, n) => (k.values[n] ? k.values[n].data : undefined);
function regDate(s) { // InstallDate: 20240131
  const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})$/); if (!m) return null; const d = new Date(+m[1], +m[2] - 1, +m[3]); return isNaN(d) ? null : d.getTime();
}
/** Uninstall keys → installed apps (skips updates, components and entries without a name). */
function winUninstallEntries(keys, scope) {
  const out = [];
  for (const k of keys) {
    const name = rv(k, 'DisplayName'); if (!name || typeof name !== 'string') continue;
    if (rv(k, 'SystemComponent') === 1 || rv(k, 'ParentKeyName') || rv(k, 'ReleaseType') === 'Update' || /^KB\d+/.test(name)) continue;
    const un = rv(k, 'UninstallString') || '';
    if (!un && !rv(k, 'QuietUninstallString')) continue;
    out.push({
      id: k.key, name: name.trim(), version: rv(k, 'DisplayVersion') || '', publisher: rv(k, 'Publisher') || '',
      installed: regDate(rv(k, 'InstallDate')), size: rv(k, 'EstimatedSize') ? rv(k, 'EstimatedSize') * 1024 : null,
      location: rv(k, 'InstallLocation') || '', icon: String(rv(k, 'DisplayIcon') || '').replace(/,\s*-?\d+$/, '').replace(/^"|"$/g, ''),
      uninstall: un, quietUninstall: rv(k, 'QuietUninstallString') || '', scope, source: 'desktop',
      msi: /msiexec/i.test(un)
    });
  }
  return out;
}
/** Dedupe the same app listed in HKLM, WOW6432Node and HKCU. */
function dedupeApps(list) {
  const seen = new Map();
  for (const a of list) { const k = (a.name + '|' + a.version).toLowerCase(); if (!seen.has(k)) seen.set(k, a); }
  return [...seen.values()];
}
/** MsiExec /I{GUID} → /X{GUID} so the uninstaller opens instead of "modify". */
function winUninstallCommand(a) {
  let s = String(a.uninstall || a.quietUninstall || '').trim();
  if (/msiexec(\.exe)?/i.test(s)) s = s.replace(/\/I\s*(\{[0-9A-F-]+\})/i, '/X$1');
  return s;
}
/** StartupApproved values: even first byte = enabled, odd = disabled. Accepts "0200000000..." strings. */
function approvedEnabled(hex) {
  if (hex == null || hex === '') return true;
  const b = parseInt(String(hex).slice(0, 2), 16); return isNaN(b) ? true : (b % 2 === 0);
}
/** A Run value's command line → the program it starts. */
function exeOfCommand(cmd) {
  const s = String(cmd || '').trim(); if (!s) return '';
  if (s.startsWith('"')) return s.slice(1, s.indexOf('"', 1) > 0 ? s.indexOf('"', 1) : undefined);
  const m = s.match(/^(.+?\.(exe|bat|cmd|com|lnk|vbs|ps1))(\s|$)/i); return m ? m[1] : s.split(' ')[0];
}

const WIN_CAPS = {
  webcam: { label: 'Camera', group: 'Devices', settings: 'ms-settings:privacy-webcam' },
  microphone: { label: 'Microphone', group: 'Devices', settings: 'ms-settings:privacy-microphone' },
  location: { label: 'Location', group: 'Devices', settings: 'ms-settings:privacy-location' },
  graphicsCaptureProgrammatic: { label: 'Screen capture', group: 'Screen & input', settings: 'ms-settings:privacy-graphicscaptureprogrammatic' },
  graphicsCaptureWithoutBorder: { label: 'Screen capture (borderless)', group: 'Screen & input', settings: 'ms-settings:privacy-graphicscapturewithoutborder' },
  userNotificationListener: { label: 'Notifications', group: 'Personal data', settings: 'ms-settings:privacy-notifications' },
  contacts: { label: 'Contacts', group: 'Personal data', settings: 'ms-settings:privacy-contacts' },
  appointments: { label: 'Calendar', group: 'Personal data', settings: 'ms-settings:privacy-calendar' },
  phoneCall: { label: 'Phone calls', group: 'Personal data', settings: 'ms-settings:privacy-phonecalls' },
  phoneCallHistory: { label: 'Call history', group: 'Personal data', settings: 'ms-settings:privacy-callhistory' },
  email: { label: 'Email', group: 'Personal data', settings: 'ms-settings:privacy-email' },
  chat: { label: 'Messaging', group: 'Personal data', settings: 'ms-settings:privacy-messaging' },
  userDataTasks: { label: 'Tasks', group: 'Personal data', settings: 'ms-settings:privacy-tasks' },
  userAccountInformation: { label: 'Account info', group: 'Personal data', settings: 'ms-settings:privacy-accountinfo' },
  radios: { label: 'Radios', group: 'Devices', settings: 'ms-settings:privacy-radios' },
  bluetoothSync: { label: 'Bluetooth sync', group: 'Devices', settings: 'ms-settings:privacy-customdevices' },
  humanInterfaceDevice: { label: 'Input devices (HID)', group: 'Devices', settings: 'ms-settings:privacy-customdevices' },
  gazeInput: { label: 'Eye tracking', group: 'Devices', settings: 'ms-settings:privacy-eyetracker' },
  activity: { label: 'Motion', group: 'Devices', settings: 'ms-settings:privacy-motion' },
  wifiData: { label: 'Wi-Fi data', group: 'Devices', settings: 'ms-settings:privacy-radios' },
  cellularData: { label: 'Cellular data', group: 'Devices', settings: 'ms-settings:privacy-cellulardata' },
  picturesLibrary: { label: 'Pictures', group: 'Files', settings: 'ms-settings:privacy-pictures' },
  videosLibrary: { label: 'Videos', group: 'Files', settings: 'ms-settings:privacy-videos' },
  musicLibrary: { label: 'Music library', group: 'Files', settings: 'ms-settings:privacy-musiclibrary' },
  documentsLibrary: { label: 'Documents', group: 'Files', settings: 'ms-settings:privacy-documents' },
  downloadsFolder: { label: 'Downloads folder', group: 'Files', settings: 'ms-settings:privacy-downloadsfolder' },
  broadFileSystemAccess: { label: 'File system', group: 'Files', settings: 'ms-settings:privacy-broadfilesystemaccess' }
};
function filetime(n) { if (!n) return null; const ms = n / 1e4 - 11644473600000; return ms > 0 ? Math.round(ms) : null; }
/** ConsentStore reg dump → rows per app per capability. NonPackaged paths use # instead of \. */
function parseConsentStore(keys, root) {
  const rows = [];
  for (const k of keys) {
    const rel = k.key.slice(k.key.indexOf('ConsentStore\\') + 13); if (!rel || k.key.indexOf('ConsentStore\\') < 0) continue;
    const parts = rel.split('\\'); const cap = parts[0]; const info = WIN_CAPS[cap]; if (!info) continue;
    const value = rv(k, 'Value');
    if (parts.length === 1) { rows.push({ cap, label: info.label, group: info.group, client: '*', global: true, allowed: value !== 'Deny', key: k.key, root }); continue; }
    if (parts[1] === 'NonPackaged' && parts.length === 2) continue;
    const nonPackaged = parts[1] === 'NonPackaged';
    const client = nonPackaged ? parts.slice(2).join('\\').replace(/#/g, '\\') : parts[1];
    if (value == null && rv(k, 'LastUsedTimeStart') == null) continue;
    const start = filetime(rv(k, 'LastUsedTimeStart')), stop = filetime(rv(k, 'LastUsedTimeStop'));
    rows.push({ cap, label: info.label, group: info.group, client, nonPackaged, allowed: value !== 'Deny', key: k.key, root,
      lastUsed: stop || start || null, inUse: !!(start && rv(k, 'LastUsedTimeStop') === 0) });
  }
  return rows;
}
/** "Microsoft.WindowsCalculator" → "Windows Calculator" */
function prettyPackage(name) {
  const last = String(name || '').split('.').filter((p) => !/^(Microsoft|\d+)$/i.test(p)).pop() || name;
  return last.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').trim();
}

// ------------------------------------------------------------------ grouping processes into apps
const MAC_SYSTEM_PREFIX = ['/System/', '/usr/', '/sbin/', '/bin/', '/Library/Apple/', '/private/var/', '/Library/Developer/CommandLineTools/'];
function macBundleOf(p) { // outermost .app in the path
  const i = String(p || '').indexOf('.app/'); if (i < 0) return String(p || '').endsWith('.app') ? p : null;
  return p.slice(0, i + 4);
}
/**
 * Group processes into apps the way a person thinks about them: every Chrome helper belongs to Chrome.
 * procs: [{ pid, ppid, name, path, cpu, mem, user }]
 * ctx: { platform, lsapp (Map pid→{type,bundleId,name}), windows (Set pid), descriptions (Map pid→desc), selfPid }
 */
function groupProcesses(procs, ctx = {}) {
  const platform = ctx.platform || process.platform;
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const groups = new Map();
  const keyOf = new Map();
  const lsapp = ctx.lsapp || new Map(); const windows = ctx.windows || new Set(); const descs = ctx.descriptions || new Map();

  const baseKey = (p) => {
    if (platform === 'darwin') { const b = macBundleOf(p.path); if (b) return 'app:' + b; }
    if (platform === 'win32') return 'exe:' + String(p.name || '').toLowerCase();
    return 'exe:' + String(p.name || '');
  };
  for (const p of procs) keyOf.set(p.pid, baseKey(p));
  // processes outside a bundle attach to an app parent (e.g. node or python started by an app)
  if (platform !== 'win32') {
    for (const p of procs) {
      if (keyOf.get(p.pid).startsWith('app:')) continue;
      let q = byPid.get(p.ppid), hops = 0;
      while (q && q.pid > 1 && hops < 6) { const k = keyOf.get(q.pid); if (k && k.startsWith('app:')) { keyOf.set(p.pid, k); break; } q = byPid.get(q.ppid); hops++; }
    }
  } else {
    // Windows: a child whose parent has a window and is not explorer/services joins the parent (e.g. a game's helper)
    for (const p of procs) {
      const par = byPid.get(p.ppid); if (!par || !windows.has(par.pid)) continue;
      if (/^(explorer|services|svchost|wininit|winlogon|cmd|powershell|pwsh|windowsterminal|conhost)\.exe$/i.test(par.name)) continue;
      if (/^(conhost|crashpad_handler)\.exe$/i.test(p.name)) { keyOf.set(p.pid, keyOf.get(par.pid)); continue; }
    }
  }
  for (const p of procs) {
    const k = keyOf.get(p.pid);
    let g = groups.get(k);
    if (!g) {
      g = { key: k, name: '', path: '', bundleId: '', pids: [], procs: [], cpu: 0, mem: 0, kind: 'background', windowed: false, users: new Set() };
      groups.set(k, g);
    }
    g.procs.push(p); g.pids.push(p.pid); g.cpu += p.cpu || 0; g.mem += p.mem || 0; if (p.user) g.users.add(p.user);
    const la = lsapp.get(p.pid);
    if (la) { if (la.type === 'Foreground') g.windowed = true; if (la.bundleId && !g.bundleId) g.bundleId = la.bundleId; if (la.name && (la.type === 'Foreground' || !g.name)) g.name = la.name; }
    if (windows.has(p.pid)) g.windowed = true;
  }
  const out = [];
  for (const g of groups.values()) {
    const main = g.procs.slice().sort((a, b) => (a.ppid === 1 ? -1 : 0) - (b.ppid === 1 ? -1 : 0) || a.pid - b.pid)[0];
    if (g.key.startsWith('app:')) { g.path = g.key.slice(4); if (!g.name) g.name = g.path.split('/').pop().replace(/\.app$/, ''); }
    else { g.path = main.path || ''; if (!g.name) g.name = (platform === 'win32' && descs.get(main.pid)) || prettyExe(main.name); }
    if (platform === 'win32') { const d = g.procs.map((p) => descs.get(p.pid)).find(Boolean); if (d) g.name = d; }
    const users = [...g.users];
    const sys = platform === 'darwin'
      ? (g.path.startsWith('/System/') && !g.windowed) || (!g.key.startsWith('app:') && (MAC_SYSTEM_PREFIX.some((x) => g.path.startsWith(x)) || (users.length > 0 && users.every((u) => u === 'root' || u.startsWith('_')))))
      : platform === 'win32' ? (/\\windows\\/i.test(g.path) && !g.windowed) || (!g.path && !g.windowed) || (users.length > 0 && users.every((u) => /^(SYSTEM|LOCAL SERVICE|NETWORK SERVICE)$/i.test(u) || /^NT AUTHORITY/i.test(u)))
      : users.length > 0 && users.every((u) => u === 'root');
    g.kind = g.windowed ? 'app' : sys ? 'system' : 'background';
    g.mainPid = main.pid; g.users = users; g.count = g.pids.length;
    g.self = ctx.selfPid ? g.pids.includes(ctx.selfPid) : false;
    g.procs.sort((a, b) => b.mem - a.mem);
    out.push(g);
  }
  return out;
}
function prettyExe(n) { return String(n || '').replace(/\.exe$/i, ''); }

module.exports = {
  sizeStr, parseVmStat, macMemory, parseSwapUsage, parseLinuxMeminfo, parsePsMac, parseTopMem, parseLsappinfo, parseLsappFront,
  parseIoregGpu, parseIoregProps, macBatteryFromIoreg, parsePmsetTherm, parseMdlsRaw, mdDate, parseLaunchctlList, parsePrintDisabled, parseLoginItems,
  TCC, parseTccRows, parseRegQuery, winUninstallEntries, dedupeApps, winUninstallCommand, approvedEnabled, exeOfCommand, WIN_CAPS, parseConsentStore,
  filetime, prettyPackage, groupProcesses, macBundleOf, regDate
};
