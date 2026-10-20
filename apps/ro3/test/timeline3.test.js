// Timeline 1.3: colour grade LUTs, clip effects, Ken Burns, keyframed + keyed overlays, audio effects, ducking,
// new transitions, rational frame rates, chapters, bitrate presets, image sequences.
const fs = require('fs'), path = require('path'), os = require('os');
const tl = require('../engine/timeline');
const { probe, runFfmpeg } = require('../engine/ffmpeg');
const S = process.argv[2] || '/home/claude/samples';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ro3-tl3-'));
const p = f => path.join(dir, f);
let failed = 0;
const step = async (name, fn) => { const t = Date.now(); try { const r = await fn(); console.log('ok  ', name, JSON.stringify(r).slice(0, 160), `${Date.now() - t}ms`); } catch (e) { failed++; console.log('FAIL', name, e.message.slice(-900)); } };
(async () => {
  const sup = tl.supportedTransitions();
  console.log('xfade styles available:', sup.size);
  const kf = { x: [{ t: 0, v: 0.2, ease: 'ease' }, { t: 2, v: 0.8, ease: 'linear' }], y: [{ t: 0, v: 0.3 }, { t: 2, v: 0.6 }], scale: [{ t: 0, v: 0.2 }, { t: 2, v: 0.45, ease: 'out' }], opacity: [{ t: 0, v: 0 }, { t: 0.8, v: 1 }], rotation: [{ t: 0, v: -15 }, { t: 2, v: 15 }] };
  const project = {
    settings: { width: 1280, height: 720, fps: 29.97, fit: 'fill', audioCrossfade: 'qsin', duck: { on: true, amount: 14 }, mix: { main: 1, overlay: 0.8, music: 0.7 } },
    clips: [
      { path: S + '/clip-a.mp4', kind: 'video', in: 0, out: 3, speed: 1, hasAudio: true, volume: 1, transition: { type: 'coverleft', duration: 0.6 },
        fx: { blur: 10, grain: 30, crop: { l: 5, t: 5, r: 5, b: 5 }, denoise: 30, stabilize: true }, afx: { voice: true, low: 3, high: -2, reverb: 40, limiter: true },
        grade: { exposure: 0.4, contrast: 20, temperature: 30, look: 'cinematic', lookAmount: 80, vignette: 40, sharpen: 30 } },
      { path: S + '/clip-b.mp4', kind: 'video', in: 0, out: 2, speed: 1, hasAudio: false, transition: { type: 'squeezeh', duration: 0.5 }, fx: { reverse: true, glow: 50, rgbsplit: 6, echo: 30 } },
      { path: S + '/landscape.jpg', kind: 'image', in: 0, out: 3, fx: { kb: { on: true, z0: 1, z1: 1.4, x0: 0.2, y0: 0.5, x1: 0.8, y1: 0.4 }, posterizeTime: 8 }, transition: { type: 'none' } },
    ],
    overlays: [
      { path: S + '/clip-c.mov', kind: 'video', start: 0.5, in: 0, out: 2.5, x: 0.5, y: 0.5, scale: 0.3, opacity: 1, hasAudio: false, kf, key: { on: true, color: '#00ff00', similarity: 30, smooth: 10, spill: 50 } },
      { path: S + '/logo.png', kind: 'image', start: 0, in: 0, out: 6, x: 0.9, y: 0.1, scale: 0.08, opacity: 0.8, rotation: 20, grade: { saturation: 0 } },
    ],
    audio: [{ path: S + '/music.mp3', start: 0, in: 0, out: 20, volume: 0.8, fadeOut: 1, afx: { pitch: 2, highpass: 120, lowpass: 9000, compress: 40, dehum: 60, denoise: 30, deess: 30 } }],
  };
  const chapters = ';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=3000\ntitle=Intro\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=3000\nEND=7000\ntitle=Middle\n';
  await step('everything mp4 + chapters + bitrate', async () => {
    const r = await tl.renderProject(project, { output: p('all.mp4'), quality: 'small', bitrate: 6, chapters, loudnorm: -16 });
    const i = await probe(r.output); return { dur: i.duration, w: i.width, h: i.height, fps: i.fps, bytes: r.bytes };
  });
  await step('chapters present', async () => {
    const { spawnSync } = require('child_process'); const { FFPROBE } = require('../engine/ffmpeg');
    const j = JSON.parse(spawnSync(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_chapters', p('all.mp4')], { encoding: 'utf8' }).stdout);
    if (j.chapters.length !== 2) throw new Error('chapters ' + j.chapters.length); return j.chapters.map(c => c.tags.title);
  });
  await step('png sequence', async () => {
    const short = { ...project, clips: [{ ...project.clips[2], out: 0.5 }], overlays: [], audio: [] };
    const r = await tl.renderProject(short, { output: p('seq_%05d.png'), sequence: true, preview: true });
    return { first: path.basename(r.output), count: fs.readdirSync(dir).filter(f => f.startsWith('seq_')).length };
  });
  await step('dnxhr mov 23.976', async () => {
    const r = await tl.renderProject({ ...project, settings: { ...project.settings, fps: 23.976, width: 640, height: 360 }, overlays: [] }, { output: p('d.mov'), codec: 'dnxhr' });
    const i = await probe(r.output); return { v: i.vcodec, fps: i.fps };
  });
  await runFfmpeg(['-i', p('all.mp4'), '-vf', 'fps=2,scale=320:-2,tile=5x3', '-frames:v', '1', p('sheet.jpg')]);
  console.log('dir', dir); console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})();
