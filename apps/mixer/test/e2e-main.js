// Mixer — end-to-end run inside Electron (Linux: xvfb-run). Drives every plugin tool through the real handlers and the
// real hidden engine window, saves the pictures, renders/exports audio, then (optionally) screenshots the window.
// Run: xvfb-run -a electron test/e2e-main.js <outDir>
'use strict';
const path = require('path'); const fs = require('fs'); const os = require('os');
const OUT = path.resolve(process.argv[process.argv.length - 1].endsWith('e2e-main.js') ? path.join(os.tmpdir(), 'mixer-e2e') : process.argv[process.argv.length - 1]);
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
process.env.MIXER_E2E = '1'; process.env.MIXER_USER_DATA = path.join(OUT, 'userdata'); process.env.MIXER_SONGS = path.join(OUT, 'songs');
const { app, BrowserWindow } = require('electron');
const { handle } = require('../src/main.js');
const W = require('../src/core/wav');
const log = (...a) => console.log('[e2e]', ...a);
let fails = 0; const check = (c, msg) => { if (!c) { fails++; console.log('  ✗', msg); } else console.log('  ✓', msg); };
async function call(name, args) { const t0 = Date.now(); const r = await handle(name, args, 'Claude Code'); const txt = r.content[0].text; if (r.isError) { console.log(`  ! ${name} → ${txt}`); } else log(`${name} (${Date.now() - t0} ms)`); let i = 0; for (const c of r.content) if (c.type === 'image') fs.writeFileSync(path.join(OUT, `${String(++shot).padStart(2, '0')}-${name}${i++ ? '-' + i : ''}.png`), Buffer.from(c.data, 'base64')); let j = null; try { j = JSON.parse(txt); } catch {} return { r, j, txt }; }
let shot = 0;
app.whenReady().then(async () => {
  await new Promise((r) => setTimeout(r, 1500));
  try {
    let x = await call('mixer_guide', {}); check(x.txt.includes('MIXING'), 'guide');
    x = await call('new_song', { name: 'Night Drive', bpm: 104, key: 'A minor', bars: 8 }); check(x.j && x.j.bpm === 104, 'new song');
    x = await call('set_song', { markers: [{ bar: 1, name: 'Intro' }, { bar: 5, name: 'Drop' }] }); check(x.j.markers.length === 2, 'markers');
    x = await call('add_track', { kind: 'drums', sound: '808', name: 'Drums' }); check(x.j.added.kind === 'drums', 'drums track');
    x = await call('write_drums', { track: 'Drums', style: 'trap', bars: 4, fill: true }); check(x.j.clip && x.j.clip.notes > 20, 'trap drums ' + (x.j.clip && x.j.clip.notes));
    x = await call('add_track', { kind: 'instrument', sound: '808', name: 'Bass' });
    x = await call('write_chords', { track: 'Bass', progression: 'i VI III VII', rhythm: 'bass-808' }); check(x.j.chords.join(' ') === 'Am F C G', 'numerals in key → ' + (x.j.chords || []).join(' '));
    x = await call('add_track', { kind: 'instrument', sound: 'warm-pad', name: 'Pad' });
    x = await call('write_chords', { track: 'Pad', progression: 'Am F C G', rhythm: 'block', spread: true }); check(x.j.clip.notes >= 12, 'pad chords');
    x = await call('add_track', { kind: 'instrument', sound: 'electric-piano', name: 'Keys' });
    x = await call('write_chords', { track: 'Keys', progression: 'Am7 Fmaj7 C G', rhythm: 'arp-up', octave: 4 }); check(x.j.clip.notes > 40, 'arp');
    x = await call('add_track', { kind: 'instrument', sound: 'saw-lead', name: 'Lead' });
    x = await call('write_notes', { track: 'Lead', start_bar: 1, name: 'Hook', notes: [{ note: 'E5', beat: 0, length: 0.75 }, { note: 'D5', beat: 1, length: 0.5 }, { note: 'C5', beat: 1.5, length: 1 }, { note: 'A4', beat: 3, length: 1 }, { note: 'C5', beat: 4, length: 1 }, { note: 'D5', beat: 5, length: 0.5 }, { note: 'E5', beat: 6, length: 2 }] }); check(x.j.clip.notes === 7, 'melody');
    x = await call('set_effects', { target: 'Pad', add: { type: 'duck', source: 'Drums', voice: 'kick', amount: -8 } }); check(x.j.effects.some((f) => f.type === 'duck'), 'duck');
    x = await call('set_effects', { target: 'master', effects: [{ type: 'eq', lowcut: 25 }, { type: 'compressor', ratio: 2, threshold: -14 }, { type: 'limiter', gain: 4, ceiling: -1 }] }); check(x.j.effects.length === 3, 'master chain');
    x = await call('automate', { track: 'Pad', param: 'volume', points: [[1, -18], [5, -4]] }); check(x.j.points.length === 2, 'automation');
    x = await call('arrange', { action: 'copy', from_bar: 1, bars: 4, to_bar: 5 }); check(x.j.bars >= 8, 'copy section');
    x = await call('get_song', {}); check(x.j.tracks.length === 5, 'get_song');
    x = await call('view', { kind: 'notes', track: 'Keys', bars: 4 });
    x = await call('analyze', { target: 'mix' }); check(x.j && x.j.loudness_lufs > -40 && x.j.loudness_lufs < 0, 'mix loudness ' + (x.j && x.j.loudness_lufs) + ' LUFS, peak ' + (x.j && x.j.peak_dbfs)); if (x.j) log('balance', JSON.stringify(x.j.balance), 'notes:', x.j.notes.map((n) => n.msg).join(' | '));
    x = await call('analyze', { target: 'Bass' }); check(x.j && x.j.balance && x.j.balance.sub + x.j.balance.bass > 60, 'bass is low-heavy ' + JSON.stringify(x.j && x.j.balance));
    x = await call('export', { format: 'wav', name: 'night drive', normalize_lufs: -14, stems: true }); check(x.j && x.j.files.length >= 6, 'export + stems ' + (x.j && x.j.files.length)); if (x.j) { log('exported', x.j.loudness_lufs, 'LUFS', x.j.peak_dbfs, 'dBFS', x.j.normalized); check(Math.abs(x.j.loudness_lufs + 14) < 1.2, 'normalized near −14'); check(x.j.peak_dbfs <= -0.5, 'peak under ceiling'); }
    const wavFile = x.j && x.j.files[0];
    x = await call('export', { format: 'mp3', name: 'night drive', kbps: 192 }); check(x.j && /\.mp3$/.test(x.j.files[0]) && fs.statSync(x.j.files[0]).size > 50000, 'mp3 export');
    // editing an existing track: make a test recording at 120 BPM (clicks + chords in E minor) and bring it in
    const sr = 44100, n = sr * 12; const L = new Float32Array(n); const bp = 0.5; for (let b = 0; b * bp < 12; b++) { const s0 = Math.round(b * bp * sr); for (let i = 0; i < 3000 && s0 + i < n; i++) L[s0 + i] += Math.sin(2 * Math.PI * 55 * i / sr) * Math.exp(-i / 500) * 0.7; } for (let i = 0; i < n; i++) for (const f of [164.81, 196, 246.94, 82.41]) L[i] += 0.04 * Math.sin(2 * Math.PI * f * i / sr);
    const rec = path.join(OUT, 'recording 120.wav'); fs.writeFileSync(rec, W.encode([L, L], sr, 16));
    x = await call('new_song', { name: 'Remix', bpm: 100, key: 'C major' });
    x = await call('import_audio', { path: rec, adopt_tempo: true }); check(x.j && Math.abs(x.j.detected_tempo.bpm - 120) < 1, 'detected tempo ' + (x.j && x.j.detected_tempo && x.j.detected_tempo.bpm)); check(x.j && /E minor|G major/.test(x.j.detected_key.key), 'detected key ' + (x.j && x.j.detected_key && x.j.detected_key.key)); check(x.j && x.j.song_tempo === 120, 'adopted tempo');
    const clip = x.j && x.j.clip;
    x = await call('set_song', { bpm: 96 });
    x = await call('edit_clip', { clip, fit_tempo: true, fade_in: 0.5 }); check(x.j && Math.abs(x.j.stretch - 1.25) < 0.01, 'fit tempo stretch ' + (x.j && x.j.stretch));
    x = await call('edit_clip', { clip, split_at_bar: 3 }); check(x.j && x.j.split && x.j.split.length === 2, 'split');
    x = await call('edit_clip', { clip: x.j.split[1], pitch: 2 });
    x = await call('analyze', { target: 'mix' }); check(x.j && x.j.seconds > 14, 'stretched length ' + (x.j && x.j.seconds) + 's');
    x = await call('analyze', { file: rec }); check(x.j && x.j.tempo.bpm === 120, 'analyze a file');
    x = await call('undo', { steps: 2 }); check(x.j && x.j.undone.length === 2, 'undo');
    x = await call('view', { kind: 'arrangement' });
    // 8-bit music
    x = await call('new_song', { name: 'Castle Theme', template: 'chiptune', bpm: 150, key: 'E minor', bars: 8 }); check(x.j && x.j.tracks.length === 4, '8-bit template: ' + (x.j && x.j.tracks.map((t) => t.sound).join(', ')));
    x = await call('write_notes', { track: 'Pulse 1', name: 'Theme', notes: ['E5', 'G5', 'B5', 'A5', 'G5', 'F#5', 'E5', 'D5', 'E5', 'B4', 'E5', 'G5', 'F#5', 'D5', 'E5', 'E5'].map((n, i) => ({ note: n, beat: i * 0.5, length: 0.45 })) });
    x = await call('write_chords', { track: 'Pulse 2', progression: 'Em C D Bm', rhythm: 'block', beats_per_chord: 2, repeat: 2 }); check(x.j && x.j.chords.length === 4, 'chip chords');
    x = await call('write_chords', { track: 'Triangle', progression: 'Em C D Bm', rhythm: 'bass-chip', beats_per_chord: 2, repeat: 2 });
    x = await call('add_track', { kind: 'instrument', sound: 'chip-arp', name: 'Arp' }); x = await call('write_chords', { track: 'Arp', progression: 'Em C D Bm', rhythm: 'chip-arp', beats_per_chord: 2, repeat: 2, octave: 5 });
    x = await call('write_drums', { track: 'Noise', style: 'chip-drive', bars: 4, fill: true }); check(x.j && x.j.clip.notes > 20, 'chip drums');
    x = await call('set_effects', { target: 'master', add: { type: 'crush', bits: 8, rate: 22050 } }); check(x.j && x.j.effects.some((f) => f.type === 'crush' && f.rate === 22050), 'crush with sample rate');
    x = await call('analyze', { target: 'mix' }); check(x.j && x.j.loudness_lufs > -24 && x.j.loudness_lufs < -6 && x.j.peak_dbfs <= -0.5, `8-bit mix ${x.j && x.j.loudness_lufs} LUFS, peak ${x.j && x.j.peak_dbfs}`);
    x = await call('open_song', { song: 'Night Drive' }); x = await call('make_8bit', { console: 'gameboy' }); check(x.j && x.j.changed.some((c) => c.to === 'gameboy') && x.j.changed.some((c) => c.to === 'gb-wave'), 'make_8bit: ' + (x.j && x.j.changed.map((c) => c.to).join(', ')));
    x = await call('analyze', { target: 'mix', bars: 4 }); check(x.j && x.j.loudness_lufs > -40, 'Game Boy version renders');
    // game sound effects
    x = await call('new_sfx_pack', { name: 'Skyline Protocol' }); check(x.j && x.j.created === 'Skyline Protocol', 'new pack');
    x = await call('make_sfx', { kind: 'coin', name: 'Coin', variations: 3 }); check(x.j && x.j.sounds.length === 3 && x.r.content.some((c) => c.type === 'image'), 'coin variations + picture');
    x = await call('make_sfx', { kind: 'big-explosion', name: 'Boss explodes' }); check(x.j && x.j.sounds[0].layers.length === 3 && x.j.sounds[0].seconds > 0.4, 'layered explosion ' + (x.j && x.j.sounds[0].seconds) + 's');
    x = await call('make_sfx', { name: 'Laser', layers: [{ kind: 'laser' }, { params: { wave: 'noise', freq: 0.7, sustain: 0.05, decay: 0.15 }, gain: -6 }], retro: true }); check(x.j && x.j.sounds[0].bits === 8 && x.j.sounds[0].layers.length === 2, 'custom layered retro laser');
    x = await call('edit_sfx', { sound: 'Coin A', params: { freq: 0.7 }, add_layer: { kind: 'blip', delay: 0.05, gain: -8, pitch: 12 }, name: 'Coin' }); check(x.j && x.j.sound.layers.length === 2, 'edit + add layer');
    x = await call('edit_sfx', { sound: 'Coin B', remove: true }); x = await call('edit_sfx', { sound: 'Coin C', mutate: 0.4, play: false });
    x = await call('list_sfx', { picture: true }); check(x.j && x.j.sounds.length === 4, 'list ' + (x.j && x.j.sounds.map((s) => s.name).join(', ')));
    const sfxDir = path.join(OUT, 'game', 'assets', 'sfx');
    x = await call('export_sfx', { format: 'all', folder: sfxDir, variations: 2 }); check(x.j && x.j.files.includes('coin.wav') && x.j.files.includes('coin_2.mp3') && x.j.files.some((f) => f.endsWith('.js')), 'export pack: ' + (x.j && x.j.files.length) + ' files');
    x = await call('open_song', { song: 'Castle Theme' });
    x = await call('sfx_to_song', { sound: 'Coin', at_bar: 2, beat: 1 }); check(x.j && x.j.bar > 2, 'sfx as clip at bar ' + (x.j && x.j.bar));
    x = await call('sfx_to_song', { sound: 'Boss explodes', pad: 'crash' }); check(x.j && x.j.pad === 'crash', 'sfx on a drum pad');
    x = await call('analyze', { target: 'mix', bars: 4 }); check(x.j && x.j.loudness_lufs > -30, 'song with sfx renders');
    x = await call('play_sfx', { sound: 'Laser', pack: 'Skyline Protocol' }); check(!x.r.isError, 'play_sfx');
    // plugin script over stdio → bridge → app
    const { spawn } = require('child_process'); const conn = require('../src/connectors'); conn.installScript(); const e = conn.connectorStatus().entry;
    const child = spawn(e.command, e.args, { env: { ...process.env, ...e.env } }); let buf = ''; const got = new Promise((res) => child.stdout.on('data', (d) => { buf += d; if (buf.endsWith('\n') && buf.split('\n').filter(Boolean).length >= 3) res(); }));
    const w = (m) => child.stdin.write(JSON.stringify(m) + '\n'); w({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'claude-code' } } }); w({ jsonrpc: '2.0', id: 2, method: 'tools/list' }); w({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_song', arguments: { picture: true } } });
    await Promise.race([got, new Promise((r) => setTimeout(r, 30000))]); child.kill();
    const lines = buf.split('\n').filter(Boolean).map((l) => JSON.parse(l)); const tl = lines.find((m) => m.id === 2); const gs = lines.find((m) => m.id === 3);
    check(tl && tl.result.tools.length >= 30, 'MCP tools/list ' + (tl && tl.result.tools.length)); check(gs && gs.result.content.some((c) => c.type === 'image'), 'MCP get_song via bridge returns a picture');
  } catch (e) { fails++; console.log('CRASH', e.stack); }
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); fs.writeFileSync(path.join(OUT, 'result.txt'), fails ? 'fail' : 'ok');
  if (process.env.MIXER_SHOTS) return; app.exit(fails ? 1 : 0);
});
