// The outside decompilers Decomp drives. Pinned versions with checksums from their GitHub releases;
// the Java and .NET runtimes are looked up at install time from Adoptium / Microsoft (with their hashes).
'use strict';
const { fetchJson } = require('../download');

const GH = (repo, tag, file) => `https://github.com/${repo}/releases/download/${tag}/${file}`;
const plat = () => `${process.platform}-${process.arch === 'arm64' ? 'arm64' : 'x64'}`;

const ENGINES = [
  {
    id: 'sevenzip', name: '7-Zip', version: '26.05', group: 'Essentials', license: 'LGPL', size: 2e6, auto: true,
    what: 'Disc images (UDF, DMG, VHD, VMDK, WIM), installers (MSI, NSIS, CAB, RPM, PKG) and 60+ archive formats.',
    files: {
      'darwin-arm64': [{ url: GH('ip7z/7zip', '26.05', '7z2605-mac.tar.xz'), hash: 'sha256:12ef6830317743cfd3f0ab1724bde43fcc270d8b6d8564f8c12c2a2b7f993570', size: 1868068, unpack: true }],
      'darwin-x64': [{ url: GH('ip7z/7zip', '26.05', '7z2605-mac.tar.xz'), hash: 'sha256:12ef6830317743cfd3f0ab1724bde43fcc270d8b6d8564f8c12c2a2b7f993570', size: 1868068, unpack: true }],
      'linux-x64': [{ url: GH('ip7z/7zip', '26.05', '7z2605-linux-x64.tar.xz'), hash: 'sha256:22cf82fcc6eb7474f1d5bb4f02c0f8ebd573a718089d6833dc30f8350a3b232e', size: 1579976, unpack: true }],
      'linux-arm64': [{ url: GH('ip7z/7zip', '26.05', '7z2605-linux-arm64.tar.xz'), hash: 'sha256:0b71f6cfc34669b3bf69f2347efd3429f77020665003a13b9cdc53b784270421', size: 1317128, unpack: true }],
      // Windows: the tiny 7zr.exe unpacks 7z.exe + 7z.dll from the official installer (a 7z self-extractor).
      'win32-x64': [{ url: GH('ip7z/7zip', '26.05', '7zr.exe'), hash: 'sha256:9bf582b894dfa665f852d7e9112b02290a1c303c2d95a21fcdc41ffcb03143b7', size: 602624, name: '7zr.exe' },
        { url: GH('ip7z/7zip', '26.05', '7z2605-x64.exe'), hash: 'sha256:fd99e86f57d8f429ef5ed045bf98315af962e2309b0f1ba87a147a44c71647d0', size: 1663506, name: 'setup.exe', sfx: true }],
      'win32-arm64': [{ url: GH('ip7z/7zip', '26.05', '7zr.exe'), hash: 'sha256:9bf582b894dfa665f852d7e9112b02290a1c303c2d95a21fcdc41ffcb03143b7', size: 602624, name: '7zr.exe' },
        { url: GH('ip7z/7zip', '26.05', '7z2605-arm64.exe'), hash: 'sha256:86d5790d5dd84cab4636c3bb7fab10d3ed7cd3e57e6119401bd2769e28165268', size: 1595161, name: 'setup.exe', sfx: true }],
    },
    bin: { win32: '7z.exe', default: '7zz' },
  },
  {
    id: 'jdk', name: 'Java runtime', version: '25 (Temurin)', group: 'Runtimes', license: 'GPLv2 + CE', size: 200e6,
    what: 'Runs JADX, Vineflower and Ghidra (Ghidra needs Java 25). Uses every core with parallel garbage collection.',
    resolve: async () => {
      const os = { darwin: 'mac', win32: 'windows', linux: 'linux' }[process.platform];
      const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
      const list = await fetchJson(`https://api.adoptium.net/v3/assets/latest/25/hotspot?os=${os}&architecture=${arch}&image_type=jdk&vendor=eclipse`);
      const b = list[0].binary.package;
      return { version: list[0].version.semver, files: [{ url: b.link, hash: 'sha256:' + b.checksum, size: b.size, name: b.name, unpack: true }] };
    },
  },
  {
    id: 'jadx', name: 'JADX', version: '1.5.6', group: 'Java & Android', license: 'Apache-2.0', size: 73e6, requires: ['jdk'],
    what: 'Android apps (APK, AAB, DEX, AAR) to Java source with resources and the manifest decoded.',
    files: { any: [{ url: GH('skylot/jadx', 'v1.5.6', 'jadx-1.5.6.zip'), hash: 'sha256:545ea2be9c242511bc145755cf4bda2485ade42966e096f8b4d3da2a230e8974', size: 72646741, unpack: true }] },
    bin: { default: 'lib/jadx-1.5.6-all.jar' },
  },
  {
    id: 'vineflower', name: 'Vineflower', version: '1.12.0', group: 'Java & Android', license: 'Apache-2.0', size: 1.6e6, requires: ['jdk'],
    what: 'Java and Kotlin JARs and class files to readable Java, multi-threaded.',
    files: { any: [{ url: GH('Vineflower/vineflower', '1.12.0', 'vineflower-1.12.0.jar'), hash: 'sha256:1dfcfe974395734fa467ce620661c7623d05ba83670de0529b1fbd63ff548b9d', size: 1633863, name: 'vineflower.jar' }] },
    bin: { default: 'vineflower.jar' },
  },
  {
    id: 'dotnet', name: '.NET runtime', version: '10', group: 'Runtimes', license: 'MIT', size: 35e6,
    what: 'Runs ILSpy. Private copy; nothing is installed system-wide.',
    resolve: async () => {
      const rid = `${{ darwin: 'osx', win32: 'win', linux: 'linux' }[process.platform]}-${process.arch === 'arm64' ? 'arm64' : 'x64'}`;
      const rel = await fetchJson('https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json');
      const rt = rel.releases.find((r) => r.runtime && r.runtime.files)?.runtime;
      const f = rt.files.find((x) => x.rid === rid && /^dotnet-runtime-/.test(x.name) && /\.(zip|tar\.gz)$/.test(x.name));
      return { version: rt.version, files: [{ url: f.url, hash: 'sha512:' + f.hash, name: f.name, unpack: true }] };
    },
    bin: { win32: 'dotnet.exe', default: 'dotnet' },
  },
  {
    id: 'ilspy', name: 'ILSpy', version: '11.1', group: '.NET', license: 'MIT', size: 4.6e6, requires: ['dotnet'],
    what: '.NET and Unity (Mono) assemblies to C# projects, in parallel across cores.',
    files: { any: [{ url: 'https://api.nuget.org/v3-flatcontainer/ilspycmd/11.1.0.9782/ilspycmd.11.1.0.9782.nupkg', hash: 'sha256:74c07facaf1850c78a779fc509031f756e1c0de24b1a536f3363d7ef81ce001f', size: 4632113, name: 'ilspycmd.zip', unpack: true }] },
    bin: { default: 'tools/net10.0/any/ilspycmd.dll' },
  },
  {
    id: 'ghidra', name: 'Ghidra', version: '12.2', group: 'Native code', license: 'Apache-2.0', size: 570e6, requires: ['jdk'], java: 25,
    what: 'Native code (Windows, Mac, Linux, iOS, consoles, firmware) to C-like pseudocode, decompiling functions in parallel.',
    files: { any: [{ url: GH('NationalSecurityAgency/ghidra', 'Ghidra_12.2_build', 'ghidra_12.2_PUBLIC_20261016.zip'), hash: 'sha256:2c2cd776db3c1f6a097ba418922378ac3649cadd5e844a6f5f088ae628a7be67', size: 569712708, unpack: true }] },
    bin: { default: 'ghidra_12.2_PUBLIC' },
  },
  {
    id: 'upx', name: 'UPX', version: '5.2.1', group: 'Native code', license: 'GPL', size: 0.7e6,
    what: 'Unpacks UPX-compressed executables before they are analysed.',
    files: {
      'win32-x64': [{ url: GH('upx/upx', 'v5.2.1', 'upx-5.2.1-win64.zip'), hash: 'sha256:eabc6792a347d45e945be7748423e7868fd01b0d2bcaa2f4b1031fd71ff69bda', size: 680290, unpack: true }],
      'win32-arm64': [{ url: GH('upx/upx', 'v5.2.1', 'upx-5.2.1-win64.zip'), hash: 'sha256:eabc6792a347d45e945be7748423e7868fd01b0d2bcaa2f4b1031fd71ff69bda', size: 680290, unpack: true }],
      'linux-x64': [{ url: GH('upx/upx', 'v5.2.1', 'upx-5.2.1-amd64_linux.tar.xz'), hash: 'sha256:402162aad30af47e60dbd767fb2e64ca394ace9727ba1f40283641f1d1b91657', size: 664048, unpack: true }],
      'linux-arm64': [{ url: GH('upx/upx', 'v5.2.1', 'upx-5.2.1-arm64_linux.tar.xz'), hash: 'sha256:a72d112c5970a904a31da0b9c84f919bc16b9a311787c12245508544a78c7d36', size: 674620, unpack: true }],
    },
    unavailable: { darwin: 'UPX doesn’t make a Mac build. Decomp uses Homebrew’s (brew install upx) when it’s there.' },
    bin: { win32: 'upx.exe', default: 'upx' },
  },
];

// Programs Decomp uses when they are already on the computer (it never installs these).
const SYSTEM_TOOLS = [
  { id: 'pycdc', name: 'pycdc', what: 'Python bytecode (.pyc) to source.', cmd: 'pycdc', hint: 'Build from github.com/zrax/pycdc, or brew install pycdc' },
  { id: 'innoextract', name: 'innoextract', what: 'Inno Setup installers.', cmd: 'innoextract', hint: 'brew install innoextract / innoextract.constexpr.org' },
  { id: 'python', name: 'Python 3', what: 'Bytecode disassembly when pycdc isn’t there (same Python version only).', cmd: process.platform === 'win32' ? 'python' : 'python3' },
];

module.exports = { ENGINES, SYSTEM_TOOLS, plat, byId: (id) => ENGINES.find((e) => e.id === id) };
