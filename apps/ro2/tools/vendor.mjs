// Refreshes src/renderer/vendor from npm (run: node tools/vendor.mjs). RO2 ships these files as-is,
// so the app has no runtime npm dependencies and no native modules (nothing special for Windows cross-builds).
//   fabric            canvas editor (MIT)
//   onnxruntime-web   runs the AI models on the GPU (WebGPU) or the CPU (WASM) (MIT)
//   lucide-static     the icon library (ISC)
//   @fontsource/*     the bundled fonts (SIL Open Font License)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const V = path.join(ROOT, 'src/renderer/vendor');
const PKG = { fabric: '7.4.0', 'onnxruntime-web': '1.30.0', 'lucide-static': '1.49.0' };
export const FONTS = [
  // [family, fontsource id, weights, category]
  ['Inter', 'inter', [400, 700, 900], 'sans'], ['Poppins', 'poppins', [400, 600, 800], 'sans'], ['Montserrat', 'montserrat', [400, 700, 900], 'sans'],
  ['DM Sans', 'dm-sans', [400, 700], 'sans'], ['Manrope', 'manrope', [400, 700, 800], 'sans'], ['Outfit', 'outfit', [400, 700], 'sans'],
  ['Space Grotesk', 'space-grotesk', [400, 700], 'sans'], ['Work Sans', 'work-sans', [400, 700], 'sans'], ['Rubik', 'rubik', [400, 700], 'sans'],
  ['Nunito', 'nunito', [400, 800], 'sans'], ['Quicksand', 'quicksand', [400, 700], 'sans'], ['Raleway', 'raleway', [400, 700], 'sans'],
  ['Josefin Sans', 'josefin-sans', [400, 700], 'sans'], ['Syne', 'syne', [400, 800], 'sans'], ['Comfortaa', 'comfortaa', [400, 700], 'sans'],
  ['Bricolage Grotesque', 'bricolage-grotesque', [400, 800], 'sans'],
  ['Oswald', 'oswald', [400, 700], 'display'], ['Bebas Neue', 'bebas-neue', [400], 'display'], ['Anton', 'anton', [400], 'display'],
  ['Archivo Black', 'archivo-black', [400], 'display'], ['Barlow Condensed', 'barlow-condensed', [400, 700], 'display'], ['Righteous', 'righteous', [400], 'display'],
  ['Abril Fatface', 'abril-fatface', [400], 'display'], ['Shrikhand', 'shrikhand', [400], 'display'], ['Bungee', 'bungee', [400], 'display'],
  ['Playfair Display', 'playfair-display', [400, 700, 900], 'serif'], ['Lora', 'lora', [400, 700], 'serif'], ['Merriweather', 'merriweather', [400, 700], 'serif'],
  ['DM Serif Display', 'dm-serif-display', [400], 'serif'], ['Fraunces', 'fraunces', [400, 700], 'serif'], ['Cormorant Garamond', 'cormorant-garamond', [400, 700], 'serif'],
  ['Libre Baskerville', 'libre-baskerville', [400, 700], 'serif'],
  ['Pacifico', 'pacifico', [400], 'script'], ['Caveat', 'caveat', [400, 700], 'script'], ['Dancing Script', 'dancing-script', [400, 700], 'script'],
  ['Lobster', 'lobster', [400], 'script'], ['Permanent Marker', 'permanent-marker', [400], 'script'], ['Great Vibes', 'great-vibes', [400], 'script'],
  ['JetBrains Mono', 'jetbrains-mono', [400, 700], 'mono'], ['Press Start 2P', 'press-start-2p', [400], 'mono'],
];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ro2-vendor-'));
function pack(spec) {
  const out = execFileSync('npm', ['pack', spec, '--silent'], { cwd: tmp }).toString().trim().split('\n').pop();
  const dir = path.join(tmp, out.replace(/\.tgz$/, '')); fs.mkdirSync(dir, { recursive: true });
  execFileSync('tar', ['xzf', path.join(tmp, out), '-C', dir]); return path.join(dir, 'package');
}
const cp = (a, b) => { fs.mkdirSync(path.dirname(b), { recursive: true }); fs.copyFileSync(a, b); };
if (!process.argv.includes('--fonts-only')) {
  const fab = pack(`fabric@${PKG.fabric}`);
  cp(path.join(fab, 'dist/index.min.mjs'), path.join(V, 'fabric/fabric.min.mjs')); cp(path.join(fab, 'LICENSE'), path.join(V, 'fabric/LICENSE'));
  const ort = pack(`onnxruntime-web@${PKG['onnxruntime-web']}`);
  for (const f of ['ort.webgpu.bundle.min.mjs', 'ort-wasm-simd-threaded.asyncify.wasm', 'ort-wasm-simd-threaded.asyncify.mjs']) cp(path.join(ort, 'dist', f), path.join(V, 'ort', f));
  const ol = ['LICENSE', 'LICENSE.txt', 'README.md'].map((n) => path.join(ort, n)).find((p) => fs.existsSync(p)); if (ol) cp(ol, path.join(V, 'ort', path.basename(ol) === 'README.md' ? 'README.md' : 'LICENSE'));
  const luc = pack(`lucide-static@${PKG['lucide-static']}`);
  const tags = JSON.parse(fs.readFileSync(path.join(luc, 'tags.json'), 'utf8'));
  const icons = {};
  for (const f of fs.readdirSync(path.join(luc, 'icons')).sort()) {
    if (!f.endsWith('.svg')) continue;
    const name = f.slice(0, -4); const svg = fs.readFileSync(path.join(luc, 'icons', f), 'utf8');
    const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/\s+/g, ' ').trim();
    icons[name] = [inner, (tags[name] || []).join(' ')];
  }
  fs.mkdirSync(path.join(V, 'lucide'), { recursive: true });
  fs.writeFileSync(path.join(V, 'lucide/icons.json'), JSON.stringify(icons));
  cp(path.join(luc, 'LICENSE'), path.join(V, 'lucide/LICENSE'));
}
const fontList = [];
for (const [family, id, weights, cat] of FONTS) {
  const dir = pack(`@fontsource/${id}`); const files = {};
  for (const w of weights) {
    const f = path.join(dir, 'files', `${id}-latin-${w}-normal.woff2`);
    if (!fs.existsSync(f)) { console.warn('missing', family, w); continue; }
    cp(f, path.join(V, 'fonts', `${id}-${w}.woff2`)); files[w] = `${id}-${w}.woff2`;
  }
  const lic = ['LICENSE', 'LICENSE.md', 'OFL.txt'].map((n) => path.join(dir, n)).find((p) => fs.existsSync(p));
  if (lic) cp(lic, path.join(V, 'fonts/licenses', `${id}.txt`));
  fontList.push({ family, category: cat, files });
}
fs.writeFileSync(path.join(V, 'fonts/fonts.json'), JSON.stringify(fontList, null, 1));
fs.rmSync(tmp, { recursive: true, force: true });
console.log('vendor refreshed:', Object.entries(PKG).map(([k, v]) => `${k}@${v}`).join(', '), `+ ${fontList.length} fonts`);
