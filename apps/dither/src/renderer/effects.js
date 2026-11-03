// Dither — Effects (the kept ones) and the Effect lab: live preview, sliders from params, frame strip, code editor
// with every version kept, notes, record and export.
'use strict';

VIEWS.effects = {
  title: 'Effects',
  actions() { return `<button class="btn" id="fxAsk">${icon('chat', 15)}Ask Claude</button><button class="btn primary" id="fxNew">${icon('plus', 15)}New effect</button>`; },
  render(view) {
    const list = S.effects.filter((e) => e.kept || !e.boardId);
    if (!list.length) { view.innerHTML = `<div class="hero-empty"><div class="hero-glyph">${icon('effects', 40)}</div><h2>No effects kept yet</h2><p>Pick drafts on a board, start from a starter effect, or write one in the lab. Effects are code, so they stay easy to reshape and export to games.</p><div class="row" style="justify-content:center"><button class="btn primary lg" id="heroNew">${icon('plus', 16)}New effect</button><button class="btn lg" id="heroLib">${icon('book', 16)}Starter effects</button></div></div>`; $('#heroNew').onclick = newEffectMenu; $('#heroLib').onclick = () => go('library'); return; }
    view.innerHTML = `<div class="card-grid">${list.map((m) => `<div class="fx-card" data-id="${m.id}"><div class="d-stage loading"></div><div class="d-body"><div class="row"><div class="d-name grow ellip">${esc(m.name)}</div><span class="pill">v${m.current}</span><button class="icon-btn xs d-more">${icon('more', 15)}</button></div><div class="d-idea">${esc(byWho(m.by))} · ${esc(ago(m.updatedAt))}${openNotes(m) ? ` · <b class="acc-t">${plural(openNotes(m), 'open note')}</b>` : ''}</div></div></div>`).join('')}</div>`;
    $$('.fx-card', view).forEach((el) => { const id = el.dataset.id; mountEffect($('.d-stage', el), id, { bg: S.settings.previewBg || 'checker', max: 6 }); $('.d-stage', el).onclick = () => go('lab', id); $('.d-more', el).onclick = (e) => effectMenu(e.currentTarget, id); });
  },
  after() { const n = $('#fxNew'); if (n) n.onclick = (e) => newEffectMenu(e.currentTarget); $('#fxAsk').onclick = () => askClaude('Make a new effect: '); },
};

const BLANK = `effect({
  name: 'New effect', size: [32, 32], frames: 12, fps: 12, palette: 'pico8', loop: true, seed: 1,
  params: { radius: { value: 8, min: 2, max: 14, step: 1 } },
  draw(g, { t, cx, cy, params, TAU, ease }) {
    const r = params.radius * (0.6 + 0.4 * Math.sin(t * TAU));
    g.glow(cx, cy, r + 4, [10, 9, 8], 0.8);
    g.fillCircle(cx, cy, r * 0.5, 7);
  }
})`;
async function newEffectMenu(anchor) {
  const lib = await call('library:list');
  const items = [{ label: 'Blank effect', icon: 'code', run: async () => { const m = await call('effects:create', { name: 'New effect', code: BLANK }); await loadProject(); go('lab', m.id); } }, '-', { header: true, label: 'Start from a starter effect' }, ...lib.map((l) => ({ label: l.name, hint: l.group, run: async () => { const m = await call('library:add', l.id); await loadProject(); go('lab', m.id); } }))];
  menu(anchor && anchor.getBoundingClientRect ? anchor : $('#fxNew') || $('#nav'), items, { width: 280, align: 'right' });
}
function effectMenu(anchor, id) {
  const m = effectById(id);
  menu(anchor, [{ label: 'Open in the lab', icon: 'code', run: () => go('lab', id) }, { label: 'Duplicate', icon: 'dup', run: async () => { await call('effects:duplicate', id); await loadProject(); render(); } }, { label: 'Bake into a sprite', icon: 'bake', run: () => bakeEffect(id) }, '-', { label: 'Record GIF + sheet', icon: 'record', run: async () => filesDone(await call('record', { kind: 'effect', id }).catch(fail), 'Recorded') }, { label: 'Export…', icon: 'export', run: () => exportMenu(anchor, 'effect', id, m.name) }, '-', { label: 'Delete', icon: 'trash', danger: true, run: async () => { if (await confirmBox({ title: `Delete “${m.name}”?`, text: 'It moves to the project’s .trash folder, with all its versions.', ok: 'Delete', danger: true })) { await call('effects:remove', id); await loadProject(); render(); } } }], { width: 240, align: 'right' });
}
async function bakeEffect(id) { try { const sid = await call('sprites:bake', id); await loadProject(); toast('Baked into a sprite', 'Every frame is now editable by hand'); go('editor', sid); } catch (e) { fail(e); } }
function exportMenu(anchor, kind, id, name) {
  const run = (format, extra = {}) => async () => filesDone(await call('export', { kind, id, format, ...extra }).catch(fail), 'Exported');
  menu(anchor, [{ header: true, label: `Export “${name}”` }, { label: 'Sprite sheet + JSON', hint: 'engines', icon: 'frames', run: run('sheet') }, { label: 'Sprite sheet grid + JSON', hint: '8 per row', icon: 'grid', run: run('sheet', { cols: 8 }) }, { label: 'GIF (actual size)', icon: 'film', run: run('gif') }, { label: 'GIF (4× for sharing)', icon: 'film', run: run('gif', { scale: 4 }) }, { label: 'PNG frames', icon: 'refs', run: run('frames') }, ...(kind === 'effect' ? [{ label: 'JS module for web games and sites', icon: 'code', run: run('module') }] : []), '-', { label: 'Export to a folder…', icon: 'folder', run: async () => { const f = await new Promise((res) => menu(anchor, [{ label: 'Sprite sheet + JSON', run: () => res('sheet') }, { label: 'GIF', run: () => res('gif') }, ...(kind === 'effect' ? [{ label: 'JS module', run: () => res('module') }] : [])], { align: 'right' })); filesDone(await call('export', { kind, id, format: f, ask: true }).catch(fail), 'Exported'); } }], { width: 300, align: 'right' });
}

// ───────────────────────── the lab
const Lab = { id: null, m: null, code: '', saved: '', meta: null, frames: null, params: {}, player: null, err: null, t: null, dirty: false, version: null };
VIEWS.lab = {
  flush: true,
  head() { const m = effectById(S.arg); return `<button class="icon-btn" id="labBack" title="Effects">${icon('back', 18)}</button><input class="title-input" id="labName" value="${esc(m ? m.name : '')}" spellcheck="false"><span class="pill" id="labVer"></span><span class="save-state" id="labState"></span>`; },
  actions() { return `<button class="btn" id="labBake">${icon('bake', 15)}Bake to sprite</button><button class="btn" id="labRec">${icon('record', 15)}Record</button><button class="btn" id="labExport">${icon('export', 15)}Export</button><button class="btn primary" id="labSave">${icon('save', 15)}Save version</button>`; },
  render(view) {
    const m = effectById(S.arg); if (!m) { view.innerHTML = `<div class="empty"><b>That effect is gone</b></div>`; return; }
    Object.assign(Lab, { id: m.id, m, err: null, dirty: false, params: { ...(m.params || {}) }, version: null });
    view.innerHTML = `<div class="lab">
      <div class="lab-left">
        <div class="stage-wrap"><div class="stage" id="labStage"><canvas></canvas></div><div class="stage-err" id="labErr" hidden></div></div>
        <div class="transport"><button class="icon-btn sm" id="tBack">${icon('stepBack', 15)}</button><button class="icon-btn sm" id="tPlay">${icon('pause', 15)}</button><button class="icon-btn sm" id="tFwd">${icon('stepFwd', 15)}</button><span class="rv-frame tnum" id="tFrame">–</span><span class="muted small tnum" id="tInfo"></span><span class="grow"></span>
          <div class="seg sm" id="tSpeed">${[0.25, 0.5, 1, 2].map((s) => `<button data-s="${s}" class="${s === 1 ? 'on' : ''}">${s}×</button>`).join('')}</div>
          <div class="seg sm" id="tBg">${BG_OPTS.map(([k, l]) => `<button data-bg="${k}" class="${(S.settings.previewBg || 'checker') === k ? 'on' : ''}">${l}</button>`).join('')}</div>
          <button class="icon-btn sm" id="tOnion" title="Onion skin">${icon('onion', 16)}</button><button class="icon-btn sm" id="tGrid" title="Pixel grid">${icon('grid', 16)}</button></div>
        <div class="filmstrip lab-strip" id="labStrip"></div>
        <div class="params" id="labParams"></div>
      </div>
      <div class="lab-right">
        <div class="lab-tabs seg"><button data-tab="code" class="on">${icon('code', 14)}Code</button><button data-tab="notes">${icon('note', 14)}Notes<b id="labNoteN"></b></button><button data-tab="versions">${icon('refresh', 14)}Versions</button></div>
        <div class="lab-pane" id="paneCode"><div class="code-ed"><pre class="ce-gutter" id="ceGut"></pre><div class="ce-body"><pre class="ce-hl" id="ceHl" aria-hidden="true"></pre><textarea id="ceText" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea></div></div>
          <div class="ce-foot"><span class="muted tiny">Runs as you type · ${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+S saves a version · the full kit is in Claude’s guide</span><span class="grow"></span><button class="link-btn" id="ceRef">Drawing kit</button></div></div>
        <div class="lab-pane" id="paneNotes" hidden><div class="notes" id="labNotes"></div><textarea class="input area" id="labNote" rows="3" placeholder="A note for Claude about this effect…"></textarea><div class="row"><label class="chk"><input type="checkbox" id="labAt" checked> about frame <b id="labAtN">1</b></label><span class="grow"></span><button class="btn sm" id="labAskFix">${icon('sparkle', 14)}Ask Claude to address notes</button><button class="btn sm primary" id="labAddNote">Add note</button></div></div>
        <div class="lab-pane" id="paneVersions" hidden><div class="versions" id="labVersions"></div></div>
      </div></div>`;
    Lab.player = new Player($('#labStage canvas'), { pad: 24, max: 24, bg: S.settings.previewBg || 'checker', onFrame: (i) => { $('#tFrame').textContent = `${i + 1} / ${Lab.player.frames.length}`; $('#labAtN').textContent = i + 1; $$('#labStrip .fs').forEach((t, k) => t.classList.toggle('on', k === i)); } });
    wireLab(view); loadLabCode();
  },
  leave() { if (Lab.dirty && Lab.code !== Lab.saved) { call('effects:update', Lab.id, { code: Lab.code, note: 'Edited in the lab' }).then(loadProject).catch(() => {}); toast('Saved your edits as a new version', Lab.m.name); } Lab.dirty = false; clearTimeout(Lab.t); },
};

async function loadLabCode(version) {
  const e = await call('effects:get', Lab.id, version); Lab.code = Lab.saved = e.code; Lab.version = e.version; Lab.m = e;
  $('#ceText').value = e.code; paintCode(); $('#labVer').textContent = `v${e.version}${e.version !== e.versions.length ? ` of ${e.versions.length}` : ''}`; setState('');
  renderLab(); drawLabNotes(); drawVersions();
}
function setState(t, busy) { const el = $('#labState'); if (el) { el.textContent = t; el.classList.toggle('busy', !!busy); } }
async function renderLab() {
  const my = (Lab.seq = (Lab.seq || 0) + 1);
  try {
    const r = await Frames.code(Lab.code, { params: Lab.params }); if (my !== Lab.seq) return;
    Lab.meta = r.meta; Lab.frames = r.frames; Lab.err = null; $('#labErr').hidden = true; $('#ceGut') && paintCode();
    Lab.player.set(r.frames, r.meta);
    $('#tFrame').textContent = `${Lab.player.i + 1} / ${r.frames.length}`; $('#tInfo').textContent = `${r.meta.w}×${r.meta.h} · ${r.meta.durations.reduce((a, b) => a + b, 0)} ms${r.meta.loop ? ' · loops' : ''}`;
    drawStrip(); drawParams();
  } catch (e) { if (my !== Lab.seq) return; Lab.err = e; const el = $('#labErr'); el.hidden = false; el.innerHTML = `${icon('alert', 15)}<span>${esc(e.message)}${e.line ? ` <b>· line ${e.line}</b>` : ''}</span>`; paintCode(); }
}
function drawStrip() {
  const r = { meta: Lab.meta, frames: Lab.frames }; const strip = $('#labStrip'); const s = Math.max(1, Math.floor(40 / Math.max(r.meta.w, r.meta.h)));
  strip.innerHTML = r.frames.map((_, i) => `<button class="fs${i === Lab.player.i ? ' on' : ''}"><canvas width="${r.meta.w}" height="${r.meta.h}" style="width:${r.meta.w * s}px;height:${r.meta.h * s}px"></canvas><span>${i + 1}${r.meta.durations[i] !== r.meta.durations[0] ? ` · ${r.meta.durations[i]}` : ''}</span></button>`).join('');
  $$('.fs', strip).forEach((b, i) => { $('canvas', b).getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(r.frames[i]), r.meta.w, r.meta.h), 0, 0); b.onclick = () => { Lab.player.pause(); $('#tPlay').innerHTML = icon('play', 15); Lab.player.seek(i); }; });
}
function drawParams() {
  const spec = Lab.meta.paramSpec || {}; const keys = Object.keys(spec); const host = $('#labParams');
  if (!keys.length) { host.innerHTML = `<div class="muted small">No sliders. Effects get sliders from <code>params: { name: { value, min, max, step } }</code>.</div>`; return; }
  if (host.dataset.keys === keys.join(',') && host.children.length) { keys.forEach((k) => { const v = Lab.meta.params[k]; const o = $(`[data-out="${k}"]`, host); if (o) o.textContent = fmtNum(v); }); return; }
  host.dataset.keys = keys.join(',');
  host.innerHTML = `<div class="params-head">${icon('sliders', 14)}Parameters<span class="grow"></span><button class="link-btn" id="pReset">Reset</button></div>` + keys.map((k) => { const p = spec[k]; const v = Lab.meta.params[k]; const isNum = typeof v === 'number';
    return `<div class="prm"><label>${esc(p.label || k)}</label>${isNum && p.min != null ? `<input type="range" data-k="${k}" min="${p.min}" max="${p.max}" step="${p.step || (Number.isInteger(p.value) ? 1 : 0.01)}" value="${v}"><span class="prm-v tnum" data-out="${k}">${fmtNum(v)}</span>` : typeof v === 'boolean' ? `<button class="switch ${v ? 'on' : ''}" data-b="${k}"></button>` : `<input class="input sm" data-t="${k}" value="${esc(v)}">`}</div>`; }).join('');
  $$('[data-k]', host).forEach((inp) => inp.oninput = () => { Lab.params[inp.dataset.k] = Number(inp.value); $(`[data-out="${inp.dataset.k}"]`, host).textContent = fmtNum(Number(inp.value)); scheduleRun(80); persistParams(); });
  $$('[data-b]', host).forEach((b) => b.onclick = () => { const k = b.dataset.b; Lab.params[k] = !(Lab.params[k] ?? Lab.meta.params[k]); b.classList.toggle('on', Lab.params[k]); scheduleRun(0); persistParams(); });
  $$('[data-t]', host).forEach((inp) => inp.onchange = () => { let v = inp.value; try { v = JSON.parse(v); } catch {} Lab.params[inp.dataset.t] = v; scheduleRun(0); persistParams(); });
  $('#pReset').onclick = () => { Lab.params = {}; host.dataset.keys = ''; persistParams(); scheduleRun(0); };
}
const fmtNum = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v));
let ppT = null; function persistParams() { clearTimeout(ppT); ppT = setTimeout(() => { call('effects:patch', Lab.id, { params: Lab.params }).then(() => Frames.drop(Lab.id)).catch(() => {}); }, 500); }
function scheduleRun(ms = 450) { clearTimeout(Lab.t); setState('Running…', true); Lab.t = setTimeout(async () => { await renderLab(); setState(Lab.code !== Lab.saved ? 'Edited — not saved' : ''); }, ms); }

// a light JS highlighter for the code editor
const KW = /\b(const|let|var|function|return|if|else|for|while|of|in|new|true|false|null|undefined|break|continue|switch|case|default|this|typeof)\b/;
function highlight(src) {
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)/g;
  let out = '', last = 0, m;
  while ((m = re.exec(src))) { out += esc(src.slice(last, m.index)); const t = esc(m[0]); if (m[1]) out += `<i class="tk-com">${t}</i>`; else if (m[2]) out += `<i class="tk-str">${t}</i>`; else if (m[3]) out += `<i class="tk-num">${t}</i>`; else if (m[4]) out += KW.test(m[4]) ? `<i class="tk-kw">${t}</i>` : `<i class="tk-fn">${t}</i>`; else out += KW.test(m[5]) && m[5].match(KW)[0] === m[5] ? `<i class="tk-kw">${t}</i>` : t; last = re.lastIndex; }
  return out + esc(src.slice(last)) + '\n';
}
function paintCode() { const ta = $('#ceText'); if (!ta) return; $('#ceHl').innerHTML = highlight(ta.value); const n = ta.value.split('\n').length; const bad = Lab.err && Lab.err.line; $('#ceGut').innerHTML = Array.from({ length: n }, (_, i) => (i + 1 === bad ? `<b>${i + 1}</b>` : i + 1)).join('\n'); syncScroll(); }
function syncScroll() { const ta = $('#ceText'); $('#ceHl').style.transform = `translate(${-ta.scrollLeft}px,${-ta.scrollTop}px)`; $('#ceGut').style.transform = `translateY(${-ta.scrollTop}px)`; }

function wireLab(view) {
  const ta = $('#ceText');
  ta.oninput = () => { Lab.code = ta.value; Lab.dirty = true; paintCode(); setState('Edited — not saved'); scheduleRun(); };
  ta.onscroll = syncScroll;
  ta.onkeydown = (e) => {
    if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('  ', s, ta.selectionEnd, 'end'); ta.oninput(); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveVersion(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); scheduleRun(0); }
  };
  $('#labBack').onclick = () => go('effects');
  $('#labName').onchange = async (e) => { await call('effects:update', Lab.id, { name: e.target.value.trim() || Lab.m.name, code: undefined }); await loadProject(); };
  $('#labSave').onclick = saveVersion;
  $('#labBake').onclick = () => bakeEffect(Lab.id);
  $('#labRec').onclick = (e) => menu(e.currentTarget, [{ label: 'GIF + contact sheet', icon: 'film', run: async () => { await flushSave(); filesDone(await call('record', { kind: 'effect', id: Lab.id }).catch(fail), 'Recorded'); } }, { label: 'Video (WebM)', icon: 'record', run: async () => { if (!Lab.frames) return; const t = toast('Recording video…', '', 'busy', 0); try { const f = await call('save:webm', Lab.frames, Lab.meta, Lab.m.name); t.remove(); filesDone({ files: [f] }, 'Recorded'); } catch (er) { t.remove(); fail(er); } } }, { label: 'Copy current frame (8×)', icon: 'copy', run: () => { call('clipboard:image', Lab.frames[Lab.player.i], Lab.meta.w, Lab.meta.h, 8); toast('Copied'); } }], { width: 240, align: 'right' });
  $('#labExport').onclick = async (e) => { await flushSave(); exportMenu(e.currentTarget, 'effect', Lab.id, Lab.m.name); };
  const p = () => Lab.player;
  $('#tPlay').onclick = () => { p().toggle(); $('#tPlay').innerHTML = icon(p().playing ? 'pause' : 'play', 15); };
  $('#tBack').onclick = () => { p().step(-1); $('#tPlay').innerHTML = icon('play', 15); };
  $('#tFwd').onclick = () => { p().step(1); $('#tPlay').innerHTML = icon('play', 15); };
  $('#tOnion').onclick = (e) => { p().setOpt('onion', !p().o.onion); e.currentTarget.classList.toggle('on', p().o.onion); };
  $('#tGrid').onclick = (e) => { p().setOpt('grid', !p().o.grid); e.currentTarget.classList.toggle('on', !!p().o.grid); };
  $$('#tSpeed [data-s]').forEach((b) => b.onclick = () => { p().setOpt('speed', +b.dataset.s); $$('#tSpeed button').forEach((x) => x.classList.toggle('on', x === b)); });
  $$('#tBg [data-bg]').forEach((b) => b.onclick = () => { p().setOpt('bg', b.dataset.bg); $$('#tBg button').forEach((x) => x.classList.toggle('on', x === b)); });
  $$('.lab-tabs [data-tab]').forEach((b) => b.onclick = () => { $$('.lab-tabs button').forEach((x) => x.classList.toggle('on', x === b)); $('#paneCode').hidden = b.dataset.tab !== 'code'; $('#paneNotes').hidden = b.dataset.tab !== 'notes'; $('#paneVersions').hidden = b.dataset.tab !== 'versions'; });
  $('#labAddNote').onclick = async () => { const t = $('#labNote').value.trim(); if (!t) return; await call('effects:feedback', Lab.id, { note: t, frame: $('#labAt').checked ? p().i + 1 : null }); $('#labNote').value = ''; await loadProject(); drawLabNotes(); };
  $('#labAskFix').onclick = () => askClaude(`Address my open notes on the effect “${Lab.m.name}” (id ${Lab.id}): read them with get_feedback, then update_effect and resolve the ones you fix.`);
  $('#ceRef').onclick = kitSheet;
  view.addEventListener('keydown', (e) => { if (e.target === ta || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return; if (e.key === ' ') { e.preventDefault(); $('#tPlay').click(); } });
}
async function flushSave() { if (Lab.code !== Lab.saved) await saveVersion(true); }
async function saveVersion(quiet) {
  if (Lab.code === Lab.saved) { if (quiet !== true) toast('No changes to save'); return; }
  try { const m = await call('effects:update', Lab.id, { code: Lab.code, note: 'Edited in the lab' }); Lab.saved = Lab.code; Lab.dirty = false; Frames.drop(Lab.id); await loadProject(); $('#labVer').textContent = `v${m.current}`; setState('Saved'); drawVersions(); if (quiet !== true) toast(`Saved v${m.current}`, Lab.m.name); }
  catch (e) { fail(e); }
}
function drawLabNotes() { const m = effectById(Lab.id); const n = m ? openNotes(m) : 0; const b = $('#labNoteN'); if (b) b.textContent = n ? ` ${n}` : ''; notesList($('#labNotes'), Lab.id, (i) => { Lab.player.pause(); Lab.player.seek(i); }); }
function drawVersions() {
  const m = effectById(Lab.id); const host = $('#labVersions'); if (!m || !host) return;
  host.innerHTML = [...m.versions].reverse().map((v) => `<div class="ver ${v.v === Lab.version ? 'on' : ''}"><div class="ver-n">v${v.v}</div><div class="grow"><div class="ver-note">${esc(v.note || (v.v === 1 ? 'First version' : 'Edited'))}</div><div class="muted tiny">${esc(byWho(v.by))} · ${esc(ago(v.at))}${v.v === m.current ? ' · current' : ''}</div></div>${v.v === Lab.version ? '' : `<button class="btn xs" data-v="${v.v}">Look</button>`}${v.v !== m.current ? `<button class="btn xs" data-use="${v.v}">Make current</button>` : ''}</div>`).join('');
  $$('[data-v]', host).forEach((b) => b.onclick = () => loadLabCode(+b.dataset.v));
  $$('[data-use]', host).forEach((b) => b.onclick = async () => { await call('effects:patch', Lab.id, { current: +b.dataset.use }); Frames.drop(Lab.id); await loadProject(); loadLabCode(); toast(`v${b.dataset.use} is current again`); });
}
function kitSheet() {
  const rows = [['g.px(x,y,c)', 'one pixel'], ['g.line(x0,y0,x1,y1,c)', 'pixel-perfect line'], ['g.rect / g.fillRect(x,y,w,h,c)', 'boxes'], ['g.circle / g.fillCircle(cx,cy,r,c)', 'circles'], ['g.ring(cx,cy,r,t,c)', 'thick ring'], ['g.ellipse / g.fillEllipse(cx,cy,rx,ry,c)', 'ellipses'], ['g.poly(points,c)', 'filled polygon'], ['g.flood(x,y,c)', 'bucket fill'], ['g.ditherPx(x,y,c,level)', 'fade a pixel by dithering'], ['g.dither(x,y,w,h,c,level)', 'dithered area'], ['g.ditherCircle(cx,cy,r,c,level)', 'dithered disc'], ['g.glow(cx,cy,r,[bright…dim],s)', 'glow without blur'], ['g.outline(c)', 'outline what’s drawn'], ['g.text(str,x,y,c,scale)', '3×5 pixel font'], ['g.symmetry(x,y)', 'mirror drawing'], ['g.ramp(name,t)', 'colour from a ramp'], ['g.particles(spec, t)', 'bursts and looping streams'], ['g.trail(path, t, o)', 'fading streak behind a path'], ['g.shockwave(cx,cy,r,o)', 'rings, ground rings'], ['g.bolt(x1,y1,x2,y2,o)', 'lightning with forks'], ['g.flames(x,y,w,h,t,o)', 'seamless fire'], ['new Fluid(w,h) · g.fluid(fl,cols)', 'smoke simulation'], ['g.cycle(cols, shift)', 'palette cycling'], ['g.flash(c,a) · g.dissolve(l,o)', 'hit flash, burn away'], ['shake(a) → [dx,dy]', 'screen shake'], ['ctx: f, t, n, cx, cy, params, state', 'per frame'], ['rand, rnd, irnd, noise, ease.*, range, lerp', 'helpers']];
  openSheet(`<div class="sheet-head">${icon('code', 20)}<h3 class="grow">Drawing kit</h3><button class="icon-btn sm" onclick="closeSheet()">${icon('x', 16)}</button></div><div class="sheet-body"><table class="kit">${rows.map(([a, b]) => `<tr><td><code>${esc(a)}</code></td><td class="muted">${esc(b)}</td></tr>`).join('')}</table><div class="hint">Colours are palette slots (numbers) or '#rrggbb'. Palettes: ${Object.keys(S.info.palettes).join(', ')}. Ramps: ${Object.keys(S.info.ramps).join(', ')}.</div></div>`, { width: 620 });
}
