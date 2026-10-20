// Interchange (EDL / FCPXML / OTIO), captions (SRT / VTT / chapters) and OpenRaster tests.
// Plain node: prints `ok …` per check, exits non-zero on the first failure.
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const assert = require('assert');
const ix = require('../engine/interchange');
const cap = require('../engine/captions');
const ora = require('../engine/ora');

let failed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------- fixtures ----------

const project = fps => ({
  name: 'My Edit & "Co"',
  settings: { width: 1920, height: 1080, fps },
  clips: [
    { path: '/media/Clip A.mp4', name: 'Clip A', kind: 'video', in: 0, out: 4, speed: 1, volume: 0.5, hasAudio: true, sourceDuration: 10, transition: { type: 'dissolve', duration: 1 } },
    { path: '/media/clip-b é.mov', name: 'Clip B', kind: 'video', in: 2, out: 6, speed: 2, hasAudio: true, sourceDuration: 8, transition: { type: 'none' } },
    { path: '/media/still.jpg', name: 'Still', kind: 'image', in: 0, out: 3 },
  ],
  overlays: [
    { path: '/media/logo.png', name: 'Logo', kind: 'image', start: 1, in: 0, out: 2, x: 0.9, y: 0.1, scale: 0.1, opacity: 0.8 },
    { kind: 'title', start: 2, in: 0, out: 2, text: 'Hello <world> & you' },
  ],
  audio: [{ path: '/media/music.mp3', name: 'Music', start: 0, in: 5, out: 13, volume: 0.6 }],
  markers: [{ time: 2, name: 'Beat', color: 'red' }, { time: 6, name: 'Drop', color: '#00ff00' }],
});

const eventLines = edl => edl.split('\n').filter(l => /^\d{3}  /.test(l));
const tcs = l => l.trim().split(/\s+/).slice(-4);

// ---------- EDL ----------

for (const fps of [30, 29.97]) {
  test(`EDL @${fps}: events, dissolve, M2, timecodes`, () => {
    const edl = ix.toEDL(project(fps));
    assert.match(edl, /^TITLE: My Edit/);
    assert.match(edl, /FCM: NON-DROP FRAME/);
    const ev = eventLines(edl);
    assert.strictEqual(ev.length, 4, 'three events, the dissolve being two lines');
    assert.strictEqual(new Set(ev.map(l => l.slice(0, 3))).size, 3);
    assert.deepStrictEqual(tcs(ev[0]), ['00:00:00:00', '00:00:03:00', '01:00:00:00', '01:00:03:00']);
    assert.match(ev[0], /^001  AX       V     C        00:00:00:00/);
    assert.deepStrictEqual(tcs(ev[1]), ['00:00:03:00', '00:00:03:00', '01:00:03:00', '01:00:03:00']);
    assert.match(ev[2], /^002  AX       V     D    030 /);
    assert.deepStrictEqual(tcs(ev[2]), ['00:00:02:00', '00:00:04:00', '01:00:03:00', '01:00:05:00']);
    assert.deepStrictEqual(tcs(ev[3]), ['00:00:00:00', '00:00:03:00', '01:00:05:00', '01:00:08:00']);
    assert.match(edl, fps === 30 ? /^M2   AX +060\.0 +00:00:02:00$/m : /^M2   AX +059\.9 +00:00:02:00$/m);
    assert.match(edl, /\* FROM CLIP NAME: Clip A/);
    assert.match(edl, /\* TO CLIP NAME: Clip B/);
    assert.match(edl, /\* SOURCE FILE: \/media\/still\.jpg/);
    assert.match(edl, /\* LOC: 01:00:02:00 RED     Beat/);
    assert.match(edl, /\* LOC: 01:00:06:00 GREEN   Drop/);
    return `${ev.length} lines`;
  });
}
test('EDL @29.97 drop frame', () => {
  const edl = ix.toEDL(project(29.97), { dropFrame: true });
  assert.match(edl, /FCM: DROP FRAME/);
  assert.deepStrictEqual(tcs(eventLines(edl)[0]), ['00:00:00;00', '00:00:03;00', '01:00:00;00', '01:00:03;00']);
  const R = ix.rateOf(29.97);
  assert.strictEqual(ix.timecode(1800, R, true), '00:01:00;02');
  assert.strictEqual(ix.timecode(1799, R, true), '00:00:59;29');
  assert.strictEqual(ix.timecode(17982, R, true), '00:10:00;00');
  assert.strictEqual(ix.timecode(1800, R, false), '00:01:00:00');
});

// ---------- FCPXML ----------

/** Tag-balance well-formedness check + entity sanity. Returns element names in order. */
function wellFormed(xml) {
  const body = xml.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[^>]*>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const stack = [], names = [];
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/g;
  let m, last = 0;
  while ((m = re.exec(body))) {
    const between = body.slice(last, m.index);
    assert.ok(!/[<>]/.test(between), `stray markup near: ${between.slice(0, 60)}`);
    assert.ok(!/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(between + m[3]), `bad entity near: ${m[0]}`);
    last = re.lastIndex;
    if (m[1]) assert.strictEqual(stack.pop(), m[2], `mismatched </${m[2]}>`);
    else { names.push(m[2]); if (!m[4]) stack.push(m[2]); }
  }
  assert.ok(!/[<>]/.test(body.slice(last)), 'trailing markup');
  assert.strictEqual(stack.length, 0, `unclosed: ${stack.join(',')}`);
  return names;
}
const attrsOf = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}(?=[\\s/>])([^>]*)>`, 'g'))].map(m => Object.fromEntries([...m[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map(a => [a[1], a[2]])));

test('FCPXML @30: well-formed, spine, connected clips, markers', () => {
  const x = ix.toFCPXML(project(30));
  const names = wellFormed(x);
  assert.ok(names[0] === 'fcpxml' && x.includes('version="1.9"'));
  assert.ok(x.includes('frameDuration="1/30s"'));
  const assets = attrsOf(x, 'asset');
  assert.strictEqual(assets.length, 5, 'one asset per unique path');
  assert.ok(x.includes('src="file:///media/Clip%20A.mp4"'));
  assert.ok(x.includes('src="file:///media/clip-b%20%C3%A9.mov"'));
  const clips = attrsOf(x, 'asset-clip');
  const main = clips.filter(c => !c.lane);
  assert.deepStrictEqual(main.map(c => [c.offset, c.start, c.duration]), [['0s', '0s', '7/2s'], ['7/2s', '5/2s', '3/2s'], ['5s', '0s', '3s']]);
  const tr = attrsOf(x, 'transition');
  assert.deepStrictEqual(tr.map(t => [t.offset, t.duration]), [['3s', '1s']]);
  assert.ok(/<timeMap>[\s\S]*value="2s"[\s\S]*value="6s"[\s\S]*<\/timeMap>/.test(x), 'timeMap maps 2s→6s of media');
  assert.ok(x.includes('<adjust-volume amount="-6.02dB"/>'));
  const logo = clips.find(c => c.name === 'Logo');
  assert.deepStrictEqual([logo.lane, logo.offset, logo.duration], ['1', '1s', '2s']);
  const music = clips.find(c => c.name === 'Music');
  assert.deepStrictEqual([music.lane, music.offset, music.start, music.duration], ['-1', '0s', '5s', '8s']);
  assert.ok(x.includes('Hello &lt;world&gt; &amp; you'));
  assert.ok(/<title ref="r\d+" lane="2"[^>]*offset="2s"/.test(x), 'title on lane 2 (overlaps logo)');
  assert.ok(x.includes('name="My Edit &amp; &quot;Co&quot;"'));
  assert.deepStrictEqual(attrsOf(x, 'marker').map(m => [m.start, m.value]), [['2s', 'Beat'], ['1s', 'Drop']]);   // Drop at 6 s lands 1 s into the still
  return `${clips.length} asset-clips`;
});
test('FCPXML @29.97: rational frame-aligned times', () => {
  const x = ix.toFCPXML(project(29.97));
  wellFormed(x);
  assert.ok(x.includes('frameDuration="1001/30000s"'));
  const main = attrsOf(x, 'asset-clip').filter(c => !c.lane);
  assert.deepStrictEqual(main.map(c => c.offset), ['0s', '7007/2000s', '1001/200s']);   // frames 0, 105, 150
});
test('FCPXML: empty project still valid', () => {
  wellFormed(ix.toFCPXML({ name: 'x', settings: { width: 1280, height: 720, fps: 25 }, clips: [], overlays: [], audio: [], markers: [{ time: 1, name: 'm' }] }));
});

// ---------- OTIO ----------

test('OTIO: parses, tracks, clips, transition, markers', () => {
  const s = ix.toOTIO(project(30));
  assert.ok(s.startsWith('{\n  "OTIO_SCHEMA": "Timeline.1"'));
  const t = JSON.parse(s);
  const tracks = t.tracks.children;
  assert.strictEqual(t.tracks.OTIO_SCHEMA, 'Stack.1');
  assert.deepStrictEqual(tracks.map(k => [k.name, k.kind]), [['V1', 'Video'], ['V2', 'Video'], ['V3', 'Video'], ['A1', 'Audio']]);
  const kinds = k => k.children.map(c => c.OTIO_SCHEMA);
  assert.deepStrictEqual(kinds(tracks[0]), ['Clip.2', 'Transition.1', 'Clip.2', 'Clip.2']);
  assert.deepStrictEqual(kinds(tracks[1]), ['Gap.1', 'Clip.2']);   // logo 1–3 s
  assert.deepStrictEqual(kinds(tracks[2]), ['Gap.1', 'Gap.1']);   // title 2–4 s overlaps the logo → own track, written as a named gap
  assert.strictEqual(tracks[2].children[1].name, 'Hello <world> & you');
  assert.deepStrictEqual(kinds(tracks[3]), ['Clip.2']);
  const [a, tr, b] = tracks[0].children;
  assert.deepStrictEqual([a.source_range.start_time.value, a.source_range.duration.value], [0, 105]);
  assert.deepStrictEqual([tr.in_offset.value, tr.out_offset.value], [15, 15]);
  assert.deepStrictEqual([b.source_range.start_time.value, b.source_range.duration.value], [90, 45]);
  assert.strictEqual(b.effects[0].time_scalar, 2);
  assert.strictEqual(a.media_references.DEFAULT_MEDIA.target_url, 'file:///media/Clip%20A.mp4');
  // total main length = 240 frames = 8 s
  assert.strictEqual(tracks[0].children.filter(c => c.OTIO_SCHEMA === 'Clip.2').reduce((n, c) => n + c.source_range.duration.value, 0), 240);
  assert.strictEqual(t.tracks.markers.length, 2);
  assert.strictEqual(t.tracks.markers[1].color, 'GREEN');
});

// ---------- captions ----------

test('SRT round trip', () => {
  const cues = [{ start: 1, end: 2.5, text: 'Hello' }, { start: 3, end: 4, text: '<i>Two</i>\nlines' }];
  const srt = cap.toSRT(cues);
  assert.strictEqual(srt.split('\n')[1], '00:00:01,000 --> 00:00:02,500');
  assert.deepStrictEqual(cap.parseSRT(srt), cues);
  assert.deepStrictEqual(cap.parse(srt, 'x.srt'), cues);
});
test('SRT messy input', () => {
  const messy = '﻿1\r\n00:00:05,000 --> 00:00:06,000\r\nLater\r\n\r\n00:00:01.5 --> 00:00:02.000\r\nNo index, dot ms\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nRun-on cue\r\n\r\ngarbage block\r\n\r\n4\r\n00:00:09,000 --> 00:00:08,000\r\ninverted\r\n';
  const c = cap.parseSRT(messy);
  assert.deepStrictEqual(c.map(x => [x.start, x.end, x.text]), [[1.5, 2, 'No index, dot ms'], [3, 4, 'Run-on cue'], [5, 6, 'Later']]);
});
test('VTT round trip + messy input', () => {
  const cues = [{ start: 0.5, end: 1, text: 'A' }, { start: 61, end: 3725.25, text: '<b>B</b>' }];
  const vtt = cap.toVTT(cues);
  assert.ok(vtt.startsWith('WEBVTT\n\n00:00:00.500 --> 00:00:01.000\nA\n'));
  assert.deepStrictEqual(cap.parseVTT(vtt), cues);
  const messy = '﻿WEBVTT - title\r\nKind: captions\r\n\r\nSTYLE\r\n::cue { color: red }\r\n\r\nNOTE this is\r\na comment\r\n\r\nintro\r\n00:05.000 --> 00:07.250 line:90% align:center\r\n<v Bob>Hi <c.loud>there</c></v>\r\n\r\n00:00:01.000 --> 00:00:02.000\r\n<i>first</i>\r\n';
  const c = cap.parse(messy);
  assert.deepStrictEqual(c.map(x => [x.start, x.end, x.text]), [[1, 2, '<i>first</i>'], [5, 7.25, 'Hi there']]);
  assert.strictEqual(c[1].settings, 'line:90% align:center');
  assert.ok(cap.toVTT(c).includes('00:00:05.000 --> 00:00:07.250 line:90% align:center\nHi there'));
  assert.deepStrictEqual(cap.toSRT(c).split('\n').slice(0, 3), ['1', '00:00:01,000 --> 00:00:02,000', '<i>first</i>']);
  assert.deepStrictEqual(cap.parse('not captions at all'), []);
});

test('YouTube chapters + warnings', () => {
  const r = cap.toChapters([{ time: 30, name: 'Main' }, { time: 95, name: 'Outro' }, { time: 100, name: 'Credits' }], 200);
  assert.strictEqual(r.text, '0:00 Intro\n0:30 Main\n1:40 Credits', 'Outro (5 s) merged into Main');
  assert.ok(r.warnings.some(w => /Intro/.test(w)));
  assert.ok(r.warnings.some(w => /"Outro".*merged into "Main"/.test(w)));
  assert.ok(!r.warnings.some(w => /at least 3/.test(w)));
  const few = cap.toChapters([{ time: 4, name: 'Start' }, { time: 60, name: 'End' }], 120);
  assert.strictEqual(few.text, '0:00 Start\n1:00 End');
  assert.ok(few.warnings.some(w => /at least 3/.test(w)));
  const tail = cap.toChapters([{ time: 0, name: 'A' }, { time: 20, name: 'B' }, { time: 40, name: 'C' }, { time: 115, name: 'D' }], 120);
  assert.strictEqual(tail.text, '0:00 A\n0:20 B\n0:40 C', 'last chapter < 10 s merged');
  assert.strictEqual(cap.toChapters([{ time: 3700, name: 'X' }], 4000).text, '0:00:00 Intro\n1:01:40 X');
});
test('FFMETADATA chapters', () => {
  const m = cap.toFFMetadata([{ time: 10, name: 'b=c;d#e\\f' }, { time: 0, name: 'Line\nbreak' }], 20.5);
  assert.strictEqual(m, ';FFMETADATA1\n\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=10000\ntitle=Line\\\nbreak\n\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=10000\nEND=20500\ntitle=b\\=c\\;d\\#e\\\\f\n');
});

// ---------- ORA ----------

test('ORA write → read round trip', async () => {
  const sharp = require('sharp');
  const red = await sharp({ create: { width: 4, height: 3, channels: 4, background: '#ff0000' } }).png().toBuffer();
  const blue = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#0000ff' } }).png().toBuffer();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ro3-ora-'));
  const file = path.join(dir, 'test file.ora');
  const doc = {
    width: 4, height: 3, merged: red,
    layers: [
      { name: 'Background', png: red, x: 0, y: 0, opacity: 1, visible: true, blend: 'source-over' },
      { name: 'Top & "quoted"', png: blue, x: 1, y: 1, opacity: 0.5, visible: false, blend: 'multiply' },
    ],
  };
  ora.writeORA(file, doc);
  const back = ora.readORA(file);
  assert.deepStrictEqual([back.width, back.height], [4, 3]);
  assert.strictEqual(back.layers.length, 2);
  assert.deepStrictEqual(back.layers.map(l => [l.name, l.x, l.y, l.opacity, l.visible, l.blend]),
    [['Background', 0, 0, 1, true, 'source-over'], ['Top & "quoted"', 1, 1, 0.5, false, 'multiply']]);
  assert.ok(back.layers[0].png.equals(red) && back.layers[1].png.equals(blue));
  assert.ok(back.merged.equals(red) && back.thumbnail.equals(red));
  const meta = await sharp(back.layers[1].png).metadata();
  assert.deepStrictEqual([meta.width, meta.height], [2, 2]);
  // Blend-mode mapping both ways.
  assert.strictEqual(ora.svgOp('lighter'), 'svg:plus');
  assert.strictEqual(ora.canvasOp('svg:plus'), 'lighter');
  assert.strictEqual(ora.canvasOp('krita:dissolve'), 'source-over');
  // System unzip agrees: valid archive, mimetype first and stored.
  let sys = 'unzip not available';
  try {
    execFileSync('unzip', ['-tq', file]);
    const info = execFileSync('zipinfo', [file]).toString().split('\n').filter(l => /^[-d]/.test(l));
    assert.match(info[0], /\bstor\b.*\bmimetype$/);
    assert.ok(info.slice(1).every(l => /\bdefN|\bdefX|\bdef[A-Z]/.test(l)), 'other entries deflated');
    const names = info.map(l => l.split(/\s+/).pop());
    assert.deepStrictEqual(names, ['mimetype', 'stack.xml', 'data/layer0.png', 'data/layer1.png', 'mergedimage.png', 'Thumbnails/thumbnail.png']);
    sys = 'zipinfo: mimetype first + stored';
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  // Raw bytes: mimetype at offset 30 of the file, no extra field.
  const buf = fs.readFileSync(file);
  assert.strictEqual(buf.readUInt16LE(8), 0);
  assert.strictEqual(buf.readUInt16LE(28), 0);
  assert.strictEqual(buf.toString('ascii', 30, 54), 'mimetypeimage/openraster');
  assert.ok(ora.unzip(buf).get('stack.xml').toString('utf8').includes('<layer name="Top &amp; &quot;quoted&quot;" src="data/layer1.png"'), 'top layer listed first');
  fs.rmSync(dir, { recursive: true, force: true });
  return sys;
});
test('ORA nested stacks flatten', () => {
  const png = Buffer.from('x');
  const stack = '<?xml version="1.0"?><image w="10" h="8"><stack><stack name="g" x="2" opacity="0.5" visibility="hidden"><layer name="in" src="data/a.png" x="1" opacity="0.5" composite-op="svg:screen"/></stack><layer name=\'bottom\' src="data/b.png"/></stack></image>';
  const buf = ora.zip([{ name: 'mimetype', data: Buffer.from('image/openraster'), store: true }, { name: 'stack.xml', data: Buffer.from(stack) }, { name: 'data/a.png', data: png }, { name: 'data/b.png', data: png, store: true }]);
  const d = ora.parseORA(buf);
  assert.deepStrictEqual(d.layers.map(l => [l.name, l.x, l.opacity, l.visible, l.blend]), [['bottom', 0, 1, true, 'source-over'], ['in', 3, 0.25, false, 'screen']]);
  assert.strictEqual(ora.crc32(Buffer.from('123456789')), 0xcbf43926);
});

// ---------- run ----------

(async () => {
  for (const [name, fn] of tests) {
    try {
      const r = await fn();
      console.log('ok  ', name, r ? `(${r})` : '');
    } catch (e) {
      failed++;
      console.log('FAIL', name, '\n     ', e.message.split('\n').slice(0, 8).join('\n      '));
    }
  }
  if (failed) { console.log(`${failed} FAILED`); process.exit(1); }
  console.log('ALL PASSED');
})();
