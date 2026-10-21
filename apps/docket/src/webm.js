// Recordings come from MediaRecorder in chunks, so the WebM has no Duration and players can't show length or seek well.
// setDuration() writes one into the Segment Info: the smallest fix that makes the file behave in every player.
function vint(buf, pos, keepMarker) {
  const b = buf[pos];
  let len = 1, mask = 0x80;
  while (len <= 8 && !(b & mask)) { len++; mask >>= 1; }
  if (len > 8) throw new Error('bad vint');
  let val = keepMarker ? b : (b & (mask - 1));
  let allOnes = (b & (mask - 1)) === mask - 1;
  for (let i = 1; i < len; i++) { val = val * 256 + buf[pos + i]; if (buf[pos + i] !== 0xff) allOnes = false; }
  return { val, len, unknown: !keepMarker && allOnes };
}
function sizeBytes(n, len = 8) {
  const out = Buffer.alloc(len);
  let v = n;
  for (let i = len - 1; i >= 0; i--) { out[i] = v % 256; v = Math.floor(v / 256); }
  out[0] |= 0x80 >> (len - 1);
  return out;
}
const ID = { EBML: 0x1a45dfa3, Segment: 0x18538067, Info: 0x1549a966, TimecodeScale: 0x2ad7b1, Duration: 0x4489, Cluster: 0x1f43b675 };

function setDuration(buf, durationMs) {
  if (!buf || buf.length < 64 || !(durationMs > 0)) return null;
  let p = 0;
  const id0 = vint(buf, p, true); if (id0.val !== ID.EBML) return null;
  const s0 = vint(buf, p + id0.len); p += id0.len + s0.len + s0.val;
  const seg = vint(buf, p, true); if (seg.val !== ID.Segment) return null;
  const segSizePos = p + seg.len;
  const segSize = vint(buf, segSizePos);
  let q = segSizePos + segSize.len;
  while (q < buf.length) {
    const id = vint(buf, q, true), sz = vint(buf, q + id.len);
    const dataStart = q + id.len + sz.len;
    if (id.val === ID.Cluster) return null; // no Info before the audio
    if (id.val !== ID.Info) { if (sz.unknown) return null; q = dataStart + sz.val; continue; }
    const infoEnd = dataStart + sz.val;
    let scale = 1000000, r = dataStart, durPos = -1, durLen = 0;
    while (r < infoEnd) {
      const cid = vint(buf, r, true), cs = vint(buf, r + cid.len), cStart = r + cid.len + cs.len;
      if (cid.val === ID.TimecodeScale) { scale = 0; for (let i = 0; i < cs.val; i++) scale = scale * 256 + buf[cStart + i]; }
      if (cid.val === ID.Duration) { durPos = cStart; durLen = cs.val; }
      r = cStart + cs.val;
    }
    const value = durationMs * 1e6 / (scale || 1e6);
    if (durPos >= 0) { // already has one: overwrite in place
      const out = Buffer.from(buf);
      if (durLen === 8) out.writeDoubleBE(value, durPos); else if (durLen === 4) out.writeFloatBE(value, durPos); else return null;
      return out;
    }
    const dur = Buffer.concat([Buffer.from([0x44, 0x89, 0x88]), Buffer.alloc(8)]); dur.writeDoubleBE(value, 3);
    const payload = Buffer.concat([buf.subarray(dataStart, infoEnd), dur]);
    const info = Buffer.concat([buf.subarray(q, q + id.len), sizeBytes(payload.length), payload]);
    const delta = info.length - (infoEnd - q);
    let head = Buffer.from(buf.subarray(0, q));
    if (!segSize.unknown) sizeBytes(segSize.val + delta, segSize.len).copy(head, segSizePos);
    return Buffer.concat([head, info, buf.subarray(infoEnd)]);
  }
  return null;
}

// Reads the Duration back (ms) — used by tests.
function getDuration(buf) {
  try {
    let p = 0; const id0 = vint(buf, 0, true); if (id0.val !== ID.EBML) return null;
    const s0 = vint(buf, id0.len); p = id0.len + s0.len + s0.val;
    const seg = vint(buf, p, true); const ss = vint(buf, p + seg.len); let q = p + seg.len + ss.len;
    while (q < buf.length) {
      const id = vint(buf, q, true), sz = vint(buf, q + id.len), d = q + id.len + sz.len;
      if (id.val === ID.Info) {
        let r = d, scale = 1e6, dur = null;
        while (r < d + sz.val) {
          const cid = vint(buf, r, true), cs = vint(buf, r + cid.len), c = r + cid.len + cs.len;
          if (cid.val === ID.TimecodeScale) { scale = 0; for (let i = 0; i < cs.val; i++) scale = scale * 256 + buf[c + i]; }
          if (cid.val === ID.Duration) dur = cs.val === 8 ? buf.readDoubleBE(c) : buf.readFloatBE(c);
          r = c + cs.val;
        }
        return dur === null ? null : dur * scale / 1e6;
      }
      if (sz.unknown) return null; q = d + sz.val;
    }
  } catch (_) {}
  return null;
}

module.exports = { setDuration, getDuration };
