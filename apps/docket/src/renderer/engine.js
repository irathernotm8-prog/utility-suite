// Docket — the listening side: capture (your mic + the call's audio), segmenting, and the Whisper worker.
(function () {
  'use strict';
  const { Segmenter, SR } = window.DT;

  const MODELS = {
    quick: { label: 'Quick', en: 'onnx-community/whisper-base.en', multi: 'onnx-community/whisper-base', mb: { gpu: 205, cpu: 77 }, note: 'Fastest, fine for clear audio' },
    balanced: { label: 'Balanced', en: 'onnx-community/whisper-small.en', multi: 'onnx-community/whisper-small', mb: { gpu: 410, cpu: 250 }, note: 'Recommended: accurate and keeps up live' },
    best: { label: 'Best', en: 'onnx-community/whisper-large-v3-turbo', multi: 'onnx-community/whisper-large-v3-turbo', mb: { gpu: 560, cpu: 1080 }, note: 'Most accurate, any language; needs a good GPU to keep up' }
  };
  const modelId = (s) => { const m = MODELS[s.model] || MODELS.balanced; return s.language === 'en' && m.en ? m.en : m.multi; };

  // ---------------------------------------------------------------- the Whisper worker
  class Engine {
    constructor() { this.worker = null; this.jobs = new Map(); this.n = 0; this.st = { status: 'idle', device: null, loaded: 0, total: 0, queue: 0, key: null, error: '' }; this.subs = new Set(); }
    on(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
    set(patch) { Object.assign(this.st, patch); for (const f of this.subs) f(this.st); }
    get state() { return this.st; }
    _worker() {
      if (this.worker) return this.worker;
      this.worker = new Worker('whisper-worker.js', { type: 'module' });
      this.worker.onmessage = (e) => {
        const d = e.data;
        if (d.type === 'progress') this.set({ status: 'loading', loaded: d.loaded, total: d.total });
        else if (d.type === 'loaded') {
          if (d.ok) this.set({ status: 'ready', device: d.device, error: '' }); else this.set({ status: 'error', error: d.error, key: null });
          const w = this._waitLoad; this._waitLoad = null; if (w) d.ok ? w.res(d) : w.rej(new Error(d.error));
        } else if (d.type === 'queue') this.set({ queue: d.size });
        else if (d.type === 'result') { const j = this.jobs.get(d.id); if (j) { this.jobs.delete(d.id); j(d); } }
      };
      this.worker.onerror = (e) => { this.set({ status: 'error', error: e.message || 'The speech engine stopped.' }); };
      return this.worker;
    }
    // Loads (downloading the first time) the model your settings pick. Safe to call repeatedly.
    ensure(s) {
      const model = modelId(s), key = model + '|' + s.model + '|' + s.device;
      if (this.st.key === key && (this.st.status === 'ready' || this.st.status === 'loading') && this._loadP) return this._loadP;
      this.set({ status: 'loading', key, loaded: 0, total: 0, error: '', model });
      this._loadP = new Promise((res, rej) => { this._waitLoad = { res, rej }; });
      this._loadP.catch(() => {});
      this._worker().postMessage({ type: 'load', model, preset: s.model, device: s.device === 'cpu' ? 'cpu' : 'auto' });
      return this._loadP;
    }
    transcribe(pcm, s) {
      const id = ++this.n;
      return new Promise((res) => {
        this.jobs.set(id, res);
        this.set({ queue: this.st.queue + 1 });
        this._worker().postMessage({ type: 'transcribe', id, pcm, language: s.language === 'auto' ? null : s.language, english: s.language === 'en' }, [pcm.buffer]);
      });
    }
    pending() { return this.jobs.size; }
  }

  // ---------------------------------------------------------------- capture
  class Recorder {
    constructor() { this.ctx = null; this.levels = { me: 0, them: 0 }; }
    async start({ micId = 'default', system = true, keepAudio = true, onSegment, onAudio }) {
      const ctx = this.ctx = new AudioContext({ sampleRate: SR, latencyHint: 'playback' });
      await ctx.audioWorklet.addModule('capture-worklet.js');
      const sink = ctx.createGain(); sink.gain.value = 0; sink.connect(ctx.destination);
      const mixDest = keepAudio ? ctx.createMediaStreamDestination() : null;
      this.streams = []; this.nodes = []; this.segs = {};
      const result = { mic: false, system: false, warnings: [] };
      const hook = (stream, ch) => {
        const src = ctx.createMediaStreamSource(stream);
        const node = new AudioWorkletNode(ctx, 'docket-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' });
        const seg = this.segs[ch] = new Segmenter({ onSegment: (x) => onSegment({ ...x, ch }) });
        node.port.onmessage = (e) => { const d = e.data; this.levels[ch] = d.rms; seg.push(d.pcm, d.t - this.t0); };
        src.connect(node); node.connect(sink);
        if (mixDest) src.connect(mixDest);
        this.nodes.push(node, src);
      };
      this.t0 = ctx.currentTime;
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: micId && micId !== 'default' ? { exact: micId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
        this.streams.push(mic); hook(mic, 'me'); result.mic = true;
      } catch (e) { result.warnings.push('mic:' + (e && e.name || e)); }
      if (system) {
        try {
          const disp = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: { width: 1, height: 1, frameRate: 1 } });
          disp.getVideoTracks().forEach((t) => t.stop());
          if (disp.getAudioTracks().length) { this.streams.push(disp); hook(new MediaStream(disp.getAudioTracks()), 'them'); result.system = true; }
          else result.warnings.push('system:none');
        } catch (e) { result.warnings.push('system:' + (e && e.name || e)); }
      }
      if (!result.mic && !result.system) { await this._close(); throw new Error(result.warnings.join(', ')); }
      if (mixDest) {
        const type = ['audio/webm;codecs=opus', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t));
        this.mr = new MediaRecorder(mixDest.stream, { mimeType: type, audioBitsPerSecond: 32000 });
        this.chain = Promise.resolve();
        this.mr.ondataavailable = (e) => { if (e.data && e.data.size) { const b = e.data; this.chain = this.chain.then(() => b.arrayBuffer()).then((buf) => onAudio(buf)).catch(() => {}); } };
        this.mr.start(4000);
      }
      if (ctx.state !== 'running') await ctx.resume();
      return result;
    }
    elapsed() { return this.ctx ? Math.max(0, this.ctx.currentTime - this.t0) : 0; }
    async pause() { if (this.mr && this.mr.state === 'recording') this.mr.pause(); for (const s of Object.values(this.segs)) s.flush(); await this.ctx.suspend(); }
    async resume() { await this.ctx.resume(); if (this.mr && this.mr.state === 'paused') this.mr.resume(); }
    get paused() { return this.ctx && this.ctx.state === 'suspended'; }
    async stop() {
      const dur = this.elapsed();
      for (const s of Object.values(this.segs || {})) s.flush();
      if (this.mr && this.mr.state !== 'inactive') { await new Promise((r) => { this.mr.onstop = r; this.mr.stop(); }); await this.chain; }
      await this._close();
      return dur;
    }
    async _close() {
      for (const n of this.nodes || []) { try { n.port && n.port.postMessage('stop'); n.disconnect(); } catch (_) {} }
      for (const s of this.streams || []) s.getTracks().forEach((t) => t.stop());
      try { await this.ctx.close(); } catch (_) {}
      this.ctx = null; this.mr = null;
    }
  }

  // ---------------------------------------------------------------- importing a recording
  async function decodeFile(bytes, onProgress) {
    const tmp = new OfflineAudioContext(1, SR, SR);
    const buf = await tmp.decodeAudioData(bytes.slice(0));
    onProgress && onProgress(0.05);
    let mono = buf.getChannelData(0);
    if (buf.numberOfChannels > 1) {
      const out = new Float32Array(buf.length);
      for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) out[i] += d[i] / buf.numberOfChannels; }
      mono = out;
    }
    if (buf.sampleRate !== SR) { // decodeAudioData normally resamples to the context rate already
      const off = new OfflineAudioContext(1, Math.ceil(buf.duration * SR), SR);
      const b = off.createBuffer(1, mono.length, buf.sampleRate); b.copyToChannel(mono, 0);
      const s = off.createBufferSource(); s.buffer = b; s.connect(off.destination); s.start();
      mono = (await off.startRendering()).getChannelData(0);
    }
    return { pcm: mono, duration: buf.duration };
  }
  function segmentAll(pcm) {
    const out = [];
    const seg = new Segmenter({ onSegment: (x) => out.push({ ...x, ch: 'mix' }) });
    const step = SR * 2;
    for (let i = 0; i < pcm.length; i += step) seg.push(pcm.subarray(i, Math.min(pcm.length, i + step)), i / SR);
    seg.flush();
    return out;
  }

  window.DE = { Engine, Recorder, MODELS, modelId, decodeFile, segmentAll };
})();
