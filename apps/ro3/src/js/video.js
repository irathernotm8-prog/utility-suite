// Video editor: media bin, viewer, single video track + music lane, transitions, export.
const VideoEditor = (() => {
  // Transition styles grouped like FilmCraft's effects panel (FFmpeg xfade names).
  const TRANSITION_GROUPS = [
    ['Dissolve', [['fade', 'Crossfade'], ['dissolve', 'Dissolve'], ['fadeblack', 'Dip to black'], ['fadewhite', 'Dip to white'], ['fadegrays', 'Film dissolve'], ['fadefast', 'Fast fade'], ['fadeslow', 'Slow fade'], ['distance', 'Distance']]],
    ['Wipe', [['wipeleft', 'Wipe left'], ['wiperight', 'Wipe right'], ['wipeup', 'Wipe up'], ['wipedown', 'Wipe down'], ['wipetl', 'Wipe ↖'], ['wipetr', 'Wipe ↗'], ['wipebl', 'Wipe ↙'], ['wipebr', 'Wipe ↘'], ['diagtl', 'Diagonal ↖'], ['diagtr', 'Diagonal ↗'], ['diagbl', 'Diagonal ↙'], ['diagbr', 'Diagonal ↘'], ['radial', 'Clock wipe']]],
    ['Push & slide', [['slideleft', 'Push left'], ['slideright', 'Push right'], ['slideup', 'Push up'], ['slidedown', 'Push down'], ['coverleft', 'Slide over ←'], ['coverright', 'Slide over →'], ['coverup', 'Slide over ↑'], ['coverdown', 'Slide over ↓'], ['revealleft', 'Reveal ←'], ['revealright', 'Reveal →'], ['revealup', 'Reveal ↑'], ['revealdown', 'Reveal ↓']]],
    ['Smooth', [['smoothleft', 'Smooth left'], ['smoothright', 'Smooth right'], ['smoothup', 'Smooth up'], ['smoothdown', 'Smooth down'], ['hlwind', 'Wind ←'], ['hrwind', 'Wind →'], ['vuwind', 'Wind ↑'], ['vdwind', 'Wind ↓']]],
    ['Iris & shape', [['circleopen', 'Iris open'], ['circleclose', 'Iris close'], ['circlecrop', 'Iris round'], ['rectcrop', 'Iris box'], ['horzopen', 'Barn doors open'], ['horzclose', 'Barn doors close'], ['vertopen', 'Split open'], ['vertclose', 'Split close']]],
    ['Slices & stretch', [['hlslice', 'Slices ←'], ['hrslice', 'Slices →'], ['vuslice', 'Slices ↑'], ['vdslice', 'Slices ↓'], ['squeezeh', 'Squeeze ↔'], ['squeezev', 'Squeeze ↕']]],
    ['Stylized', [['pixelize', 'Pixelize'], ['zoomin', 'Cross zoom'], ['hblur', 'Whip blur']]],
  ];
  const TRANSITIONS = [['none', 'None'], ...TRANSITION_GROUPS.flatMap(g => g[1])];
  const RES = [['auto', 'Match first clip'], ['3840x2160', '4K · 3840 × 2160'], ['1920x1080', '1080p · 1920 × 1080'], ['1280x720', '720p · 1280 × 720'],
    ['1080x1920', 'Vertical · 1080 × 1920'], ['1080x1350', 'Portrait · 1080 × 1350'], ['1080x1080', 'Square · 1080 × 1080']];
  const IMAGE_DEFAULT = 4;

  const media = [];          // bin
  let clips = [];            // main track
  let audio = [];            // music lane
  let overlays = [];         // overlay track: picture-in-picture, images, titles
  let markers = [];          // timeline markers (seconds)
  let markerNames = {};      // marker time (3 dp) → name, used for chapters
  let captions = [];         // [{ id, start, end, text }]
  const mkKey = tm => (+tm).toFixed(3);
  const CAPTION_STYLE = () => ({ size: 44, color: '#ffffff', bg: true, bgOpacity: 70, y: 0.88, font: 'Manrope', weight: 700 });
  let snapOn = true, dirty = false, rate = 1;
  let settings = { res: 'auto', width: 1920, height: 1080, fps: 30, fadeIn: 0, fadeOut: 0 };
  let sel = null;            // {type:'clip'|'audio'|'trans'|'media', id}
  let t = 0, playing = false, zoom = 60, total = 0;
  let showThirds = false;
  const hist = { stack: [], index: -1 };
  let el = {};
  let projectPath = null;

  const byId = (arr, id) => arr.find(x => x.id === id);
  const mOf = c => byId(media, c.mediaId);
  const dur = c => Math.max(0, (c.out - c.in) / spd(c));

  // ---------- history ----------
  function snapshot() { return JSON.stringify({ clips, audio, overlays, markers, markerNames, captions, settings }); }
  function commit(label) {
    if (hist.stack.length && label !== 'Start' && label !== 'Open project') { dirty = true; scheduleAutosave(); }
    hist.stack = hist.stack.slice(0, hist.index + 1);
    hist.stack.push({ label, s: snapshot() });
    if (hist.stack.length > 80) hist.stack.shift();
    hist.index = hist.stack.length - 1;
    refresh();
  }
  function restore(i) {
    if (i < 0 || i >= hist.stack.length) return;
    hist.index = i;
    const s = JSON.parse(hist.stack[i].s);
    clips = s.clips; audio = s.audio; overlays = s.overlays || []; markers = s.markers || []; markerNames = s.markerNames || {}; captions = s.captions || []; settings = s.settings;
    if (sel && sel.type !== 'media' && !byId(sel.type === 'audio' ? audio : sel.type === 'overlay' ? overlays : sel.type === 'caption' ? captions : clips, sel.id)) sel = null;
    dirty = true; scheduleAutosave();
    refresh();
  }

  // ---------- timing ----------
  function transLen(prev, next, acc) {
    const tr = prev.transition;
    if (!tr || tr.type === 'none') return 0;
    return Math.max(0.1, Math.min(tr.duration || 1, acc - 0.1, dur(next) - 0.1));
  }
  function layout() {
    let end = 0;
    clips.forEach((c, i) => {
      const td = i ? transLen(clips[i - 1], c, end) : 0;
      c._start = i ? end - td : 0; c._td = td;
      end = c._start + dur(c);
    });
    total = end;
    return end;
  }
  const audioLen = a => Math.max(0, a.out - a.in);
  function timelineEnd() { return Math.max(total, ...audio.map(a => a.start + audioLen(a)), ...overlays.map(o => o.start + olen(o)), ...captions.map(c => c.end), 0); }

  // ---------- media import ----------
  function kindOf(p) {
    const e = (/\.([^.\\/]+)$/.exec(p) || [])[1]?.toLowerCase() || '';
    if (FORMATS.IMAGE_IN.includes(e)) return 'image';
    if (FORMATS.VIDEO_IN.includes(e)) return 'video';
    if (FORMATS.AUDIO_IN.includes(e)) return 'audio';
    return null;
  }
  async function importDialog() {
    const all = [...FORMATS.VIDEO_IN, ...FORMATS.AUDIO_IN, ...FORMATS.IMAGE_IN];
    const paths = await ro3.openDialog({ title: 'Import media', multi: true, filters: [{ name: 'Media', extensions: all }, { name: 'Video', extensions: FORMATS.VIDEO_IN }, { name: 'Audio', extensions: FORMATS.AUDIO_IN }, { name: 'Images', extensions: FORMATS.IMAGE_IN }] });
    return importPaths(paths);
  }
  async function importPaths(paths, { quiet } = {}) {
    const added = [];
    let skipped = 0;
    for (const p of paths) {
      const kind = kindOf(p);
      if (!kind) { skipped++; continue; }
      let m = media.find(x => x.path === p);
      if (!m) {
        m = { id: uid('m'), path: p, name: baseName(p), kind, info: null, thumb: null, strip: null, wave: null, url: ro3.fileUrl(p), busy: 0.01 };
        media.push(m);
        renderBin();
        await loadMedia(m);
      }
      added.push(m);
    }
    if (skipped && !quiet) toast(`${skipped} file${skipped > 1 ? 's' : ''} skipped — not a format RO3 can edit.`, 'error');
    return added;
  }
  async function loadMedia(m) {
    try {
      if (m.kind === 'image') {
        const i = await ro3.imageInfo(m.path);
        m.info = { duration: 0, width: i.width, height: i.height, hasVideo: true, hasAudio: false };
        m.thumb = await ro3.thumb(m.path);
        if (m.info.width > 4096 || ['tif', 'tiff', 'bmp', 'ico', 'heic', 'svg'].includes(m.path.split('.').pop().toLowerCase())) {
          m.url = m.thumb; // browser can't show it natively; viewer uses the thumbnail
        }
      } else {
        m.info = await ro3.probe(m.path);
        if (m.kind === 'video' && !m.info.hasVideo) m.kind = 'audio';
        if (m.kind === 'video') {
          m.thumb = await ro3.thumb(m.path).catch(() => null);
          renderBin();
          m.strip = await ro3.filmstrip(m.path, m.info.duration, clamp(Math.round(m.info.duration / 2), 6, 40)).catch(() => null);
          m.stripFrames = clamp(Math.round(m.info.duration / 2), 6, 40);
          await ensurePlayable(m);
        }
        if (m.info.hasAudio) m.wave = await ro3.waveform(m.path).catch(() => null);
      }
      if (settings.res === 'auto' && m.kind !== 'audio' && !media.some(x => x !== m && x.kind !== 'audio' && x.info)) applyAutoRes(m);
    } catch (e) {
      toast(`${m.name}: ${e.message}`, 'error', 6000);
      media.splice(media.indexOf(m), 1);
    }
    m.busy = 0;
    renderBin(); refresh();
  }
  function applyAutoRes(m) {
    if (!m || !m.info || !m.info.width) return;
    settings.width = Math.round(m.info.width / 2) * 2; settings.height = Math.round(m.info.height / 2) * 2;
    if (m.info.fps) settings.fps = Math.min(60, Math.round(m.info.fps)) || 30;
  }
  function canPlay(url) {
    return new Promise(res => {
      const v = document.createElement('video');
      let done = false;
      const fin = ok => { if (done) return; done = true; v.removeAttribute('src'); v.load(); res(ok); };
      v.muted = true; v.preload = 'metadata';
      v.onloadeddata = () => fin(v.videoWidth > 0);
      v.onerror = () => fin(false);
      setTimeout(() => fin(false), 6000);
      v.src = url;
    });
  }
  async function ensurePlayable(m) {
    if (await canPlay(m.url)) return;
    // Chromium can't decode this container/codec — make a light preview copy. Export still uses the original.
    m.proxying = true; renderBin();
    const job = ro3.proxy(m.path, p => { m.busy = Math.max(0.02, p); const b = binEl(m); if (b) { const bar = $('.bbusy', b); if (bar) bar.style.transform = `scaleX(${p})`; } });
    try { const out = await job.promise; m.url = ro3.fileUrl(out); }
    catch (e) { toast(`Couldn't prepare a preview for ${m.name}. It will still export.`, 'error'); }
    m.proxying = false;
  }

  // ---------- editing ops ----------
  function addToTimeline(m, index = clips.length, at) {
    if (!m.info) return toast('Still reading that file — try again in a moment.', 'error');
    if (m.kind === 'audio') {
      const start = at != null ? at : Math.max(0, ...audio.map(a => a.start + audioLen(a)));
      const a = { id: uid('a'), mediaId: m.id, start, in: 0, out: m.info.duration, volume: 0.8, fadeIn: 0, fadeOut: 1 };
      audio.push(a); sel = { type: 'audio', id: a.id };
      commit('Add music');
      return;
    }
    const c = { id: uid('c'), mediaId: m.id, in: 0, out: m.kind === 'image' ? IMAGE_DEFAULT : m.info.duration, speed: 1, volume: 1, muted: false, fx: FX0(), transition: { type: 'none', duration: 1 } };
    clips.splice(index, 0, c);
    sel = { type: 'clip', id: c.id };
    commit('Add clip');
  }
  function clipAt(time) {
    layout();
    for (let i = clips.length - 1; i >= 0; i--) if (time >= clips[i]._start && time < clips[i]._start + dur(clips[i])) return clips[i];
    return null;
  }
  function split() {
    layout();
    let c = sel && sel.type === 'clip' ? byId(clips, sel.id) : null;
    if (!c || t <= c._start || t >= c._start + dur(c)) c = clipAt(t);
    if (c) {
      const local = c.in + (t - c._start) * spd(c);
      if (local - c.in < 0.1 || c.out - local < 0.1) return toast('Move the playhead further from the clip edge to split.', 'error');
      const n = { ...JSON.parse(JSON.stringify(c)), id: uid('c'), in: local, fx: { ...JSON.parse(JSON.stringify(c.fx || FX0())), fadeIn: 0 } };
      c.out = local; c.transition = { type: 'none', duration: 1 }; c.fx = { ...(c.fx || FX0()), fadeOut: 0 };
      clips.splice(clips.indexOf(c) + 1, 0, n);
      sel = { type: 'clip', id: n.id };
      return commit('Split clip');
    }
    const o = sel && sel.type === 'overlay' ? byId(overlays, sel.id) : overlays.find(o => t > o.start + 0.1 && t < o.start + olen(o) - 0.1);
    if (o && t > o.start + 0.1 && t < o.start + olen(o) - 0.1) {
      const cut = o.in + (t - o.start);
      const n = JSON.parse(JSON.stringify(o)); n.id = uid('o'); n.start = t; n.in = o.kind === 'video' ? cut : 0; n.out = o.kind === 'video' ? o.out : o.out - (cut - o.in); n.fadeIn = 0;
      o.out = cut; o.fadeOut = 0;
      overlays.push(n); sel = { type: 'overlay', id: n.id };
      return commit('Split overlay');
    }
    const a = audio.find(a => t > a.start + 0.1 && t < a.start + audioLen(a) - 0.1);
    if (a) {
      const local = a.in + (t - a.start);
      const n = { ...a, id: uid('a'), start: t, in: local, fadeIn: 0 };
      a.out = local; a.fadeOut = 0;
      audio.push(n); sel = { type: 'audio', id: n.id };
      return commit('Split music');
    }
    toast('Place the playhead over a clip to split it.', 'error');
  }
  function removeSelected() {
    if (!sel) return;
    if (sel.type === 'clip') { const i = clips.findIndex(c => c.id === sel.id); if (i < 0) return; clips.splice(i, 1); sel = clips[i] ? { type: 'clip', id: clips[i].id } : null; commit('Delete clip'); }
    else if (sel.type === 'audio') { audio = audio.filter(a => a.id !== sel.id); sel = null; commit('Delete music'); }
    else if (sel.type === 'overlay') { overlays = overlays.filter(o => o.id !== sel.id); sel = null; commit('Delete overlay'); }
    else if (sel.type === 'caption') { const i = captions.findIndex(c => c.id === sel.id); captions.splice(i, 1); sel = captions[i] ? { type: 'caption', id: captions[i].id } : null; commit('Delete caption'); }
    else if (sel.type === 'trans') { const c = byId(clips, sel.id); if (c) { c.transition = { type: 'none', duration: 1 }; commit('Remove transition'); } }
    else if (sel.type === 'media') {
      const m = byId(media, sel.id);
      if (m && (clips.some(c => c.mediaId === m.id) || audio.some(a => a.mediaId === m.id) || overlays.some(o => o.mediaId === m.id))) return toast('That file is used on the timeline. Remove its clips first.', 'error');
      if (m) { media.splice(media.indexOf(m), 1); sel = null; renderBin(); refresh(); }
    }
  }
  // clip clipboard: copy / paste clips, paste attributes (effects, grade, audio fx)
  let clipBoard = null;
  function copyClip() { const c = sel && sel.type === 'clip' && byId(clips, sel.id); if (!c) return false; clipBoard = JSON.parse(JSON.stringify(c)); toast('Clip copied. Ctrl/Cmd+V pastes it at the playhead; Ctrl/Cmd+Alt+V pastes its effects onto another clip.', 'ok', 2800); return true; }
  function pasteClip() {
    if (!clipBoard) return false;
    layout();
    const at = clipAt(t); let idx = clips.length;
    if (at) { const local = t - at._start; idx = clips.indexOf(at) + (local > dur(at) / 2 ? 1 : 0); }
    const n = { ...JSON.parse(JSON.stringify(clipBoard)), id: uid('c') };
    clips.splice(idx, 0, n); sel = { type: 'clip', id: n.id }; commit('Paste clip'); return true;
  }
  function pasteAttributes() {
    if (!clipBoard) return toast('Copy a clip first (Ctrl/Cmd+C on the timeline).', 'info');
    const c = sel && sel.type === 'clip' && byId(clips, sel.id); if (!c) return toast('Select the clip to paste onto.', 'info');
    c.fx = JSON.parse(JSON.stringify(clipBoard.fx || FX0())); c.grade = clipBoard.grade ? JSON.parse(JSON.stringify(clipBoard.grade)) : null; c.afx = clipBoard.afx ? JSON.parse(JSON.stringify(clipBoard.afx)) : null;
    commit('Paste attributes');
  }
  /** Freeze frame: split at the playhead and insert a 2-second still of that frame. */
  async function freezeFrame() {
    layout();
    const c = clipAt(t); if (!c) return toast('Put the playhead over a video clip.', 'info');
    const m = mOf(c); if (m.kind !== 'video') return toast('Freeze frame works on video clips.', 'info');
    const local = c.in + (t - c._start) * spd(c);
    try {
      const p = await ro3.still(m.path, local);
      const [fm] = await importPaths([p], { quiet: true }); if (!fm) throw new Error('Could not read the frame');
      if (t - c._start > 0.1 && c._start + dur(c) - t > 0.1) split();
      layout();
      const after = clipAt(t + 0.001), idx = after ? clips.indexOf(after) : clips.length;
      const fc = { id: uid('c'), mediaId: fm.id, in: 0, out: 2, speed: 1, volume: 1, muted: false, fx: { ...FX0(), fit: c.fx && c.fx.fit }, grade: c.grade ? JSON.parse(JSON.stringify(c.grade)) : null, transition: { type: 'none', duration: 1 } };
      clips.splice(idx, 0, fc); sel = { type: 'clip', id: fc.id }; commit('Freeze frame');
    } catch (e) { toast('Freeze frame failed: ' + e.message, 'error'); }
  }
  function duplicateClip() {
    const c = sel && sel.type === 'clip' && byId(clips, sel.id); if (!c) return;
    const n = { ...JSON.parse(JSON.stringify(c)), id: uid('c') };
    clips.splice(clips.indexOf(c) + 1, 0, n); sel = { type: 'clip', id: n.id }; commit('Duplicate clip');
  }

  // ---------- playback ----------
  const slots = [];
  let clock = { start: 0, t0: 0 };
  const musicEls = new Map();

  function makeSlots() {
    for (let i = 0; i < 2; i++) {
      const v = document.createElement('video'); v.playsInline = true; v.preload = 'auto';
      const img = document.createElement('img'); img.alt = '';
      const cv = document.createElement('canvas'); cv.className = 'gl-layer';
      v.style.opacity = img.style.opacity = cv.style.opacity = '0';
      el.frame.append(v, img, cv);
      const s = { v, img, cv, gl: null, clipId: null, kind: null };
      // redraw graded frames after a seek while paused
      v.addEventListener('seeked', () => { if (!playing) drawSlot(s); });
      v.addEventListener('loadeddata', () => { if (!playing) drawSlot(s); });
      img.addEventListener('load', () => drawSlot(s));
      slots.push(s);
      hookAudio(v, s);
    }
  }
  // ---------- preview audio: EQ/filters/compressor via WebAudio + level meters ----------
  let actx = null, master = null, meterL = null, meterR = null, meterOn = false;
  const chains = new WeakMap();
  function audioCtx() {
    if (!actx) {
      actx = new AudioContext(); master = actx.createGain();
      const split = actx.createChannelSplitter(2); meterL = actx.createAnalyser(); meterR = actx.createAnalyser(); meterL.fftSize = meterR.fftSize = 2048;
      master.connect(actx.destination); master.connect(split); split.connect(meterL, 0); split.connect(meterR, 1);
    }
    if (actx.state === 'suspended') actx.resume().catch(() => {});
    return actx;
  }
  function hookAudio(elm) { elm.crossOrigin = null; }
  /** Route a media element through an EQ/filter chain (created on first use; a routed element stays routed). */
  function chainFor(elm) {
    let ch = chains.get(elm); if (ch) return ch;
    const ctx = audioCtx(), src = ctx.createMediaElementSource(elm);
    const mk = (type, f) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; return b; };
    ch = { hp: mk('highpass', 10), low: mk('lowshelf', 110), mid: mk('peaking', 1200), high: mk('highshelf', 5000), lp: mk('lowpass', 22000), comp: ctx.createDynamicsCompressor(), gain: ctx.createGain() };
    ch.mid.Q.value = 0.9; ch.comp.threshold.value = 0; ch.comp.ratio.value = 1;
    src.connect(ch.hp); ch.hp.connect(ch.low); ch.low.connect(ch.mid); ch.mid.connect(ch.high); ch.high.connect(ch.lp); ch.lp.connect(ch.comp); ch.comp.connect(ch.gain); ch.gain.connect(master);
    chains.set(elm, ch); return ch;
  }
  /** Apply a clip's audio effects to the element playing it (preview approximates EQ, filters, compressor, gain). */
  function setAudioFx(s, item) { applyAfx(s.v || s, item && item.afx); }
  function applyAfx(elm, a) {
    if (!a && !chains.has(elm) && !meterOn) return;
    let ch; try { ch = chainFor(elm); } catch (_) { return; }
    a = a || {};
    const voice = !!a.voice;
    ch.hp.frequency.value = Math.max(10, a.highpass || (voice ? 80 : 10));
    ch.lp.frequency.value = a.lowpass > 0 ? a.lowpass : 22000;
    ch.low.gain.value = a.low || 0; ch.mid.gain.value = a.mid || 0; ch.high.gain.value = (a.high || 0) + (voice ? 3 : 0);
    const c = a.compress || (voice ? 40 : 0);
    ch.comp.threshold.value = c ? -10 - c * 0.25 : 0; ch.comp.ratio.value = c ? 1.5 + c / 20 : 1;
    ch.gain.gain.value = Math.pow(10, (a.gain || 0) / 20) * (c ? Math.min(8, 1 + c / 60) ** 0.5 : 1);
  }
  function startMeters(canvas) {
    meterOn = true; audioCtx();
    slots.forEach(s => applyAfx(s.v, null)); for (const au of musicEls.values()) applyAfx(au, null);
    const bufL = new Float32Array(2048), bufR = new Float32Array(2048), g = canvas.getContext('2d');
    let peakHold = [-90, -90], holdT = [0, 0];
    const draw = () => {
      if (!meterOn || !canvas.isConnected) return;
      meterL.getFloatTimeDomainData(bufL); meterR.getFloatTimeDomainData(bufR);
      const W = canvas.width, H = canvas.height; g.clearRect(0, 0, W, H);
      [bufL, bufR].forEach((b, i) => {
        let pk = 0, sq = 0; for (let k = 0; k < b.length; k++) { const x = Math.abs(b[k]); if (x > pk) pk = x; sq += x * x; }
        const db = 20 * Math.log10(Math.max(1e-5, pk)), rms = 10 * Math.log10(Math.max(1e-10, sq / b.length));
        const now = performance.now(); if (db > peakHold[i] || now - holdT[i] > 1500) { peakHold[i] = db; holdT[i] = now; }
        const xOf = d => clamp((d + 60) / 60, 0, 1) * W, y = i * (H / 2) + 1, hh = H / 2 - 2;
        const grad = g.createLinearGradient(0, 0, W, 0); grad.addColorStop(0, '#2fd67f'); grad.addColorStop(0.8, '#2fd67f'); grad.addColorStop(0.9, '#f2c14e'); grad.addColorStop(1, '#ff6b5e');
        g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(0, y, W, hh);
        g.fillStyle = grad; g.fillRect(0, y, xOf(rms + 3), hh);
        g.fillStyle = peakHold[i] > -1 ? '#ff6b5e' : '#e4ece7'; g.fillRect(xOf(peakHold[i]) - 1, y, 2, hh);
      });
      canvas.title = `Peak ${Math.max(...peakHold).toFixed(1)} dBFS`;
      requestAnimationFrame(draw);
    };
    draw();
  }
  /** Draw a slot through WebGL when its clip has a colour grade; returns true if the GL layer is in use. */
  function drawSlot(s) {
    const c = s.clipId && byId(clips, s.clipId);
    const g = c && c.grade, lf = g ? GLView.lutFor(gradeWithLut(g)) : null, spatial = g && (g.vignette > 0 || g.sharpen > 0);
    if (!c || (!lf && !spatial)) { s.glOn = false; return false; }
    if (!s.gl) { try { s.gl = GLView.create(s.cv); } catch (e) { console.warn('WebGL unavailable', e); } }
    if (!s.gl) return false;
    s.gl.setLut(lf && lf.L, lf && lf.key); s.gl.setKey(null); s.gl.setSpatial(g);
    const src = s.kind === 'image' ? s.img : s.v;
    s.glOn = s.gl.draw(src);
    return s.glOn;
  }
  /** Grade with the LUT file's text attached (loaded once per path). */
  const lutTexts = new Map();
  function gradeWithLut(g) {
    if (!g || !g.lut || !g.lut.path) return g;
    const tx = lutTexts.get(g.lut.path);
    if (tx === undefined) { lutTexts.set(g.lut.path, null); ro3.readText(g.lut.path).then(t => { lutTexts.set(g.lut.path, t); sync(t0(), playing); }).catch(() => toast(`LUT file missing: ${g.lut.name}`, 'error')); return { ...g, lut: null }; }
    return tx ? { ...g, lut: { ...g.lut, text: tx } } : { ...g, lut: null };
  }
  const t0 = () => t;
  /** Evaluate keyframes [{t, v, ease}] at local time u. */
  function kfEval(list, u, fallback) {
    if (!list || !list.length) return fallback;
    const k = [...list].sort((a, b) => a.t - b.t);
    if (u <= k[0].t) return k[0].v;
    for (let i = 0; i < k.length - 1; i++) {
      const a = k[i], b = k[i + 1];
      if (u < b.t) {
        const x = clamp((u - a.t) / Math.max(1e-3, b.t - a.t), 0, 1);
        const e = a.ease === 'hold' ? 0 : a.ease === 'ease' ? x * x * (3 - 2 * x) : a.ease === 'in' ? x * x : a.ease === 'out' ? 1 - (1 - x) * (1 - x) : x;
        return a.v + (b.v - a.v) * e;
      }
    }
    return k[k.length - 1].v;
  }
  const hasKfs = (o, p) => !!(o.kf && o.kf[p] && o.kf[p].length);
  /** Set (or add) a keyframe for property p at the playhead. */
  function setKey(o, p, val, ease) {
    o.kf = o.kf || {}; const list = o.kf[p] = o.kf[p] || [];
    const u = +clamp(t - o.start, 0, olen(o)).toFixed(3), i = list.findIndex(k => Math.abs(k.t - u) < 0.04);
    if (i >= 0) { list[i].v = val; if (ease) list[i].ease = ease; } else { list.push({ t: u, v: val, ease: ease || 'ease' }); list.sort((a, b) => a.t - b.t); }
  }
  const KF_PROPS = [['x', 'Left ↔ right'], ['y', 'Top ↕ bottom'], ['scale', 'Size'], ['opacity', 'Opacity'], ['rotation', 'Rotation']];
  /** Current (possibly animated) transform of an overlay at timeline time `time`. */
  function ovState(o, time) {
    const u = time - o.start, k = o.kf || {};
    return { x: kfEval(k.x, u, o.x ?? 0.5), y: kfEval(k.y, u, o.y ?? 0.5), scale: kfEval(k.scale, u, o.scale ?? (o.kind === 'title' ? 1 : 0.35)), opacity: kfEval(k.opacity, u, o.opacity ?? 1), rotation: kfEval(k.rotation, u, o.rotation || 0) };
  }
  function assign(c) {
    let s = slots.find(s => s.clipId === c.id);
    if (s) return s;
    s = slots.find(s => !s.inUse) || slots[0];
    s.clipId = c.id;
    const m = mOf(c);
    s.kind = m.kind;
    if (m.kind === 'image') { if (s.img.src !== m.url) s.img.src = m.url; s.v.pause(); }
    else if (s.v.dataset.url !== m.url) { s.v.dataset.url = m.url; s.v.src = m.url; }
    return s;
  }
  function sync(time, isPlaying) {
    layout();
    slots.forEach(s => { s.inUse = false; });
    const cur = clipAt(time);
    const actives = [];
    if (cur) {
      const i = clips.indexOf(cur);
      const prev = clips[i - 1];
      if (prev && cur._td > 0 && time < prev._start + dur(prev)) actives.push({ c: prev, alpha: 1, vol: 1 - (time - cur._start) / cur._td });
      const a = cur._td > 0 && actives.length ? (time - cur._start) / cur._td : 1;
      actives.push({ c: cur, alpha: a, vol: a });
    }
    actives.forEach(x => { const s = slots.find(s => s.clipId === x.c.id); if (s) s.inUse = true; });
    actives.forEach((x, k) => {
      const s = assign(x.c); s.inUse = true;
      const m = mOf(x.c);
      const sp = spd(x.c), u = time - x.c._start, local = x.c.in + u * sp;
      const top = k === actives.length - 1;
      const fa = fadeAlpha(x.c.fx, u, dur(x.c));
      s.v.style.zIndex = s.img.style.zIndex = top ? 2 : 1;
      const src = m.kind === 'image' ? s.img : s.v;
      const gl = drawSlot(s), tgt = gl ? s.cv : src, fx = x.c.fx || {};
      for (const e of [s.img, s.v, s.cv]) { if (e !== tgt) e.style.opacity = '0'; }
      tgt.style.filter = [cssFilter(fx), fa < 1 ? `brightness(${fa.toFixed(3)})` : '', fx.blur > 0 ? `blur(${(fx.blur / 5 * el.frame.clientHeight / settings.height).toFixed(2)}px)` : ''].filter(Boolean).join(' ');
      // Ken Burns preview: CSS zoom/pan matching the export's eased path
      let kb = '';
      if (fx.kb && fx.kb.on) { const uu = clamp(u / Math.max(0.01, dur(x.c)), 0, 1), e = uu * uu * (3 - 2 * uu), z = (fx.kb.z0 || 1) + ((fx.kb.z1 || 1.3) - (fx.kb.z0 || 1)) * e, px = (fx.kb.x0 ?? 0.5) + ((fx.kb.x1 ?? 0.5) - (fx.kb.x0 ?? 0.5)) * e, py = (fx.kb.y0 ?? 0.5) + ((fx.kb.y1 ?? 0.5) - (fx.kb.y0 ?? 0.5)) * e;
        kb = `scale(${z.toFixed(4)}) translate(${((0.5 - px) * (1 - 1 / z) * 100).toFixed(3)}%, ${((0.5 - py) * (1 - 1 / z) * 100).toFixed(3)}%)`; }
      tgt.style.transform = [kb, cssTransform(fx)].filter(Boolean).join(' ');
      tgt.style.objectFit = (fx.fit || settings.fit) === 'fill' ? 'cover' : 'contain';
      const cr = fx.crop; tgt.style.objectViewBox = cr && (cr.l || cr.t || cr.r || cr.b) ? `inset(${cr.t || 0}% ${cr.r || 0}% ${cr.b || 0}% ${cr.l || 0}%)` : '';
      if (m.kind === 'image') {
        tgt.style.opacity = String(x.alpha);
      } else {
        tgt.style.opacity = String(x.alpha);
        if (fx.reverse) { const rl = x.c.out - u * sp; if (Math.abs(s.v.currentTime - rl) > 0.03) s.v.currentTime = Math.max(x.c.in, rl); if (!s.v.paused) s.v.pause(); s.v.muted = true; setAudioFx(s, x.c); return; }
        s.v.muted = x.c.muted || rate !== 1;
        s.v.volume = clamp((x.c.volume ?? 1) * x.vol * fa * (settings.mix ? settings.mix.main ?? 1 : 1), 0, 1);
        setAudioFx(s, x.c);
        const pr = clamp(sp * Math.abs(rate), 0.0625, 16);
        if (Math.abs(s.v.playbackRate - pr) > 1e-3) s.v.playbackRate = pr;
        const drift = Math.abs(s.v.currentTime - local);
        if (!isPlaying) { if (!s.v.paused) s.v.pause(); if (drift > 0.04) s.v.currentTime = local; }
        else {
          if (drift > 0.3) s.v.currentTime = local;
          if (s.v.paused) s.v.play().catch(() => {});
        }
      }
    });
    slots.forEach(s => { if (!s.inUse) { s.v.style.opacity = '0'; s.img.style.opacity = '0'; s.cv.style.opacity = '0'; if (!s.v.paused) s.v.pause(); s.clipId = null; } });
    syncOverlays(time, isPlaying);
    syncCaptions(time);
    if (!isPlaying && el.scopes && !el.scopes.hidden) requestAnimationFrame(drawScopes);
    el.vlabel.textContent = cur ? mOf(cur).name : (clips.length ? 'End of timeline' : '');
    el.vlabel.hidden = !cur && !clips.length;
    // music
    const live = new Set();
    for (const a of audio) {
      const m = byId(media, a.mediaId); if (!m) continue;
      const len = audioLen(a);
      if (time < a.start || time >= a.start + len) continue;
      live.add(a.id);
      let au = musicEls.get(a.id);
      if (!au) { au = new Audio(); au.preload = 'auto'; musicEls.set(a.id, au); }
      if (au.dataset.url !== m.url) { au.dataset.url = m.url; au.src = m.url; }
      const local = a.in + (time - a.start);
      let vol = a.volume ?? 1;
      if (a.fadeIn && time - a.start < a.fadeIn) vol *= (time - a.start) / a.fadeIn;
      if (a.fadeOut && a.start + len - time < a.fadeOut) vol *= (a.start + len - time) / a.fadeOut;
      au.volume = clamp(vol * (settings.mix ? settings.mix.music ?? 1 : 1), 0, 1);
      applyAfx(au, a.afx);
      if (!isPlaying) { if (!au.paused) au.pause(); if (Math.abs(au.currentTime - local) > 0.05) au.currentTime = local; }
      else { if (Math.abs(au.currentTime - local) > 0.3) au.currentTime = local; if (au.paused) au.play().catch(() => {}); }
    }
    for (const [id, au] of musicEls) if (!live.has(id) && !au.paused) au.pause();
  }
  let tickId = 0;
  function play(r = 1) {
    if (!clips.length && !audio.length && !overlays.length) return;
    rate = r;
    if (r > 0 && t >= timelineEnd() - 0.02) t = 0;
    playing = true; clock = { start: performance.now(), t0: t };
    paintPlayButton();
    const id = ++tickId;
    const tick = () => {
      if (!playing || id !== tickId) return;
      t = clock.t0 + (performance.now() - clock.start) / 1000 * rate;
      if (t >= timelineEnd()) { t = timelineEnd(); pause(); return; }
      if (t <= 0 && rate < 0) { t = 0; pause(); return; }
      sync(t, rate > 0); paintPlayhead();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  function pause() { playing = false; rate = 1; tickId++; sync(t, false); paintPlayButton(); paintPlayhead(); }
  function shuttle(dir) {
    if (dir === 0) return pause();
    const next = playing && Math.sign(rate) === dir ? clamp(Math.abs(rate) * 2, 1, 8) * dir : dir;
    if (playing) { clock = { start: performance.now(), t0: t }; rate = next; } else play(next);
    toast(`${dir < 0 ? '◀◀' : '▶'} ${Math.abs(next)}×`, 'info', 700);
  }
  function toggle() { playing ? pause() : play(); }
  function seek(time) {
    t = clamp(time, 0, Math.max(timelineEnd(), 0));
    if (playing) clock = { start: performance.now(), t0: t };
    sync(t, playing); paintPlayhead();
  }
  function stepFrame(n) { if (playing) pause(); seek(t + n / (settings.fps || 30)); }
  function jumpClip(dir) {
    layout();
    const edges = [0, ...clips.map(c => c._start), ...markers, total].sort((a, b) => a - b);
    const target = dir > 0 ? edges.find(e => e > t + 0.01) : [...edges].reverse().find(e => e < t - 0.01);
    seek(target ?? (dir > 0 ? total : 0));
  }

  // ---------- speed, clip effects, overlays, titles, markers ----------
  function spd(c) { const m = c && mOf(c); return !m || m.kind === 'image' ? 1 : clamp(c.speed || 1, 0.1, 8); }
  const FX0 = () => ({ brightness: 0, contrast: 0, saturation: 0, hue: 0, temperature: 0, rotate: 0, flipH: false, flipV: false, fadeIn: 0, fadeOut: 0 });
  const olen = o => Math.max(0, o.out - o.in);
  function cssFilter(fx) {
    if (!fx) return '';
    const f = [];
    if (fx.brightness) f.push(`brightness(${(1 + fx.brightness / 160).toFixed(3)})`);
    if (fx.contrast) f.push(`contrast(${(1 + fx.contrast / 100).toFixed(3)})`);
    if (fx.saturation) f.push(`saturate(${Math.max(0, 1 + fx.saturation / 100).toFixed(3)})`);
    if (fx.hue) f.push(`hue-rotate(${fx.hue}deg)`);
    if (fx.temperature) f.push(fx.temperature > 0 ? `sepia(${(fx.temperature / 300).toFixed(3)})` : `hue-rotate(${(fx.temperature / 8).toFixed(1)}deg)`);
    return f.join(' ');
  }
  function cssTransform(fx) {
    if (!fx) return '';
    const t = [];
    if (fx.rotate) t.push(`rotate(${fx.rotate}deg)`);
    if (fx.flipH || fx.flipV) t.push(`scale(${fx.flipH ? -1 : 1}, ${fx.flipV ? -1 : 1})`);
    return t.join(' ');
  }
  /** Fade-from-black multiplier for a clip at local timeline time `u` (0…d). */
  function fadeAlpha(fx, u, d) {
    let a = 1;
    if (fx && fx.fadeIn > 0 && u < fx.fadeIn) a *= Math.max(0, u / fx.fadeIn);
    if (fx && fx.fadeOut > 0 && d - u < fx.fadeOut) a *= Math.max(0, (d - u) / fx.fadeOut);
    return a;
  }

  const FONTS = ['Manrope', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Impact', 'Trebuchet MS', 'Verdana', 'Courier New'];
  const TITLE_PRESETS = {
    lower: { label: 'Lower third', x: 0.06, y: 0.84, align: 'left', size: 52, weight: 700, color: '#ffffff', bg: true, bgColor: '#000000', bgOpacity: 60, shadow: false, accent: true },
    center: { label: 'Centered title', x: 0.5, y: 0.5, align: 'center', size: 96, weight: 800, color: '#ffffff', bg: false, bgColor: '#000000', bgOpacity: 50, shadow: true, accent: false },
    caption: { label: 'Caption', x: 0.5, y: 0.9, align: 'center', size: 40, weight: 600, color: '#ffffff', bg: true, bgColor: '#000000', bgOpacity: 70, shadow: false, accent: false },
    top: { label: 'Top headline', x: 0.5, y: 0.12, align: 'center', size: 64, weight: 800, color: '#2fd67f', bg: false, bgColor: '#000000', bgOpacity: 50, shadow: true, accent: false },
  };
  /** Draw a title onto a transparent W×H canvas. Sizes are in 1/1000 of the frame height so titles scale with resolution. */
  function renderTitle(o, W, H) {
    const t = o.title, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const px = t.size / 1000 * H, lh = px * 1.18;
    g.font = `${t.italic ? 'italic ' : ''}${t.weight} ${px}px "${t.font}", sans-serif`; g.textBaseline = 'middle';
    const lines = String(t.text || '').split('\n');
    const tw = Math.max(1, ...lines.map(s => g.measureText(s).width)), th = lh * lines.length;
    const ax = o.x * W, ay = o.y * H;
    const left = t.align === 'left' ? ax : t.align === 'right' ? ax - tw : ax - tw / 2, top = ay - th / 2;
    if (t.bg) {
      const pad = px * 0.42;
      g.fillStyle = t.bgColor; g.globalAlpha = t.bgOpacity / 100;
      g.beginPath(); g.roundRect(left - pad, top - pad * 0.6, tw + pad * 2, th + pad * 1.2, px * 0.18); g.fill(); g.globalAlpha = 1;
      if (t.accent) { g.fillStyle = '#2fd67f'; g.fillRect(left - pad, top - pad * 0.6, Math.max(3, px * 0.09), th + pad * 1.2); }
    }
    if (t.shadow) { g.shadowColor = 'rgba(0,0,0,.65)'; g.shadowBlur = px * 0.25; g.shadowOffsetY = px * 0.06; }
    g.fillStyle = t.color; g.textAlign = t.align;
    const tx = t.align === 'left' ? left : t.align === 'right' ? left + tw : left + tw / 2;
    lines.forEach((s, i) => g.fillText(s, tx, top + lh * (i + 0.5)));
    const pad = px * 0.7;
    c.box = { x: Math.max(0, left - pad), y: Math.max(0, top - pad), w: Math.min(W, tw + pad * 2), h: Math.min(H, th + pad * 2) };
    return c;
  }
  const titleCache = new Map();
  function titleUrl(o) {
    const W = Math.min(1280, settings.width), H = Math.round(W * settings.height / settings.width);
    const k = JSON.stringify([o.title, o.x, o.y, W, H]);
    if (!titleCache.has(k)) {
      if (titleCache.size > 60) titleCache.clear();
      // Preview only the text's own box so overlays underneath stay clickable.
      const full = renderTitle(o, W, H), b = full.box, c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(b.w)); c.height = Math.max(1, Math.round(b.h));
      c.getContext('2d').drawImage(full, -b.x, -b.y);
      titleCache.set(k, { url: c.toDataURL('image/png'), box: { x: b.x / W, y: b.y / H, w: b.w / W, h: b.h / H } });
    }
    return titleCache.get(k);
  }
  function addTitle(preset = 'lower', at = t) {
    const p = TITLE_PRESETS[preset];
    const o = { id: uid('o'), kind: 'title', start: at, in: 0, out: 4, x: p.x, y: p.y, opacity: 1, fadeIn: 0.3, fadeOut: 0.3,
      title: { text: preset === 'lower' ? 'Your name\nRule of 3s' : 'Your title', font: 'Manrope', size: p.size, weight: p.weight, italic: false, color: p.color, align: p.align, bg: p.bg, bgColor: p.bgColor, bgOpacity: p.bgOpacity, shadow: p.shadow, accent: p.accent } };
    overlays.push(o); sel = { type: 'overlay', id: o.id }; commit('Add title');
  }
  function titleMenu(anchor) { menuAt(anchor, Object.entries(TITLE_PRESETS).map(([k, p]) => ({ label: p.label, onClick: () => addTitle(k) }))); }
  function addOverlay(m, at = t) {
    if (!m || !m.info) return toast('Still reading that file — try again in a moment.', 'error');
    if (m.kind === 'audio') return addToTimelineAudio(m, at);
    const o = { id: uid('o'), kind: m.kind, mediaId: m.id, start: at, in: 0, out: m.kind === 'image' ? 5 : m.info.duration, x: 0.78, y: 0.24, scale: 0.32, opacity: 1, fadeIn: 0.25, fadeOut: 0.25, volume: 1, muted: true, fx: FX0() };
    if (m.kind === 'image' && m.info.width && m.info.width < 600) { o.scale = 0.12; o.x = 0.1; o.y = 0.12; o.fadeIn = o.fadeOut = 0; o.out = Math.max(5, total || 5); }
    overlays.push(o); sel = { type: 'overlay', id: o.id }; commit(m.kind === 'image' ? 'Add image overlay' : 'Add picture-in-picture');
  }

  /** Snap a time to nearby edits, markers and the playhead (within 8px). */
  function snapTime(time, ignore) {
    if (!snapOn) return time;
    layout();
    const pts = [0, t, total, ...markers];
    clips.forEach(c => pts.push(c._start, c._start + dur(c)));
    overlays.forEach(o => { if (o !== ignore) pts.push(o.start, o.start + olen(o)); });
    audio.forEach(a => { if (a !== ignore) pts.push(a.start, a.start + audioLen(a)); });
    const tol = 8 / zoom;
    let best = time, bd = tol;
    for (const p of pts) { const d = Math.abs(p - time); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  function editMarker(i) {
    const tm = markers[i]; if (tm == null) return;
    const name = h(`<label class="field"><span>Name (used for chapters)</span><input type="text" value="${esc(markerNames[mkKey(tm)] || '')}" placeholder="e.g. Intro"></label>`);
    let del = false;
    modal({ title: `Marker at ${fmtTime(tm)}`, body: h('<div class="stack"></div>').appendChild(name).parentNode, width: 380, actions: [
      { label: 'Delete marker', kind: 'danger', onClick: () => { del = true; } },
      { label: 'Cancel', kind: 'ghost' },
      { label: 'Save', kind: 'primary', onClick: () => { const n = $('input', name).value.trim(); if (n) markerNames[mkKey(tm)] = n; else delete markerNames[mkKey(tm)]; commit('Name marker'); } },
    ], onClose: () => { if (del) { markers.splice(i, 1); delete markerNames[mkKey(tm)]; commit('Remove marker'); } } });
    setTimeout(() => { const inp = $('input', name); inp && inp.focus(); }, 30);
  }
  function chapterData() {
    layout();
    return markers.map(tm => ({ time: tm, name: markerNames[mkKey(tm)] || '' }));
  }
  function copyChapters() {
    if (!markers.length) return toast('Add markers (M) at each chapter start first, then name them by double-clicking.', 'info', 5000);
    const r = Captions.toChapters(chapterData().map(m => ({ time: m.time, name: m.name || `Chapter at ${fmtTime(m.time, false)}` })), timelineEnd());
    const ta = h('<textarea rows="8" readonly style="width:100%"></textarea>'); ta.value = r.text;
    const body = h('<div class="stack"></div>'); body.append(ta);
    if (r.warnings.length) body.append(h(`<p class="hint">${r.warnings.map(esc).join('<br>')}</p>`));
    modal({ title: 'YouTube chapters', body, width: 460, actions: [{ label: 'Close', kind: 'ghost' }, { label: 'Copy', kind: 'primary', onClick: () => { navigator.clipboard.writeText(r.text).then(() => toast('Chapters copied — paste them into your YouTube description.', 'ok')); } }] });
  }
  function toggleMarker() {
    const i = markers.findIndex(m => Math.abs(m - t) < 0.5 / zoom * 8);
    if (i >= 0) { delete markerNames[mkKey(markers[i])]; markers.splice(i, 1); } else markers.push(+t.toFixed(3));
    markers.sort((a, b) => a - b);
    commit(i >= 0 ? 'Remove marker' : 'Add marker');
  }

  // ---------- scopes (FilmCraft crates/scopes: waveform, RGB parade, vectorscope, histogram) ----------
  let scopeMode = 'wave', scopeRaf = 0, supported = null;
  const SW = 512, SH = 288, scopeSrc = document.createElement('canvas'); scopeSrc.width = SW; scopeSrc.height = SH;
  function scopeLoop() { cancelAnimationFrame(scopeRaf); const tick = () => { if (!el.scopes || el.scopes.hidden) return; if (playing) drawScopes(); scopeRaf = requestAnimationFrame(tick); }; tick(); drawScopes(); }
  function drawScopes() {
    if (!el.scopes || el.scopes.hidden) return;
    const s = slots.find(x => x.inUse && x.clipId), sx = scopeSrc.getContext('2d', { willReadFrequently: true });
    sx.fillStyle = '#000'; sx.fillRect(0, 0, SW, SH);
    if (s) { const src = s.glOn ? s.cv : s.kind === 'image' ? s.img : s.v; try { sx.drawImage(src, 0, 0, SW, SH); } catch (_) {} }
    const d = sx.getImageData(0, 0, SW, SH).data, cv = el.scopeCv, g = cv.getContext('2d'), W = cv.width, H = cv.height;
    g.fillStyle = '#050806'; g.fillRect(0, 0, W, H);
    const plot = (acc, color, x0, w) => {
      const img = g.getImageData(x0, 0, w, H), o = img.data; let mx = 1; for (const a of acc) if (a > mx) mx = a; const k = 1 / Math.log(1 + mx * 0.35);
      for (let i = 0; i < acc.length; i++) { if (!acc[i]) continue; const a = Math.min(1, Math.log(1 + acc[i]) * k * 1.6); o[i * 4] = Math.min(255, o[i * 4] + color[0] * a); o[i * 4 + 1] = Math.min(255, o[i * 4 + 1] + color[1] * a); o[i * 4 + 2] = Math.min(255, o[i * 4 + 2] + color[2] * a); o[i * 4 + 3] = 255; }
      g.putImageData(img, x0, 0);
    };
    g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 1;
    if (scopeMode === 'wave' || scopeMode === 'parade') {
      for (const lv of [0, 0.25, 0.5, 0.75, 1]) { g.beginPath(); g.moveTo(0, (1 - lv) * (H - 1)); g.lineTo(W, (1 - lv) * (H - 1)); g.stroke(); }
      if (scopeMode === 'wave') {
        const acc = new Uint32Array(W * H);
        for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) { const i = (y * SW + x) * 4, L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; const px = Math.floor(x / SW * W), py = Math.round((1 - L / 255) * (H - 1)); acc[py * W + px]++; }
        plot(acc, [90, 255, 160], 0, W);
      } else {
        const w3 = Math.floor(W / 3);
        [[255, 70, 70], [70, 255, 110], [80, 140, 255]].forEach((col, ch) => {
          const acc = new Uint32Array(w3 * H);
          for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) { const v = d[(y * SW + x) * 4 + ch]; acc[Math.round((1 - v / 255) * (H - 1)) * w3 + Math.floor(x / SW * w3)]++; }
          plot(acc, col, ch * w3, w3);
        });
      }
    } else if (scopeMode === 'vector') {
      const S = Math.min(W, H), cx = W / 2, cy = H / 2, R = S / 2 - 6, acc = new Uint32Array(W * H);
      g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
      // colour targets (BT.709) and the skin-tone line
      const tgt = [['R', 255, 0, 0], ['Y', 255, 255, 0], ['G', 0, 255, 0], ['C', 0, 255, 255], ['B', 0, 0, 255], ['M', 255, 0, 255]];
      const uv = (r, gg, b) => { const Y = 0.2126 * r + 0.7152 * gg + 0.0722 * b; return [(b - Y) / 1.8556 / 255, (r - Y) / 1.5748 / 255]; };
      g.fillStyle = 'rgba(255,255,255,.35)'; g.font = '10px Manrope';
      for (const [n, r, gg, b] of tgt) { const [u, vv] = uv(r, gg, b); g.strokeRect(cx + u * 2 * R - 4, cy - vv * 2 * R - 4, 8, 8); g.fillText(n, cx + u * 2 * R + 6, cy - vv * 2 * R + 3); }
      g.strokeStyle = 'rgba(255,200,150,.3)'; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(-2.15) * R, cy + Math.sin(-2.15) * R); g.stroke();
      for (let i = 0; i < d.length; i += 4) { const [u, vv] = uv(d[i], d[i + 1], d[i + 2]); const px = Math.round(cx + u * 2 * R), py = Math.round(cy - vv * 2 * R); if (px >= 0 && py >= 0 && px < W && py < H) acc[py * W + px]++; }
      plot(acc, [140, 255, 190], 0, W);
    } else {
      const hs = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
      for (let i = 0; i < d.length; i += 4) { hs[0][d[i]]++; hs[1][d[i + 1]]++; hs[2][d[i + 2]]++; }
      const mx = Math.max(...hs.map(h0 => Array.from(h0).sort((a, b) => b - a)[2] || 1));
      g.globalCompositeOperation = 'screen';
      [['rgba(255,70,70,.8)', 0], ['rgba(70,230,110,.8)', 1], ['rgba(80,140,255,.85)', 2]].forEach(([col, ch]) => { g.fillStyle = col; g.beginPath(); g.moveTo(0, H); for (let i = 0; i < 256; i++) g.lineTo(i / 255 * W, H - Math.min(1, hs[ch][i] / mx) * (H - 6)); g.lineTo(W, H); g.fill(); });
      g.globalCompositeOperation = 'source-over';
    }
  }

  // ---------- captions ----------
  function captionOverlay(cap) {
    const s = Object.assign(CAPTION_STYLE(), settings.captionStyle || {});
    return { x: 0.5, y: s.y, title: { text: cap.text, font: s.font, size: s.size, weight: s.weight, italic: false, color: s.color, align: 'center', bg: s.bg, bgColor: '#000000', bgOpacity: s.bgOpacity, shadow: !s.bg, accent: false } };
  }
  function addCaption(at = t) {
    const next = captions.filter(c => c.start > at + 0.05).sort((a, b) => a.start - b.start)[0];
    const end = Math.min(at + 3, next ? next.start : at + 3);
    const c = { id: uid('cap'), start: +at.toFixed(3), end: +Math.max(at + 0.5, end).toFixed(3), text: 'Caption text' };
    captions.push(c); captions.sort((a, b) => a.start - b.start); sel = { type: 'caption', id: c.id }; commit('Add caption');
    setTimeout(() => { const ta = el.ins.querySelector('textarea'); if (ta) { ta.focus(); ta.select(); } }, 30);
  }
  async function importCaptions() {
    const ps = await ro3.openDialog({ title: 'Import captions', filters: [{ name: 'Subtitles', extensions: ['srt', 'vtt'] }] }).catch(() => null);
    const p = ps && (Array.isArray(ps) ? ps[0] : ps); if (!p) return;
    try {
      const cues = Captions.parse(await ro3.readText(p), p);
      if (!cues.length) return toast('No captions found in that file.', 'error');
      const off = t > 0.05 && captions.length === 0 ? 0 : 0;
      captions = [...captions, ...cues.map(c => ({ id: uid('cap'), start: c.start + off, end: c.end + off, text: c.text }))].sort((a, b) => a.start - b.start);
      commit('Import captions'); toast(`Imported ${cues.length} captions.`, 'ok');
    } catch (e) { toast('Could not read captions: ' + e.message, 'error'); }
  }
  async function exportCaptions(fmt = 'srt') {
    if (!captions.length) return toast('There are no captions to export.', 'info');
    const base = projectPath ? stripExt(baseName(projectPath)) : 'captions';
    const out = await ro3.saveDialog({ title: 'Export captions', defaultPath: `${base}.${fmt}`, filters: [{ name: fmt.toUpperCase(), extensions: [fmt] }] });
    if (!out) return;
    const cues = captions.map(c => ({ start: c.start, end: c.end, text: c.text }));
    await ro3.writeText(out, fmt === 'vtt' ? Captions.toVTT(cues) : Captions.toSRT(cues));
    toast(`Saved ${baseName(out)}.`, 'ok');
  }
  function syncCaptions(time) {
    if (!el.capView) return;
    const cur = captions.find(c => time >= c.start && time < c.end);
    if (!cur) { el.capView.hidden = true; return; }
    const s = Object.assign(CAPTION_STYLE(), settings.captionStyle || {}), fh = el.frame.clientHeight;
    el.capView.hidden = false;
    if (el.capView.dataset.k !== cur.id + cur.text + JSON.stringify(s)) {
      el.capView.dataset.k = cur.id + cur.text + JSON.stringify(s);
      el.capView.innerHTML = esc(cur.text).replace(/\n/g, '<br>');
    }
    Object.assign(el.capView.style, { top: (s.y * 100) + '%', fontSize: (s.size / 1000 * fh) + 'px', color: s.color, fontWeight: s.weight, background: s.bg ? `rgba(0,0,0,${s.bgOpacity / 100})` : 'transparent', textShadow: s.bg ? 'none' : '0 2px 6px rgba(0,0,0,.7)' });
  }
  function captionInspector(c) {
    const b = el.ins; el.insHead.textContent = 'Caption';
    const ta = h('<label class="field"><span>Text</span><textarea rows="3"></textarea></label>'); $('textarea', ta).value = c.text;
    $('textarea', ta).addEventListener('input', e => { c.text = e.target.value; syncCaptions(t); renderTimeline(); });
    $('textarea', ta).addEventListener('change', () => commit('Edit caption'));
    const st = numberField('Start', +c.start.toFixed(2), { min: 0, step: 0.05, suffix: 's' }), en = numberField('End', +c.end.toFixed(2), { min: 0, step: 0.05, suffix: 's' });
    st.input.addEventListener('change', () => { c.start = Math.max(0, Math.min(st.get(), c.end - 0.1)); commit('Caption timing'); });
    en.input.addEventListener('change', () => { c.end = Math.max(c.start + 0.1, en.get()); commit('Caption timing'); });
    const row = h('<div class="row"></div>'); row.append(st, en);
    const acts = h('<div class="ins-actions"></div>');
    const mk = (ic, l, fn, k = '') => { const x = h(`<button class="btn btn-sm ${k}">${icon(ic)}${l}</button>`); x.addEventListener('click', fn); return x; };
    acts.append(mk('plus', 'Next caption', () => addCaption(c.end)), mk('trash', 'Delete', removeSelected, 'btn-danger'));
    b.append(ta, row, captionStyleBox(), acts, h('<p class="hint">Captions are burned into the video on export (you can turn that off) and can be saved as .srt or .vtt for YouTube and other players.</p>'));
  }
  function captionStyleBox() {
    settings.captionStyle = Object.assign(CAPTION_STYLE(), settings.captionStyle || {});
    const s = settings.captionStyle;
    const [box, inner] = details('Caption style (all captions)');
    const S = (label, key, min, max, step, fmt) => { const x = slider({ label, min, max, step, value: s[key], fmt }); x.input.addEventListener('input', () => { s[key] = x.get(); syncCaptions(t); }); x.input.addEventListener('change', () => commit('Caption style')); return x; };
    const col = h(`<label class="field" style="flex:none"><span>Text</span><input type="color" value="${s.color}"></label>`); $('input', col).addEventListener('input', e => { s.color = e.target.value; syncCaptions(t); }); $('input', col).addEventListener('change', () => commit('Caption style'));
    const bg = checkField('Background box', s.bg); bg.input.addEventListener('change', () => { s.bg = bg.get(); commit('Caption style'); });
    const row = h('<div class="row" style="align-items:flex-end"></div>'); row.append(col, bg);
    inner.append(S('Size', 'size', 20, 120, 1, v => v), S('Position', 'y', 0.1, 0.95, 0.01, v => Math.round(v * 100) + '%'), row, S('Box opacity', 'bgOpacity', 0, 100, 1, v => v + '%'));
    return box;
  }

  // overlay elements in the viewer
  const ovEls = new Map(), ovGl = new Map();
  function overlayEl(o) {
    let e = ovEls.get(o.id);
    const want = o.kind === 'video' ? 'VIDEO' : 'IMG';
    if (e && e.tagName !== want) { e.remove(); e = null; }
    if (!e) {
      e = document.createElement(want.toLowerCase()); e.className = 'ov-el'; e.draggable = false;
      if (want === 'VIDEO') { e.playsInline = true; e.preload = 'auto'; }
      e.addEventListener('pointerdown', ev => startOverlayDrag(ev, o.id));
      el.frame.appendChild(e); ovEls.set(o.id, e);
    }
    return e;
  }
  function syncOverlays(time, isPlaying) {
    const live = new Set();
    overlays.forEach((o, k) => {
      const len = olen(o);
      if (time < o.start || time >= o.start + len) return;
      live.add(o.id);
      const e = overlayEl(o), m = o.mediaId ? byId(media, o.mediaId) : null;
      e.style.zIndex = 10 + k;
      const u = time - o.start, st = ovState(o, time);
      e.style.opacity = String(st.opacity * fadeAlpha(o, u, len));
      e.classList.toggle('sel', !!(sel && sel.type === 'overlay' && sel.id === o.id));
      if (o.kind === 'title') {
        const tu = titleUrl(o); if (e.src !== tu.url) e.src = tu.url;
        const dx = st.x - o.x, dy = st.y - o.y, sc = (st.scale ?? o.scale ?? 1) / (o.scale ?? 1);
        Object.assign(e.style, { left: (tu.box.x + dx) * 100 + '%', top: (tu.box.y + dy) * 100 + '%', width: tu.box.w * 100 + '%', height: tu.box.h * 100 + '%', transform: [sc !== 1 ? `scale(${sc.toFixed(4)})` : '', st.rotation ? `rotate(${st.rotation}deg)` : ''].filter(Boolean).join(' '), filter: '' });
        return;
      }
      if (!m) return;
      if (o.kind === 'image') { if (e.dataset.url !== m.url) { e.dataset.url = m.url; e.src = m.url; } }
      else if (e.dataset.url !== m.url) { e.dataset.url = m.url; e.src = m.url; }
      const rot = ((o.fx && o.fx.rotate) || 0) % 180 !== 0;
      const ar = m.info && m.info.width ? (rot ? m.info.width / m.info.height : m.info.height / m.info.width) : 9 / 16;
      const wf = st.scale, hf = wf * ar * settings.width / settings.height;
      const box = { left: ((st.x - wf / 2) * 100) + '%', top: ((st.y - hf / 2) * 100) + '%', width: (wf * 100) + '%', height: (hf * 100) + '%', filter: cssFilter(o.fx), transform: [st.rotation ? `rotate(${st.rotation}deg)` : '', cssTransform(o.fx)].filter(Boolean).join(' ') };
      Object.assign(e.style, box);
      // keyed or graded overlays draw through WebGL on a canvas laid over the (now invisible, still draggable) element
      const lf = o.grade ? GLView.lutFor(gradeWithLut(o.grade)) : null;
      if ((o.key && o.key.on) || lf) {
        let gc = ovGl.get(o.id);
        if (!gc) { const cv = document.createElement('canvas'); cv.className = 'ov-gl'; el.frame.appendChild(cv); let g = null; try { g = GLView.create(cv); } catch (_) {} gc = { cv, g }; ovGl.set(o.id, gc); }
        if (gc.g) {
          gc.g.setKey(o.key); gc.g.setLut(lf && lf.L, lf && lf.key); gc.g.setSpatial(null);
          if (gc.g.draw(e)) { Object.assign(gc.cv.style, box, { opacity: e.style.opacity, zIndex: 10 + k }); e.style.opacity = '0'; gc.live = true; }
        }
      }
      if (o.kind === 'video') {
        const local = o.in + u;
        e.muted = !!o.muted; e.volume = clamp(o.volume ?? 1, 0, 1);
        const drift = Math.abs(e.currentTime - local);
        if (!isPlaying) { if (!e.paused) e.pause(); if (drift > 0.04) e.currentTime = local; }
        else { if (drift > 0.3) e.currentTime = local; if (e.paused) e.play().catch(() => {}); }
      }
    });
    for (const [id, gc] of ovGl) {
      const o = byId(overlays, id);
      if (!o || !live.has(id) || !((o.key && o.key.on) || o.grade)) { gc.cv.style.opacity = '0'; if (!o) { gc.cv.remove(); ovGl.delete(id); } }
    }
    for (const [id, e] of ovEls) {
      if (!overlays.some(o => o.id === id)) { e.remove(); ovEls.delete(id); continue; }
      if (!live.has(id)) { e.style.opacity = '0'; e.style.pointerEvents = 'none'; if (e.tagName === 'VIDEO' && !e.paused) e.pause(); }
      else e.style.pointerEvents = '';
    }
  }
  /** Drag an overlay around the frame to place it. */
  function startOverlayDrag(ev, id) {
    const o = byId(overlays, id); if (!o) return;
    ev.preventDefault(); ev.stopPropagation();
    if (!(sel && sel.id === id)) { sel = { type: 'overlay', id }; refresh(); }
    const st0 = ovState(o, t), r = el.frame.getBoundingClientRect(), x0 = st0.x, y0 = st0.y, sx = ev.clientX, sy = ev.clientY;
    const tgt = ev.currentTarget; try { tgt.setPointerCapture(ev.pointerId); } catch (_) {}
    let moved = false;
    const mv = e => {
      moved = true;
      let nx = x0 + (e.clientX - sx) / r.width, ny = y0 + (e.clientY - sy) / r.height;
      if (!e.ctrlKey && !e.metaKey) for (const g of [1 / 3, 0.5, 2 / 3]) { if (Math.abs(nx - g) < 0.012) nx = g; if (Math.abs(ny - g) < 0.012) ny = g; }
      nx = clamp(nx, -0.2, 1.2); ny = clamp(ny, -0.2, 1.2);
      if (hasKfs(o, 'x') || hasKfs(o, 'y')) { setKey(o, 'x', nx); setKey(o, 'y', ny); } else { o.x = nx; o.y = ny; }
      syncOverlays(t, playing);
    };
    const up = () => { tgt.removeEventListener('pointermove', mv); tgt.removeEventListener('pointerup', up); if (moved) commit('Move overlay'); };
    tgt.addEventListener('pointermove', mv); tgt.addEventListener('pointerup', up);
  }

  function bindOverlay(node, o) {
    const m = o.mediaId ? byId(media, o.mediaId) : null;
    const maxOut = o.kind === 'video' && m ? m.info.duration : 3600;
    $$('.trim', node).forEach(handle => {
      const left = handle.classList.contains('l');
      onDrag(handle, {
        start: e => { e.stopPropagation(); sel = { type: 'overlay', id: o.id }; handle._o = { in: o.in, out: o.out, start: o.start, x: e.clientX }; },
        move: e => {
          const d = (e.clientX - handle._o.x) / zoom;
          if (left) {
            const ns = snapTime(Math.max(0, handle._o.start + d), o), nd = ns - handle._o.start;
            if (o.kind === 'video') { const k = clamp(nd, -handle._o.in, handle._o.out - handle._o.in - 0.2); o.in = handle._o.in + k; o.start = handle._o.start + k; }
            else { const k = Math.min(nd, handle._o.out - 0.2); o.start = handle._o.start + k; o.out = handle._o.out - k; }
          } else {
            const ne = snapTime(handle._o.start + (handle._o.out - handle._o.in) + d, o);
            o.out = clamp(o.in + ne - o.start, o.in + 0.2, maxOut);
          }
          renderTimeline(); renderInspector();
        },
        end: () => commit('Trim overlay'),
      });
    });
    onDrag(node, {
      start: e => { if (e.target.classList.contains('trim')) return false; sel = { type: 'overlay', id: o.id }; node._d = { x: e.clientX, s: o.start, moved: false }; renderTimeline(); renderInspector(); syncOverlays(t, playing); },
      move: e => { const dx = e.clientX - node._d.x; if (!node._d.moved && Math.abs(dx) < 4) return; node._d.moved = true; o.start = snapTime(Math.max(0, node._d.s + dx / zoom), o); node.style.left = o.start * zoom + 'px'; },
      end: e => { if (node._d.moved) commit('Move overlay'); else { seek(xToTime(e.clientX)); refresh(); } },
    });
  }

  function overlayInspector(o) {
    const b = el.ins, m = o.mediaId ? byId(media, o.mediaId) : null;
    el.insHead.textContent = o.kind === 'title' ? 'Title' : 'Overlay';
    const live = () => syncOverlays(t, playing);
    const S = (label, key, min, max, step, fmt, obj = o, scale = 1) => {
      const s = slider({ label, min, max, step, value: +((obj === o && ['x', 'y', 'scale', 'opacity'].includes(key) ? ovState(o, t)[key] : obj[key]) * scale).toFixed(3), fmt });
      s.input.addEventListener('input', () => { if (obj === o && hasKfs(o, key)) setKey(o, key, s.get() / scale); else obj[key] = s.get() / scale; live(); });
      s.input.addEventListener('change', () => commit('Edit ' + label.toLowerCase()));
      return s;
    };
    if (o.kind === 'title') {
      const tt = o.title;
      const ta = h(`<label class="field"><span>Text</span><textarea rows="3"></textarea></label>`); $('textarea', ta).value = tt.text;
      $('textarea', ta).addEventListener('input', e => { tt.text = e.target.value; live(); renderTimeline(); });
      $('textarea', ta).addEventListener('change', () => commit('Edit title text'));
      const font = selectField('Font', FONTS.map(f => [f, f]), tt.font); font.select.addEventListener('change', () => { tt.font = font.get(); live(); commit('Title font'); });
      const weight = selectField('Weight', [[400, 'Regular'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extra bold']], tt.weight); weight.select.addEventListener('change', () => { tt.weight = Number(weight.get()); live(); commit('Title weight'); });
      const align = selectField('Align', [['left', 'Left'], ['center', 'Center'], ['right', 'Right']], tt.align); align.select.addEventListener('change', () => { tt.align = align.get(); live(); commit('Title align'); });
      const r1 = h('<div class="row"></div>'); r1.append(font, weight);
      const col = (label, key) => { const c = h(`<label class="field" style="flex:none"><span>${label}</span><input type="color" value="${tt[key]}"></label>`); $('input', c).addEventListener('input', e => { tt[key] = e.target.value; live(); }); $('input', c).addEventListener('change', () => commit('Title color')); return c; };
      const r2 = h('<div class="row" style="align-items:flex-end"></div>'); r2.append(col('Text', 'color'), align);
      const bg = checkField('Background box', tt.bg); bg.input.addEventListener('change', () => { tt.bg = bg.get(); live(); commit('Title box'); });
      const acc = checkField('Green accent bar', tt.accent); acc.input.addEventListener('change', () => { tt.accent = acc.get(); live(); commit('Title accent'); });
      const sh = checkField('Drop shadow', tt.shadow); sh.input.addEventListener('change', () => { tt.shadow = sh.get(); live(); commit('Title shadow'); });
      const r3 = h('<div class="row" style="align-items:flex-end"></div>'); r3.append(col('Box', 'bgColor'), S('Box opacity', 'bgOpacity', 0, 100, 1, v => v + '%', tt));
      b.append(ta, r1, r2, S('Size', 'size', 16, 260, 1, v => v, tt), bg, r3, acc, sh);
    } else if (m) {
      b.appendChild(titleBlock(m, o.kind === 'image' ? 'Image overlay' : 'Picture-in-picture'));
      b.append(S('Size', 'scale', 2, 100, 1, v => v + '%', o, 100));
    }
    const pos = h('<div class="row"></div>'); pos.append(S('Left ↔ right', 'x', -10, 110, 0.5, v => Math.round(v) + '%', o, 100), S('Top ↕ bottom', 'y', -10, 110, 0.5, v => Math.round(v) + '%', o, 100));
    const place = h(`<div class="anchor-grid" title="Snap to a rule-of-thirds point">${[[1/6,1/6],[.5,1/6],[5/6,1/6],[1/6,.5],[.5,.5],[5/6,.5],[1/6,5/6],[.5,5/6],[5/6,5/6]].map(([x, y]) => `<button data-x="${x}" data-y="${y}" aria-label="Place"></button>`).join('')}</div>`);
    $$('button', place).forEach(bt => bt.addEventListener('click', () => { o.x = o.kind === 'title' && o.title.align === 'left' ? Math.max(0.05, +bt.dataset.x - 0.12) : +bt.dataset.x; o.y = +bt.dataset.y; commit('Place overlay'); }));
    const fades = h('<div class="row"></div>'); fades.append(S('Fade in', 'fadeIn', 0, 3, 0.1, v => v.toFixed(1) + 's'), S('Fade out', 'fadeOut', 0, 3, 0.1, v => v.toFixed(1) + 's'));
    const st = numberField('Starts at', +o.start.toFixed(2), { min: 0, step: 0.1, suffix: 's' }); st.input.addEventListener('change', () => { o.start = Math.max(0, st.get()); commit('Move overlay'); });
    const ln = numberField('Duration', +olen(o).toFixed(2), { min: 0.2, step: 0.1, suffix: 's' }); ln.input.addEventListener('change', () => { o.out = o.in + Math.max(0.2, o.kind === 'video' && m ? Math.min(ln.get(), m.info.duration - o.in) : ln.get()); commit('Overlay length'); });
    const timing = h('<div class="row"></div>'); timing.append(st, ln);
    b.append(h('<div class="field"><span>Position (drag it in the viewer, too)</span></div>'), pos, place, S('Opacity', 'opacity', 0, 100, 1, v => v + '%', o, 100), fades, timing);
    if (o.kind === 'video' && m && m.info.hasAudio) {
      const mute = checkField('Mute overlay audio', o.muted); mute.input.addEventListener('change', () => { o.muted = mute.get(); commit('Overlay audio'); });
      b.append(mute);
    }
    if (o.kind !== 'title') {
      const rs = slider({ label: 'Rotation', min: -180, max: 180, value: Math.round(o.rotation || 0), fmt: v => v + '°' });
      rs.input.addEventListener('input', () => { if (hasKfs(o, 'rotation')) setKey(o, 'rotation', rs.get()); else o.rotation = rs.get(); syncOverlays(t, playing); });
      rs.input.addEventListener('change', () => commit('Rotate overlay'));
      b.append(rs, colorControls(o), keySection(o), gradeSection(o), effectsSection(o, true));
      if (o.kind === 'video' && m && m.info.hasAudio) b.append(audioSection(o));
    }
    b.append(animateSection(o));
    const acts = h('<div class="ins-actions"></div>');
    const dup = h(`<button class="btn btn-sm">${icon('copy')}Duplicate</button>`); dup.addEventListener('click', () => { const n = JSON.parse(JSON.stringify(o)); n.id = uid('o'); n.start = o.start + olen(o); overlays.push(n); sel = { type: 'overlay', id: n.id }; commit('Duplicate overlay'); });
    const del = h(`<button class="btn btn-sm btn-danger">${icon('trash')}Delete</button>`); del.addEventListener('click', removeSelected);
    acts.append(dup, del); b.append(acts);
  }

  // ---------- inspector sections added in 1.3 ----------
  const details = (title, open = false) => { const d = h(`<details class="fx-details"><summary>${esc(title)}</summary><div class="stack"></div></details>`); d.open = open; return [d, $('.stack', d)]; };
  const sgn = v => (v > 0 ? '+' : '') + v;
  /** Lumetri-style colour panel: the same grade maths as the Photo tab, previewed through WebGL, exported as a 3D LUT. */
  function gradeSection(item) {
    const [box, inner] = details('Color grade', !!(item.grade && ColorGrade.isColorActive(item.grade)));
    const has = () => !!item.grade;
    if (!has()) {
      const add = h(`<button class="btn btn-sm">${icon('sliders')}Add color grade</button>`);
      add.addEventListener('click', () => { item.grade = ColorGrade.DEFAULT(); commit('Add color grade'); });
      inner.append(add, h('<p class="hint">Exposure, white balance, tone, looks, color wheels, curves, LUTs, vignette and sharpening — previewed exactly as exported.</p>'));
      return box;
    }
    let q = false;
    const live = () => { if (q) return; q = true; requestAnimationFrame(() => { q = false; sync(t, playing); }); };
    PhotoAdjust.gradeEditor(item.grade, inner, live, () => commit('Color grade'), {
      spatial: true, rebuild: () => renderInspector(),
      extra: wrap => {
        const lut = item.grade.lut;
        const sec = h(`<details class="grade-sec" ${lut ? 'open' : ''}><summary>LUT</summary><div class="stack"></div></details>`), st = $('.stack', sec);
        const info = h(`<p class="hint">${lut ? esc(lut.name) : 'Apply a .cube or .3dl LUT from your camera maker or colourist.'}</p>`);
        const load = h(`<button class="btn btn-sm">${lut ? 'Replace LUT…' : 'Load LUT…'}</button>`);
        load.addEventListener('click', async () => {
          const ps = await ro3.openDialog({ title: 'Choose a LUT', filters: [{ name: '3D LUT', extensions: ['cube', '3dl'] }] }).catch(() => null);
          const p = ps && (Array.isArray(ps) ? ps[0] : ps); if (!p) return;
          try { const tx = await ro3.readText(p); ColorGrade.parseLut(tx, p); lutTexts.set(p, tx); item.grade.lut = { name: baseName(p), path: p, amount: 100 }; commit('Load LUT'); }
          catch (e) { toast('Could not load that LUT: ' + e.message, 'error'); }
        });
        st.append(info, load);
        if (lut) {
          const s = slider({ label: 'LUT intensity', min: 0, max: 100, value: lut.amount ?? 100, unit: '%' });
          s.input.addEventListener('input', () => { lut.amount = s.get(); live(); }); s.input.addEventListener('change', () => commit('LUT intensity'));
          const rm = h('<button class="btn btn-sm btn-ghost">Remove LUT</button>'); rm.addEventListener('click', () => { item.grade.lut = null; commit('Remove LUT'); });
          st.append(s, rm);
        }
        wrap.appendChild(sec);
      },
    });
    const rm = h('<button class="btn btn-sm btn-ghost">Remove color grade</button>'); rm.addEventListener('click', () => { item.grade = null; commit('Remove color grade'); });
    const copy = h('<button class="btn btn-sm btn-ghost">Copy grade to all clips</button>'); copy.addEventListener('click', () => { const g = JSON.parse(JSON.stringify(item.grade)); clips.forEach(c => { c.grade = JSON.parse(JSON.stringify(g)); }); commit('Copy grade to all clips'); });
    const row = h('<div class="row"></div>'); row.append(copy, rm); inner.appendChild(row);
    return box;
  }
  /** Picture effects (FilmCraft's effect catalogue, rendered with FFmpeg). */
  function effectsSection(c, isOverlay) {
    c.fx = Object.assign(FX0(), c.fx || {});
    const fx = c.fx;
    const active = ['blur', 'sharpen', 'denoise', 'grain', 'glow', 'rgbsplit', 'echo', 'posterizeTime'].some(k => fx[k] > 0) || fx.stabilize || fx.reverse || fx.edges || (fx.kb && fx.kb.on) || (fx.crop && (fx.crop.l || fx.crop.t || fx.crop.r || fx.crop.b)) || fx.fit === 'fill';
    const [box, inner] = details('Effects', active);
    const live = () => sync(t, playing);
    const S = (label, key, min, max, step = 1, fmt = v => v ? v : 'Off', obj = fx) => {
      const s = slider({ label, min, max, step, value: obj[key] || 0, fmt });
      s.input.addEventListener('input', () => { obj[key] = s.get(); live(); });
      s.input.addEventListener('change', () => commit('Edit ' + label.toLowerCase()));
      return s;
    };
    const C = (label, key, hint) => { const ch = checkField(label, !!fx[key]); if (hint) ch.title = hint; ch.input.addEventListener('change', () => { fx[key] = ch.get(); commit(label); }); return ch; };
    if (!isOverlay) {
      const fit = selectField('Framing', [['', 'Project default'], ['fit', 'Fit (letterbox)'], ['fill', 'Fill (crop to frame)']], fx.fit || '');
      fit.select.addEventListener('change', () => { fx.fit = fit.get() || undefined; commit('Framing'); });
      inner.append(fit);
    }
    inner.append(S('Blur', 'blur', 0, 100), S('Sharpen', 'sharpen', 0, 100), S('Denoise', 'denoise', 0, 100), S('Film grain', 'grain', 0, 100), S('Glow', 'glow', 0, 100),
      S('RGB split', 'rgbsplit', 0, 30, 1, v => v ? v + 'px' : 'Off'), S('Echo / trails', 'echo', 0, 100));
    if (!isOverlay) inner.append(S('Choppy frame rate', 'posterizeTime', 0, 24, 1, v => v ? v + ' fps' : 'Off'));
    const tg = h('<div class="check-grid"></div>');
    tg.append(C('Stabilize', 'stabilize', 'Smooths handheld shake (FFmpeg deshake)'), C('Find edges', 'edges'));
    if (!isOverlay) tg.append(C('Reverse', 'reverse', 'Plays the clip backwards (audio too)'));
    inner.append(tg);
    // crop
    fx.crop = fx.crop || { l: 0, t: 0, r: 0, b: 0 };
    const cr = h('<div class="crop-grid"></div>');
    for (const [k, l] of [['l', 'Crop left'], ['r', 'Crop right'], ['t', 'Crop top'], ['b', 'Crop bottom']]) cr.append(S(l, k, 0, 45, 1, v => v ? v + '%' : 'Off', fx.crop));
    inner.append(cr);
    // Ken Burns
    if (!isOverlay) {
      fx.kb = fx.kb || { on: false, z0: 1, z1: 1.3, x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.5 };
      const kb = fx.kb, kbOn = checkField('Ken Burns pan & zoom', kb.on);
      const kbBox = h('<div class="stack"></div>'); kbBox.hidden = !kb.on;
      kbOn.input.addEventListener('change', () => { kb.on = kbOn.get(); kbBox.hidden = !kb.on; commit('Ken Burns'); });
      const pct = v => Math.round(v * 100) + '%';
      const K = (label, key, min, max, step, fmt) => { const s = slider({ label, min, max, step, value: kb[key], fmt }); s.input.addEventListener('input', () => { kb[key] = s.get(); live(); }); s.input.addEventListener('change', () => commit('Ken Burns')); return s; };
      const r1 = h('<div class="row"></div>'); r1.append(K('Start zoom', 'z0', 1, 3, 0.05, v => v.toFixed(2) + '×'), K('End zoom', 'z1', 1, 3, 0.05, v => v.toFixed(2) + '×'));
      const r2 = h('<div class="row"></div>'); r2.append(K('Start X', 'x0', 0, 1, 0.01, pct), K('End X', 'x1', 0, 1, 0.01, pct));
      const r3 = h('<div class="row"></div>'); r3.append(K('Start Y', 'y0', 0, 1, 0.01, pct), K('End Y', 'y1', 0, 1, 0.01, pct));
      kbBox.append(r1, r2, r3); inner.append(kbOn, kbBox);
    }
    inner.append(h('<p class="hint">Blur, crop, framing, Ken Burns and reverse preview live; grain, glow, RGB split, echo and stabilize show in Render preview and Export.</p>'));
    return box;
  }
  /** Audio effects (FilmCraft essential sound → FFmpeg), with an EQ/filter/compressor preview through WebAudio. */
  function audioSection(item) {
    item.afx = item.afx || {};
    const a = item.afx;
    const [box, inner] = details('Audio effects', Object.values(a).some(Boolean));
    const live = () => sync(t, playing);
    const S = (label, key, min, max, step = 1, fmt = v => v ? v : 'Off') => { const s = slider({ label, min, max, step, value: a[key] || 0, fmt }); s.input.addEventListener('input', () => { a[key] = s.get(); live(); }); s.input.addEventListener('change', () => commit('Edit ' + label.toLowerCase())); return s; };
    const preset = selectField('Preset', [['', 'Choose…'], ['voice', 'Enhance speech'], ['podcast', 'Podcast voice'], ['phone', 'Telephone'], ['radio', 'AM radio'], ['music', 'Music: warm & loud'], ['clean', 'Reset all']], '');
    preset.select.addEventListener('change', () => {
      const P = { voice: { voice: true }, podcast: { voice: true, compress: 50, low: 2, deess: 30, limiter: true }, phone: { highpass: 400, lowpass: 3400, mid: 6, compress: 40 }, radio: { highpass: 300, lowpass: 4500, mid: 8, grain: 0, compress: 60 }, music: { low: 3, high: 2, compress: 30, limiter: true }, clean: {} }[preset.get()];
      if (!P) return; item.afx = { ...P }; commit('Audio preset'); renderInspector();
    });
    const eq = h('<div class="row"></div>'); eq.append(S('Bass', 'low', -12, 12, 1, v => sgn(v) + ' dB'), S('Mids', 'mid', -12, 12, 1, v => sgn(v) + ' dB'), S('Treble', 'high', -12, 12, 1, v => sgn(v) + ' dB'));
    const filt = h('<div class="row"></div>'); filt.append(S('High-pass', 'highpass', 0, 400, 5, v => v ? v + ' Hz' : 'Off'), S('Low-pass', 'lowpass', 0, 16000, 100, v => v ? (v / 1000).toFixed(1) + ' kHz' : 'Off'));
    const hum = selectField('Remove hum', [['0', 'Off'], ['50', '50 Hz (Europe, Asia)'], ['60', '60 Hz (Americas)']], String(a.dehum || 0));
    hum.select.addEventListener('change', () => { a.dehum = Number(hum.get()); commit('Remove hum'); });
    const ck = (label, key) => { const c = checkField(label, !!a[key]); c.input.addEventListener('change', () => { a[key] = c.get(); live(); commit(label); }); return c; };
    const cg = h('<div class="check-grid"></div>'); cg.append(ck('Enhance speech', 'voice'), ck('Limiter (no clipping)', 'limiter'));
    inner.append(preset, cg, eq, filt, S('Noise reduction', 'denoise', 0, 100), hum, S('De-ess', 'deess', 0, 100), S('Compressor', 'compress', 0, 100), S('Reverb', 'reverb', 0, 100),
      S('Pitch', 'pitch', -12, 12, 1, v => v ? sgn(v) + ' st' : 'Off'), S('Gain', 'gain', -20, 20, 1, v => sgn(v) + ' dB'),
      h('<p class="hint">EQ, filters, compressor and gain preview live. Noise reduction, hum removal, de-ess, reverb and pitch are applied in Render preview and Export.</p>'));
    return box;
  }
  /** Keyframes for an overlay: position, size, opacity and rotation over time. */
  function animateSection(o) {
    const [box, inner] = details('Animate (keyframes)', !!(o.kf && Object.values(o.kf).some(l => l && l.length)));
    o.kf = o.kf || {};
    const u = clamp(t - o.start, 0, olen(o));
    const inRange = t >= o.start && t <= o.start + olen(o);
    const st = ovState(o, t);
    const ease = selectField('Easing for new keys', [['ease', 'Ease in & out'], ['linear', 'Linear'], ['in', 'Ease in'], ['out', 'Ease out'], ['hold', 'Hold (jump)']], animateSection.ease || 'ease');
    ease.select.addEventListener('change', () => { animateSection.ease = ease.get(); });
    inner.append(h(`<p class="hint">${inRange ? `Playhead is ${u.toFixed(2)}s into this overlay.` : 'Move the playhead over this overlay to add keyframes.'} Once a property has keyframes, dragging the overlay or changing its slider keys it at the playhead.</p>`), ease);
    for (const [p, label] of KF_PROPS) {
      const list = o.kf[p] || [];
      const row = h(`<div class="kf-row"><span class="kf-name">${label}</span><span class="kf-dots"></span><button class="icon-btn kf-add" title="Add keyframe at playhead" ${inRange ? '' : 'disabled'}>${icon('marker')}</button></div>`);
      const dots = $('.kf-dots', row), len = Math.max(0.01, olen(o));
      list.forEach((k, i) => {
        const d = h(`<button class="kf-dot ${Math.abs(k.t - u) < 0.04 ? 'here' : ''} ${k.ease === 'hold' ? 'hold' : ''}" style="left:${k.t / len * 100}%" title="${k.t.toFixed(2)}s · ${p === 'opacity' ? Math.round(k.v * 100) + '%' : p === 'rotation' ? Math.round(k.v) + '°' : p === 'scale' ? Math.round(k.v * 100) + '%' : Math.round(k.v * 100) + '%'} · ${k.ease || 'ease'} — click to jump, double-click to delete"></button>`);
        d.addEventListener('click', () => seek(o.start + k.t));
        d.addEventListener('dblclick', () => { list.splice(i, 1); if (!list.length) delete o.kf[p]; commit('Delete keyframe'); });
        dots.appendChild(d);
      });
      $('.kf-add', row).addEventListener('click', () => { setKey(o, p, st[p], animateSection.ease || 'ease'); commit('Add keyframe'); });
      inner.append(row);
    }
    const clr = h('<button class="btn btn-sm btn-ghost">Clear all keyframes</button>'); clr.addEventListener('click', () => { o.kf = {}; commit('Clear keyframes'); });
    const nav = h('<div class="row"></div>');
    const prevB = h(`<button class="btn btn-sm">${icon('prev')}Previous key</button>`), nextB = h(`<button class="btn btn-sm">Next key${icon('next')}</button>`);
    const allT = () => [...new Set(Object.values(o.kf).flat().map(k => +(o.start + k.t).toFixed(3)))].sort((a, b) => a - b);
    prevB.addEventListener('click', () => { const ts = allT().filter(x => x < t - 0.01); if (ts.length) seek(ts[ts.length - 1]); });
    nextB.addEventListener('click', () => { const ts = allT().filter(x => x > t + 0.01); if (ts.length) seek(ts[0]); });
    nav.append(prevB, nextB);
    inner.append(nav, clr);
    return box;
  }
  /** Green / blue screen keying for overlays. */
  function keySection(o) {
    o.key = o.key || { on: false, color: '#00ff00', similarity: 30, smooth: 10, spill: 40 };
    const k = o.key;
    const [box, inner] = details('Green screen (keying)', k.on);
    const live = () => syncOverlays(t, playing);
    const on = checkField('Remove background color', k.on); on.input.addEventListener('change', () => { k.on = on.get(); commit('Keying'); });
    const col = h(`<label class="field" style="flex:none"><span>Key color</span><input type="color" value="${k.color}"></label>`);
    $('input', col).addEventListener('input', e => { k.color = e.target.value; live(); }); $('input', col).addEventListener('change', () => commit('Key color'));
    const pick = h('<div class="seg"><button data-c="#00ff00">Green</button><button data-c="#0047bb">Blue</button></div>');
    $$('button', pick).forEach(b => b.addEventListener('click', () => { k.color = b.dataset.c; k.on = true; commit('Key color'); }));
    const row = h('<div class="row" style="align-items:flex-end"></div>'); row.append(col, pick);
    const S = (label, key, min, max) => { const s = slider({ label, min, max, value: k[key], unit: '%' }); s.input.addEventListener('input', () => { k[key] = s.get(); live(); }); s.input.addEventListener('change', () => commit('Keying')); return s; };
    inner.append(on, row, S('Tolerance', 'similarity', 1, 80), S('Edge softness', 'smooth', 0, 60), S('Spill suppression', 'spill', 0, 100), h('<p class="hint">Previewed live. Light the screen evenly for the cleanest edge.</p>'));
    return box;
  }

  /** Colour / rotation / fade controls shared by clips and overlays. */
  function colorControls(c) {
    c.fx = Object.assign(FX0(), c.fx || {});
    const fx = c.fx;
    const box = h('<details class="fx-details"><summary>Color, rotate & fades</summary><div class="stack"></div></details>');
    const inner = $('.stack', box);
    const live = () => sync(t, playing);
    const S = (label, key, min, max, step = 1, fmt = v => (v > 0 ? '+' : '') + v) => {
      const s = slider({ label, min, max, step, value: fx[key], fmt });
      s.input.addEventListener('input', () => { fx[key] = s.get(); live(); });
      s.input.addEventListener('change', () => commit('Edit ' + label.toLowerCase()));
      return s;
    };
    inner.append(S('Brightness', 'brightness', -100, 100), S('Contrast', 'contrast', -100, 100), S('Saturation', 'saturation', -100, 100), S('Hue', 'hue', -180, 180, 1, v => v + '°'), S('Warmth', 'temperature', -100, 100));
    const rot = h(`<div class="row"><button class="btn btn-sm">${icon('rotate')}Rotate 90°</button><button class="btn btn-sm">${icon('flipH')}Flip H</button><button class="btn btn-sm">${icon('flipV')}Flip V</button></div>`);
    const [r1, r2, r3] = $$('button', rot);
    r1.addEventListener('click', () => { fx.rotate = ((fx.rotate || 0) + 90) % 360; commit('Rotate'); });
    r2.addEventListener('click', () => { fx.flipH = !fx.flipH; commit('Flip'); });
    r3.addEventListener('click', () => { fx.flipV = !fx.flipV; commit('Flip'); });
    inner.append(rot);
    if (c.mediaId && clips.includes(c)) {
      const fr = h('<div class="row"></div>'); fr.append(S('Fade in', 'fadeIn', 0, 3, 0.1, v => v ? v.toFixed(1) + 's' : 'Off'), S('Fade out', 'fadeOut', 0, 3, 0.1, v => v ? v.toFixed(1) + 's' : 'Off'));
      inner.append(fr);
    }
    const reset = h(`<button class="btn btn-sm btn-ghost">Reset</button>`); reset.addEventListener('click', () => { c.fx = FX0(); commit('Reset effects'); }); inner.append(reset);
    if (Object.entries(fx).some(([k, v]) => v && FX0()[k] !== v)) box.open = true;
    return box;
  }

  // ---------- UI ----------
  function init(root) {
    root.innerHTML = '';
    const ws = h(`<div class="ws-video">
      <aside class="vd-bin panel"><div class="panel-head"><h3>Media</h3><button class="btn btn-sm" data-act="import">${icon('plus')}Import</button></div><div class="bin-grid"></div></aside>
      <section class="vd-viewer">
        <div class="viewer-screen"><div class="viewer-frame"><svg class="thirds-ov" viewBox="0 0 300 300" preserveAspectRatio="none" hidden><path d="M100 0v300M200 0v300M0 100h300M0 200h300" stroke="rgba(255,255,255,.5)" stroke-width="1" vector-effect="non-scaling-stroke"/></svg><div class="cap-view" hidden></div><span class="vlabel" hidden></span></div>
          <div class="scopes" hidden><div class="scopes-bar"><div class="seg"><button data-s="wave" class="on">Waveform</button><button data-s="parade">Parade</button><button data-s="vector">Vectorscope</button><button data-s="hist">Histogram</button></div></div><canvas width="512" height="256"></canvas></div></div>
        <div class="viewer-controls">
          <button class="icon-btn" data-act="prev" title="Previous cut (Home)" aria-label="Previous cut">${icon('prev')}</button>
          <button class="icon-btn play" data-act="play" title="Play / pause (Space)" aria-label="Play">${icon('play')}</button>
          <button class="icon-btn" data-act="next" title="Next cut (End)" aria-label="Next cut">${icon('next')}</button>
          <span class="time"></span><span class="grow"></span>
          <canvas class="meter" width="150" height="14" hidden title="Audio levels"></canvas>
          <button class="icon-btn" data-act="meter" title="Audio level meters" aria-label="Audio level meters">${icon('music')}</button>
          <button class="icon-btn" data-act="scopes" title="Video scopes (waveform, vectorscope, histogram)" aria-label="Video scopes">${icon('levels')}</button>
          <button class="icon-btn" data-act="thirds" title="Rule of thirds guide" aria-label="Rule of thirds guide">${icon('grid')}</button>
        </div>
      </section>
      <aside class="vd-inspector panel"><div class="panel-head"><h3 class="ins-head">Project</h3></div><div class="panel-body ins-body"></div></aside>
      <section class="vd-timeline">
        <div class="tl-bar"></div>
        <div class="tl-body">
          <div class="tl-heads"><div class="tl-head captions">${icon('title')}Captions</div><div class="tl-head overlay">${icon('overlay')}Overlay</div><div class="tl-head">${icon('film')}Video</div><div class="tl-head audio">${icon('music')}Music</div></div>
          <div class="tl-scroll"><div class="tl-inner"><div class="tl-ruler"></div><div class="tl-track captions"></div><div class="tl-track overlay"></div><div class="tl-track video"></div><div class="tl-track audio"></div><div class="playhead"></div></div></div>
        </div>
      </section></div>`);
    root.appendChild(ws);
    el = {
      ws, bin: $('.bin-grid', ws), frame: $('.viewer-frame', ws), vlabel: $('.vlabel', ws), time: $('.time', ws), play: $('[data-act="play"]', ws),
      insHead: $('.ins-head', ws), ins: $('.ins-body', ws), bar: $('.tl-bar', ws), scroll: $('.tl-scroll', ws), inner: $('.tl-inner', ws),
      ruler: $('.tl-ruler', ws), vtrack: $('.tl-track.video', ws), atrack: $('.tl-track.audio', ws), otrack: $('.tl-track.overlay', ws), playhead: $('.playhead', ws), thirds: $('.thirds-ov', ws),
      ctrack: $('.tl-track.captions', ws), capView: $('.cap-view', ws), scopes: $('.scopes', ws), scopeCv: $('.scopes canvas', ws), meter: $('canvas.meter', ws),
    };
    ro3.transitions().then(list => { supported = new Set(list); }).catch(() => {});
    $('[data-act="meter"]', ws).addEventListener('click', e => { const on = el.meter.hidden; el.meter.hidden = !on; e.currentTarget.classList.toggle('on', on); if (on) startMeters(el.meter); else meterOn = false; });
    $('[data-act="scopes"]', ws).addEventListener('click', e => { el.scopes.hidden = !el.scopes.hidden; e.currentTarget.classList.toggle('on', !el.scopes.hidden); if (!el.scopes.hidden) scopeLoop(); });
    $$('.scopes-bar button', ws).forEach(b => b.addEventListener('click', () => { scopeMode = b.dataset.s; $$('.scopes-bar button', ws).forEach(x => x.classList.toggle('on', x === b)); drawScopes(); }));
    el.ctrack.addEventListener('pointerdown', e => { if (e.target === el.ctrack) { sel = null; seek(xToTime(e.clientX)); refresh(); } });
    el.ctrack.addEventListener('dblclick', e => { if (e.target === el.ctrack) addCaption(Math.max(0, xToTime(e.clientX))); });
    makeSlots();
    $('[data-act="import"]', ws).addEventListener('click', importDialog);
    $('[data-act="play"]', ws).addEventListener('click', toggle);
    $('[data-act="prev"]', ws).addEventListener('click', () => jumpClip(-1));
    $('[data-act="next"]', ws).addEventListener('click', () => jumpClip(1));
    $('[data-act="thirds"]', ws).addEventListener('click', e => { showThirds = !showThirds; el.thirds.hidden = !showThirds; e.currentTarget.classList.toggle('on', showThirds); });
    buildBar();

    // ruler scrubbing
    onDrag(el.ruler, {
      start: e => { if (playing) pause(); seek(xToTime(e.clientX)); },
      move: e => seek(xToTime(e.clientX)),
    });
    // clicking empty track area deselects / moves playhead
    [el.vtrack, el.atrack, el.otrack].forEach(tr => tr.addEventListener('pointerdown', e => { if (e.target === tr) { sel = null; seek(xToTime(e.clientX)); refresh(); } }));
    // drops from bin or OS
    const dropOn = (track, isAudio) => {
      track.addEventListener('dragover', e => { e.preventDefault(); if (!isAudio) showInsert(insertIndexAt(e.clientX)); });
      track.addEventListener('dragleave', () => hideInsert());
      track.addEventListener('drop', async e => {
        e.preventDefault(); hideInsert();
        const id = e.dataTransfer.getData('text/ro3-media');
        let list = id ? [byId(media, id)].filter(Boolean) : await importPaths(Array.from(e.dataTransfer.files).map(f => ro3.pathOf(f)).filter(Boolean));
        let idx = insertIndexAt(e.clientX), at = Math.max(0, xToTime(e.clientX));
        for (const m of list) {
          if (isAudio || m.kind === 'audio') { if (m.info && (m.info.hasAudio || m.kind === 'audio')) { addToTimelineAudio(m, at); at += m.info.duration; } }
          else { addToTimeline(m, idx++); }
        }
      });
    };
    dropOn(el.vtrack, false); dropOn(el.atrack, true);
    el.otrack.addEventListener('dragover', e => e.preventDefault());
    el.otrack.addEventListener('drop', async e => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/ro3-media');
      const list = id ? [byId(media, id)].filter(Boolean) : await importPaths(Array.from(e.dataTransfer.files).map(f => ro3.pathOf(f)).filter(Boolean));
      let at = snapTime(Math.max(0, xToTime(e.clientX)));
      for (const m of list) { addOverlay(m, at); at += m.kind === 'video' ? m.info.duration : 5; }
    });
    // clicking the empty frame deselects overlays
    el.frame.addEventListener('pointerdown', e => { if (!e.target.classList.contains('ov-el') && sel && sel.type === 'overlay') { sel = null; refresh(); } });
    $('.vd-bin', ws).addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
    $('.vd-bin', ws).addEventListener('drop', async e => { e.preventDefault(); await importPaths(Array.from(e.dataTransfer.files).map(f => ro3.pathOf(f)).filter(Boolean)); });
    $('.viewer-screen', ws).addEventListener('dragover', e => e.preventDefault());
    $('.viewer-screen', ws).addEventListener('drop', async e => { e.preventDefault(); const ms = await importPaths(Array.from(e.dataTransfer.files).map(f => ro3.pathOf(f)).filter(Boolean)); ms.forEach(m => addToTimeline(m)); });
    new ResizeObserver(fitFrame).observe($('.viewer-screen', ws));
    document.addEventListener('keydown', onKey);
    commit('Start');
    hist.stack[0].label = 'Start';
    renderBin(); refresh();
  }
  function addToTimelineAudio(m, at) {
    const a = { id: uid('a'), mediaId: m.id, start: at, in: 0, out: m.info.duration, volume: 0.8, fadeIn: 0, fadeOut: 1 };
    audio.push(a); sel = { type: 'audio', id: a.id }; commit('Add music');
  }

  function fitFrame() {
    const box = $('.viewer-screen', el.ws).getBoundingClientRect();
    const ar = settings.width / settings.height;
    let w = box.width - 28, hh = box.height - 28;
    if (w / hh > ar) w = hh * ar; else hh = w / ar;
    el.frame.style.width = Math.max(10, w) + 'px'; el.frame.style.height = Math.max(10, hh) + 'px'; el.frame.style.aspectRatio = 'auto';
  }

  function buildBar() {
    const b = el.bar; b.innerHTML = '';
    const btn = (ic, label, fn, title) => { const x = h(`<button class="btn btn-sm btn-ghost" title="${title || label}">${icon(ic)}${label}</button>`); x.addEventListener('click', fn); return x; };
    el.zoomIn = h(`<input type="range" min="8" max="300" value="${zoom}" aria-label="Timeline zoom">`);
    const snapB = h(`<button class="icon-btn ${snapOn ? 'on' : ''}" title="Snapping (N)" aria-label="Snapping">${icon('magnet')}</button>`);
    snapB.addEventListener('click', () => { snapOn = !snapOn; snapB.classList.toggle('on', snapOn); });
    el.snapB = snapB;
    el.zoomIn.addEventListener('input', () => { const mid = xToTime(el.scroll.getBoundingClientRect().left + el.scroll.clientWidth / 2); zoom = Number(el.zoomIn.value); paintZoom(); renderTimeline(); el.scroll.scrollLeft = mid * zoom - el.scroll.clientWidth / 2; });
    const z = h(`<label class="zoom">${icon('zoom')}</label>`); z.appendChild(el.zoomIn);
    b.append(
      btn('split', 'Split', split, 'Split at playhead (S)'),
      btn('copy', 'Duplicate', duplicateClip, 'Duplicate clip (Ctrl+D)'),
      btn('trash', 'Delete', removeSelected, 'Delete selected (Del)'),
      btn('title', 'Title', e => titleMenu(e.currentTarget), 'Add a title or lower third at the playhead'),
      btn('marker', 'Marker', toggleMarker, 'Add / remove a marker at the playhead (M)'),
      btn('text', 'Caption', () => addCaption(), 'Add a caption at the playhead (C)'),
      btn('music', 'Add music', async () => { const ms = await importDialog(); ms.filter(m => m.info && (m.kind === 'audio' || m.info.hasAudio)).forEach(m => addToTimelineAudio(m, Math.max(0, ...audio.map(a => a.start + audioLen(a))))); }),
      h('<span class="grow"></span>'),
      snapB, z,
      btn('eye', 'Render preview', renderPreview, 'Render a quick low-res preview with exact transitions'),
    );
    paintZoom();
  }
  function paintZoom() { el.zoomIn.style.setProperty('--p', ((zoom - 8) / 292 * 100) + '%'); }

  function binEl(m) { return el.bin.querySelector(`[data-id="${m.id}"]`); }
  function renderBin() {
    if (!el.bin) return;
    el.bin.innerHTML = '';
    if (!media.length) {
      el.bin.appendChild(h(`<div class="empty" style="grid-column:1/3;padding:40px 10px">${icon('film', 'ico-xl')}<h3>Import media</h3><p>Video, audio and images. Drop files here or use Import.</p></div>`));
      return;
    }
    media.forEach(m => {
      const meta = m.info ? (m.kind === 'image' ? `Image · ${m.info.width}×${m.info.height}` : `${fmtTime(m.info.duration, false)}${m.kind === 'audio' ? ' · audio' : ''}`) : 'Reading…';
      const it = h(`<div class="bin-item ${sel && sel.type === 'media' && sel.id === m.id ? 'sel' : ''}" draggable="true" data-id="${m.id}" title="${esc(m.path)} — drag onto Overlay for picture-in-picture">
        <div class="bthumb" ${m.thumb ? `style="background-image:url('${m.thumb}')"` : ''}>${m.thumb ? '' : icon(m.kind === 'audio' ? 'music' : m.kind === 'image' ? 'image' : 'film')}</div>
        <div class="bmeta"><strong>${esc(m.name)}</strong><span>${m.proxying ? 'Preparing preview…' : esc(meta)}</span></div>
        <button class="badd" title="Add to timeline" aria-label="Add to timeline">${icon('plus')}</button>
        ${m.busy ? `<div class="bbusy" style="transform:scaleX(${m.busy})"></div>` : ''}</div>`);
      it.addEventListener('click', () => { sel = { type: 'media', id: m.id }; refresh(); renderBin(); });
      it.addEventListener('dblclick', () => addToTimeline(m));
      $('.badd', it).addEventListener('click', e => { e.stopPropagation(); addToTimeline(m); });
      it.addEventListener('dragstart', e => { e.dataTransfer.setData('text/ro3-media', m.id); e.dataTransfer.effectAllowed = 'copy'; });
      el.bin.appendChild(it);
    });
  }

  const xToTime = x => (x - el.inner.getBoundingClientRect().left) / zoom;
  function insertIndexAt(clientX) {
    layout();
    const time = xToTime(clientX);
    for (let i = 0; i < clips.length; i++) if (time < clips[i]._start + dur(clips[i]) / 2) return i;
    return clips.length;
  }
  function showInsert(i) {
    hideInsert();
    layout();
    const x = i < clips.length ? clips[i]._start : total;
    const m = h(`<div class="insert-mark" style="left:${x * zoom}px"></div>`);
    el.vtrack.appendChild(m);
  }
  function hideInsert() { $$('.insert-mark', el.vtrack).forEach(x => x.remove()); }

  function renderTimeline() {
    layout();
    const end = timelineEnd();
    const width = Math.max(el.scroll.clientWidth, (Math.max(end, 20) + 10) * zoom);
    el.inner.style.width = width + 'px';
    // ruler
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    const major = steps.find(s => s * zoom >= 80) || 300;
    const minor = major / (major >= 10 ? 5 : major >= 2 ? 4 : 5);
    let r = '';
    for (let s = 0; s * zoom < width; s += minor) {
      const isMajor = Math.abs(s / major - Math.round(s / major)) < 1e-6;
      r += `<div class="tick ${isMajor ? 'major' : ''}" style="left:${s * zoom}px">${isMajor ? `<span>${fmtTime(s, false)}</span>` : ''}</div>`;
    }
    r += markers.map((m, i) => `<button class="tl-marker" data-i="${i}" style="left:${m * zoom}px" title="${esc(markerNames[mkKey(m)] || 'Marker')} at ${fmtTime(m)} — click to jump, double-click to name or delete">${markerNames[mkKey(m)] ? `<span>${esc(markerNames[mkKey(m)])}</span>` : ''}</button>`).join('');
    el.ruler.innerHTML = r;
    $$('.tl-marker', el.ruler).forEach(b => {
      b.addEventListener('pointerdown', e => e.stopPropagation());
      b.addEventListener('click', e => { e.stopPropagation(); seek(markers[+b.dataset.i]); });
      b.addEventListener('dblclick', e => { e.stopPropagation(); editMarker(+b.dataset.i); });
    });
    // captions track
    el.ctrack.innerHTML = captions.length ? '' : '<div class="drop-hint">Double-click to add a caption (C), or import an .srt / .vtt file</div>';
    captions.forEach(c => {
      const isSel = sel && sel.type === 'caption' && sel.id === c.id;
      const node = h(`<div class="clip cap-clip ${isSel ? 'sel' : ''}" data-id="${c.id}" style="left:${c.start * zoom}px;width:${Math.max(4, (c.end - c.start) * zoom)}px"><div class="clabel">${esc(String(c.text).split('\n')[0])}</div><div class="trim l"></div><div class="trim r"></div></div>`);
      bindCaption(node, c); el.ctrack.appendChild(node);
    });
    // overlay track
    el.otrack.innerHTML = overlays.length ? '' : '<div class="drop-hint">Drop media here for picture-in-picture, or add a Title</div>';
    // Overlapping overlays stack into lanes (later items draw on top in the frame).
    const laneEnds = [], laneOf = new Map();
    [...overlays].sort((a, b) => a.start - b.start).forEach(o => {
      let ln = laneEnds.findIndex(e => e <= o.start + 1e-3);
      if (ln < 0) { ln = laneEnds.length; laneEnds.push(0); }
      laneEnds[ln] = o.start + olen(o); laneOf.set(o.id, ln);
    });
    const LANE = 40, lanes = Math.max(1, laneEnds.length), th = lanes * LANE + 12;
    el.otrack.style.height = th + 'px'; el.ws.querySelector('.tl-head.overlay').style.height = th + 'px';
    overlays.forEach(o => {
      const m = o.mediaId ? byId(media, o.mediaId) : null;
      if (o.mediaId && !m) return;
      const isSel = sel && sel.type === 'overlay' && sel.id === o.id;
      const label = o.kind === 'title' ? (o.title.text.split('\n')[0] || 'Title') : m.name;
      const node = h(`<div class="clip ov-clip ${o.kind === 'title' ? 'title-clip' : ''} ${isSel ? 'sel' : ''}" data-id="${o.id}" style="left:${o.start * zoom}px;width:${Math.max(4, olen(o) * zoom)}px;top:${6 + laneOf.get(o.id) * LANE}px;height:${LANE - 4}px;bottom:auto">
        <div class="clabel">${o.kind === 'title' ? icon('title') : ''}${esc(label)}<em>${fmtTime(olen(o))}</em></div><div class="trim l"></div><div class="trim r"></div></div>`);
      if (m && m.kind === 'video' && m.strip) { node.style.backgroundImage = `url('${m.strip}')`; node.style.backgroundSize = `${m.info.duration * zoom}px 100%`; node.style.backgroundPosition = `${-o.in * zoom}px 0`; node.style.backgroundRepeat = 'no-repeat'; }
      else if (m && m.thumb) node.style.backgroundImage = `url('${m.thumb}')`;
      bindOverlay(node, o);
      el.otrack.appendChild(node);
    });
    // video track
    el.vtrack.innerHTML = clips.length ? '' : '<div class="drop-hint">Drag clips here from Media, or drop video and image files</div>';
    clips.forEach((c, i) => {
      const m = mOf(c); if (!m) return;
      const d = dur(c);
      const isSel = sel && sel.type === 'clip' && sel.id === c.id;
      const node = h(`<div class="clip ${m.kind === 'image' ? 'image-clip' : ''} ${isSel ? 'sel' : ''}" data-id="${c.id}" style="left:${c._start * zoom}px;width:${Math.max(4, d * zoom)}px;z-index:${i + 1}">
        <div class="clabel">${esc(m.name)}<em>${fmtTime(d)}</em>${spd(c) !== 1 ? `<b class="speed-badge">${spd(c)}×</b>` : ''}</div>
        <div class="trim l" title="Trim start"></div><div class="trim r" title="Trim end"></div>
        ${c.muted && m.kind === 'video' ? `<span class="muted-ico">${icon('mute')}</span>` : ''}</div>`);
      if (m.kind === 'video' && m.strip) {
        const full = m.info.duration * zoom / spd(c);
        node.style.backgroundImage = `url('${m.strip}')`;
        node.style.backgroundSize = `${full}px 100%`;
        node.style.backgroundPosition = `${-c.in * zoom / spd(c)}px 0`;
        node.style.backgroundRepeat = 'no-repeat';
      } else if (m.thumb) node.style.backgroundImage = `url('${m.thumb}')`;
      bindClip(node, c, i);
      el.vtrack.appendChild(node);
      if (i > 0) {
        const tr = clips[i - 1].transition;
        const has = tr && tr.type !== 'none';
        const x = has ? c._start + c._td / 2 : c._start;
        const chipSel = sel && sel.type === 'trans' && sel.id === clips[i - 1].id;
        const chip = h(`<button class="tr-chip ${has ? 'has' : ''} ${chipSel ? 'sel' : ''}" style="left:${x * zoom}px" title="${has ? TRANSITIONS.find(t => t[0] === tr.type)[1] : 'Add transition'}" aria-label="Transition">${icon('transition')}</button>`);
        chip.addEventListener('click', e => { e.stopPropagation(); sel = { type: 'trans', id: clips[i - 1].id }; if (!has) { clips[i - 1].transition = { type: 'fade', duration: 1 }; commit('Add transition'); } else refresh(); });
        el.vtrack.appendChild(chip);
      }
    });
    // audio track
    el.atrack.innerHTML = audio.length ? '' : '<div class="drop-hint">Drop music or voice-over here</div>';
    audio.forEach(a => {
      const m = byId(media, a.mediaId); if (!m) return;
      const isSel = sel && sel.type === 'audio' && sel.id === a.id;
      const node = h(`<div class="clip audio-clip ${isSel ? 'sel' : ''}" data-id="${a.id}" style="left:${a.start * zoom}px;width:${Math.max(4, audioLen(a) * zoom)}px">
        <div class="clabel">${esc(m.name)}<em>${fmtTime(audioLen(a))}</em></div><div class="trim l"></div><div class="trim r"></div></div>`);
      if (m.wave) { node.style.backgroundImage = `url('${m.wave}')`; node.style.backgroundSize = `${m.info.duration * zoom}px 100%`; node.style.backgroundPosition = `${-a.in * zoom}px 0`; }
      bindAudio(node, a);
      el.atrack.appendChild(node);
    });
    paintPlayhead();
  }

  function bindClip(node, c, i) {
    const m = mOf(c);
    const maxOut = m.kind === 'image' ? 3600 : m.info.duration;
    // trim
    $$('.trim', node).forEach(handle => {
      const left = handle.classList.contains('l');
      onDrag(handle, {
        start: e => {
          e.stopPropagation(); sel = { type: 'clip', id: c.id };
          const i0 = clips.indexOf(c), nb = left ? clips[i0 - 1] : clips[i0 + 1];
          handle._o = { in: c.in, out: c.out, x: e.clientX, speed: spd(c), dur: dur(c), nb, nbIn: nb && nb.in, nbOut: nb && nb.out, mode: e.altKey && nb ? 'roll' : e.shiftKey && m.kind !== 'image' && !left ? 'stretch' : 'trim' };
          handle._o.label = { roll: 'Roll edit', stretch: 'Rate stretch', trim: 'Trim clip' }[handle._o.mode];
        },
        move: e => {
          const o0 = handle._o, d = (e.clientX - o0.x) / zoom * spd(c);
          if (o0.mode === 'stretch') {
            // rate stretch: keep the source range, change speed so the clip fills the new length
            const nd = Math.max(0.1, o0.dur + (e.clientX - o0.x) / zoom);
            c.speed = +clamp((c.out - c.in) / nd, 0.1, 8).toFixed(3);
          } else if (o0.mode === 'roll') {
            // roll: move the cut point, the neighbour gives or takes the same amount
            const nb = o0.nb, nm = mOf(nb), nbMax = nm.kind === 'image' ? 3600 : nm.info.duration, dt = (e.clientX - o0.x) / zoom;
            if (left) { const k = clamp(dt, -Math.min(o0.in / spd(c), (o0.nbOut - o0.nbIn) / spd(nb) - 0.2), Math.min((o0.out - o0.in) / spd(c) - 0.2, (nbMax - o0.nbOut) / spd(nb))); c.in = o0.in + k * spd(c); nb.out = o0.nbOut + k * spd(nb); }
            else { const k = clamp(dt, -Math.min((o0.out - o0.in) / spd(c) - 0.2, o0.nbIn / spd(nb)), Math.min((maxOut - o0.out) / spd(c), (o0.nbOut - o0.nbIn) / spd(nb) - 0.2)); c.out = o0.out + k * spd(c); nb.in = o0.nbIn + k * spd(nb); }
          } else if (m.kind === 'image') { c.in = 0; c.out = clamp(o0.out + (left ? -d : d), 0.2, maxOut); }
          else if (left) c.in = clamp(o0.in + d, 0, c.out - 0.2);
          else c.out = clamp(o0.out + d, c.in + 0.2, maxOut);
          renderTimeline(); renderInspector();
          seek(left ? c._start : c._start + dur(c) - 0.001);
        },
        end: () => commit(handle._o.label),
      });
    });
    // select / reorder
    onDrag(node, {
      start: e => {
        if (e.target.classList.contains('trim')) return false;
        sel = { type: 'clip', id: c.id };
        node._d = { x: e.clientX, moved: false, left: c._start * zoom, slip: e.altKey && m.kind === 'video', in: c.in, out: c.out };
        $$('.clip.sel', el.vtrack).forEach(x => x.classList.remove('sel')); node.classList.add('sel');
        renderInspector();
      },
      move: e => {
        const dx = e.clientX - node._d.x;
        if (!node._d.moved && Math.abs(dx) < 5) return;
        if (node._d.slip) {
          // slip: keep position and length, slide which part of the source plays
          node._d.moved = true;
          const k = clamp(-dx / zoom * spd(c), -node._d.in, m.info.duration - node._d.out);
          c.in = node._d.in + k; c.out = node._d.out + k;
          node.style.backgroundPosition = `${-c.in * zoom / spd(c)}px 0`; seek(c._start + 0.001); el.time.innerHTML = `Slip ${k >= 0 ? '+' : ''}${k.toFixed(2)}s`;
          return;
        }
        node._d.moved = true; node.classList.add('dragging');
        node.style.left = (node._d.left + dx) + 'px';
        showInsert(insertIndexAt(e.clientX));
      },
      end: e => {
        hideInsert();
        if (!node._d.moved) { seek(xToTime(e.clientX)); refresh(); return; }
        if (node._d.slip) { commit('Slip edit'); return; }
        let idx = insertIndexAt(e.clientX);
        const from = clips.indexOf(c);
        clips.splice(from, 1);
        if (idx > from) idx--;
        clips.splice(idx, 0, c);
        commit(idx === from ? 'Move clip' : 'Reorder clips');
      },
    });
  }
  function bindAudio(node, a) {
    const m = byId(media, a.mediaId);
    $$('.trim', node).forEach(handle => {
      const left = handle.classList.contains('l');
      onDrag(handle, {
        start: e => { e.stopPropagation(); sel = { type: 'audio', id: a.id }; handle._o = { in: a.in, out: a.out, start: a.start, x: e.clientX }; },
        move: e => {
          const d = (e.clientX - handle._o.x) / zoom;
          if (left) { const nd = clamp(d, -handle._o.in, handle._o.out - handle._o.in - 0.2); a.in = handle._o.in + nd; a.start = Math.max(0, handle._o.start + nd); }
          else a.out = clamp(handle._o.out + d, a.in + 0.2, m.info.duration);
          renderTimeline(); renderInspector();
        },
        end: () => commit('Trim music'),
      });
    });
    onDrag(node, {
      start: e => { if (e.target.classList.contains('trim')) return false; sel = { type: 'audio', id: a.id }; node._d = { x: e.clientX, s: a.start, moved: false }; refreshSel(); },
      move: e => { const dx = e.clientX - node._d.x; if (!node._d.moved && Math.abs(dx) < 4) return; node._d.moved = true; a.start = snapTime(Math.max(0, node._d.s + dx / zoom), a); node.style.left = a.start * zoom + 'px'; },
      end: e => { if (node._d.moved) commit('Move music'); else { seek(xToTime(e.clientX)); refresh(); } },
    });
  }
  function refreshSel() { renderTimeline(); renderInspector(); }
  function bindCaption(node, c) {
    $$('.trim', node).forEach(handle => {
      const left = handle.classList.contains('l');
      onDrag(handle, {
        start: e => { e.stopPropagation(); sel = { type: 'caption', id: c.id }; handle._o = { s: c.start, e: c.end, x: e.clientX }; },
        move: e => { const d = (e.clientX - handle._o.x) / zoom; if (left) c.start = clamp(snapTime(handle._o.s + d), 0, c.end - 0.1); else c.end = Math.max(c.start + 0.1, snapTime(handle._o.e + d)); renderTimeline(); },
        end: () => commit('Caption timing'),
      });
    });
    onDrag(node, {
      start: e => { if (e.target.classList.contains('trim')) return false; sel = { type: 'caption', id: c.id }; node._d = { x: e.clientX, s: c.start, len: c.end - c.start, moved: false }; refreshSel(); },
      move: e => { const dx = e.clientX - node._d.x; if (!node._d.moved && Math.abs(dx) < 4) return; node._d.moved = true; c.start = snapTime(Math.max(0, node._d.s + dx / zoom)); c.end = c.start + node._d.len; node.style.left = c.start * zoom + 'px'; },
      end: e => { if (node._d.moved) { captions.sort((a, b) => a.start - b.start); commit('Move caption'); } else { seek(xToTime(e.clientX)); refresh(); } },
    });
  }

  function paintPlayhead() {
    el.playhead.style.left = (t * zoom) + 'px';
    const end = timelineEnd();
    el.time.innerHTML = `${fmtTime(t)} <em>/ ${fmtTime(end)}</em>`;
    if (playing) {
      const x = t * zoom - el.scroll.scrollLeft;
      if (x > el.scroll.clientWidth - 40 || x < 0) el.scroll.scrollLeft = t * zoom - 80;
    }
  }
  function paintPlayButton() { el.play.innerHTML = icon(playing ? 'pause' : 'play'); el.play.setAttribute('aria-label', playing ? 'Pause' : 'Play'); }

  // ---------- inspector ----------
  function renderInspector() {
    const b = el.ins; b.innerHTML = '';
    const item = sel && (sel.type === 'clip' || sel.type === 'trans' ? byId(clips, sel.id) : sel.type === 'audio' ? byId(audio, sel.id) : sel.type === 'overlay' ? byId(overlays, sel.id) : sel.type === 'caption' ? byId(captions, sel.id) : byId(media, sel.id));
    if (!sel || !item) return renderProjectSettings();
    if (sel.type === 'overlay') return overlayInspector(item);
    if (sel.type === 'caption') return captionInspector(item);
    if (sel.type === 'media') {
      const m = item;
      el.insHead.textContent = 'Media';
      b.appendChild(titleBlock(m, m.kind === 'image' ? 'Image' : m.kind === 'audio' ? 'Audio' : 'Video'));
      if (m.info) {
        const rows = [['Duration', m.kind === 'image' ? '—' : fmtTime(m.info.duration)], ['Size', m.info.width ? `${m.info.width} × ${m.info.height}` : '—'],
          ['Frame rate', m.info.fps ? m.info.fps.toFixed(2) + ' fps' : '—'], ['Codecs', [m.info.vcodec, m.info.acodec].filter(Boolean).join(' / ').toUpperCase() || '—']];
        b.appendChild(h(`<div class="ins-section">${rows.map(([k, v]) => `<div class="row" style="justify-content:space-between;align-items:center;margin-bottom:6px"><span class="muted" style="flex:none">${k}</span><span style="flex:none">${esc(v)}</span></div>`).join('')}</div>`));
      }
      const add = h(`<button class="btn btn-primary" style="justify-content:center">${icon('plus')}Add to ${m.kind === 'audio' ? 'music lane' : 'timeline'}</button>`);
      add.addEventListener('click', () => addToTimeline(m));
      const rm = h(`<button class="btn btn-ghost" style="justify-content:center">Remove from media</button>`);
      rm.addEventListener('click', removeSelected);
      b.append(add);
      if (m.kind !== 'audio') { const ov = h(`<button class="btn" style="justify-content:center">${icon('overlay')}Add as overlay</button>`); ov.addEventListener('click', () => addOverlay(m)); b.append(ov); }
      b.append(rm);
      return;
    }
    if (sel.type === 'trans') {
      const c = item;
      el.insHead.textContent = 'Transition';
      const grid = h(`<div class="tr-groups">${TRANSITION_GROUPS.map(([gname, list]) => `<h4>${gname}</h4><div class="tr-grid">${list.filter(([v]) => !supported || supported.has(v)).map(([v, l]) => `<button data-v="${v}" class="${c.transition.type === v ? 'on' : ''}">${l}</button>`).join('')}</div>`).join('')}<div class="tr-grid"><button data-v="none" class="${c.transition.type === 'none' ? 'on' : ''}">No transition</button></div></div>`);
      $$('button', grid).forEach(x => x.addEventListener('click', () => { c.transition.type = x.dataset.v; commit('Change transition'); if (x.dataset.v !== 'none') { layout(); const n = clips[clips.indexOf(c) + 1]; if (n) seek(Math.max(0, n._start - 0.5)); } }));
      const d = slider({ label: 'Duration', min: 0.2, max: 3, step: 0.1, value: c.transition.duration || 1, fmt: v => v.toFixed(1) + 's' });
      d.input.addEventListener('input', () => { c.transition.duration = d.get(); renderTimeline(); });
      d.input.addEventListener('change', () => commit('Transition length'));
      const curve = selectField('Audio crossfade', [['qsin', 'Constant power (smooth)'], ['tri', 'Constant gain (linear)'], ['exp', 'Exponential']], settings.audioCrossfade || 'qsin');
      curve.select.addEventListener('change', () => { settings.audioCrossfade = curve.get(); commit('Audio crossfade'); });
      b.append(d, curve, grid, h(`<p class="hint">Playback shows transitions as a crossfade. Render preview or Export to see the exact style.</p>`));
      return;
    }
    if (sel.type === 'clip') {
      const c = item, m = mOf(c);
      el.insHead.textContent = 'Clip';
      b.appendChild(titleBlock(m, `${fmtTime(dur(c))} on timeline`));
      if (m.kind === 'image') {
        const d = numberField('Duration', +dur(c).toFixed(2), { min: 0.2, step: 0.1, suffix: 's' });
        d.input.addEventListener('change', () => { c.in = 0; c.out = Math.max(0.2, d.get()); commit('Image duration'); });
        b.appendChild(d);
      } else {
        const inF = numberField('Start in source', +c.in.toFixed(2), { min: 0, step: 0.05, suffix: 's' });
        const outF = numberField('End in source', +c.out.toFixed(2), { min: 0, step: 0.05, suffix: 's' });
        inF.input.addEventListener('change', () => { c.in = clamp(inF.get(), 0, c.out - 0.2); commit('Trim clip'); });
        outF.input.addEventListener('change', () => { c.out = clamp(outF.get(), c.in + 0.2, m.info.duration); commit('Trim clip'); });
        const row = h('<div class="row"></div>'); row.append(inF, outF); b.appendChild(row);
        const speeds = [[0.25, '0.25× (slow motion)'], [0.5, '0.5×'], [0.75, '0.75×'], [1, '1× normal'], [1.25, '1.25×'], [1.5, '1.5×'], [2, '2×'], [3, '3×'], [4, '4× (time-lapse)'], [8, '8×']];
        const sp = selectField('Speed', speeds, spd(c));
        sp.select.addEventListener('change', () => { c.speed = Number(sp.get()); commit('Change speed'); });
        b.appendChild(sp);
        if (m.info.hasAudio) {
          const v = slider({ label: 'Volume', min: 0, max: 200, value: Math.round((c.volume ?? 1) * 100), unit: '%' });
          v.input.addEventListener('input', () => { c.volume = v.get() / 100; sync(t, playing); });
          v.input.addEventListener('change', () => commit('Clip volume'));
          const mute = checkField('Mute this clip', c.muted);
          mute.input.addEventListener('change', () => { c.muted = mute.get(); commit(c.muted ? 'Mute clip' : 'Unmute clip'); });
          b.append(v, mute);
        }
      }
      b.appendChild(colorControls(c));
      b.append(gradeSection(c), effectsSection(c, false));
      if (m.kind !== 'image' && m.info.hasAudio) b.append(audioSection(c));
      const i = clips.indexOf(c);
      if (i < clips.length - 1) {
        const ts = selectField('Transition to next clip', TRANSITIONS.filter(([v]) => v === 'none' || !supported || supported.has(v)), c.transition.type);
        ts.select.addEventListener('change', () => { c.transition.type = ts.get(); commit('Change transition'); });
        b.appendChild(ts);
      }
      const acts = h(`<div class="ins-actions"></div>`);
      const mk = (ic, l, fn, k = '') => { const x = h(`<button class="btn btn-sm ${k}">${icon(ic)}${l}</button>`); x.addEventListener('click', fn); return x; };
      acts.append(mk('split', 'Split', split), mk('copy', 'Duplicate', duplicateClip), mk('trash', 'Delete', removeSelected, 'btn-danger'));
      const acts2 = h(`<div class="ins-actions"></div>`);
      if (m.kind === 'video') acts2.append(mk('image', 'Freeze frame', freezeFrame));
      acts2.append(mk('copy', 'Copy', copyClip), mk('sliders', 'Paste effects', pasteAttributes));
      b.append(acts, acts2, h('<p class="hint">Alt-drag a clip to slip it · Alt-drag an edge to roll the cut · Shift-drag the right edge to stretch its speed.</p>'));
      return;
    }
    if (sel.type === 'audio') {
      const a = item, m = byId(media, a.mediaId);
      el.insHead.textContent = 'Music';
      b.appendChild(titleBlock(m, `${fmtTime(audioLen(a))} on timeline`));
      const st = numberField('Starts at', +a.start.toFixed(2), { min: 0, step: 0.1, suffix: 's' });
      st.input.addEventListener('change', () => { a.start = Math.max(0, st.get()); commit('Move music'); });
      const inF = numberField('Start in source', +a.in.toFixed(2), { min: 0, step: 0.1, suffix: 's' });
      inF.input.addEventListener('change', () => { a.in = clamp(inF.get(), 0, a.out - 0.2); commit('Trim music'); });
      const row = h('<div class="row"></div>'); row.append(st, inF);
      const v = slider({ label: 'Volume', min: 0, max: 200, value: Math.round((a.volume ?? 1) * 100), unit: '%' });
      v.input.addEventListener('input', () => { a.volume = v.get() / 100; });
      v.input.addEventListener('change', () => commit('Music volume'));
      const fi = slider({ label: 'Fade in', min: 0, max: 5, step: 0.1, value: a.fadeIn || 0, fmt: x => x.toFixed(1) + 's' });
      fi.input.addEventListener('change', () => { a.fadeIn = fi.get(); commit('Music fade'); });
      const fo = slider({ label: 'Fade out', min: 0, max: 5, step: 0.1, value: a.fadeOut || 0, fmt: x => x.toFixed(1) + 's' });
      fo.input.addEventListener('change', () => { a.fadeOut = fo.get(); commit('Music fade'); });
      const fit = h(`<button class="btn btn-sm">Trim to video length</button>`);
      fit.addEventListener('click', () => { layout(); if (total > a.start) { a.out = Math.min(m.info.duration, a.in + total - a.start); commit('Trim music'); } });
      const del = h(`<button class="btn btn-sm btn-danger">${icon('trash')}Delete</button>`); del.addEventListener('click', removeSelected);
      const acts = h('<div class="ins-actions"></div>'); acts.append(fit, del);
      b.append(row, v, fi, fo, audioSection(a), acts);
    }
  }
  function titleBlock(m, sub) {
    return h(`<div class="ins-title"><div class="cv-thumb" ${m.thumb ? `style="background-image:url('${m.thumb}')"` : ''}>${m.thumb ? '' : icon(m.kind === 'audio' ? 'music' : 'film')}</div><div><strong title="${esc(m.name)}">${esc(m.name)}</strong><span>${esc(sub)}</span></div></div>`);
  }
  function renderProjectSettings() {
    const b = el.ins;
    el.insHead.textContent = 'Project';
    const res = selectField('Resolution', RES, settings.res);
    res.select.addEventListener('change', () => {
      settings.res = res.get();
      if (settings.res === 'auto') applyAutoRes(clips.length ? mOf(clips[0]) : media.find(m => m.kind !== 'audio'));
      else { const [w, hh] = settings.res.split('x').map(Number); settings.width = w; settings.height = hh; }
      fitFrame(); commit('Resolution');
    });
    const fps = selectField('Frame rate', [[23.976, '23.976 fps (film, NTSC)'], [24, '24 fps'], [25, '25 fps (PAL)'], [29.97, '29.97 fps (NTSC video)'], [30, '30 fps'], [50, '50 fps'], [59.94, '59.94 fps'], [60, '60 fps']], settings.fps);
    fps.select.addEventListener('change', () => { settings.fps = Number(fps.get()); commit('Frame rate'); });
    const fi = slider({ label: 'Fade in from black', min: 0, max: 5, step: 0.1, value: settings.fadeIn, fmt: x => x ? x.toFixed(1) + 's' : 'Off' });
    fi.input.addEventListener('change', () => { settings.fadeIn = fi.get(); commit('Fade in'); });
    const fo = slider({ label: 'Fade out to black', min: 0, max: 5, step: 0.1, value: settings.fadeOut, fmt: x => x ? x.toFixed(1) + 's' : 'Off' });
    fo.input.addEventListener('change', () => { settings.fadeOut = fo.get(); commit('Fade out'); });
    const fit = selectField('Framing', [['fit', 'Fit — letterbox mismatched clips'], ['fill', 'Fill — crop to fill the frame']], settings.fit || 'fit');
    fit.select.addEventListener('change', () => { settings.fit = fit.get(); commit('Framing'); });
    // mixer
    settings.mix = Object.assign({ main: 1, overlay: 1, music: 1 }, settings.mix || {});
    const [mixBox, mixIn] = details('Audio mix & ducking', !!(settings.duck && settings.duck.on));
    const M = (label, key) => { const s = slider({ label, min: 0, max: 200, value: Math.round(settings.mix[key] * 100), unit: '%' }); s.input.addEventListener('input', () => { settings.mix[key] = s.get() / 100; sync(t, playing); }); s.input.addEventListener('change', () => commit('Mix')); return s; };
    settings.duck = Object.assign({ on: false, amount: 12, threshold: 0.04, attack: 0.15, release: 0.8 }, settings.duck || {});
    const duckOn = checkField('Auto-duck music under dialogue', settings.duck.on); duckOn.input.addEventListener('change', () => { settings.duck.on = duckOn.get(); commit('Ducking'); });
    const duckAmt = slider({ label: 'Duck by', min: 3, max: 30, value: settings.duck.amount, fmt: v => '−' + v + ' dB' }); duckAmt.input.addEventListener('change', () => { settings.duck.amount = duckAmt.get(); commit('Ducking'); });
    const duckRel = slider({ label: 'Recovery', min: 0.2, max: 3, step: 0.1, value: settings.duck.release, fmt: v => v.toFixed(1) + 's' }); duckRel.input.addEventListener('change', () => { settings.duck.release = duckRel.get(); commit('Ducking'); });
    mixIn.append(M('Main track', 'main'), M('Overlay audio', 'overlay'), M('Music lane', 'music'), duckOn, duckAmt, duckRel, h('<p class="hint">Ducking lowers the music automatically whenever the main track has sound — great for voice-overs and vlogs. Applied in Render preview and Export.</p>'));
    // captions & chapters & interchange
    const [capBox, capIn] = details('Captions, chapters & hand-off', false);
    const bb = (ic, l, fn) => { const x = h(`<button class="btn btn-sm">${icon(ic)}${l}</button>`); x.addEventListener('click', fn); return x; };
    const r1 = h('<div class="ins-actions"></div>'); r1.append(bb('plus', 'Import .srt/.vtt', importCaptions), bb('export', 'Save .srt', () => exportCaptions('srt')), bb('export', 'Save .vtt', () => exportCaptions('vtt')));
    const r2 = h('<div class="ins-actions"></div>'); r2.append(bb('marker', 'YouTube chapters', copyChapters));
    const r3 = h('<div class="ins-actions"></div>'); r3.append(bb('export', 'Final Cut / Resolve (FCPXML)', () => exportInterchange('fcpxml')), bb('export', 'EDL', () => exportInterchange('edl')), bb('export', 'OpenTimelineIO', () => exportInterchange('otio')));
    capIn.append(r1, captionStyleBox(), r2, h('<p class="hint">Markers become chapters: press M at each chapter start and double-click a marker to name it.</p>'), r3, h('<p class="hint">Hand the edit to Final Cut Pro, DaVinci Resolve, Premiere (EDL/FCPXML) or any OTIO tool.</p>'));
    layout();
    b.append(res, h(`<p class="hint" style="margin-top:-8px">${settings.width} × ${settings.height}</p>`), fps, fit, fi, fo, mixBox, capBox,
      h(`<div class="divider"></div>`),
      h(`<p class="hint">${clips.length} clip${clips.length === 1 ? '' : 's'} · ${fmtTime(total)} long${overlays.length ? ` · ${overlays.length} overlay${overlays.length > 1 ? 's' : ''}` : ''}${audio.length ? ` · ${audio.length} music clip${audio.length > 1 ? 's' : ''}` : ''}${markers.length ? ` · ${markers.length} marker${markers.length > 1 ? 's' : ''}` : ''}<br>Select a clip, transition, overlay or music to edit it. Space plays · J/K/L shuttle · S splits · M marks · Delete removes.</p>`));
  }

  function refresh() {
    if (!el.ins) return;
    renderTimeline(); renderInspector(); fitFrame();
    if (!playing) sync(t, false);
    if (el.undoBtn) { el.undoBtn.disabled = hist.index <= 0; el.redoBtn.disabled = hist.index >= hist.stack.length - 1; }
  }

  // ---------- export ----------
  /** Project description for the render engine. Titles are rasterised at the output size first. */
  const pngBytes = c => new Promise(res => c.toBlob(b => b.arrayBuffer().then(a => res(new Uint8Array(a))), 'image/png'));
  /** Grade with the LUT file's text embedded so the engine can bake it. */
  async function gradeForExport(g) {
    if (!g) return null;
    if (g.lut && g.lut.path) { let tx = lutTexts.get(g.lut.path); if (!tx) { try { tx = await ro3.readText(g.lut.path); lutTexts.set(g.lut.path, tx); } catch (_) { tx = null; } } return { ...g, lut: tx ? { ...g.lut, text: tx } : null }; }
    return g;
  }
  async function buildProject(size, opts = {}) {
    const W = size ? size.width : settings.width, H = size ? size.height : settings.height;
    const ovs = [];
    for (const o of overlays) {
      if (o.kind === 'title') {
        const animated = o.kf && Object.values(o.kf).some(l => l && l.length);
        const c = renderTitle(o, W, H);
        if (animated) {
          // animated titles become a tight image positioned by its centre, so position/scale keyframes apply
          const b = c.box, tc = document.createElement('canvas'); tc.width = Math.max(2, Math.round(b.w)); tc.height = Math.max(2, Math.round(b.h)); tc.getContext('2d').drawImage(c, -b.x, -b.y);
          const p = await ro3.writeTemp(await pngBytes(tc), `title-${o.id}-${W}x${H}-box.png`);
          const cx = (b.x + b.w / 2) / W, cy = (b.y + b.h / 2) / H, dx = cx - o.x, dy = cy - o.y, sc = b.w / W;
          const kf = {};
          if (o.kf.x) kf.x = o.kf.x.map(k => ({ ...k, v: k.v + dx })); if (o.kf.y) kf.y = o.kf.y.map(k => ({ ...k, v: k.v + dy }));
          if (o.kf.scale) kf.scale = o.kf.scale.map(k => ({ ...k, v: k.v * sc })); if (o.kf.opacity) kf.opacity = o.kf.opacity; if (o.kf.rotation) kf.rotation = o.kf.rotation;
          ovs.push({ path: p, kind: 'image', start: o.start, in: 0, out: olen(o), x: cx, y: cy, scale: sc, opacity: o.opacity, fadeIn: o.fadeIn, fadeOut: o.fadeOut, kf });
        } else {
          const p = await ro3.writeTemp(await pngBytes(c), `title-${o.id}-${W}x${H}.png`);
          ovs.push({ path: p, kind: 'title', start: o.start, in: 0, out: olen(o), opacity: o.opacity, fadeIn: o.fadeIn, fadeOut: o.fadeOut });
        }
      } else {
        const m = byId(media, o.mediaId); if (!m) continue;
        ovs.push({ path: m.path, name: m.name, kind: o.kind, start: o.start, in: o.in, out: o.out, x: o.x, y: o.y, scale: o.scale, opacity: o.opacity, rotation: o.rotation || 0, fadeIn: o.fadeIn, fadeOut: o.fadeOut,
          hasAudio: !!(m.info && m.info.hasAudio), volume: o.volume, muted: o.muted, fx: o.fx, kf: o.kf, key: o.key, grade: await gradeForExport(o.grade), afx: o.afx });
      }
    }
    // burned-in captions are just more title overlays
    if (opts.burnCaptions !== false && captions.length) {
      for (const cap of captions) {
        const o = captionOverlay(cap);
        const c = renderTitle(o, W, H);
        const p = await ro3.writeTemp(await pngBytes(c), `cap-${cap.id}-${W}x${H}-${String(cap.text).length}.png`);
        ovs.push({ path: p, kind: 'title', start: cap.start, in: 0, out: Math.max(0.1, cap.end - cap.start), opacity: 1, fadeIn: 0, fadeOut: 0 });
      }
    }
    const clipsOut = [];
    for (const c of clips) { const m = mOf(c); clipsOut.push({ path: m.path, name: m.name, sourceDuration: m.info.duration, kind: m.kind === 'image' ? 'image' : 'video', in: c.in, out: c.out, speed: spd(c), fx: c.fx, hasAudio: !!m.info.hasAudio, volume: c.volume, muted: c.muted, transition: c.transition, grade: await gradeForExport(c.grade), afx: c.afx }); }
    return {
      name: projectPath ? stripExt(baseName(projectPath)) : 'RO3 edit',
      settings: { width: W, height: H, fps: settings.fps, fadeIn: settings.fadeIn, fadeOut: settings.fadeOut, fit: opts.fit || settings.fit, audioCrossfade: settings.audioCrossfade, duck: settings.duck, mix: settings.mix },
      clips: clipsOut,
      overlays: ovs,
      audio: audio.map(a => { const m = byId(media, a.mediaId); return { path: m.path, name: m.name, start: a.start, in: a.in, out: a.out, volume: a.volume, fadeIn: a.fadeIn, fadeOut: a.fadeOut, afx: a.afx }; }),
      markers: markers.map(tm => ({ time: tm, name: markerNames[mkKey(tm)] || '' })),
    };
  }
  async function renderPreview() {
    if (!clips.length) return toast('Add clips to the timeline first.', 'error');
    if (playing) pause();
    const out = await ro3.previewPath();
    let job;
    const pb = progressBox('Rendering preview', () => job && job.cancel());
    job = ro3.render(await buildProject(), { output: out, preview: true }, p => pb.set(p));
    try {
      await job.promise; pb.close();
      const v = h(`<video controls autoplay style="width:100%;border-radius:8px;background:#000;max-height:60vh" src="${ro3.fileUrl(out)}"></video>`);
      modal({ title: 'Preview', body: v, width: 760, onClose: () => v.pause() });
    } catch (e) { pb.close(); if (!e.cancelled) toast(e.message, 'error', 8000); }
  }
  // Platform presets (FilmCraft crates/export/src/presets.rs, plus social formats).
  const EXPORT_PRESETS = [
    ['custom', 'Custom', {}],
    ['yt1080', 'YouTube 1080p', { fmt: 'mp4', codec: 'h264', short: 1080, bitrate: 16, loud: -14 }],
    ['yt4k', 'YouTube 4K', { fmt: 'mp4', codec: 'h264', short: 2160, bitrate: 45, loud: -14 }],
    ['vertical', 'TikTok · Reels · Shorts (9:16)', { fmt: 'mp4', codec: 'h264', w: 1080, h: 1920, fill: true, bitrate: 12, loud: -14 }],
    ['ig45', 'Instagram feed (4:5)', { fmt: 'mp4', codec: 'h264', w: 1080, h: 1350, fill: true, bitrate: 10, loud: -14 }],
    ['square', 'Square (1:1)', { fmt: 'mp4', codec: 'h264', w: 1080, h: 1080, fill: true, bitrate: 10, loud: -14 }],
    ['vimeo', 'Vimeo 1080p', { fmt: 'mp4', codec: 'h264', short: 1080, bitrate: 18 }],
    ['prores', 'ProRes 422 HQ master', { fmt: 'mov', codec: 'prores', prores: 3 }],
    ['proreslt', 'ProRes 422 LT (smaller)', { fmt: 'mov', codec: 'prores', prores: 1 }],
    ['dnxhr', 'DNxHR HQ (Avid / Resolve)', { fmt: 'mov', codec: 'dnxhr' }],
    ['hevc', 'H.265 small file', { fmt: 'mp4', codec: 'hevc' }],
    ['png', 'PNG image sequence', { fmt: 'png', seq: true }],
    ['gif', 'Animated GIF', { fmt: 'gif' }],
    ['podcast', 'Audio: podcast MP3 (−16 LUFS)', { fmt: 'mp3', loud: -16 }],
  ];
  function exportDialog() {
    if (!clips.length) return toast('Add clips to the timeline before exporting.', 'error');
    if (playing) pause();
    const formats = [...FORMATS.VIDEO_OUT, { ext: 'png', label: 'PNG sequence' }, ...FORMATS.AUDIO_OUT.filter(a => ['mp3', 'wav', 'm4a'].includes(a.ext)).map(a => ({ ext: a.ext, label: a.label + ' (audio only)' }))];
    const preset = selectField('Preset', EXPORT_PRESETS.map(([k, l]) => [k, l]), exportDialog.last || 'custom');
    const fmt = selectField('Format', formats, 'mp4');
    const ar = settings.width / settings.height;
    const sizes = [['project', `Project · ${settings.width} × ${settings.height}`]];
    [2160, 1440, 1080, 720, 480].forEach(hh => { const short = Math.min(settings.width, settings.height); if (hh < short) sizes.push([hh, `${hh}p`]); });
    const size = selectField('Resolution', sizes, 'project');
    const q = selectField('Quality', [['high', 'High'], ['balanced', 'Balanced'], ['small', 'Small file']], 'balanced');
    const gifW = selectField('GIF width', [[320, '320 px'], [480, '480 px'], [640, '640 px'], [800, '800 px']], 480);
    const gifF = selectField('GIF frame rate', [[10, '10 fps'], [15, '15 fps'], [20, '20 fps'], [25, '25 fps']], 15);
    const gifRow = h('<div class="row"></div>'); gifRow.append(gifW, gifF);
    const rowA = h('<div class="row"></div>'); rowA.append(size, q);
    const codec = selectField('Video codec', [['h264', 'H.264 — plays everywhere'], ['hevc', 'H.265 / HEVC — smaller files'], ['prores', 'ProRes 422 HQ — for further editing'], ['dnxhr', 'DNxHR HQ — for Avid / Resolve']], 'h264');
    const loud = selectField('Loudness', [['0', 'Leave as is'], ['-14', 'Normalize to −14 LUFS (YouTube, Spotify, social)'], ['-16', 'Normalize to −16 LUFS (Apple, podcasts)'], ['-23', 'Normalize to −23 LUFS (broadcast EBU R128)']], '0');
    const burn = checkField(`Burn in captions (${captions.length})`, true), side = checkField('Also save captions as .srt next to the video', false), chap = checkField(`Add chapters from markers (${markers.length})`, true);
    const capRow = h('<div class="stack"></div>'); if (captions.length) capRow.append(burn, side); if (markers.length) capRow.append(chap);
    layout();
    const info = h(`<p class="hint"></p>`);
    const body = h('<div class="stack"></div>'); body.append(preset, fmt, rowA, codec, gifRow, loud, capRow, info);
    let P = {};
    const paint = () => {
      const f = fmt.get(); gifRow.style.display = f === 'gif' ? '' : 'none'; rowA.style.display = ['gif', 'mp3', 'wav', 'm4a'].includes(f) || P.w ? 'none' : '';
      codec.style.display = ['mp4', 'mov', 'mkv', 'm4v'].includes(f) ? '' : 'none';
      $$('option', codec.select).forEach(o => { o.disabled = (o.value === 'prores' && f !== 'mov') || (o.value === 'dnxhr' && !['mov', 'mkv'].includes(f)); });
      if ((codec.get() === 'prores' && f !== 'mov') || (codec.get() === 'dnxhr' && !['mov', 'mkv'].includes(f))) codec.select.value = 'h264';
      loud.style.display = ['gif', 'png'].includes(f) ? 'none' : '';
      capRow.style.display = ['mp3', 'wav', 'm4a', 'gif', 'png'].includes(f) ? 'none' : '';
      const dims = P.w ? `${P.w} × ${P.h}${P.fill ? ', cropped to fill' : ''}` : '';
      info.textContent = `Length ${fmtTime(total)} · ${settings.fps} fps${dims ? ' · ' + dims : ''}${P.bitrate ? ` · ${P.bitrate} Mbps` : ''}. Transitions, grades and effects are rendered exactly as chosen.`;
    };
    const applyPreset = () => {
      P = (EXPORT_PRESETS.find(p => p[0] === preset.get()) || [])[2] || {};
      exportDialog.last = preset.get();
      if (P.fmt) fmt.select.value = P.fmt;
      if (P.codec) codec.select.value = P.codec;
      if (P.loud) loud.select.value = String(P.loud); else if (preset.get() !== 'custom') loud.select.value = '0';
      if (P.short) { const opt = [...size.select.options].find(o => o.value === String(P.short)); size.select.value = opt ? opt.value : 'project'; } else size.select.value = 'project';
      paint();
    };
    preset.select.addEventListener('change', applyPreset);
    fmt.select.addEventListener('change', () => { if (preset.get() !== 'custom') { preset.select.value = 'custom'; P = {}; } paint(); });
    applyPreset();
    modal({ title: 'Export video', body, width: 480, actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Export…', kind: 'primary', onClick: async () => {
      const f = fmt.get(), seq = f === 'png';
      const base = projectPath ? stripExt(baseName(projectPath)) : (clips[0] ? stripExt(mOf(clips[0]).name) + ' edit' : 'RO3 edit');
      let outPath;
      if (seq) { const dirp = await ro3.folderDialog(); if (!dirp) return false; outPath = `${dirp}/${base.replace(/[^\w -]/g, '_')}_%05d.png`; }
      else { outPath = await ro3.saveDialog({ title: 'Export video', defaultPath: base + '.' + f, filters: [{ name: f.toUpperCase(), extensions: [f] }] }); if (!outPath) return false; }
      const sz = size.get();
      let dims = { width: settings.width, height: settings.height };
      if (P.w) dims = { width: P.w, height: P.h };
      else if (sz !== 'project') {
        const hh = Number(sz);
        dims = settings.height <= settings.width ? { height: hh, width: Math.round(hh * ar / 2) * 2 } : { width: hh, height: Math.round(hh / ar / 2) * 2 };
      }
      const project = await buildProject(dims, { burnCaptions: captions.length ? burn.get() : false, fit: P.fill ? 'fill' : undefined });
      const chapters = markers.length && chap.get() ? Captions.toFFMetadata(chapterData().map(m => ({ time: m.time, name: m.name || `Chapter at ${fmtTime(m.time, false)}` })), timelineEnd()) : null;
      let job;
      const pb = progressBox(`Exporting ${baseName(outPath)}`, () => job && job.cancel());
      job = ro3.render(project, { output: outPath, quality: q.get(), codec: codec.get(), prores: P.prores, bitrate: P.bitrate, abitrate: P.bitrate ? '320k' : undefined, loudnorm: Number(loud.get()) || false, chapters, sequence: seq, gif: { width: Number(gifW.get()), fps: Number(gifF.get()) } }, p => pb.set(p));
      try {
        const r = await job.promise; pb.close();
        if (captions.length && side.get() && !seq) { const sp = r.output.replace(/\.[^.\\/]+$/, '.srt'); await ro3.writeText(sp, Captions.toSRT(captions.map(c => ({ start: c.start, end: c.end, text: c.text })))).catch(() => {}); }
        modal({ title: 'Export finished', body: `<p>${esc(baseName(r.output))}${seq ? ' and the rest of the sequence' : ''} · ${fmtBytes(r.bytes)} · ${fmtTime(r.duration)}</p>`, actions: [
          { label: 'Close', kind: 'ghost' }, { label: 'Show in folder', kind: 'primary', onClick: () => ro3.showInFolder(r.output) }] });
      } catch (e) { pb.close(); if (e.cancelled) toast('Export cancelled.'); else toast(e.message, 'error', 9000); }
    } }] });
  }

  async function exportInterchange(fmt) {
    if (!clips.length) return toast('Add clips to the timeline first.', 'info');
    const ext = { fcpxml: 'fcpxml', edl: 'edl', otio: 'otio' }[fmt];
    const base = projectPath ? stripExt(baseName(projectPath)) : 'RO3 edit';
    const out = await ro3.saveDialog({ title: 'Export timeline', defaultPath: `${base}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!out) return;
    try {
      const p = await buildProject(null, { burnCaptions: false });
      p.overlays = p.overlays.map(o => o.kind === 'title' ? { ...o, text: (overlays.find(x => x.kind === 'title' && Math.abs(x.start - o.start) < 1e-3) || {}).title?.text || '' } : o);
      await ro3.interchange(p, fmt, out);
      toast(`Saved ${baseName(out)}. Titles and effects stay in RO3; cuts, timing, speed, transitions and markers carry over.`, 'ok', 6000);
    } catch (e) { toast('Export failed: ' + e.message, 'error', 7000); }
  }

  // ---------- projects ----------
  const projectData = () => ({ app: 'RO3', type: 'video', version: 3, settings, media: media.map(m => ({ id: m.id, path: m.path })), clips, audio, overlays, markers, markerNames, captions });
  async function saveProject(as = false) {
    let out = !as && projectPath;
    if (!out) out = await ro3.saveDialog({ title: 'Save video project', defaultPath: projectPath || 'RO3 edit.ro3v', filters: [{ name: 'RO3 video project', extensions: ['ro3v'] }] });
    if (!out) return;
    try {
      await ro3.writeText(out, JSON.stringify(projectData(), null, 1));
      projectPath = out; dirty = false; ro3.addRecent(out); ro3.autosaveClear('video.ro3v').catch(() => {});
      toast(`Saved ${baseName(out)}.`, 'ok');
    } catch (e) { toast('Could not save: ' + e.message, 'error', 7000); }
  }
  let autosaveT = null;
  function scheduleAutosave() {
    clearTimeout(autosaveT);
    autosaveT = setTimeout(() => { if (dirty && (clips.length || overlays.length || audio.length)) ro3.autosaveWrite('video.ro3v', JSON.stringify({ ...projectData(), projectPath, savedAt: Date.now() })).catch(() => {}); }, 4000);
  }
  async function openProject() {
    if (dirty && (clips.length || overlays.length) && !(await confirmBox('Open another project?', 'Unsaved changes to this edit will be lost.', 'Open anyway', 'danger'))) return;
    const [p] = await ro3.openDialog({ title: 'Open video project', filters: [{ name: 'RO3 video project', extensions: ['ro3v'] }] });
    if (p) return openProjectPath(p);
  }
  async function openProjectPath(p, text) {
    try {
      const j = JSON.parse(text || await ro3.readText(p));
      if (j.app !== 'RO3' || j.type !== 'video') throw new Error('Not an RO3 video project.');
      const idMap = {};
      const missing = [];
      for (const m of j.media) {
        const [nm] = await importPaths([m.path], { quiet: true });
        if (nm) idMap[m.id] = nm.id; else missing.push(baseName(m.path));
      }
      clips = j.clips.filter(c => idMap[c.mediaId]).map(c => ({ ...c, mediaId: idMap[c.mediaId] }));
      audio = j.audio.filter(a => idMap[a.mediaId]).map(a => ({ ...a, mediaId: idMap[a.mediaId] }));
      overlays = (j.overlays || []).filter(o => o.kind === 'title' || idMap[o.mediaId]).map(o => o.kind === 'title' ? o : ({ ...o, mediaId: idMap[o.mediaId] }));
      markers = j.markers || []; markerNames = j.markerNames || {}; captions = j.captions || [];
      settings = j.settings; projectPath = text ? (j.projectPath || null) : p; sel = null; t = 0;
      hist.stack = []; hist.index = -1; commit('Open project');
      dirty = !!text;
      if (!text && p) ro3.addRecent(p);
      if (missing.length) toast(`These files have moved or been deleted, so their clips were left out: ${missing.join(', ')}`, 'error', 9000);
    } catch (e) { toast('Could not open project: ' + e.message, 'error', 6000); }
  }
  async function recover(text) { await openProjectPath(null, text); toast('Recovered your unsaved edit. Save it to keep it.', 'ok', 5000); }

  // ---------- keys & module ----------
  function onKey(e) {
    if (RO3App.active !== 'video' || isTyping() || document.querySelector('.modal-backdrop')) return;
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
    else if (k === 's' && !mod) split();
    else if (k === 'm' && !mod) toggleMarker();
    else if (k === 'n' && !mod) { snapOn = !snapOn; el.snapB && el.snapB.classList.toggle('on', snapOn); toast(snapOn ? 'Snapping on' : 'Snapping off', 'info', 900); }
    else if (k === 'j' && !mod) shuttle(-1);
    else if (k === 'k' && !mod) shuttle(0);
    else if (k === 'l' && !mod) shuttle(1);
    else if (k === 't' && !mod) addTitle('lower');
    else if (k === 'c' && !mod) addCaption();
    else if (k === 'f' && e.shiftKey && !mod) freezeFrame();
    else if (k === 'c' && mod && !e.shiftKey) { if (copyClip()) e.preventDefault(); }
    else if (k === 'v' && mod && e.altKey) { e.preventDefault(); pasteAttributes(); }
    else if (k === 'v' && mod) { if (pasteClip()) e.preventDefault(); }
    else if (k === 'd' && mod) { e.preventDefault(); duplicateClip(); }
    else if (k === 'delete' || k === 'backspace') { e.preventDefault(); removeSelected(); }
    else if (k === 'arrowleft') { e.preventDefault(); e.shiftKey ? seek(t - 1) : stepFrame(-1); }
    else if (k === 'arrowright') { e.preventDefault(); e.shiftKey ? seek(t + 1) : stepFrame(1); }
    else if (k === 'home') seek(0);
    else if (k === 'end') seek(timelineEnd());
    else if (k === 'arrowup') jumpClip(-1);
    else if (k === 'arrowdown') jumpClip(1);
    else if (k === '=' || k === '+') { zoom = clamp(zoom * 1.25, 8, 300); el.zoomIn.value = zoom; paintZoom(); renderTimeline(); }
    else if (k === '-') { zoom = clamp(zoom / 1.25, 8, 300); el.zoomIn.value = zoom; paintZoom(); renderTimeline(); }
    else if (k === 'escape') { sel = null; refresh(); }
  }
  function activate(bar) {
    const b = (ic, label, fn, kind = 'btn-ghost', title) => { const x = h(`<button class="btn ${kind}" ${title ? `title="${title}" aria-label="${title}"` : ''}>${icon(ic)}${label}</button>`); x.addEventListener('click', fn); return x; };
    el.undoBtn = b('undo', '', () => restore(hist.index - 1), 'btn-ghost', 'Undo');
    el.redoBtn = b('redo', '', () => restore(hist.index + 1), 'btn-ghost', 'Redo');
    el.undoBtn.style.padding = el.redoBtn.style.padding = '0 8px';
    bar.append(b('plus', 'Import', importDialog), b('open', 'Open', openProject), el.undoBtn, el.redoBtn, b('save', 'Save', () => saveProject(false)), b('export', 'Export', exportDialog, 'btn-primary'));
    refresh();
  }
  function deactivate() { if (playing) pause(); }
  function menu(cmd) {
    if (cmd === 'open') importDialog();
    if (cmd === 'save') saveProject(false);
    if (cmd === 'save-as') saveProject(true);
    if (cmd === 'export') exportDialog();
    if (cmd === 'undo') restore(hist.index - 1);
    if (cmd === 'redo') restore(hist.index + 1);
    if (!cmd.startsWith('video:')) return;
    const map = {
      caption: () => addCaption(), 'import-captions': importCaptions, 'export-srt': () => exportCaptions('srt'), 'export-vtt': () => exportCaptions('vtt'),
      chapters: copyChapters, freeze: freezeFrame, 'paste-attrs': pasteAttributes, 'copy-clip': copyClip, 'paste-clip': pasteClip,
      'export-fcpxml': () => exportInterchange('fcpxml'), 'export-edl': () => exportInterchange('edl'), 'export-otio': () => exportInterchange('otio'),
      scopes: () => $('[data-act="scopes"]', el.ws).click(), meters: () => $('[data-act="meter"]', el.ws).click(),
      split, marker: toggleMarker, title: () => addTitle('lower'), 'render-preview': renderPreview, export: exportDialog,
    };
    const f = map[cmd.slice(6)]; if (f) f();
  }
  /** Palette entries for the video workspace. */
  const commands = () => [
    ['Add caption at playhead', 'caption', 'C'], ['Import captions (.srt / .vtt)', 'import-captions'], ['Save captions as .srt', 'export-srt'], ['Save captions as .vtt', 'export-vtt'],
    ['Copy YouTube chapters', 'chapters'], ['Freeze frame', 'freeze', 'Shift+F'], ['Paste effects onto clip', 'paste-attrs', 'Ctrl+Alt+V'],
    ['Export to Final Cut / Resolve (FCPXML)', 'export-fcpxml'], ['Export EDL', 'export-edl'], ['Export OpenTimelineIO', 'export-otio'],
    ['Toggle video scopes', 'scopes'], ['Toggle audio meters', 'meters'], ['Split at playhead', 'split', 'S'], ['Add marker', 'marker', 'M'], ['Add title', 'title', 'T'], ['Render preview', 'render-preview'],
  ].map(([label, c, accel]) => ({ label, path: 'Video', accel: accel || '', run: () => { RO3App.show('video'); menu('video:' + c); } }));

  const unsaved = () => dirty && (clips.length || overlays.length || audio.length) ? ['The video edit'] : [];
  return { unsaved, recover, openProjectPath, init, activate, deactivate, menu, commands, importPaths, addToTimeline, _debug: () => ({ media, clips, audio, overlays, markers, markerNames, captions, settings, t, total: layout(), buildProject, addTitle, addOverlay, toggleMarker, shuttle, addCaption, setKey, freezeFrame, copyClip, pasteClip, pasteAttributes, exportInterchange, chapterData, get sel() { return sel; }, set sel(v) { sel = v; } }), _seek: seek, _select: (s) => { sel = s; refresh(); } };
})();
