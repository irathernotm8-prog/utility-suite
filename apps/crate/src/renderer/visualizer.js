// Crate — retro visualizer, in the spirit of the old Windows Media Player ones (Bars and Waves, Battery, Ambience, Album art)
const Vis = {
  presets: [
    { id: 'bars', name: 'Bars', group: 'Bars and Waves' },
    { id: 'mist', name: 'Ocean Mist', group: 'Bars and Waves' },
    { id: 'fire', name: 'Fire Storm', group: 'Bars and Waves' },
    { id: 'scope', name: 'Scope', group: 'Bars and Waves' },
    { id: 'battery', name: 'Spiral Tunnel', group: 'Battery' },
    { id: 'kaleido', name: 'Kaleidoscope', group: 'Battery' },
    { id: 'ambience', name: 'Swirl', group: 'Ambience' },
    { id: 'art', name: 'Album Art', group: 'Album art' }
  ],
  ctx: null, analyser: null, el: null, raf: 0, idx: 0, t: 0, energy: 0, avg: 0, beat: 0, hue: 0, peaks: [], artImg: null, artId: null,

  // Hook the player into Web Audio once (an <audio> can only be connected one time)
  ensureAudio() {
    if (this.analyser) { if (this.ctx.state === 'suspended') this.ctx.resume(); return true; }
    try {
      this.ctx = new AudioContext();
      const src = this.ctx.createMediaElementSource(Player.audio);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.72;
      src.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
      this.freq = new Uint8Array(this.analyser.frequencyBinCount);
      this.wave = new Uint8Array(this.analyser.fftSize);
      return true;
    } catch (e) { toast('The visualizer couldn\'t hook into the player.', { error: true }); return false; }
  },

  open() {
    if (this.el) return;
    if (!this.ensureAudio()) return;
    const saved = this.presets.findIndex((p) => p.id === S.settings.visPreset);
    this.idx = saved >= 0 ? saved : 0;
    this.el = h(`<div class="vis" tabindex="-1">
      <canvas class="vis-c"></canvas><canvas class="vis-buf" hidden></canvas>
      <div class="vis-top"><div class="vis-np"></div><div class="vis-preset"></div></div>
      <div class="vis-bar">
        <button class="pbtn" data-v="prevp" title="Previous visualization (←)">${icon('back', 18)}</button>
        <div class="vis-name"></div>
        <button class="pbtn" data-v="nextp" title="Next visualization (→)" style="transform:scaleX(-1)">${icon('back', 18)}</button>
        <span class="vis-sep"></span>
        <button class="pbtn" data-v="prev" title="Previous song">${icon('prev', 17)}</button>
        <button class="pbtn main" data-v="play" title="Play/Pause (Space)"></button>
        <button class="pbtn" data-v="next" title="Next song">${icon('next', 17)}</button>
        <span class="vis-sep"></span>
        <button class="pbtn" data-v="full" title="Full screen (F)">${icon('external', 16)}</button>
        <button class="pbtn" data-v="close" title="Close (Esc)">${icon('x', 18)}</button>
      </div></div>`);
    document.body.append(this.el);
    this.c = $('.vis-c', this.el); this.g = this.c.getContext('2d');
    this.buf = $('.vis-buf', this.el); this.bg = this.buf.getContext('2d');
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (!b) { if (e.target === this.c) this.step(1); return; }
      ({ prevp: () => this.step(-1), nextp: () => this.step(1), prev: () => Player.prev(), next: () => Player.next(), play: () => Player.toggle(), full: () => this.fullscreen(), close: () => this.close() })[b.dataset.v]();
    });
    let idle = 0;
    this.wake = () => { if (!this.el) return; this.el.classList.remove('idle'); clearTimeout(idle); idle = setTimeout(() => this.el && this.el.classList.add('idle'), 2500); };
    this.el.addEventListener('mousemove', this.wake);
    this.key = (e) => {
      if (document.querySelector('.scrim')) return;
      const k = e.key;
      if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); if (document.fullscreenElement) document.exitFullscreen(); else this.close(); return; }
      else if (k === 'ArrowRight') this.step(1);
      else if (k === 'ArrowLeft') this.step(-1);
      else if (k === 'f' || k === 'F') this.fullscreen();
      else if (k === ' ') { e.preventDefault(); Player.toggle(); }
      else return;
      e.stopPropagation(); this.wake();
    };
    document.addEventListener('keydown', this.key, true);
    this.resize = () => this.size();
    addEventListener('resize', this.resize);
    this.size(); this.labels(); this.wake();
    if (!Player.current()) Player.toggle();
    const loop = (ts) => { this.raf = requestAnimationFrame(loop); this.frame(ts); };
    this.raf = requestAnimationFrame(loop);
  },

  close() {
    if (!this.el) return;
    cancelAnimationFrame(this.raf);
    document.removeEventListener('keydown', this.key, true);
    removeEventListener('resize', this.resize);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    this.el.remove(); this.el = null;
  },

  fullscreen() { if (document.fullscreenElement) document.exitFullscreen(); else this.el.requestFullscreen().catch(() => {}); },

  step(d) {
    this.idx = (this.idx + d + this.presets.length) % this.presets.length;
    this.g.clearRect(0, 0, this.W, this.H); this.bg.clearRect(0, 0, this.W, this.H);
    this.peaks = [];
    this.labels(true);
    api.call('settings:set', { visPreset: this.presets[this.idx].id }).then((st) => { S.settings = st.settings; }).catch(() => {});
  },

  labels(flash) {
    const p = this.presets[this.idx]; const t = Player.current();
    $('.vis-name', this.el).innerHTML = `<b>${esc(p.name)}</b><small>${esc(p.group)}</small>`;
    $('.vis-np', this.el).innerHTML = t ? `<b>${esc(t.title)}</b><span>${esc([t.artist, t.album].filter(Boolean).join(' — '))}</span>` : '<b>Nothing playing</b>';
    if (flash) { const pr = $('.vis-preset', this.el); pr.textContent = `${p.group}: ${p.name}`; pr.classList.remove('show'); void pr.offsetWidth; pr.classList.add('show'); }
  },

  size() {
    // the feedback presets run at a lower resolution: faster, and it gives that soft retro glow
    const low = ['mist', 'fire', 'battery', 'kaleido', 'ambience'].includes(this.presets[this.idx].id);
    const scale = low ? 0.5 : Math.min(2, devicePixelRatio || 1);
    this.W = Math.max(2, Math.round(innerWidth * scale)); this.H = Math.max(2, Math.round(innerHeight * scale));
    for (const c of [this.c, this.buf]) { c.width = this.W; c.height = this.H; }
    this.scale = scale; this.low = low;
  },

  /* ---------- per frame ---------- */
  frame(ts) {
    const low = ['mist', 'fire', 'battery', 'kaleido', 'ambience'].includes(this.presets[this.idx].id);
    if (low !== this.low) this.size();
    const a = this.analyser;
    a.getByteFrequencyData(this.freq); a.getByteTimeDomainData(this.wave);
    // bass energy + simple beat detection
    let bass = 0; for (let i = 1; i < 12; i++) bass += this.freq[i]; bass /= 11 * 255;
    let all = 0; for (let i = 0; i < 400; i++) all += this.freq[i]; all /= 400 * 255;
    this.energy = all; this.avg = this.avg * 0.96 + bass * 0.04;
    if (bass > this.avg * 1.25 && bass > 0.35 && ts - (this.lastBeat || 0) > 220) { this.beat = 1; this.lastBeat = ts; }
    this.beat *= 0.9; this.bass = bass;
    this.t += 1 / 60; this.hue = (this.hue + 0.25 + all * 2) % 360;
    const playBtn = $('[data-v="play"]', this.el); const want = Player.audio.paused ? 'play' : 'pause';
    if (playBtn.dataset.state !== want) { playBtn.dataset.state = want; playBtn.innerHTML = icon(want, 18); }
    const cur = Player.current(); if (cur && cur.id !== this.npId) { this.npId = cur.id; this.labels(); }
    this[this.presets[this.idx].id]();
  },

  // Bars and Waves: Bars — spectrum bars with falling peak caps
  bars() {
    const { g, W, H } = this; const s = this.scale;
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    const n = Math.min(96, Math.floor(W / (12 * s)));
    const gap = 3 * s; const bw = (W - gap * (n + 1)) / n;
    const floor = H * 0.86; const maxH = H * 0.72;
    for (let i = 0; i < n; i++) {
      // log-spaced bins so the bars cover bass to treble evenly
      const lo = Math.floor(2 * Math.pow(400 / 2, i / n)); const hi = Math.max(lo + 1, Math.floor(2 * Math.pow(400 / 2, (i + 1) / n)));
      let v = 0; for (let k = lo; k < hi; k++) v = Math.max(v, this.freq[k]);
      v = Math.pow(v / 255, 1.4);
      const bh = Math.max(2 * s, v * maxH);
      const x = gap + i * (bw + gap);
      const hue = 200 - (i / n) * 200;
      const grad = g.createLinearGradient(0, floor - maxH, 0, floor);
      grad.addColorStop(0, `hsl(${hue - 40},100%,62%)`); grad.addColorStop(1, `hsl(${hue},100%,38%)`);
      g.fillStyle = grad; g.fillRect(x, floor - bh, bw, bh);
      // reflection
      g.globalAlpha = 0.18; g.fillRect(x, floor + 2 * s, bw, bh * 0.35); g.globalAlpha = 1;
      // peak cap
      const p = this.peaks[i] || { y: 0, v: 0 };
      if (bh > p.y) { p.y = bh; p.v = 0; } else { p.v += 0.35 * s; p.y = Math.max(0, p.y - p.v); }
      this.peaks[i] = p;
      g.fillStyle = '#fff'; g.fillRect(x, floor - p.y - 4 * s, bw, 2.5 * s);
    }
  },

  // feedback helper: copy the frame, then redraw it transformed and faded
  feedback({ zoom = 1, rot = 0, dx = 0, dy = 0, alpha = 0.92, fade = 'rgba(0,0,0,0.08)', comp = 'source-over' }) {
    const { g, bg, W, H } = this;
    bg.globalCompositeOperation = 'copy'; bg.drawImage(this.c, 0, 0); bg.globalCompositeOperation = 'source-over';
    g.save(); g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    g.globalAlpha = alpha; g.globalCompositeOperation = comp;
    g.translate(W / 2 + dx, H / 2 + dy); g.rotate(rot); g.scale(zoom, zoom); g.translate(-W / 2, -H / 2);
    g.drawImage(this.buf, 0, 0);
    g.restore();
    if (fade) { g.fillStyle = fade; g.fillRect(0, 0, W, H); }
  },

  waveLine(y0, amp, color, width, step = 4) {
    const { g, W } = this; const n = this.wave.length / 2; // half the buffer: smoother, fuller waves
    g.beginPath();
    for (let x = 0; x <= W; x += step) { const v = (this.wave[Math.floor((x / W) * (n - 1))] - 128) / 128; const y = y0 + v * amp; x ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.strokeStyle = color; g.lineWidth = width; g.stroke();
  },

  // Bars and Waves: Ocean Mist — soft blue waves that drift and blur upward
  mist() {
    this.feedback({ zoom: 1.006, dy: -1.2, alpha: 0.94, fade: 'rgba(0,8,20,0.06)' });
    const { H } = this;
    const g = this.g; g.globalCompositeOperation = 'lighter';
    this.waveLine(H * 0.62, H * 0.32, `hsla(${195 + Math.sin(this.t) * 15},100%,60%,0.55)`, 2.2);
    this.waveLine(H * 0.62, H * 0.18, 'hsla(170,100%,75%,0.35)', 1.2, 6);
    g.globalCompositeOperation = 'source-over';
  },

  // Bars and Waves: Fire Storm — the waveform burns and smoke rises
  fire() {
    this.feedback({ zoom: 1.012 + this.beat * 0.02, dy: -3, alpha: 0.9, fade: 'rgba(8,0,0,0.05)' });
    const { H } = this; const g = this.g;
    g.globalCompositeOperation = 'lighter';
    this.waveLine(H * 0.72, H * (0.22 + this.bass * 0.3), 'rgba(255,170,40,0.85)', 3);
    this.waveLine(H * 0.72, H * 0.1, 'rgba(255,60,10,0.7)', 2, 6);
    g.globalCompositeOperation = 'source-over';
  },

  // Bars and Waves: Scope — a crisp green oscilloscope
  scope() {
    const { g, W, H } = this; const s = this.scale;
    g.fillStyle = 'rgba(0,10,4,0.35)'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(40,255,140,0.08)'; g.lineWidth = 1;
    for (let x = 0; x < W; x += W / 12) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = 0; y < H; y += H / 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.shadowColor = '#3dff9a'; g.shadowBlur = 14 * s;
    this.waveLine(H / 2, H * 0.4, '#5dffae', 2.5 * s, 2);
    g.shadowBlur = 0;
  },

  // Battery-style: a spinning tunnel built from the waveform drawn as a ring
  battery() {
    const twist = 0.012 + this.energy * 0.03;
    this.feedback({ zoom: 1.035 + this.beat * 0.05, rot: twist * (Math.sin(this.t * 0.2) > 0 ? 1 : -1), alpha: 0.95, fade: 'rgba(0,0,0,0.04)' });
    const { g, W, H } = this; const n = this.wave.length;
    const r0 = Math.min(W, H) * (0.12 + this.bass * 0.12);
    g.globalCompositeOperation = 'lighter';
    g.beginPath();
    for (let i = 0; i <= 180; i++) {
      const ang = (i / 180) * Math.PI * 2; const v = (this.wave[Math.floor((i / 180) * (n - 1))] - 128) / 128;
      const r = r0 * (1 + v * 0.9); const x = W / 2 + Math.cos(ang) * r; const y = H / 2 + Math.sin(ang) * r;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.strokeStyle = `hsla(${this.hue},100%,60%,0.9)`; g.lineWidth = 2; g.stroke();
    g.globalCompositeOperation = 'source-over';
  },

  // Battery-style: mirrored kaleidoscope of the spectrum
  kaleido() {
    this.feedback({ zoom: 0.985, rot: -0.008 - this.energy * 0.02, alpha: 0.93, fade: 'rgba(0,0,0,0.05)' });
    const { g, W, H } = this; const segs = 8; const R = Math.min(W, H) * 0.48;
    g.save(); g.translate(W / 2, H / 2); g.globalCompositeOperation = 'lighter';
    for (let s = 0; s < segs; s++) {
      g.save(); g.rotate((s / segs) * Math.PI * 2 + this.t * 0.15); if (s % 2) g.scale(1, -1);
      g.beginPath();
      for (let i = 0; i < 64; i++) { const v = this.freq[i * 3] / 255; const x = (i / 64) * R; const y = v * R * 0.35; i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.strokeStyle = `hsla(${(this.hue + s * 25) % 360},100%,60%,0.6)`; g.lineWidth = 1.6; g.stroke();
      g.restore();
    }
    g.restore();
  },

  // Ambience-style: glowing color blobs that orbit and swell with the music
  ambience() {
    this.feedback({ zoom: 1.01, rot: 0.004, alpha: 0.9, fade: 'rgba(0,0,0,0.05)' });
    const { g, W, H } = this; const t = this.t;
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const band = this.freq[4 + i * 30] / 255;
      const x = W / 2 + Math.cos(t * (0.4 + i * 0.13) + i) * W * 0.28;
      const y = H / 2 + Math.sin(t * (0.5 + i * 0.11) + i * 2) * H * 0.28;
      const r = Math.min(W, H) * (0.05 + band * 0.16 + this.beat * 0.04);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `hsla(${(this.hue + i * 60) % 360},100%,65%,0.55)`); gr.addColorStop(1, 'hsla(0,0%,0%,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  },

  // Album art — the cover pulses over a blurred copy of itself, with a spectrum ring
  art() {
    const { g, W, H } = this; const cur = Player.current();
    if (cur && cur.hasArt && this.artId !== `${cur.id}:${cur.artV}`) {
      this.artId = `${cur.id}:${cur.artV}`; const im = new Image(); im.crossOrigin = 'anonymous'; im.src = artUrl(cur); im.onload = () => { this.artImg = im; this.artBg = null; };
    }
    if (!cur || !cur.hasArt) { this.artImg = null; this.artId = null; }
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    const side = Math.min(W, H) * 0.46 * (1 + this.beat * 0.04 + this.bass * 0.03);
    if (this.artImg) {
      // blurred backdrop, drawn once per cover and size
      if (!this.artBg || this.artBg.width !== W || this.artBg.height !== H) {
        const c = document.createElement('canvas'); c.width = W; c.height = H; const cg = c.getContext('2d');
        cg.filter = `blur(${Math.round(40 * this.scale)}px) brightness(0.45) saturate(1.4)`; const big = Math.max(W, H) * 1.2;
        cg.drawImage(this.artImg, (W - big) / 2, (H - big) / 2, big, big); this.artBg = c;
      }
      g.drawImage(this.artBg, 0, 0);
    }
    // spectrum ring
    const R = side * 0.78; g.save(); g.translate(W / 2, H / 2);
    for (let i = 0; i < 120; i++) {
      const v = this.freq[2 + Math.floor(i * 2.6)] / 255; const ang = (i / 120) * Math.PI * 2 - Math.PI / 2;
      g.rotate(0); g.strokeStyle = `hsla(${(this.hue + i * 3) % 360},90%,65%,0.85)`; g.lineWidth = Math.max(2, R * 0.025);
      g.beginPath(); g.moveTo(Math.cos(ang) * R, Math.sin(ang) * R); g.lineTo(Math.cos(ang) * (R + v * R * 0.35), Math.sin(ang) * (R + v * R * 0.35)); g.stroke();
    }
    g.restore();
    const x = (W - side) / 2; const y = (H - side) / 2;
    g.save(); g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 40;
    if (this.artImg) g.drawImage(this.artImg, x, y, side, side);
    else { g.fillStyle = '#1b1620'; g.fillRect(x, y, side, side); g.fillStyle = '#fff'; g.font = `600 ${side * 0.08}px Instrument Sans, sans-serif`; g.textAlign = 'center'; g.fillText(cur ? cur.title : 'Crate', W / 2, H / 2); }
    g.restore();
  }
};
