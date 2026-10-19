// Kiln — quick checks that run in plain Node (no Electron): PNG text, A1111 parsing, folder linking.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const png = require('../src/generate/png');
const links = require('../src/packages/links');
const types = require('../src/shared/types');

function tinyPng() {
  const c = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); Buffer.concat([Buffer.from(t), d]).copy(b, 4); b.writeUInt32BE(png.crc32(Buffer.concat([Buffer.from(t), d])), 8 + d.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), c('IHDR', ihdr), c('IDAT', zlib.deflateSync(Buffer.from([0, 1, 2, 3]))), c('IEND', Buffer.alloc(0))]);
}
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };

t('png text round trip (utf-8)', () => {
  const out = png.writeText(tinyPng(), 'parameters', 'café, 1girl\nSteps: 20, Seed: 5');
  assert.strictEqual(png.readText(out).parameters, 'café, 1girl\nSteps: 20, Seed: 5');
});
t('a1111 parameters', () => {
  const r = png.parseA1111('a castle, sunset\nNegative prompt: blurry\nSteps: 28, Sampler: Euler a, CFG scale: 6, Seed: 42, Size: 832x1216, Lora hashes: "a: 1, b: 2", Version: f2');
  assert.strictEqual(r.positive, 'a castle, sunset');
  assert.strictEqual(r.negative, 'blurry');
  assert.strictEqual(r.settings.Steps, '28');
  assert.strictEqual(r.settings.Sampler, 'Euler a');
  assert.strictEqual(r.settings['Lora hashes'], 'a: 1, b: 2');
  assert.strictEqual(r.settings.Version, 'f2');
});
t('type guessing', () => {
  assert.strictEqual(types.typeForCivitai('LORA'), 'Lora');
  assert.strictEqual(types.typeForCivitai('TextualInversion'), 'Embeddings');
  assert.strictEqual(types.guessType('sdxl_vae.safetensors', 3e8), 'VAE');
  assert.strictEqual(types.guessType('model.safetensors', 6.9e9), 'StableDiffusion');
});
t('linking keeps library files and replaces empty folders', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiln-'));
  const pkg = path.join(root, 'pkg'), lib = path.join(root, 'lib');
  fs.mkdirSync(path.join(pkg, 'models', 'Lora'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'models', 'Lora', 'Put LoRA here.txt'), 'x');
  fs.mkdirSync(path.join(pkg, 'models', 'VAE'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'models', 'VAE', 'mine.safetensors'), 'vae');
  const r = links.applyLinks(pkg, { 'models/Lora': 'Lora', 'models/VAE': 'VAE', 'models/new': 'Other' }, (f) => path.join(lib, f), () => {});
  assert.deepStrictEqual(r, { 'models/Lora': 'linked', 'models/VAE': 'linked', 'models/new': 'linked' });
  assert.ok(fs.existsSync(path.join(lib, 'VAE', 'mine.safetensors')), 'moved into library');
  assert.ok(links.isLink(path.join(pkg, 'models', 'VAE')));
  // relinking to another library swaps only the link
  const lib2 = path.join(root, 'lib2');
  links.applyLinks(pkg, { 'models/VAE': 'VAE' }, (f) => path.join(lib2, f), () => {});
  assert.ok(fs.existsSync(path.join(lib, 'VAE', 'mine.safetensors')), 'first library untouched');
  links.removeAllLinks(pkg);
  assert.ok(!fs.existsSync(path.join(pkg, 'models', 'VAE')));
  assert.ok(fs.existsSync(path.join(lib, 'VAE', 'mine.safetensors')));
  fs.rmSync(root, { recursive: true, force: true });
});
console.log(`\n${n} checks passed`);
