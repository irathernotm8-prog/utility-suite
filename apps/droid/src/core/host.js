// What this computer can give to virtual devices, and whether it can run them fast.
'use strict';
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');

function info(dir) {
  const ramMB = Math.round(os.totalmem() / 1048576);
  const cores = os.cpus().length || 4;
  let disk = null;
  try { const s = fs.statfsSync(dir); disk = { free: s.bavail * s.bsize, total: s.blocks * s.bsize }; } catch {}
  return {
    platform: process.platform, arch: process.arch, ramMB, freeMB: Math.round(os.freemem() / 1048576), cores,
    cpu: (os.cpus()[0] || {}).model || '', disk,
    // Leave the computer itself room to breathe: devices may use up to ~70% of RAM and all but one core.
    limits: { ramMB: Math.max(2048, Math.floor((ramMB * 0.7) / 512) * 512), cores: Math.max(1, cores - (cores > 4 ? 2 : 1)) },
  };
}

// Runs the emulator's own check. Returns { ok, text }.
function accelCheck(emulatorBin) {
  return new Promise((resolve) => {
    if (!emulatorBin || !fs.existsSync(emulatorBin)) return resolve({ ok: null, text: 'The emulator is not installed yet.' });
    execFile(emulatorBin, ['-accel-check'], { timeout: 30000, windowsHide: true }, (err, out, errOut) => {
      const text = `${out || ''}${errOut || ''}`.trim();
      // Prints "accel:\n<code>\n<message>\naccel"; exit code 0 means acceleration works.
      const ok = !err || err.code === 0;
      const msg = text.split('\n').map((l) => l.trim()).filter((l) => l && !/^accel:?$/.test(l) && !/^\d+$/.test(l)).join(' ');
      resolve({ ok, text: msg || (ok ? 'Hardware acceleration is ready.' : 'Hardware acceleration is not available.') });
    });
  });
}

module.exports = { info, accelCheck };
