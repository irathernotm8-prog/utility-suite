// Mixer window: playback (the same engine as export), the transport bar, the playhead and meters, and shortcuts.
'use strict';
const Assets = new MXEngine.Assets((f) => D.readAudio(f));
const Player = new MXEngine.Player(Assets);
const KEYS = (() => { const o = []; for (const n of ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']) for (const m of ['major', 'minor']) o.push(`${n} ${m}`); for (const n of ['C', 'D', 'E', 'F', 'G', 'A', 'B']) for (const m of ['dorian', 'mixolydian', 'phrygian', 'lydian']) o.push(`${n} ${m}`); return o; })();

function transportHTML({ extra = '' } = {}) {
  const s = S.song; const keyOpts = KEYS.includes(s.key) ? KEYS : [s.key, ...KEYS];
  return `<div class="transport" id="tp">
    <button class="icon-btn" id="tpStart" title="To the start (Return)">${icon('toStart', 17)}</button>
    <button class="tp-play ${Player.playing ? 'on' : ''}" id="tpPlay" title="Play / stop (Space)">${icon(Player.playing ? 'stop' : 'play', 17)}</button>
    <button class="icon-btn tog ${s.loop.on ? 'on' : ''}" id="tpLoop" title="Loop (L) — drag the bar above the ruler to set it">${icon('loop', 17)}</button>
    <button class="icon-btn tog ${Player.metronome ? 'on' : ''}" id="tpClick" title="Metronome (K)">${icon('metronome', 17)}</button>
    <div class="tp-pos"><b id="tpBar">1.1.1</b><span id="tpTime">0:00.0</span></div>
    <label class="tp-field">BPM<input id="tpBpm" type="number" min="30" max="300" step="0.1" value="${s.bpm}"></label>
    <label class="tp-field">Key<select id="tpKey">${keyOpts.map((k) => `<option ${k === s.key ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
    <label class="tp-field">Time<select id="tpSig">${['4/4', '3/4', '6/8', '5/4', '7/8', '12/8', '2/4'].map((x) => `<option ${x === s.timeSig.join('/') ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
    <div class="mini-meter" title="Master level"><i id="mmL"></i><i id="mmR"></i></div>
    <span class="grow"></span>${extra}
  </div>`;
}
function bindTransport() {
  const s = S.song;
  $('#tpPlay').onclick = togglePlay; $('#tpStart').onclick = () => Player.seek(s.loop.on ? s.loop.start : 0);
  $('#tpLoop').onclick = () => edit(S.song.loop.on ? 'Loop off' : 'Loop on', (x) => { x.loop.on = !x.loop.on; if (x.loop.end <= x.loop.start) { x.loop.start = 0; x.loop.end = SG.bpb(x) * 4; } });
  $('#tpClick').onclick = (e) => { Player.metronome = !Player.metronome; e.currentTarget.classList.toggle('on', Player.metronome); call('settings:set', { metronome: Player.metronome }); };
  $('#tpBpm').onchange = (e) => { const v = Math.max(30, Math.min(300, +e.target.value || 120)); edit('Tempo ' + v, (x) => { x.bpm = v; }); };
  $('#tpKey').onchange = (e) => edit('Key ' + e.target.value, (x) => { x.key = e.target.value; });
  $('#tpSig').onchange = (e) => edit('Time signature', (x) => { x.timeSig = e.target.value.split('/').map(Number); });
}
async function togglePlay() {
  if (Player.playing) { Player.stop(); return; }
  try { await Player.play(Player.pos || 0); } catch (e) { fail(e); }
}
Player.on(({ playing }) => { const b = $('#tpPlay'); if (b) { b.classList.toggle('on', playing); b.innerHTML = icon(playing ? 'stop' : 'play', 17); } });

// one animation loop for the position readout, playhead and meters
const peakHold = {};
function frame() {
  if (S.song) {
    const pos = Player.position(); const s = S.song;
    const bar = $('#tpBar'); if (bar) { bar.textContent = SG.fmtPos(s, pos); $('#tpTime').textContent = fmtTime(pos * SG.spb(s)); }
    if (typeof drawPlayhead === 'function') drawPlayhead(pos);
    const m = Player.playing ? Player.meters() : null;
    const lvl = (v) => Math.max(0, Math.min(100, ((20 * Math.log10(Math.max(1e-5, v)) + 54) / 54) * 100));
    const set = (el, v, key) => { if (!el) return; const L = lvl(v); peakHold[key] = Math.max(L, (peakHold[key] || 0) - 1.6); el.style.setProperty('--l', peakHold[key].toFixed(1) + '%'); };
    set($('#mmL'), m ? m.master[0] : 0, 'mL'); set($('#mmR'), m ? m.master[1] : 0, 'mR');
    if (S.view === 'mix') { $$('[data-meter]').forEach((el) => set(el, m ? (el.dataset.meter === 'mL' ? m.master[0] : el.dataset.meter === 'mR' ? m.master[1] : m.tracks[el.dataset.meter] || 0) : 0, el.dataset.meter)); }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// shortcuts (not while typing)
document.addEventListener('keydown', (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName) && document.activeElement.type !== 'range';
  if (typing || $('#sheetHost').firstChild) return;
  const mod = e.metaKey || e.ctrlKey;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'Enter') { Player.seek(S.song.loop.on ? S.song.loop.start : 0); }
  else if (e.key.toLowerCase() === 'l' && !mod) { $('#tpLoop') && $('#tpLoop').click(); }
  else if (e.key.toLowerCase() === 'k' && !mod) { $('#tpClick') && $('#tpClick').click(); }
  else if (typeof onEditorKey === 'function' && onEditorKey(e)) e.preventDefault();
  else if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel.clip && S.view === 'arrange') { const c = clip(S.sel.clip); if (c) { edit('Delete clip', (s) => SG.removeClip(s, c.id)); S.sel.clip = null; S.editor = null; render(); } }
  else if (mod && e.key.toLowerCase() === 'd' && S.sel.clip) { e.preventDefault(); const c = clip(S.sel.clip); if (c) { const [n] = edit('Duplicate clip', (s) => SG.duplicateClip(s, c.id)) || []; if (n) { S.sel.clip = n.id; refresh(); } } }
  else if (e.key.toLowerCase() === 's' && !mod && S.sel.clip && S.view === 'arrange') { splitAtPlayhead(); }
});
function splitAtPlayhead() { const c = clip(S.sel.clip); if (!c) return; const b = Player.position(); if (b <= c.start || b >= SG.clipEnd(S.song, c)) { toast('Move the playhead inside the clip to split it', '', 'info', 2500); return; } edit('Split clip', (s) => SG.splitClip(s, c.id, Math.round(b * 4) / 4)); }
