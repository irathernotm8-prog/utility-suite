// Mixer — the engine window: renders, measures, draws and exports for the plugin and the Export sheet. Hidden; jobs
// arrive from the main process. Same engine code as the window's playback.
'use strict';
const E = window.mixerEngine, SG = MXSong, AN = MXAnalysis, PIC = MXPictures, ENG = MXEngine;
const assets = new ENG.Assets((f) => E.readAudio(f));
E.forget((f) => assets.forget(f));
const kindOf = (song, target) => {
  if (!target || target === 'mix' || target === 'master') return { kind: 'mix' };
  const c = SG.findClip(song, target, { must: false }); if (c) return { kind: 'clip', clip: c, track: SG.findTrack(song, c.track) };
  return { kind: 'track', track: SG.findTrack(song, target) };
};
async function renderTarget(song, a) {
  const K = kindOf(song, a.target); const B = SG.bpb(song);
  let from = a.fromBar ? SG.barToBeat(song, a.fromBar) : 0; let to = a.bars ? from + a.bars * B : null; let tracks = null, master = true, title = song.name;
  if (K.kind === 'track') { tracks = [K.track.id]; master = !!a.withMaster; title = `${K.track.name} (track, ${master ? 'through' : 'before'} the master)`; }
  if (K.kind === 'clip') { tracks = [K.track.id]; master = false; from = K.clip.start; to = SG.clipEnd(song, K.clip); title = `${K.track.name} › ${K.clip.name}`; }
  const r = await ENG.render(song, assets, { from, to, tracks, master, sr: a.sr || 32000 }); // 32 kHz covers everything measured (to 16 kHz) and renders faster
  return { r, K, from, to, title };
}
const jobs = {
  async analyze(a) {
    const song = SG.hydrate(a.song); const { r, K, from, title } = await renderTarget(song, a);
    const rep = AN.analyze(r.channels, r.sr, { bpm: song.bpm, beatsPerBar: SG.bpb(song), target: a.targetLufs ?? -14, kind: K.kind === 'mix' ? 'mix' : 'part', skipTempo: true });
    rep.start_bar = SG.beatToBar(song, from); if (rep.sections) rep.sections = rep.sections.map((s) => ({ ...s, from_bar: s.from_bar + rep.start_bar - 1, to_bar: s.to_bar + rep.start_bar - 1 }));
    const sub = `${rep.loudness_lufs} LUFS · peak ${rep.peak_dbfs} dBFS · ${rep.key ? rep.key.key : ''} · ${song.bpm} BPM`;
    const picture = a.picture === false ? null : PIC.waveform(r, { bpm: song.bpm, beatsPerBar: SG.bpb(song), offsetBeats: from, title, sub, markers: (song.markers || []).map((m) => ({ beat: m.beat - from, label: m.name })).filter((m) => m.beat >= 0) });
    return { report: rep, picture };
  },
  async probe(a) {
    const buf = await assets.get(a.file); const ch = []; for (let c = 0; c < buf.numberOfChannels; c++) ch.push(buf.getChannelData(c));
    const rep = AN.analyze(ch, buf.sampleRate, { kind: 'part' });
    const bpm = rep.tempo && rep.tempo.bpm; const picture = a.picture === false ? null : PIC.waveform({ channels: ch, sr: buf.sampleRate }, { bpm, offsetBeats: bpm ? -rep.tempo.firstBeat * bpm / 60 : 0, title: a.name || a.file, sub: `${rep.seconds}s · ${bpm ? bpm + ' BPM (detected)' : 'tempo unclear'} · ${rep.key ? rep.key.key : ''} · ${rep.loudness_lufs} LUFS` });
    return { seconds: buf.duration, sampleRate: buf.sampleRate, channels: buf.numberOfChannels, report: rep, picture };
  },
  async picture(a) {
    const song = SG.hydrate(a.song);
    if (a.kind === 'arrangement' || !a.kind) { await assets.need(song); return { picture: PIC.arrangement(song, { assets }) }; }
    if (a.kind === 'notes') return { picture: PIC.pianoRoll(song, a.track, { fromBar: a.fromBar, bars: a.bars }) };
    if (a.kind === 'waveform') return jobs.analyze({ ...a, picture: true });
    throw new Error('Pictures: arrangement, notes or waveform.');
  },
  async peaks(a) { const buf = await assets.get(a.file); const d = []; for (let c = 0; c < buf.numberOfChannels; c++) d.push(AN.peaks(buf.getChannelData(c), a.cols || 2000)); return { peaks: d, seconds: buf.duration }; },
  async export(a) {
    let song = SG.hydrate(JSON.parse(JSON.stringify(a.song))); const B = SG.bpb(song);
    const from = a.fromBar ? SG.barToBeat(song, a.fromBar) : 0; const to = a.bars ? from + a.bars * B : null; const sr = a.sr || 44100;
    const files = []; const fmt = a.format === 'mp3' ? 'mp3' : 'wav';
    let gainNote = null;
    if (a.normalize != null && a.normalize !== false) {
      const target = typeof a.normalize === 'number' ? a.normalize : -14;
      for (let i = 0; i < 2; i++) {
        const r = await ENG.render(song, assets, { from, to, sr }); const L = AN.loudness(r.channels, r.sr).integrated; const d = target - L; if (Math.abs(d) < 0.3 || L <= -69) break;
        let lim = song.master.effects.filter((f) => f.on && f.type === 'limiter').pop();
        if (!lim && d > 0) { lim = SG.addEffect(song, 'master', { type: 'limiter', ceiling: -1, gain: 0 }); }
        if (lim) { const want = (+lim.gain || 0) + d; lim.gain = Math.max(0, Math.min(24, want)); if (want < 0) song.master.volume += want; } else song.master.volume += d;
        gainNote = `${lim ? `limiter gain ${lim.gain.toFixed(1)} dB, ` : ''}master ${song.master.volume.toFixed(1)} dB`;
      }
    }
    const enc = async (r) => (fmt === 'mp3' ? mp3(r, a.kbps || 320) : MXWav.encode(r.channels, r.sr, a.bits || 24));
    E.progress(a._id, 'Rendering the mix…');
    const mix = await ENG.render(song, assets, { from, to, sr }); const lu = AN.loudness(mix.channels, mix.sr); const lv = AN.levels(mix.channels);
    if (!a.stemsOnly) files.push({ name: `${a.name || song.name}.${fmt}`, bytes: await enc(mix) });
    if (a.stems) for (const t of song.tracks) { if (!song.clips.some((c) => c.track === t.id)) continue; E.progress(a._id, `Stem: ${t.name}`); const st = await ENG.render(song, assets, { from, to, sr, tracks: [t.id], master: false }); const n = st.channels[0].length; const pad = st.channels.map((c) => { const o = new Float32Array(Math.max(n, mix.channels[0].length)); o.set(c.subarray(0, o.length)); return o; }); files.push({ name: `${a.name || song.name} - ${t.name}.${fmt}`, bytes: await enc({ channels: pad, sr: st.sr }), stem: t.name }); }
    return { files, loudness_lufs: lu.integrated, peak_dbfs: lv.peak, seconds: +(mix.channels[0].length / mix.sr).toFixed(2), normalized: gainNote };
  },
};
async function mp3(r, kbps) {
  const L = lamejs; const nc = Math.min(2, r.channels.length); const enc = new L.Mp3Encoder(nc, r.sr, kbps); const n = r.channels[0].length; const blk = 1152 * 16; const parts = []; let size = 0;
  const toI = (x, a, b) => { const o = new Int16Array(b - a); for (let i = a; i < b; i++) { const v = Math.max(-1, Math.min(1, x[i])); o[i - a] = v < 0 ? v * 32768 : v * 32767; } return o; };
  for (let i = 0; i < n; i += blk) { const e = Math.min(n, i + blk); const l = toI(r.channels[0], i, e); const out = nc === 2 ? enc.encodeBuffer(l, toI(r.channels[1], i, e)) : enc.encodeBuffer(l); if (out.length) { parts.push(new Uint8Array(out.buffer, out.byteOffset, out.length).slice()); size += out.length; } if ((i / blk) % 40 === 0) await new Promise((res) => setTimeout(res, 0)); }
  const f = enc.flush(); if (f.length) { parts.push(new Uint8Array(f.buffer, f.byteOffset, f.length).slice()); size += f.length; }
  const o = new Uint8Array(size); let p = 0; for (const x of parts) { o.set(x, p); p += x.length; } return o;
}
E.onJob(async (j) => { try { const data = await jobs[j.kind]({ ...j.args, _id: j.id }); E.done(j.id, true, data); } catch (e) { console.error(e); E.done(j.id, false, (e && e.message) || String(e)); } });
console.log('engine ready');
