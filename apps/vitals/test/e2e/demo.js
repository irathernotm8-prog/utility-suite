// Same drive as drive.js, but with a pretend Mac: sensors, battery, fans, apps, startup items and permissions are faked
// so every page can be checked with real-looking data on Linux. Run: VITALS_DEMO=1 test/e2e/run.sh
const path = require('path');
const sys = (m) => require(path.join(__dirname, '../../src/sys', m));
module.exports = async (ctx) => {
  const { sampler } = ctx;
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  const orig = sampler.onTick; let k = 0;
  sampler.onTick = (s) => {
    k++;
    s.thermal = { cpu: 52 + 8 * Math.sin(k / 5) + Math.random() * 3, gpu: 47 + Math.random() * 4, soc: 49, cores: [54, 56, 51, 53, 47, 46, 45, 48], fans: [], state: k > 25 ? 'fair' : 'nominal', speedLimit: null, source: 'sensors' };
    s.gpu = { util: 18 + Math.random() * 20, memUsed: 1.9e9, name: 'Apple M2' };
    s.battery = { present: true, percent: 76, charging: false, plugged: false, cycles: 312, designCapacity: 4382, maxCapacity: 3871, health: 88, temperature: 31.2, voltage: 12.6, amperage: -820, timeRemaining: 388 };
    s.mem.app = s.mem.used * 0.6; s.mem.wired = s.mem.used * 0.25; s.mem.compressed = s.mem.used * 0.15; s.mem.swap = { total: 2e9, used: 6.2e8 };
    s.volumes = [{ name: 'Macintosh HD', mount: '/', size: 494e9, used: 401e9, free: 93e9, pct: 81 }];
    s.cpu.cores = [22, 31, 18, 25, 9, 7, 5, 11];
    sampler.history.temp[sampler.history.temp.length - 1] = s.thermal.cpu; sampler.history.gpu[sampler.history.gpu.length - 1] = s.gpu.util;
    orig(s);
  };
  const DAY = 86400000, now = Date.now();
  sys('apps').list = async () => [
    { id: '/Applications/Google Chrome.app', path: '/Applications/Google Chrome.app', name: 'Google Chrome', bundleId: 'com.google.Chrome', version: '130.0.6723.70', publisher: 'Google LLC', size: 1.32e9, lastUsed: now - 3600e3, installed: now - 400 * DAY },
    { id: '/Applications/Slack.app', path: '/Applications/Slack.app', name: 'Slack', bundleId: 'com.tinyspeck.slackmacgap', version: '4.41.97', publisher: 'Slack Technologies', size: 5.1e8, lastUsed: now - 2 * DAY, installed: now - 300 * DAY },
    { id: '/Applications/Zoom.us.app', path: '/Applications/zoom.us.app', name: 'zoom.us', bundleId: 'us.zoom.xos', version: '6.2.5', publisher: 'Zoom Video Communications', size: 3.3e8, lastUsed: now - 21 * DAY, installed: now - 500 * DAY },
    { id: '/Applications/Adobe Photoshop 2025.app', path: '/Applications/Adobe Photoshop 2025/Adobe Photoshop 2025.app', name: 'Adobe Photoshop 2025', bundleId: 'com.adobe.Photoshop', version: '26.0', publisher: 'Adobe Inc.', size: 4.8e9, lastUsed: now - 6 * DAY, installed: now - 60 * DAY },
    { id: '/Applications/Steam.app', path: '/Applications/Steam.app', name: 'Steam', bundleId: 'com.valvesoftware.steam', version: '4.0', publisher: 'Valve Corporation', size: 6.2e8, lastUsed: now - 260 * DAY, installed: now - 700 * DAY },
    { id: '/Applications/Skitch.app', path: '/Applications/Skitch.app', name: 'Skitch', bundleId: 'com.skitch.skitch', version: '2.9', publisher: 'Evernote', size: 9.1e7, lastUsed: now - 410 * DAY, installed: now - 900 * DAY, appStore: true },
    { id: '/Applications/Datum.app', path: '/Applications/Datum.app', name: 'Datum', bundleId: 'com.bilal.datum', version: '1.5.3', publisher: '', size: 2.6e8, lastUsed: now - DAY, installed: now - 20 * DAY },
    { id: '/System/Applications/Safari.app', path: '/System/Applications/Safari.app', name: 'Safari', bundleId: 'com.apple.Safari', version: '18.1', publisher: 'Apple', size: 1.6e7, lastUsed: now - 9 * DAY, protected: true, installed: now - 30 * DAY }
  ];
  sys('apps').macLeftovers = () => [{ path: '/Users/bilal/Library/Application Support/Steam', kind: 'App data', dir: true }, { path: '/Users/bilal/Library/Caches/com.valvesoftware.steam', kind: 'Cache', dir: true }, { path: '/Users/bilal/Library/Preferences/com.valvesoftware.steam.plist', kind: 'Preferences', dir: false, size: 4200 }];
  sys('startup').list = async () => ({ items: [
    { id: 'login:Docket', kind: 'Login item', type: 'login', scope: 'user', name: 'Docket', program: '/Applications/Docket.app', app: '/Applications/Docket.app', enabled: true },
    { id: 'login:Rectangle', kind: 'Login item', type: 'login', scope: 'user', name: 'Rectangle', program: '/Applications/Rectangle.app', app: '/Applications/Rectangle.app', enabled: true },
    { id: 'launchd:1', kind: 'Launch agent', type: 'agent', scope: 'user', name: 'Google — keystone.agent', label: 'com.google.keystone.agent', program: '/Users/bilal/Library/Google/GoogleSoftwareUpdate/GoogleSoftwareUpdate.bundle/Contents/Resources/GoogleSoftwareUpdateAgent.app/Contents/MacOS/GoogleSoftwareUpdateAgent', enabled: true, running: false, file: '/Users/bilal/Library/LaunchAgents/com.google.keystone.agent.plist' },
    { id: 'launchd:2', kind: 'Launch agent', type: 'agent', scope: 'all users', name: 'Adobe — AdobeCreativeCloud', label: 'com.adobe.AdobeCreativeCloud', program: '/Applications/Utilities/Adobe Creative Cloud/ACC/Creative Cloud.app/Contents/MacOS/Creative Cloud', enabled: true, running: true, file: '/Library/LaunchAgents/com.adobe.AdobeCreativeCloud.plist' },
    { id: 'launchd:3', kind: 'Launch agent', type: 'agent', scope: 'user', name: 'Skitch helper', label: 'com.skitch.helper', program: '/Applications/Skitch.app/Contents/Library/LoginItems/SkitchHelper.app/Contents/MacOS/SkitchHelper', enabled: true, missing: true, file: '/Users/bilal/Library/LaunchAgents/com.skitch.helper.plist' },
    { id: 'launchd:4', kind: 'Background service', type: 'daemon', scope: 'system', name: 'Zoom — ZoomDaemon', label: 'us.zoom.ZoomDaemon', program: '/Library/PrivilegedHelperTools/us.zoom.ZoomDaemon', enabled: true, running: true, needsAdmin: true, file: '/Library/LaunchDaemons/us.zoom.ZoomDaemon.plist' },
    { id: 'launchd:5', kind: 'Background service', type: 'daemon', scope: 'system', name: 'Docker — vmnetd', label: 'com.docker.vmnetd', program: '/Library/PrivilegedHelperTools/com.docker.vmnetd', enabled: false, needsAdmin: true, file: '/Library/LaunchDaemons/com.docker.vmnetd.plist' }
  ], loginError: null });
  sys('startup').toggle = async () => ({ ok: true });
  const P = sys('parse');
  const row = (service, client, allowed, source = 'user') => ({ service, label: P.TCC[service].label, group: P.TCC[service].group, client, allowed, source, modified: now - 40 * DAY });
  sys('perms').list = async () => ({ needsAccess: false, rows: [
    row('kTCCServiceCamera', 'us.zoom.xos', true), row('kTCCServiceCamera', 'com.google.Chrome', true), row('kTCCServiceCamera', 'com.tinyspeck.slackmacgap', false),
    row('kTCCServiceMicrophone', 'us.zoom.xos', true), row('kTCCServiceMicrophone', 'com.google.Chrome', true), row('kTCCServiceMicrophone', 'com.tinyspeck.slackmacgap', true), row('kTCCServiceMicrophone', 'com.bilal.docket', true),
    row('kTCCServiceScreenCapture', 'us.zoom.xos', true, 'system'), row('kTCCServiceScreenCapture', 'com.bilal.docket', true, 'system'), row('kTCCServiceAccessibility', 'com.knollsoft.Rectangle', true, 'system'),
    row('kTCCServiceSystemPolicyAllFiles', 'com.apple.Terminal', true, 'system'), row('kTCCServiceSystemPolicyAllFiles', 'com.bilal.vitals', true, 'system'),
    row('kTCCServiceSystemPolicyDownloadsFolder', 'com.google.Chrome', true), row('kTCCServiceSystemPolicyDocumentsFolder', 'com.bilal.docket', true), row('kTCCServiceAddressBook', 'com.tinyspeck.slackmacgap', false),
    row('kTCCServicePhotos', 'com.adobe.Photoshop', true), row('kTCCServiceListenEvent', 'com.knollsoft.Rectangle', true, 'system')
  ] });
  return require('./drive')(ctx);
};
