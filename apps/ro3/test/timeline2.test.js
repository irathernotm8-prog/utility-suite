// Timeline 1.1: speed, colour, rotation, clip fades, overlays (video, image, title), loudnorm, HEVC, ProRes.
const fs = require('fs'), path = require('path'), os = require('os');
const sharp = require('sharp');
const tl = require('../engine/timeline');
const { probe, runFfmpeg } = require('../engine/ffmpeg');
const S = process.argv[2] || '/home/claude/samples';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ro3-tl2-'));
const p = f => path.join(dir, f);
let failed = 0;
const step = async (name, fn) => { const t = Date.now(); try { const r = await fn(); console.log('ok  ', name, JSON.stringify(r).slice(0, 140), `${Date.now() - t}ms`); } catch (e) { failed++; console.log('FAIL', name, e.message.slice(-600)); } };
(async () => {
  await sharp({ create: { width: 1920, height: 1080, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect x="120" y="860" width="900" height="120" rx="10" fill="rgba(0,0,0,.6)"/><text x="150" y="945" font-size="72" font-family="sans-serif" font-weight="700" fill="#2fd67f">Lower third</text></svg>`) }]).png().toFile(p('title.png'));
  const project = {
    settings: { width: 1920, height: 1080, fps: 30, fadeIn: 0.3, fadeOut: 0.5 },
    clips: [
      { path: S + '/clip-a.mkv', kind: 'video', in: 0, out: 4, speed: 2, hasAudio: true, volume: 1, fx: { brightness: 20, contrast: 15, saturation: -40, fadeIn: 0.4 }, transition: { type: 'dissolve', duration: 0.6 } },
      { path: S + '/clip-b.mp4', kind: 'video', in: 0, out: 2, speed: 0.5, hasAudio: false, fx: { rotate: 90, flipH: true, hue: 60 }, transition: { type: 'none' } },
      { path: S + '/landscape.jpg', kind: 'image', in: 0, out: 2, fx: { temperature: 50, fadeOut: 0.5 } },
    ],
    overlays: [
      { path: S + '/clip-c.mov', kind: 'video', start: 0.5, in: 0, out: 3, x: 0.8, y: 0.25, scale: 0.3, opacity: 0.9, fadeIn: 0.3, fadeOut: 0.3, hasAudio: false },
      { path: S + '/logo.png', kind: 'image', start: 0, in: 0, out: 7, x: 0.08, y: 0.1, scale: 0.08, opacity: 0.8 },
      { path: p('title.png'), kind: 'title', start: 1, in: 0, out: 3, fadeIn: 0.4, fadeOut: 0.4 },
    ],
    audio: [{ path: S + '/music.mp3', start: 0, in: 0, out: 20, volume: 0.6, fadeOut: 1 }],
  };
  const expected = tl.sequenceDuration(project.clips);
  await step('mp4 h264 + loudnorm', async () => { const r = await tl.renderProject(project, { output: p('a.mp4'), quality: 'small', loudnorm: true }); const i = await probe(r.output); return { dur: i.duration, expected, w: i.width, h: i.height, a: i.acodec }; });
  await step('mov hevc', async () => { const r = await tl.renderProject(project, { output: p('b.mov'), quality: 'small', codec: 'hevc' }); const i = await probe(r.output); return { v: i.vcodec, dur: i.duration }; });
  await step('mov prores', async () => { const r = await tl.renderProject({ ...project, settings: { ...project.settings, width: 640, height: 360 } }, { output: p('c.mov'), codec: 'prores' }); const i = await probe(r.output); return { v: i.vcodec, a: i.acodec, bytes: r.bytes }; });
  await step('preview', () => tl.renderProject(project, { output: p('prev.mp4'), preview: true }));
  await step('psd still clip', async () => {
    const img = require('../engine/image');
    await img.convertImage({ input: S + '/landscape.jpg', output: p('still.psd') });
    return tl.renderProject({ settings: { width: 640, height: 360, fps: 25 }, clips: [{ path: p('still.psd'), kind: 'image', in: 0, out: 1 }] }, { output: p('psd.mp4'), preview: true });
  });
  await runFfmpeg(['-i', p('a.mp4'), '-vf', 'fps=2,scale=384:-2,tile=6x2', '-frames:v', '1', p('sheet.jpg')]);
  console.log('dir', dir); console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})();
