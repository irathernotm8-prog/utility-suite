// Exports a video-editor render project to other NLEs: CMX3600 EDL, FCPXML 1.9 and OpenTimelineIO.
//
// project = {
//   name, settings: { width, height, fps },
//   clips:    [{ path, name, kind:'video'|'image', in, out, speed, volume, muted, hasAudio, sourceDuration, transition:{type,duration} }],
//   overlays: [{ path, name, kind:'video'|'image'|'title', start, in, out, x, y, scale, opacity, text }],
//   audio:    [{ path, name, start, in, out, volume }],
//   markers:  [{ time, name, color }],
// }
// All times are seconds; everything is snapped to whole frames of settings.fps before writing.
// Format logic ported from FilmCraft's interchange crate (edl.rs, fcpxml.rs, otio.rs), MIT/Apache-2.0.
const path = require('path');
const { pathToFileURL } = require('url');

// ---------- frame rates & time ----------

const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a || 1; };
const p2 = n => String(n).padStart(2, '0');

/** Exact rate as num/den fps (one frame = den/num s) plus the nominal timecode base (30 for 29.97). */
function rateOf(fps) {
  fps = Number(fps) > 0 ? Number(fps) : 30;
  const ntsc = [23.976, 29.97, 47.952, 59.94, 119.88].find(r => Math.abs(fps - r) < 0.01);
  if (ntsc) { const nominal = Math.round(ntsc * 1.001); return { fps: nominal * 1000 / 1001, num: nominal * 1000, den: 1001, nominal, ntsc: true }; }
  if (Number.isInteger(fps)) return { fps, num: fps, den: 1, nominal: fps, ntsc: false };
  const n = Math.round(fps * 1000), g = gcd(n, 1000);
  return { fps: n / 1000, num: n / g, den: 1000 / g, nominal: Math.round(fps), ntsc: false };
}
const toFrames = (sec, R) => Math.round((Number(sec) || 0) * R.num / R.den);

/** Frames (may be fractional) → exact FCPXML rational time, e.g. '1001/30000s'. */
function ratTime(frames, R) {
  const scale = Number.isInteger(frames) ? 1 : 1000;
  let n = Math.round(frames * scale) * R.den, d = R.num * scale;
  if (n === 0) return '0s';
  const g = gcd(n, d); n /= g; d /= g;
  return d === 1 ? `${n}s` : `${n}/${d}s`;
}

/** Frames per drop (2 at 29.97, 4 at 59.94) when drop-frame timecode applies, else 0. */
const dropOf = (R, df) => (df && R.ntsc && (R.nominal === 30 || R.nominal === 60) ? R.nominal / 15 : 0);

/** Frame count → 'hh:mm:ss:ff' (or 'hh:mm:ss;ff' drop-frame) counted at the nominal rate. */
function timecode(frames, R, df) {
  const fb = R.nominal, drop = dropOf(R, df);
  let f = Math.max(0, Math.round(frames));
  if (drop) {
    const per10 = fb * 600 - drop * 9, perMin = fb * 60 - drop;
    const d = Math.floor(f / per10), m = f % per10;
    f += drop * 9 * d + (m > drop ? drop * Math.floor((m - drop) / perMin) : 0);
  }
  const ff = f % fb, s = Math.floor(f / fb) % 60, mi = Math.floor(f / (fb * 60)) % 60, h = Math.floor(f / (fb * 3600)) % 24;
  return `${p2(h)}:${p2(mi)}:${p2(s)}${drop ? ';' : ':'}${p2(ff)}`;
}

// ---------- project helpers (same rules as timeline.js) ----------

const speedOf = c => (c.kind === 'image' ? 1 : Math.min(8, Math.max(0.1, Number(c.speed) || 1)));
const clipLen = c => Math.max(0, (Number(c.out) || 0) - (Number(c.in) || 0)) / speedOf(c);
const hasTransition = c => !!(c.transition && c.transition.type && c.transition.type !== 'none');
/** Transition length between prev and next, clamped exactly like timeline.js. */
function transitionSeconds(prev, next, accDur) {
  if (!hasTransition(prev)) return 0;
  return Math.max(0.1, Math.min(prev.transition.duration || 1, accDur - 0.1, clipLen(next) - 0.1));
}
const nameOf = c => c.name || (c.path ? path.basename(c.path) : c.kind === 'title' ? 'Title' : 'Clip');
const fileUrl = p => { try { return pathToFileURL(path.resolve(p)).href; } catch { return String(p); } };
const xmlEsc = s => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const dB = v => (v > 0 ? `${(20 * Math.log10(v)).toFixed(2)}dB` : '-96dB');

/**
 * Lays the magnetic main track out in whole frames.
 * Each entry: startF/lenF on the timeline, srcF (source in), speed, inTrans (frames overlapping the
 * previous clip). `cut` is the centred cut point used by FCPXML/OTIO; `seg` is that clip's
 * [segStart, segEnd) between cuts, and `edl` its [recIn, recOut) as an EDL event (dissolve starts at recIn).
 */
function layoutMain(clips, R) {
  const L = [];
  let acc = 0;
  (clips || []).forEach((c, i) => {
    const len = clipLen(c), lenF = Math.max(1, toFrames(len, R));
    let inTrans = 0;
    if (i > 0) {
      const prev = L[i - 1];
      inTrans = toFrames(transitionSeconds(clips[i - 1], c, acc), R);
      inTrans = Math.max(0, Math.min(inTrans, prev.lenF - prev.inTrans - 1, lenF - 1));
    }
    const startF = i === 0 ? 0 : L[i - 1].startF + L[i - 1].lenF - inTrans;
    acc += len - (i > 0 ? transitionSeconds(clips[i - 1], c, acc) : 0);
    L.push({ c, i, lenF, startF, inTrans, speed: speedOf(c), srcF: toFrames(c.in, R), type: inTrans ? clips[i - 1].transition.type : null });
  });
  const total = L.length ? L[L.length - 1].startF + L[L.length - 1].lenF : 0;
  L.forEach((e, i) => {
    e.half = Math.floor(e.inTrans / 2);
    e.cut = e.startF + e.half;                                   // cut point in the middle of the incoming transition
    e.seg = [i === 0 ? 0 : e.cut, 0];
    e.edl = [e.startF, 0];
  });
  L.forEach((e, i) => {
    e.seg[1] = i + 1 < L.length ? L[i + 1].cut : total;
    e.edl[1] = i + 1 < L.length ? L[i + 1].startF : total;
  });
  return { items: L, total };
}
/** Source frame (fractional) at timeline frame t inside clip e. */
const srcAt = (e, t) => e.srcF + (t - e.startF) * e.speed;

/** Greedy lane assignment so overlapping connected clips don't collide. Returns lane index per item (0-based). */
function assignLanes(spans) {
  const ends = [];
  return spans.map(([s, e]) => {
    let lane = ends.findIndex(end => end <= s);
    if (lane < 0) { lane = ends.length; ends.push(0); }
    ends[lane] = e;
    return lane;
  });
}

/** Overlays/music in frame units, sorted by start. */
function connected(list, R) {
  return (list || [])
    .map(o => ({ o, startF: toFrames(o.start, R), srcF: toFrames(o.in, R), lenF: Math.max(1, toFrames((Number(o.out) || 0) - (Number(o.in) || 0), R)) }))
    .sort((a, b) => a.startF - b.startF);
}

const sortedMarkers = (p, R) => (p.markers || []).map(m => ({ m, f: toFrames(m.time, R) })).sort((a, b) => a.f - b.f);

// ---------- EDL ----------

const EDL_COLORS = { RED: [255, 0, 0], GREEN: [0, 200, 0], BLUE: [0, 0, 255], CYAN: [0, 255, 255], MAGENTA: [255, 0, 255], YELLOW: [255, 255, 0], WHITE: [255, 255, 255], BLACK: [0, 0, 0] };
/** Marker colour (name or #hex) → nearest EDL colour word. */
function colorWord(c) {
  const s = String(c || '').trim();
  if (EDL_COLORS[s.toUpperCase()]) return s.toUpperCase();
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (!m) return 'RED';
  const h = m[1].length === 3 ? m[1].replace(/./g, x => x + x) : m[1];
  const rgb = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  let best = 'RED', bd = Infinity;
  for (const [k, v] of Object.entries(EDL_COLORS)) {
    const d = v.reduce((a, x, i) => a + (x - rgb[i]) ** 2, 0);
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

/**
 * CMX3600 EDL of the main track (video only). Speed changes get M2 lines; transitions become
 * dissolves starting at the incoming clip's first frame. Markers are written as '* LOC:' comments.
 * opts: { title, dropFrame, startHour = 1, reel = 'AX' }
 */
function toEDL(project, opts = {}) {
  const R = rateOf(project.settings?.fps);
  const df = !!dropOf(R, opts.dropFrame);
  const drop = dropOf(R, opts.dropFrame);
  const hour = opts.startHour ?? 1;
  const recStart = hour * (R.nominal * 3600 - drop * 54);   // frame count of hh:00:00:00 (drop-frame aware)
  const tc = f => timecode(f, R, df);
  const rec = f => tc(recStart + f);
  const reel = String(opts.reel || 'AX').slice(0, 8).padEnd(8);
  const line = (n, ch, tr, dur, a, b, c, d) => `${String(n).padStart(3, '0')}  ${reel} ${ch.padEnd(5)} ${tr.padEnd(4)} ${dur} ${a} ${b} ${c} ${d}`;

  const { items } = layoutMain(project.clips, R);
  const markers = sortedMarkers(project, R);
  const title = String(opts.title || project.name || 'RO3 Export').replace(/[\r\n]+/g, ' ');
  const out = [`TITLE: ${title}`, `FCM: ${df ? 'DROP FRAME' : 'NON-DROP FRAME'}`];
  let mi = 0;
  const locs = until => {
    while (mi < markers.length && markers[mi].f < until) {
      const { m, f } = markers[mi++];
      out.push(`* LOC: ${rec(f)} ${colorWord(m.color).padEnd(7)} ${String(m.name || 'Marker').replace(/[\r\n]+/g, ' ')}`);
    }
  };
  if (!items.length) locs(Infinity);
  items.forEach((e, i) => {
    const n = i + 1;
    const [r0, r1] = e.edl;
    const s0 = Math.round(srcAt(e, r0));
    const s1 = s0 + (r1 - r0);   // CMX convention: source duration = record duration; M2 carries the speed
    out.push('');
    if (e.inTrans) {
      const p = items[i - 1];
      const ps = Math.round(srcAt(p, r0));
      out.push(line(n, 'V', 'C', '   ', tc(ps), tc(ps), rec(r0), rec(r0)));
      out.push(line(n, 'V', 'D', String(e.inTrans).padStart(3, '0'), tc(s0), tc(s1), rec(r0), rec(r1)));
    } else {
      out.push(line(n, 'V', 'C', '   ', tc(s0), tc(s1), rec(r0), rec(r1)));
    }
    if (Math.abs(e.speed - 1) > 1e-6) {
      out.push(`M2   ${reel}       ${(e.speed * R.fps).toFixed(1).padStart(5, '0')}                ${tc(s0)}`);
    }
    if (e.inTrans) {
      out.push(`* FROM CLIP NAME: ${nameOf(items[i - 1].c)}`, `* TO CLIP NAME: ${nameOf(e.c)}`);
      if (!/dissolve|fade/i.test(e.type)) out.push(`* EFFECT NAME: ${e.type}`);
    } else out.push(`* FROM CLIP NAME: ${nameOf(e.c)}`);
    if (e.c.path) out.push(`* SOURCE FILE: ${e.c.path}`);
    locs(i === items.length - 1 ? Infinity : r1);
  });
  return out.join('\n') + '\n';
}

// ---------- FCPXML ----------

const CROSS_DISSOLVE_UID = 'FxPlug:4731E73A-8DAC-4113-9A30-AE85B1761265';
const BASIC_TITLE_UID = '.../Titles.localized/Bumper:Opener.localized/Basic Title.localized/Basic Title.moti';

/**
 * FCPXML 1.9: one library/event/project/sequence. Main clips form the spine (centred transitions,
 * timeMap for speed changes), overlays connect on lanes 1+ and music on lanes −1−.
 * opts: { dropFrame, eventName }
 */
function toFCPXML(project, opts = {}) {
  const R = rateOf(project.settings?.fps);
  const W = Math.round(project.settings?.width || 1920), H = Math.round(project.settings?.height || 1080);
  const T = f => ratTime(f, R);
  const name = project.name || 'RO3 Export';
  let nextId = 1;
  const rid = () => `r${nextId++}`;
  const formatId = rid();

  // Assets: one per unique media path, merging what every use tells us.
  const assets = new Map();
  const assetFor = (p, info) => {
    let a = assets.get(p);
    if (!a) { a = { id: rid(), path: p, name: path.basename(p), hasVideo: false, hasAudio: false, durF: 0 }; assets.set(p, a); }
    a.hasVideo = a.hasVideo || info.video;
    a.hasAudio = a.hasAudio || info.audio;
    a.durF = Math.max(a.durF, info.durF || 0);
    return a.id;
  };
  let dissolveId = null, titleId = null;
  let styleN = 0;

  // ---- spine ----
  const { items, total } = layoutMain(project.clips, R);
  const spine = [];   // { offset, dur, local, open, tag, anchors[], markers[], before? }
  for (const e of items) {
    const c = e.c;
    const [s0, s1] = e.seg;
    if (!c.path) {   // nothing to reference: keep the timing with a gap
      spine.push({ offset: s0, dur: s1 - s0, local: s0, kids: [], anchors: [], markers: [], tag: 'gap', open: `<gap name="${xmlEsc(nameOf(c))}" offset="${T(s0)}" start="${T(s0)}" duration="${T(s1 - s0)}"` });
      continue;
    }
    const isImage = c.kind === 'image';
    const audio = !isImage && c.hasAudio !== false;
    const ref = assetFor(c.path, {
      video: true, audio,
      durF: Math.max(toFrames(c.sourceDuration, R), Math.ceil(srcAt(e, e.startF + e.lenF))),
    });
    const local = e.srcF + (s0 - e.startF);   // clip-local time runs at timeline rate from the source in
    const kids = [];
    if (Math.abs(e.speed - 1) > 1e-6) {
      kids.push(`<timeMap>\n  <timept time="${T(e.srcF)}" value="${T(e.srcF)}" interp="linear"/>\n  <timept time="${T(e.srcF + e.lenF)}" value="${T(srcAt(e, e.startF + e.lenF))}" interp="linear"/>\n</timeMap>`);
    }
    const vol = Number(c.volume ?? 1);
    if (audio && !c.muted && Math.abs(vol - 1) > 1e-6) kids.push(`<adjust-volume amount="${dB(vol)}"/>`);
    const srcEnable = audio && c.muted ? ' srcEnable="video"' : '';
    let before = null;
    if (e.inTrans) {
      dissolveId = dissolveId || rid();
      before = `<transition name="Cross Dissolve" offset="${T(e.startF)}" duration="${T(e.inTrans)}"><filter-video ref="${dissolveId}" name="Cross Dissolve"/></transition>`;
    }
    spine.push({
      offset: s0, dur: s1 - s0, local, before, kids, anchors: [], markers: [], tag: 'asset-clip',
      open: `<asset-clip ref="${ref}" name="${xmlEsc(nameOf(c))}" offset="${T(s0)}" start="${T(local)}" duration="${T(s1 - s0)}"${srcEnable}`,
    });
  }

  // Trailing gap so connected clips and markers past the main track still have a parent.
  const overlays = connected(project.overlays, R);
  const music = connected(project.audio, R);
  const markers = sortedMarkers(project, R);
  const lastNeeded = Math.max(0, ...overlays.map(x => x.startF + 1), ...music.map(x => x.startF + 1), ...markers.map(x => x.f + 1));
  if (lastNeeded > total || !spine.length) {
    const gEnd = Math.max(lastNeeded, total + 1);
    spine.push({ offset: total, dur: gEnd - total, local: total, kids: [], anchors: [], markers: [], tag: 'gap', open: `<gap name="Gap" offset="${T(total)}" start="${T(total)}" duration="${T(gEnd - total)}"` });
  }
  const parentAt = f => spine.find(s => f >= s.offset && f < s.offset + s.dur) || spine[spine.length - 1];
  const localIn = (s, f) => s.local + (f - s.offset);

  // ---- connected clips ----
  const indent = (s, pad) => s.split('\n').map(l => pad + l).join('\n');
  const element = (open, kids, tag) => (kids.length ? `${open}>\n${kids.map(k => indent(k, '  ')).join('\n')}\n</${tag}>` : `${open}/>`);

  const ovLanes = assignLanes(overlays.map(x => [x.startF, x.startF + x.lenF]));
  overlays.forEach((x, k) => {
    const o = x.o, lane = ovLanes[k] + 1;
    const parent = parentAt(x.startF);
    const offset = T(localIn(parent, x.startF));
    const pos = `${(((o.x ?? 0.5) - 0.5) * (W / H) * 100).toFixed(3)} ${((0.5 - (o.y ?? 0.5)) * 100).toFixed(3)}`;
    const opacity = Number(o.opacity ?? 1);
    const text = o.kind === 'title' ? (o.text ?? '') : null;
    if (o.kind === 'title' && (text || !o.path)) {
      if (!text) return;   // a title with neither text nor a rendered image has nothing to export
      titleId = titleId || rid();
      const ts = `ts${++styleN}`;
      const kids = [
        `<text>\n  <text-style ref="${ts}">${xmlEsc(text)}</text-style>\n</text>`,
        `<text-style-def id="${ts}">\n  <text-style font="Helvetica" fontSize="72" fontColor="1 1 1 1" alignment="center"/>\n</text-style-def>`,
      ];
      if (opacity < 1) kids.push(`<adjust-blend amount="${opacity.toFixed(3)}"/>`);
      parent.anchors.push(element(`<title ref="${titleId}" lane="${lane}" name="${xmlEsc(String(text).split('\n')[0].slice(0, 60) || 'Title')}" offset="${offset}" start="0s" duration="${T(x.lenF)}"`, kids, 'title'));
      return;
    }
    if (!o.path) return;
    const isVideo = o.kind === 'video';
    const audio = isVideo && !!o.hasAudio;
    const ref = assetFor(o.path, { video: true, audio, durF: x.srcF + x.lenF });
    const kids = [];
    if (o.kind !== 'title') kids.push(`<adjust-transform position="${pos}" scale="${(o.scale ?? 0.35)} ${(o.scale ?? 0.35)}"/>`);
    if (opacity < 1) kids.push(`<adjust-blend amount="${opacity.toFixed(3)}"/>`);
    if (audio && !o.muted && o.volume != null && Math.abs(o.volume - 1) > 1e-6) kids.push(`<adjust-volume amount="${dB(o.volume)}"/>`);
    const srcEnable = audio && o.muted ? ' srcEnable="video"' : '';
    parent.anchors.push(element(`<asset-clip ref="${ref}" lane="${lane}" name="${xmlEsc(nameOf(o))}" offset="${offset}" start="${T(x.srcF)}" duration="${T(x.lenF)}"${srcEnable}`, kids, 'asset-clip'));
  });

  const muLanes = assignLanes(music.map(x => [x.startF, x.startF + x.lenF]));
  music.forEach((x, k) => {
    const a = x.o;
    if (!a.path) return;
    const parent = parentAt(x.startF);
    const ref = assetFor(a.path, { video: false, audio: true, durF: x.srcF + x.lenF });
    const vol = Number(a.volume ?? 1);
    const kids = Math.abs(vol - 1) > 1e-6 ? [`<adjust-volume amount="${dB(vol)}"/>`] : [];
    parent.anchors.push(element(`<asset-clip ref="${ref}" lane="${-(muLanes[k] + 1)}" name="${xmlEsc(nameOf(a))}" offset="${T(localIn(parent, x.startF))}" start="${T(x.srcF)}" duration="${T(x.lenF)}" audioRole="music"`, kids, 'asset-clip'));
  });

  for (const { m, f } of markers) {
    const parent = parentAt(f);
    parent.markers.push(`<marker start="${T(localIn(parent, f))}" duration="${T(1)}" value="${xmlEsc(m.name || 'Marker')}"/>`);
  }

  // ---- resources ----
  const rateLabel = (Math.round(R.fps * 100) / 100).toString().replace('.', '');
  const res = [`<format id="${formatId}" name="FFVideoFormat${H}p${rateLabel}" frameDuration="${ratTime(1, R)}" width="${W}" height="${H}"/>`];
  for (const a of assets.values()) {
    const attrs = `id="${a.id}" name="${xmlEsc(a.name)}" start="0s" duration="${T(Math.max(1, a.durF))}" hasVideo="${a.hasVideo ? 1 : 0}" hasAudio="${a.hasAudio ? 1 : 0}"` +
      (a.hasVideo ? ` format="${formatId}"` : '') + (a.hasAudio ? ' audioSources="1" audioChannels="2" audioRate="48000"' : '');
    res.push(`<asset ${attrs}>\n  <media-rep kind="original-media" src="${xmlEsc(fileUrl(a.path))}"/>\n</asset>`);
  }
  if (dissolveId) res.push(`<effect id="${dissolveId}" name="Cross Dissolve" uid="${CROSS_DISSOLVE_UID}"/>`);
  if (titleId) res.push(`<effect id="${titleId}" name="Basic Title" uid="${BASIC_TITLE_UID}"/>`);

  // ---- assemble ----
  const seqDur = spine.length ? spine[spine.length - 1].offset + spine[spine.length - 1].dur : total;
  const spineXml = [];
  for (const s of spine) {
    if (s.before) spineXml.push(s.before);
    spineXml.push(element(s.open, [...s.kids, ...s.anchors, ...s.markers], s.tag));   // DTD order: adjustments, anchors, markers
  }
  const tcFormat = dropOf(R, opts.dropFrame) ? 'DF' : 'NDF';
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE fcpxml>',
    '<fcpxml version="1.9">',
    '  <resources>',
    indent(res.join('\n'), '    '),
    '  </resources>',
    '  <library>',
    `    <event name="${xmlEsc(opts.eventName || name)}">`,
    `      <project name="${xmlEsc(name)}">`,
    `        <sequence format="${formatId}" duration="${T(seqDur)}" tcStart="0s" tcFormat="${tcFormat}" audioLayout="stereo" audioRate="48k">`,
    '          <spine>',
    indent(spineXml.join('\n'), '            '),
    '          </spine>',
    '        </sequence>',
    '      </project>',
    '    </event>',
    '  </library>',
    '</fcpxml>',
    '',
  ].join('\n');
}

// ---------- OpenTimelineIO ----------

const OTIO_COLORS = ['RED', 'PINK', 'ORANGE', 'YELLOW', 'GREEN', 'CYAN', 'BLUE', 'PURPLE', 'MAGENTA', 'BLACK', 'WHITE'];

/**
 * OpenTimelineIO JSON (Timeline.1). Tracks: V1 main (with Transition.1 between clips), V2+ overlays,
 * A1+ music. Speed changes add a LinearTimeWarp effect; titles become named Gaps. Markers sit on the Stack.
 * opts: { indent = 2 }
 */
function toOTIO(project, opts = {}) {
  const R = rateOf(project.settings?.fps);
  const rate = R.num / R.den;
  const RT = v => ({ OTIO_SCHEMA: 'RationalTime.1', rate, value: v });
  const TR = (s, d) => ({ OTIO_SCHEMA: 'TimeRange.1', start_time: RT(s), duration: RT(d) });
  const gap = (lenF, name = '', meta = {}) => ({ OTIO_SCHEMA: 'Gap.1', name, source_range: TR(0, lenF), effects: [], markers: [], enabled: true, metadata: meta });
  const ref = (c, availF) => ({
    OTIO_SCHEMA: 'ExternalReference.1', name: nameOf(c), target_url: fileUrl(c.path),
    available_range: availF > 0 ? TR(0, availF) : null, available_image_bounds: null, metadata: {},
  });
  const clip = (c, srcF, lenF, effects, meta) => ({
    OTIO_SCHEMA: 'Clip.2', name: nameOf(c), source_range: TR(srcF, lenF), effects, markers: [], enabled: true,
    media_references: { DEFAULT_MEDIA: ref(c, toFrames(c.sourceDuration, R)) }, active_media_reference_key: 'DEFAULT_MEDIA',
    metadata: { ro3: meta },
  });
  const track = (name, kind, children) => ({ OTIO_SCHEMA: 'Track.1', name, kind, children, source_range: null, effects: [], markers: [], enabled: true, metadata: {} });

  // Main track: clips between centred cuts; transitions borrow handles on both sides.
  const { items } = layoutMain(project.clips, R);
  const main = [];
  for (const e of items) {
    const c = e.c;
    if (e.inTrans) {
      main.push({
        OTIO_SCHEMA: 'Transition.1', name: e.type, transition_type: /dissolve|fade/i.test(e.type) ? 'SMPTE_Dissolve' : 'Custom_Transition',
        in_offset: RT(e.half), out_offset: RT(e.inTrans - e.half), metadata: { ro3: { type: e.type } },
      });
    }
    const effects = Math.abs(e.speed - 1) > 1e-6 ? [{ OTIO_SCHEMA: 'LinearTimeWarp.1', name: '', effect_name: 'LinearTimeWarp', time_scalar: e.speed, metadata: {} }] : [];
    main.push(clip(c, srcAt(e, e.seg[0]), e.seg[1] - e.seg[0], effects, { kind: c.kind, volume: c.volume ?? 1, muted: !!c.muted, hasAudio: c.hasAudio !== false }));
  }
  const tracks = [track('V1', 'Video', main)];

  // Connected lanes: one track per lane, gaps fill the space between items.
  const laneTracks = (list, kind, prefix, makeItem) => {
    const lanes = assignLanes(list.map(x => [x.startF, x.startF + x.lenF]));
    const out = [];
    list.forEach((x, k) => {
      const item = makeItem(x);
      if (!item) return;
      const t = out[lanes[k]] || (out[lanes[k]] = { pos: 0, children: [] });
      if (x.startF > t.pos) t.children.push(gap(x.startF - t.pos));
      t.children.push(item);
      t.pos = x.startF + x.lenF;
    });
    return out.filter(Boolean).map((t, i) => track(`${prefix}${i + (kind === 'Video' ? 2 : 1)}`, kind, t.children));
  };
  tracks.push(...laneTracks(connected(project.overlays, R), 'Video', 'V', x => {
    const o = x.o;
    const meta = { kind: o.kind, x: o.x ?? 0.5, y: o.y ?? 0.5, scale: o.scale ?? 0.35, opacity: o.opacity ?? 1 };
    if (o.kind === 'title' && (o.text || !o.path)) return gap(x.lenF, String(o.text || 'Title'), { ro3: { ...meta, title: o.text || '' } });
    return o.path ? clip(o, x.srcF, x.lenF, [], meta) : null;
  }));
  tracks.push(...laneTracks(connected(project.audio, R), 'Audio', 'A', x => (x.o.path ? clip(x.o, x.srcF, x.lenF, [], { volume: x.o.volume ?? 1 }) : null)));

  const markers = sortedMarkers(project, R).map(({ m, f }) => {
    const col = String(m.color || '').toUpperCase();
    return {
      OTIO_SCHEMA: 'Marker.2', name: m.name || 'Marker', comment: '',
      color: OTIO_COLORS.includes(col) ? col : colorWord(m.color),
      marked_range: TR(f, 0), metadata: { ro3: { color: m.color ?? null } },
    };
  });
  const s = project.settings || {};
  const timeline = {
    OTIO_SCHEMA: 'Timeline.1',
    name: project.name || 'RO3 Export',
    global_start_time: RT(0),
    metadata: { ro3: { width: s.width ?? null, height: s.height ?? null, fps: s.fps ?? null } },
    tracks: { OTIO_SCHEMA: 'Stack.1', name: 'tracks', children: tracks, source_range: null, effects: [], markers, enabled: true, metadata: {} },
  };
  return JSON.stringify(timeline, null, opts.indent ?? 2);
}

module.exports = { toEDL, toFCPXML, toOTIO, timecode, rateOf, ratTime, layoutMain };
