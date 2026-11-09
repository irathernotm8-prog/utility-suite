// Mixer window: the editor pane under the timeline — a piano roll (draw, move, stretch, velocity, quantize, audition),
// a drum step grid (paint hits, accents, your own samples per voice) and the audio clip editor (trim, fades, gain,
// pitch, stretch, speed, reverse, fit to tempo).
'use strict';
const ED = { h: 330, sx: 0, sy: 84, rowH: 14, ppb: 0, lastLen: 1, sel: new Set(), clipId: null, drag: null };
const KEYW = 46;

function mountEditor(soft) {
  const host = $('#edHost'); if (!host) return; const c = S.editor && clip(S.editor);
  if (!c) { host.innerHTML = ''; ED.clipId = null; return; }
  const t = track(c.track); const kind = c.file ? 'audio' : t.kind === 'drums' ? 'drums' : 'notes';
  if (ED.clipId !== c.id) { ED.clipId = c.id; ED.sel.clear(); ED.ppb = 0; ED.sx = 0; if (kind === 'notes') { const ps = c.notes.map((n) => n.p); ED.sy = ps.length ? Math.min(120, Math.max(...ps) + 6) : 79; } soft = false; }
  if (soft && host.firstChild && host.firstChild.dataset.kind === kind) { drawEditor(); syncEdBar(); return; }
  const len = (SG.clipLength(S.song, c) / SG.bpb(S.song));
  host.innerHTML = `<div class="ed-pane" data-kind="${kind}" style="height:${ED.h}px"><div class="ed-grip" id="edGrip"></div>
    <div class="ed-bar" id="edBar"><span class="ed-title" style="--c:${c.color || t.color}"><i></i>${esc(c.name || 'Clip')}<span class="muted small" style="font-weight:500">· ${esc(t.name)}</span></span>
      ${kind !== 'audio' ? `<label class="tp-field" style="height:28px">Bars<input id="edLen" type="number" min="0.25" step="0.25" value="${+len.toFixed(2)}" style="width:52px"></label>` : ''}
      ${kind === 'notes' ? `<button class="btn xs" id="edQuant" title="Snap notes to the grid (Q)">${icon('grid', 13)}Quantize</button><button class="btn xs" id="edVel" title="Set the velocity of the selected notes">${icon('meter', 13)}Velocity</button><span class="ed-hint">Click to add · drag to move, edge to lengthen · right-click deletes · ↑↓ transpose · ⌘A all</span>` : kind === 'drums' ? `<span class="ed-hint">Click or drag to paint hits · Shift = accent · Alt = soft · click a name to hear it · right-click a name for your own sample</span>` : `<span class="ed-hint">Drag the bright region’s edges to trim · double-click the timeline clip to come back here</span>`}
      <span class="grow"></span><button class="icon-btn sm" id="edClose" title="Close (Esc)">${icon('x', 16)}</button></div>
    <div class="ed-body" id="edBody">${kind === 'audio' ? `<div class="au-ed"><div class="au-wave"><canvas id="auCv"></canvas></div><div class="au-side" id="auSide"></div></div>` : kind === 'drums' ? `<div class="pr-wrap" id="prWrap"><canvas id="prCv"></canvas></div>` : `<div style="flex:1;display:flex;flex-direction:column;min-width:0"><div class="pr-wrap" id="prWrap" style="overflow:hidden"><canvas id="prCv"></canvas></div><div class="vel-lane"><canvas id="velCv"></canvas></div></div>`}</div></div>`;
  hydrateIcons(host);
  $('#edClose').onclick = () => { S.editor = null; mountEditor(); };
  const lenIn = $('#edLen'); if (lenIn) lenIn.onchange = () => edit('Clip length', (s) => SG.updateClip(s, c.id, { length: Math.max(0.25, +lenIn.value) * SG.bpb(s) }));
  if ($('#edQuant')) $('#edQuant').onclick = quantize;
  if ($('#edVel')) $('#edVel').onclick = async () => { const v = await promptBox({ title: 'Velocity', text: 'For the selected notes (or all of them if none are selected).', label: '0–127', type: 'number', value: 100, ok: 'Set' }); if (v != null) notesEdit('Velocity', (ns) => { for (const n of ns) if (!ED.sel.size || ED.sel.has(n)) n.v = Math.max(0.02, Math.min(1, +v / 127)); }); };
  $('#edGrip').onmousedown = (e) => { const y0 = e.clientY, h0 = ED.h; const mv = (ev) => { ED.h = Math.max(180, Math.min(innerHeight - 260, h0 - (ev.clientY - y0))); $('.ed-pane').style.height = ED.h + 'px'; drawEditor(); }; const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); }; addEventListener('mousemove', mv); addEventListener('mouseup', up); };
  if (kind === 'notes') bindPianoRoll(); else if (kind === 'drums') bindDrumGrid(); else bindAudioEditor();
  drawEditor();
}
function syncEdBar() { const c = clip(S.editor); const l = $('#edLen'); if (c && l && document.activeElement !== l) l.value = +(SG.clipLength(S.song, c) / SG.bpb(S.song)).toFixed(2); }
function drawEditor() { const p = $('.ed-pane'); if (!p) return; const k = p.dataset.kind; if (k === 'notes') drawPianoRoll(); else if (k === 'drums') drawDrumGrid(); else drawAudioEditor(); }
const cssv = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function fitCanvas(cv) { const r = cv.parentElement.getBoundingClientRect(); const dpr = devicePixelRatio || 1; const w = Math.max(10, Math.floor(r.width)), h = Math.max(10, Math.floor(r.height)); if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; cv.style.width = w + 'px'; cv.style.height = h + 'px'; } const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); return { g, w, h }; }

// ───────── piano roll
function notesEdit(label, fn) { const c = clip(S.editor); if (!c) return; const idx = (n) => c.notes.indexOf(n); const selIdx = [...ED.sel].map(idx); fn(c.notes); c.notes.sort((a, b) => a.t - b.t); const keep = selIdx.map((i) => c.notes[i]); edit(label, () => {}, { render: false }); const c2 = clip(S.editor); ED.sel = new Set(keep.filter(Boolean).map((n) => c2.notes.find((x) => x.t === n.t && x.p === n.p && x.d === n.d)).filter(Boolean)); drawEditor(); redrawClipThumb(); }
function redrawClipThumb() { const c = clip(S.editor); const el = c && $(`#tl .clip[data-c="${c.id}"] canvas`); if (el) drawThumb(el, c, track(c.track)); }
function prMetrics(w) { const c = clip(S.editor); const L = SG.clipLength(S.song, c); if (!ED.ppb) ED.ppb = Math.max(18, Math.min(120, (w - KEYW - 20) / Math.max(L, 4))); return { c, L, P: ED.ppb }; }
function drawPianoRoll() {
  const cv = $('#prCv'); if (!cv) return; const { g, w, h } = fitCanvas(cv); const { c, L, P } = prMetrics(w); const t = track(c.track); const s = S.song; const B = SG.bpb(s); const R = ED.rowH;
  let K = null; try { K = TH.parseKey(s.key); } catch {}
  const dark = document.documentElement.dataset.theme !== 'light';
  g.fillStyle = cssv('--lane'); g.fillRect(0, 0, w, h);
  const rows = Math.ceil(h / R) + 1;
  for (let i = 0; i < rows; i++) { const p = ED.sy - i; const y = i * R; const pc = ((p % 12) + 12) % 12; const black = [1, 3, 6, 8, 10].includes(pc);
    g.fillStyle = K && TH.inKey(p, K) ? (dark ? 'rgba(62,200,255,0.055)' : 'rgba(10,147,209,0.06)') : black ? (dark ? 'rgba(0,0,0,0.22)' : 'rgba(10,40,70,0.05)') : 'transparent'; g.fillRect(KEYW, y, w, R);
    g.fillStyle = cssv('--grid'); g.fillRect(KEYW, y + R - 1, w, 1); if (pc === 0) { g.fillStyle = cssv('--grid-2'); g.fillRect(KEYW, y + R - 1, w, 1); }
    // keys
    g.fillStyle = black ? (dark ? '#1b232c' : '#3a4652') : (dark ? '#cfd9e2' : '#ffffff'); g.fillRect(0, y, KEYW - 2, R - 1);
    if (pc === 0 || R >= 16) { g.fillStyle = black ? '#9fb0c0' : '#334455'; g.font = `${pc === 0 ? 700 : 500} 10px system-ui`; g.textBaseline = 'middle'; g.fillText(TH.midiToName(p, K && K.flats), 4, y + R / 2); }
  }
  const x0 = (b) => KEYW + (b - ED.sx) * P;
  for (let b = Math.floor(ED.sx); x0(b) < w; b += snapB() && snapB() < 1 && P * snapB() > 10 ? snapB() : 1) { if (b < 0) continue; const x = Math.round(x0(b)); const bar = Math.abs(b % B) < 1e-6; g.fillStyle = bar ? cssv('--grid-3') : Math.abs(b % 1) < 1e-6 ? cssv('--grid-2') : cssv('--grid'); g.fillRect(x, 0, 1, h); if (bar) { g.fillStyle = cssv('--mut'); g.font = '600 10px system-ui'; g.fillText(String(SG.beatToBar(s, c.start + b)), x + 4, 8); } }
  // outside the clip
  g.fillStyle = dark ? 'rgba(0,0,0,0.35)' : 'rgba(10,40,70,0.08)'; const xe = x0(L); if (xe < w) g.fillRect(xe, 0, w - xe, h);
  const col = c.color || t.color;
  for (const n of c.notes) { const y = (ED.sy - n.p) * R; if (y < -R || y > h) continue; const x = x0(n.t), ww = Math.max(4, n.d * P - 1); const sel = ED.sel.has(n);
    g.globalAlpha = 0.45 + n.v * 0.55; g.fillStyle = col; rrect(g, x, y + 1, ww, R - 2, 3); g.fill(); g.globalAlpha = 1; g.strokeStyle = sel ? cssv('--fg') : 'rgba(0,0,0,0.35)'; g.lineWidth = sel ? 2 : 1; g.stroke(); }
  if (ED.marquee) { const m = ED.marquee; g.fillStyle = 'rgba(62,200,255,0.12)'; g.strokeStyle = cssv('--acc'); g.lineWidth = 1; g.fillRect(m.x, m.y, m.w, m.h); g.strokeRect(m.x + 0.5, m.y + 0.5, m.w, m.h); }
  // playhead
  const pb = Player.position() - c.start; if (pb >= 0 && pb <= L) { g.fillStyle = cssv('--fg'); g.fillRect(x0(pb), 0, 2, h); }
  drawVel();
}
function drawVel() {
  const cv = $('#velCv'); if (!cv) return; const { g, w, h } = fitCanvas(cv); const c = clip(S.editor); if (!c) return; const P = ED.ppb; const col = c.color || track(c.track).color;
  g.fillStyle = cssv('--lane-2'); g.fillRect(0, 0, w, h); g.fillStyle = cssv('--mut'); g.font = '600 10px system-ui'; g.fillText('Velocity', 4, 12);
  for (const n of c.notes) { const x = KEYW + (n.t - ED.sx) * P; if (x < KEYW - 4 || x > w) continue; const vh = (h - 8) * n.v; g.fillStyle = col; g.globalAlpha = ED.sel.size && !ED.sel.has(n) ? 0.35 : 0.9; g.fillRect(x, h - vh, 3, vh); g.fillRect(x - 2, h - vh, 7, 3); } g.globalAlpha = 1;
}
function rrect(g, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function bindPianoRoll() {
  const cv = $('#prCv'); const wrap = $('#prWrap');
  const at = (e) => { const r = cv.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top; return { x, y, beat: ED.sx + (x - KEYW) / ED.ppb, pitch: ED.sy - Math.floor(y / ED.rowH) }; };
  const hit = (q) => { const c = clip(S.editor); for (let i = c.notes.length - 1; i >= 0; i--) { const n = c.notes[i]; if (n.p === q.pitch && q.beat >= n.t && q.beat <= n.t + n.d) return { n, edge: (n.t + n.d - q.beat) * ED.ppb < 7 }; } return null; };
  wrap.onwheel = (e) => { e.preventDefault(); if (e.ctrlKey || e.metaKey) { const q = at(e); ED.ppb = Math.max(6, Math.min(300, ED.ppb * (e.deltaY < 0 ? 1.12 : 0.89))); ED.sx = Math.max(0, q.beat - (q.x - KEYW) / ED.ppb); } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) ED.sx = Math.max(0, ED.sx + (e.deltaX || e.deltaY) / ED.ppb); else ED.sy = Math.max(12, Math.min(127, ED.sy - Math.sign(e.deltaY) * Math.max(1, Math.round(Math.abs(e.deltaY) / 30)))); drawPianoRoll(); };
  cv.oncontextmenu = (e) => { e.preventDefault(); const h = hit(at(e)); if (h) notesEdit('Delete note', (ns) => { ns.splice(ns.indexOf(h.n), 1); ED.sel.delete(h.n); }); };
  cv.onmousedown = (e) => {
    if (e.button !== 0) return; const q = at(e); const c = clip(S.editor); const t = track(c.track);
    if (q.x < KEYW) { Player.preview({ track: t, midi: q.pitch, dur: 0.5 }); return; }
    const h = hit(q); const sn = snapB() || 0.25;
    if (!h && e.shiftKey) { ED.marquee = { x: q.x, y: q.y, w: 0, h: 0 }; const x0 = q.x, y0 = q.y; const mv = (ev) => { const p = at(ev); ED.marquee = { x: Math.min(x0, p.x), y: Math.min(y0, p.y), w: Math.abs(p.x - x0), h: Math.abs(p.y - y0) }; const b0 = ED.sx + (ED.marquee.x - KEYW) / ED.ppb, b1 = b0 + ED.marquee.w / ED.ppb, p0 = ED.sy - Math.floor((ED.marquee.y + ED.marquee.h) / ED.rowH), p1 = ED.sy - Math.floor(ED.marquee.y / ED.rowH); ED.sel = new Set(c.notes.filter((n) => n.p >= p0 && n.p <= p1 && n.t + n.d > b0 && n.t < b1)); drawPianoRoll(); }; const up = () => { ED.marquee = null; removeEventListener('mousemove', mv); removeEventListener('mouseup', up); drawPianoRoll(); }; addEventListener('mousemove', mv); addEventListener('mouseup', up); return; }
    let target, mode;
    if (h) { target = h.n; mode = h.edge ? 'len' : 'move'; if (e.shiftKey) { ED.sel.has(target) ? ED.sel.delete(target) : ED.sel.add(target); drawPianoRoll(); return; } if (!ED.sel.has(target)) { ED.sel = new Set([target]); } Player.preview({ track: t, midi: target.p, dur: 0.3, vel: target.v }); }
    else { const b = Math.max(0, Math.floor(q.beat / sn) * sn); if (b >= SG.clipLength(S.song, c)) return; target = { p: q.pitch, t: +b.toFixed(4), d: ED.lastLen, v: 0.8 }; c.notes.push(target); ED.sel = new Set([target]); mode = 'len'; Player.preview({ track: t, midi: q.pitch, dur: 0.3 }); }
    const group = [...ED.sel].map((n) => ({ n, t: n.t, p: n.p, d: n.d })); const q0 = q; let changed = !h;
    const mv = (ev) => { const p = at(ev); const db = p.beat - q0.beat; const dp = p.pitch - q0.pitch;
      if (mode === 'move') { const sd = snapB() ? Math.round(db / sn) * sn : db; for (const g0 of group) { g0.n.t = +Math.max(0, g0.t + sd).toFixed(4); g0.n.p = Math.max(0, Math.min(127, g0.p + dp)); } }
      else for (const g0 of group) g0.n.d = +Math.max(sn / 2, snapB() ? Math.round((g0.d + db) / sn) * sn || sn : g0.d + db).toFixed(4);
      changed = true; drawPianoRoll(); };
    let lastP = target.p; const mv2 = (ev) => { mv(ev); if (mode === 'move' && target.p !== lastP) { lastP = target.p; Player.preview({ track: t, midi: target.p, dur: 0.2, vel: target.v }); } };
    const up = () => { removeEventListener('mousemove', mv2); removeEventListener('mouseup', up); if (mode === 'len') ED.lastLen = target.d; if (changed) notesEdit(h ? (mode === 'move' ? 'Move notes' : 'Note length') : 'Add note', () => {}); };
    addEventListener('mousemove', mv2); addEventListener('mouseup', up);
  };
  cv.ondblclick = (e) => { const h = hit(at(e)); if (h) notesEdit('Delete note', (ns) => { ns.splice(ns.indexOf(h.n), 1); ED.sel.delete(h.n); }); };
  const vc = $('#velCv'); vc.onmousedown = (e) => { const c = clip(S.editor); const r = vc.getBoundingClientRect(); const setAt = (ev) => { const x = ev.clientX - r.left, v = Math.max(0.02, Math.min(1, (r.bottom - ev.clientY - 2) / (r.height - 8))); let best = null, bd = 8; for (const n of c.notes) { const nx = KEYW + (n.t - ED.sx) * ED.ppb; const d = Math.abs(nx - x); if (d < bd && (!ED.sel.size || ED.sel.has(n))) { bd = d; best = n; } } if (best) { best.v = +v.toFixed(3); drawPianoRoll(); } }; setAt(e); const up = () => { removeEventListener('mousemove', setAt); removeEventListener('mouseup', up); notesEdit('Velocity', () => {}); }; addEventListener('mousemove', setAt); addEventListener('mouseup', up); };
}
function quantize() { const sn = snapB() || 0.25; notesEdit('Quantize', (ns) => { for (const n of ns) if (!ED.sel.size || ED.sel.has(n)) { n.t = +(Math.round(n.t / sn) * sn).toFixed(4); n.d = +Math.max(sn, Math.round(n.d / sn) * sn).toFixed(4); } }); }
// keys while the editor is open (called from transport.js)
function onEditorKey(e) {
  const p = $('.ed-pane'); if (!p || S.view !== 'arrange') return false; const c = clip(S.editor); if (!c) return false; const mod = e.metaKey || e.ctrlKey;
  if (e.key === 'Escape') { S.editor = null; mountEditor(); return true; }
  if (p.dataset.kind !== 'notes') return false;
  if (mod && e.key.toLowerCase() === 'a') { ED.sel = new Set(c.notes); drawPianoRoll(); return true; }
  if (e.key.toLowerCase() === 'q' && !mod) { quantize(); return true; }
  if (!ED.sel.size) return false;
  if (e.key === 'Delete' || e.key === 'Backspace') { notesEdit('Delete notes', (ns) => { for (const n of [...ED.sel]) ns.splice(ns.indexOf(n), 1); ED.sel.clear(); }); return true; }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { const d = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1); notesEdit('Transpose', () => { for (const n of ED.sel) n.p = Math.max(0, Math.min(127, n.p + d)); }); const n = [...ED.sel][0]; if (n) Player.preview({ track: track(c.track), midi: n.p, dur: 0.25 }); return true; }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { const d = (e.key === 'ArrowRight' ? 1 : -1) * (snapB() || 0.25); notesEdit('Nudge', () => { for (const n of ED.sel) n.t = +Math.max(0, n.t + d).toFixed(4); }); return true; }
  if (mod && e.key.toLowerCase() === 'd') { const L = Math.max(...[...ED.sel].map((n) => n.t + n.d)) - Math.min(...[...ED.sel].map((n) => n.t)); notesEdit('Duplicate notes', (ns) => { const add = [...ED.sel].map((n) => ({ ...n, t: +(n.t + L).toFixed(4) })); ns.push(...add); ED.sel = new Set(add); }); return true; }
  return false;
}

// ───────── drum grid
const DG = { rowH: 22, labelW: 108 };
function drumRows(c, t) { const base = t.sound === 'fx' ? ['riser', 'downlifter', 'impact', 'crash', 'kick', 'snare'] : ['kick', 'snare', 'clap', 'rim', 'hat', 'openhat', 'tom_low', 'tom_mid', 'tom_high', 'crash', 'ride', 'shaker', 'cowbell', 'perc', 'snap']; const used = [...new Set(c.notes.map((n) => n.p))]; return [...base, ...used.filter((v) => !base.includes(v))]; }
function drawDrumGrid() {
  const cv = $('#prCv'); if (!cv) return; const c = clip(S.editor); const t = track(c.track); const s = S.song; const L = SG.clipLength(s, c); const steps = Math.round(L * 4); const rows = drumRows(c, t);
  const wrap = $('#prWrap'); const avail = wrap.clientWidth - DG.labelW - 12; const cw = Math.max(16, Math.min(44, avail / steps)); const W = DG.labelW + steps * cw + 8, H = rows.length * DG.rowH + 4;
  const dpr = devicePixelRatio || 1; cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'; const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); DG.cw = cw; DG.rows = rows; DG.steps = steps;
  g.fillStyle = cssv('--lane'); g.fillRect(0, 0, W, H); const col = c.color || t.color; const B = SG.bpb(s) * 4;
  rows.forEach((v, r) => { const y = r * DG.rowH; g.fillStyle = r % 2 ? cssv('--lane-2') : cssv('--lane'); g.fillRect(0, y, W, DG.rowH); g.fillStyle = cssv('--fg-2'); g.font = '600 11.5px system-ui'; g.textBaseline = 'middle'; g.fillText(v.replace('_', ' ') + (t.pads && t.pads[v] ? ' ●' : ''), 10, y + DG.rowH / 2);
    for (let k = 0; k < steps; k++) { const x = DG.labelW + k * cw; g.fillStyle = k % B < 4 && Math.floor(k / 4) % 2 === 0 ? cssv('--panel-2') : cssv('--panel'); if (k % 4 === 0) g.fillStyle = cssv('--panel-3'); g.globalAlpha = 0.55; rrect(g, x + 1.5, y + 2.5, cw - 3, DG.rowH - 5, 4); g.fill(); g.globalAlpha = 1; } });
  for (let k = 0; k <= steps; k += B) { g.fillStyle = cssv('--grid-3'); g.fillRect(DG.labelW + k * cw - 0.5, 0, 1, H); }
  for (const n of c.notes) { const r = rows.indexOf(n.p); if (r < 0) continue; const k = Math.round(n.t * 4); const off = n.t * 4 - k; const x = DG.labelW + (k + off) * cw, y = r * DG.rowH; g.fillStyle = col; g.globalAlpha = 0.35 + n.v * 0.65; rrect(g, x + 1.5, y + 2.5, cw - 3, DG.rowH - 5, 4); g.fill(); g.globalAlpha = 1; if (n.v >= 0.95) { g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(x + cw / 2 - 2, y + DG.rowH / 2 - 2, 4, 4); } }
  const pb = Player.position() - c.start; if (pb >= 0 && pb <= L) { g.fillStyle = cssv('--fg'); g.fillRect(DG.labelW + pb * 4 * cw, 0, 2, H); }
}
function bindDrumGrid() {
  const cv = $('#prCv');
  const at = (e) => { const r = cv.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top; return { x, row: Math.floor(y / DG.rowH), step: Math.floor((x - DG.labelW) / DG.cw) }; };
  cv.oncontextmenu = (e) => { e.preventDefault(); const q = at(e); const c = clip(S.editor); const t = track(c.track); const v = DG.rows[q.row]; if (!v || q.x > DG.labelW) return; const pad = t.pads && t.pads[v];
    menu(null, [{ header: true, label: v.replace('_', ' ') }, { label: 'Use my own sample…', icon: 'import', run: async () => { const f = await call('dialog:audio'); if (f) padFromFile(t, v, f[0]); } }, ...(pad ? [{ label: 'Back to the kit sound', icon: 'refresh', run: () => edit('Kit sound', (s) => { const tt = SG.findTrack(s, t.id); delete tt.pads[v]; }) }] : []), { label: 'Clear this row', icon: 'trash', danger: true, run: () => notesEdit('Clear row', (ns) => { for (let i = ns.length - 1; i >= 0; i--) if (ns[i].p === v) ns.splice(i, 1); }) }], { x: e.clientX, y: e.clientY, width: 230 }); };
  cv.onmousedown = (e) => {
    if (e.button !== 0) return; const q = at(e); const c = clip(S.editor); const t = track(c.track); const v = DG.rows[q.row]; if (!v) return;
    if (q.x < DG.labelW) { Player.preview({ track: t, voice: v }); return; }
    if (q.step < 0 || q.step >= DG.steps) return; const vel = e.shiftKey ? 1 : e.altKey ? 0.5 : 0.85;
    const existing = c.notes.find((n) => n.p === v && Math.round(n.t * 4) === q.step); const adding = !existing; const done = new Set();
    const paint = (step, row) => { const vv = DG.rows[row]; if (vv !== v || step < 0 || step >= DG.steps || done.has(step)) return; done.add(step); const ex = c.notes.find((n) => n.p === v && Math.round(n.t * 4) === step); if (adding && !ex) { c.notes.push({ p: v, t: step / 4, d: 0.25, v: vel }); Player.preview({ track: t, voice: v, vel }); } else if (!adding && ex) c.notes.splice(c.notes.indexOf(ex), 1); drawDrumGrid(); };
    paint(q.step, q.row); const mv = (ev) => { const p = at(ev); paint(p.step, q.row); }; const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); notesEdit(adding ? 'Add hits' : 'Remove hits', () => {}); }; addEventListener('mousemove', mv); addEventListener('mouseup', up);
  };
}
async function padFromFile(t, voice, file) {
  // the sample is copied into the song like any import; the pad points at the copy
  try { const r = await call('audio:import', [file], {}); const imp = r[0]; await reloadSong(); edit(`Sample on ${voice}`, (s) => { const tt = SG.findTrack(s, t.id); tt.pads = { ...(tt.pads || {}), [voice]: { file: imp.clip.file, gain: 0, tune: 0 } }; const ic = SG.findClip(s, imp.clip.id, { must: false }); if (ic) { const at = SG.findTrack(s, ic.track); SG.removeClip(s, ic.id); if (!s.clips.some((c) => c.track === at.id)) SG.removeTrack(s, at.id); } }); await Assets.get(imp.clip.file); toast('Sample assigned', `${voice.replace('_', ' ')} now plays ${baseName(file)}`); } catch (e) { fail(e); }
}

// ───────── audio clip editor
function drawAudioEditor() {
  const cv = $('#auCv'); if (!cv) return; const { g, w, h } = fitCanvas(cv); const c = clip(S.editor); if (!c) return; const t = track(c.track); const col = c.color || t.color;
  g.fillStyle = cssv('--lane'); g.fillRect(0, 0, w, h);
  const buf = Assets.raw.get(c.file); if (!buf) { g.fillStyle = cssv('--mut'); g.fillText('Loading…', 20, 20); Assets.get(c.file).then(drawAudioEditor).catch(() => {}); return; }
  const xs = (sec) => 10 + (sec / c.srcDur) * (w - 20); const rows = Math.min(2, buf.numberOfChannels); const hh = (h - 30) / rows;
  for (let ch = 0; ch < rows; ch++) { const pk = MXAnalysis.peaks(buf.getChannelData(ch), w - 20); const mid = 18 + hh * ch + hh / 2; for (let x = 0; x < w - 20; x++) { const sec = (x / (w - 20)) * c.srcDur; const inside = sec >= c.offset && sec <= c.offset + c.dur; g.fillStyle = col; g.globalAlpha = inside ? 0.9 : 0.25; const lo = pk[2 * x], hi = pk[2 * x + 1]; g.fillRect(10 + x, mid - hi * hh * 0.45, 1, Math.max(1, (hi - lo) * hh * 0.45)); } } g.globalAlpha = 1;
  const a = xs(c.offset), b = xs(c.offset + c.dur); g.strokeStyle = cssv('--fg'); g.lineWidth = 2; g.strokeRect(a, 14, b - a, h - 24); g.fillStyle = cssv('--fg'); g.fillRect(a - 3, h / 2 - 14, 6, 28); g.fillRect(b - 3, h / 2 - 14, 6, 28);
  g.fillStyle = cssv('--mut'); g.font = '600 11px system-ui'; g.fillText(`${c.offset.toFixed(2)}s`, a + 6, 11); g.textAlign = 'right'; g.fillText(`${(c.offset + c.dur).toFixed(2)}s of ${c.srcDur.toFixed(1)}s`, b - 6, 11); g.textAlign = 'left';
  ED.au = { xs, w };
}
function bindAudioEditor() {
  const c = clip(S.editor); const side = $('#auSide'); const i = c.info || {};
  const row = (k, label, min, max, step, val, fmt) => `<div class="kv"><span>${label}</span><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${val}"><output data-o="${k}">${fmt(val)}</output></div>`;
  const F = { gain: (v) => fmtDb(+v) + ' dB', fadeIn: (v) => (+v).toFixed(2) + 's', fadeOut: (v) => (+v).toFixed(2) + 's', pitch: (v) => (+v > 0 ? '+' : '') + (+v) + ' st', stretch: (v) => '×' + (+v).toFixed(2), speed: (v) => '×' + (+v).toFixed(2) };
  side.innerHTML = `<div class="info-chips">${i.bpm ? `<span class="pill info">${i.bpm} BPM</span>` : ''}${i.key ? `<span class="pill info">${esc(i.key)}</span>` : ''}${i.lufs != null ? `<span class="pill">${i.lufs} LUFS</span>` : ''}<span class="pill">${esc(c.file)}</span></div>
    ${row('gain', 'Gain', -24, 12, 0.5, c.gain, F.gain)}${row('fadeIn', 'Fade in', 0, Math.min(10, c.dur / 2), 0.01, c.fadeIn, F.fadeIn)}${row('fadeOut', 'Fade out', 0, Math.min(10, c.dur / 2), 0.01, c.fadeOut, F.fadeOut)}
    <div class="label" style="margin-top:4px">Time and pitch</div>
    ${row('pitch', 'Pitch', -12, 12, 1, c.pitch, F.pitch)}${row('stretch', 'Stretch', 0.5, 2, 0.01, c.stretch, F.stretch)}${row('speed', 'Tape speed', 0.5, 2, 0.01, c.speed, F.speed)}
    <div class="row" style="flex-wrap:wrap"><label class="chk"><input type="checkbox" id="auRev" ${c.reverse ? 'checked' : ''}>Reverse</label><span class="grow"></span>${i.bpm ? `<button class="btn xs" id="auFit">${icon('stretch', 13)}Fit to ${S.song.bpm} BPM</button>` : ''}<button class="btn xs ghost" id="auReset">Reset</button></div>
    <div class="hint">Pitch keeps the tempo, stretch keeps the pitch, tape speed changes both. Best within ±3 semitones and ×0.75–1.33.</div>`;
  $$('input[type=range]', side).forEach((r) => { r.oninput = () => { $(`[data-o="${r.dataset.k}"]`, side).textContent = F[r.dataset.k](r.value); }; r.onchange = () => edit(`Clip ${r.dataset.k}`, (s) => SG.updateClip(s, c.id, { [r.dataset.k]: +r.value }), { render: false }) && (refreshClipEl(), drawAudioEditor()); r.ondblclick = () => { r.value = { gain: 0, fadeIn: 0.005, fadeOut: 0.01, pitch: 0, stretch: 1, speed: 1 }[r.dataset.k]; r.oninput(); r.onchange(); }; });
  $('#auRev').onchange = (e) => { edit('Reverse', (s) => SG.updateClip(s, c.id, { reverse: e.target.checked })); };
  if ($('#auFit')) $('#auFit').onclick = () => { edit('Fit to tempo', (s) => { const r = [i.bpm, i.bpm * 2, i.bpm / 2].map((b) => b / s.bpm).sort((a, b) => Math.abs(Math.log(a)) - Math.abs(Math.log(b)))[0]; SG.updateClip(s, c.id, { stretch: +r.toFixed(4) }); }); render(); };
  $('#auReset').onclick = () => { edit('Reset clip', (s) => SG.updateClip(s, c.id, { gain: 0, pitch: 0, stretch: 1, speed: 1, reverse: false })); render(); };
  const cv = $('#auCv'); cv.onmousedown = (e) => { if (!ED.au) return; const r = cv.getBoundingClientRect(); const x = e.clientX - r.left; const a = ED.au.xs(c.offset), b = ED.au.xs(c.offset + c.dur); const edge = Math.abs(x - a) < 10 ? 'a' : Math.abs(x - b) < 10 ? 'b' : null; if (!edge) return; const toSec = (px) => Math.max(0, Math.min(c.srcDur, ((px - 10) / (ED.au.w - 20)) * c.srcDur)); let off = c.offset, end = c.offset + c.dur;
    const mv = (ev) => { const sx = toSec(ev.clientX - r.left); if (edge === 'a') off = Math.min(end - 0.05, sx); else end = Math.max(off + 0.05, sx); const cc = clip(S.editor); cc.offset = off; cc.dur = end - off; drawAudioEditor(); };
    const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); edit('Trim', (s) => { const cc = SG.findClip(s, c.id); cc.offset = off; cc.dur = end - off; SG.updateClip(s, c.id, {}); }); };
    addEventListener('mousemove', mv); addEventListener('mouseup', up); };
}
function refreshClipEl() { if (S.view === 'arrange') { const tl = $('#tl'); const sx = tl && tl.scrollLeft, sy = tl && tl.scrollTop; drawTimeline(); if (tl) { tl.scrollLeft = sx; tl.scrollTop = sy; } } }
// keep the open editor's playhead moving
setInterval(() => { if (Player.playing && $('.ed-pane') && S.view === 'arrange') { const k = $('.ed-pane').dataset.kind; if (k === 'notes') drawPianoRoll(); else if (k === 'drums') drawDrumGrid(); } }, 60);
