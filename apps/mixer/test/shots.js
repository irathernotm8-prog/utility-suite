// Mixer — screenshots of every screen (dark and light) with a song Claude-style tools built, plus a check that the
// window has no script errors. Run: xvfb-run -a electron test/shots.js <outDir>
'use strict';
const path = require('path'); const fs = require('fs'); const os = require('os');
const OUT = path.resolve(process.argv[process.argv.length - 1].endsWith('shots.js') ? path.join(os.tmpdir(), 'mixer-shots') : process.argv[process.argv.length - 1]);
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
process.env.MIXER_E2E = '1'; process.env.MIXER_USER_DATA = path.join(OUT, 'userdata'); process.env.MIXER_SONGS = path.join(OUT, 'songs');
const { app, BrowserWindow } = require('electron');
const { handle } = require('../src/main.js');
const W = require('../src/core/wav');
const errors = [];
const call = async (n, a) => { const r = await handle(n, a, 'Claude'); if (r.isError) console.log('!', n, r.content[0].text); try { return JSON.parse(r.content[0].text); } catch { return null; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  await wait(1200);
  let win; for (let i = 0; i < 40 && !win; i++) { win = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Mixer' && w.webContents.getURL().includes('renderer')); await wait(250); }
  win.setSize(1480, 920); win.show();
  win.webContents.on('console-message', (e, level, msg, line, src) => { if (level >= 3 || /Uncaught|TypeError|ReferenceError/.test(msg)) errors.push(`${msg} (${String(src).split('/').pop()}:${line})`); });
  const js = (code) => win.webContents.executeJavaScript(code);
  let n = 0; const shot = async (name, ms = 700) => { await wait(ms); const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`), img.toPNG()); };
  // a song built the way Claude would
  await call('new_song', { name: 'Night Drive', bpm: 104, key: 'A minor', bars: 16 });
  await call('set_song', { markers: [{ bar: 1, name: 'Intro' }, { bar: 9, name: 'Drop' }] });
  await call('add_track', { kind: 'drums', sound: '808', name: 'Drums' }); await call('write_drums', { track: 'Drums', style: 'trap', bars: 4, start_bar: 9, fill: true });
  await call('add_track', { kind: 'instrument', sound: '808', name: '808' }); await call('write_chords', { track: '808', progression: 'i VI III VII', rhythm: 'bass-808', start_bar: 9 });
  await call('add_track', { kind: 'instrument', sound: 'warm-pad', name: 'Pad' }); await call('write_chords', { track: 'Pad', progression: 'Am F C G', repeat: 3, spread: true });
  await call('add_track', { kind: 'instrument', sound: 'electric-piano', name: 'Keys' }); await call('write_chords', { track: 'Keys', progression: 'Am7 Fmaj7 C G', rhythm: 'arp-up', start_bar: 5, repeat: 2 });
  await call('add_track', { kind: 'instrument', sound: 'saw-lead', name: 'Lead' }); await call('write_notes', { track: 'Lead', start_bar: 9, name: 'Hook', notes: [{ note: 'E5', beat: 0, length: 0.75 }, { note: 'D5', beat: 1, length: 0.5 }, { note: 'C5', beat: 1.5, length: 1 }, { note: 'A4', beat: 3, length: 1 }, { note: 'C5', beat: 4, length: 1 }, { note: 'D5', beat: 5, length: 0.5 }, { note: 'E5', beat: 6, length: 1.5 }, { note: 'G5', beat: 8, length: 0.5 }, { note: 'E5', beat: 8.5, length: 1 }, { note: 'D5', beat: 10, length: 2 }, { note: 'C5', beat: 12, length: 0.5 }, { note: 'B4', beat: 12.5, length: 0.5 }, { note: 'A4', beat: 13, length: 3 }] });
  await call('set_effects', { target: 'Pad', add: { type: 'duck', source: 'Drums', voice: 'kick', amount: -8 } });
  await call('automate', { track: 'Pad', param: 'volume', points: [[1, -16], [9, -4]] });
  await call('arrange', { action: 'copy', from_bar: 9, bars: 4, to_bar: 13, tracks: ['Drums', '808', 'Lead'] });
  await wait(800);
  await js(`go('arrange')`); await shot('arrange');
  await js(`(() => { const c = S.song.clips.find((c) => c.name === 'Hook'); S.sel = { track: c.track, clip: c.id }; S.editor = c.id; render(); })()`); await shot('piano-roll');
  await js(`(() => { const c = S.song.clips.find((c) => track(c.track).kind === 'drums'); S.sel = { track: c.track, clip: c.id }; S.editor = c.id; render(); })()`); await shot('drum-grid');
  await js(`go('mix')`); await shot('mix');
  await js(`checkMix()`); await wait(6000); await shot('mix-checked', 400);
  await js(`(() => { const b = document.querySelector('.fxp'); b.click(); })()`); await shot('effect-editor');
  await js(`closePop(); go('sounds')`); await shot('sounds');
  await js(`go('songs')`); await shot('songs', 1200);
  await js(`go('connections')`); await shot('connections', 1500);
  await js(`go('settings')`); await shot('settings');
  await js(`go('arrange'); exportSheet()`); await shot('export-sheet');
  await js(`closeSheet(); askClaude()`); await shot('ask');
  await js(`closeSheet()`);
  // editing a recording
  const sr = 44100, len = sr * 10; const L = new Float32Array(len), R = new Float32Array(len); for (let b = 0; b * 0.5 < 10; b++) { const s0 = Math.round(b * 0.5 * sr); for (let i = 0; i < 3000 && s0 + i < len; i++) { const v = Math.sin(2 * Math.PI * 55 * i / sr) * Math.exp(-i / 500) * 0.7; L[s0 + i] += v; R[s0 + i] += v; } } for (let i = 0; i < len; i++) { L[i] += 0.05 * Math.sin(2 * Math.PI * 164.81 * i / sr) + 0.03 * Math.sin(2 * Math.PI * 246.94 * i / sr); R[i] += 0.05 * Math.sin(2 * Math.PI * 196 * i / sr); }
  const rec = path.join(OUT, 'band demo.wav'); fs.writeFileSync(rec, W.encode([L, R], sr, 16));
  await call('new_song', { name: 'Remix', bpm: 100 }); const im = await call('import_audio', { path: rec, adopt_tempo: true }); await call('edit_clip', { clip: im.clip, fade_in: 0.4, fade_out: 1.2 });
  await call('add_track', { kind: 'drums', sound: '909', name: 'Drums' }); await call('write_drums', { track: 'Drums', style: 'house', bars: 4 });
  await wait(800);
  await js(`(() => { const c = S.song.clips.find((c) => c.file); S.sel = { track: c.track, clip: c.id }; S.editor = c.id; render(); })()`); await shot('audio-editor', 1500);
  // 8-bit song
  await call('new_song', { name: 'Castle Theme', template: 'chiptune', bpm: 150, key: 'E minor', bars: 8 });
  await call('write_notes', { track: 'Pulse 1', name: 'Theme', notes: ['E5', 'G5', 'B5', 'A5', 'G5', 'F#5', 'E5', 'D5', 'E5', 'B4', 'E5', 'G5', 'F#5', 'D5', 'E5', 'E5'].map((x, i) => ({ note: x, beat: i * 0.5, length: 0.45 })) });
  await call('write_chords', { track: 'Pulse 2', progression: 'Em C D Bm', beats_per_chord: 2, repeat: 2 }); await call('write_chords', { track: 'Triangle', progression: 'Em C D Bm', rhythm: 'bass-chip', beats_per_chord: 2, repeat: 2 }); await call('write_drums', { track: 'Noise', style: 'chiptune', bars: 4, fill: true });
  await wait(600); await js(`S.editor = null; go('arrange')`); await shot('chip-song');
  await js(`(() => { const c = S.song.clips.find((c) => track(c.track).name.startsWith('Pulse 2')); S.sel = { track: c.track, clip: c.id }; S.editor = c.id; render(); })()`); await shot('chip-chords');
  await js(`S.editor = null; S.sndCat = 'Chip'; go('sounds')`); await shot('sounds-chip');
  // game sound effects
  await call('new_sfx_pack', { name: 'Skyline Protocol' });
  for (const k of ['coin', 'jump', 'laser', 'powerup', 'hit', 'big-explosion', 'level-up']) await call('make_sfx', { kind: k, name: { coin: 'Coin', jump: 'Jump', laser: 'Laser', powerup: 'Power-up', hit: 'Hurt', 'big-explosion': 'Boss explodes', 'level-up': 'Level up' }[k], seed: 7, play: false });
  await js(`FXS.pack = null; FXS.sel = null; go('sfx')`); await shot('sfx', 1500);
  await js(`(async () => { FXS.sel = FXS.pack.sounds.find((s) => s.name === 'Boss explodes').id; FXS.layer = 1; render(); })()`); await shot('sfx-layers', 1200);
  await js(`document.querySelector('#sfxVars').click()`); await shot('sfx-variations', 900);
  await js(`sfxExportSheet()`); await shot('sfx-export'); await js(`closeSheet()`);
  // light theme
  await js(`S.settings.theme = 'light'; applyThemeNow(); render()`); await shot('light-arrange', 1200);
  await call('open_song', { song: 'Night Drive' }); await wait(500); await js(`go('mix')`); await shot('light-mix');
  // the empty state
  await call('new_song', { name: 'Empty' }); await wait(400); await js(`S.settings.theme = 'dark'; applyThemeNow(); go('arrange')`); await shot('empty');
  // playback runs without errors
  await call('open_song', { song: 'Night Drive' }); await wait(300); await js(`Player.play(SG.barToBeat(S.song, 9))`); await wait(2500); const pos = await js(`Player.position()`); await js(`Player.stop()`);
  console.log('playback reached beat', pos.toFixed(2));
  console.log(errors.length ? 'WINDOW ERRORS:\n' + errors.join('\n') : 'no window errors');
  fs.writeFileSync(path.join(OUT, 'errors.txt'), errors.join('\n'));
  app.exit(0);
});
