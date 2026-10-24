// Works out what a file or folder is from its bytes (extensions only break ties), and gathers the
// details the overview shows. quick() is cheap enough to run on every file of an unpacked app.
'use strict';
const fs = require('fs');
const path = require('path');
const { FileReader } = require('./util');
const { TYPES } = require('./types');
const pe = require('./formats/pe');
const elf = require('./formats/elf');
const macho = require('./formats/macho');
const zip = require('./formats/zip');
const iso = require('./formats/iso9660');
const xiso = require('./formats/xiso');
const gcm = require('./formats/gcm');
const godot = require('./formats/godot');
const python = require('./formats/python');
const javaish = require('./formats/javaish');
const dnb = require('./formats/dotnetbundle');
const asar = require('./formats/asar');

const ext = (f) => path.extname(f).slice(1).toLowerCase();
const has = (b, s, from = 0) => b.indexOf(Buffer.from(s, 'latin1'), from) >= 0;

function zipKind(file, e) {
  const byExt = { apk: 'apk', aab: 'aab', xapk: 'apkbundle', apkm: 'apkbundle', apks: 'apkbundle', aar: 'aar', ipa: 'ipa', jar: 'jar', war: 'jar', ear: 'jar', nupkg: 'nupkg', snupkg: 'nupkg', whl: 'pyarchive', egg: 'pyarchive', msix: 'msix', appx: 'msix', msixbundle: 'msix', appxbundle: 'msix', vsix: 'crx', xpi: 'crx' }[e];
  if (byExt) return byExt;
  try {
    const z = zip.open(file); const names = z.entries.map((x) => x.path); z.close();
    const s = new Set(names);
    if (s.has('AndroidManifest.xml') && names.some((n) => /^classes\d*\.dex$/.test(n))) return 'apk';
    if (s.has('BundleConfig.pb')) return 'aab';
    if (names.some((n) => /^Payload\/[^/]+\.app\//.test(n))) return 'ipa';
    if (names.some((n) => /\.apk$/.test(n)) && (s.has('manifest.json') || s.has('info.json'))) return 'apkbundle';
    if (s.has('AppxManifest.xml') || s.has('AppxMetadata/AppxBundleManifest.xml')) return 'msix';
    if (names.some((n) => /\.nuspec$/.test(n))) return 'nupkg';
    if (s.has('META-INF/MANIFEST.MF') || names.some((n) => n.endsWith('.class'))) return 'jar';
    if (s.has('manifest.json') && names.some((n) => /\.js$/.test(n))) return 'crx';
  } catch {}
  return 'zip';
}

function peKind(file, r, info, head) {
  const traits = [];
  if (info.sections && info.sections.some((s) => /^UPX\d|^\.?UPX/.test(s.name))) traits.push('upx');
  const ov = info.overlay;
  const ovHead = ov ? r.read(ov.offset, 64) : Buffer.alloc(0);
  if (python.findCookie(r) >= 0) return { kind: 'pyinstaller', traits };
  if (godot.probe(r)) return { kind: 'godot', traits: [...traits, 'embedded pack'] };
  // Installer payloads live in the overlay (data appended after the last section); libraries that merely
  // know about these formats (7z.dll) mention the same strings in their code, so only the overlay counts.
  const ovData = ov ? r.read(ov.offset, Math.min(ov.size, 1 << 20)) : Buffer.alloc(0);
  if (has(ovData, '\xEF\xBE\xAD\xDENullsoftInst')) return { kind: 'nsis', traits };
  const head2 = r.read(0, Math.min(r.size, 2 << 20));
  if (has(ovData, 'Inno Setup Setup Data') || has(ovData, 'zlb\x1a') && has(head2, 'JR.Inno.Setup') || has(head2, 'Inno Setup Setup Data')) return { kind: 'inno', traits };
  if (ovHead.length >= 6 && ovHead.toString('hex', 0, 6) === '377abcaf271c') return { kind: 'sfx', traits: [...traits, '7-Zip'] };
  if (ovHead.length >= 4 && ovHead.readUInt32LE(0) === 0x04034b50) return { kind: 'sfx', traits: [...traits, 'ZIP'] };
  if (ovHead.toString('latin1', 0, 4) === 'Rar!') return { kind: 'sfx', traits: [...traits, 'RAR'] };
  if (info.dotnet) return { kind: dnb.findHeader(r) >= 0 ? 'dotnetbundle' : 'dotnet', traits };
  if (!info.dotnet && dnb.findHeader(r) >= 0) return { kind: 'dotnetbundle', traits };
  if (traits.includes('upx')) return { kind: 'upx', traits };
  void head; void file;
  return { kind: 'pe', traits };
}

// Cheap identification (header bytes + a few offsets).
function quick(file) {
  let st; try { st = fs.statSync(file); } catch (e) { return { path: file, kind: 'unknown', error: e.message }; }
  if (st.isDirectory()) return { path: file, kind: folderKind(file), size: 0, dir: true };
  const e = ext(file);
  const out = { path: file, size: st.size, kind: 'unknown', traits: [] };
  if (!st.size) return { ...out, kind: 'empty' };
  const r = new FileReader(file);
  try {
    const h = r.read(0, 4096); const u32 = h.length >= 4 ? h.readUInt32LE(0) : 0; const m4 = h.toString('latin1', 0, 4);
    const tail = r.read(Math.max(0, r.size - 512), 512);
    const set = (kind, extra = {}) => Object.assign(out, { kind }, extra);
    if (u32 === 0x04034b50 || u32 === 0x06054b50) return set(zipKind(file, e));
    if (m4 === 'Cr24') return set('crx');
    if (h.toString('hex', 0, 6) === '377abcaf271c') return set('sevenz');
    if (m4 === 'Rar!') return set('rar');
    if (h[0] === 0x1f && h[1] === 0x8b) return set(/\.(tgz|tar\.gz)$/i.test(file) ? 'tar' : 'compressed');
    if (h.toString('hex', 0, 6) === 'fd377a585a00') return set(/\.(txz|tar\.xz)$/i.test(file) ? 'tar' : 'compressed');
    if (m4.startsWith('BZh')) return set(/\.(tbz2?|tar\.bz2)$/i.test(file) ? 'tar' : 'compressed');
    if (u32 === 0xfd2fb528) return set(/\.(tzst|tar\.zst)$/i.test(file) ? 'tar' : 'compressed');
    if (u32 === 0x184d2204) return set('compressed');
    if (h.length > 262 && h.toString('latin1', 257, 262) === 'ustar') return set('tar');
    if (h.toString('latin1', 0, 8) === '!<arch>\n') return set(has(h, 'debian-binary') ? 'deb' : 'arc');
    if (h.toString('hex', 0, 4) === 'edabeedb') return set('rpm');
    if (m4 === 'xar!') return set('pkg');
    if (m4 === 'MSCF') return set('cab');
    if (h.toString('hex', 0, 8) === 'd0cf11e0a1b11ae1') return set(['msi', 'msp', 'msm'].includes(e) || has(r.read(0, Math.min(r.size, 1 << 20)), 'M\0S\0I\0') ? 'msi' : 'arc');
    if (m4.startsWith('MZ')) { const info = pe.parse(file, { r }); if (info && !info.dosOnly) { const k = peKind(file, r, info, h); return set(k.kind, { traits: k.traits, dotnet: !!info.dotnet }); } return set('pe'); }
    if (h.readUInt32BE(0) === 0x7f454c46) {
      if (h.toString('latin1', 8, 10) === 'AI') return set('appimage');
      if (python.findCookie(r) >= 0) return set('pyinstaller');
      if (godot.probe(r)) return set('godot', { traits: ['embedded pack'] });
      if (has(h, 'UPX!') || has(r.read(0, 8192), 'UPX!')) return set('upx');
      if (dnb.findHeader(r) >= 0) return set('dotnetbundle');
      return set('elf');
    }
    const be = h.readUInt32BE(0);
    if ([0xcffaedfe, 0xcefaedfe].includes(be) || (be === 0xcafebabe && macho.fat(r))) {
      if (python.findCookie(r) >= 0) return set('pyinstaller');
      if (dnb.findHeader(r) >= 0) return set('dotnetbundle');
      return set('macho');
    }
    if (be === 0xcafebabe) return set('class');
    if (m4 === 'dex\n' || m4 === 'dey\n') return set('dex');
    if (u32 === 0x6d736100) return set('wasm');
    if (['FWS', 'CWS', 'ZWS'].includes(h.toString('latin1', 0, 3))) return set('swf');
    if (h.toString('hex', 0, 4) === '1b4c7561' || h.toString('latin1', 0, 3) === '\x1bLJ') return set('lua');
    if (m4 === 'GDPC') return set('godot');
    if (h.toString('latin1', 0, 7) === 'RGSSAD\0') return set('rgss');
    if (m4 === 'CISO' || m4 === 'ZISO') return set('cso');
    if (m4 === 'NES\x1a') return set('nes');
    if (m4 === 'hsqs' || m4 === 'sqsh') return set(e === 'snap' ? 'snap' : 'squashfs');
    if (u32 === 0x28cd3d45) return set('cramfs');
    if (h.readUInt32BE(0) === 0x27051956) return set('uimage');
    if (h.toString('latin1', 0, 8) === 'conectix' || tail.toString('latin1', 0, 8) === 'conectix' || h.toString('latin1', 0, 8) === 'vhdxfile' || m4 === 'KDMV' || h.toString('latin1', 0, 21) === '# Disk DescriptorFile' || h.toString('hex', 0, 4) === '514649fb' || h.toString('latin1', 0, 40).includes('VirtualBox Disk Image')) return set('vdisk');
    if (h.toString('latin1', 0, 8) === 'MSWIM\0\0\0') return set('wim');
    if (tail.toString('latin1', 0, 4) === 'koly' || h.toString('latin1', 0, 8) === 'encrcdsa') return set('dmg');
    if (h.length >= 0x20 && (h.readUInt32BE(0x1c) === 0xc2339f3d)) return set('gcm');
    if (h.length >= 0x20 && (h.readUInt32BE(0x18) === 0x5d1c9ea3)) return set('wii');
    if (m4 === 'WBFS') return set('wii');
    if (xiso.probe(r)) return set('xiso');
    if (iso.probe(r)) return set('iso');
    if (iso.hasUdf(r, null)) return set('udf');
    if (godot.probe(r)) return set('godot');
    if (python.pycInfo(h) && ['pyc', 'pyo'].includes(e)) return set('pyc');
    if (e === 'asar' && asar.probe(r)) return set('asar');
    if (e === 'pak' && r.read(r.size - 300, 300).includes(Buffer.from('e1126f5a', 'hex'))) return set('unrealpak');
    if (h.length >= 0x15c && h.readUInt16LE(0x15c) && ['nds', 'srl'].includes(e)) return set('nds');
    if (['gb', 'gbc', 'gba'].includes(e)) return set('gba');
    // file-system images
    const b1k = r.read(0, 1536);
    if (b1k.length >= 1082 && b1k.readUInt16LE(1080) === 0xef53) return set('fsimage', { traits: ['ext'] });
    if (b1k.toString('latin1', 1024, 1026) === 'H+' || b1k.toString('latin1', 1024, 1026) === 'HX') return set('fsimage', { traits: ['HFS+'] });
    if (h.toString('latin1', 32, 36) === 'NXSB') return set('fsimage', { traits: ['APFS'] });
    if (h.toString('latin1', 3, 11) === 'NTFS    ') return set('fsimage', { traits: ['NTFS'] });
    if (h.length >= 512 && h[510] === 0x55 && h[511] === 0xaa) {
      if (/FAT/.test(h.toString('latin1', 0x36, 0x3e) + h.toString('latin1', 0x52, 0x5a))) return set('fsimage', { traits: ['FAT'] });
      if (r.read(512, 8).toString('latin1') === 'EFI PART') return set('fsimage', { traits: ['GPT'] });
      if ([0x1be, 0x1ce].some((o) => h[o + 4] !== 0)) return set('fsimage', { traits: ['MBR'] });
    }
    if (h[0] === 0x3a && /^:[0-9A-F]{10}/i.test(h.toString('latin1', 0, 12))) return set('ihex');
    if (['js', 'mjs', 'cjs'].includes(e)) return set('js');
    if (['bin', 'fw', 'rom', 'img', 'firmware', 'trx', 'chk'].includes(e)) return set('firmware');
    if (e === 'xml' && h.readUInt32LE(0) === 0x00080003) return set('axml');
    return out;
  } finally { r.close(); }
}

function folderKind(dir) {
  const ls = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
  const names = ls(dir);
  if (/\.app$/i.test(dir) && names.includes('Contents')) return 'app';
  if (names.some((n) => /_Data$/.test(n) && fs.existsSync(path.join(dir, n, 'Managed')))) return 'unity';
  if (names.includes('GameAssembly.dll') || names.some((n) => /_Data$/.test(n) && fs.existsSync(path.join(dir, n, 'il2cpp_data')))) return 'unity';
  if (fs.existsSync(path.join(dir, 'resources', 'app.asar')) || fs.existsSync(path.join(dir, 'Contents', 'Resources', 'app.asar'))) return 'electron';
  return 'folder';
}

// Full identification for the file the person dropped: kind, details, traits, and siblings that matter.
function full(file) {
  const q = quick(file);
  const out = { path: file, name: path.basename(file), size: q.size, dir: !!q.dir, kind: q.kind, traits: [...(q.traits || [])], details: {}, notes: [] };
  if (q.dir) {
    out.details.files = countFiles(file);
    if (q.kind === 'app') { try { const pl = require('./formats/plist').parse(fs.readFileSync(path.join(file, 'Contents', 'Info.plist'))); out.details.plist = pick(pl, ['CFBundleName', 'CFBundleIdentifier', 'CFBundleShortVersionString', 'CFBundleExecutable', 'LSMinimumSystemVersion', 'NSHumanReadableCopyright']); } catch {} if (fs.existsSync(path.join(file, 'Contents', 'Resources', 'app.asar'))) out.traits.push('Electron'); }
    if (q.kind === 'unity') out.traits.push(fs.existsSync(path.join(file, 'GameAssembly.dll')) || fs.readdirSync(file).some((n) => /_Data$/.test(n) && fs.existsSync(path.join(file, n, 'il2cpp_data'))) ? 'IL2CPP' : 'Mono');
    out.label = TYPES[out.kind].label; out.family = TYPES[out.kind].family;
    return out;
  }
  const r = new FileReader(file);
  try {
    const k = q.kind;
    if (['pe', 'dotnet', 'dotnetbundle', 'upx', 'pyinstaller', 'nsis', 'inno', 'sfx'].includes(k) || (k === 'godot' && r.read(0, 2).toString() === 'MZ')) {
      const p = pe.parse(file, { r });
      if (p && !p.dosOnly) {
        out.details.pe = { format: p.format, machine: p.machine, subsystem: p.subsystem, dll: p.dll, entry: p.entry, timestamp: p.timestamp, signed: p.signed, sections: p.sections.map((s) => s.name).join(' '), imports: p.imports.length, exports: p.exports.length };
        if (p.version) out.details.version = p.version;
        if (p.dotnet) out.details.dotnet = p.dotnet;
        out.pe = p;
        if (p.signed) out.traits.push('Signed');
        if (p.dotnet && p.dotnet.readyToRun) out.traits.push('ReadyToRun');
        const dlls = p.imports.map((i) => i.dll.toLowerCase());
        if (dlls.includes('msvbvm60.dll')) out.traits.push('Visual Basic 6');
        if (dlls.some((d) => /^python\d+\.dll$/.test(d))) out.traits.push('Embeds Python');
        if (dlls.includes('unityplayer.dll')) out.traits.push('Unity player');
        if (p.sections.some((s) => s.name === '.symtab' || s.name === '.go.buildinfo') || has(r.read(0, Math.min(r.size, 4 << 20)), '\xff Go buildinf:')) out.traits.push('Go');
        if (has(r.read(0, Math.min(r.size, 8 << 20)), '/rustc/')) out.traits.push('Rust');
        if (p.sections.some((s) => s.name === 'CODE' || s.name === 'DATA') && has(r.read(0, Math.min(r.size, 4 << 20)), 'Borland')) out.traits.push('Delphi');
        if (has(r.read(0, Math.min(r.size, 4 << 20)), 'AU3!EA06')) out.traits.push('AutoIt');
        if (p.sections.some((s) => s.name === '.wixburn')) out.traits.push('WiX bundle');
        if (p.overlay && p.overlay.size > 1024) out.details.overlay = p.overlay;
      }
      // Unity / Electron next to the exe
      const dir = path.dirname(file), base = path.basename(file, path.extname(file));
      if (fs.existsSync(path.join(dir, base + '_Data', 'Managed'))) { out.kind = 'unity'; out.unityRoot = dir; out.traits.push('Mono'); }
      else if (fs.existsSync(path.join(dir, 'GameAssembly.dll')) && fs.existsSync(path.join(dir, base + '_Data'))) { out.kind = 'unity'; out.unityRoot = dir; out.traits.push('IL2CPP'); }
      else if (fs.existsSync(path.join(dir, 'resources', 'app.asar'))) { out.kind = 'electron'; out.electronRoot = dir; }
    }
    if (k === 'elf' || k === 'appimage' || (['pyinstaller', 'upx', 'dotnetbundle', 'godot'].includes(k) && r.read(0, 4).readUInt32BE(0) === 0x7f454c46)) {
      const e = elf.parse(file, { r }); if (e) { out.details.elf = { format: e.format, machine: e.machine, type: e.type, os: e.osabi, interp: e.interp, needed: e.needed.join(', '), stripped: e.stripped, symbols: e.symbols }; out.elf = e; if (e.stripped) out.traits.push('Stripped'); }
    }
    if (k === 'macho' || (['pyinstaller', 'dotnetbundle'].includes(k) && [0xcffaedfe, 0xcafebabe].includes(r.read(0, 4).readUInt32BE(0)))) {
      const m = macho.parse(file, { r }); if (m) {
        out.details.macho = { format: m.format, arches: m.arches.map((a) => a.cpu).join(', '), type: m.arches[0].type, platform: m.arches[0].platform, minOS: m.arches[0].minOS, signed: m.arches.every((a) => a.signed), libs: m.arches[0].libs.length };
        out.macho = m;
        if (m.arches.some((a) => a.encrypted)) { out.traits.push('App Store encrypted'); out.notes.push('This binary is encrypted by the App Store (FairPlay). Its code can only be decompiled after it’s decrypted on a device.'); }
        if (m.arches.some((a) => a.swift)) out.traits.push('Swift'); else if (m.arches.some((a) => a.objc)) out.traits.push('Objective-C');
      }
    }
    if (k === 'pyinstaller') { const a = python.openPyInstaller(file); if (a) { out.details.python = { version: a.version, library: a.lib, entries: a.entries.length, scripts: a.entries.filter((x) => x.type === 's' && !/^pyi/.test(x.name)).map((x) => x.name).join(', ') }; a.close(); } }
    if (k === 'dotnetbundle') { const b = dnb.open(file, { r }); if (b) { out.details.bundle = { ...b.info, assemblies: b.entries.filter((x) => x.kind === 'Assembly').length }; } }
    if (['iso', 'udf'].includes(k)) { try { const c = iso.open(file); out.details.disc = c.info; out.details.disc.files = c.entries.filter((x) => !x.dir).length; c.close(); if (c.info.udf) out.traits.push('UDF'); if (c.info.bootable) out.traits.push('Bootable'); } catch (er) { if (er.udfOnly) { out.kind = 'udf'; out.details.disc = { format: 'UDF' }; } } }
    if (k === 'xiso') { const c = xiso.open(file); out.details.disc = c.info; c.close(); }
    if (k === 'gcm' || k === 'wii') { const c = gcm.open(file); out.details.disc = c.info; c.close(); if (k === 'wii') out.notes.push(c.info.note); }
    if (k === 'godot') { const c = godot.open(file); out.details.godot = c.info; c.close(); if (c.info.encrypted) out.notes.push('This pack is encrypted with the game’s key, so only its header can be read.'); }
    if (k === 'cso') out.details.cso = require('./formats/cso').info(file);
    if (k === 'class') out.details.java = javaish.classInfo(r.read(0, Math.min(r.size, 1 << 20)));
    if (k === 'dex') out.details.dex = javaish.dexInfo(r.read(0, 0x70));
    if (k === 'wasm') out.details.wasm = (({ functions, imports, exports, hasNames }) => ({ functions, imports: imports.length, exports: exports.length, names: hasNames }))(require('./formats/wasm').info(r.read(0, Math.min(r.size, 64 << 20))));
    if (k === 'pyc') out.details.python = python.pycInfo(r.read(0, 16));
    if (k === 'asar') { const a = asar.open(file); out.details.asar = a.info; a.close(); }
    if (['apk', 'aab', 'aar', 'ipa', 'jar', 'zip', 'apkbundle', 'nupkg', 'msix', 'crx', 'pyarchive'].includes(k)) {
      try {
        const z = zip.open(file); out.details.zip = z.info;
        if (k === 'apk') { const m = z.find('AndroidManifest.xml'); if (m) { const s = require('./formats/axml').summary(z.read(m)); out.details.android = { package: s.package, version: s.versionName, code: s.versionCode, minSdk: s.minSdk, targetSdk: s.targetSdk, permissions: s.permissions.length, activities: s.activities.length }; } out.details.android = { ...(out.details.android || {}), dex: z.entries.filter((x) => /^classes\d*\.dex$/.test(x.path)).length, abis: [...new Set(z.entries.map((x) => (x.path.match(/^lib\/([^/]+)\//) || [])[1]).filter(Boolean))].join(', ') || 'none' }; if (z.entries.some((x) => /libflutter\.so$/.test(x.path))) out.traits.push('Flutter'); if (z.entries.some((x) => /libreactnativejni\.so$|index\.android\.bundle$/.test(x.path))) out.traits.push('React Native'); if (z.entries.some((x) => /assemblies\/.*\.dll$|libmonodroid\.so$/.test(x.path))) out.traits.push('Xamarin / .NET'); if (z.entries.some((x) => /libunity\.so$/.test(x.path))) out.traits.push('Unity'); if (z.entries.some((x) => /libil2cpp\.so$/.test(x.path))) out.traits.push('IL2CPP'); }
        if (k === 'ipa') { const pl = z.entries.find((x) => /^Payload\/[^/]+\.app\/Info\.plist$/.test(x.path)); if (pl) { const p = require('./formats/plist').parse(z.read(pl)); out.details.ios = pick(p, ['CFBundleDisplayName', 'CFBundleName', 'CFBundleIdentifier', 'CFBundleShortVersionString', 'MinimumOSVersion']); } if (z.entries.some((x) => /Flutter\.framework/.test(x.path))) out.traits.push('Flutter'); }
        if (k === 'jar') { const mf = z.find('META-INF/MANIFEST.MF'); if (mf) { const t = z.read(mf).toString('utf8').replace(/\r?\n /g, ''); const g = (n) => (t.match(new RegExp('^' + n + ':\\s*(.+)$', 'mi')) || [])[1]; out.details.java = { mainClass: g('Main-Class'), version: g('Implementation-Version'), createdBy: g('Created-By') }; } out.details.java = { ...(out.details.java || {}), classes: z.entries.filter((x) => x.path.endsWith('.class')).length }; if (z.entries.some((x) => /^kotlin\//.test(x.path) || x.path.endsWith('.kotlin_module'))) out.traits.push('Kotlin'); if (z.entries.some((x) => /^BOOT-INF\//.test(x.path))) out.traits.push('Spring Boot'); }
        if (z.info.encrypted) out.notes.push(`${z.info.encrypted} file(s) are password-protected.`);
        if (z.info.unsupported) out.traits.push('needs 7-Zip');
        z.close();
      } catch (er) { out.notes.push(er.message); }
    }
    if (k === 'swf') { const h = r.read(0, 8); out.details.swf = { compression: { FWS: 'none', CWS: 'zlib', ZWS: 'LZMA' }[h.toString('latin1', 0, 3)], version: h[3], size: h.readUInt32LE(4) }; }
    if (k === 'lua') { const h = r.read(0, 12); out.details.lua = h.toString('latin1', 0, 3) === '\x1bLJ' ? { engine: 'LuaJIT', version: h[3] } : { engine: 'Lua', version: `${h[4] >> 4}.${h[4] & 15}` }; out.notes.push('Lua bytecode is shown as strings; there is no built-in Lua decompiler yet.'); }
    if (k === 'nes') { const h = r.read(0, 16); out.details.rom = { prg: `${h[4] * 16} KB`, chr: `${h[5] * 8} KB`, mapper: (h[6] >> 4) | (h[7] & 0xf0), mirroring: h[6] & 1 ? 'vertical' : 'horizontal', battery: !!(h[6] & 2) }; }
    if (k === 'nds') { const h = r.read(0, 0x40); out.details.rom = { title: h.toString('latin1', 0, 12).replace(/\0/g, ''), gameCode: h.toString('latin1', 12, 16), maker: h.toString('latin1', 16, 18) }; }
    if (k === 'gba') { const h = r.read(0, 0x150); out.details.rom = /gba/i.test(file) ? { title: h.toString('latin1', 0xa0, 0xac).replace(/\0/g, ''), gameCode: h.toString('latin1', 0xac, 0xb0) } : { title: h.toString('latin1', 0x134, 0x143).replace(/\0/g, '') }; }
    if (k === 'rgss') { const v = r.read(7, 1)[0]; out.details.rgss = { version: v, engine: { 1: 'RPG Maker XP / VX', 3: 'RPG Maker VX Ace' }[v] || 'RPG Maker' }; }
    if (k === 'unrealpak') out.notes.push('Unreal paks are usually encrypted with the game’s AES key; Decomp shows the header and strings.');
    if (k === 'inno' && !require('./engines').which('innoextract')) out.notes.push('Inno Setup installers are unpacked with innoextract, which isn’t on this computer. Decomp still pulls out strings, resources and embedded files.');
  } catch (er) { out.notes.push('Couldn’t read all details: ' + er.message); }
  finally { r.close(); }
  out.label = TYPES[out.kind] ? TYPES[out.kind].label : out.kind;
  out.family = TYPES[out.kind] ? TYPES[out.kind].family : 'firmware';
  return out;
}

function pick(o, keys) { const r = {}; for (const k of keys) if (o && o[k] != null) r[k] = o[k]; return r; }
function countFiles(dir) { let n = 0; const st = [dir]; while (st.length && n < 1e6) { const d = st.pop(); let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; } for (const e of es) { if (e.isDirectory()) st.push(path.join(d, e.name)); else n++; } } return n; }

module.exports = { quick, full, folderKind };
