// Mixer — the engine. Builds the song as a Web Audio graph (track → effects → automation → fader → pan → mute →
// master effects → master volume) and schedules notes, drum hits and audio clips into it. Live playback schedules a
// short window ahead (so edits are heard straight away, loops wrap cleanly and the metronome ticks); export renders
// the same graph in an OfflineAudioContext. Audio files are decoded once; stretched/reversed versions are cached.
(function (root) {
  'use strict';
  const SG = root.MXSong, SND = root.MXSounds, FX = root.MXFx, SY = root.MXSynth, DR = root.MXDrums, ST = root.MXStretch;
  const dbg = FX.dbToGain;

  // ───── decoded audio, shared by every context in the window
  class Assets {
    constructor(read) { this.read = read; this.raw = new Map(); this.proc = new Map(); this.pending = new Map(); this.dec = null; }
    decoder() { if (!this.dec) this.dec = new OfflineAudioContext(2, 1, 44100); return this.dec; }
    async get(file) {
      if (this.raw.has(file)) return this.raw.get(file); if (this.pending.has(file)) return this.pending.get(file);
      const p = (async () => { const bytes = await this.read(file); const ab = bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); const b = await this.decoder().decodeAudioData(ab); this.raw.set(file, b); this.pending.delete(file); return b; })();
      this.pending.set(file, p); p.catch(() => this.pending.delete(file)); return p;
    }
    has(file) { return this.raw.has(file); }
    // the buffer a clip actually plays: reversed and/or time-stretched by F (pitch is then set with playbackRate)
    processed(file, F, rev) {
      const raw = this.raw.get(file); if (!raw) return null; F = Math.round(F * 10000) / 10000; if (F === 1 && !rev) return raw;
      const k = `${file}|${F}|${rev ? 1 : 0}`; if (this.proc.has(k)) return this.proc.get(k);
      let ch = []; for (let c = 0; c < raw.numberOfChannels; c++) ch.push(raw.getChannelData(c));
      if (rev) ch = ch.map((x) => { const y = new Float32Array(x.length); for (let i = 0; i < x.length; i++) y[i] = x[x.length - 1 - i]; return y; });
      if (F !== 1) ch = ST.wsola(ch, raw.sampleRate, F);
      const b = new AudioBuffer({ numberOfChannels: ch.length, length: ch[0].length, sampleRate: raw.sampleRate }); ch.forEach((x, i) => b.copyToChannel(x, i));
      if (this.proc.size > 24) this.proc.delete(this.proc.keys().next().value);
      this.proc.set(k, b); return b;
    }
    forget(file) { this.raw.delete(file); for (const k of [...this.proc.keys()]) if (k.startsWith(file + '|')) this.proc.delete(k); }
    async need(song) { const files = new Set(); for (const c of song.clips) if (c.file) files.add(c.file); for (const t of song.tracks) for (const p of Object.values(t.pads || {})) if (p && p.file) files.add(p.file); await Promise.all([...files].map((f) => this.get(f).catch((e) => { console.warn('Couldn’t load', f, e); }))); }
  }
  const clipRates = (c) => { const pr = Math.pow(2, (c.pitch || 0) / 12); return { F: (c.stretch || 1) * pr, R: (c.speed || 1) * pr }; };

  // chip chords: notes that start together are played one after another, very fast, on a single voice (NES style)
  const arpCache = new WeakMap();
  function chipArp(c, step) {
    const hit = arpCache.get(c.notes); if (hit && hit.step === step && hit.len === c.length) return hit.out;
    const groups = new Map(); for (const n of c.notes) { const k = Math.round(n.t * 1000); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(n); }
    const out = [];
    for (const g of groups.values()) {
      if (g.length < 2) { out.push(g[0]); continue; }
      const ps = g.map((n) => n.p).sort((a, b) => a - b); const t0 = g[0].t, d = Math.min(...g.map((n) => n.d)), v = Math.max(...g.map((n) => n.v));
      for (let k = 0, t = t0; t < t0 + d - 1e-6; k++, t += step) out.push({ p: ps[k % ps.length], t: +t.toFixed(5), d: Math.min(step * 0.98, t0 + d - t), v });
    }
    out.sort((a, b) => a.t - b.t); arpCache.set(c.notes, { step, len: c.length, out }); return out;
  }

  // ───── a playing (or rendering) song
  class Session {
    constructor(ctx, assets, { destination, meters = false, onEnd } = {}) { this.trash = []; this.ctx = ctx; this.assets = assets; this.dest = destination || ctx.destination; this.meters = meters; this.tracks = new Map(); this.voices = new Set(); this.mono = new Map(); this.onEnd = onEnd; this.song = null; }
    env() { return { bpm: this.song.bpm }; }
    effMuted(t) { const anySolo = this.song.tracks.some((x) => x.solo); return t.mute || (anySolo && !t.solo) || (this.only && !this.only.has(t.id)); }
    buildMaster() {
      const ctx = this.ctx; const m = { input: ctx.createGain(), vol: ctx.createGain(), fx: [] };
      m.vol.connect(this.dest); if (this.meters) { m.meterL = ctx.createAnalyser(); m.meterR = ctx.createAnalyser(); const sp = ctx.createChannelSplitter(2); m.vol.connect(sp); sp.connect(m.meterL, 0); sp.connect(m.meterR, 1); m.meterL.fftSize = m.meterR.fftSize = 1024; }
      this.master = m; this.wireMaster();
    }
    wireMaster() { const m = this.master; try { m.input.disconnect(); } catch {} for (const f of m.fx) try { f.output.disconnect(); } catch {} m.fx = this.noMasterFx ? [] : this.song.master.effects.filter((f) => f.on).map((f) => FX.build(this.ctx, f, this.env())); let n = m.input; for (const f of m.fx) { n.connect(f.input); n = f.output; } n.connect(m.vol); m.vol.gain.value = dbg(this.song.master.volume); m.sig = this.song.master.effects.filter((f) => f.on).map((f) => f.type).join(','); }
    sig(t) { return [t.kind, t.sound, t.effects.filter((f) => f.on).map((f) => f.id + f.type).join(',')].join('|'); }
    buildTrack(t) {
      const ctx = this.ctx; const old = this.tracks.get(t.id);
      const T = { id: t.id, input: ctx.createGain(), fx: [], auto: ctx.createGain(), fader: ctx.createGain(), pan: ctx.createStereoPanner(), mute: ctx.createGain(), sig: this.sig(t) };
      // a DC blocker first: FM voices and reverse/stretched audio can carry a little offset that reverbs would amplify
      const dc = ctx.createBiquadFilter(); dc.type = 'highpass'; dc.frequency.value = 12; dc.Q.value = 0.5; T.input.connect(dc); let n = dc;
      if (t.kind === 'drums') { const k = SND.kit(t.sound) || {}; if (k.crush) { const ws = ctx.createWaveShaper(); ws.curve = FX.curve(ctx, 'crush', k.crush); n.connect(ws); n = ws; } if (k.lp) { const lp = ctx.createBiquadFilter(); lp.frequency.value = k.lp; n.connect(lp); n = lp; } }
      for (const f of t.effects.filter((x) => x.on)) { const u = FX.build(ctx, f, this.env()); T.fx.push(u); n.connect(u.input); n = u.output; }
      n.connect(T.auto); T.auto.connect(T.fader); T.fader.connect(T.pan); T.pan.connect(T.mute); T.mute.connect(this.master.input);
      if (this.meters) { T.meter = ctx.createAnalyser(); T.meter.fftSize = 512; T.mute.connect(T.meter); }
      this.mixTrack(t, T);
      if (old) { const at = ctx.currentTime; old.mute.gain.setTargetAtTime(0, at, 0.01); setTimeout(() => { try { old.mute.disconnect(); } catch {} }, 200); }
      this.tracks.set(t.id, T); return T;
    }
    mixTrack(t, T) { const hasVolAuto = t.automation && t.automation.volume && t.automation.volume.length; const set = (p, v) => (this.live ? p.setTargetAtTime(v, this.ctx.currentTime, 0.015) : (p.value = v)); set(T.fader.gain, hasVolAuto ? 1 : dbg(t.volume)); if (!(t.automation && t.automation.pan && t.automation.pan.length)) set(T.pan.pan, t.pan); set(T.mute.gain, this.effMuted(t) ? 0 : 1); }
    load(song) { this.song = song; this.buildMaster(); for (const t of song.tracks) this.buildTrack(t); }
    // apply a changed song while playing: mixer moves in place, structural changes rebuild just that track
    update(song) {
      const prev = this.song; this.song = song;
      if (prev && prev.bpm !== song.bpm) return 'restart';
      const msig = song.master.effects.filter((f) => f.on).map((f) => f.type).join(',');
      if (msig !== this.master.sig) this.wireMaster(); else { song.master.effects.filter((f) => f.on).forEach((f, i) => this.master.fx[i] && this.master.fx[i].set(f)); this.master.vol.gain.setTargetAtTime(dbg(song.master.volume), this.ctx.currentTime, 0.015); }
      for (const t of song.tracks) { const T = this.tracks.get(t.id); if (!T || T.sig !== this.sig(t)) this.buildTrack(t); else { t.effects.filter((f) => f.on).forEach((f, i) => T.fx[i] && T.fx[i].set(f)); this.mixTrack(t, T); } }
      for (const [id, T] of this.tracks) if (!song.tracks.some((t) => t.id === id)) { try { T.mute.disconnect(); } catch {} this.tracks.delete(id); }
      return 'ok';
    }

    // schedule everything that starts in song beats [b0, b1); tOf(beat) gives the context time
    // finished notes leave the graph; otherwise every past note keeps costing CPU until garbage collection
    sweep() { const now = this.ctx.currentTime; if (!this.trash.length) return; const keep = []; for (const x of this.trash) { if (x.end < now - 0.05) { try { x.node.disconnect(); } catch {} } else keep.push(x); } this.trash = keep; }
    bin(x) { if (x && x.node) this.trash.push(x); return x; }
    schedule(b0, b1, tOf, { enter = false } = {}) {
      const s = this.song, spb = SG.spb(s); this.sweep();
      const duckers = []; for (const t of s.tracks) { const T = this.tracks.get(t.id); if (!T) continue; for (const u of T.fx) if (u.type === 'duck') { const q = u.follows(); const src = q.source ? SG.findTrack(s, q.source, { must: false }) : null; if (src) duckers.push({ src: src.id, voice: q.voice, u }); } }
      const duckAt = (trackId, voice, time) => { for (const d of duckers) if (d.src === trackId && (!d.voice || d.voice === 'any' || d.voice === voice || typeof voice === 'number')) d.u.trigger(time); };
      for (const t of s.tracks) {
        const T = this.tracks.get(t.id); if (!T) continue;
        this.automate(t, T, b0, b1, tOf);
        if (this.effMuted(t) && !this.renderMuted) continue;
        for (const c of s.clips) {
          if (c.track !== t.id) continue; const cEnd = SG.clipEnd(s, c); if (cEnd <= b0 || c.start >= b1 + (enter ? 0 : 0)) continue;
          if (c.file) { const startsIn = c.start >= b0 - 1e-9 && c.start < b1; const inside = enter && c.start < b0 && cEnd > b0 + 1e-6; if (startsIn || inside) this.playAudio(t, T, c, Math.max(c.start, b0), tOf); continue; }
          const PI = t.kind === 'drums' ? null : SND.instrument(t.sound); const notes = PI && PI.arp ? chipArp(c, (PI.arp.ms / 1000) / spb) : c.notes;
          for (const n of notes) {
            const nb = c.start + n.t; if (nb < b0 - 1e-9 || nb >= b1 || n.t >= c.length - 1e-9) continue; const time = tOf(nb);
            if (t.kind === 'drums') { const pad = t.pads && t.pads[n.p] && t.pads[n.p].file ? { ...t.pads[n.p], buffer: this.assets.raw.get(t.pads[n.p].file) } : null; this.bin(DR.hit(this.ctx, T.input, t.sound, n.p, time, n.v, { bpm: s.bpm, pad })); duckAt(t.id, n.p, time); continue; }
            const P = SND.instrument(t.sound) || SND.INSTRUMENTS[0]; const midi = n.p + 12 * (t.octave || 0); const dur = Math.min(n.d, c.length - n.t) * spb;
            let from = null; const last = this.mono.get(t.id);
            if (P.mono && last && last.end > time + 0.001) { if (P.glide) from = last.midi; last.voice.cut(time); }
            const voice = this.bin(SY.playNote(this.ctx, T.input, P, midi, time, dur, n.v, { bpm: s.bpm, from }));
            if (P.mono) this.mono.set(t.id, { midi, end: time + dur, voice });
            if (this.live) this.voices.add(voice); duckAt(t.id, n.p, time);
          }
        }
      }
      if (this.live && this.voices.size > 300) { const now = this.ctx.currentTime; for (const v of this.voices) if (v.end < now) this.voices.delete(v); }
    }
    playAudio(t, T, c, fromBeat, tOf) {
      const s = this.song; const spb = SG.spb(s); const { F, R } = clipRates(c); const buf = this.assets.processed(c.file, F, c.reverse); if (!buf) return;
      const outDur = (c.dur * (c.stretch || 1)) / (c.speed || 1); const skip = (fromBeat - c.start) * spb; if (skip >= outDur) return;
      const segStart = (c.reverse ? c.srcDur - c.offset - c.dur : c.offset) * F; const time = tOf(fromBeat);
      const src = this.ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = R; const gn = this.ctx.createGain(); src.connect(gn); gn.connect(T.input);
      const g0 = dbg(c.gain || 0); const startT = time, endT = time + outDur - skip; const p = gn.gain;
      const fi = c.fadeIn || 0, fo = c.fadeOut || 0;
      if (skip < fi) { p.setValueAtTime((g0 * skip) / fi, startT); p.linearRampToValueAtTime(g0, startT + fi - skip); } else p.setValueAtTime(g0, startT);
      if (fo > 0) { const fs = Math.max(startT, endT - fo); p.setValueAtTime(g0 * Math.min(1, (endT - fs) / fo), fs); p.linearRampToValueAtTime(0, endT); }
      src.start(startT, segStart + skip * R, (outDur - skip) * R); src.stop(endT + 0.02); this.bin({ node: gn, end: endT + 0.05 });
      if (this.live) this.voices.add({ end: endT, cut: (at) => { try { src.stop(at); } catch {} }, srcs: [src] });
    }
    automate(t, T, b0, b1, tOf) {
      const A = t.automation || {};
      const run = (pts, param, map) => { if (!pts || !pts.length || !param) return; const v0 = SG.autoValue(pts, b0); param.setValueAtTime(map(v0), tOf(b0)); for (const [b, v] of pts) if (b > b0 && b < b1) param.linearRampToValueAtTime(map(v), tOf(b)); param.linearRampToValueAtTime(map(SG.autoValue(pts, b1)), tOf(b1)); };
      run(A.volume, T.auto.gain, (d) => dbg(d)); if (!A.volume || !A.volume.length) { /* keep auto at unity */ }
      run(A.pan, T.pan.pan, (v) => v);
      if (A.cutoff) { const u = T.fx.find((x) => x.type === 'filter') || T.fx.find((x) => x.type === 'eq'); if (u && u.param) run(A.cutoff, u.param('cutoff'), (v) => v); }
    }
    stopAll(at) { for (const v of this.voices) try { v.cut(at ?? this.ctx.currentTime); } catch {} this.voices.clear(); this.mono.clear(); }
    dispose() { this.stopAll(); try { this.master.vol.disconnect(); } catch {} for (const T of this.tracks.values()) try { T.mute.disconnect(); } catch {} }
  }

  // ───── live transport for the window
  class Player {
    constructor(assets) { this.assets = assets; this.ctx = null; this.sess = null; this.playing = false; this.song = null; this.metronome = false; this.listeners = new Set(); this.pos = 0; }
    ensure() { if (!this.ctx) { this.ctx = new AudioContext({ latencyHint: 'interactive' }); this.out = this.ctx.createGain(); this.out.connect(this.ctx.destination); FX.prepare(this.ctx); } if (this.ctx.state === 'suspended') this.ctx.resume(); return this.ctx; }
    setSong(song) { this.song = song; if (this.sess) { const r = this.sess.update(song); if (r === 'restart' && this.playing) this.play(this.position()); } }
    async play(fromBeat = 0) {
      const ctx = this.ensure(); await FX.prepare(ctx); await this.assets.need(this.song);
      if (this.sess) { this.sess.stopAll(); this.sess.dispose(); }
      this.sess = new Session(ctx, this.assets, { destination: this.out, meters: true }); this.sess.live = true; this.sess.load(this.song);
      const s = this.song; this.spb = SG.spb(s); this.t0 = ctx.currentTime + 0.08; this.lin = 0; this.anchor = [{ lin: 0, beat: fromBeat }]; this.cur = fromBeat; this.playing = true; this.firstEnter = true; this.clickNext = Math.ceil(fromBeat - 1e-6);
      clearInterval(this.timer); this.timer = setInterval(() => this.tick(), 25); this.tick(); this.emit();
    }
    tick() {
      if (!this.playing) return; const s = this.song; const spb = SG.spb(s); if (spb !== this.spb) { this.play(this.position()); return; }
      const horizon = (this.ctx.currentTime + 0.18 - this.t0) / spb; const end = SG.songEnd(s); let guard = 0;
      while (this.lin < horizon - 1e-9 && guard++ < 8) {
        const L = s.loop.on && s.loop.end > s.loop.start + 0.25; const segEnd = L && this.cur < s.loop.end - 1e-6 ? s.loop.end : end;
        if (this.cur >= segEnd - 1e-9) { if (L && this.cur >= s.loop.end - 1e-6) { this.cur = s.loop.start; this.anchor.push({ lin: this.lin, beat: this.cur }); if (this.anchor.length > 4) this.anchor.shift(); this.firstEnter = true; this.clickNext = Math.ceil(this.cur - 1e-6); continue; } this.stopAt = this.t0 + this.lin * spb; break; }
        const amt = Math.min(horizon - this.lin, segEnd - this.cur); const linStart = this.lin, beatStart = this.cur; const tOf = (b) => this.t0 + (linStart + (b - beatStart)) * spb;
        this.sess.schedule(beatStart, beatStart + amt, tOf, { enter: this.firstEnter }); this.firstEnter = false;
        if (this.metronome) for (; this.clickNext < beatStart + amt - 1e-9; this.clickNext++) if (this.clickNext >= beatStart - 1e-9) this.click(tOf(this.clickNext), this.clickNext % SG.bpb(s) === 0);
        this.lin += amt; this.cur += amt;
      }
      if (this.stopAt && this.ctx.currentTime > this.stopAt + 0.3) { this.stop(); this.pos = 0; this.emit(); }
    }
    click(t, down) { const o = this.ctx.createOscillator(); o.frequency.value = down ? 1600 : 1100; const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05); o.connect(g); g.connect(this.out); o.start(t); o.stop(t + 0.06); }
    position() { if (!this.playing) return this.pos; const lin = Math.max(0, (this.ctx.currentTime - this.t0) / this.spb); let a = this.anchor[0]; for (const x of this.anchor) if (x.lin <= lin + 1e-9) a = x; return a.beat + (lin - a.lin); }
    stop() { if (!this.playing) return; this.pos = this.position(); this.playing = false; clearInterval(this.timer); this.stopAt = null; if (this.sess) { this.sess.stopAll(); const s = this.sess; setTimeout(() => s.dispose(), 300); this.sess = null; } this.emit(); }
    seek(beat) { if (this.playing) this.play(beat); else { this.pos = beat; this.emit(); } }
    meters() { if (!this.sess) return null; const read = (an) => { if (!an) return 0; const d = new Float32Array(an.fftSize); an.getFloatTimeDomainData(d); let p = 0; for (const v of d) p = Math.max(p, Math.abs(v)); return p; }; const out = { master: [read(this.sess.master.meterL), read(this.sess.master.meterR)], tracks: {} }; for (const [id, T] of this.sess.tracks) out.tracks[id] = read(T.meter); return out; }
    on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    emit() { for (const f of this.listeners) f({ playing: this.playing, pos: this.position() }); }
    // audition: one note on a track (or a sound by id) right now
    preview({ track, sound, kind, midi = 60, voice, dur = 0.6, vel = 0.85 }) {
      const ctx = this.ensure(); const t = ctx.currentTime + 0.02; let out = this.out;
      if (track && this.sess && this.sess.tracks.get(track.id)) out = this.sess.tracks.get(track.id).input;
      else if (track && track.effects && track.effects.length) { out = this.previewChain(track); }
      if ((kind || (track && track.kind)) === 'drums') DR.hit(ctx, out, sound || track.sound, voice || 'kick', t, vel, { bpm: this.song ? this.song.bpm : 120 });
      else { const P = SND.instrument(sound || track.sound) || SND.INSTRUMENTS[0]; SY.playNote(ctx, out, P, midi + 12 * ((track && track.octave) || 0), t, dur, vel, { bpm: this.song ? this.song.bpm : 120 }); }
    }
    previewChain(track) { const ctx = this.ctx; const key = track.id + this.prevSig(track); if (this._pc && this._pc.key === key) return this._pc.input; if (this._pc) setTimeout(((o) => () => { try { o.out.disconnect(); } catch {} })(this._pc), 4000); const input = ctx.createGain(); let n = input; for (const f of track.effects.filter((x) => x.on && x.type !== 'duck')) { const u = FX.build(ctx, f, { bpm: this.song ? this.song.bpm : 120 }); n.connect(u.input); n = u.output; } const vol = ctx.createGain(); vol.gain.value = dbg(track.volume || 0); n.connect(vol); vol.connect(this.out); this._pc = { key, input, out: vol }; return input; }
    prevSig(t) { return t.effects.map((f) => JSON.stringify(f)).join(); }
  }

  // ───── offline render (export, analysis, stems)
  async function render(song, assets, { sr = 44100, from = 0, to = null, tracks = null, master = true, tail = 2.5, channels = 2 } = {}) {
    await assets.need(song);
    const spb = SG.spb(song); const end = to != null ? to : SG.songEnd(song); const len = Math.max(0.1, (end - from) * spb + (to != null ? 0 : tail));
    const ctx = new OfflineAudioContext(channels, Math.ceil(len * sr), sr);
    await FX.prepare(ctx);
    const sess = new Session(ctx, assets); if (tracks) sess.only = new Set(tracks.map((r) => SG.findTrack(song, r).id)); sess.noMasterFx = !master; sess.load(song);
    if (!master) sess.master.vol.gain.value = 1;
    // schedule in 2-second slices just ahead of the render (suspend/resume), so only the notes about to sound exist in
    // the graph — rendering cost stays proportional to what plays, not to the whole song at once
    const tOf = (b) => (b - from) * spb; const slice = 2, ahead = 0.4; const sliceBeats = slice / spb;
    sess.schedule(from, Math.min(end, from + sliceBeats), tOf, { enter: true });
    for (let k = 1; from + k * sliceBeats < end - 1e-9; k++) { const b0 = from + k * sliceBeats, b1 = Math.min(end, b0 + sliceBeats); const at = Math.max(0, k * slice - ahead); if (at >= len) break; ctx.suspend(Math.floor((at * sr) / 128) * 128 / sr).then(() => { sess.schedule(b0, b1, tOf); ctx.resume(); }); }
    const buf = await ctx.startRendering(); const ch = []; for (let c = 0; c < buf.numberOfChannels; c++) ch.push(buf.getChannelData(c));
    // trim trailing silence (keep 0.3 s)
    if (to == null) { let last = 0; for (const x of ch) for (let i = x.length - 1; i > last; i--) if (Math.abs(x[i]) > 1e-4) { last = i; break; } const keep = Math.min(ch[0].length, Math.max(Math.ceil((end - from) * spb * sr), last + Math.round(0.3 * sr))); for (let c = 0; c < ch.length; c++) ch[c] = ch[c].subarray(0, keep); }
    return { sr, channels: ch, seconds: ch[0].length / sr };
  }

  root.MXEngine = { Assets, Session, Player, render, clipRates };
})(typeof self !== 'undefined' ? self : this);
