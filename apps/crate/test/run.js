// Crate — quick checks (no Electron needed): node test/run.js
// Set CRATE_TEST_URL to also download a real song through yt-dlp (needs the tools in CRATE_YTDLP / CRATE_DENO).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tools = require('../src/core/tools');
const audio = require('../src/core/audio');
const meta = require('../src/core/metadata');
const tags = require('../src/core/tags');
const library = require('../src/core/library');
const exporter = require('../src/core/exporter');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crate-test-'));
tools.init(path.join(tmp, 'appdata'));
const settings = { organize: true, pattern: '{albumartist}/{album}/{track} {title}', quality: '192', autoLookup: false, cleanTitles: true };
let passed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', e.stack || e); process.exitCode = 1; } }

async function tone(file, seconds = 6, extra = []) {
  const r = await tools.run(tools.ffmpeg(), ['-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-filter_complex', `[0]adelay=1000|1000,apad=pad_dur=1[a]`, '-map', '[a]', ...extra, file]);
  assert.strictEqual(r.code, 0, r.stderr);
}
async function picture(file, w = 1280, h = 720) {
  const r = await tools.run(tools.ffmpeg(), ['-y', '-f', 'lavfi', '-i', `color=c=red:s=${w}x${h}`, '-frames:v', '1', file]);
  assert.strictEqual(r.code, 0, r.stderr);
}

(async () => {
  console.log('Titles');
  await t('splits "Artist - Song (Official Video)"', () => assert.deepStrictEqual(meta.cleanTitle('Drake - Hotline Bling (Official Video)', 'DrakeVEVO'), { artist: 'Drake', title: 'Hotline Bling' }));
  await t('uses "X - Topic" channel as artist', () => assert.deepStrictEqual(meta.cleanTitle('Blinding Lights', 'The Weeknd - Topic'), { artist: 'The Weeknd', title: 'Blinding Lights' }));
  await t('moves "ft." into the title', () => assert.deepStrictEqual(meta.cleanTitle('Travis Scott ft. Drake - SICKO MODE (Audio)'), { artist: 'Travis Scott', title: 'SICKO MODE (feat. Drake)' }));
  await t('drops "| 4K" and lyric-video tags', () => assert.strictEqual(meta.cleanTitle('Kendrick Lamar - Not Like Us [Official Lyric Video] | 4K').title, 'Not Like Us'));
  await t('keeps remix/live markers', () => assert.strictEqual(meta.cleanTitle('Daft Punk - One More Time (Live) [Official Video]').title, 'One More Time (Live)'));

  console.log('Names');
  await t('pattern renders Artist/Album/NN Title.mp3', () => assert.strictEqual(library.renderPattern(settings.pattern, { artist: 'A, B', album: 'Al: Bum?', title: 'So/ng', track: 3 }), 'A/Al - Bum_/03 So-ng.mp3'));
  await t('no album → Singles, no number', () => assert.strictEqual(library.renderPattern(settings.pattern, { artist: 'Tems', title: 'Free Mind' }), 'Tems/Singles/Free Mind.mp3'));
  await t('multi-disc numbers', () => assert.strictEqual(library.renderPattern(settings.pattern, { artist: 'X', album: 'Y', title: 'Z', track: 4, disc: 2, discTotal: 2 }), 'X/Y/2-04 Z.mp3'));

  console.log('Audio');
  const wav = path.join(tmp, 'tone.wav');
  await tone(wav, 6);
  const mp3 = path.join(tmp, 'tone.mp3');
  await t('converts to MP3 at the chosen quality', async () => {
    let last = 0;
    await audio.toMp3(wav, mp3, { quality: '320', onProgress: (p) => { last = p; } });
    const p = await audio.probe(mp3);
    assert.strictEqual(p.codec, 'mp3'); assert(p.bitrate >= 300, 'bitrate ' + p.bitrate); assert(Math.abs(p.duration - 8) < 0.3, 'duration ' + p.duration); assert(last > 0.5);
  });
  await t('trim + fades + gain', async () => {
    const out = path.join(tmp, 'trim.mp3');
    await audio.toMp3(wav, out, { start: 1, end: 5, fadeIn: 0.5, fadeOut: 1, gainDb: -3, quality: '192' });
    const p = await audio.probe(out); assert(Math.abs(p.duration - 4) < 0.2, 'duration ' + p.duration);
  });
  await t('normalize (loudnorm)', async () => { const out = path.join(tmp, 'norm.mp3'); await audio.toMp3(wav, out, { normalize: true }); assert((await audio.probe(out)).duration > 7); });
  await t('waveform peaks', async () => { const w = await audio.peaks(mp3, 200); assert(w.peaks.length >= 190 && w.peaks.length <= 200); assert(w.peaks.some((x) => x[0] > 0.9)); assert(w.peaks[0][0] < 0.05); });
  await t('finds the leading/trailing silence', async () => { const s = await audio.silence(mp3, 8); assert(s.start > 0.7 && s.start < 1.1, JSON.stringify(s)); assert(s.end > 6.8 && s.end < 7.4, JSON.stringify(s)); });
  const pic = path.join(tmp, 'thumb.png');
  await picture(pic);
  await t('square artwork from a 16:9 thumbnail', async () => { const out = path.join(tmp, 'sq.jpg'); await audio.squareArt(pic, out, 600); const r = await tools.run(tools.ffmpeg(), ['-hide_banner', '-i', out]); assert(/ 600x600/.test(r.stderr), r.stderr); });

  console.log('Tags');
  await t('ID3 round trip with cover', async () => {
    const f = path.join(tmp, 'tagged.mp3'); fs.copyFileSync(mp3, f);
    const art = fs.readFileSync(path.join(tmp, 'sq.jpg'));
    tags.write(f, { title: 'Song', artist: 'Artist', album: 'Album', albumArtist: 'Artist', year: '2024', genre: 'Pop', track: 2, trackTotal: 9, disc: 1, discTotal: 1, lyrics: 'la la', comment: 'hi' }, art);
    const r = tags.read(f);
    assert.strictEqual(r.title, 'Song'); assert.strictEqual(r.albumArtist, 'Artist'); assert.strictEqual(r.track, 2); assert.strictEqual(r.trackTotal, 9);
    assert.strictEqual(r.year, '2024'); assert.strictEqual(r.lyrics, 'la la'); assert(r.image && r.image.buffer.length === art.length);
  });

  console.log('Library');
  const root = path.join(tmp, 'Library');
  library.open(root);
  let a; let b; let c;
  await t('adds songs into Artist/Album/NN Title.mp3', async () => {
    const f1 = path.join(tmp, 'a.mp3'); fs.copyFileSync(mp3, f1);
    const art = await library.prepareArt({ path: pic });
    a = await library.addTrack(f1, { title: 'One', artist: 'Band', album: 'First', track: 2 }, art, settings);
    assert.strictEqual(a.file, 'Band/First/02 One.mp3'); assert(fs.existsSync(path.join(root, a.file))); assert(a.hasArt);
    const f2 = path.join(tmp, 'b.mp3'); fs.copyFileSync(mp3, f2);
    b = await library.addTrack(f2, { title: 'Two', artist: 'Band', album: 'First', track: 1 }, null, settings);
    const f3 = path.join(tmp, 'c.mp3'); fs.copyFileSync(mp3, f3);
    c = await library.addTrack(f3, { title: 'Single', artist: 'Solo' }, null, settings);
    assert.strictEqual(c.file, 'Solo/Singles/Single.mp3');
  });
  await t('albums group and sort by track number', () => { const al = library.albums(); assert.strictEqual(al.length, 1); assert.deepStrictEqual(al[0].trackIds, [b.id, a.id]); assert.strictEqual(al[0].artTrackId, a.id); });
  await t('editing tags renames the file and cleans up empty folders', async () => {
    const [u] = await library.update([c.id], { album: 'Debut', albumArtist: 'Solo', track: 1 }, settings);
    assert.strictEqual(u.file, 'Solo/Debut/01 Single.mp3'); assert(!fs.existsSync(path.join(root, 'Solo', 'Singles')));
    assert.strictEqual(tags.read(path.join(root, u.file)).album, 'Debut');
  });
  await t('bulk album edit + shared artwork', async () => {
    const out = await library.update([a.id, b.id], { album: 'First (Deluxe)', year: '2020', genre: 'Rock' }, settings, { art: { trackId: a.id } });
    assert(out.every((x) => x.file.startsWith('Band/First (Deluxe)/') && x.hasArt));
    assert(tags.read(path.join(root, out[1].file)).image);
  });
  await t('reorder renumbers 1..n of n', async () => {
    const out = await library.reorder([a.id, b.id], settings);
    assert.deepStrictEqual(out.map((x) => [x.track, x.trackTotal]), [[1, 2], [2, 2]]);
    assert.strictEqual(library.get(a.id).file, 'Band/First (Deluxe)/01 One.mp3');
  });
  await t('audio edit keeps the original and can revert', async () => {
    const e = await library.applyEdit(a.id, { start: 1, end: 5, fadeOut: 1 });
    assert(Math.abs(e.duration - 4) < 0.3, 'edited ' + e.duration); assert(e.original && fs.existsSync(path.join(root, e.original)));
    assert.strictEqual(tags.read(path.join(root, e.file)).title, 'One');
    const e2 = await library.applyEdit(a.id, { start: 0, end: 6 });
    assert(Math.abs(e2.duration - 6) < 0.3, 'edits come from the original: ' + e2.duration);
    const r = await library.revertEdit(a.id);
    assert(Math.abs(r.duration - 8) < 0.3); assert(!r.original);
  });
  await t('rescan picks up files added outside Crate and forgets removed ones', async () => {
    const ext = path.join(root, 'Outside', 'Drop.mp3'); fs.mkdirSync(path.dirname(ext), { recursive: true }); fs.copyFileSync(mp3, ext);
    tags.write(ext, { title: 'Dropped', artist: 'Outside' }, null);
    fs.rmSync(path.join(root, library.get(c.id).file));
    const s = await library.scan(settings);
    assert.strictEqual(s.added, 1); assert.strictEqual(s.removed, 1);
    assert(library.all().some((x) => x.title === 'Dropped'));
  });
  await t('imports other formats as MP3 (with their tags)', async () => {
    const m4a = path.join(tmp, 'Artist X - Imported Song.m4a');
    await tone(m4a, 3, ['-c:a', 'aac']);
    const tagged = path.join(tmp, 'tagged.flac');
    await tone(tagged, 3, ['-metadata', 'title=Flac = Song', '-metadata', 'artist=Lossless', '-metadata', 'album=Hi-Res', '-metadata', 'track=3/10']);
    const r0 = await library.importFiles([tagged], settings);
    assert.strictEqual(r0.added[0].file, 'Lossless/Hi-Res/03 Flac = Song.mp3', JSON.stringify(r0));
    assert.strictEqual(r0.added[0].trackTotal, 10);
    const r = await library.importFiles([m4a], settings);
    assert.strictEqual(r.added.length, 1, JSON.stringify(r.failed)); assert.strictEqual(r.added[0].title, 'Imported Song'); assert(/\.mp3$/.test(r.added[0].file));
  });
  await t('playlists', () => { const p = library.savePlaylist({ name: 'Gym', add: [a.id, b.id] }); assert.strictEqual(library.playlists()[0].trackIds.length, 2); library.savePlaylist({ id: p.id, trackIds: [b.id] }); assert.deepStrictEqual(library.playlists()[0].trackIds, [b.id]); });

  console.log('Export');
  await t('folder export mirrors the library and writes playlists, then skips unchanged', async () => {
    const dest = path.join(tmp, 'Phone');
    const ids = library.all().map((x) => x.id);
    const r = await exporter.run({ mode: 'folder', folder: dest, trackIds: ids, playlistIds: library.playlists().map((p) => p.id) });
    assert.strictEqual(r.copied, ids.length); assert.strictEqual(r.playlists, 1);
    assert(fs.existsSync(path.join(dest, 'Band', 'First (Deluxe)', '01 One.mp3')));
    assert(fs.readFileSync(path.join(dest, 'Gym.m3u8'), 'utf8').includes('Band/First (Deluxe)/02 Two.mp3'));
    const r2 = await exporter.run({ mode: 'folder', folder: dest, trackIds: ids, onlyNew: true });
    assert.strictEqual(r2.copied, 0);
  });
  await t('index is saved', () => { library.flush(); const j = JSON.parse(fs.readFileSync(path.join(root, '.crate', 'library.json'), 'utf8')); assert(Object.keys(j.tracks).length >= 4); });

  if (process.env.CRATE_TEST_URL) {
    console.log('Download (live)');
    const dl = require('../src/core/downloader');
    const s = { ...settings, autoLookup: true, preferCatalogArt: true, quality: '320', concurrency: 1 };
    dl.configure({ settings: () => s });
    await t('probe', async () => { const p = await dl.probe(process.env.CRATE_TEST_URL, s); console.log('     ', p.kind, p.title, p.uploader); });
    await t('download → tagged MP3 in the library', async () => {
      const p = await dl.probe(process.env.CRATE_TEST_URL, s);
      const done = new Promise((res) => dl.configure({ onUpdate: (j) => { if (j && ['done', 'error'].includes(j.status)) res(j); } }));
      dl.enqueue([p]);
      const j = await done;
      assert.strictEqual(j.status, 'done', j.error);
      const tr = library.get(j.trackId);
      console.log('     ', tr.file, '|', tr.artist, '|', tr.title, '|', tr.album, tr.year, tr.genre, tr.hasArt ? 'art' : 'no art', tr.bitrate + 'kbps');
    });
  }

  console.log(`\n${passed} passed${process.exitCode ? ', some failed' : ''}`);
  library.flush();
  fs.rmSync(tmp, { recursive: true, force: true });
})();
