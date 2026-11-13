// Mixer — what each plugin tool does. Shared by the MCP bridge (Claude Desktop, Claude Code, Codex, Ask) and the window
// (import and export use the same code). Every edit goes through the song's history, so the user can undo Claude.
'use strict';
const fs = require('fs');
const path = require('path');
const SG = require('./core/song');
const SND = require('./core/sounds');
const T = require('./core/theory');
const X = require('./core/sfx');
const { exportPack, hydrate: hydrateSfx } = require('./sfxlib');

function makeHandlers({ lib, active, setActive, engine, changed, activity, transport, settings, sfx, sfxChanged = () => {}, sfxPlay = () => {}, setSetting = () => {} }) {
  const text = (o) => ({ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o, null, 1) });
  const img = (u) => (u ? { type: 'image', data: String(u).split(',')[1], mimeType: 'image/png' } : null);
  const ok = (o, ...pics) => ({ content: [text(o), ...pics.map(img).filter(Boolean)] });
  const who = (by) => (!by || by === 'you' ? 'you' : by);
  function edit(by, label, fn) { const p = active(); const r = p.edit(fn, { label, by: who(by) }); changed(who(by), label); if (by && by !== 'you') activity(label); return r; }
  const song = () => active().song;
  const bar = (b, d = 1) => (b == null ? d : Math.max(1, +b));
  async function pic(kind, extra = {}) { try { const r = await engine.job('picture', { song: song(), kind, ...extra }, { timeout: 120 }); return r.picture; } catch (e) { return null; } }
  const parseSig = (s) => { const m = /^(\d+)\s*\/\s*(\d+)$/.exec(String(s || '')); if (!m) throw new Error('Time signature looks like "4/4" or "6/8".'); return [+m[1], +m[2]]; };

  // shared with the window
  async function importAudio(file, opts = {}, by = 'you') {
    const p = active(); const rel = p.importAudio(file); const pr = await engine.job('probe', { file: rel, name: path.basename(file), picture: opts.picture !== false }, { timeout: 300 });
    const R = pr.report; const info = { bpm: R.tempo && R.tempo.bpm, key: R.key && R.key.key, lufs: R.loudness_lufs, seconds: +pr.seconds.toFixed(2) };
    const clip = edit(by, `Imported ${path.basename(file)}`, (s) => {
      let t = opts.track ? SG.findTrack(s, opts.track) : null; if (t && t.kind !== 'audio') throw new Error(`“${t.name}” isn’t an audio track.`); if (!t) t = SG.addTrack(s, { kind: 'audio', name: path.basename(file).replace(/\.[^.]+$/, '').slice(0, 40) });
      if (opts.adoptTempo && info.bpm && s.clips.length === 0) { s.bpm = Math.round(info.bpm * 10) / 10; if (info.key) { try { s.key = T.parseKey(info.key).name; } catch {} } }
      const c = SG.addAudioClip(s, { track: t.id, start: opts.atBeat || 0, file: rel, srcDur: pr.seconds, info });
      if (opts.fitTempo && info.bpm) { c.stretch = fitRatio(info.bpm, s.bpm); }
      SG.fitBars(s); return c;
    });
    return { clip, info, report: R, picture: pr.picture };
  }
  function fitRatio(fileBpm, songBpm) { const cands = [fileBpm, fileBpm * 2, fileBpm / 2].map((b) => b / songBpm); return +cands.sort((a, b) => Math.abs(Math.log(a)) - Math.abs(Math.log(b)))[0].toFixed(4); }
  async function exportSong(a = {}) {
    const p = active(); let dest = a.folder || a.dest || p.outDir('exports'); fs.mkdirSync(dest, { recursive: true });
    const st = settings ? settings() : {};
    const r = await engine.job('export', { song: p.song, format: a.format || st.exportFormat || 'wav', name: a.name, normalize: a.normalize_lufs ?? a.normalize ?? null, stems: !!(a.stems || a.stems_only), stemsOnly: !!a.stems_only, fromBar: a.from_bar ?? a.fromBar, bars: a.bars, bits: a.bits || st.exportBits || 24, kbps: a.kbps || st.exportKbps || 320, sr: a.sample_rate || a.sr || st.exportRate || 44100 }, { timeout: 900 });
    const files = [];
    for (const f of r.files) { const safe = f.name.replace(/[\\/:*?"<>|]/g, '-'); let out = path.join(dest, safe), i = 2; while (fs.existsSync(out) && !a.overwrite) out = path.join(dest, safe.replace(/(\.[^.]+)$/, ` ${i++}$1`)); fs.writeFileSync(out, Buffer.from(f.bytes)); files.push(out); }
    return { files, loudness_lufs: r.loudness_lufs, peak_dbfs: r.peak_dbfs, seconds: r.seconds, normalized: r.normalized, folder: dest };
  }

  const H = {
    mixer_guide: () => ok(guide()),
    async get_song(a) { const s = SG.summary(song(), { notes: !!a.notes, track: a.track || null }); return ok({ song_id: active().id, ...s }, a.picture === false ? null : await pic('arrangement')); },
    list_songs() { return ok({ open: active().id, songs: lib.list().map((x) => ({ id: x.id, name: x.name, bpm: x.bpm, key: x.key, bars: x.bars, tracks: x.tracks })) }); },
    async new_song(a, by) { const tpl = String(a.template || '').toLowerCase(); const chip = /chip|nes|8|game ?boy|gb/.test(tpl); const p = lib.create({ name: a.name || 'Untitled song', bpm: a.bpm || (chip ? 140 : 120), key: a.key || 'C major', timeSig: a.time_signature ? parseSig(a.time_signature) : [4, 4], bars: a.bars || 16 }); if (chip) p.edit((x) => { SG.chipTemplate(x, { console: /game ?boy|gb/.test(tpl) ? 'gameboy' : 'nes' }); }, { label: '8-bit channels', by: who(by) }); setActive(p.id); if (by && by !== 'you') activity(`Started “${p.name}”`); return ok({ opened: p.id, ...SG.summary(p.song) }); },
    open_song(a) { const p = setActive(lib.get(a.song).id); return ok({ opened: p.id, ...SG.summary(p.song) }); },
    set_song(a, by) {
      edit(by, 'Song settings', (s) => {
        if (a.name) s.name = String(a.name).slice(0, 80); if (a.bpm) s.bpm = Math.max(30, Math.min(300, +a.bpm)); if (a.key) s.key = T.parseKey(a.key).name; if (a.time_signature) s.timeSig = parseSig(a.time_signature); if (a.bars) s.bars = Math.max(1, Math.round(+a.bars));
        if (a.loop === false) s.loop.on = false; else if (a.loop && typeof a.loop === 'object') { s.loop = { on: true, start: SG.barToBeat(s, bar(a.loop.from_bar)), end: SG.barToBeat(s, bar(a.loop.to_bar, bar(a.loop.from_bar) + 4)) }; if (s.loop.end <= s.loop.start) throw new Error('Loop to_bar must be after from_bar.'); }
        if (Array.isArray(a.markers)) s.markers = a.markers.map((m) => ({ beat: SG.barToBeat(s, bar(m.bar)), name: String(m.name || '').slice(0, 30) })).sort((x, y) => x.beat - y.beat);
      });
      const s = song(); return ok({ name: s.name, bpm: s.bpm, key: s.key, time_signature: s.timeSig.join('/'), bars: s.bars, loop: s.loop.on ? { from_bar: SG.beatToBar(s, s.loop.start), to_bar: SG.beatToBar(s, s.loop.end) } : false, markers: s.markers.map((m) => ({ bar: SG.beatToBar(s, m.beat), name: m.name })) });
    },
    list_sounds(a) {
      const k = (a.kind || 'all').toLowerCase(); const o = {};
      if (k === 'all' || k.startsWith('instr')) { o.instruments = {}; for (const c of SND.CATS) o.instruments[c] = SND.INSTRUMENTS.filter((i) => i.cat === c).map((i) => ({ id: i.id, name: i.name, about: i.desc, mono: i.mono || undefined })); }
      if (k === 'all' || k.startsWith('drum') || k === 'kits') { o.drum_kits = SND.KITS.map((x) => ({ id: x.id, name: x.name, about: x.desc })); o.drum_voices = T.DRUM_VOICES; }
      if (k === 'all' || k.startsWith('eff') || k === 'fx') o.effects = Object.fromEntries(Object.entries(SND.EFFECTS).map(([id, e]) => [id, { about: e.desc, settings: Object.fromEntries(Object.entries(e.params).map(([p, v]) => [p, typeof v[2] === 'string' ? `${v[3]} (default ${JSON.stringify(v[2])})` : `${v[0]}–${v[1]} ${v[3]} (default ${v[2]})`])) }]));
      if (k === 'all' || k.startsWith('rhy')) o.rhythms = Object.fromEntries(Object.entries(T.RHYTHMS).map(([x, v]) => [x, v.desc]));
      if (k === 'all' || k.startsWith('groo') || k === 'styles') o.grooves = Object.fromEntries(Object.entries(T.GROOVES).map(([x, v]) => [x, v.desc]));
      return ok(o);
    },
    add_track(a, by) { const t = edit(by, `Added track ${a.name || a.sound || a.kind}`, (s) => SG.addTrack(s, { kind: a.kind || 'instrument', sound: a.sound, name: a.name, volume: a.volume_db, pan: a.pan, effects: a.effects })); return ok({ added: { n: song().tracks.findIndex((x) => x.id === t.id) + 1, id: t.id, name: t.name, kind: t.kind, sound: t.sound, effects: t.effects.map((f) => f.type) } }); },
    edit_track(a, by) {
      if (a.remove) { const t = edit(by, `Removed track ${a.track}`, (s) => SG.removeTrack(s, a.track)); return ok({ removed: t.name }); }
      const t = edit(by, `Changed track ${a.track}`, (s) => SG.updateTrack(s, a.track, { name: a.name, sound: a.sound, volume: a.volume_db, pan: a.pan, mute: a.mute, solo: a.solo, octave: a.octave, color: a.color, index: a.index != null ? a.index - 1 : undefined }));
      return ok(SG.summary(song(), { track: t.id }).tracks[0]);
    },
    set_effects(a, by) {
      const tgt = !a.target || /^master$/i.test(a.target) ? 'master' : a.target; let label = `Effects on ${tgt}`; const warn = [];
      const check = (f) => { const spec = SND.EFFECTS[f.type]; if (!spec) throw new Error(`Unknown effect “${f.type}”. Effects: ${Object.keys(SND.EFFECTS).join(', ')}.`); for (const k of Object.keys(f)) if (!['type', 'on', 'id'].includes(k) && !(k in spec.params)) warn.push(`${f.type} has no setting “${k}” (ignored).`); return f; };
      edit(by, label, (s) => {
        if (tgt !== 'master') SG.findTrack(s, tgt);
        if (Array.isArray(a.effects)) { const list = a.effects.map((f) => check(typeof f === 'string' ? { type: f } : f)); if (tgt === 'master') s.master.effects = []; else SG.updateTrack(s, tgt, { effects: [] }); for (const f of list) SG.addEffect(s, tgt, f, SG.fxList(s, tgt).length); }
        if (a.add) SG.addEffect(s, tgt, check(a.add));
        if (a.update) { const { effect, ...patch } = a.update; SG.updateEffect(s, tgt, effect, patch); }
        if (a.remove != null) SG.removeEffect(s, tgt, a.remove);
      });
      const s = song(); const list = tgt === 'master' ? s.master.effects : SG.findTrack(s, tgt).effects;
      return ok({ target: tgt, effects: list.map((f, i) => ({ n: i + 1, ...brief(f) })), warnings: warn.length ? warn : undefined });
    },
    async write_notes(a, by) {
      const s0 = song(); const t0 = SG.findTrack(s0, a.track); const notes = (a.notes || []).map((n) => ({ p: n.note ?? n.p ?? n.pitch ?? n.voice, t: n.beat ?? n.t ?? 0, d: n.length ?? n.d, v: n.velocity ?? n.v }));
      let c;
      if (a.clip) c = edit(by, `Rewrote notes in ${t0.name}`, (s) => SG.setNotes(s, a.clip, notes, { merge: !!a.merge }));
      else c = edit(by, `Wrote ${notes.length} notes on ${t0.name}`, (s) => SG.addMidiClip(s, { track: t0.id, start: SG.barToBeat(s, bar(a.start_bar)), length: a.bars ? a.bars * SG.bpb(s) : null, notes, name: a.name, replace: a.replace !== false }));
      return clipResult(c);
    },
    async write_chords(a, by) {
      const s0 = song(); const t0 = SG.findTrack(s0, a.track); if (t0.kind !== 'instrument') throw new Error(`“${t0.name}” is a ${t0.kind} track; chords go on an instrument track.`);
      const rhythm = a.rhythm || 'block'; const isBass = /^bass/.test(rhythm); const B = SG.bpb(s0);
      const one = T.chordNotes(a.progression, s0.key, { beatsPerChord: a.beats_per_chord || B, rhythm, octave: a.octave ?? (isBass ? 2 : 4), velocity: a.velocity ?? (isBass ? 0.85 : 0.72), spread: !!a.spread, size: a.size || 0, humanize: a.humanize || 0 });
      const reps = Math.max(1, Math.round(a.repeat || 1)); const notes = []; for (let r = 0; r < reps; r++) for (const n of one.notes) notes.push({ ...n, t: n.t + r * one.length });
      const c = edit(by, `Wrote ${one.chords.join(' ')} on ${t0.name}`, (s) => SG.addMidiClip(s, { track: t0.id, start: SG.barToBeat(s, bar(a.start_bar)), length: one.length * reps, notes, name: a.name || one.chords.join(' '), replace: a.replace !== false }));
      const r = await clipResult(c); r.content[0] = text({ chords: one.chords, rhythm, ...JSON.parse(r.content[0].text) }); return r;
    },
    async write_drums(a, by) {
      const s0 = song(); const t0 = SG.findTrack(s0, a.track); if (t0.kind !== 'drums') throw new Error(`“${t0.name}” isn’t a drum track. Add one with add_track kind "drums".`);
      const B = SG.bpb(s0); const spb = a.steps_per_bar || Math.round(B * 4); const G = a.style ? T.GROOVES[String(a.style).toLowerCase().replace(/\s+/g, '-')] : null; if (a.style && !G) throw new Error(`No groove “${a.style}”. Grooves: ${Object.keys(T.GROOVES).join(', ')}.`);
      const pats = { ...(G ? G.p : {}), ...(a.pattern || {}) }; if (!Object.keys(pats).length) throw new Error('Give a pattern (voice → "x...x...") or a style.');
      const swing = a.swing ?? (G && G.swing) ?? 0.5; const parsed = {}; let patBeats = 0;
      for (const [v, str] of Object.entries(pats)) { const vn = T.voiceName(v); if (!vn) throw new Error(`“${v}” isn’t a drum voice. Voices: ${T.DRUM_VOICES.join(', ')}.`); const p = T.parsePattern(str, { stepsPerBar: spb, beatsPerBar: B }); parsed[vn] = p; patBeats = Math.max(patBeats, p.beats); }
      const total = (a.bars ? a.bars * B : Math.ceil(patBeats / B - 1e-6) * B); const notes = []; const h = Math.max(0, Math.min(1, +a.humanize || 0));
      for (const [v, p] of Object.entries(parsed)) for (let off = 0; off < total - 1e-6; off += p.beats) for (const x of p.hits) { const t = off + x.t; if (t >= total - 1e-6) continue; notes.push({ p: v, t: T.swingTime(t, swing), v: x.v, d: 0.25 }); }
      if (a.fill) {
        const fs = total - 2; for (let i = notes.length - 1; i >= 0; i--) if (notes[i].t >= fs - 1e-6 && ['snare', 'hat', 'openhat', 'clap', 'ride'].includes(notes[i].p)) notes.splice(i, 1);
        for (let k = 0; k < 8; k++) { const t = fs + k * 0.25; notes.push({ p: k < 4 ? 'snare' : k < 6 ? 'tom_mid' : 'tom_low', t, v: 0.45 + k * 0.07, d: 0.25 }); }
        notes.push({ p: 'crash', t: 0, v: 0.9, d: 1 });
      }
      if (h) for (const n of notes) { if (n.t > 0) n.t = Math.max(0, n.t + (Math.random() - 0.5) * 0.03 * h); n.v = Math.max(0.05, Math.min(1, n.v + (Math.random() - 0.5) * 0.18 * h)); }
      const c = edit(by, `Wrote ${a.style || 'drums'} on ${t0.name}`, (s) => SG.addMidiClip(s, { track: t0.id, start: SG.barToBeat(s, bar(a.start_bar)), length: total, notes, name: a.name || (a.style ? a.style : 'Beat'), replace: a.replace !== false }));
      return clipResult(c);
    },
    async edit_clip(a, by) {
      const s0 = song(); const c0 = SG.findClip(s0, a.clip); let label = `Edited clip ${c0.name}`; let result;
      if (a.remove) { edit(by, `Removed clip ${c0.name}`, (s) => SG.removeClip(s, c0.id)); return ok({ removed: c0.id }); }
      result = edit(by, label, (s) => {
        let c = SG.findClip(s, c0.id); const out = { clip: c.id };
        const patch = {};
        if (a.move_to_bar != null) patch.start = SG.barToBeat(s, bar(a.move_to_bar)); if (a.to_track) patch.track = a.to_track; if (a.name) patch.name = a.name;
        if (a.length_bars) patch.length = a.length_bars * SG.bpb(s); if (a.transpose) patch.transpose = a.transpose; if (a.velocity_scale) patch.velocity = a.velocity_scale;
        if (a.gain_db != null) patch.gain = a.gain_db; if (a.fade_in != null) patch.fadeIn = a.fade_in; if (a.fade_out != null) patch.fadeOut = a.fade_out; if (a.reverse != null) patch.reverse = a.reverse;
        if (a.pitch != null) patch.pitch = a.pitch; if (a.stretch != null) patch.stretch = a.stretch; if (a.speed != null) patch.speed = a.speed;
        if (a.fit_tempo) { const b = c.info && c.info.bpm; if (!b) throw new Error('This clip has no detected tempo. Set stretch yourself (song BPM ÷ clip BPM = speed; stretch = 1 / that).'); patch.stretch = fitRatio(b, s.bpm); out.stretch = patch.stretch; }
        if (a.trim_start) { if (!c.file) throw new Error('trim_start is for audio clips; use length_bars or split for notes.'); patch.trimStart = c.offset + +a.trim_start; }
        if (a.trim_end) { if (!c.file) throw new Error('trim_end is for audio clips.'); patch.dur = Math.max(0.05, c.dur - (+a.trim_end) - (a.trim_start ? +a.trim_start : 0)); }
        if (Object.keys(patch).length) SG.updateClip(s, c.id, patch);
        if (a.split_at_bar) { const [x, y] = SG.splitClip(s, c.id, SG.barToBeat(s, a.split_at_bar)); out.split = [x.id, y.id]; c = x; }
        if (a.duplicate || a.duplicate_to_bar) { const d = SG.duplicateClip(s, c.id, a.duplicate_to_bar ? SG.barToBeat(s, a.duplicate_to_bar) : null, Math.max(1, Math.round(a.duplicate || 1))); out.copies = d.map((x) => ({ id: x.id, bar: SG.beatToBar(s, x.start) })); }
        return out;
      });
      const s = song(); const c = SG.findClip(s, result.clip, { must: false }); const t = c ? SG.findTrack(s, c.track) : null;
      return ok({ ...result, now: c ? SG.summary(s, { track: t.id }).tracks[0].clips.find((x) => x.id === c.id) : undefined });
    },
    async arrange(a, by) {
      const act = String(a.action || '').toLowerCase(); const n = Math.max(1, Math.round(+a.bars || 0)); if (!n) throw new Error('bars is required.');
      edit(by, act === 'copy' ? `Copied bars ${bar(a.from_bar)}–${bar(a.from_bar) + n - 1} to bar ${bar(a.to_bar, bar(a.from_bar) + n)}` : act === 'delete' ? `Deleted bars ${bar(a.from_bar)}–${bar(a.from_bar) + n - 1}` : act === 'insert' ? `Inserted ${n} bars at bar ${bar(a.to_bar ?? a.from_bar)}` : `Cleared bars ${bar(a.from_bar)}–${bar(a.from_bar) + n - 1}`, (s) => {
        if (act === 'copy') SG.copySection(s, { fromBar: bar(a.from_bar), bars: n, toBar: bar(a.to_bar, bar(a.from_bar) + n), tracks: a.tracks, times: Math.max(1, Math.round(a.times || 1)) });
        else if (act === 'delete') SG.deleteSection(s, { fromBar: bar(a.from_bar), bars: n });
        else if (act === 'insert') SG.insertBars(s, { atBar: bar(a.to_bar ?? a.from_bar), bars: n });
        else if (act === 'clear') { const b0 = SG.barToBeat(s, bar(a.from_bar)); const ids = a.tracks && a.tracks.length ? new Set(a.tracks.map((r) => SG.findTrack(s, r).id)) : null; SG.clearRange(s, b0, b0 + n * SG.bpb(s), ids ? (c) => ids.has(c.track) : undefined); }
        else throw new Error('action is copy, delete, insert or clear.');
      });
      return ok({ done: act, bars: song().bars }, await pic('arrangement'));
    },
    automate(a, by) {
      const t = edit(by, `Automated ${a.param} on ${a.track}`, (s) => SG.setAutomation(s, a.track, a.param, (a.points || []).map(([b, v]) => [SG.barToBeat(s, +b), +v])));
      const s = song(); return ok({ track: t.name, param: a.param, points: (t.automation[a.param] || []).map(([b, v]) => [+SG.beatToBar(s, b).toFixed(3), v]), note: a.param === 'volume' ? 'While volume automation exists it replaces the fader.' : a.param === 'cutoff' && !t.effects.some((f) => f.type === 'filter' || f.type === 'eq') ? 'This track has no filter or EQ yet — add a filter effect for the cutoff to act on.' : undefined });
    },
    async import_audio(a, by) {
      const f = path.resolve(String(a.path || '').replace(/^~(?=$|[\\/])/, require('os').homedir()));
      const r = await importAudio(f, { track: a.track, atBeat: SG.barToBeat(song(), bar(a.at_bar)), adoptTempo: !!a.adopt_tempo, fitTempo: !!a.fit_tempo }, by);
      const s = song(); const t = SG.findTrack(s, r.clip.track);
      return ok({ track: t.name, clip: r.clip.id, seconds: r.info.seconds, detected_tempo: r.report.tempo, detected_key: r.report.key && { key: r.report.key.key, confidence: r.report.key.confidence, alternatives: r.report.key.alternatives }, loudness_lufs: r.report.loudness_lufs, peak_dbfs: r.report.peak_dbfs, balance: r.report.balance, song_tempo: s.bpm, song_key: s.key, stretch: r.clip.stretch !== 1 ? r.clip.stretch : undefined, hint: r.info.bpm && Math.abs(r.info.bpm - s.bpm) > 0.5 && !a.fit_tempo ? `The file is about ${r.info.bpm} BPM and the song is ${s.bpm}. Use edit_clip fit_tempo to stretch it, or set_song bpm to match.` : undefined }, r.picture);
    },
    async analyze(a) {
      let r;
      if (a.file) { const f = path.resolve(String(a.file).replace(/^~(?=$|[\\/])/, require('os').homedir())); if (!fs.existsSync(f)) throw new Error('No file at ' + f); r = await engine.job('probe', { file: f, name: path.basename(f) }, { timeout: 300 }); r = { report: r.report, picture: r.picture }; }
      else r = await engine.job('analyze', { song: song(), target: a.target || 'mix', fromBar: a.from_bar, bars: a.bars, targetLufs: a.target_lufs, withMaster: !!a.with_master }, { timeout: 600 });
      const { chroma, ...key } = (r.report.key || {}); void chroma;
      return ok({ ...r.report, key: r.report.key ? key : undefined }, r.picture);
    },
    async view(a) {
      const k = (a.kind || 'arrangement').toLowerCase();
      if (k === 'notes') { if (!a.track) throw new Error('Which track?'); return ok({ track: a.track }, await pic('notes', { track: a.track, fromBar: a.from_bar, bars: a.bars })); }
      if (k === 'waveform') { const r = await engine.job('analyze', { song: song(), target: a.track || 'mix', fromBar: a.from_bar, bars: a.bars }, { timeout: 600 }); return ok({ loudness_lufs: r.report.loudness_lufs, peak_dbfs: r.report.peak_dbfs }, r.picture); }
      return ok({ bars: song().bars }, await pic('arrangement'));
    },
    transport(a, by) {
      if (a.action === 'stop') { transport({ action: 'stop' }); return ok('Stopped.'); }
      if (a.loop !== undefined) H.set_song({ loop: a.loop }, by);
      const s = song(); const from = SG.barToBeat(s, bar(a.from_bar, s.loop.on ? SG.beatToBar(s, s.loop.start) : 1)); transport({ action: 'play', from }); if (by && by !== 'you') activity(`Playing from bar ${SG.beatToBar(s, from)}`);
      return ok(`Playing in the Mixer window from bar ${SG.beatToBar(s, from)}${s.loop.on ? `, looping bars ${SG.beatToBar(s, s.loop.start)}–${SG.beatToBar(s, s.loop.end) - 1}` : ''}.`);
    },
    async export(a, by) { const r = await exportSong(a); if (by && by !== 'you') activity(`Exported ${r.files.map((f) => path.basename(f)).join(', ')}`); return ok(r); },
    undo(a, by) { const p = active(); const d = a.redo ? p.doRedo(a.steps || 1) : p.doUndo(a.steps || 1); changed(who(by), (a.redo ? 'Redo ' : 'Undo ') + (d[0] || '')); return ok({ [a.redo ? 'redone' : 'undone']: d, can_undo: p.undo.length, can_redo: p.redo.length }); },
  };
  // ───── game sound effects
  const packOf = (ref) => { const p = sfx.ensure(ref || (settings && settings().activeSfxPack)); setSetting({ activeSfxPack: p.id }); return p; };
  const facts = (snd) => { const d = X.describe(snd); return [`${d.seconds}s · ${d.layers} layer${d.layers > 1 ? 's' : ''}`, `${d.wave}${d.start_hz ? ` from ${d.start_hz} Hz` : ''}`, `${snd.bits < 16 ? snd.bits + '-bit ' : ''}${snd.rate < 44100 ? Math.round(snd.rate / 100) / 10 + ' kHz' : ''}`.trim()].filter(Boolean); };
  async function sfxPic(list) { try { return (await engine.job('sfx', { items: list.map((x) => ({ name: x.name, sound: x, lines: facts(x) })) }, { timeout: 60 })).picture; } catch { return null; } }
  const sfxBrief = (snd) => ({ id: snd.id, name: snd.name, kind: snd.kind, ...X.describe(snd), gain_db: snd.gain || undefined, bits: snd.bits !== 16 ? snd.bits : undefined, rate: snd.rate !== 44100 ? snd.rate : undefined, layers: snd.layers.map((L, i) => ({ n: i + 1, on: L.on === false ? false : undefined, delay: L.delay || undefined, gain_db: L.gain || undefined, pitch: L.pitch || undefined, params: Object.fromEntries(Object.entries(L.params).filter(([k, v]) => v !== X.PARAMS[k][2]).map(([k, v]) => [k, k === 'wave' ? X.WAVES[v] : +(+v).toFixed(3)])) })) });
  function applyLayer(L, o) { if (!o) return L; const n = { ...L }; if (o.kind) n.params = X.generate(o.kind, o.seed || Date.now()).layers[0].params; if (o.params) n.params = X.norm({ ...n.params, ...o.params }); for (const k of ['delay', 'gain', 'pitch', 'on', 'seed']) if (o[k] != null) n[k] = o[k]; return n; }
  Object.assign(H, {
    async make_sfx(a, by) {
      const p = packOf(a.pack); const n = Math.max(1, Math.min(8, Math.round(a.variations || 1))); const made = []; const seed0 = a.seed || (Date.now() % 1e6);
      for (let i = 0; i < n; i++) {
        let snd;
        if (a.layers && a.layers.length) snd = { kind: 'custom', layers: a.layers.map((L, k) => applyLayer({ on: true, delay: 0, gain: 0, pitch: 0, seed: k + 1, params: X.defaults() }, { ...L, seed: L.seed || seed0 + i * 101 + k })) };
        else { snd = X.generate(a.kind || 'random', seed0 + i * 7919); if (a.params) snd.layers[0].params = X.norm({ ...snd.layers[0].params, ...a.params }); }
        snd.name = p.uniqueName(a.name ? (n > 1 ? `${a.name} ${String.fromCharCode(65 + i)}` : a.name) : (X.KINDS[snd.kind] || 'Sound') + (n > 1 ? ` ${String.fromCharCode(65 + i)}` : ''));
        for (const k of ['gain', 'bits', 'rate']) if (a[k] != null) snd[k] = a[k]; if (a.retro) { snd.bits = 8; snd.rate = 22050; }
        made.push(p.upsert(snd));
      }
      sfxChanged(p.id, made[0].id, who(by)); if (by && by !== 'you') activity(`Made ${made.map((x) => x.name).join(', ')}`); if (a.play !== false) sfxPlay(p.id, made[0].id);
      return ok({ pack: p.name, sounds: made.map(sfxBrief), tip: n > 1 ? 'Variations are saved side by side; remove the ones the user doesn’t want with edit_sfx remove:true.' : undefined }, await sfxPic(made));
    },
    async edit_sfx(a, by) {
      const p = packOf(a.pack); const s0 = p.find(a.sound);
      if (a.remove) { p.remove(s0.id); sfxChanged(p.id, null, who(by)); return ok({ removed: s0.name }); }
      let snd = JSON.parse(JSON.stringify(s0));
      if (a.duplicate) { snd.id = undefined; snd.name = p.uniqueName(a.name || s0.name + ' copy'); }
      else if (a.name) snd.name = p.uniqueName(a.name) === a.name || a.name.toLowerCase() === s0.name.toLowerCase() ? a.name : p.uniqueName(a.name);
      if (a.params) snd.layers[0].params = X.norm({ ...snd.layers[0].params, ...a.params });
      if (a.layer) { const i = Math.max(0, (a.layer.n || a.layer.index || 1) - 1); if (!snd.layers[i]) throw new Error(`No layer ${i + 1}; this sound has ${snd.layers.length}.`); snd.layers[i] = applyLayer(snd.layers[i], a.layer); }
      if (a.add_layer) { if (snd.layers.length >= 4) throw new Error('Four layers at most.'); snd.layers.push(applyLayer({ on: true, delay: 0, gain: 0, pitch: 0, seed: snd.layers.length + 1, params: X.defaults() }, a.add_layer)); }
      if (a.remove_layer) { if (snd.layers.length < 2) throw new Error('A sound needs at least one layer.'); snd.layers.splice(a.remove_layer - 1, 1); }
      if (a.mutate) snd = X.mutateSound(snd, typeof a.mutate === 'number' ? a.mutate : 0.3, Date.now() % 1e6);
      for (const k of ['gain', 'bits', 'rate']) if (a[k] != null) snd[k] = a[k]; if (a.retro === true) { snd.bits = 8; snd.rate = 22050; } if (a.retro === false) { snd.bits = 16; snd.rate = 44100; }
      const saved = p.upsert(snd); sfxChanged(p.id, saved.id, who(by)); if (by && by !== 'you') activity(`${a.duplicate ? 'Copied' : 'Changed'} ${saved.name}`); if (a.play !== false) sfxPlay(p.id, saved.id);
      return ok({ pack: p.name, sound: sfxBrief(saved) }, await sfxPic([saved]));
    },
    async list_sfx(a) {
      if (a.pack === undefined && a.all) return ok({ packs: sfx.list() });
      const p = packOf(a.pack); return ok({ pack: p.name, folder: p.dir, packs: sfx.list().map((x) => x.name), sounds: p.sounds.map((x) => ({ id: x.id, name: x.name, kind: x.kind, seconds: X.describe(x).seconds, layers: x.layers.length })), kinds: X.KINDS }, a.picture && p.sounds.length ? await sfxPic(p.sounds.slice(0, 12)) : null);
    },
    new_sfx_pack(a, by) { const p = sfx.create(a.name || 'Sound pack'); setSetting({ activeSfxPack: p.id }); sfxChanged(p.id, null, who(by)); return ok({ created: p.name, folder: p.dir }); },
    play_sfx(a) { const p = packOf(a.pack); const s = p.find(a.sound); sfxPlay(p.id, s.id); return ok(`Playing “${s.name}” in Mixer.`); },
    async export_sfx(a, by) {
      const p = packOf(a.pack); const f = (a.format || 'wav').toLowerCase(); if (!['wav', 'mp3', 'js', 'all'].includes(f)) throw new Error('format is wav, mp3, js or all.');
      const folder = a.folder ? path.resolve(String(a.folder).replace(/^~(?=$|[\\/])/, require('os').homedir())) : null;
      const r = exportPack(p, { ids: a.sounds, format: f, folder, variations: a.variations || 0, amount: a.variation_amount || 0.25 });
      if (folder) { p.exportDir = folder; p.save(); } if (by && by !== 'you') activity(`Exported ${r.files.length} files from ${p.name}`);
      return ok({ pack: p.name, folder: r.folder, files: r.files.map((x) => path.basename(x)) });
    },
    async sfx_to_song(a, by) {
      const p = packOf(a.pack); const snd = p.find(a.sound); const y = X.render(snd); const tmp = path.join(require('os').tmpdir(), `${require('./sfxlib').fileSafe(snd.name)}.wav`); fs.writeFileSync(tmp, Buffer.from(X.wav(y)));
      const pr = active(); const rel = pr.importAudio(tmp); try { fs.unlinkSync(tmp); } catch {}
      if (a.pad) { const voice = T.voiceName(a.pad); if (!voice) throw new Error('pad is a drum voice: ' + T.DRUM_VOICES.join(', ')); const t = edit(by, `“${snd.name}” on the ${voice} pad`, (s) => { const tr = a.track ? SG.findTrack(s, a.track) : s.tracks.find((x) => x.kind === 'drums'); if (!tr || tr.kind !== 'drums') throw new Error('No drum track to put it on. Add one or name it with track.'); tr.pads = { ...(tr.pads || {}), [voice]: { file: rel, gain: 0, tune: 0 } }; return tr; }); return ok({ track: t.name, pad: voice, file: rel }); }
      const c = edit(by, `Placed “${snd.name}”`, (s) => { let t = a.track ? SG.findTrack(s, a.track) : s.tracks.find((x) => x.kind === 'audio' && /sfx|sound/i.test(x.name)); if (t && t.kind !== 'audio') throw new Error(`“${t.name}” isn’t an audio track.`); if (!t) t = SG.addTrack(s, { kind: 'audio', name: 'SFX' }); return SG.addAudioClip(s, { track: t.id, start: SG.barToBeat(s, bar(a.at_bar)) + (+a.beat || 0), file: rel, srcDur: y.length / X.SR, name: snd.name }); });
      return ok({ clip: c.id, bar: SG.beatToBar(song(), c.start), file: rel });
    },
    make_8bit(a, by) { const ch = edit(by, 'Made it 8-bit', (s) => SG.chipify(s, { console: a.console || 'nes', crush: !!a.crush, keepEffects: !!a.keep_effects })); return ok({ changed: ch, tip: 'Chords on a Chip Chord track are arpeggiated automatically. Bass sounds best on the triangle/wave channel kept in octave 2–3. For more grit add crush (bits 8, rate 11025–22050) on the master.' }); },
  });
  function brief(f) { const spec = SND.EFFECTS[f.type].params; const o = { id: f.id, type: f.type }; if (!f.on) o.on = false; for (const k of Object.keys(spec)) o[k] = f[k]; return o; }
  async function clipResult(c) {
    const s = song(); const t = SG.findTrack(s, c.track); const sum = SG.summary(s, { track: t.id }).tracks[0]; const me = sum.clips.find((x) => x.id === c.id);
    const p = await pic('notes', { track: t.id, fromBar: SG.beatToBar(s, c.start), bars: Math.min(16, Math.ceil(c.length / SG.bpb(s) - 1e-6)) });
    return ok({ track: t.name, clip: me, song_bars: s.bars }, p);
  }

  function guide() {
    const inst = SND.CATS.map((c) => `  ${c}: ${SND.INSTRUMENTS.filter((i) => i.cat === c).map((i) => `${i.id} (${i.desc.toLowerCase()})`).join('; ')}`).join('\n');
    return `MIXER — GUIDE FOR CLAUDE

WHAT IT IS
A music studio on the user's computer. Compose instrumental tracks (no vocals) with synthesized instruments and drum kits, edit recordings the user imports, mix with effects and automation, and export WAV/MP3. Everything you do shows up live in the Mixer window, goes into the song's undo history, and the user can play it.

CONVENTIONS
• Bars are 1-based (bar 1 = the start). Inside a clip, note "beat" counts from 0 at the clip start in quarter-note beats (4 per bar in 4/4; 0.5 = the "and", 0.25 = a 16th).
• Notes: "C4" is middle C (MIDI 60). Sharps/flats: F#3, Bb2. Bass lives around C1–C3, chords C3–C5, leads C4–C6.
• Velocity 0–1 (0.8 is a firm hit). Volume in dB (0 = unity, −6 = about half as loud). Pan −1…1.
• The song has one tempo, key and time signature. write_chords reads Roman numerals in the song key.

HOW TO WORK (compose)
1. new_song (or set_song) with tempo, key and markers for the sections you plan (Intro 1, Verse 9, Chorus 17…).
2. Build one section first, usually 4–8 bars: drums (write_drums with a style, then adjust the pattern), bass (write_chords with a bass-* rhythm on a Bass instrument), chords/pads (write_chords), then a melody or hook (write_notes, in the key — keep it singable: mostly steps, a few leaps, repeat and vary a 1–2 bar motif).
3. Check each part with the returned picture. Then analyze the section (from_bar/bars) — balance and loudness tell you if the bass is too loud, the chords muddy, etc.
4. Arrange: arrange copy to repeat sections, then vary them (thin out the intro, drop the drums in a breakdown, add a riser with the FX kit before a drop, automate a filter sweep or volume build). Contrast between sections is what makes a track feel produced.
5. Mix (see below), analyze the whole mix, fix the notes it reports, then transport play so the user hears it, and export when they're happy.

HOW TO WORK (edit an existing track)
1. import_audio with the file path — you get its tempo, key, loudness and a waveform with sections. Often set_song bpm/key to match it (adopt_tempo:true on an empty song does this).
2. Cut and rearrange with edit_clip (split_at_bar, move_to_bar, duplicate, remove) and arrange (copy/delete/insert bars move everything together). Fades smooth every cut (fade_in/fade_out ~0.01–0.05 s; longer for intros/outros).
3. Change it: pitch (semitones, keeps tempo), stretch (time, keeps pitch; fit_tempo matches the song), speed (tape style), reverse, gain. Add effects to the audio track (EQ, compression, reverb, filter, width).
4. Add new parts on top (drums, bass, pads) in the file's key and tempo — this is how to remix or extend a song.
5. Imported audio is the full mix; Mixer can't separate it into stems (vocals, drums…).

SOUNDS
Instruments (kind "instrument"; sound = id):
${inst}
Drum kits (kind "drums"): ${SND.KITS.map((k) => `${k.id} (${k.desc.toLowerCase()})`).join('; ')}.
Drum voices: ${T.DRUM_VOICES.join(', ')}. riser/downlifter last a few beats — put them right before a section change. Any voice can play the user's own sample (the window's drum pads).
Chord rhythms: ${Object.entries(T.RHYTHMS).map(([k, v]) => `${k} — ${v.desc}`).join('; ')}.
Grooves (write_drums style): ${Object.entries(T.GROOVES).map(([k, v]) => `${k} — ${v.desc}`).join('; ')}.
Mono instruments (leads, basses) glide when notes overlap — overlap notes slightly for slides, leave gaps for separate notes.

EFFECTS (set_effects; order = signal flow)
${Object.entries(SND.EFFECTS).map(([k, e]) => `• ${k}: ${e.desc}. ${Object.entries(e.params).map(([p, v]) => `${p} ${typeof v[2] === 'string' ? `(${v[3]}; default ${JSON.stringify(v[2])})` : `${v[0]}–${v[1]}${v[3] ? ' ' + v[3] : ''} (default ${v[2]})`}`).join(', ')}`).join('\n')}
Delay times and LFO rates take note values: "1/4", "1/8d" (dotted), "1/16t" (triplet).
duck makes the pump: put { type:"duck", source:"Drums", voice:"kick", amount:-8 } on bass/pads/chords.

MIXING — WHAT GOOD LOOKS LIKE
• Gain staging: drums and bass carry the energy; kick and bass shouldn't fight — give the bass a duck from the kick or EQ them apart (kick punch ~60–100 Hz, bass body 80–200 Hz).
• Low cut (eq lowcut 120–250 Hz) on everything that isn't kick or bass: pads, keys, leads, hats. This removes most mud.
• Leave space: chords around −6 to −10 dB, leads above them, pads lower and wider. Pan supporting parts (±0.2–0.5), keep kick, snare, bass and lead centred.
• Reverb/delay: more on pads and leads, little or none on kick and bass. Similar reverb on everything glues it.
• Master: gentle EQ if needed, compressor (ratio 2, threshold −14) for glue, limiter last (ceiling −1). Streaming loudness is −14 LUFS; louder (−9…−7) for club/EDM, quieter (−16…−18) for chill/acoustic.
• analyze reports balance as % of energy: a healthy pop/EDM mix is roughly sub 8–20, bass 25–40, low-mids 8–15, mids 15–25, high-mids 6–15, air 1–6. Its notes give concrete fixes.

CHECKING YOUR WORK
You can't hear, so measure. analyze renders exactly what the user will hear and returns numbers plus a waveform/spectrogram with bar numbers: silence where you expected sound means a muted track or a wrong bar; a dense red top edge means clipping; a bright band at the bottom across everything means too much low end. view kind "notes" shows a piano roll (rows tinted in the key) or drum grid to check rhythm and pitches. get_song lists every clip with its bar.

8-BIT MUSIC (chiptune)
• new_song with template "chiptune" (NES) or "gameboy" sets up the console's channels: Pulse 1 (lead), Pulse 2 (chords, arpeggiated), Triangle/Wave (bass), Noise (drums). make_8bit converts an existing song.
• Chip instruments: nes-pulse-12 / nes-pulse-25 (leads with delayed vibrato), nes-square (harmony), nes-triangle (bass, no volume control — vary rhythm, not velocity), chip-chord and gb-chord (write block chords and they play as a fast arpeggio, the NES trick), chip-echo (copy a lead 1/8 later at −8 dB for the fake echo), gb-wave, sid-saw, chip-noise and chip-noise-metal (pitched noise). Kits: nes, gameboy (triangle kicks, noise snares/hats with stepped decays).
• Rhythms: chip-arp (1/32 chord tones up two octaves), chip-arp16 (triplets), bass-chip (root-octave bounce), bass-gallop. Grooves: chiptune, chip-drive, chip-march.
• Style: 130–170 BPM, keys like E/A/D minor or C major, short catchy 2–4 bar motifs, call-and-response between pulses, a fast arp for harmony, few simultaneous notes per channel (they're mono), no reverb. Optional grit: a crush effect (bits 8, rate 11025–22050) on the master.

GAME SOUND EFFECTS
• make_sfx builds sounds from a kind and saves them in a pack (~/Documents/Mixer/Sound FX/<pack>): ${Object.entries(X.KINDS).map(([k, v]) => `${k} (${v.toLowerCase()})`).join(', ')}. variations: 2–8 makes alternatives side by side to choose from. retro:true gives 8-bit / 22 kHz output.
• Every sound is the classic sfxr synth in up to 4 layers (each with delay s, gain dB, pitch semitones). Parameters (layer.params): ${Object.entries(X.PARAMS).map(([k, v]) => `${k} ${v[0]}..${v[1]}`).join(', ')}. wave: 0 square, 1 saw, 2 sine, 3 noise, 4 triangle. freq 0.3 ≈ 230 Hz, 0.5 ≈ 650 Hz, 0.7 ≈ 1.3 kHz; slide < 0 falls, > 0 rises; sustain/decay ~0.3 ≈ 0.2 s; repeat retriggers (alarms, power-ups); arpMod > 0 jumps up (coins), < 0 down.
• Layer to add weight: a sine thud an octave down under an explosion, a noise whoosh before a sword hit, a short high blip on top of a pickup.
• You can't hear them: the picture shows each sound's waveform (length, punch, fade) and spectrogram (pitch going up or down, noise vs tone). Keep UI sounds under 0.15 s, pickups 0.2–0.5 s, explosions 0.6–1.5 s.
• export_sfx writes WAV or MP3 files (+ sounds.json), or a JavaScript module that synthesizes the pack in the browser (play('coin')) — tiny, good for web games. variations:n adds name_1…name_n so repeated sounds don't feel robotic. sfx_to_song places a sound in the song or on a drum pad.

LIMITS
Instruments are synthesized (no sampled orchestras). No vocals or speech. Imported files are mixes, not stems. Pitch/stretch on audio is good for ±3 semitones and 0.75–1.33× before it sounds processed.`;
  }

  async function handle(name, args, by) {
    const fn = H[name]; if (!fn) return { content: [text('Unknown tool ' + name)], isError: true };
    try { return await fn(args || {}, by || 'Claude'); } catch (e) { return { content: [text('Error: ' + (e.message || e))], isError: true }; }
  }
  handle.importAudio = importAudio; handle.exportSong = exportSong; handle.guide = guide;
  return handle;
}
module.exports = { makeHandlers };
