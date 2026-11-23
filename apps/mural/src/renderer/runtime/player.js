// Mural — plays one wallpaper in an element. The same player runs on the desktop (one per display), in the Studio's
// preview and on the Library's cards, so what you build is exactly what you get.
//
// Performance rules it follows:
//  • frames are capped (default 30 fps) and the thread *sleeps* between them (setTimeout, then one rAF), instead of
//    waking 60–120 times a second just to skip;
//  • a wallpaper with nothing moving draws once and stops; the cursor, a click or the minute changing wake it;
//  • shaders draw at a fraction of the screen's pixels and are scaled up; nothing draws above ~4K pixels;
//  • pause() stops drawing and video decoding at once (the desktop host then freezes the whole page).
import { normalizeManifest, traits } from './schema.js';
import { skyAt } from './sun.js';
import { Scene } from './scene.js';
import { ShaderView } from './shader.js';

const MAX_PIXELS = 3840 * 2160;

export async function createPlayer(root, opts = {}) {
  const m = normalizeManifest(opts.manifest);
  const base = opts.base || '';
  const resolve = (src) => (/^(https?:|data:|blob:|mural:)/.test(src) ? src : base + String(src).split('/').map(encodeURIComponent).join('/'));
  const tr = traits(m);
  const state = { fps: opts.fps || 30, scale: opts.scale || 1, paused: false, running: false, timer: 0, raf: 0, last: 0, t0: performance.now(), frames: 0, work: 0, statT: performance.now(), hour: opts.hour ?? null, location: opts.location || null, destroyed: false, lastStats: { fps: 0, ms: 0 } };

  root.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#000;contain:strict';
  root.appendChild(wrap);
  const fill = 'position:absolute;inset:0;width:100%;height:100%;display:block';

  let scene = null, shader = null, media = null, frame = null, canvas = null, sceneCanvas = null;
  const hint = m.quality || {};

  // ------------------------------------------------------------------------------------------------- build the view
  if (m.type === 'shader') {
    canvas = document.createElement('canvas'); canvas.style.cssText = fill; wrap.appendChild(canvas);
    shader = new ShaderView(canvas);
    let code = m.code;
    if (!code && m.shader) { const r = await fetch(resolve(m.shader)); if (!r.ok) throw new Error(`Couldn't read ${m.shader}`); code = await r.text(); }
    const err = shader.compile(code || 'void mainImage(out vec4 c, in vec2 p){ c = vec4(0.0); }');
    if (err) { if (opts.onError) opts.onError(err); else throw new Error(err); }
    shader.params = [0, 1, 2, 3].map((i) => Number(m.params[i] ? m.params[i].value : 0) || 0);
    tr.cursor = /iMouse|iPointer/.test(code || ''); tr.click = /iClick/.test(code || ''); tr.timeOfDay = /iDaylight|iPhase/.test(code || '');
  } else if (m.type === 'web') {
    frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts'); frame.setAttribute('allow', 'autoplay');
    frame.style.cssText = fill + ';border:0;background:#000'; frame.src = resolve(m.page || 'index.html');
    wrap.appendChild(frame);
  } else if (m.type === 'video' || m.type === 'image') {
    if (m.type === 'video') { media = document.createElement('video'); Object.assign(media, { muted: true, loop: true, playsInline: true, autoplay: true }); media.preload = 'auto'; media.playbackRate = m.speed || 1; }
    else media = new Image();
    media.crossOrigin = 'anonymous';
    media.style.cssText = fill + `;object-fit:${m.fit === 'stretch' ? 'fill' : m.fit || 'cover'}`;
    media.src = resolve(m.src);
    wrap.appendChild(media);
    if (m.type === 'video') { media.addEventListener('loadeddata', () => { if (!state.paused) media.play().catch(() => {}); }, { once: true }); }
  }
  if (m.scene && m.scene.layers.length) {
    sceneCanvas = document.createElement('canvas'); sceneCanvas.style.cssText = fill; wrap.appendChild(sceneCanvas);
    scene = new Scene(sceneCanvas, m.scene, { resolve, transparent: m.type !== 'scene', now: () => pinnedNow() });
    await scene.load();
  }
  const animated = () => tr.animated || (scene && scene.effects.length > 0);

  function pinnedNow() {
    if (state.hour == null) return new Date();
    const d = new Date(); d.setHours(0, 0, 0, 0); return new Date(d.getTime() + state.hour * 3600000);
  }
  function updateSky() {
    const sky = skyAt(new Date(), state.location, state.hour);
    if (scene) scene.setSky(sky); if (shader) shader.setSky(sky);
    post({ mural: 'sky', phases: sky.phases, daylight: sky.daylight, altitude: sky.altitude });
    return sky;
  }
  let sky = updateSky();

  // ------------------------------------------------------------------------------------------------- sizing
  function resize() {
    const w = root.clientWidth || window.innerWidth, h = root.clientHeight || window.innerHeight;
    const dev = window.devicePixelRatio || 1;
    let s = dev * state.scale;
    if (shader) s *= hint.scale && hint.scale < 1 ? hint.scale : 0.5;
    if (w * h * s * s > MAX_PIXELS) s = Math.sqrt(MAX_PIXELS / (w * h));
    if (scene) scene.resize(w, h, m.type === 'scene' ? s : Math.min(s, dev));
    if (shader) shader.resize(w, h, s);
    wake();
  }
  const ro = new ResizeObserver(resize); ro.observe(root);

  // ------------------------------------------------------------------------------------------------- the loop
  function draw(now) {
    state.raf = 0;
    if (state.paused || state.destroyed) { state.running = false; return; }
    const t = (now - state.t0) / 1000, dt = state.last ? Math.min(0.25, (now - state.last) / 1000) : 1 / state.fps; state.last = now;
    const w0 = performance.now();
    let moving = false;
    if (shader) moving = shader.frame(t, dt) || moving;
    if (scene) moving = scene.frame(t, dt) || moving;
    if (m.type === 'video') moving = true;
    if (m.type === 'web') moving = false; // the page runs its own loop
    state.work += performance.now() - w0; state.frames++;
    stats(now);
    if (moving || animated()) schedule(); else { state.running = false; state.last = 0; }
  }
  function schedule() {
    state.running = true;
    const interval = 1000 / Math.max(1, state.fps);
    const since = performance.now() - (state.last || 0);
    const wait = Math.max(0, interval - since - 2);
    if (wait > 4) state.timer = setTimeout(() => { state.timer = 0; state.raf = requestAnimationFrame(draw); }, wait);
    else state.raf = requestAnimationFrame(draw);
  }
  function wake() { if (state.paused || state.destroyed || state.running) return; state.running = true; state.raf = requestAnimationFrame(draw); }
  function stats(now) {
    if (now - state.statT < 2000) return;
    const secs = (now - state.statT) / 1000;
    state.lastStats = { fps: Math.round(state.frames / secs * 10) / 10, ms: state.frames ? Math.round(state.work / state.frames * 100) / 100 : 0, particles: scene ? scene.stats().particles : 0 };
    state.frames = 0; state.work = 0; state.statT = now;
    if (opts.onStats) opts.onStats(state.lastStats);
  }

  // minute ticks: the sky, the clock text and anything keyed to the time of day
  let minuteTimer = 0;
  function minute() {
    sky = updateSky(); wake();
    const d = new Date(); minuteTimer = setTimeout(minute, (60 - d.getSeconds()) * 1000 - d.getMilliseconds() + 30);
  }
  minuteTimer = setTimeout(minute, (60 - new Date().getSeconds()) * 1000);

  function post(msg) { if (frame && frame.contentWindow) try { frame.contentWindow.postMessage(msg, '*'); } catch (_) {} }
  if (frame) frame.addEventListener('load', () => { post({ mural: 'hello', version: 1, paused: state.paused }); updateSky(); });

  resize();
  if (m.type === 'video') wake();

  // ------------------------------------------------------------------------------------------------- the handle
  const api = {
    manifest: m, traits: tr,
    get sky() { return sky; },
    pointer(x, y, inside = true) {
      if (scene) scene.setPointer(x, y, inside); if (shader) shader.setPointer(x, y);
      if (frame && tr.cursor) post({ mural: 'pointer', x, y, inside });
      if (tr.cursor) wake();
    },
    click(x, y, button = 0) {
      const t = (performance.now() - state.t0) / 1000;
      if (scene) scene.click(x, y); if (shader) shader.click(x, y, t);
      if (frame) post({ mural: 'click', x, y, button });
      wake();
    },
    setHour(h) { state.hour = h == null ? null : Number(h); sky = updateSky(); wake(); },
    setLocation(loc) { state.location = loc || null; sky = updateSky(); wake(); },
    setQuality({ fps, scale } = {}) { if (fps) state.fps = fps; if (scale) state.scale = scale; resize(); },
    setParams(vals) { if (shader) { shader.params = [0, 1, 2, 3].map((i) => Number(vals[i]) || 0); wake(); } },
    compile(code) { if (!shader) return null; const e = shader.compile(code); tr.cursor = /iMouse|iPointer/.test(code); tr.click = /iClick/.test(code); wake(); return e; },
    async updateScene(sc) { if (scene) { await scene.update(sc); resize(); wake(); } },
    pause() {
      if (state.paused) return; state.paused = true;
      if (state.timer) clearTimeout(state.timer); if (state.raf) cancelAnimationFrame(state.raf); state.timer = state.raf = 0; state.running = false; state.last = 0;
      if (media && media.pause) media.pause(); if (scene) scene.pauseMedia(); post({ mural: 'pause' });
    },
    resume() {
      if (!state.paused) return; state.paused = false;
      if (media && media.play) media.play().catch(() => {}); if (scene) scene.resumeMedia(); post({ mural: 'resume' });
      sky = updateSky(); wake();
    },
    get paused() { return state.paused; },
    redraw() { wake(); },
    stats() {
      const live = state.frames ? { fps: Math.round(state.frames / Math.max(0.001, (performance.now() - state.statT) / 1000) * 10) / 10, ms: Math.round(state.work / state.frames * 100) / 100 } : {};
      return { ...state.lastStats, ...(state.lastStats.fps ? {} : live), particles: scene ? scene.stats().particles : 0, running: state.running, paused: state.paused };
    },
    /** A still of the current frame (PNG data URL), or null for web pages (the host captures those itself). */
    snapshot(maxW = 640) {
      const w = root.clientWidth || 1, h = root.clientHeight || 1, k = Math.min(1, maxW / w);
      const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
      const g = c.getContext('2d');
      try {
        if (media) { if (m.type === 'video' ? media.readyState >= 2 : media.complete) g.drawImage(media, 0, 0, c.width, c.height); }
        if (canvas) g.drawImage(canvas, 0, 0, c.width, c.height);
        if (sceneCanvas) g.drawImage(sceneCanvas, 0, 0, c.width, c.height);
        if (frame) return null;
        return c.toDataURL('image/jpeg', 0.86);
      } catch (_) { return null; }
    },
    destroy() {
      state.destroyed = true; api.pause(); clearTimeout(minuteTimer); ro.disconnect();
      if (scene) scene.destroy(); if (shader) shader.destroy();
      if (media) { media.removeAttribute('src'); if (media.load) media.load(); }
      root.innerHTML = '';
    }
  };
  return api;
}
