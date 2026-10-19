// Kiln — reading and writing PNG text chunks (generation settings live in them).
const zlib = require('zlib');

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function readText(buf) {
  const out = {};
  if (!buf || buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) return out;
  let i = 8;
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    const data = buf.subarray(i + 8, i + 8 + len);
    try {
      if (type === 'tEXt') {
        const z = data.indexOf(0);
        out[data.toString('latin1', 0, z)] = data.toString('latin1', z + 1);
      } else if (type === 'iTXt') {
        let z = data.indexOf(0);
        const key = data.toString('utf8', 0, z);
        const compressed = data[z + 1];
        let p = z + 3;
        p = data.indexOf(0, p) + 1;          // language tag
        p = data.indexOf(0, p) + 1;          // translated keyword
        const body = data.subarray(p);
        out[key] = (compressed ? zlib.inflateSync(body) : body).toString('utf8');
      } else if (type === 'zTXt') {
        const z = data.indexOf(0);
        out[data.toString('latin1', 0, z)] = zlib.inflateSync(data.subarray(z + 2)).toString('latin1');
      } else if (type === 'IEND') break;
    } catch {}
    i += 12 + len;
  }
  return out;
}

// Adds an iTXt chunk (UTF-8 safe) right after IHDR
function writeText(buf, key, value) {
  if (!buf.subarray(0, 8).equals(SIG)) return buf;
  const ihdrLen = buf.readUInt32BE(8);
  const at = 8 + 12 + ihdrLen;
  const data = Buffer.concat([Buffer.from(key, 'latin1'), Buffer.from([0, 0, 0, 0, 0]), Buffer.from(String(value), 'utf8')]);
  const typeAndData = Buffer.concat([Buffer.from('iTXt', 'latin1'), data]);
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeAndData.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(typeAndData), 8 + data.length);
  return Buffer.concat([buf.subarray(0, at), chunk, buf.subarray(at)]);
}

// A1111 "parameters" text -> { positive, negative, settings }
function parseA1111(text) {
  if (!text) return null;
  const lines = String(text).split('\n');
  let i = lines.findIndex(l => /^Steps: \d+/.test(l));
  if (i < 0) i = lines.length;
  const head = lines.slice(0, i).join('\n');
  const settingsLine = lines.slice(i).join(', ');
  const negAt = head.indexOf('Negative prompt:');
  const positive = (negAt >= 0 ? head.slice(0, negAt) : head).trim();
  const negative = negAt >= 0 ? head.slice(negAt + 16).trim() : '';
  const settings = {};
  const re = /\s*([\w ]+?):\s*("(?:\\.|[^"])*"|[^,]*)(?:,|$)/g;
  let m;
  while ((m = re.exec(settingsLine))) { if (m[1]) settings[m[1].trim()] = m[2].trim().replace(/^"|"$/g, ''); if (m.index === re.lastIndex) re.lastIndex++; }
  return { positive, negative, settings };
}
// ComfyUI "prompt" JSON -> rough { positive, negative, settings }
function parseComfy(promptJson) {
  try {
    const g = JSON.parse(promptJson);
    const nodes = Object.values(g);
    const ks = nodes.find(n => /KSampler/.test(n.class_type));
    const text = (ref) => { const n = ref && g[ref[0]]; return n?.inputs?.text ?? ''; };
    const ck = nodes.find(n => /CheckpointLoader|UNETLoader/.test(n.class_type));
    const lat = nodes.find(n => /EmptyLatentImage|EmptySD3LatentImage/.test(n.class_type));
    return {
      positive: ks ? text(ks.inputs.positive) : '', negative: ks ? text(ks.inputs.negative) : '',
      settings: ks ? { Steps: ks.inputs.steps, Sampler: ks.inputs.sampler_name, 'Schedule type': ks.inputs.scheduler, 'CFG scale': ks.inputs.cfg, Seed: ks.inputs.seed, Model: ck?.inputs?.ckpt_name || ck?.inputs?.unet_name || '', Size: lat ? `${lat.inputs.width}x${lat.inputs.height}` : '' } : {}
    };
  } catch { return null; }
}

module.exports = { readText, writeText, parseA1111, parseComfy, crc32 };
