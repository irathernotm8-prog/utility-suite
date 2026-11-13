// Mixer — Node checks (no Electron, no network): theory, the song model and its edits, analysis, WAV, time-stretch,
// the plugin's tool list, and the MCP server over stdio. Run: npm test
'use strict';
const assert = require('assert');
const path = require('path');
const T = require('../src/core/theory');
const SG = require('../src/core/song');
const SND = require('../src/core/sounds');
const A = require('../src/core/analysis');
const W = require('../src/core/wav');
const ST = require('../src/core/stretch');
const L = require('../src/core/levels');
const { TOOLS } = require('../mcp/tools');
let n = 0; const ok = (name, fn) => { try { fn(); n++; console.log('  ✓', name); } catch (e) { console.log('  ✗', name, '\n   ', e.message); process.exitCode = 1; } };

ok('note names', () => { assert.equal(T.noteToMidi('C4'), 60); assert.equal(T.noteToMidi('A4'), 69); assert.equal(T.noteToMidi('Bb2'), 46); assert.equal(T.noteToMidi('Cb4'), 59); assert.equal(T.noteToMidi(64), 64); assert.equal(T.midiToName(61, true), 'Db4'); assert.throws(() => T.noteToMidi('H2')); });
ok('keys and scales', () => { assert.equal(T.parseKey('Am').name, 'A minor'); assert.equal(T.parseKey('f# major').name, 'F# major'); assert.equal(T.parseKey('Bb').name, 'Bb major'); assert.ok(T.inKey(T.noteToMidi('G4'), 'A minor')); assert.ok(!T.inKey(T.noteToMidi('G#4'), 'A minor')); assert.equal(T.snapToKey(T.noteToMidi('G#4'), 'A minor') % 12, 7); });
ok('chords and numerals', () => { assert.deepEqual(T.parseProgression('i VI III VII', 'A minor').map((c) => c.name), ['Am', 'F', 'C', 'G']); assert.deepEqual(T.parseProgression('ii V I', 'C major').map((c) => c.name), ['Dm', 'G', 'C']); const c = T.parseChord('Dm7/G'); assert.equal(c.bass, 7); assert.deepEqual(c.intervals, [0, 3, 7, 10]); assert.equal(T.parseProgression('Am*2 F').map((x) => x.len).join(), '2,1'); });
ok('voice leading stays close', () => { const r = T.chordNotes('C F G C', 'C major', { rhythm: 'block' }); const groups = [0, 4, 8, 12].map((t) => r.notes.filter((n) => n.t === t).map((n) => n.p)); for (let i = 1; i < groups.length; i++) { const move = groups[i].reduce((a, p) => a + Math.min(...groups[i - 1].map((q) => Math.abs(q - p))), 0); assert.ok(move <= 6, 'moves ' + move); } });
ok('rhythms make notes inside the chord length', () => { for (const rh of Object.keys(T.RHYTHMS)) { const r = T.chordNotes('Am F', 'A minor', { rhythm: rh }); assert.ok(r.notes.length > 0, rh); for (const n of r.notes) assert.ok(n.t >= 0 && n.t < 8 + 0.2 && n.d > 0, rh); } });
ok('drum patterns and swing', () => { const p = T.parsePattern('x...X...o...g...'); assert.equal(p.hits.length, 4); assert.equal(p.beats, 4); assert.equal(p.hits[1].v, 1); assert.equal(T.swingTime(0.25, 0.6), 0.3); assert.equal(T.swingTime(0.5, 0.6), 0.5); assert.equal(T.voiceName('hh'), 'hat'); for (const g of Object.values(T.GROOVES)) for (const [v, s] of Object.entries(g.p)) { assert.ok(T.voiceName(v), v); T.parsePattern(s); } });
ok('sounds: every preset, kit and effect is complete', () => { for (const i of SND.INSTRUMENTS) { assert.ok(i.id && i.name && i.cat && i.desc, i.id); assert.ok(L.inst[i.id] > 0, 'calibrated ' + i.id); for (const f of i.fx || []) SND.effectDefaults(f.type); } for (const k of SND.KITS) for (const v of T.DRUM_VOICES) { assert.ok(SND.kitVoice(k.id, v), v); assert.ok(L.kit[k.id][v] > 0, k.id + v); } for (const e of Object.keys(SND.EFFECTS)) SND.effectDefaults(e); assert.equal(SND.findSound('warm pad').id, 'warm-pad'); });
ok('song: tracks, clips, notes', () => {
  const s = SG.newSong({ bpm: 120, key: 'A minor', bars: 4 }); const d = SG.addTrack(s, { kind: 'drums', sound: '909' }); const p = SG.addTrack(s, { kind: 'instrument', sound: 'warm-pad', name: 'Pad' });
  assert.ok(p.effects.some((f) => f.type === 'reverb'), 'preset effects');
  const c = SG.addMidiClip(s, { track: 'Pad', start: 4, notes: [{ note: 'A3', beat: 0, length: 4 }, { p: 'C4', t: 0, d: 4, v: 100 }] }); assert.equal(c.length, 4); assert.ok(Math.abs(c.notes[1].v - 100 / 127) < 1e-3);
  assert.throws(() => SG.addMidiClip(s, { track: d.id, notes: [{ note: 'C4' }] }), /drum voice/);
  SG.addMidiClip(s, { track: 1, notes: [{ voice: 'kick', beat: 0 }] }); assert.equal(SG.findTrack(s, 'pad').id, p.id); assert.equal(SG.findTrack(s, '2').id, p.id);
  const [a, b] = SG.splitClip(s, c.id, 6); assert.equal(a.length, 2); assert.equal(b.start, 6); assert.equal(b.notes.length, 0); assert.equal(a.notes[0].d, 2);
  SG.duplicateClip(s, a.id, null, 2); assert.equal(SG.clipsOn(s, 'Pad').length, 4);
});
ok('song: sections (copy, insert, delete)', () => {
  const s = SG.newSong({ bars: 8 }); SG.addTrack(s, { kind: 'drums' }); SG.addMidiClip(s, { track: 1, start: 0, length: 16, notes: [0, 4, 8, 12].map((t) => ({ voice: 'kick', beat: t })) });
  SG.copySection(s, { fromBar: 1, bars: 2, toBar: 5, times: 2 }); const clips = SG.clipsOn(s, 1); assert.equal(clips.filter((c) => c.start >= 16).length, 2); assert.equal(SG.songEnd(s), 32);
  SG.insertBars(s, { atBar: 2, bars: 1 }); assert.ok(SG.clipsOn(s, 1).some((c) => c.start === 8)); assert.equal(s.bars, 9);
  SG.deleteSection(s, { fromBar: 2, bars: 1 }); assert.ok(!SG.clipsOn(s, 1).some((c) => c.start > 4 && c.start < 8 && c.notes.length === 0));
});
ok('song: audio clips (trim, stretch, pitch, slice)', () => {
  const s = SG.newSong({ bpm: 120 }); SG.addTrack(s, { kind: 'audio' }); const c = SG.addAudioClip(s, { track: 1, file: 'a.wav', srcDur: 8 });
  assert.equal(SG.clipLength(s, c), 16); SG.updateClip(s, c.id, { stretch: 1.25 }); assert.equal(SG.clipLength(s, c), 20); SG.updateClip(s, c.id, { speed: 2 }); assert.equal(SG.clipLength(s, c), 10);
  SG.updateClip(s, c.id, { speed: 1, stretch: 1, trimStart: 2 }); assert.equal(c.offset, 2); assert.equal(c.dur, 6); assert.equal(c.start, 4);
  const sl = SG.slice(s, c, 6, 8); assert.equal(sl.offset, 3); assert.equal(sl.dur, 1);
});
ok('song: effects and automation', () => {
  const s = SG.newSong({}); SG.addTrack(s, { kind: 'instrument', sound: 'saw-lead', name: 'Lead' }); const f = SG.addEffect(s, 'master', { type: 'eq', lowcut: 30 }); assert.equal(s.master.effects[s.master.effects.length - 1].type, 'limiter', 'limiter stays last'); SG.updateEffect(s, 'master', 'eq', { high: 3, on: false }); assert.equal(f.high, 3); assert.equal(f.on, false);
  SG.setAutomation(s, 'Lead', 'volume', [[8, 0], [0, -20]]); assert.equal(SG.autoValue(s.tracks[0].automation.volume, 4), -10); assert.throws(() => SG.setAutomation(s, 'Lead', 'reverb', [[0, 1]]));
  const sum = SG.summary(s); assert.equal(sum.tracks[0].name, 'Lead'); assert.ok(JSON.stringify(sum).length < 4000);
});
ok('analysis: loudness of a −20 dBFS 1 kHz sine is −20 LUFS', () => { const sr = 48000, n = sr * 10; const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = 0.1 * Math.sin((2 * Math.PI * 1000 * i) / sr); const l = A.loudness([x, x], sr); assert.ok(Math.abs(l.integrated + 20) < 0.2, l.integrated); });
const sr = 44100; const beat = (bpm, sec, chord) => { const n = sr * sec, x = new Float32Array(n); const bp = 60 / bpm; for (let b = 0; b * bp < sec; b++) { const s0 = Math.round(b * bp * sr); for (let i = 0; i < 2500 && s0 + i < n; i++) x[s0 + i] += Math.sin((2 * Math.PI * 60 * i) / sr) * Math.exp(-i / 450) * 0.8; } for (let i = 0; i < n; i++) for (const f of chord) x[i] += 0.04 * Math.sin((2 * Math.PI * f * i) / sr); return x; };
ok('analysis: tempo 90 / 128 / 140', () => { for (const bpm of [90, 128, 140]) { const t = A.tempo(beat(bpm, 16, []), sr); assert.ok(Math.abs(t.bpm - bpm) < 1, `${bpm} → ${t.bpm}`); } });
ok('analysis: key (A minor, E major)', () => { assert.equal(A.key(beat(100, 10, [220, 261.63, 329.63, 110]), sr).key, 'A minor'); assert.equal(A.key(beat(100, 10, [164.81, 207.65, 246.94, 82.41]), sr).key, 'E major'); });
ok('analysis: balance and the mix check', () => { const x = beat(120, 8, [55, 110]); const r = A.analyze([x, x], sr, { bpm: 120 }); assert.ok(r.balance.sub + r.balance.bass > 70); assert.ok(r.notes.some((n) => /Bass-heavy/.test(n.msg))); const clip = x.map((v) => v * 8); const r2 = A.analyze([clip, clip], sr, { bpm: 120 }); assert.ok(r2.notes.some((n) => /clips/.test(n.msg))); });
ok('WAV round trip (16, 24, 32-bit)', () => { const x = new Float32Array(1000).map((_, i) => Math.sin(i / 7) * 0.5); for (const bits of [16, 24, 32]) { const d = W.decode(W.encode([x, x], 44100, bits)); assert.equal(d.channels.length, 2); assert.ok(Math.abs(d.channels[1][500] - x[500]) < (bits === 16 ? 1e-3 : 1e-5), bits); } });
ok('time-stretch keeps pitch and changes length', () => { const x = new Float32Array(sr * 3); for (let i = 0; i < x.length; i++) x[i] = Math.sin((2 * Math.PI * 440 * i) / sr); const y = ST.wsola([x], sr, 1.5)[0]; assert.ok(Math.abs(y.length / x.length - 1.5) < 0.01); let zc = 0; for (let i = sr; i < sr * 2; i++) if (y[i - 1] < 0 && y[i] >= 0) zc++; assert.ok(Math.abs(zc - 440) < 6, 'zero crossings ' + zc); });
ok('plugin tools are well formed', () => { const names = new Set(); for (const t of TOOLS) { assert.ok(/^[a-z0-9_]+$/.test(t.name)); assert.ok(!names.has(t.name)); names.add(t.name); assert.ok(t.description.length > 20); assert.equal(t.inputSchema.type, 'object'); } assert.ok(names.has('write_chords') && names.has('analyze') && names.has('import_audio')); });
ok('MCP server answers initialize and tools/list over stdio', () => {
  const { spawnSync } = require('child_process'); const msgs = [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'test' } } }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }].map((m) => JSON.stringify(m)).join('\n') + '\n';
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'mcp', 'mixer-mcp.js')], { input: msgs, env: { ...process.env, MIXER_BRIDGE: '/nonexistent' }, timeout: 10000 }); const lines = String(r.stdout).trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines[0].result.serverInfo.name, 'mixer'); assert.ok(lines[0].result.instructions.includes('mixer_guide')); assert.equal(lines[1].result.tools.length, TOOLS.length);
});
const X = require('../src/core/sfx');
ok('sfx: every kind renders, lasts sensibly and is normalised', () => { for (const k of Object.keys(X.KINDS)) { const s = X.generate(k, 11); const y = X.render(s); assert.ok(y.length > 400 && y.length < 44100 * 8, k + ' ' + y.length); let pk = 0; for (const v of y) pk = Math.max(pk, Math.abs(v)); assert.ok(pk > 0.6 && pk <= 0.72, k + ' peak ' + pk); } });
ok('sfx: seeded, so variations repeat exactly', () => { const a = X.render(X.generate('laser', 42)), b = X.render(X.generate('laser', 42)), c = X.render(X.generate('laser', 43)); assert.equal(a.length, b.length); assert.equal(a[200], b[200]); assert.ok(a.length !== c.length || a[200] !== c[200]); });
ok('sfx: slides go the right way (coin up via arpeggio, laser down)', () => { const pitch = (y, from, to) => { let zc = 0; for (let i = from + 1; i < to; i++) if (y[i - 1] < 0 && y[i] >= 0) zc++; return zc; }; const laser = X.render({ layers: [{ params: { wave: 0, freq: 0.6, slide: -0.4, sustain: 0.3, decay: 0.2 } }] }); assert.ok(pitch(laser, 0, 2000) > pitch(laser, 6000, 8000)); const up = X.render({ layers: [{ params: { wave: 0, freq: 0.3, slide: 0.3, sustain: 0.3, decay: 0.1 } }] }); assert.ok(pitch(up, 0, 2000) < pitch(up, 6000, 8000)); });
ok('sfx: layers, pitch and 8-bit output', () => { const one = X.render({ layers: [{ params: X.generate('blip', 1).layers[0].params }] }); const two = X.render({ layers: [{ params: X.generate('blip', 1).layers[0].params }, { params: X.generate('blip', 1).layers[0].params, delay: 0.2 }] }); assert.ok(Math.abs(two.length - one.length - 0.2 * 44100) < 2); const r = X.render({ bits: 4, rate: 11025, layers: [{ params: X.generate('jump', 2).layers[0].params }] }); assert.ok(new Set(r.slice(500, 3000)).size <= 17); assert.equal(r[1001], r[1002]); });
ok('sfx: packs save, export WAV/MP3/JS and the JS module plays the same sounds', () => {
  const os = require('os'), fs = require('fs'); const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mixer-sfx-')); const { SfxLib, exportPack } = require('../src/sfxlib'); const lib = new SfxLib(() => root); const p = lib.ensure();
  p.upsert({ ...X.generate('coin', 3), name: 'Coin' }); p.upsert({ ...X.generate('big-explosion', 3), name: 'Boom' }); assert.equal(new SfxLib(() => root).get(p.id).sounds.length, 2);
  const r = exportPack(p, { format: 'all', variations: 2 }); const names = r.files.map((f) => path.basename(f)); for (const n of ['coin.wav', 'coin.mp3', 'coin_2.wav', 'boom.wav', 'sounds.json', 'my_game_sounds.js']) assert.ok(names.includes(n), n);
  assert.equal(W.decode(fs.readFileSync(path.join(r.folder, 'coin.wav'))).channels[0].length, X.render(p.find('coin')).length);
  const js = fs.readFileSync(path.join(r.folder, 'my_game_sounds.js'), 'utf8'); assert.ok(js.includes('export function play')); const mod = js.replace(/^export (const|function|default)/gm, (m, k) => (k === 'default' ? 'const __d =' : k)); const ctx = { AudioContext: function () {} }; require('vm').runInNewContext(mod + '; this.out = { sounds, MXSfx };', ctx); assert.equal(ctx.out.MXSfx.render(ctx.out.sounds.coin).length, X.render(p.find('coin')).length);
});
ok('8-bit: chip instruments, kits, rhythms, template and make-it-8-bit', () => {
  for (const id of ['nes-pulse-12', 'nes-pulse-25', 'nes-square', 'nes-triangle', 'chip-chord', 'gb-wave', 'chip-noise']) assert.equal(SND.instrument(id).cat, 'Chip'); assert.ok(SND.kit('nes').chip && SND.kit('gameboy').chip);
  const r = T.chordNotes('Am F', 'A minor', { rhythm: 'chip-arp' }); assert.equal(r.notes.length, 64); assert.ok(r.notes.some((n) => n.p >= 81)); assert.equal(T.chordNotes('Am', 'A minor', { rhythm: 'bass-chip' }).notes[1].p - T.chordNotes('Am', 'A minor', { rhythm: 'bass-chip' }).notes[0].p, 12);
  for (const g of ['chiptune', 'chip-drive', 'chip-march']) assert.ok(T.GROOVES[g]);
  const s = SG.newSong({}); SG.chipTemplate(s); assert.deepEqual(s.tracks.map((t) => t.sound), ['nes-pulse-25', 'chip-chord', 'nes-triangle', 'nes']);
  const t = SG.newSong({}); SG.addTrack(t, { kind: 'instrument', sound: 'sub-bass' }); const k = SG.addTrack(t, { kind: 'instrument', sound: 'warm-pad' }); SG.addMidiClip(t, { track: k.id, notes: T.chordNotes('C F G C', 'C major').notes }); SG.addTrack(t, { kind: 'instrument', sound: 'saw-lead' }); SG.addTrack(t, { kind: 'drums', sound: '909' });
  SG.chipify(t, { crush: true }); assert.deepEqual(t.tracks.map((x) => x.sound), ['nes-triangle', 'chip-chord', 'nes-pulse-25', 'nes']); assert.ok(!t.tracks[1].effects.some((f) => f.type === 'reverb')); assert.equal(t.master.effects[0].type, 'crush');
});
console.log(process.exitCode ? '\nSome checks failed' : `\n${n} checks passed`);
