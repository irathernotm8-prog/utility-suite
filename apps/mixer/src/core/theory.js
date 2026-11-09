// Mixer — music theory: note names, keys and scales, chords and progressions (letters or Roman numerals), voicings
// that move smoothly, chord and bass rhythms, and drum patterns written as text. Plain JS shared by the main process,
// the windows and the plugin (no imports).
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.MXTheory = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const FLAT_KEYS = new Set([5, 10, 3, 8, 1, 6]); // F Bb Eb Ab Db Gb (major tonics) read better with flats

  function pcOf(s) {
    const m = /^([A-Ga-g])([#♯b♭]*)/.exec(String(s).trim()); if (!m) return null;
    let p = PC[m[1].toUpperCase()]; for (const ch of m[2]) p += (ch === '#' || ch === '♯') ? 1 : -1;
    return ((p % 12) + 12) % 12;
  }
  // "C4" = 60 (middle C). Accepts numbers, "F#3", "Bb2", "c5".
  function noteToMidi(n) {
    if (typeof n === 'number' && isFinite(n)) return Math.round(n);
    const s = String(n).trim(); if (/^-?\d+(\.\d+)?$/.test(s)) return Math.round(+s);
    const m = /^([A-Ga-g][#♯b♭]*)(-?\d+)$/.exec(s); if (!m) throw new Error(`“${n}” isn’t a note. Use names like C4, F#3, Bb2 (C4 = middle C) or MIDI numbers (60 = C4).`);
    const raw = PC[m[1][0].toUpperCase()] + [...m[1].slice(1)].reduce((a, ch) => a + ((ch === '#' || ch === '♯') ? 1 : -1), 0);
    return (parseInt(m[2], 10) + 1) * 12 + raw;
  }
  function midiToName(m, flats) { const n = Math.round(m); return (flats ? FLATS : NAMES)[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1); }
  const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

  const SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], harmonic_minor: [0, 2, 3, 5, 7, 8, 11], melodic_minor: [0, 2, 3, 5, 7, 9, 11],
    dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10], locrian: [0, 1, 3, 5, 6, 8, 10],
    pentatonic_major: [0, 2, 4, 7, 9], pentatonic_minor: [0, 3, 5, 7, 10], blues: [0, 3, 5, 6, 7, 10], chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  };
  const SCALE_ALIASES = { maj: 'major', ionian: 'major', min: 'minor', m: 'minor', aeolian: 'minor', natural_minor: 'minor', harmonic: 'harmonic_minor', melodic: 'melodic_minor', pentatonic: 'pentatonic_major', 'major pentatonic': 'pentatonic_major', 'minor pentatonic': 'pentatonic_minor' };
  function parseKey(k) {
    const s = String(k || 'C major').trim();
    const m = /^([A-Ga-g][#♯b♭]?)\s*(.*)$/.exec(s); if (!m) throw new Error(`“${k}” isn’t a key. Try “A minor”, “F# major”, “D dorian”.`);
    const tonic = pcOf(m[1]); let sc = m[2].trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (!sc) sc = 'major'; if (sc === 'm') sc = 'minor';
    sc = SCALE_ALIASES[sc.replace(/_/g, ' ')] || SCALE_ALIASES[sc] || sc;
    if (!SCALES[sc]) throw new Error(`Unknown scale “${m[2]}”. Scales: ${Object.keys(SCALES).join(', ')}.`);
    const acc = m[1].slice(1); const flats = /b|♭/.test(acc) || (!/#|♯/.test(acc) && ((sc === 'major' && FLAT_KEYS.has(tonic)) || (sc !== 'major' && FLAT_KEYS.has((tonic + 3) % 12))));
    return { tonic, scale: sc, flats, name: `${(flats ? FLATS : NAMES)[tonic]} ${sc.replace(/_/g, ' ')}` };
  }
  function scaleNotes(key, lo = 48, hi = 84) { const K = typeof key === 'string' ? parseKey(key) : key; const iv = SCALES[K.scale]; const out = []; for (let m = lo; m <= hi; m++) if (iv.includes(((m - K.tonic) % 12 + 12) % 12)) out.push(m); return out; }
  function inKey(midi, key) { const K = typeof key === 'string' ? parseKey(key) : key; return SCALES[K.scale].includes(((midi - K.tonic) % 12 + 12) % 12); }
  // snap a pitch to the nearest note of the key
  function snapToKey(midi, key) { if (inKey(midi, key)) return midi; for (let d = 1; d < 6; d++) { if (inKey(midi - d, key)) return midi - d; if (inKey(midi + d, key)) return midi + d; } return midi; }

  // ───── chords
  const QUAL = {
    '': [0, 4, 7], maj: [0, 4, 7], M: [0, 4, 7], m: [0, 3, 7], min: [0, 3, 7], '-': [0, 3, 7], dim: [0, 3, 6], '°': [0, 3, 6], o: [0, 3, 6], aug: [0, 4, 8], '+': [0, 4, 8],
    sus2: [0, 2, 7], sus4: [0, 5, 7], sus: [0, 5, 7], '5': [0, 7, 12], '6': [0, 4, 7, 9], m6: [0, 3, 7, 9], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], M7: [0, 4, 7, 11], 'Δ': [0, 4, 7, 11], 'Δ7': [0, 4, 7, 11],
    m7: [0, 3, 7, 10], min7: [0, 3, 7, 10], '-7': [0, 3, 7, 10], m7b5: [0, 3, 6, 10], 'ø': [0, 3, 6, 10], 'ø7': [0, 3, 6, 10], dim7: [0, 3, 6, 9], '°7': [0, 3, 6, 9], o7: [0, 3, 6, 9], mmaj7: [0, 3, 7, 11], mM7: [0, 3, 7, 11],
    '7sus4': [0, 5, 7, 10], '9': [0, 4, 7, 10, 14], maj9: [0, 4, 7, 11, 14], m9: [0, 3, 7, 10, 14], add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14], '11': [0, 4, 7, 10, 14, 17], m11: [0, 3, 7, 10, 14, 17], '13': [0, 4, 7, 10, 14, 21], maj13: [0, 4, 7, 11, 14, 21], m13: [0, 3, 7, 10, 14, 21], '6/9': [0, 4, 7, 9, 14], '69': [0, 4, 7, 9, 14],
  };
  const ROMAN = { i: 0, ii: 1, iii: 2, iv: 3, v: 4, vi: 5, vii: 6 };
  function parseChord(tok, key) {
    const s = String(tok).trim(); if (!s) return null;
    if (/^(N\.?C\.?|-|_|rest|\.)$/i.test(s)) return { rest: true, name: 'rest' };
    let main = s, bass = null; const sl = s.lastIndexOf('/'); if (sl > 0 && !/6\/9$/.test(s)) { main = s.slice(0, sl); bass = s.slice(sl + 1); }
    let root, qual, name;
    const rm = /^([b#♭♯]?)(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)(.*)$/.exec(main);
    if (rm && key && !/^[A-G]/.test(main)) {
      const K = typeof key === 'string' ? parseKey(key) : key; const deg = ROMAN[rm[2].toLowerCase()]; const sc = SCALES[K.scale].length === 7 ? SCALES[K.scale] : SCALES.major;
      root = (K.tonic + sc[deg] + (rm[1] === 'b' || rm[1] === '♭' ? -1 : rm[1] ? 1 : 0) + 12) % 12;
      const lower = rm[2] === rm[2].toLowerCase(); let q = rm[3];
      if (/^(°|o|dim)/.test(q)) qual = QUAL[q] || QUAL[q.replace(/^(°|o|dim)/, 'dim')] || QUAL.dim;
      else if (lower) qual = QUAL['m' + q] || QUAL[q.replace(/^7/, 'm7')] || (q ? null : QUAL.m);
      else qual = QUAL[q] || null;
      if (!qual) throw new Error(`Couldn’t read the chord “${tok}”.`);
      name = (K.flats ? FLATS : NAMES)[root] + (lower && !/^(°|o|dim)/.test(q) ? 'm' : '') + q;
    } else {
      const m = /^([A-Ga-g][#♯b♭]?)(.*)$/.exec(main); if (!m) throw new Error(`Couldn’t read the chord “${tok}”. Use names like Am, F, C, G7, Dm7, Bbmaj7, or numerals like i VI III VII.`);
      root = pcOf(m[1]); qual = QUAL[m[2]] || QUAL[m[2].replace(/^min/, 'm')]; if (!qual) throw new Error(`Unknown chord type “${m[2]}” in “${tok}”.`);
      name = m[1][0].toUpperCase() + m[1].slice(1) + m[2];
    }
    const bassPc = bass ? (pcOf(bass) ?? null) : null; if (bass && bassPc == null) throw new Error(`Couldn’t read the bass note in “${tok}”.`);
    return { root, intervals: qual.slice(), bass: bassPc, name: name + (bass ? '/' + bass : '') };
  }
  // "Am F C G", "i - VI - III - VII", "Am | F | C G", "Am*2 F C" (×2 = twice as long)
  function parseProgression(text, key) {
    const out = [];
    for (const raw of String(text).replace(/[|,]/g, ' ').split(/\s+/).filter(Boolean)) {
      if (raw === '-' || raw === '–') continue;
      const mm = /^(.+?)(?:\*|x|×)(\d+(?:\.\d+)?)$/.exec(raw);
      const c = parseChord(mm ? mm[1] : raw, key); if (!c) continue; c.len = mm ? +mm[2] : 1; out.push(c);
    }
    if (!out.length) throw new Error('The progression is empty.');
    return out;
  }
  // close voicing around a centre note, each chord moving as little as possible from the last
  function voice(chord, { octave = 4, prev = null, spread = false, size = 0 } = {}) {
    if (chord.rest) return [];
    let pcs = chord.intervals.map((i) => (chord.root + i) % 12); pcs = [...new Set(pcs)];
    if (size && pcs.length > size) pcs = pcs.filter((p, i) => i === 0 || i === pcs.length - 1 || i < size - 1).slice(0, size);
    const centre = (octave + 1) * 12 + 4; // around E of that octave
    const cands = [];
    for (let inv = 0; inv < pcs.length; inv++) {
      const order = pcs.slice(inv).concat(pcs.slice(0, inv)); const notes = []; let last = -Infinity;
      for (const p of order) { let m = Math.floor((centre - 7) / 12) * 12 + p; while (m <= last) m += 12; notes.push(m); last = m; }
      for (const shift of [-12, 0, 12]) cands.push(notes.map((n) => n + shift));
    }
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    let best = null, bs = Infinity;
    for (const c of cands) {
      let sc = Math.abs(mean(c) - centre) * (prev ? 0.35 : 1);
      if (prev && prev.length) sc += c.reduce((a, n) => a + Math.min(...prev.map((p) => Math.abs(p - n))), 0) / c.length;
      if (c[0] < 40) sc += 6; if (c[c.length - 1] > 88) sc += 6;
      if (sc < bs) { bs = sc; best = c; }
    }
    if (spread && best.length >= 3) best = [best[0] - 12, ...best.slice(1)];
    return best;
  }
  function bassNote(chord, octave = 2) { if (chord.rest) return null; const pc = chord.bass != null ? chord.bass : chord.root; return (octave + 1) * 12 + pc; }

  // chord rhythms: [startBeat, lengthBeats, which] where which = 'all' | index into the voicing | 'bass' | 'oct'
  const RHYTHMS = {
    block: { desc: 'One chord held for its whole length', make: (L) => [[0, L, 'all']] },
    half: { desc: 'Chord hit every 2 beats', make: (L) => steps(L, 2, 1.9, 'all') },
    quarters: { desc: 'Chord on every beat', make: (L) => steps(L, 1, 0.85, 'all') },
    pulse8: { desc: 'Chord on every 8th note', make: (L) => steps(L, 0.5, 0.42, 'all') },
    offbeat: { desc: 'Chord on the “and” of each beat (house, reggae, ska)', make: (L) => steps(L, 1, 0.4, 'all', 0.5) },
    stabs: { desc: 'Syncopated stabs: 1, the “and” of 2, 4', make: (L) => tile(L, 4, [[0, 0.45], [1.5, 0.45], [3, 0.45]], 'all') },
    charleston: { desc: 'Beat 1 and the “and” of 2', make: (L) => tile(L, 4, [[0, 1.2], [1.5, 2.3]], 'all') },
    'arp-up': { desc: '16th-note arpeggio going up', make: (L, n) => arp(L, n, 0.25, 'up') },
    'arp-down': { desc: '16th-note arpeggio going down', make: (L, n) => arp(L, n, 0.25, 'down') },
    'arp-updown': { desc: '16th-note arpeggio up then down', make: (L, n) => arp(L, n, 0.25, 'updown') },
    'arp8': { desc: '8th-note arpeggio going up', make: (L, n) => arp(L, n, 0.5, 'up') },
    broken: { desc: 'Bass note then the rest of the chord (piano ballad)', make: (L, n) => { const o = []; for (let b = 0; b < L; b += 2) { o.push([b, 2, 0]); for (let i = 1; i < n; i++) o.push([b + 0.5 * i, 2 - 0.5 * i, i]); } return clip(o, L); } },
    strum: { desc: 'Strummed: notes 30 ms apart, down-up feel', make: (L, n) => { const o = []; for (let b = 0; b < L; b += 1) for (let i = 0; i < n; i++) { const idx = b % 2 ? n - 1 - i : i; o.push([b + i * 0.06, 0.9 - i * 0.06, idx]); } return clip(o, L); } },
    // bass
    'bass-root': { bass: true, desc: 'Root held for the whole chord', make: (L) => [[0, L, 'bass']] },
    'bass-pulse': { bass: true, desc: 'Root on every 8th note', make: (L) => steps(L, 0.5, 0.45, 'bass') },
    'bass-octaves': { bass: true, desc: 'Root and the octave above, alternating 8ths (disco)', make: (L) => steps(L, 0.5, 0.45, 'bass').map((x, i) => [x[0], x[1], i % 2 ? 'oct' : 'bass']) },
    'bass-sync': { bass: true, desc: 'Syncopated: 1, the “and” of 2, 4', make: (L) => tile(L, 4, [[0, 1.2], [1.5, 1.2], [3, 0.8]], 'bass') },
    'bass-walk': { bass: true, desc: 'Walking: root, 3rd, 5th, then a step toward the next chord', make: (L) => tile(L, 4, [[0, 0.95], [1, 0.95], [2, 0.95], [3, 0.95]], 'walk') },
    'bass-808': { bass: true, desc: 'Long 808 notes with a pickup before the next chord', make: (L) => (L >= 2 ? [[0, L - 0.75, 'bass'], [L - 0.5, 0.45, 'bass']] : [[0, L, 'bass']]) },
  };
  function steps(L, every, len, which, off = 0) { const o = []; for (let b = off; b < L - 1e-6; b += every) o.push([b, Math.min(len, L - b), which]); return o; }
  function tile(L, period, pat, which) { const o = []; for (let s = 0; s < L - 1e-6; s += period) for (const [t, d] of pat) if (s + t < L - 1e-6) o.push([s + t, Math.min(d, L - s - t), which]); return o; }
  function clip(o, L) { return o.filter((x) => x[0] < L - 1e-6).map((x) => [x[0], Math.min(x[1], L - x[0]), x[2]]); }
  function arp(L, n, every, dir) { const seq = dir === 'down' ? [...Array(n).keys()].reverse() : dir === 'updown' ? [...Array(n).keys(), ...[...Array(Math.max(0, n - 2)).keys()].map((i) => n - 2 - i)] : [...Array(n).keys()]; const o = []; let k = 0; for (let b = 0; b < L - 1e-6; b += every) o.push([b, every * 0.9, seq[k++ % seq.length]]); return o; }

  // a progression → notes [{p, t, d, v}] (t in beats from the start)
  function chordNotes(text, key, { beatsPerChord = 4, rhythm = 'block', octave = null, velocity = 0.8, spread = false, size = 0, humanize = 0 } = {}) {
    const R = RHYTHMS[rhythm]; if (!R) throw new Error(`Unknown rhythm “${rhythm}”. Rhythms: ${Object.keys(RHYTHMS).join(', ')}.`);
    const chords = parseProgression(text, key); const notes = []; let t = 0, prev = null; const K = key ? parseKey(key) : null;
    for (let ci = 0; ci < chords.length; ci++) {
      const c = chords[ci]; const L = beatsPerChord * c.len;
      if (!c.rest) {
        const v = R.bass ? null : voice(c, { octave: octave ?? 4, prev, spread, size }); if (v) prev = v;
        const b = bassNote(c, octave ?? 2); const next = chords[ci + 1] && !chords[ci + 1].rest ? bassNote(chords[ci + 1], octave ?? 2) : b;
        for (const [st, d, which] of R.make(L, v ? v.length : 3)) {
          let ps;
          if (which === 'all') ps = v; else if (which === 'bass') ps = [b]; else if (which === 'oct') ps = [b + 12];
          else if (which === 'walk') { const beat = Math.round(st % 4); const third = b + (c.intervals.includes(3) ? 3 : 4); ps = [beat === 0 ? b : beat === 1 ? third : beat === 2 ? b + 7 : (next > b ? next - 1 : next + (K && inKey(next + 2, K) ? 2 : 1))]; }
          else ps = [v[Math.min(which, v.length - 1)]];
          for (const p of ps) { const j = humanize ? (Math.random() - 0.5) * humanize : 0; notes.push({ p, t: +(t + st + j * 0.02).toFixed(4), d: +d.toFixed(4), v: Math.max(0.05, Math.min(1, velocity + j * 0.08)) }); }
        }
      }
      t += L;
    }
    return { notes, length: t, chords: chords.map((c) => c.name) };
  }

  // ───── drum patterns as text: "x...x...x...x..." (x hit, X accent, o soft, . or - rest; | and spaces ignored)
  const DRUM_VOICES = ['kick', 'snare', 'clap', 'rim', 'hat', 'openhat', 'tom_low', 'tom_mid', 'tom_high', 'crash', 'ride', 'shaker', 'cowbell', 'perc', 'snap', 'riser', 'downlifter', 'impact'];
  const VOICE_ALIASES = { bd: 'kick', kik: 'kick', bass: 'kick', sd: 'snare', snr: 'snare', cp: 'clap', clp: 'clap', hh: 'hat', hihat: 'hat', ch: 'hat', closedhat: 'hat', hats: 'hat', oh: 'openhat', open: 'openhat', ohat: 'openhat', tom: 'tom_mid', lt: 'tom_low', mt: 'tom_mid', ht: 'tom_high', cy: 'crash', cym: 'crash', rd: 'ride', rimshot: 'rim', rs: 'rim', sh: 'shaker', cb: 'cowbell', fx: 'impact' };
  const voiceName = (v) => { const k = String(v).toLowerCase().replace(/[\s-]+/g, '_'); return DRUM_VOICES.includes(k) ? k : VOICE_ALIASES[k] || null; };
  function parsePattern(str, { stepsPerBar = 16, beatsPerBar = 4 } = {}) {
    const s = String(str).replace(/[|\s]/g, ''); const hits = []; const stepBeats = beatsPerBar / stepsPerBar;
    for (let i = 0; i < s.length; i++) { const ch = s[i]; const v = ch === 'X' ? 1 : ch === 'x' ? 0.85 : ch === 'o' || ch === 'O' ? 0.55 : ch === 'g' ? 0.3 : (ch >= '1' && ch <= '9') ? +ch / 9 : 0; if (v) hits.push({ t: +(i * stepBeats).toFixed(4), v }); else if (!'.-_0'.includes(ch)) throw new Error(`Unexpected “${ch}” in drum pattern “${str}”. Use x (hit), X (accent), o (soft), g (ghost), 1–9 (velocity) and . (rest).`); }
    return { hits, beats: s.length * stepBeats };
  }
  // ready-made grooves, 1 bar of 16 steps (or 2 bars where marked)
  const GROOVES = {
    'four-on-floor': { desc: 'Kick every beat, clap on 2 and 4, off-beat open hats (house, disco, techno)', p: { kick: 'x...x...x...x...', clap: '....x.......x...', hat: 'o...o...o...o...', openhat: '..x...x...x...x.' } },
    house: { desc: 'Classic house: kick, clap, shuffled hats, off-beat open hat', p: { kick: 'x...x...x...x...', clap: '....x.......x...', hat: 'o.oxo.oxo.oxo.ox', openhat: '..x...x...x...x.', shaker: 'gogogogogogogogo' } },
    techno: { desc: 'Driving techno: solid kick, rumble, rim and 16th hats', p: { kick: 'X...X...X...X...', rim: '...x.....x.x....', hat: 'oxoxoxoxoxoxoxox', openhat: '..o...o...o...o.', clap: '....x.......x...' } },
    'boom-bap': { desc: 'Hip-hop boom bap: lazy kick, hard snare on 2 and 4, swung 8th hats', p: { kick: 'x.......x.x.....', snare: '....X.......X...', hat: 'x.o.x.o.x.o.x.o.' }, swing: 0.56 },
    trap: { desc: 'Trap: sparse kick, snare/clap on 3, rolling hats with triplet-ish rolls (2 bars)', steps: 32, p: { kick: 'x......x..x.....x.......x.x.....', clap: '........X...............X.......', hat: 'x.x.x.x.x.xxx.x.x.x.x.x.xxxxx.x.', openhat: '..............x...............x.' } },
    rock: { desc: 'Straight rock beat', p: { kick: 'x.......x.x.....', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.', crash: 'x...............' } },
    pop: { desc: 'Modern pop: kick on 1 and 3 with pickups, clap on 2 and 4, 8th hats', p: { kick: 'x......xx.......', clap: '....x.......x...', snare: '....o.......o...', hat: 'x.o.x.o.x.o.x.o.' } },
    halftime: { desc: 'Half-time: snare on beat 3, big and slow', p: { kick: 'x.........x.....', snare: '........X.......', hat: 'x.o.x.o.x.o.x.o.' } },
    dnb: { desc: 'Drum & bass two-step (play at 170+ BPM)', p: { kick: 'x.........x.....', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.', ride: '..o...o...o...o.' } },
    lofi: { desc: 'Lo-fi hip hop: dusty kick, rim, swung hats', p: { kick: 'x......x..x.....', snare: '....x.......x...', rim: '..........o.....', hat: 'o.go.goo.go.go.g' }, swing: 0.6 },
    reggaeton: { desc: 'Dembow: kick on every beat, snare on 4-and/2-and', p: { kick: 'x...x...x...x...', snare: '...x..x....x..x.', hat: 'x.x.x.x.x.x.x.x.' } },
    afrobeats: { desc: 'Afrobeats: syncopated kick, rim pattern and shaker', p: { kick: 'x..x..x...x..x..', rim: '..x..x....x..x..', shaker: 'xoxoxoxoxoxoxoxo', clap: '....x.......x...' } },
    funk: { desc: 'Funk: syncopated kick, ghost snares, 16th hats', p: { kick: 'x.x....x..x.....', snare: '..g.X.g..g..X..g', hat: 'xoxoxoxoxoxoxoxo' } },
    breakbeat: { desc: 'Breakbeat (amen-flavoured)', p: { kick: 'x.x.......xx....', snare: '....x..x.x..x..x', hat: 'x.x.x.x.x.x.x.x.' } },
  };
  // swing: 0.5 = straight, 0.66 = triplet feel. Delays every off 16th (or 8th if grid=8).
  function swingTime(t, amount, grid = 0.25) { if (!amount || amount === 0.5) return t; const pair = grid * 2; const k = Math.floor(t / pair + 1e-6); const r = t - k * pair; if (Math.abs(r - grid) < 1e-4) return +(k * pair + pair * amount).toFixed(4); return t; }

  return { NAMES, FLATS, SCALES, QUAL, RHYTHMS, GROOVES, DRUM_VOICES, pcOf, noteToMidi, midiToName, midiToFreq, parseKey, scaleNotes, inKey, snapToKey, parseChord, parseProgression, voice, bassNote, chordNotes, parsePattern, voiceName, swingTime };
});
