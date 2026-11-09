// Mixer — WAV files: write 16/24-bit PCM or 32-bit float, read PCM/float WAVs. Plain JS for Node and the windows.
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.MXWav = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function encode(channels, sr, bits = 16) {
    const nc = channels.length, n = channels[0].length, bps = bits / 8, fmt = bits === 32 ? 3 : 1;
    const buf = new ArrayBuffer(44 + n * nc * bps), v = new DataView(buf); const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * nc * bps, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, fmt, true); v.setUint16(22, nc, true); v.setUint32(24, sr, true); v.setUint32(28, sr * nc * bps, true); v.setUint16(32, nc * bps, true); v.setUint16(34, bits, true); w(36, 'data'); v.setUint32(40, n * nc * bps, true);
    let o = 44; let d1 = 0, d2 = 0; // TPDF dither for 16-bit
    for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) {
      let x = channels[c][i]; if (!(x === x)) x = 0;
      if (bits === 32) { v.setFloat32(o, x, true); o += 4; continue; }
      x = Math.max(-1, Math.min(1, x));
      if (bits === 16) { const r = Math.random() - Math.random(); d1 = r; let q = Math.round(x * 32767 + d1 * 0.5); q = Math.max(-32768, Math.min(32767, q)); v.setInt16(o, q, true); o += 2; }
      else { let q = Math.round(x * 8388607); q = Math.max(-8388608, Math.min(8388607, q)); v.setUint8(o, q & 255); v.setUint8(o + 1, (q >> 8) & 255); v.setUint8(o + 2, (q >> 16) & 255); o += 3; }
    }
    void d2; return new Uint8Array(buf);
  }
  function decode(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); const v = new DataView(b.buffer, b.byteOffset, b.byteLength); const s = (o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
    if (s(0) !== 'RIFF' || s(8) !== 'WAVE') throw new Error('Not a WAV file');
    let o = 12, fmt = null, data = null;
    while (o + 8 <= b.length) { const id = s(o), len = v.getUint32(o + 4, true); if (id === 'fmt ') fmt = { tag: v.getUint16(o + 8, true), nc: v.getUint16(o + 10, true), sr: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) }; if (id === 'data') { data = [o + 8, Math.min(len, b.length - o - 8)]; break; } o += 8 + len + (len & 1); }
    if (!fmt || !data) throw new Error('Broken WAV file');
    let tag = fmt.tag; if (tag === 0xfffe) tag = fmt.bits === 32 ? 3 : 1; const bps = fmt.bits / 8, n = Math.floor(data[1] / (bps * fmt.nc)); const ch = Array.from({ length: fmt.nc }, () => new Float32Array(n)); let p = data[0];
    for (let i = 0; i < n; i++) for (let c = 0; c < fmt.nc; c++) { let x; if (tag === 3 && bps === 4) x = v.getFloat32(p, true); else if (tag === 3 && bps === 8) x = v.getFloat64(p, true); else if (bps === 2) x = v.getInt16(p, true) / 32768; else if (bps === 3) { let q = b[p] | (b[p + 1] << 8) | (b[p + 2] << 16); if (q & 0x800000) q |= ~0xffffff; x = q / 8388608; } else if (bps === 4) x = v.getInt32(p, true) / 2147483648; else x = (b[p] - 128) / 128; ch[c][i] = x; p += bps; }
    return { sampleRate: fmt.sr, channels: ch };
  }
  return { encode, decode };
});
