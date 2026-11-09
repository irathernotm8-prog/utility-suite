// Mixer window: Arrange — the timeline. Track headers (sound, mute/solo, volume), lanes with clips you drag, trim and
// split, the ruler with the loop and section markers, drop-to-import, and the editor pane for the selected clip.
'use strict';
const TL = { headW: 236, laneH: 80, base: 22 };
const ppb = () => TL.base * (S.settings.zoom || 1);
const snapB = () => +(S.settings.snap ?? 0.25);
const snapTo = (b, s = snapB()) => (s ? Math.round(b / s) * s : Math.round(b * 1000) / 1000);
const SNAPS = [[4, 'Bar'], [1, 'Beat'], [0.5, '1/8'], [0.25, '1/16'], [0, 'Off']];

VIEWS.arrange = {
  flush: true,
  head() { return `<input class="title-input" id="songTitle" value="${esc(S.song.name)}" spellcheck="false"><span class="muted small">${S.song.bars} bars · ${fmtTime(SG.songEnd(S.song) * SG.spb(S.song)).replace(/\.\d$/, '')}</span>`; },
  actions() { return `<button class="icon-btn" id="undoBtn">${icon('undo', 17)}</button><button class="icon-btn" id="redoBtn">${icon('redo', 17)}</button><span class="vsep"></span><button class="btn sm" id="impBtn">${icon('import', 15)}Import audio</button><button class="btn sm primary" id="expBtn">${icon('export', 15)}Export</button>`; },
  render(view) {
    view.innerHTML = `<div class="arr">${transportHTML({ extra: `<label class="tp-field">Snap<select id="tpSnap">${SNAPS.map(([v, l]) => `<option value="${v}" ${+v === snapB() ? 'selected' : ''}>${l}</option>`).join('')}</select></label><button class="icon-btn sm" id="zOut" title="Zoom out (Ctrl/Cmd + scroll)">${icon('zoomOut', 16)}</button><button class="icon-btn sm" id="zIn" title="Zoom in">${icon('zoomIn', 16)}</button>` })}<div class="tl-scroll" id="tl"></div><div id="edHost"></div></div>`;
    bindTransport(); bindHead();
    $('#tpSnap').onchange = (e) => { S.settings.snap = +e.target.value; call('settings:set', { snap: S.settings.snap }); };
    $('#zIn').onclick = () => zoom(1.25); $('#zOut').onclick = () => zoom(0.8);
    drawTimeline(); mountEditor();
  },
  update() { const tl = $('#tl'); if (!tl) return render(); const sx = tl.scrollLeft, sy = tl.scrollTop; $('#headLeft').innerHTML = this.head(); bindHead(); fitTitles(); syncTransport(); drawTimeline(); tl.scrollLeft = sx; tl.scrollTop = sy; mountEditor(true); },
};
function bindHead() {
  const t = $('#songTitle'); if (t) t.onchange = () => edit('Rename song', (s) => { s.name = t.value.trim() || s.name; });
  if ($('#undoBtn')) { $('#undoBtn').onclick = undo; $('#redoBtn').onclick = redo; updateUndo(); }
  if ($('#impBtn')) $('#impBtn').onclick = importDialog;
  if ($('#expBtn')) $('#expBtn').onclick = exportSheet;
}
function syncTransport() { const s = S.song; const b = $('#tpBpm'); if (b && document.activeElement !== b) b.value = s.bpm; const k = $('#tpKey'); if (k) { if (![...k.options].some((o) => o.value === s.key)) k.insertAdjacentHTML('afterbegin', `<option>${esc(s.key)}</option>`); k.value = s.key; } const g = $('#tpSig'); if (g) g.value = s.timeSig.join('/'); const l = $('#tpLoop'); if (l) l.classList.toggle('on', s.loop.on); }
function zoom(f, anchorX) { const tl = $('#tl'); const old = ppb(); const z = Math.max(0.25, Math.min(6, (S.settings.zoom || 1) * f)); S.settings.zoom = z; call('settings:set', { zoom: z }); const ax = anchorX ?? tl.clientWidth / 2; const beat = (tl.scrollLeft + ax - TL.headW) / old; drawTimeline(); tl.scrollLeft = beat * ppb() + TL.headW - ax; }

function drawTimeline() {
  const tl = $('#tl'); if (!tl) return; const s = S.song; const P = ppb(); const B = SG.bpb(s);
  const total = Math.max(SG.songEnd(s) + B * 8, Math.ceil((tl.clientWidth - TL.headW) / P / B + 1) * B); const W = total * P;
  const every = P * B < 28 ? 8 : P * B < 50 ? 4 : P * B < 80 ? 2 : 1;
  let ruler = ''; for (let b = 0; b * B < total; b++) { if (b % every === 0) ruler += `<div class="rb" style="left:${b * B * P}px">${b + 1}</div>`; if (P >= 16) for (let k = 1; k < B; k++) ruler += `<div class="rb beat" style="left:${(b * B + k) * P}px"></div>`; }
  const loop = `<div class="tl-loop ${s.loop.on ? '' : 'off'}" id="tlLoop" style="left:${s.loop.start * P}px;width:${Math.max(4, (s.loop.end - s.loop.start) * P)}px"><i data-e="l"></i><i data-e="r"></i></div>`;
  const marks = (s.markers || []).map((m, i) => `<div class="tl-mark" style="left:${m.beat * P}px" data-mk="${i}">${esc(m.name)}</div>`).join('');
  const gridBg = `repeating-linear-gradient(90deg, var(--grid-2) 0 1px, transparent 1px ${B * P}px)${P >= 12 ? `, repeating-linear-gradient(90deg, var(--grid) 0 1px, transparent 1px ${P}px)` : ''}`;
  const rows = s.tracks.map((t, i) => `<div class="tl-row" data-row="${t.id}"><div class="tl-head ${S.sel.track === t.id ? 'sel' : ''}" data-t="${t.id}">${trackHead(t)}</div><div class="tl-lane ${i % 2 ? 'alt' : ''}" data-lane="${t.id}" style="width:${W}px;--grid-bg:${gridBg}">${s.clips.filter((c) => c.track === t.id).map((c) => clipHTML(c, t)).join('')}</div></div>`).join('');
  tl.innerHTML = `<div class="tl-inner" id="tlIn" style="width:${W + TL.headW}px">
    <div class="tl-row tl-ruler-row"><div class="tl-corner"><span class="muted small grow">${plural(s.tracks.length, 'track')}</span><button class="icon-btn xs" id="addMark" title="Add a section marker at the playhead">${icon('marker', 14)}</button></div><div class="tl-ruler" id="tlRuler" style="width:${W}px">${ruler}${loop}${marks}</div></div>
    ${rows}
    <div class="tl-add"><button class="btn sm" id="addInst">${icon('piano', 15)}Instrument</button><button class="btn sm" id="addDrums">${icon('drum', 15)}Drums</button><button class="btn sm" id="addAudio">${icon('wave', 15)}Audio</button></div>
    ${s.tracks.length ? '' : `<div class="tl-empty"><b>Start a song</b>Add an instrument or a drum kit, drop in an audio file to edit it, or ask Claude for a beat. Double-click a lane to start a clip, then draw notes below.</div>`}
    <div class="playhead" id="ph" style="left:${TL.headW}px"></div></div>`;
  hydrateIcons(tl); bindTimeline(); drawThumbs(); drawPlayhead(Player.position());
}
function trackHead(t) {
  const snd = t.kind === 'audio' ? 'Audio' : t.kind === 'drums' ? (SND.kit(t.sound) || {}).name || t.sound : (SND.instrument(t.sound) || {}).name || t.sound; const hasAuto = t.automation && Object.keys(t.automation).length;
  return `<span class="th-color" style="background:${t.color}"></span><div class="th-main"><div class="th-top"><input class="th-name" value="${esc(t.name)}" spellcheck="false" data-a="name"><button class="ms m ${t.mute ? 'on' : ''}" data-a="mute" title="Mute">M</button><button class="ms s ${t.solo ? 'on' : ''}" data-a="solo" title="Solo">S</button><button class="icon-btn xs" data-a="more">${icon('more', 14)}</button></div>
    <div class="th-top"><button class="th-snd" data-a="sound">${icon(t.kind === 'audio' ? 'wave' : t.kind === 'drums' ? 'drum' : 'piano', 12)}<span class="ellip">${esc(snd)}</span></button>${t.effects.length ? `<span class="pill" style="height:18px;font-size:10.5px">${t.effects.filter((f) => f.on).length} fx</span>` : ''}${hasAuto ? '<span class="auto-badge" title="Automated">A</span>' : ''}</div>
    <div class="th-bot"><input type="range" class="th-vol" min="-40" max="6" step="0.5" value="${t.volume}" data-a="vol" title="Volume (double-click for 0 dB)"><span class="th-db">${fmtDb(t.volume)}</span></div></div>`;
}
function clipHTML(c, t) {
  const P = ppb(), s = S.song; const x = c.start * P, w = Math.max(6, SG.clipLength(s, c) * P);
  const fade = c.file ? `${c.fadeIn > 0.02 ? `<span class="fadein" style="width:${Math.min(w / 2, (c.fadeIn / SG.spb(s)) * P)}px"></span>` : ''}${c.fadeOut > 0.02 ? `<span class="fadeout" style="width:${Math.min(w / 2, (c.fadeOut / SG.spb(s)) * P)}px"></span>` : ''}` : '';
  const tag = c.file ? [c.reverse ? 'rev' : '', c.pitch ? (c.pitch > 0 ? '+' : '') + c.pitch + 'st' : '', c.stretch !== 1 ? '×' + (+c.stretch).toFixed(2) : '', c.speed !== 1 ? 'spd ' + c.speed : ''].filter(Boolean).join(' · ') : '';
  return `<div class="clip ${S.sel.clip === c.id ? 'sel' : ''}" data-c="${c.id}" style="left:${x}px;width:${w}px;--c:${c.color || t.color}"><span class="cl-name">${esc(c.name || '')}${tag ? ` <span style="opacity:.7">${esc(tag)}</span>` : ''}</span><canvas></canvas>${fade}<span class="edge l"></span><span class="edge r"></span></div>`;
}
function drawThumbs() { $$('#tl .clip').forEach((el) => { const c = clip(el.dataset.c); if (c) drawThumb($('canvas', el), c, track(c.track)); }); }
function drawThumb(cv, c, t) {
  const r = cv.getBoundingClientRect(); const dpr = devicePixelRatio || 1; const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height)); cv.width = w * dpr; cv.height = h * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const col = c.color || t.color; const s = S.song; const L = SG.clipLength(s, c); const xOf = (b) => (b / L) * w;
  if (c.file) {
    const buf = Assets.raw.get(c.file); if (!buf) { Assets.get(c.file).then(() => drawThumb(cv, c, t)).catch(() => {}); return; }
    const d = buf.getChannelData(0); const s0 = Math.floor(c.offset * buf.sampleRate), s1 = Math.floor((c.offset + c.dur) * buf.sampleRate); const pk = MXAnalysis.peaks(d, w, s0, s1); g.fillStyle = col; g.globalAlpha = 0.9; const g0 = Math.pow(10, (c.gain || 0) / 20);
    for (let x = 0; x < w; x++) { const k = c.reverse ? w - 1 - x : x; const lo = pk[2 * k] * g0, hi = pk[2 * k + 1] * g0; const y0 = h / 2 - Math.min(1, hi) * h * 0.46, y1 = h / 2 - Math.max(-1, lo) * h * 0.46; g.fillRect(x, y0, 1, Math.max(1, y1 - y0)); }
    return;
  }
  if (!c.notes.length) return; g.fillStyle = col;
  if (t.kind === 'drums') { const vs = TH.DRUM_VOICES.filter((v) => c.notes.some((n) => n.p === v)); const rh = (h - 6) / vs.length; for (const n of c.notes) { g.globalAlpha = 0.45 + n.v * 0.55; g.fillRect(xOf(n.t), 3 + vs.indexOf(n.p) * rh, Math.max(2, xOf(0.2)), Math.max(1.5, rh - 1)); } return; }
  const ps = c.notes.map((n) => n.p); const lo = Math.min(...ps) - 1, hi = Math.max(...ps) + 1; const rh = Math.max(2, Math.min(5, (h - 6) / (hi - lo + 1)));
  for (const n of c.notes) { g.globalAlpha = 0.55 + n.v * 0.45; const y = h - 3 - ((n.p - lo) / Math.max(1, hi - lo)) * (h - 6 - rh) - rh; g.fillRect(xOf(n.t), y, Math.max(2, xOf(n.d) - 1), rh); }
}
function drawPlayhead(pos) { const ph = $('#ph'); if (!ph) return; const x = TL.headW + pos * ppb(); ph.style.transform = `translateX(${x - TL.headW}px)`; if (Player.playing && S.follow !== false) { const tl = $('#tl'); if (tl && !TL.dragging) { const vx = x - tl.scrollLeft; if (vx > tl.clientWidth - 60 || vx < TL.headW) tl.scrollLeft = x - TL.headW - 40; } } }

function bindTimeline() {
  const tl = $('#tl'); const s = S.song; const P = ppb();
  tl.onwheel = (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 1.12 : 0.89, e.clientX - tl.getBoundingClientRect().left); } };
  // ruler: click to seek, drag the loop bar
  $('#tlRuler').onmousedown = (e) => {
    if (e.target.closest('.tl-loop')) return; const r = $('#tlRuler').getBoundingClientRect(); const b = snapTo((e.clientX - r.left) / P, 1);
    if (e.clientY - r.top < 10) { // draw a new loop
      const start = snapTo((e.clientX - r.left) / P, SG.bpb(s)); let end = start + SG.bpb(s); const el = $('#tlLoop'); el.classList.remove('off');
      const mv = (ev) => { end = Math.max(start + 1, snapTo((ev.clientX - r.left) / P, SG.bpb(s))); el.style.left = start * P + 'px'; el.style.width = (end - start) * P + 'px'; };
      const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); edit('Loop', (x) => { x.loop = { on: true, start, end }; }); };
      addEventListener('mousemove', mv); addEventListener('mouseup', up); mv(e); return;
    }
    Player.seek(Math.max(0, b));
  };
  const lp = $('#tlLoop'); lp.onmousedown = (e) => {
    e.stopPropagation(); const r = $('#tlRuler').getBoundingClientRect(); const which = e.target.dataset.e || 'm'; const s0 = s.loop.start, e0 = s.loop.end, x0 = e.clientX; let ns = s0, ne = e0;
    const mv = (ev) => { const d = snapTo((ev.clientX - x0) / P, 1); if (which === 'l') ns = Math.min(e0 - 1, Math.max(0, s0 + d)); else if (which === 'r') ne = Math.max(s0 + 1, e0 + d); else { ns = Math.max(0, s0 + d); ne = ns + (e0 - s0); } lp.style.left = ns * P + 'px'; lp.style.width = (ne - ns) * P + 'px'; };
    const up = (ev) => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); if (Math.abs(ev.clientX - x0) < 3 && which === 'm') edit(s.loop.on ? 'Loop off' : 'Loop on', (x) => { x.loop.on = !x.loop.on; }); else edit('Loop', (x) => { x.loop = { on: true, start: ns, end: ne }; }); };
    addEventListener('mousemove', mv); addEventListener('mouseup', up); void r;
  };
  $$('.tl-mark', tl).forEach((m) => { m.style.pointerEvents = 'auto'; m.style.cursor = 'pointer'; m.oncontextmenu = m.onclick = (e) => { e.preventDefault(); e.stopPropagation(); const i = +m.dataset.mk; menu(m, [{ label: 'Rename…', icon: 'edit', run: async () => { const n = await promptBox({ title: 'Section name', value: s.markers[i].name }); if (n) edit('Rename marker', (x) => { x.markers[i].name = n; }); } }, { label: 'Play from here', icon: 'play', run: () => { Player.seek(s.markers[i].beat); if (!Player.playing) togglePlay(); } }, { label: 'Remove', icon: 'trash', danger: true, run: () => edit('Remove marker', (x) => { x.markers.splice(i, 1); }) }]); }; });
  $('#addMark').onclick = async () => { const b = snapTo(Player.position(), SG.bpb(s)); const n = await promptBox({ title: `Marker at bar ${SG.beatToBar(s, b)}`, placeholder: 'Intro, Verse, Chorus, Drop…', ok: 'Add' }); if (n) edit('Add marker', (x) => { x.markers.push({ beat: b, name: n }); x.markers.sort((a, c) => a.beat - c.beat); }); };
  $('#addInst').onclick = (e) => soundMenu(e.currentTarget, 'instrument', (id) => addTrackOf('instrument', id));
  $('#addDrums').onclick = (e) => soundMenu(e.currentTarget, 'drums', (id) => addTrackOf('drums', id));
  $('#addAudio').onclick = () => addTrackOf('audio');
  // track headers
  $$('.tl-head', tl).forEach((h) => {
    const t = track(h.dataset.t); if (!t) return;
    h.onmousedown = (e) => { if (S.sel.track !== t.id) { S.sel.track = t.id; $$('.tl-head', tl).forEach((x) => x.classList.toggle('sel', x === h)); } void e; };
    $('[data-a=name]', h).onchange = (e) => edit('Rename track', (x) => { SG.updateTrack(x, t.id, { name: e.target.value }); });
    $('[data-a=mute]', h).onclick = () => edit(t.mute ? 'Unmute' : 'Mute', (x) => { SG.updateTrack(x, t.id, { mute: !t.mute }); });
    $('[data-a=solo]', h).onclick = () => edit(t.solo ? 'Unsolo' : 'Solo', (x) => { SG.updateTrack(x, t.id, { solo: !t.solo }); });
    const vol = $('[data-a=vol]', h); vol.oninput = () => { t.volume = +vol.value; rangeFill(vol); $('.th-db', h).textContent = fmtDb(t.volume); Player.setSong(S.song); }; vol.onchange = () => edit('Volume', (x) => { SG.updateTrack(x, t.id, { volume: +vol.value }); }, { render: false }); vol.ondblclick = () => { vol.value = 0; vol.oninput(); vol.onchange(); };
    $('[data-a=sound]', h).onclick = (e) => { if (t.kind === 'audio') return; soundMenu(e.currentTarget, t.kind, (id) => edit('Change sound', (x) => { SG.updateTrack(x, t.id, { sound: id }); }), t.sound, t); };
    $('[data-a=more]', h).onclick = (e) => trackMenu(e.currentTarget, t);
    h.oncontextmenu = (e) => { e.preventDefault(); trackMenu(null, t, e.clientX, e.clientY); };
  });
  // lanes: double-click to start a clip; drop audio
  $$('.tl-lane', tl).forEach((ln) => {
    const t = track(ln.dataset.lane);
    ln.ondblclick = (e) => { if (e.target !== ln || t.kind === 'audio') return; const r = ln.getBoundingClientRect(); const b = Math.floor(((e.clientX - r.left) / P) / SG.bpb(s)) * SG.bpb(s); const c = edit('New clip', (x) => SG.addMidiClip(x, { track: t.id, start: b, length: SG.bpb(x) * (t.kind === 'drums' ? 1 : 2), notes: [], name: t.kind === 'drums' ? 'Beat' : 'Notes' })); if (c) { S.sel = { track: t.id, clip: c.id }; S.editor = c.id; render(); } };
    ln.onmousedown = (e) => { if (e.target === ln) { S.sel.clip = null; $$('.clip.sel', tl).forEach((x) => x.classList.remove('sel')); if (e.button === 0) Player.seek(Math.max(0, snapTo((e.clientX - ln.getBoundingClientRect().left) / P, 1))); } };
    ln.ondragover = (e) => { e.preventDefault(); ln.classList.add('drop'); }; ln.ondragleave = () => ln.classList.remove('drop');
    ln.ondrop = (e) => { e.preventDefault(); e.stopPropagation(); ln.classList.remove('drop'); document.body.classList.remove('dragging'); const files = [...e.dataTransfer.files].map((f) => D.pathFor(f)).filter(Boolean); const b = snapTo((e.clientX - ln.getBoundingClientRect().left) / P, SG.bpb(s)); importFiles(files, { track: t.kind === 'audio' ? t.id : null, atBeat: Math.max(0, b) }); };
  });
  // clips: select, move (also to another track of the same kind), trim, open
  $$('.clip', tl).forEach((el) => {
    const c = clip(el.dataset.c); if (!c) return;
    el.onmousedown = (e) => {
      if (e.button !== 0) return; e.stopPropagation(); select(c);
      const edge = e.target.classList.contains('edge') ? (e.target.classList.contains('l') ? 'l' : 'r') : null; const x0 = e.clientX, y0 = e.clientY; const st0 = c.start, len0 = SG.clipLength(s, c); let moved = false; let targetTrack = c.track; TL.dragging = true;
      const mv = (ev) => {
        const dx = (ev.clientX - x0) / P; if (!moved && Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 4) return; moved = true; el.classList.add('drag');
        if (!edge) { const ns = Math.max(0, snapTo(st0 + dx)); el.style.left = ns * P + 'px'; const row = document.elementFromPoint(ev.clientX, ev.clientY); const lane = row && row.closest('[data-lane]'); if (lane) { const tt = track(lane.dataset.lane); if (tt && (tt.kind === 'audio') === !!c.file && (tt.kind === 'drums') === (track(c.track).kind === 'drums')) { targetTrack = tt.id; if (lane !== el.parentElement) lane.appendChild(el); } } }
        else if (edge === 'r') { const ne = Math.max(st0 + 0.25, snapTo(st0 + len0 + dx)); el.style.width = (ne - st0) * P + 'px'; }
        else { const ns = Math.min(st0 + len0 - 0.25, Math.max(0, snapTo(st0 + dx))); el.style.left = ns * P + 'px'; el.style.width = (st0 + len0 - ns) * P + 'px'; }
      };
      const up = (ev) => {
        removeEventListener('mousemove', mv); removeEventListener('mouseup', up); TL.dragging = false; el.classList.remove('drag'); if (!moved) return;
        const dx = (ev.clientX - x0) / P;
        if (!edge) edit('Move clip', (x) => SG.updateClip(x, c.id, { start: Math.max(0, snapTo(st0 + dx)), track: targetTrack !== c.track ? targetTrack : undefined }));
        else if (edge === 'r') { const ne = Math.max(st0 + 0.25, snapTo(st0 + len0 + dx)); edit('Resize clip', (x) => { if (c.file) { const rate = (c.stretch || 1) / (c.speed || 1); SG.updateClip(x, c.id, { dur: ((ne - st0) * SG.spb(x)) / rate }); } else SG.updateClip(x, c.id, { length: ne - st0 }); }); }
        else { const ns = Math.min(st0 + len0 - 0.25, Math.max(0, snapTo(st0 + dx))); const d = ns - st0; edit('Trim clip', (x) => { const cc = SG.findClip(x, c.id); if (cc.file) { const rate = (cc.stretch || 1) / (cc.speed || 1); SG.updateClip(x, cc.id, { trimStart: Math.max(0, cc.offset + (d * SG.spb(x)) / rate) }); cc.start = Math.max(0, ns); } else { cc.start = ns; cc.length = Math.max(0.25, cc.length - d); cc.notes = cc.notes.map((n) => ({ ...n, t: +(n.t - d).toFixed(4) })).filter((n) => n.t >= 0 && n.t < cc.length); } }); }
      };
      addEventListener('mousemove', mv); addEventListener('mouseup', up);
    };
    el.ondblclick = (e) => { e.stopPropagation(); S.editor = c.id; S.sel.clip = c.id; render(); };
    el.oncontextmenu = (e) => { e.preventDefault(); select(c); clipMenu(null, c, e.clientX, e.clientY); };
  });
}
function select(c) { S.sel.clip = c.id; S.sel.track = c.track; $$('#tl .clip').forEach((x) => x.classList.toggle('sel', x.dataset.c === c.id)); $$('#tl .tl-head').forEach((x) => x.classList.toggle('sel', x.dataset.t === c.track)); if (S.editor && S.editor !== c.id) { S.editor = c.id; mountEditor(); } }

function soundMenu(anchor, kind, pick, current, t) {
  if (kind === 'drums') return menu(anchor, [{ header: true, label: 'Drum kits' }, ...SND.KITS.map((k) => ({ label: k.name, hint: '', on: k.id === current, run: () => pick(k.id) }))], { width: 260 });
  const items = []; for (const c of SND.CATS) { items.push({ header: true, label: c }); for (const i of SND.INSTRUMENTS.filter((x) => x.cat === c)) items.push({ label: i.name, on: i.id === current, run: () => pick(i.id) }); }
  items.push('-', { label: 'Browse and preview sounds…', icon: 'sounds', run: () => go('sounds', t ? t.id : null) });
  menu(anchor, items, { width: 260 });
}
function addTrackOf(kind, sound) { const t = edit(`Add ${kind} track`, (x) => SG.addTrack(x, { kind, sound })); if (t) { S.sel.track = t.id; refresh(); const tl = $('#tl'); if (tl) tl.scrollTop = tl.scrollHeight; } return t; }
function trackMenu(anchor, t, x, y) {
  const i = S.song.tracks.indexOf(t);
  menu(anchor, [
    { label: 'Effects and mix…', icon: 'mixer', run: () => { S.sel.track = t.id; go('mix'); } },
    ...(t.kind !== 'audio' ? [{ label: 'New empty clip at the playhead', icon: 'plus', run: () => { const b = Math.floor(Player.position() / SG.bpb(S.song)) * SG.bpb(S.song); const c = edit('New clip', (s) => SG.addMidiClip(s, { track: t.id, start: b, length: SG.bpb(s) * 2, notes: [] })); if (c) { S.sel = { track: t.id, clip: c.id }; S.editor = c.id; render(); } } }] : [{ label: 'Import audio onto this track…', icon: 'import', run: () => importDialog({ track: t.id, atBeat: Math.floor(Player.position()) }) }]),
    ...(t.kind === 'instrument' ? [{ label: 'Octave', header: true }, ...[-2, -1, 0, 1, 2].map((o) => ({ label: o === 0 ? 'As written' : (o > 0 ? '+' : '') + o + ' octave', on: (t.octave || 0) === o, run: () => edit('Octave', (s) => { SG.updateTrack(s, t.id, { octave: o }); }) }))] : []),
    '-', { label: 'Colour', header: true }, ...SND.COLORS.slice(0, 8).map((c) => ({ label: c, swatch: c, on: t.color === c, run: () => edit('Colour', (s) => { SG.updateTrack(s, t.id, { color: c }); }) })),
    '-', { label: 'Move up', icon: 'up', disabled: i === 0, run: () => edit('Move track', (s) => { SG.updateTrack(s, t.id, { index: i - 1 }); }) }, { label: 'Move down', icon: 'down', disabled: i === S.song.tracks.length - 1, run: () => edit('Move track', (s) => { SG.updateTrack(s, t.id, { index: i + 1 }); }) },
    { label: 'Duplicate track', icon: 'dup', run: () => edit('Duplicate track', (s) => { const n = SG.addTrack(s, { kind: t.kind, sound: t.sound, name: t.name + ' copy', volume: t.volume, pan: t.pan, effects: t.effects.map((f) => ({ ...f, id: undefined })), index: i + 1 }); n.pads = JSON.parse(JSON.stringify(t.pads || {})); for (const c of s.clips.filter((c) => c.track === t.id)) s.clips.push({ ...JSON.parse(JSON.stringify(c)), id: SG.uid('c'), track: n.id }); }) },
    ...(t.automation && Object.keys(t.automation).length ? [{ label: 'Clear automation', icon: 'x', run: () => edit('Clear automation', (s) => { SG.updateTrack(s, t.id, { automation: {} }); }) }] : []),
    '-', { label: 'Delete track', icon: 'trash', danger: true, run: async () => { if (await confirmBox({ title: `Delete “${t.name}”?`, text: 'Its clips go too. You can undo this.', ok: 'Delete', danger: true })) { edit('Delete track', (s) => SG.removeTrack(s, t.id)); render(); } } },
  ], { width: 250, x, y });
}
function clipMenu(anchor, c, x, y) {
  const t = track(c.track);
  menu(anchor, [
    { label: 'Open in the editor', icon: c.file ? 'wave' : t.kind === 'drums' ? 'drum' : 'piano', run: () => { S.editor = c.id; render(); } },
    { label: 'Rename…', icon: 'edit', run: async () => { const n = await promptBox({ title: 'Clip name', value: c.name }); if (n) edit('Rename clip', (s) => SG.updateClip(s, c.id, { name: n })); } },
    { label: 'Duplicate after', icon: 'dup', hint: '⌘D', run: () => edit('Duplicate clip', (s) => SG.duplicateClip(s, c.id)) },
    { label: 'Split at the playhead', icon: 'scissors', hint: 'S', run: () => { S.sel.clip = c.id; splitAtPlayhead(); } },
    { label: 'Loop this clip', icon: 'loop', run: () => edit('Loop', (s) => { s.loop = { on: true, start: c.start, end: SG.clipEnd(s, c) }; }) },
    ...(c.file ? ['-', { label: c.reverse ? 'Play forwards' : 'Reverse', icon: 'reverse', run: () => edit('Reverse', (s) => SG.updateClip(s, c.id, { reverse: !c.reverse })) }, ...(c.info && c.info.bpm ? [{ label: `Fit to ${S.song.bpm} BPM (from ${c.info.bpm})`, icon: 'stretch', run: () => edit('Fit to tempo', (s) => { const r = [c.info.bpm, c.info.bpm * 2, c.info.bpm / 2].map((b) => b / s.bpm).sort((a, b) => Math.abs(Math.log(a)) - Math.abs(Math.log(b)))[0]; SG.updateClip(s, c.id, { stretch: +r.toFixed(4) }); }) }, { label: `Set the song to ${c.info.bpm} BPM${c.info.key ? ', ' + c.info.key : ''}`, icon: 'metronome', run: () => edit('Match song to clip', (s) => { s.bpm = Math.round(c.info.bpm * 10) / 10; if (c.info.key) try { s.key = TH.parseKey(c.info.key).name; } catch {} }) }] : [])] : ['-', { label: 'Transpose', header: true }, ...[[-12, '−1 octave'], [-1, '−1 semitone'], [1, '+1 semitone'], [12, '+1 octave']].map(([d, l]) => ({ label: l, run: () => edit('Transpose', (s) => SG.updateClip(s, c.id, { transpose: d })) }))]),
    '-', { label: 'Delete', icon: 'trash', danger: true, hint: '⌫', run: () => { edit('Delete clip', (s) => SG.removeClip(s, c.id)); if (S.editor === c.id) S.editor = null; render(); } },
  ], { width: 260, x, y });
}

// ───────── importing audio
async function importDialog(opts = {}) { const f = await call('dialog:audio'); if (f && f.length) importFiles(f, { atBeat: opts.atBeat ?? 0, track: opts.track || null }); }
async function importFiles(files, opts = {}) {
  const ok = []; for (const f of files) if (await call('isAudio', f)) ok.push(f); if (!ok.length) { toast('Nothing to import', 'Mixer reads WAV, MP3, M4A/AAC, FLAC, OGG/Opus and the audio in MP4/MOV/WebM.', 'bad', 6000); return; }
  const t = toast(`Importing ${plural(ok.length, 'file')}…`, 'Measuring tempo, key and loudness', 'busy', 0);
  try { const r = await call('audio:import', ok, opts); t.remove(); const i = r[0].info; toast(`Imported ${baseName(ok[0])}${ok.length > 1 ? ` and ${ok.length - 1} more` : ''}`, `${i.seconds}s${i.bpm ? ` · about ${i.bpm} BPM` : ''}${i.key ? ` · ${i.key}` : ''} · ${i.lufs} LUFS`, 'ok', 7000); await reloadSong(); S.sel = { track: r[0].clip.track, clip: r[0].clip.id }; if (S.view !== 'arrange') go('arrange'); }
  catch (e) { t.remove(); fail(e); }
}
// drop anywhere
let dragDepth = 0;
addEventListener('dragenter', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; document.body.classList.add('dragging'); } });
addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dragging'); });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging'); const files = [...(e.dataTransfer ? e.dataTransfer.files : [])].map((f) => D.pathFor(f)).filter(Boolean); if (files.length) importFiles(files, { atBeat: Math.floor(Player.position()) }); });
addEventListener('resize', () => { if (S.view === 'arrange') { clearTimeout(TL.rt); TL.rt = setTimeout(() => refresh(), 150); } });
