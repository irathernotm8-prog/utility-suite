// Crate — audio editor: trim, fade in/out, volume, loudness. Non-destructive: edits always re-render from the original.
const parseTime = (s) => { const p = String(s).trim().split(':').map(Number); if (p.some((x) => !Number.isFinite(x))) return NaN; return p.reduce((a, x) => a * 60 + x, 0); };
const fmtPrecise = (s) => { s = Math.max(0, s || 0); const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`; };

const Editor = {
  async open(id) {
    const t = S.byId.get(id);
    if (!t) return;
    Player.audio.pause();
    const m = modal({
      title: `Edit audio — ${t.title}`, wide: true,
      body: `<div class="row muted" id="ed-loading"><span class="spin"></span>Reading the waveform…</div>`,
      foot: `<div class="left">${t.original ? `<button class="btn danger" id="ed-revert">${icon('refresh', 15)}Undo all edits</button>` : ''}<span class="muted" id="ed-note" style="font-size:12px"></span></div><button class="btn" id="ed-cancel">Cancel</button><button class="btn primary" id="ed-save" disabled>${icon('check', 15)}Save</button>`,
      onClose: () => this.teardown()
    });
    this.m = m;
    $('#ed-cancel', m.el).onclick = () => m.close();
    const rv = $('#ed-revert', m.el);
    if (rv) rv.onclick = async () => {
      if (!(await confirm_('Undo all edits?', 'Crate puts back the original download, exactly as it was before any trimming or fades.', 'Undo edits'))) return;
      try { await api.call('edit:revert', id); m.close(); toast('Back to the original'); } catch (e) { fail(e); }
    };
    let w;
    try { w = await api.call('edit:load', id); } catch (e) { m.close(); return fail(e); }
    if (!document.body.contains(m.el)) return;
    const dur = w.duration;
    const e0 = w.edit || {};
    this.st = { id, dur, peaks: w.peaks, start: e0.start || 0, end: e0.end && e0.end < dur ? e0.end : dur, fadeIn: e0.fadeIn || 0, fadeOut: e0.fadeOut || 0, gainDb: e0.gainDb || 0, normalize: !!e0.normalize, hover: null };
    m.body.innerHTML = `
      <div class="wave-wrap" id="wave"><canvas id="wave-c"></canvas>
        <div class="wave-shade" id="sh-l"></div><div class="wave-shade" id="sh-r"></div>
        <div class="handle" id="h-s" title="Start"></div><div class="handle" id="h-e" title="End"></div>
        <div class="playhead" id="ph"></div><div class="hover-time" id="ht" hidden></div>
      </div>
      <div class="ed-times"><span>0:00</span><span id="ed-len"></span><span>${fmtTime(dur)}</span></div>
      <div class="row wrap" style="gap:14px">
        <div class="timebox"><span class="muted">Start</span><input class="in" id="t-s"><button class="btn sm" id="set-s" title="Set start to the playhead">${icon('scissors', 13)}Here</button></div>
        <div class="timebox"><span class="muted">End</span><input class="in" id="t-e"><button class="btn sm" id="set-e" title="Set end to the playhead">${icon('scissors', 13)}Here</button></div>
        <button class="btn sm" id="ed-silence">${icon('wave', 14)}Trim silence</button>
        <button class="btn sm ghost" id="ed-full">Reset trim</button>
        <span style="flex:1"></span>
        <button class="btn" id="ed-play">${icon('play', 14)}<span>Play</span></button>
        <button class="btn" id="ed-tail" title="Hear the last 6 seconds of the selection (check the fade out)">Hear ending</button>
      </div>
      <div class="ed-grid">
        <div class="slider"><div class="lab"><span>Fade in</span><span id="v-fi"></span></div><input type="range" id="fi" min="0" max="10" step="0.1"></div>
        <div class="slider"><div class="lab"><span>Fade out</span><span id="v-fo"></span></div><input type="range" id="fo" min="0" max="15" step="0.1"></div>
        <div class="slider"><div class="lab"><span>Volume</span><span id="v-g"></span></div><input type="range" id="gain" min="-12" max="12" step="0.5"></div>
        <label class="check" style="align-self:center"><input type="checkbox" id="norm"><span>Even out loudness<small>Matches streaming loudness (−14 LUFS) so songs play at the same level</small></span></label>
      </div>
      <p class="muted" style="margin:0;font-size:12px">Space plays/pauses · click the waveform to jump · drag the pink handles to trim. Saving re-encodes from the original download${w.edited ? ' (this song was edited before — you are editing the original, not the edited copy)' : ''}, and the original is kept so you can undo.</p>`;
    // audio with live preview of volume and fades
    const a = new Audio(); a.crossOrigin = 'anonymous'; a.src = `crate://audio/${id}?src=original&v=${Date.now()}`; a.preload = 'auto';
    this.a = a;
    try {
      this.ctx = new AudioContext();
      const src = this.ctx.createMediaElementSource(a);
      this.gain = this.ctx.createGain();
      src.connect(this.gain).connect(this.ctx.destination);
    } catch { this.ctx = null; }
    const st = this.st;
    const q = (s) => $(s, m.el);
    const fi = q('#fi'); const fo = q('#fo'); const gain = q('#gain'); const norm = q('#norm');
    fi.value = st.fadeIn; fo.value = st.fadeOut; gain.value = st.gainDb; norm.checked = st.normalize;
    const snap = () => JSON.stringify([st.start, st.end, st.fadeIn, st.fadeOut, st.gainDb, st.normalize]);
    const changed = () => { q('#ed-save').disabled = this.base === snap(); };
    this.base = JSON.stringify([st.start, st.end, st.fadeIn, st.fadeOut, st.gainDb, st.normalize]);
    const labels = () => {
      q('#v-fi').textContent = st.fadeIn ? `${st.fadeIn.toFixed(1)} s` : 'Off';
      q('#v-fo').textContent = st.fadeOut ? `${st.fadeOut.toFixed(1)} s` : 'Off';
      q('#v-g').textContent = st.gainDb ? `${st.gainDb > 0 ? '+' : ''}${st.gainDb} dB` : '0 dB';
      q('#t-s').value = fmtPrecise(st.start); q('#t-e').value = fmtPrecise(st.end);
      q('#ed-len').textContent = `Selection ${fmtTime(st.end - st.start)}${st.start > 0 || st.end < dur - 0.05 ? ` (cut ${fmtTime(dur - (st.end - st.start))})` : ''}`;
      q('#ed-note').textContent = st.normalize ? 'Loudness evening is applied when you save (not in the preview).' : '';
      changed();
    };
    fi.oninput = () => { st.fadeIn = +fi.value; labels(); this.draw(); };
    fo.oninput = () => { st.fadeOut = +fo.value; labels(); this.draw(); };
    gain.oninput = () => { st.gainDb = +gain.value; labels(); };
    norm.onchange = () => { st.normalize = norm.checked; labels(); };
    const setTime = (k, v) => {
      if (!Number.isFinite(v)) return;
      if (k === 'start') st.start = Math.max(0, Math.min(v, st.end - 0.5));
      else st.end = Math.min(dur, Math.max(v, st.start + 0.5));
      labels(); this.layout();
    };
    q('#t-s').onchange = () => setTime('start', parseTime(q('#t-s').value));
    q('#t-e').onchange = () => setTime('end', parseTime(q('#t-e').value));
    q('#set-s').onclick = () => setTime('start', a.currentTime);
    q('#set-e').onclick = () => setTime('end', a.currentTime);
    q('#ed-full').onclick = () => { st.start = 0; st.end = dur; labels(); this.layout(); };
    q('#ed-silence').onclick = async (e) => {
      e.currentTarget.disabled = true;
      try { const s = await api.call('edit:silence', id); setTime('start', s.start); setTime('end', s.end); toast(s.start > 0.1 || s.end < dur - 0.1 ? 'Trimmed the silence at the ends' : 'No silence to trim at the ends'); } catch (err) { fail(err); }
      e.currentTarget.disabled = false;
    };
    const play = (from) => {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      a.currentTime = from ?? (a.currentTime >= st.start && a.currentTime < st.end - 0.2 ? a.currentTime : st.start);
      a.play();
    };
    q('#ed-play').onclick = () => (a.paused ? play() : a.pause());
    q('#ed-tail').onclick = () => play(Math.max(st.start, st.end - 6));
    const paintPlay = () => { q('#ed-play').innerHTML = `${icon(a.paused ? 'play' : 'pause', 14)}<span>${a.paused ? 'Play' : 'Pause'}</span>`; };
    a.onplay = paintPlay; a.onpause = paintPlay;
    this.key = (e) => { if (e.key === ' ' && !typing(e)) { e.preventDefault(); e.stopPropagation(); q('#ed-play').click(); } };
    document.addEventListener('keydown', this.key, true);
    // preview loop: playhead, stop at end, fades + gain
    const loop = () => {
      if (!this.a) return;
      const ct = a.currentTime;
      if (!a.paused && ct >= st.end) { a.pause(); a.currentTime = st.start; }
      if (this.gain) {
        let env = 1;
        if (st.fadeIn && ct < st.start + st.fadeIn) env = Math.max(0, (ct - st.start) / st.fadeIn);
        if (st.fadeOut && ct > st.end - st.fadeOut) env = Math.min(env, Math.max(0, (st.end - ct) / st.fadeOut));
        this.gain.gain.value = Math.pow(10, st.gainDb / 20) * env;
      }
      const ph = q('#ph'); if (ph) ph.style.left = `${(ct / dur) * 100}%`;
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    // waveform interactions
    const wave = q('#wave');
    const xToT = (x) => { const r = wave.getBoundingClientRect(); return Math.max(0, Math.min(dur, ((x - r.left) / r.width) * dur)); };
    const drag = (k) => (e) => {
      e.preventDefault(); e.stopPropagation();
      const mv = (ev) => setTime(k, xToT(ev.clientX));
      const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
      addEventListener('mousemove', mv); addEventListener('mouseup', up);
    };
    q('#h-s').onmousedown = drag('start');
    q('#h-e').onmousedown = drag('end');
    wave.onmousedown = (e) => { if (e.target.classList.contains('handle')) return; a.currentTime = xToT(e.clientX); if (a.paused) play(a.currentTime); };
    wave.onmousemove = (e) => { const ht = q('#ht'); ht.hidden = false; ht.textContent = fmtPrecise(xToT(e.clientX)); ht.style.left = `${e.clientX - wave.getBoundingClientRect().left}px`; };
    wave.onmouseleave = () => { q('#ht').hidden = true; };
    this.ro = new ResizeObserver(() => { this.draw(); this.layout(); });
    this.ro.observe(wave);
    labels(); this.draw(); this.layout();
    // save
    q('#ed-save').onclick = async () => {
      const btn = q('#ed-save'); btn.disabled = true;
      a.pause();
      const off = api.on('edit:progress', (p) => { if (p.id === id) btn.innerHTML = `<span class="spin"></span>Saving ${Math.round(p.progress * 100)}%`; });
      btn.innerHTML = '<span class="spin"></span>Saving…';
      const full = st.start <= 0.01 && st.end >= dur - 0.01;
      try {
        await api.call('edit:apply', { id, ops: { start: st.start > 0.01 ? st.start : 0, end: full ? 0 : st.end, fadeIn: st.fadeIn, fadeOut: st.fadeOut, gainDb: st.gainDb, normalize: st.normalize } });
        off(); m.close(); toast('Audio saved — the original is kept if you want to undo');
      } catch (e) { off(); btn.disabled = false; btn.innerHTML = `${icon('check', 15)}Save`; fail(e); }
    };
  },

  layout() {
    const st = this.st; if (!st || !this.m) return;
    const q = (s) => $(s, this.m.el);
    const ps = (st.start / st.dur) * 100; const pe = (st.end / st.dur) * 100;
    q('#h-s').style.left = ps + '%'; q('#h-e').style.left = pe + '%';
    q('#sh-l').style.left = '0'; q('#sh-l').style.width = ps + '%';
    q('#sh-r').style.left = pe + '%'; q('#sh-r').style.right = '0';
    this.draw();
  },

  draw() {
    const st = this.st; if (!st || !this.m) return;
    const c = $('#wave-c', this.m.el); if (!c) return;
    const dpr = devicePixelRatio || 1;
    const W = c.clientWidth; const H = c.clientHeight;
    c.width = W * dpr; c.height = H * dpr;
    const g = c.getContext('2d'); g.scale(dpr, dpr);
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue('--accent').trim(); const ink = css.getPropertyValue('--ink-2').trim();
    const bars = Math.floor(W / 3);
    const per = st.peaks.length / bars;
    const mid = H / 2;
    for (let i = 0; i < bars; i++) {
      const s = st.peaks.slice(Math.floor(i * per), Math.max(Math.floor(i * per) + 1, Math.floor((i + 1) * per)));
      const pk = Math.max(...s.map((x) => x[0])); const rms = Math.max(...s.map((x) => x[1]));
      const t = ((i + 0.5) / bars) * st.dur;
      let env = 1;
      if (st.fadeIn && t < st.start + st.fadeIn) env = Math.max(0.04, (t - st.start) / st.fadeIn);
      if (st.fadeOut && t > st.end - st.fadeOut) env = Math.min(env, Math.max(0.04, (st.end - t) / st.fadeOut));
      const inSel = t >= st.start && t <= st.end;
      const x = i * 3;
      g.fillStyle = inSel ? accent : ink;
      g.globalAlpha = inSel ? 0.35 : 0.25;
      const ph = Math.max(1, pk * (H * 0.46) * (inSel ? env : 1));
      g.fillRect(x, mid - ph, 2, ph * 2);
      g.globalAlpha = inSel ? 1 : 0.5;
      const rh = Math.max(1, rms * (H * 0.46) * (inSel ? env : 1));
      g.fillRect(x, mid - rh, 2, rh * 2);
    }
    g.globalAlpha = 1;
  },

  teardown() {
    if (this.a) { this.a.pause(); this.a.src = ''; this.a = null; }
    if (this.ctx) { this.ctx.close().catch(() => {}); this.ctx = null; this.gain = null; }
    cancelAnimationFrame(this.raf);
    if (this.ro) this.ro.disconnect();
    if (this.key) document.removeEventListener('keydown', this.key, true);
    this.m = null; this.st = null; this.base = null;
  }
};
