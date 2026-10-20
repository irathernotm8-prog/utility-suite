// Timeline 1.4: storyline motion (static + keyframed), clip volume keyframes, speed ramps, black tail, track order.
const fs = require('fs'), path = require('path'), os = require('os');
const tl = require('../engine/timeline');
const { probe, runFfmpeg, ffmpegToBuffer } = require('../engine/ffmpeg');
const S = process.argv[2] || '/home/claude/samples';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ro3-tl4-'));
const p = f => path.join(dir, f);
let failed = 0;
const step = async (name, fn) => { const t = Date.now(); try { const r = await fn(); console.log('ok  ', name, JSON.stringify(r).slice(0, 160), `${Date.now() - t}ms`); } catch (e) { failed++; console.log('FAIL', name, e.message.slice(-900)); } };
const near = (a, b, tol, what) => { if (Math.abs(a - b) > tol) throw new Error(`${what}: ${a} vs ${b}`); };
/** mean luma of one frame at time t */
async function luma(file, t, crop) {
  const { spawnSync } = require('child_process'); const { FFMPEG } = require('../engine/ffmpeg');
  const vf = [crop ? `crop=${crop}` : null, 'scale=32:18', 'format=gray'].filter(Boolean).join(',');
  const r = spawnSync(FFMPEG, ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', vf, '-f', 'rawvideo', '-'], { maxBuffer: 1e7 });
  const b = r.stdout; if (!b || !b.length) throw new Error("no frame at " + t); let s = 0; for (const v of b) s += v; return s / b.length;
}
(async () => {
  const ramp = [[1, 1], [1, 0.25], [1, 1]]; // 3 s of source: normal, quarter speed, normal → 1 + 4 + 1 = 6 s
  await step('ramp length + setpts expression', async () => {
    const c = { kind: 'video', in: 0, out: 3, ramp };
    near(tl.clipLen(c), 6, 1e-6, 'clipLen');
    const e = tl.rampSetpts(tl.rampOf(c)); if (!/clip\(T-1\.0000,0,1\.0000\)\/0\.2500/.test(e)) throw new Error(e);
    return { len: tl.clipLen(c) };
  });
  const project = {
    settings: { width: 640, height: 360, fps: 30 },
    clips: [
      { path: S + '/clip-a.mp4', kind: 'video', in: 0, out: 3, speed: 1, ramp, hasAudio: true, volume: 1, transition: { type: 'none' }, fx: {} },
      { path: S + '/landscape.jpg', kind: 'image', in: 0, out: 3, fx: {}, transition: { type: 'none' },
        motion: { x: 0.25, y: 0.5, scale: 0.5, rotation: 0, opacity: 1 } },
      { path: S + '/clip-a.mp4', kind: 'video', in: 0, out: 3, speed: 1, hasAudio: true, volume: 1, transition: { type: 'fade', duration: 0.5 }, fx: {},
        kf: { scale: [{ t: 0, v: 1 }, { t: 2.5, v: 0.4 }], rotation: [{ t: 0, v: 0 }, { t: 2.5, v: 30 }], opacity: [{ t: 0, v: 1 }, { t: 2.5, v: 0.3 }], x: [{ t: 0, v: 0.5 }, { t: 2.5, v: 0.7 }], volume: [{ t: 0, v: 1 }, { t: 2, v: 0 }] } },
    ],
    overlays: [], audio: [],
  };
  await step('render: ramp + static motion + keyframed motion + volume keys', async () => {
    const r = await tl.renderProject(project, { output: p('motion.mp4'), quality: 'small' });
    const i = await probe(r.output);
    near(i.duration, 6 + 3 + 3, 0.15, 'duration');
    return { dur: i.duration, w: i.width, h: i.height };
  });
  await step('static motion: right half of the image clip is black', async () => {
    const t = 6 + 1.5; const L = await luma(p('motion.mp4'), t, 'iw/2:ih:0:0'), Rt = await luma(p('motion.mp4'), t, 'iw/4:ih:iw*3/4:0');
    if (!(Rt < 12 && L > 25)) throw new Error(`left ${L} right ${Rt}`); return { L, Rt };
  });
  await step('keyframed motion: corners black at the end of the shrinking clip', async () => {
    const corner = await luma(p('motion.mp4'), 11.3, 'iw/8:ih/8:0:0'); if (corner > 20) throw new Error('corner ' + corner); return { corner };
  });
  await step('volume keyframes fade the last clip to silence', async () => {
    const { spawnSync } = require('child_process'); const { FFMPEG } = require('../engine/ffmpeg');
    const vol = (ss) => { const r = spawnSync(FFMPEG, ['-v', 'info', '-ss', String(ss), '-t', '0.4', '-i', p('motion.mp4'), '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }); return Number((/mean_volume: (-?[\d.]+)/.exec(r.stderr) || [])[1]); };
    const a = vol(8.7), b = vol(11.0); if (!(b < a - 15 || b < -60)) throw new Error(`early ${a} late ${b}`); return { early: a, late: b };
  });
  await step('no motion → no extra overlay pass', async () => {
    const { args } = tl.buildArgs({ settings: { width: 640, height: 360, fps: 30 }, clips: [{ path: S + '/clip-a.mp4', kind: 'video', in: 0, out: 1, fx: {}, transition: { type: 'none' } }] }, { output: p('x.mp4') });
    const g = args[args.indexOf('-filter_complex') + 1]; if (/color=c=black:s=640x360/.test(g)) throw new Error('motion pass added'); return true;
  });
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failed ? `${failed} FAILED` : 'all timeline 1.4 checks passed');
  process.exit(failed ? 1 : 0);
})();
