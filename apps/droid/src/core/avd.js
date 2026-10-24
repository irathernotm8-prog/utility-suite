// Writes the emulator's own device definition (an "AVD") from a Droid device record.
// Droid keeps its AVDs in its own folder (ANDROID_AVD_HOME) so they never mix with Android Studio's.
'use strict';
const fs = require('fs');
const path = require('path');

const avdName = (dev) => `droid_${dev.id}`;
const imageDir = (imagePath) => imagePath.split(';').join('/') + '/';   // system-images;android-36;google_apis_playstore;arm64-v8a

// vm.heapSize the way Android Studio picks it (per density and screen size), so big apps don't run out of heap.
function heapFor(w, h, dpi, ramMB) {
  const sw = Math.min(w, h) / (dpi / 160);
  let heap = sw >= 600 ? 384 : dpi >= 560 ? 512 : dpi >= 400 ? 384 : dpi >= 300 ? 256 : 192;
  if (ramMB <= 2048) heap = Math.min(heap, 256);
  return heap;
}

function configIni(dev) {
  const img = dev.image;
  const { w, h, dpi } = dev.screen;
  const arch = img.abi === 'arm64-v8a' ? 'arm64' : img.abi === 'x86_64' ? 'x86_64' : img.abi;
  const play = img.tag === 'google_apis_playstore';
  const landscape = w > h;
  const kv = {
    'avd.ini.encoding': 'UTF-8',
    'AvdId': avdName(dev),
    'avd.ini.displayname': dev.name.replace(/[\r\n]/g, ' '),
    'abi.type': img.abi,
    'hw.cpu.arch': arch,
    'image.sysdir.1': imageDir(img.path),
    'tag.id': img.tag,
    'tag.ids': img.tag,
    'tag.display': img.tagName || img.tag,
    'target': `android-${String(img.api).replace(/x$/, '')}`,
    'PlayStore.enabled': play ? 'true' : 'false',
    'hw.device.manufacturer': 'Droid',
    'hw.device.name': `droid-${dev.style}`,
    'hw.lcd.width': w,
    'hw.lcd.height': h,
    'hw.lcd.density': dpi,
    'hw.initialOrientation': landscape ? 'landscape' : 'portrait',
    'hw.ramSize': dev.ramMB,
    'vm.heapSize': heapFor(w, h, dpi, dev.ramMB),
    'hw.cpu.ncore': dev.cores,
    'disk.dataPartition.size': `${dev.storageGB}G`,
    'hw.sdCard': 'no',
    'hw.keyboard': 'yes',
    'hw.mainKeys': 'no',
    'hw.dPad': 'no',
    'hw.trackBall': 'no',
    'hw.gpu.enabled': 'yes',
    'hw.gpu.mode': dev.options?.gpu || 'auto',
    'hw.audioInput': dev.options?.microphone ? 'yes' : 'no',
    'hw.audioOutput': 'yes',
    'hw.camera.back': 'virtualscene',
    'hw.camera.front': 'emulated',
    'hw.gps': 'yes',
    'hw.battery': 'yes',
    'hw.accelerometer': 'yes',
    'hw.gyroscope': 'yes',
    'hw.sensors.orientation': 'yes',
    'hw.sensors.proximity': 'yes',
    'hw.sensors.light': 'yes',
    'hw.sensors.magnetic_field': 'yes',
    'showDeviceFrame': 'no',
    'skin.dynamic': 'yes',
    'skin.name': `${w}x${h}`,
    'skin.path': '_no_skin',
    'fastboot.forceColdBoot': dev.options?.quickBoot === false ? 'yes' : 'no',
    'fastboot.forceFastBoot': dev.options?.quickBoot === false ? 'no' : 'yes',
    'fastboot.chosenSnapshotFile': '',
    'runtime.network.latency': 'none',
    'runtime.network.speed': 'full',
  };
  return Object.entries(kv).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
}

// Writes <avdHome>/droid_<id>.ini and <avdHome>/droid_<id>.avd/config.ini. Safe to call before every launch:
// it rewrites the hardware lines but leaves the device's data (userdata, snapshots) alone.
function writeAvd(avdHome, dev) {
  const name = avdName(dev);
  const dir = path.join(avdHome, `${name}.avd`);
  fs.mkdirSync(dir, { recursive: true });
  const target = `android-${String(dev.image.api).replace(/x$/, '')}`;
  fs.writeFileSync(path.join(avdHome, `${name}.ini`), `avd.ini.encoding=UTF-8\npath=${dir}\npath.rel=avd/${name}.avd\ntarget=${target}\n`);
  const cfg = path.join(dir, 'config.ini');
  // keep any lines the emulator itself added (it records things like firstboot state) unless we own the key
  const ours = configIni(dev);
  const ownKeys = new Set(ours.split('\n').filter(Boolean).map((l) => l.split('=')[0]));
  let extra = '';
  if (fs.existsSync(cfg)) {
    extra = fs.readFileSync(cfg, 'utf8').split(/\r?\n/).filter((l) => l && !ownKeys.has(l.split('=')[0])).join('\n');
  }
  fs.writeFileSync(cfg, ours + (extra ? extra + '\n' : ''));
  return { name, dir };
}

function avdDir(avdHome, dev) { return path.join(avdHome, `${avdName(dev)}.avd`); }

// Bytes used by a device on disk (userdata, snapshots, caches).
function diskUsage(dir) {
  let total = 0;
  const walk = (d) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { try { const st = fs.statSync(p); total += st.blocks ? st.blocks * 512 : st.size; } catch {} }
    }
  };
  walk(dir);
  return total;
}

module.exports = { avdName, imageDir, configIni, writeAvd, avdDir, diskUsage, heapFor };
