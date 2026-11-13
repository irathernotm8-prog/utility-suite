// Mixer — the song: tempo, key, tracks (instrument, drums, audio), clips and notes, master effects, automation, and
// every edit both the window and Claude make. Times are in beats (quarter notes) from the start of the song; bars in
// the plugin are 1-based. Audio clips keep their source position in seconds. Plain JS (no imports) for all sides.
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(require('./theory'), require('./sounds')); else root.MXSong = factory(root.MXTheory, root.MXSounds); })(typeof self !== 'undefined' ? self : this, function (T, SND) {
  'use strict';
  const uid = (p) => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const r4 = (x) => Math.round(x * 10000) / 10000;

  function newSong({ name = 'Untitled song', bpm = 120, key = 'C major', timeSig = [4, 4], bars = 16 } = {}) {
    const K = T.parseKey(key);
    return hydrate({ v: 1, id: uid('song_'), name, bpm: clamp(+bpm || 120, 30, 300), key: K.name, timeSig, bars, loop: { on: false, start: 0, end: bars * 4 }, master: { volume: 0, effects: [{ id: uid('fx'), on: true, ...SND.effectDefaults('limiter') }] }, tracks: [], clips: [], markers: [], createdAt: Date.now(), updatedAt: Date.now() });
  }
  function hydrate(s) {
    s.v = 1; s.bpm = clamp(+s.bpm || 120, 30, 300); s.timeSig = Array.isArray(s.timeSig) && s.timeSig.length === 2 ? s.timeSig.map((x) => Math.max(1, Math.round(+x) || 4)) : [4, 4];
    try { s.key = T.parseKey(s.key || 'C major').name; } catch { s.key = 'C major'; }
    s.bars = Math.max(1, Math.round(+s.bars || 16)); s.loop = { on: false, start: 0, end: s.bars * bpb(s), ...(s.loop || {}) };
    s.master = { volume: 0, effects: [], ...(s.master || {}) }; s.master.effects = (s.master.effects || []).map(fxHydrate);
    s.tracks = (s.tracks || []).map((t, i) => ({ id: t.id || uid('t'), name: t.name || `Track ${i + 1}`, kind: t.kind || 'instrument', sound: t.sound || (t.kind === 'drums' ? 'studio' : t.kind === 'audio' ? null : 'grand-piano'), color: t.color || SND.COLORS[i % SND.COLORS.length], volume: +t.volume || 0, pan: clamp(+t.pan || 0, -1, 1), mute: !!t.mute, solo: !!t.solo, effects: (t.effects || []).map(fxHydrate), automation: t.automation || {}, pads: t.pads || {}, octave: t.octave || 0 }));
    s.clips = (s.clips || []).filter((c) => s.tracks.some((t) => t.id === c.track)).map((c) => ({ ...c, id: c.id || uid('c'), start: Math.max(0, +c.start || 0) }));
    s.markers = s.markers || [];
    return s;
  }
  function fxHydrate(f) { const d = SND.effectDefaults(f.type); return { ...d, ...f, id: f.id || uid('fx'), on: f.on !== false }; }

  const bpb = (s) => (s.timeSig[0] * 4) / s.timeSig[1];             // beats per bar
  const spb = (s) => 60 / s.bpm;                                     // seconds per beat
  const barToBeat = (s, bar) => (Math.max(1, +bar) - 1) * bpb(s);    // 1-based bar → beat
  const beatToBar = (s, beat) => beat / bpb(s) + 1;
  function fmtPos(s, beat) { const b = bpb(s); const bar = Math.floor(beat / b + 1e-6); const rest = beat - bar * b; return `${bar + 1}.${Math.floor(rest + 1e-6) + 1}${rest % 1 > 0.01 ? '.' + Math.round((rest % 1) * 4 + 1) : ''}`; }

  // ───── tracks
  function findTrack(s, ref, { must = true } = {}) {
    if (ref && typeof ref === 'object') ref = ref.id;
    let t = s.tracks.find((x) => x.id === ref);
    if (!t && ref != null) { const r = String(ref).toLowerCase().trim(); t = s.tracks.find((x) => x.name.toLowerCase() === r) || (/^\d+$/.test(r) ? s.tracks[+r - 1] : null) || s.tracks.find((x) => x.name.toLowerCase().startsWith(r)); }
    if (!t && must) throw new Error(`No track “${ref}”. Tracks: ${s.tracks.map((x, i) => `${i + 1}. ${x.name}`).join(', ') || 'none yet'}.`);
    return t || null;
  }
  function addTrack(s, { name, kind = 'instrument', sound, color, volume = 0, pan = 0, effects, index } = {}) {
    if (!['instrument', 'drums', 'audio'].includes(kind)) throw new Error('Track kind is instrument, drums or audio.');
    let snd = null;
    if (kind === 'instrument') { snd = sound ? SND.findSound(sound, 'instrument') : SND.instrument('grand-piano'); if (!snd) throw new Error(`No instrument “${sound}”. Try list_sounds.`); }
    if (kind === 'drums') { snd = sound ? SND.findSound(sound, 'drums') : SND.kit('studio'); if (!snd) throw new Error(`No drum kit “${sound}”. Kits: ${SND.KITS.map((k) => k.id).join(', ')}.`); }
    const t = { id: uid('t'), name: name || (snd ? snd.name : 'Audio ' + (s.tracks.filter((x) => x.kind === 'audio').length + 1)), kind, sound: snd ? snd.id : null, color: color || SND.COLORS[s.tracks.length % SND.COLORS.length], volume: +volume || 0, pan: clamp(+pan || 0, -1, 1), mute: false, solo: false, effects: [], automation: {}, pads: {}, octave: 0 };
    t.effects = (effects || (snd && snd.fx) || []).map((f) => fxHydrate({ ...f }));
    if (index != null && index >= 0 && index < s.tracks.length) s.tracks.splice(index, 0, t); else s.tracks.push(t);
    return t;
  }
  function updateTrack(s, ref, p) {
    const t = findTrack(s, ref);
    if (p.name != null) t.name = String(p.name).slice(0, 60) || t.name;
    if (p.sound != null && t.kind !== 'audio') { const snd = SND.findSound(p.sound, t.kind); if (!snd) throw new Error(`No ${t.kind === 'drums' ? 'drum kit' : 'instrument'} “${p.sound}”.`); t.sound = snd.id; if (p.effects == null && p.keepEffects === false && snd.fx) t.effects = snd.fx.map((f) => fxHydrate({ ...f })); }
    if (p.volume != null) t.volume = clamp(+p.volume, -60, 12);
    if (p.pan != null) t.pan = clamp(+p.pan, -1, 1);
    if (p.mute != null) t.mute = !!p.mute; if (p.solo != null) t.solo = !!p.solo; if (p.color) t.color = p.color;
    if (p.octave != null) t.octave = clamp(Math.round(+p.octave), -3, 3);
    if (p.effects != null) t.effects = p.effects.map((f) => fxHydrate(typeof f === 'string' ? { type: f } : { ...f }));
    if (p.automation != null) t.automation = p.automation;
    if (p.pads != null) t.pads = { ...t.pads, ...p.pads };
    if (p.index != null) { const i = s.tracks.indexOf(t); s.tracks.splice(i, 1); s.tracks.splice(clamp(Math.round(p.index), 0, s.tracks.length), 0, t); }
    return t;
  }
  function removeTrack(s, ref) { const t = findTrack(s, ref); s.tracks = s.tracks.filter((x) => x !== t); s.clips = s.clips.filter((c) => c.track !== t.id); return t; }

  // effects on a track or the master: add / update / remove / move by index or type
  function fxList(s, target) { return target === 'master' || target == null ? s.master.effects : findTrack(s, target).effects; }
  function addEffect(s, target, fx, index) { const list = fxList(s, target); const f = fxHydrate(typeof fx === 'string' ? { type: fx } : { ...fx }); if (index != null) list.splice(index, 0, f); else if (f.type !== 'limiter' && list.length && list[list.length - 1].type === 'limiter') list.splice(list.length - 1, 0, f); else list.push(f); return f; }
  function findEffect(list, ref) { if (ref == null) return null; let f = list.find((x) => x.id === ref); if (!f && /^\d+$/.test(String(ref))) f = list[+ref - 1]; if (!f) f = list.find((x) => x.type === ref); return f || null; }
  function updateEffect(s, target, ref, patch) { const list = fxList(s, target); const f = findEffect(list, ref); if (!f) throw new Error(`No effect “${ref}” on ${target || 'master'}.`); const spec = SND.EFFECTS[f.type].params; for (const [k, v] of Object.entries(patch)) { if (k === 'on') f.on = !!v; else if (k in spec) f[k] = typeof spec[k][2] === 'string' && typeof v === 'string' ? v : typeof v === 'string' && /^\d+\/\d+[dt]?$/.test(v) ? v : (typeof spec[k][0] === 'number' && spec[k][1] > spec[k][0] && typeof v === 'number' ? clamp(v, spec[k][0], spec[k][1]) : v); } return f; }
  function removeEffect(s, target, ref) { const list = fxList(s, target); const f = findEffect(list, ref); if (!f) throw new Error(`No effect “${ref}”.`); list.splice(list.indexOf(f), 1); return f; }

  // ───── clips
  const isAudio = (c) => !!c.file;
  function clipLength(s, c) { if (isAudio(c)) return (c.dur * (c.stretch || 1)) / (c.speed || 1) / spb(s); return c.length; }
  const clipEnd = (s, c) => c.start + clipLength(s, c);
  function songEnd(s) { let e = s.bars * bpb(s); for (const c of s.clips) e = Math.max(e, clipEnd(s, c)); return e; }
  function fitBars(s) { const e = s.clips.reduce((m, c) => Math.max(m, clipEnd(s, c)), 0); const need = Math.ceil(e / bpb(s) - 1e-6); if (need > s.bars) s.bars = need; return s.bars; }
  function findClip(s, ref, { must = true } = {}) {
    let c = s.clips.find((x) => x.id === ref);
    if (!c && ref != null) { const r = String(ref).toLowerCase(); c = s.clips.find((x) => (x.name || '').toLowerCase() === r); }
    if (!c && must) throw new Error(`No clip “${ref}”. Use get_song to see clip ids.`);
    return c || null;
  }
  function clipsOn(s, trackRef) { const t = findTrack(s, trackRef); return s.clips.filter((c) => c.track === t.id).sort((a, b) => a.start - b.start); }

  function normNote(t, n) {
    let p = n.p ?? n.note ?? n.pitch ?? n.voice;
    if (t.kind === 'drums') { const v = T.voiceName(p); if (!v) throw new Error(`“${p}” isn’t a drum voice. Voices: ${T.DRUM_VOICES.join(', ')}.`); p = v; }
    else p = clamp(T.noteToMidi(p), 0, 127);
    const tt = +(n.t ?? n.beat ?? n.time ?? 0); const d = +(n.d ?? n.length ?? n.dur ?? (t.kind === 'drums' ? 0.25 : 1)); let v = n.v ?? n.velocity ?? 0.8; v = +v > 1 ? +v / 127 : +v;
    if (!isFinite(tt) || tt < 0) throw new Error('Note times are beats from the start of the clip (0 or more).');
    return { p, t: r4(tt), d: r4(Math.max(0.01, d)), v: clamp(r4(v), 0.02, 1) };
  }
  function addMidiClip(s, { track, start = 0, length, name, notes = [], replace = false, color } = {}) {
    const t = findTrack(s, track); if (t.kind === 'audio') throw new Error(`“${t.name}” is an audio track. Notes go on instrument or drum tracks.`);
    const ns = notes.map((n) => normNote(t, n)).sort((a, b) => a.t - b.t || (a.p > b.p ? 1 : -1));
    const L = length ? +length : Math.max(bpb(s), Math.ceil((ns.reduce((m, n) => Math.max(m, n.t + n.d), 0) - 1e-6) / bpb(s)) * bpb(s));
    if (replace) s.clips = s.clips.filter((c) => !(c.track === t.id && c.start < start + L - 1e-6 && clipEnd(s, c) > start + 1e-6 && !isAudio(c)));
    const c = { id: uid('c'), track: t.id, start: r4(start), length: r4(L), name: name || (t.kind === 'drums' ? 'Beat' : 'Notes'), notes: ns.filter((n) => n.t < L - 1e-6) };
    if (color) c.color = color;
    s.clips.push(c); fitBars(s); return c;
  }
  function setNotes(s, clipRef, notes, { merge = false } = {}) { const c = findClip(s, clipRef); if (isAudio(c)) throw new Error('That’s an audio clip.'); const t = findTrack(s, c.track); const ns = notes.map((n) => normNote(t, n)); c.notes = (merge ? [...c.notes, ...ns] : ns).sort((a, b) => a.t - b.t); return c; }
  function addAudioClip(s, { track, start = 0, file, srcDur, name, offset = 0, dur, info } = {}) {
    const t = findTrack(s, track); if (t.kind !== 'audio') throw new Error(`“${t.name}” isn’t an audio track.`);
    const c = { id: uid('c'), track: t.id, start: r4(start), name: name || file.replace(/\.[^.]+$/, ''), file, srcDur: +srcDur, offset: +offset, dur: +(dur || srcDur - offset), gain: 0, fadeIn: 0.005, fadeOut: 0.01, reverse: false, pitch: 0, stretch: 1, speed: 1 };
    if (info) c.info = info; s.clips.push(c); fitBars(s); return c;
  }
  function updateClip(s, ref, p) {
    const c = findClip(s, ref);
    if (p.name != null) c.name = String(p.name).slice(0, 60);
    if (p.start != null) c.start = Math.max(0, r4(+p.start));
    if (p.track != null) { const t = findTrack(s, p.track); const from = findTrack(s, c.track); if ((t.kind === 'audio') !== isAudio(c)) throw new Error('Audio clips go on audio tracks and note clips on instrument/drum tracks.'); if (t.kind !== from.kind && !isAudio(c) && (t.kind === 'drums' || from.kind === 'drums')) throw new Error('Drum clips stay on drum tracks.'); c.track = t.id; }
    if (p.color != null) c.color = p.color;
    if (!isAudio(c)) { if (p.length != null) { c.length = Math.max(0.25, r4(+p.length)); c.notes = c.notes.filter((n) => n.t < c.length - 1e-6); } if (p.transpose) { const t = findTrack(s, c.track); if (t.kind !== 'drums') c.notes.forEach((n) => { n.p = clamp(n.p + Math.round(p.transpose), 0, 127); }); } if (p.velocity != null) c.notes.forEach((n) => { n.v = clamp(n.v * +p.velocity, 0.02, 1); }); }
    else {
      for (const k of ['gain', 'fadeIn', 'fadeOut', 'pitch', 'stretch', 'speed']) if (p[k] != null) c[k] = +p[k];
      if (p.reverse != null) c.reverse = !!p.reverse;
      c.gain = clamp(c.gain, -60, 24); c.pitch = clamp(c.pitch, -24, 24); c.stretch = clamp(c.stretch || 1, 0.25, 4); c.speed = clamp(c.speed || 1, 0.25, 4);
      if (p.trimStart != null) { const ns = clamp(+p.trimStart, 0, c.offset + c.dur - 0.02); const end = c.offset + c.dur; const moved = ns - c.offset; c.offset = ns; c.dur = end - ns; c.start = Math.max(0, r4(c.start + (moved * (c.stretch || 1)) / (c.speed || 1) / spb(s))); }
      if (p.offset != null) c.offset = clamp(+p.offset, 0, c.srcDur - 0.02);
      if (p.dur != null) c.dur = +p.dur;
      c.dur = clamp(c.dur, 0.02, c.srcDur - c.offset); c.fadeIn = clamp(c.fadeIn, 0, c.dur / 2); c.fadeOut = clamp(c.fadeOut, 0, c.dur / 2);
    }
    fitBars(s); return c;
  }
  function removeClip(s, ref) { const c = findClip(s, ref); s.clips = s.clips.filter((x) => x !== c); return c; }
  // cut the part of a clip that falls between beats b0 and b1 into a new clip (not added)
  function slice(s, c, b0, b1) {
    const st = Math.max(b0, c.start), en = Math.min(b1, clipEnd(s, c)); if (en - st < 1e-4) return null;
    const n = JSON.parse(JSON.stringify(c)); n.id = uid('c'); n.start = r4(st);
    if (isAudio(c)) { const rate = (c.stretch || 1) / (c.speed || 1); const srcPerBeat = spb(s) / rate; if (c.reverse) { const tailCut = (clipEnd(s, c) - en) * srcPerBeat; n.offset = c.offset + tailCut; } else n.offset = c.offset + (st - c.start) * srcPerBeat; n.dur = (en - st) * srcPerBeat; if (st > c.start + 1e-4) n.fadeIn = Math.min(0.005, n.dur / 2); if (en < clipEnd(s, c) - 1e-4) n.fadeOut = Math.min(0.01, n.dur / 2); }
    else { const off = st - c.start; n.length = r4(en - st); n.notes = c.notes.filter((x) => x.t >= off - 1e-6 && x.t < off + n.length - 1e-6).map((x) => ({ ...x, t: r4(x.t - off), d: r4(Math.min(x.d, off + n.length - x.t)) })); }
    return n;
  }
  function splitClip(s, ref, atBeat) { const c = findClip(s, ref); if (atBeat <= c.start + 1e-4 || atBeat >= clipEnd(s, c) - 1e-4) throw new Error('Split point is outside the clip.'); const a = slice(s, c, c.start, atBeat), b = slice(s, c, atBeat, clipEnd(s, c)); a.id = c.id; a.name = c.name; b.name = c.name; s.clips.splice(s.clips.indexOf(c), 1, a, b); return [a, b]; }
  function duplicateClip(s, ref, toBeat, times = 1) { const c = findClip(s, ref); const out = []; const L = clipLength(s, c); for (let i = 0; i < times; i++) { const n = JSON.parse(JSON.stringify(c)); n.id = uid('c'); n.start = r4(toBeat == null ? c.start + L * (i + 1) : toBeat + L * i); s.clips.push(n); out.push(n); } fitBars(s); return out; }

  // ───── sections (bars): copy, insert empty, delete (shifting what comes after)
  function trackFilter(s, tracks) { if (!tracks || !tracks.length) return () => true; const ids = new Set(tracks.map((r) => findTrack(s, r).id)); return (c) => ids.has(c.track); }
  function copySection(s, { fromBar, bars, toBar, tracks, times = 1 }) {
    const B = bpb(s), b0 = barToBeat(s, fromBar), b1 = b0 + bars * B; const ok = trackFilter(s, tracks); const made = [];
    for (let k = 0; k < times; k++) { const dest = barToBeat(s, toBar) + k * bars * B; const shift = dest - b0;
      // clear the destination on those tracks first
      clearRange(s, dest, dest + bars * B, ok);
      for (const c of s.clips.filter((x) => ok(x) && x.start < b1 - 1e-6 && clipEnd(s, x) > b0 + 1e-6 && !made.includes(x))) { const n = slice(s, c, b0, b1); if (n) { n.start = r4(n.start + shift); s.clips.push(n); made.push(n); } } }
    fitBars(s); return made;
  }
  function clearRange(s, b0, b1, ok = () => true) {
    const keep = [];
    for (const c of s.clips) { if (!ok(c) || clipEnd(s, c) <= b0 + 1e-6 || c.start >= b1 - 1e-6) { keep.push(c); continue; } const a = slice(s, c, c.start, b0), b = slice(s, c, b1, clipEnd(s, c)); if (a) { a.id = c.id; keep.push(a); } if (b) keep.push(b); }
    s.clips = keep;
  }
  function deleteSection(s, { fromBar, bars }) { const B = bpb(s), b0 = barToBeat(s, fromBar), b1 = b0 + bars * B; clearRange(s, b0, b1); for (const c of s.clips) if (c.start >= b1 - 1e-6) c.start = r4(c.start - bars * B); for (const t of s.tracks) shiftAuto(t, b0, -bars * B, b1); s.bars = Math.max(1, s.bars - bars); fitBars(s); }
  function insertBars(s, { atBar, bars }) { const B = bpb(s), b0 = barToBeat(s, atBar); for (const c of s.clips.slice()) { if (c.start < b0 - 1e-6 && clipEnd(s, c) > b0 + 1e-6) { const [, b] = splitClip(s, c.id, b0); b.start = r4(b.start + bars * B); } else if (c.start >= b0 - 1e-6) c.start = r4(c.start + bars * B); } for (const t of s.tracks) shiftAuto(t, b0, bars * B); s.bars += bars; fitBars(s); }
  function shiftAuto(t, b0, by, cutEnd) { for (const k of Object.keys(t.automation || {})) t.automation[k] = t.automation[k].filter(([b]) => !(cutEnd != null && b >= b0 && b < cutEnd)).map(([b, v]) => [b >= b0 ? r4(b + by) : b, v]); }

  // automation: { volume: [[beat, dB]], pan: [[beat, -1..1]], cutoff: [[beat, Hz]] } — straight lines between points
  const AUTO = { volume: [-60, 12], pan: [-1, 1], cutoff: [20, 20000] };
  function setAutomation(s, ref, param, points) { const t = findTrack(s, ref); if (!AUTO[param]) throw new Error(`Automate volume, pan or cutoff (the first filter/EQ on the track).`); t.automation = t.automation || {}; if (!points || !points.length) delete t.automation[param]; else t.automation[param] = points.map(([b, v]) => [r4(+b), clamp(+v, AUTO[param][0], AUTO[param][1])]).sort((a, b) => a[0] - b[0]); return t; }
  function autoValue(points, beat) { if (!points || !points.length) return null; if (beat <= points[0][0]) return points[0][1]; for (let i = 1; i < points.length; i++) if (beat <= points[i][0]) { const [b0, v0] = points[i - 1], [b1, v1] = points[i]; return v0 + ((v1 - v0) * (beat - b0)) / Math.max(1e-6, b1 - b0); } return points[points.length - 1][1]; }

  // ───── 8-bit: a console-style channel set, and turning an existing song into one
  function chipTemplate(s, { console: con = 'nes' } = {}) {
    const gb = con === 'gameboy' || con === 'gb';
    const made = [
      addTrack(s, { kind: 'instrument', sound: 'nes-pulse-25', name: 'Pulse 1 (lead)', effects: [] }),
      addTrack(s, { kind: 'instrument', sound: gb ? 'gb-chord' : 'chip-chord', name: 'Pulse 2 (chords)', effects: [], volume: -4 }),
      addTrack(s, { kind: 'instrument', sound: gb ? 'gb-wave' : 'nes-triangle', name: gb ? 'Wave (bass)' : 'Triangle (bass)', effects: [] }),
      addTrack(s, { kind: 'drums', sound: gb ? 'gameboy' : 'nes', name: 'Noise (drums)', effects: [] }),
    ];
    return made;
  }
  function chipify(s, { console: con = 'nes', crush = false, keepEffects = false } = {}) {
    const gb = con === 'gameboy' || con === 'gb'; const changes = []; let leads = 0;
    for (const t of s.tracks) {
      if (t.kind === 'audio') { changes.push({ track: t.name, kept: 'audio (unchanged)' }); continue; }
      const before = t.sound; let to;
      if (t.kind === 'drums') to = gb ? 'gameboy' : 'nes';
      else {
        const P = SND.instrument(t.sound) || {}; const ns = s.clips.filter((c) => c.track === t.id && !c.file).flatMap((c) => c.notes.map((n) => ({ p: n.p, t: c.start + n.t }))); const avg = ns.length ? ns.reduce((a, n) => a + n.p, 0) / ns.length : 60;
        const chordy = ns.length > 3 && ns.filter((n, i) => ns.some((m, j) => j !== i && Math.abs(m.t - n.t) < 1e-3)).length > ns.length * 0.4;
        if (P.cat === 'Chip') to = t.sound; else if (P.cat === 'FX') to = 'chip-noise'; else if (P.cat === 'Bass' || avg < 50) to = gb ? 'gb-wave' : 'nes-triangle'; else if (chordy) to = gb ? 'gb-chord' : 'chip-chord'; else to = ['nes-pulse-25', 'nes-pulse-12', 'nes-square'][leads++ % 3];
      }
      t.sound = to; if (!keepEffects) t.effects = t.effects.filter((f) => !['reverb', 'chorus', 'width'].includes(f.type));
      changes.push({ track: t.name, from: before, to });
    }
    if (crush && !s.master.effects.some((f) => f.type === 'crush')) addEffect(s, 'master', { type: 'crush', bits: 8, rate: gb ? 16384 : 22050, mix: 1 });
    return changes;
  }

  // ───── a readable summary for Claude and the window
  function summary(s, { notes = false, track = null } = {}) {
    const B = bpb(s);
    const tracks = s.tracks.filter((t) => !track || t === findTrack(s, track)).map((t, i) => {
      const cl = s.clips.filter((c) => c.track === t.id).sort((a, b) => a.start - b.start);
      return {
        n: s.tracks.indexOf(t) + 1, id: t.id, name: t.name, kind: t.kind, sound: t.sound, volume_db: t.volume, pan: t.pan, mute: t.mute || undefined, solo: t.solo || undefined,
        effects: t.effects.map((f) => fxBrief(f)), automation: Object.keys(t.automation || {}).length ? t.automation : undefined,
        clips: cl.map((c) => ({ id: c.id, name: c.name, bar: +beatToBar(s, c.start).toFixed(3), bars: +(clipLength(s, c) / B).toFixed(3), ...(isAudio(c) ? { file: c.file, seconds: +((c.dur * (c.stretch || 1)) / (c.speed || 1)).toFixed(2), offset: +c.offset.toFixed(3), gain_db: c.gain, pitch: c.pitch || undefined, stretch: c.stretch !== 1 ? c.stretch : undefined, speed: c.speed !== 1 ? c.speed : undefined, reverse: c.reverse || undefined, fade_in: c.fadeIn, fade_out: c.fadeOut, info: c.info } : { notes: notes ? c.notes.map((n) => ({ p: t.kind === 'drums' ? n.p : T.midiToName(n.p), t: n.t, d: n.d, v: n.v })) : c.notes.length, range: !notes && t.kind !== 'drums' && c.notes.length ? `${T.midiToName(Math.min(...c.notes.map((n) => n.p)))}–${T.midiToName(Math.max(...c.notes.map((n) => n.p)))}` : undefined }) })),
      };
    });
    return { name: s.name, bpm: s.bpm, key: s.key, time_signature: `${s.timeSig[0]}/${s.timeSig[1]}`, bars: s.bars, length_seconds: +(songEnd(s) * spb(s)).toFixed(2), loop: s.loop.on ? { from_bar: beatToBar(s, s.loop.start), to_bar: beatToBar(s, s.loop.end) } : undefined, markers: s.markers.length ? s.markers.map((m) => ({ bar: beatToBar(s, m.beat), name: m.name })) : undefined, master: { volume_db: s.master.volume, effects: s.master.effects.map(fxBrief) }, tracks };
  }
  function fxBrief(f) { const o = { id: f.id, type: f.type }; if (!f.on) o.on = false; const spec = SND.EFFECTS[f.type].params; for (const k of Object.keys(spec)) if (f[k] !== spec[k][2]) o[k] = f[k]; return o; }

  return { chipTemplate, chipify, uid, newSong, hydrate, bpb, spb, barToBeat, beatToBar, fmtPos, findTrack, addTrack, updateTrack, removeTrack, fxList, addEffect, updateEffect, removeEffect, findEffect, isAudio, clipLength, clipEnd, songEnd, fitBars, findClip, clipsOn, addMidiClip, setNotes, addAudioClip, updateClip, removeClip, slice, splitClip, duplicateClip, copySection, clearRange, deleteSection, insertBars, setAutomation, autoValue, summary, normNote, AUTO };
});
