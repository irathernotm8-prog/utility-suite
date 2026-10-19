// electron-builder afterPack hook: refuse to finish a build that is missing the
// native image engine for the target platform (the cause of "Could not load the sharp module").
const fs = require('fs');
const path = require('path');
const ARCH = { 0: 'ia32', 1: 'x64', 2: 'arm', 3: 'arm64', 4: 'universal' };

exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName;
  const arch = ARCH[context.arch] || String(context.arch);
  const resources = platform === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');
  const img = path.join(resources, 'app.asar.unpacked', 'node_modules', '@img');
  const archs = arch === 'universal' ? ['x64', 'arm64'] : [arch];
  const missing = [];
  for (const a of archs) {
    const need = [`sharp-${platform}-${a}`];
    if (platform !== 'win32') need.push(`sharp-libvips-${platform}-${a}`);
    for (const n of need) if (!fs.existsSync(path.join(img, n))) missing.push('@img/' + n);
  }
  if (missing.length) {
    throw new Error(`RO3 build is missing ${missing.join(', ')}.\n` +
      `Run: npm install --os=${platform} --cpu=${archs[0]} sharp   then build again.`);
  }
  console.log(`  • RO3 check: image engine present for ${platform}-${archs.join('+')}`);
};
