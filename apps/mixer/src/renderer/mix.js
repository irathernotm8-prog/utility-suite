// Mixer window: Mix — a console. One strip per track (effects in order, pan, fader, meter, mute/solo) and the master
// strip with its chain, meters and "Check mix": loudness, peaks, tonal balance against typical ranges, width, and
// plain-language notes — the same measurements Claude gets.
'use strict';
const BANDS = [['sub', 'Sub', 8, 20], ['bass', 'Bass', 25, 40], ['low_mids', 'Low mids', 8, 15], ['mids', 'Mids', 15, 25], ['high_mids', 'High mids', 6, 15], ['air', 'Air', 1, 6]];
VIEWS.mix = {
  flush: true,
  head() { return `<h1>Mix</h1><span class="muted small">${esc(S.song.name)}</span>`; },
  actions() { return `<button class="icon-btn" id="undoBtn">${icon('undo', 17)}</button><button class="icon-btn" id="redoBtn">${icon('redo', 17)}</button><span class="vsep"></span><button class="btn sm primary" id="expBtn">${icon('export', 15)}Export</button>`; },
  render(view) { view.innerHTML = `${transportHTML()}<div class="console" id="console"></div>`; bindTransport(); bindHead(); drawConsole(); },
  update() { const c = $('#console'); if (!c) return render(); const sx = c.scrollLeft; syncTransport(); drawConsole(); $('#console').scrollLeft = sx; },
};
function drawConsole() {
  const host = $('#console'); const s = S.song;
  host.innerHTML = s.tracks.map((t) => strip(t)).join('') + masterStrip() + (s.tracks.length ? '' : `<div class="empty" style="flex:1"><b>No tracks yet</b><span>Add tracks in Arrange; each one gets a strip here.</span></div>`);
  hydrateIcons(host);
  $$('.strip[data-t]', host).forEach((el) => bindStrip(el, track(el.dataset.t)));
  bindMaster();
  if (S.check) drawCheck(S.check);
}
function fxPills(list, target) { return `<div class="fxl">${list.map((f, i) => `<button class="fxp ${f.on ? '' : 'off'}" data-fx="${f.id}" data-target="${target}"><i></i><span class="grow ellip">${esc(SND.EFFECTS[f.type].name)}</span><span class="muted tiny">${fxSummary(f)}</span></button>`).join('')}<button class="fx-add" data-add="${target}">+ Effect</button></div>`; }
function fxSummary(f) { switch (f.type) { case 'reverb': case 'delay': case 'chorus': return Math.round(f.mix * 100) + '%'; case 'compressor': return f.ratio + ':1'; case 'limiter': return (f.gain > 0 ? '+' : '') + f.gain; case 'filter': return f.cutoff >= 1000 ? (f.cutoff / 1000).toFixed(1) + 'k' : Math.round(f.cutoff); case 'drive': return Math.round(f.amount * 100) + '%'; case 'duck': return f.amount + 'dB'; case 'width': return '×' + f.width; case 'crush': return f.bits + 'b'; default: return ''; } }
function strip(t) {
  const snd = t.kind === 'audio' ? 'Audio' : t.kind === 'drums' ? (SND.kit(t.sound) || {}).name : (SND.instrument(t.sound) || {}).name; const auto = t.automation && Object.keys(t.automation).length;
  return `<div class="strip ${S.sel.track === t.id ? 'sel' : ''}" data-t="${t.id}"><div class="st-name"><i style="background:${t.color}"></i><span>${esc(t.name)}</span>${auto ? '<span class="auto-badge" title="Automated: ' + Object.keys(t.automation).join(', ') + '">A</span>' : ''}</div><div class="st-snd">${esc(snd || '')}</div>
    ${fxPills(t.effects, t.id)}
    <div class="st-pan"><input type="range" min="-1" max="1" step="0.05" value="${t.pan}" data-a="pan"><span data-o="pan">${panLabel(t.pan)}</span></div>
    <div class="st-fader"><div class="vfader" data-a="vol" data-min="-48" data-max="6" title="${auto && t.automation.volume ? 'Volume is automated' : 'Drag; double-click for 0 dB'}"><i></i><b></b></div><div class="vmeter"><b data-meter="${t.id}"></b></div></div>
    <div class="st-db" data-o="vol">${fmtDb(t.volume)} dB</div>
    <div class="st-btns"><button class="ms m ${t.mute ? 'on' : ''}" data-a="mute">M</button><button class="ms s ${t.solo ? 'on' : ''}" data-a="solo">S</button></div></div>`;
}
const panLabel = (p) => (Math.abs(p) < 0.025 ? 'C' : (p < 0 ? 'L' : 'R') + Math.round(Math.abs(p) * 100));
function masterStrip() {
  const m = S.song.master;
  return `<div class="strip master"><div class="st-name"><i style="background:var(--acc)"></i><span>Master</span><span class="grow"></span><button class="btn xs primary" id="checkBtn">${icon('critic', 13)}Check mix</button></div>
    <div class="mgrid">
      <div class="mleft">${fxPills(m.effects, 'master')}<div class="check" id="checkOut"><div class="hint">Check mix renders the song and measures loudness, peaks, tonal balance and width — the same report Claude reads.</div></div></div>
      <div class="mright"><div class="st-fader"><div class="vfader" id="mVol" data-min="-24" data-max="6" title="Drag; double-click for 0 dB"><i></i><b></b></div><div class="vmeter pair"><span><b data-meter="mL"></b></span><span><b data-meter="mR"></b></span></div></div><div class="st-db" id="mDb">${fmtDb(m.volume)} dB</div></div>
    </div></div>`;
}
function bindStrip(el, t) {
  el.onmousedown = () => { S.sel.track = t.id; $$('.strip').forEach((x) => x.classList.toggle('sel', x === el)); };
  fader($('[data-a=vol]', el), t.volume, (v) => { t.volume = v; $('[data-o=vol]', el).textContent = fmtDb(v) + ' dB'; Player.setSong(S.song); }, (v) => edit('Volume', (s) => { SG.updateTrack(s, t.id, { volume: v }); }, { render: false }));
  const pan = $('[data-a=pan]', el); pan.oninput = () => { t.pan = +pan.value; rangeFill(pan); $('[data-o=pan]', el).textContent = panLabel(t.pan); Player.setSong(S.song); }; pan.onchange = () => edit('Pan', (s) => { SG.updateTrack(s, t.id, { pan: +pan.value }); }, { render: false }); pan.ondblclick = () => { pan.value = 0; pan.oninput(); pan.onchange(); };
  $('[data-a=mute]', el).onclick = () => edit('Mute', (s) => { SG.updateTrack(s, t.id, { mute: !t.mute }); });
  $('[data-a=solo]', el).onclick = () => edit('Solo', (s) => { SG.updateTrack(s, t.id, { solo: !t.solo }); });
  bindFx(el);
}
function bindMaster() {
  fader($('#mVol'), S.song.master.volume, (v) => { S.song.master.volume = v; $('#mDb').textContent = fmtDb(v) + ' dB'; Player.setSong(S.song); }, (v) => edit('Master volume', (s) => { s.master.volume = v; }, { render: false }));
  bindFx($('.strip.master')); $('#checkBtn').onclick = checkMix;
}
function bindFx(root) {
  $$('[data-fx]', root).forEach((b) => b.onclick = () => fxEditor(b, b.dataset.target, b.dataset.fx));
  $$('[data-add]', root).forEach((b) => b.onclick = () => menu(b, Object.entries(SND.EFFECTS).filter(([k]) => b.dataset.add !== 'master' || k !== 'duck').map(([k, e]) => ({ label: e.name, hint: '', run: () => { const f = edit(`Add ${e.name}`, (s) => SG.addEffect(s, b.dataset.add, { type: k })); if (f) setTimeout(() => { const p = $(`[data-fx="${f.id}"]`); if (p) fxEditor(p, b.dataset.add, f.id); }, 30); } })), { width: 220 }));
}
// one effect's settings, live while you drag
function fxEditor(anchor, target, id) {
  const list = SG.fxList(S.song, target); const f = list.find((x) => x.id === id); if (!f) return; const spec = SND.EFFECTS[f.type]; const idx = list.indexOf(f);
  const ctl = Object.entries(spec.params).map(([k, [min, max, def, unit]]) => {
    if (typeof def === 'string') { if (k === 'mode') return `<div class="kv"><span>Type</span><select class="select sm" data-k="${k}" style="grid-column:span 2">${['lowpass', 'highpass', 'bandpass', 'notch'].map((m) => `<option ${f[k] === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>`; if (k === 'source') return `<div class="kv"><span>Follow</span><select class="select sm" data-k="${k}" style="grid-column:span 2"><option value="">—</option>${S.song.tracks.filter((t) => t.id !== target).map((t) => `<option value="${esc(t.name)}" ${f.source === t.name || f.source === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>`; if (k === 'voice') return `<div class="kv"><span>Voice</span><select class="select sm" data-k="${k}" style="grid-column:span 2">${['any', ...TH.DRUM_VOICES].map((v) => `<option ${f.voice === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>`; return `<div class="kv"><span>${esc(label(k))}</span><input class="input sm" data-k="${k}" value="${esc(f[k])}" style="grid-column:span 2" placeholder="${esc(unit)}"></div>`; }
    if (k === 'pingpong') return `<div class="kv"><span>Ping-pong</span><label class="chk" style="grid-column:span 2"><input type="checkbox" data-k="${k}" ${+f[k] ? 'checked' : ''}>Bounce left and right</label></div>`;
    if (k === 'pan' && f.type === 'tremolo') return `<div class="kv"><span>Mode</span><label class="chk" style="grid-column:span 2"><input type="checkbox" data-k="${k}" ${+f[k] ? 'checked' : ''}>Auto-pan</label></div>`;
    if ((k === 'time' || k === 'rate' || k === 'lfoRate') && typeof f[k] === 'string') return `<div class="kv"><span>${esc(label(k))}</span><select class="select sm" data-k="${k}" style="grid-column:span 2">${['1/1', '1/2', '1/4', '1/4d', '1/4t', '1/8', '1/8d', '1/8t', '1/16', '1/16t', '1/32'].map((v) => `<option ${f[k] === v ? 'selected' : ''}>${v}</option>`).join('')}<option value="__s">Seconds / Hz…</option></select></div>`;
    const log = /freq|cut|tone|Freq/.test(k) && min > 0; const toR = (v) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
    return `<div class="kv" data-log="${log ? 1 : 0}" data-min="${min}" data-max="${max}"><span>${esc(label(k))}</span><input type="range" data-k="${k}" min="0" max="1" step="0.001" value="${toR(+f[k]).toFixed(4)}"><output>${fmtParam(k, +f[k], unit)}</output></div>`;
  }).join('');
  const pop = popAt(anchor, `<div class="fx-pop"><div class="fx-h">${icon('fx', 16)}<span>${esc(spec.name)}</span><label class="chk"><input type="checkbox" id="fxOn" ${f.on ? 'checked' : ''}>On</label></div><div class="fx-d">${esc(spec.desc)}</div>${ctl}
    <div class="row" style="margin-top:4px"><button class="icon-btn sm" id="fxUp" ${idx === 0 ? 'disabled' : ''} title="Earlier in the chain">${icon('up', 15)}</button><button class="icon-btn sm" id="fxDown" ${idx === list.length - 1 ? 'disabled' : ''} title="Later in the chain">${icon('down', 15)}</button><span class="grow"></span><button class="btn xs danger" id="fxDel">${icon('trash', 13)}Remove</button></div></div>`, { width: 340, onClose: () => { if (dirty) edit(`${spec.name} settings`, () => {}, { render: true }); } });
  let dirty = false;
  const live = (k, v) => { const ff = SG.fxList(S.song, target).find((x) => x.id === id); ff[k] = v; dirty = true; Player.setSong(S.song); const pl = $(`[data-fx="${id}"] .muted`); if (pl) pl.textContent = fxSummary(ff); };
  $$('[data-k]', pop).forEach((inp) => {
    const k = inp.dataset.k; const row = inp.closest('.kv');
    if (inp.type === 'range') { const min = +row.dataset.min, max = +row.dataset.max, log = row.dataset.log === '1'; inp.oninput = () => { rangeFill(inp); const r = +inp.value; let v = log ? min * Math.pow(max / min, r) : min + r * (max - min); v = round(k, v); $('output', row).textContent = fmtParam(k, v, spec.params[k][3]); live(k, v); }; inp.ondblclick = () => { const d = spec.params[k][2]; inp.value = log ? Math.log(d / min) / Math.log(max / min) : (d - min) / (max - min); inp.oninput(); }; }
    else if (inp.type === 'checkbox') inp.onchange = () => live(k, inp.checked ? 1 : 0);
    else inp.onchange = async () => { let v = inp.value; if (v === '__s') { const x = await promptBox({ title: label(k), label: k === 'time' ? 'Seconds' : 'Hz', type: 'number', value: k === 'time' ? 0.3 : 2 }); if (x == null) return; v = +x; } live(k, v); };
  });
  $('#fxOn', pop).onchange = (e) => { closePop(); edit(e.target.checked ? `${spec.name} on` : `${spec.name} off`, (s) => { SG.updateEffect(s, target, id, { on: e.target.checked }); }); };
  $('#fxDel', pop).onclick = () => { dirty = false; closePop(); edit(`Remove ${spec.name}`, (s) => { SG.removeEffect(s, target, id); }); };
  const move = (d) => { dirty = false; closePop(); edit('Reorder effects', (s) => { const l = SG.fxList(s, target); const i = l.findIndex((x) => x.id === id); const [x] = l.splice(i, 1); l.splice(Math.max(0, Math.min(l.length, i + d)), 0, x); }); };
  $('#fxUp', pop).onclick = () => move(-1); $('#fxDown', pop).onclick = () => move(1);
}
const LABELS = { lowcut: 'Low cut', lowFreq: 'Low freq', midFreq: 'Mid freq', midQ: 'Mid width', highFreq: 'High freq', highcut: 'High cut', low: 'Low', mid: 'Mid', high: 'High', lfoRate: 'LFO rate', lfoDepth: 'LFO depth', monoBelow: 'Mono below', predelay: 'Pre-delay', makeup: 'Make-up' };
const label = (k) => LABELS[k] || k[0].toUpperCase() + k.slice(1);
function round(k, v) { if (/Freq|cut|tone|cutoff|monoBelow/.test(k)) return Math.round(v); if (/ratio|bits/.test(k)) return Math.round(v * (k === 'bits' ? 1 : 10)) / (k === 'bits' ? 1 : 10); if (/attack/.test(k)) return Math.round(v * 10000) / 10000; return Math.round(v * 100) / 100; }
function fmtParam(k, v, unit) { if (/Hz/.test(unit) && v >= 1000) return (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k'; if (unit === 'wet' || /mix|depth|amount|feedback/.test(k)) return Math.round(v * 100) + '%'; if (unit === 's') return v < 0.1 ? Math.round(v * 1000) + 'ms' : v.toFixed(2) + 's'; if (/dB/.test(unit)) return (v > 0 ? '+' : '') + v.toFixed(1); if (unit === ':1') return v.toFixed(1) + ':1'; return String(+v.toFixed(2)); }

// ───────── check mix
async function checkMix() {
  const out = $('#checkOut'); const b = $('#checkBtn'); b.disabled = true; out.innerHTML = `<div class="row muted"><span class="spin"></span>Rendering and measuring…</div>`;
  try { const r = await call('analyze', { target: 'mix', targetLufs: S.settings.normalize || -14 }); S.check = r; drawCheck(r); } catch (e) { out.innerHTML = `<div class="cnote major">${icon('alert', 14)}<div>${esc(e.message)}</div></div>`; } finally { if ($('#checkBtn')) $('#checkBtn').disabled = false; }
}
function drawCheck(r) {
  const out = $('#checkOut'); if (!out) return; const R = r.report;
  out.innerHTML = `<div class="big"><div><span>Loudness</span><b>${R.loudness_lufs}</b><span>LUFS</span></div><div><span>Peak</span><b style="color:${R.peak_dbfs > -0.5 ? 'var(--bad)' : 'inherit'}">${R.peak_dbfs}</b><span>dBFS</span></div></div>
    <div class="bal">${BANDS.map(([k, l, lo, hi]) => `<span>${l}</span><span class="bt"><s style="left:${lo * 2}%;width:${(hi - lo) * 2}%"></s><b style="width:${Math.min(100, R.balance[k] * 2)}%"></b></span><span class="tnum">${Math.round(R.balance[k])}%</span>`).join('')}</div>
    <div class="muted tiny">Dashed boxes: typical for a finished pop/electronic mix. Width ${R.stereo.width} · low end ${R.stereo.low_width} · ${R.key ? esc(R.key.key) : ''}</div>
    ${R.notes.map((n) => `<div class="cnote ${n.level}">${icon(n.level === 'major' ? 'alert' : n.level === 'minor' ? 'info' : 'check', 14)}<div>${esc(n.msg)}${n.fix ? `<em>${esc(n.fix)}</em>` : ''}</div></div>`).join('')}
    ${r.picture ? `<img src="${r.picture}" id="checkImg" title="Click to enlarge">` : ''}`;
  hydrateIcons(out); const im = $('#checkImg'); if (im) im.onclick = () => lightbox(r.picture);
}

// a console fader: drag the cap (or anywhere on the slot), Shift for fine moves, double-click for 0 dB
function fader(el, value, onInput, onChange) {
  const min = +el.dataset.min, max = +el.dataset.max; let v = value;
  const show = () => { const p = (v - min) / (max - min); el.style.setProperty('--f', p.toFixed(4)); };
  show();
  el.onmousedown = (e) => { e.preventDefault(); const r = el.getBoundingClientRect(); const y0 = e.clientY, v0 = v; const onCap = e.target.tagName === 'B';
    const at = (ev) => { if (onCap || ev.shiftKey) { const k = ev.shiftKey ? 0.25 : 1; return v0 - ((ev.clientY - y0) / r.height) * (max - min) * k; } return min + (1 - (ev.clientY - r.top) / r.height) * (max - min); };
    const mv = (ev) => { v = Math.round(Math.max(min, Math.min(max, at(ev))) * 2) / 2; show(); onInput(v); };
    const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); if (v !== v0) onChange(v); };
    if (!onCap) mv(e); addEventListener('mousemove', mv); addEventListener('mouseup', up); };
  el.ondblclick = () => { v = 0; show(); onInput(0); onChange(0); };
}
