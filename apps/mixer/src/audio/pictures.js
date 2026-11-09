// Mixer — pictures for Claude (and the window): a waveform with a spectrogram and bar ruler, the arrangement, a piano
// roll and a drum grid. Claude reads these to check its own work, the way Dither's plugin "trusts its eyes".
(function (root) {
  'use strict';
  const SG = root.MXSong, A = root.MXAnalysis, T = root.MXTheory;
  const C = { bg: '#0d1117', panel: '#141b24', grid: 'rgba(200,230,255,0.07)', grid2: 'rgba(200,230,255,0.16)', text: '#e8f1f8', mut: '#8aa0b4', acc: '#3ec8ff', wave: '#46e3b5' };
  const FONT = '600 13px -apple-system, "Segoe UI", Inter, system-ui, sans-serif';
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = C.bg; g.fillRect(0, 0, w, h); g.font = FONT; g.textBaseline = 'middle'; return { c, g }; }
  const png = (c) => c.toDataURL('image/png');
  function title(g, w, a, b) { g.fillStyle = C.text; g.font = '700 16px -apple-system, "Segoe UI", Inter, system-ui, sans-serif'; g.fillText(a, 16, 20); if (b) { g.font = FONT; g.fillStyle = C.mut; g.fillText(b, 16, 42); } g.font = FONT; }
  // turbo-ish colour map for the spectrogram
  function heat(v) { v = Math.max(0, Math.min(1, v)); const stops = [[13, 17, 23], [32, 40, 90], [40, 110, 180], [62, 200, 255], [70, 227, 181], [255, 214, 102], [255, 255, 240]]; const k = v * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(k)), f = k - i; return stops[i].map((x, j) => Math.round(x + (stops[i + 1][j] - x) * f)); }

  // audio: { channels, sr }, opts: { bpm, beatsPerBar, offsetBeats (where the audio starts, in song beats), title, sub, markers: [{beat,label}] }
  function waveform(audio, o = {}) {
    const W = 1400, top = 58, wh = 220, sh = 170, rh = 26, H = top + wh + 10 + sh + rh + 14; const { c, g } = canvas(W, H); const L = 56, R = 14, PW = W - L - R;
    title(g, W, o.title || 'Waveform', o.sub);
    const ch = audio.channels, n = ch[0].length, sr = audio.sr;
    g.fillStyle = C.panel; g.fillRect(L, top, PW, wh); g.fillRect(L, top + wh + 10, PW, sh);
    // dB guides
    g.fillStyle = C.mut; g.font = '11px system-ui'; g.textAlign = 'right';
    const mid = top + wh / 2; for (const d of [0, -6, -12]) { const a = Math.pow(10, d / 20) * (wh / 2 - 4); for (const y of [mid - a, mid + a]) { g.fillStyle = C.grid; g.fillRect(L, Math.round(y), PW, 1); } g.fillStyle = C.mut; g.fillText(d + ' dB', L - 6, mid - a); }
    // waveform (both channels overlaid; mid in mint, side tint where they differ)
    for (let k = 0; k < ch.length; k++) { const pk = A.peaks(ch[k], PW); g.fillStyle = k === 0 ? 'rgba(70,227,181,0.85)' : 'rgba(62,200,255,0.55)'; for (let x = 0; x < PW; x++) { const lo = pk[2 * x], hi = pk[2 * x + 1]; const y0 = mid - hi * (wh / 2 - 4), y1 = mid - lo * (wh / 2 - 4); g.fillRect(L + x, y0, 1, Math.max(1, y1 - y0)); if (Math.abs(hi) > 0.995 || Math.abs(lo) > 0.995) { g.fillStyle = '#ff5c72'; g.fillRect(L + x, top, 1, 4); g.fillStyle = k === 0 ? 'rgba(70,227,181,0.85)' : 'rgba(62,200,255,0.55)'; } } }
    // spectrogram
    const m = A.mono(ch); const S = A.spectrogram(m, sr, PW, sh); const img = g.createImageData(S.cols, S.rows); let mx = -120; for (const v of S.data) if (v > mx) mx = v;
    for (let i = 0; i < S.rows * S.cols; i++) { const r = Math.floor(i / S.cols), cc = i % S.cols; const v = S.data[r * PW + cc]; const [a, b2, d] = heat((v - (mx - 75)) / 75); img.data.set([a, b2, d, 255], i * 4); }
    g.putImageData(img, L, top + wh + 10);
    g.fillStyle = C.mut; for (const [f, lbl] of [[100, '100'], [1000, '1k'], [5000, '5k'], [10000, '10k']]) { const y = top + wh + 10 + sh - (Math.log(f / 30) / Math.log(Math.min(16000, sr / 2) / 30)) * sh; g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(L, Math.round(y), 8, 1); g.fillStyle = C.mut; g.fillText(lbl + ' Hz', L - 6, y); }
    // bar ruler
    const secs = n / sr; const ry = top + wh + 10 + sh + 4; g.textAlign = 'center';
    if (o.bpm) { const bpb = o.beatsPerBar || 4; const barSec = (60 / o.bpm) * bpb; const off = (o.offsetBeats || 0) * (60 / o.bpm); const first = Math.ceil(off / barSec - 1e-6); const nb = secs / barSec; const every = nb > 96 ? 8 : nb > 48 ? 4 : nb > 24 ? 2 : 1;
      for (let b = first; b * barSec - off <= secs + 1e-6; b++) { const x = L + ((b * barSec - off) / secs) * PW; g.fillStyle = b % every ? C.grid : C.grid2; g.fillRect(Math.round(x), top, 1, wh + 10 + sh); if (b % every === 0) { g.fillStyle = C.mut; g.fillText(String(b + 1), x, ry + 9); } }
      g.textAlign = 'left'; g.fillText('bar', 14, ry + 9); }
    else { const step = secs > 120 ? 30 : secs > 40 ? 10 : secs > 10 ? 2 : 1; for (let s = 0; s <= secs; s += step) { const x = L + (s / secs) * PW; g.fillStyle = C.grid2; g.fillRect(Math.round(x), top, 1, wh + 10 + sh); g.fillStyle = C.mut; g.fillText(`${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`, x, ry + 9); } }
    for (const mk of o.markers || []) { const x = L + ((mk.beat * 60) / o.bpm / secs) * PW; g.fillStyle = C.acc; g.fillRect(Math.round(x), top - 4, 2, wh + 14); g.textAlign = 'left'; g.fillText(mk.label, x + 4, top + 8); }
    g.textAlign = 'left'; return png(c);
  }

  function arrangement(song, o = {}) {
    const B = SG.bpb(song); const end = Math.max(SG.songEnd(song), B); const bars = Math.ceil(end / B - 1e-6); const tracks = song.tracks; const LH = 58, top = 82, L = 190, W = 1400, H = top + Math.max(1, tracks.length) * LH + 24; const PW = W - L - 14;
    const { c, g } = canvas(W, H); title(g, W, song.name, `${song.bpm} BPM · ${song.key} · ${song.timeSig.join('/')} · ${bars} bars · ${fmtTime(end * SG.spb(song))}`);
    const xOf = (beat) => L + (beat / (bars * B)) * PW; const every = bars > 96 ? 8 : bars > 48 ? 4 : bars > 24 ? 2 : 1;
    g.textAlign = 'center'; for (let b = 0; b <= bars; b++) { const x = xOf(b * B); g.fillStyle = b % (4 * every) === 0 ? C.grid2 : C.grid; g.fillRect(Math.round(x), top - 6, 1, H - top - 18); if (b < bars && b % every === 0) { g.fillStyle = C.mut; g.fillText(String(b + 1), x + 10, top - 16); } }
    if (song.loop.on) { g.fillStyle = 'rgba(62,200,255,0.12)'; g.fillRect(xOf(song.loop.start), top - 8, xOf(song.loop.end) - xOf(song.loop.start), H - top - 14); }
    for (const mk of song.markers || []) { g.fillStyle = C.acc; g.fillRect(xOf(mk.beat), top - 30, 2, 14); g.textAlign = 'left'; g.fillText(mk.name, xOf(mk.beat) + 5, top - 23); }
    g.textAlign = 'left';
    tracks.forEach((t, i) => {
      const y = top + i * LH; g.fillStyle = i % 2 ? 'rgba(255,255,255,0.015)' : 'rgba(255,255,255,0.035)'; g.fillRect(0, y, W, LH);
      g.fillStyle = t.color; g.fillRect(12, y + 10, 4, LH - 20); g.fillStyle = (t.mute || (tracks.some((x) => x.solo) && !t.solo)) ? C.mut : C.text; g.font = '700 13px system-ui'; g.fillText(`${i + 1}. ${t.name}`.slice(0, 22), 24, y + 21);
      g.font = '12px system-ui'; g.fillStyle = C.mut; g.fillText(`${t.kind === 'audio' ? 'audio' : t.sound}${t.mute ? ' · muted' : ''}${t.solo ? ' · solo' : ''} · ${t.volume >= 0 ? '+' : ''}${t.volume} dB`.slice(0, 28), 24, y + 39); g.font = FONT;
      for (const cl of song.clips.filter((x) => x.track === t.id)) {
        const x0 = xOf(cl.start), x1 = xOf(SG.clipEnd(song, cl)); const cy = y + 6, chh = LH - 12;
        g.fillStyle = hexA(t.color, 0.22); rr(g, x0 + 1, cy, Math.max(2, x1 - x0 - 2), chh, 5); g.fill(); g.strokeStyle = hexA(t.color, 0.8); g.lineWidth = 1; g.stroke();
        g.save(); g.beginPath(); g.rect(x0 + 1, cy, Math.max(2, x1 - x0 - 2), chh); g.clip();
        if (cl.file) { const buf = o.assets && o.assets.raw.get(cl.file); if (buf) { const d = buf.getChannelData(0); const s0 = Math.floor(cl.offset * buf.sampleRate), s1 = Math.floor((cl.offset + cl.dur) * buf.sampleRate); const pk = A.peaks(d, Math.max(1, Math.round(x1 - x0)), s0, s1); g.fillStyle = hexA(t.color, 0.85); for (let k = 0; k < pk.length / 2; k++) { const kk = cl.reverse ? pk.length / 2 - 1 - k : k; const a = pk[2 * kk], b = pk[2 * kk + 1]; g.fillRect(x0 + k, cy + chh / 2 - b * chh * 0.45, 1, Math.max(1, (b - a) * chh * 0.45)); } } }
        else if (cl.notes.length) { if (t.kind === 'drums') { const vs = [...new Set(cl.notes.map((n) => n.p))]; for (const n of cl.notes) { const vy = cy + 4 + (vs.indexOf(n.p) / Math.max(1, vs.length)) * (chh - 8); g.fillStyle = hexA(t.color, 0.5 + n.v * 0.5); g.fillRect(xOf(cl.start + n.t), vy, 2, Math.max(2, (chh - 8) / vs.length - 1)); } } else { const ps = cl.notes.map((n) => n.p); const lo = Math.min(...ps) - 1, hi = Math.max(...ps) + 1; for (const n of cl.notes) { const ny = cy + chh - 3 - ((n.p - lo) / Math.max(1, hi - lo)) * (chh - 6); g.fillStyle = hexA(t.color, 0.95); g.fillRect(xOf(cl.start + n.t), ny - 1.5, Math.max(2, xOf(cl.start + n.t + n.d) - xOf(cl.start + n.t) - 1), 3); } } }
        g.restore(); g.fillStyle = C.text; g.font = '600 11px system-ui'; if (x1 - x0 > 50) g.fillText((cl.name || '').slice(0, Math.floor((x1 - x0) / 7)), x0 + 6, cy + 9); g.font = FONT;
      }
    });
    if (!tracks.length) { g.fillStyle = C.mut; g.fillText('No tracks yet', L + 10, top + 28); }
    return png(c);
  }

  function pianoRoll(song, track, o = {}) {
    const t = SG.findTrack(song, track); const B = SG.bpb(song); const from = o.fromBar ? SG.barToBeat(song, o.fromBar) : 0; const clips = song.clips.filter((c) => c.track === t.id && !c.file);
    const notes = []; for (const c of clips) for (const n of c.notes) { const b = c.start + n.t; notes.push({ ...n, b }); }
    const lastBeat = notes.reduce((m, n) => Math.max(m, n.b + n.d), from + B); const nb = o.bars || Math.min(32, Math.max(1, Math.ceil((lastBeat - from) / B - 1e-6))); const to = from + nb * B;
    const vis = notes.filter((n) => n.b < to && n.b + n.d > from);
    if (t.kind === 'drums') return drumGrid(song, t, vis, from, nb);
    const ps = vis.map((n) => n.p); let lo = ps.length ? Math.min(...ps) - 2 : 55, hi = ps.length ? Math.max(...ps) + 2 : 72; if (hi - lo < 14) { const m = (hi + lo) / 2; lo = Math.floor(m - 7); hi = Math.ceil(m + 7); }
    const rows = hi - lo + 1, rh = Math.max(9, Math.min(18, Math.floor(560 / rows))); const top = 64, L = 60, W = 1400, PW = W - L - 14, H = top + rows * rh + 30; const { c, g } = canvas(W, H);
    title(g, W, `${t.name} — notes`, `${t.sound} · bars ${SG.beatToBar(song, from)}–${SG.beatToBar(song, to) - 1} · ${song.key} · ${vis.length} notes`);
    let K = null; try { K = T.parseKey(song.key); } catch {}
    for (let p = lo; p <= hi; p++) { const y = top + (hi - p) * rh; const black = [1, 3, 6, 8, 10].includes(((p % 12) + 12) % 12); g.fillStyle = K && T.inKey(p, K) ? 'rgba(62,200,255,0.06)' : black ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.02)'; g.fillRect(L, y, PW, rh); if (p % 12 === 0 || rh >= 13) { g.fillStyle = p % 12 === 0 ? C.text : C.mut; g.font = (p % 12 === 0 ? '700 ' : '') + '11px system-ui'; g.textAlign = 'right'; g.fillText(T.midiToName(p, K && K.flats), L - 8, y + rh / 2); } }
    g.textAlign = 'center'; for (let b = 0; b <= nb * B; b++) { const x = L + (b / (nb * B)) * PW; g.fillStyle = b % B === 0 ? C.grid2 : C.grid; g.fillRect(Math.round(x), top, 1, rows * rh); if (b % B === 0 && b < nb * B) { g.fillStyle = C.mut; g.fillText(String(SG.beatToBar(song, from + b)), x + 12, top + rows * rh + 14); } }
    for (const n of vis) { const x0 = L + ((n.b - from) / (nb * B)) * PW, x1 = L + ((n.b + n.d - from) / (nb * B)) * PW; const y = top + (hi - n.p) * rh; g.fillStyle = hexA(t.color, 0.35 + 0.65 * n.v); rr(g, x0 + 0.5, y + 1, Math.max(3, x1 - x0 - 1), rh - 2, 3); g.fill(); g.strokeStyle = 'rgba(0,0,0,0.35)'; g.stroke(); }
    g.textAlign = 'left'; return png(c);
  }
  function drumGrid(song, t, vis, from, nb) {
    const B = SG.bpb(song); const order = T.DRUM_VOICES.filter((v) => vis.some((n) => n.p === v)); if (!order.length) order.push('kick', 'snare', 'hat'); const steps = nb * B * 4; const rh = 30, top = 64, L = 100, W = 1400, PW = W - L - 14, H = top + order.length * rh + 30; const { c, g } = canvas(W, H);
    title(g, W, `${t.name} — drum grid`, `${t.sound} kit · bars ${SG.beatToBar(song, from)}–${SG.beatToBar(song, from + nb * B) - 1} · 16th-note steps · brighter = harder`);
    const cw = PW / steps;
    order.forEach((v, r) => { const y = top + r * rh; g.fillStyle = r % 2 ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.04)'; g.fillRect(L, y, PW, rh); g.fillStyle = C.text; g.textAlign = 'right'; g.fillText(v, L - 10, y + rh / 2); });
    for (let s = 0; s <= steps; s++) { const x = L + s * cw; g.fillStyle = s % (B * 4) === 0 ? C.grid2 : s % 4 === 0 ? 'rgba(200,230,255,0.10)' : C.grid; g.fillRect(Math.round(x), top, 1, order.length * rh); if (s % (B * 4) === 0 && s < steps) { g.fillStyle = C.mut; g.textAlign = 'left'; g.fillText('bar ' + SG.beatToBar(song, from + s / 4), x + 4, top + order.length * rh + 14); } }
    for (const n of vis) { const r = order.indexOf(n.p); if (r < 0) continue; const s = (n.b - from) * 4; const x = L + s * cw; g.fillStyle = hexA(t.color, 0.3 + 0.7 * n.v); rr(g, x + 1.5, top + r * rh + 4, Math.max(3, cw - 3), rh - 8, 3); g.fill(); }
    g.textAlign = 'left'; return png(c);
  }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function hexA(hex, a) { const h = String(hex || '#3ec8ff').replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
  function fmtTime(s) { return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`; }
  root.MXPictures = { waveform, arrangement, pianoRoll, hexA, fmtTime };
})(typeof self !== 'undefined' ? self : this);
