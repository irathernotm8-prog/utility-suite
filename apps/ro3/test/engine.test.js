// Engine smoke test: generates sample media with FFmpeg, then exercises every converter.
const path = require('path'), fs = require('fs'), os = require('os');
const { runFfmpeg, probe } = require('../engine/ffmpeg');
const img = require('../engine/image');
const media = require('../engine/media');
const tl = require('../engine/timeline');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ro3-test-'));
const p = f => path.join(dir, f);
let failed = 0;
async function step(name, fn) {
  const t = Date.now();
  try { const r = await fn(); console.log('ok  ', name, r ? JSON.stringify(r).slice(0, 110) : '', `${Date.now() - t}ms`); }
  catch (e) { failed++; console.log('FAIL', name, e.message.slice(0, 400)); }
}
(async () => {
  await runFfmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', p('a.mkv')]);
  await runFfmpeg(['-f', 'lavfi', '-i', 'mandelbrot=size=640x480:rate=25', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', p('b.mp4')]);
  await runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=10', p('music.mp3')]);
  // Logo-ish PNG with transparency
  const sharp = require('sharp');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><circle cx="200" cy="200" r="150" fill="#1fbf6a"/><rect x="330" y="80" width="220" height="240" rx="30" fill="#0b3d24"/><text x="90" y="380" font-size="40" font-family="sans-serif" fill="#000">RO3</text></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(p('logo.png'));
  await runFfmpeg(['-i', p('logo.png'), p('logo.bmp')]);

  for (const f of ['jpg', 'webp', 'avif', 'tiff', 'gif', 'bmp', 'ico', 'pdf'])
    await step('png→' + f, () => img.convertImage({ input: p('logo.png'), output: p('out.' + f), quality: 85 }));
  await step('bmp→png (ffmpeg decode)', () => img.convertImage({ input: p('logo.bmp'), output: p('frombmp.png') }));
  await step('ico→png', () => img.convertImage({ input: p('out.ico'), output: p('fromico.png') }));
  for (const mode of ['color', 'bw', 'posterize'])
    await step('png→svg ' + mode, async () => { const r = await img.convertImage({ input: p('logo.png'), output: p(`trace-${mode}.svg`), trace: { mode, preset: 'logo' } }); return { ...r, head: fs.readFileSync(r.output, 'utf8').slice(0, 90) }; });
  await step('svg→png (re-raster traced)', () => img.convertImage({ input: p('trace-color.svg'), output: p('retrace.png') }));
  await step('probe mkv', () => probe(p('a.mkv')));
  await step('mkv→mp4 fast copy', () => media.convertMedia({ input: p('a.mkv'), output: p('a.mp4'), fastCopy: true }));
  await step('mkv→webm', () => media.convertMedia({ input: p('a.mkv'), output: p('a.webm'), quality: 'small' }));
  await step('mkv→mov 480p', () => media.convertMedia({ input: p('a.mkv'), output: p('a.mov'), resize: { height: 480 } }));
  await step('mkv→avi', () => media.convertMedia({ input: p('a.mkv'), output: p('a.avi') }));
  await step('mkv→gif', () => media.convertMedia({ input: p('a.mkv'), output: p('a.gif') }));
  await step('mkv→mp3', () => media.convertMedia({ input: p('a.mkv'), output: p('a.mp3') }));
  await step('mp3→flac', () => media.convertMedia({ input: p('music.mp3'), output: p('m.flac') }));
  await step('mp3→opus', () => media.convertMedia({ input: p('music.mp3'), output: p('m.opus') }));
  await step('no-audio→mp3 error', async () => { try { await media.convertMedia({ input: p('b.mp4'), output: p('b.mp3') }); throw new Error('should fail'); } catch (e) { if (/no audio/.test(e.message)) return e.message; throw e; } });
  await step('filmstrip', async () => (await media.filmstrip(p('a.mkv'), 4)).length);
  await step('waveform', async () => (await media.waveform(p('music.mp3'))).length);
  await step('proxy', () => media.makeProxy(p('a.mkv'), p('proxy.mp4')));

  const project = {
    settings: { width: 1280, height: 720, fps: 30, fadeIn: 0.5, fadeOut: 0.5 },
    clips: [
      { path: p('a.mkv'), kind: 'video', in: 0, out: 2, hasAudio: true, volume: 1, transition: { type: 'fade', duration: 0.5 } },
      { path: p('b.mp4'), kind: 'video', in: 0.5, out: 2.5, hasAudio: false, transition: { type: 'none' } },
      { path: p('logo.png'), kind: 'image', in: 0, out: 1.5, transition: { type: 'slideleft', duration: 0.6 } },
      { path: p('a.mkv'), kind: 'video', in: 2, out: 4, hasAudio: true, volume: 0.5 },
    ],
    audio: [{ path: p('music.mp3'), start: 1, in: 0, out: 10, volume: 0.4, fadeOut: 1 }],
  };
  let prog = 0;
  await step('timeline → mp4', async () => { const r = await tl.renderProject(project, { output: p('edit.mp4'), quality: 'balanced' }, x => prog = x); const i = await probe(p('edit.mp4')); return { ...r, probed: i.duration, w: i.width, prog }; });
  await step('timeline → preview', () => tl.renderProject(project, { output: p('prev.mp4'), preview: true }));
  await step('timeline → webm', () => tl.renderProject(project, { output: p('edit.webm'), quality: 'small' }));
  await step('timeline → gif', () => tl.renderProject(project, { output: p('edit.gif') }));
  await step('timeline → mp3', () => tl.renderProject(project, { output: p('edit.mp3') }));
  console.log('expected duration', tl.sequenceDuration(project.clips), 'dir', dir);
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})();
