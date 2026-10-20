// Subtitle and chapter text formats: SRT / WebVTT read+write, YouTube chapters, FFmpeg chapter metadata.
//
// cue    = { start, end, text }   seconds; text may contain \n. VTT cue settings are kept as `settings`.
// marker = { time, name }          seconds (as in the video project's markers lane).
//
// UMD: no require() calls, so the renderer can load this with a plain <script> tag.
const Captions = (() => {
  'use strict';

  // ---------- timestamps ----------

  // [hh:]mm:ss[.,]mmm — hours optional (VTT), ',' or '.' before the milliseconds, fraction optional.
  const TIME = '(?:(\\d+):)?(\\d{1,2}):(\\d{1,2})(?:[.,](\\d{1,3}))?';
  const TIMING = new RegExp(`^\\s*${TIME}\\s*-->\\s*${TIME}(.*)$`);

  const toSec = (h, m, s, ms) => (+h || 0) * 3600 + +m * 60 + +s + (ms ? +ms.padEnd(3, '0') / 1000 : 0);
  const p2 = n => String(n).padStart(2, '0');

  /** 3723.5 → '01:02:03,500' (sep ',' for SRT, '.' for VTT). */
  function clock(sec, sep) {
    const ms = Math.max(0, Math.round((Number(sec) || 0) * 1000));
    const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
    return `${p2(h)}:${p2(m)}:${p2(s)}${sep}${String(ms % 1000).padStart(3, '0')}`;
  }

  /** Parses an 'a --> b [settings]' line, or null. */
  function timing(line) {
    const t = TIMING.exec(line);
    if (!t) return null;
    return { start: toSec(t[1], t[2], t[3], t[4]), end: toSec(t[5], t[6], t[7], t[8]), settings: t[9].trim() };
  }

  // ---------- text cleanup ----------

  /** Strips VTT voice/class/timestamp/ruby tags (keeping their text); <i> <b> <u> and others stay. */
  function cleanText(text) {
    return text
      .replace(/<\/?(?:v|c|lang|ruby|rt)(?:[.\s][^>]*)?>/gi, '')
      .replace(/<\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3}>/g, '')
      .replace(/&nbsp;/g, ' ');
  }

  /** Normalises line endings / BOM and splits into blocks of non-blank lines. */
  function blocks(text) {
    const lines = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let cur = [];
    for (const l of lines) {
      if (l.trim() === '') { if (cur.length) out.push(cur); cur = []; } else cur.push(l);
    }
    if (cur.length) out.push(cur);
    return out;
  }

  /**
   * Cues from one block. Tolerates a missing index line, and several cues run together without a blank
   * line between them (a bare number right before a timing line is treated as that cue's index).
   */
  function cuesOfBlock(lines) {
    const cues = [];
    let cur = null;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].includes('-->') ? timing(lines[i]) : null;
      if (t) {
        if (cur) {
          // A trailing bare number belonged to this new cue as its index.
          if (cur.lines.length && /^\s*\d+\s*$/.test(cur.lines[cur.lines.length - 1])) cur.lines.pop();
          cues.push(cur);
        }
        cur = { ...t, lines: [] };
      } else if (cur) cur.lines.push(lines[i].replace(/\s+$/, ''));
      // Lines before the first timing line (index / VTT cue identifier) are dropped.
    }
    if (cur) cues.push(cur);
    return cues;
  }

  /** Validates, cleans and sorts raw cues. Malformed ones are skipped, never thrown. */
  function finish(raw, keepSettings) {
    const out = [];
    for (const c of raw) {
      if (!(c.end > c.start) || !isFinite(c.start) || !isFinite(c.end)) continue;
      const text = cleanText(c.lines.join('\n')).trim();
      const cue = { start: c.start, end: c.end, text };
      if (keepSettings && c.settings) cue.settings = c.settings;
      out.push(cue);
    }
    return out.map((c, i) => [c, i]).sort((a, b) => a[0].start - b[0].start || a[1] - b[1]).map(x => x[0]);
  }

  // ---------- parsers ----------

  function parseSRT(text) {
    const raw = [];
    for (const b of blocks(text)) raw.push(...cuesOfBlock(b));
    return finish(raw, false);
  }

  function parseVTT(text) {
    const raw = [];
    let first = true, seenCue = false;
    for (const b of blocks(text)) {
      const head = b[0].trim();
      if (first && /^WEBVTT(?:[ \t]|$)/.test(head)) { first = false; continue; }   // signature + header
      first = false;
      if (!head.includes('-->') && /^NOTE(?:[ \t]|$)/.test(head)) continue;
      if (!seenCue && !head.includes('-->') && /^(?:STYLE|REGION)$/.test(head)) continue;
      const cues = cuesOfBlock(b);
      if (cues.length) seenCue = true;
      raw.push(...cues);
    }
    return finish(raw, true);
  }

  /** Auto-detects VTT (signature or .vtt name) vs SRT. */
  function parse(text, nameHint) {
    const t = String(text || '').replace(/^﻿/, '');
    const vtt = /\.vtt$/i.test(nameHint || '') || /^\s*WEBVTT/.test(t);
    return vtt ? parseVTT(t) : parseSRT(t);
  }

  // ---------- writers ----------

  /** Cue text safe inside one block: no blank lines (they end the cue) and no '-->'. */
  const safeText = t => String(t ?? '').replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim()).join('\n').replace(/-->/g, '->');

  const sorted = cues => (cues || []).filter(c => c && c.end > c.start).slice().sort((a, b) => a.start - b.start);

  function toSRT(cues) {
    return sorted(cues).map((c, i) => `${i + 1}\n${clock(c.start, ',')} --> ${clock(c.end, ',')}\n${safeText(c.text)}\n`).join('\n');
  }

  function toVTT(cues) {
    const body = sorted(cues).map(c => `${clock(c.start, '.')} --> ${clock(c.end, '.')}${c.settings ? ' ' + c.settings : ''}\n${safeText(c.text)}\n`);
    return 'WEBVTT\n\n' + body.join('\n');
  }

  // ---------- chapters ----------

  const MIN_CHAPTER = 10;   // YouTube's minimum chapter length (seconds)

  /** Sorted, de-duplicated markers inside [0, duration). */
  function cleanMarkers(markers, duration, keepNewlines) {
    const end = Number(duration) > 0 ? Number(duration) : Infinity;
    const list = (markers || [])
      .map(m => ({ time: Math.max(0, Number(m.time) || 0), name: String(m.name ?? '').replace(/\r\n?/g, '\n').replace(/\s*\n+\s*/g, keepNewlines ? '\n' : ' ').trim() }))
      .filter(m => m.time < end)
      .sort((a, b) => a.time - b.time);
    return list.filter((m, i) => i === 0 || m.time - list[i - 1].time >= 0.001);
  }

  /** 75 → '1:15'; 3675 → '1:01:15'. */
  function ytTime(sec, long) {
    const s = Math.floor(sec), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = p2(s % 60);
    return long ? `${h}:${p2(m)}:${ss}` : `${Math.floor(s / 60)}:${ss}`;
  }

  /**
   * YouTube description chapters. The first chapter must start at 0:00 and each must last ≥10 s, so a
   * marker in the first 10 s is moved to 0:00 (else an "Intro" chapter is inserted) and short chapters
   * are merged into the one before them. Returns { text, warnings, chapters }.
   */
  function toChapters(markers, duration) {
    const warnings = [];
    const dur = Number(duration) > 0 ? Number(duration) : null;
    let ch = cleanMarkers(markers, dur);
    ch.forEach((c, i) => { if (!c.name) c.name = `Chapter ${i + 1}`; });
    if (!ch.length || ch[0].time > 0) {
      if (ch.length && ch[0].time < MIN_CHAPTER) {
        if (ch[0].time > 0) warnings.push(`"${ch[0].name}" moved to 0:00 (YouTube chapters must start at 0:00)`);
        ch[0].time = 0;
      } else {
        ch.unshift({ time: 0, name: 'Intro' });
        if (ch.length > 1) warnings.push('Added an "Intro" chapter at 0:00 (YouTube chapters must start at 0:00)');
      }
    }
    // Merge chapters shorter than the minimum into the previous one (the first absorbs the second instead).
    const lenOf = i => (i + 1 < ch.length ? ch[i + 1].time : (dur ?? Infinity)) - ch[i].time;
    for (let i = 0; i < ch.length && ch.length > 1;) {
      if (lenOf(i) >= MIN_CHAPTER) { i++; continue; }
      const drop = i === 0 ? 1 : i;
      warnings.push(`"${ch[drop].name}" at ${ytTime(ch[drop].time, false)} merged into "${ch[drop - 1].name}" (chapters must be at least ${MIN_CHAPTER} s)`);
      ch.splice(drop, 1);
      if (drop === i && i > 0) i--;   // re-check the chapter that just grew
    }
    if (ch.length < 3) warnings.push(`YouTube needs at least 3 chapters (have ${ch.length}); chapters won't show until more markers are added`);
    const long = (dur ?? ch[ch.length - 1].time) >= 3600;
    return { text: ch.map(c => `${ytTime(c.time, long)} ${c.name}`).join('\n'), warnings, chapters: ch };
  }

  /** FFMETADATA1 value escaping: '=', ';', '#', '\' and newlines get a backslash. */
  const ffEscape = s => String(s ?? '').replace(/[=;#\\\n]/g, c => '\\' + c);

  /** FFmpeg metadata file with one [CHAPTER] per marker (ends at the next marker / duration). */
  function toFFMetadata(markers, duration) {
    const ch = cleanMarkers(markers, duration, true);
    const endMs = Number(duration) > 0 ? Math.round(duration * 1000) : null;
    let out = ';FFMETADATA1\n';
    ch.forEach((c, i) => {
      const start = Math.round(c.time * 1000);
      const end = i + 1 < ch.length ? Math.round(ch[i + 1].time * 1000) : (endMs ?? start + 1000);
      if (end <= start) return;
      out += `\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=${start}\nEND=${end}\ntitle=${ffEscape(c.name || `Chapter ${i + 1}`)}\n`;
    });
    return out;
  }

  return { parseSRT, parseVTT, parse, toSRT, toVTT, toChapters, toFFMetadata, clock };
})();
if (typeof module !== 'undefined') module.exports = Captions;
