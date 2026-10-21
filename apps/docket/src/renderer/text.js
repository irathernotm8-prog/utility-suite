// Docket — audio segmenting and transcript clean-up. No DOM; also loaded by the Node tests.
(function (root) {
  'use strict';
  const SR = 16000;

  // ---------------------------------------------------------------- voice activity → segments
  // Cuts a stream into speech segments Whisper can read (≤ ~25 s), at pauses where possible.
  class Segmenter {
    constructor({ sampleRate = SR, onSegment, maxLen = 24, endSilence = 0.75, minSpeech = 0.3, minThresh = 0.0055 } = {}) {
      Object.assign(this, { sr: sampleRate, onSegment, maxLen, endSilence, minSpeech, minThresh });
      this.frame = Math.round(this.sr * 0.03);
      this.pending = new Float32Array(0);
      this.floor = 0.004;
      this.pre = [];
      this.active = false;
      this.t = null; // time (s) of the next frame
    }
    push(pcm, t) {
      if (this.t === null || (t !== undefined && Math.abs(t - this.t) > 0.5)) this.t = t !== undefined ? t : (this.t || 0);
      let data = pcm;
      if (this.pending.length) { data = new Float32Array(this.pending.length + pcm.length); data.set(this.pending); data.set(pcm, this.pending.length); }
      let i = 0;
      for (; i + this.frame <= data.length; i += this.frame) this._frame(data.subarray(i, i + this.frame));
      this.pending = data.slice(i);
    }
    _frame(f) {
      let s = 0; for (let k = 0; k < f.length; k++) s += f[k] * f[k];
      const rms = Math.sqrt(s / f.length);
      // Noise floor: follows quiet quickly, loud slowly.
      this.floor = rms < this.floor ? this.floor * 0.9 + rms * 0.1 : this.floor * 0.9995 + rms * 0.0005;
      const speech = rms > Math.max(this.minThresh, this.floor * 3);
      const t = this.t; this.t += f.length / this.sr;
      const copy = f.slice();
      if (!this.active) {
        this.pre.push({ f: copy, t }); if (this.pre.length > 10) this.pre.shift();
        if (speech) {
          this.active = true; this.chunks = this.pre.map((x) => x.f); this.start = this.pre.length ? this.pre[0].t : t;
          this.lastSpeech = t; this.speech = 1; this.energy = rms; this.pre = [];
        }
        return;
      }
      this.chunks.push(copy);
      if (speech) { this.lastSpeech = t; this.speech++; this.energy += rms; }
      const dur = this.t - this.start, silence = this.t - this.lastSpeech;
      const need = dur > 14 ? 0.35 : this.endSilence;
      if ((silence >= need && dur >= 1) || dur >= this.maxLen) this._emit();
      else if (silence >= need && this.speech * 0.03 < this.minSpeech) this._reset();
    }
    _reset() { this.active = false; this.chunks = null; this.pre = []; }
    _emit() {
      const speechSec = this.speech * 0.03;
      if (speechSec >= this.minSpeech) {
        const len = this.chunks.reduce((n, c) => n + c.length, 0);
        const pcm = new Float32Array(len); let o = 0;
        for (const c of this.chunks) { pcm.set(c, o); o += c.length; }
        this.onSegment && this.onSegment({ t0: round(this.start), t1: round(this.t), pcm, speech: round(speechSec), energy: this.energy / Math.max(1, this.speech) });
      }
      this._reset();
    }
    flush() { if (this.active) this._emit(); }
  }
  const round = (x) => Math.round(x * 100) / 100;

  // ---------------------------------------------------------------- cleaning what Whisper returns
  const NOISE = /^[\s.]*(?:\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|♪+[^♪]*♪*)[\s.]*$/;
  const FAKE = /^(?:you|thanks for watching[.!]*|thank you for watching[.!]*|please subscribe.*|subtitles? by.*|transcribed by.*|captions? by.*|www\.\S+|\.+)$/i;
  function cleanText(text, seg = {}) {
    let s = String(text || '').replace(/\[(?:BLANK_AUDIO|MUSIC|NOISE|INAUDIBLE|SILENCE)[^\]]*\]/gi, ' ').replace(/\s+/g, ' ').trim();
    if (!s || NOISE.test(s) || FAKE.test(s)) return '';
    if (/^(?:thank you|thanks)[.!]*$/i.test(s) && (seg.speech || 0) < 0.8) return '';
    // Collapse loops like "I mean, I mean, I mean, I mean"
    s = s.replace(/\b((?:\S+\s+){0,5}?\S+?)([,.]?\s+\1\b){3,}/gi, '$1');
    return s.trim();
  }

  // ---------------------------------------------------------------- echo: the mic hearing the speakers
  const words = (s) => (String(s).toLowerCase().match(/[a-z0-9']{2,}/g) || []);
  function similarity(a, b) {
    const A = words(a), B = new Set(words(b));
    if (A.length < 3 || B.size < 3) return 0;
    let hit = 0; for (const w of new Set(A)) if (B.has(w)) hit++;
    return hit / Math.min(new Set(A).size, B.size);
  }
  function charSim(a, b) { // 1 - edit distance / length, on letters only
    a = String(a).toLowerCase().replace(/[^a-z0-9]/g, ''); b = String(b).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!a || !b) return 0;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return 1 - prev[b.length] / Math.max(a.length, b.length);
  }
  // Long lines: shared words around the same time. Short ones ("Ask not!", "Yeah"): nearly the same letters at nearly the same moment.
  function isEcho(a, b) {
    const near = a.t0 < b.t1 + 2.5 && b.t0 < a.t1 + 2.5;
    if (!near) return false;
    if (words(a.text).length >= 3 && words(b.text).length >= 3) return similarity(a.text, b.text) >= 0.6;
    return Math.abs(a.t0 - b.t0) < 0.9 && Math.abs(a.t1 - b.t1) < 0.9 && charSim(a.text, b.text) >= 0.6;
  }
  // Adds a segment in time order. A "me" line that repeats a "them" line said at the same moment is speaker echo and is dropped.
  function addSegment(list, seg) {
    if (seg.ch === 'me' && list.some((x) => x.ch === 'them' && isEcho(seg, x))) return list;
    let out = list;
    if (seg.ch === 'them') out = list.filter((x) => !(x.ch === 'me' && isEcho(x, seg)));
    out = out.concat([seg]).sort((a, b) => a.t0 - b.t0 || (a.ch < b.ch ? -1 : 1));
    return out;
  }

  // ---------------------------------------------------------------- to-dos without AI
  const DAYS = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday';
  const DUE = new RegExp(`\\b(today|tonight|tomorrow|this (?:week|afternoon|morning|evening)|next (?:week|month|${DAYS})|(?:by|on|before) (?:${DAYS}|tomorrow|the end of (?:the )?(?:day|week|month)|end of (?:the )?(?:day|week|month)|eod|eow|next week)|(?:${DAYS}))\\b`, 'i');
  const RULES = [
    { re: /\b(?:i'll|i will|i'm going to|i am going to|i can|let me)\s+(?!be\b|say\b|think\b|guess\b|tell you\b|see\b|try to remember\b|just say\b)(.{6,140})/i, who: 'self' },
    { re: /\b(?:can you|could you|would you mind|would you|please)\s+(.{6,140})/i, who: 'other' },
    { re: /\b(?:action items?|to-?do|follow[- ]?up(?: on)?|next steps?(?: (?:is|are))?)\b[:,]?\s*(.{6,160})/i, who: 'none' },
    { re: /\b(?:we need to|we have to|we should|we'll|we will|let's make sure (?:we|to)|let's)\s+(?!see\b|talk\b|go\b|move on\b|start\b|get started\b|do this\b|wrap up\b|begin\b)(.{6,140})/i, who: 'none' }
  ];
  function tidyTask(s) {
    s = s.replace(/^(?:also|just|go ahead and|maybe|please|definitely|probably)\s+/i, '').replace(/[\s,;:.!-]+$/, '').replace(/\s+(?:okay|ok|alright|right|yeah|so)\s*$/i, '');
    s = s.replace(/\?$/, '');
    if (s.length < 6) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function suggestTodos(segments, { me = 'Me', them = 'Them' } = {}) {
    const out = [], seen = new Set();
    for (const seg of segments || []) {
      const sentences = String(seg.text || '').split(/(?<=[.!?])\s+/);
      for (const sent of sentences) {
        for (const r of RULES) {
          const m = sent.match(r.re);
          if (!m) continue;
          const task = tidyTask(m[1]);
          if (!task || words(task).length < 2) break;
          const key = words(task).slice(0, 6).join(' ');
          if (seen.has(key)) break; seen.add(key);
          let owner = '';
          if (r.who === 'self') owner = seg.ch === 'me' ? me : seg.ch === 'them' ? them : '';
          if (r.who === 'other') owner = seg.ch === 'me' ? them : seg.ch === 'them' ? me : '';
          const due = (sent.match(DUE) || [])[1] || '';
          out.push({ text: task.replace(DUE, '').replace(/\s{2,}/g, ' ').replace(/[\s,;:.!]+$/, '').replace(/\s+(?:by|on|before)$/i, '').trim() || task, owner, due, t: seg.t0, source: 'suggested' });
          break;
        }
        if (out.length >= 20) return out;
      }
    }
    return out;
  }

  const clock = (sec) => {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(s).padStart(2, '0');
  };

  const api = { Segmenter, cleanText, similarity, addSegment, suggestTodos, clock, SR };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.DT = api;
})(typeof self !== 'undefined' ? self : this);
