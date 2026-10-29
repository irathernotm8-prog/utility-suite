// Dither — the animation player used everywhere (draft cards, the effect lab, sprite previews). One shared clock
// drives every player on screen; frames are drawn pixel-perfect at an integer scale.
'use strict';

const Players = {
  set: new Set(), raf: 0,
  add(p) { this.set.add(p); if (!this.raf) this.raf = requestAnimationFrame((t) => this.tick(t)); },
  remove(p) { this.set.delete(p); },
  clear() { for (const p of this.set) p.dispose(true); this.set.clear(); },
  tick(now) { this.raf = 0; for (const p of this.set) p.tick(now); if (this.set.size) this.raf = requestAnimationFrame((t) => this.tick(t)); },
};

function frameCanvas(data, w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0); return c; }
const BGS = { dark: '#16141e', light: '#efeef4', black: '#000000', game: '#22283a', grass: '#2f4a2c', sky: '#4a6fa5' };

class Player {
  // opts: { scale: 'fit' | n, max: n, bg: 'checker'|'dark'|..., autoplay, speed, onion, onFrame(i), pad }
  constructor(canvas, opts = {}) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.o = { scale: 'fit', bg: 'checker', autoplay: true, speed: 1, onion: false, pad: 0, ...opts };
    this.frames = []; this.meta = null; this.i = 0; this.playing = !!this.o.autoplay; this.acc = 0; this.last = 0; this.disposed = false;
    if (this.o.scale === 'fit') { this.ro = new ResizeObserver(() => this.layout()); this.ro.observe(canvas.parentElement); }
    Players.add(this);
  }
  set(frames, meta) {
    this.meta = { w: meta.w, h: meta.h, durations: meta.durations || frames.map(() => 83), loop: meta.loop !== false, background: meta.background || null };
    this.frames = frames.map((f) => frameCanvas(f, meta.w, meta.h)); this.raw = frames;
    if (this.i >= this.frames.length) this.i = 0; this.acc = 0; this.layout(); this.draw(); return this;
  }
  layout() {
    if (!this.meta || this.disposed) return; const { w, h } = this.meta; let s = this.o.scale;
    if (s === 'fit') { const box = this.cv.parentElement.getBoundingClientRect(); const pad = this.o.pad * 2; s = Math.max(1, Math.floor(Math.min((box.width - pad) / w, (box.height - pad) / h))); if (this.o.max) s = Math.min(this.o.max, s); }
    this.s = s; const dpr = devicePixelRatio || 1;
    this.cv.style.width = w * s + 'px'; this.cv.style.height = h * s + 'px'; this.cv.width = Math.round(w * s * dpr); this.cv.height = Math.round(h * s * dpr);
    this.draw();
  }
  draw() {
    if (!this.meta || !this.frames.length || this.disposed) return; const c = this.ctx, W = this.cv.width, H = this.cv.height, { w, h } = this.meta; const px = W / w;
    c.imageSmoothingEnabled = false; const bg = this.o.bg === 'auto' ? (this.meta.background || 'checker') : this.o.bg;
    if (bg === 'checker') { const st = getComputedStyle(document.documentElement); const a = st.getPropertyValue('--check-a').trim() || '#24222e', b = st.getPropertyValue('--check-b').trim() || '#1d1b26'; const sz = Math.max(4, Math.round(px * 2)); c.fillStyle = a; c.fillRect(0, 0, W, H); c.fillStyle = b; for (let y = 0; y < H; y += sz) for (let x = (y / sz) % 2 ? sz : 0; x < W; x += sz * 2) c.fillRect(x, y, sz, sz); }
    else if (bg === 'none') c.clearRect(0, 0, W, H);
    else { c.fillStyle = BGS[bg] || bg; c.fillRect(0, 0, W, H); }
    if (this.o.onion && this.frames.length > 1) { const p = (this.i - 1 + this.frames.length) % this.frames.length; c.globalAlpha = 0.28; c.drawImage(this.frames[p], 0, 0, W, H); c.globalAlpha = 1; }
    c.drawImage(this.frames[this.i], 0, 0, W, H);
    if (this.o.grid && px >= 6) { c.strokeStyle = 'rgba(128,128,140,.18)'; c.lineWidth = 1; c.beginPath(); for (let x = 1; x < w; x++) { c.moveTo(Math.round(x * px) + 0.5, 0); c.lineTo(Math.round(x * px) + 0.5, H); } for (let y = 1; y < h; y++) { c.moveTo(0, Math.round(y * px) + 0.5); c.lineTo(W, Math.round(y * px) + 0.5); } c.stroke(); }
  }
  tick(now) {
    if (!this.playing || this.frames.length < 2 || !this.meta) { this.last = now; return; }
    if (!this.cv.isConnected) { this.dispose(); return; }
    const dt = Math.min(250, now - (this.last || now)) * this.o.speed; this.last = now; this.acc += dt;
    let moved = false; let d = this.meta.durations[this.i] || 83;
    while (this.acc >= d) {
      this.acc -= d;
      if (this.i + 1 >= this.frames.length) { if (!this.meta.loop && this.o.holdEnd) { this.acc = 0; this.playing = false; break; } this.i = 0; if (!this.meta.loop) this.acc -= this.o.gap || 0; } else this.i++;
      moved = true; d = this.meta.durations[this.i] || 83;
    }
    if (moved) { this.draw(); if (this.o.onFrame) this.o.onFrame(this.i); }
  }
  play() { this.playing = true; this.last = 0; } pause() { this.playing = false; } toggle() { this.playing ? this.pause() : this.play(); return this.playing; }
  seek(i) { if (!this.frames.length) return; this.i = ((i % this.frames.length) + this.frames.length) % this.frames.length; this.acc = 0; this.draw(); if (this.o.onFrame) this.o.onFrame(this.i); }
  step(d) { this.pause(); this.seek(this.i + d); }
  setOpt(k, v) { this.o[k] = v; if (k === 'scale' || k === 'max') this.layout(); else this.draw(); }
  dispose(keep) { this.disposed = true; if (this.ro) this.ro.disconnect(); if (!keep) Players.remove(this); }
}

// a canvas element that plays an effect from the cache; used by cards
function mountEffect(el, id, opts = {}) {
  const cv = document.createElement('canvas'); el.appendChild(cv);
  const p = new Player(cv, { pad: 10, max: 8, gap: opts.gap ?? 260, ...opts });
  Frames.effect(id).then((r) => { if (!p.disposed) p.set(r.frames, r.meta); el.classList.remove('loading'); }).catch((e) => { el.classList.remove('loading'); el.classList.add('broken'); el.innerHTML = `<div class="broken-msg">${icon('alert', 16)}<span>${esc(e.message).slice(0, 160)}</span></div>`; });
  return p;
}
