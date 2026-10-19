// Verifies that the native pieces RO3 needs were installed for THIS computer.
// Runs after `npm install` and before every build, so a broken installer is never produced.
const fs = require('fs');
const strict = process.argv.includes('--strict');
const plat = process.platform, arch = process.arch;
const problems = [];

try { require('sharp'); } catch (e) {
  problems.push(`Image engine (sharp) is missing its ${plat}-${arch} files.\n` +
    `    Fix: npm install --os=${plat} --cpu=${arch} sharp\n` +
    `    (or delete node_modules and package-lock.json, then run npm install again)`);
}
try {
  const ff = require('ffmpeg-static');
  if (!ff || !fs.existsSync(ff)) throw new Error('missing');
} catch (e) { problems.push('FFmpeg was not downloaded.\n    Fix: delete node_modules\\ffmpeg-static and run npm install again (needs internet).'); }
try {
  const fp = require('ffprobe-static').path;
  if (!fp || !fs.existsSync(fp)) throw new Error('missing');
} catch (e) { problems.push('FFprobe is missing.\n    Fix: npm install ffprobe-static'); }

if (problems.length) {
  console.error('\n✖ RO3 setup problem:\n  - ' + problems.join('\n  - ') + '\n');
  process.exit(strict ? 1 : 0);
} else {
  console.log(`✔ RO3 dependencies OK for ${plat}-${arch}`);
}
