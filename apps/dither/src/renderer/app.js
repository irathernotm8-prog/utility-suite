// Dither window: shared state, navigation, sheets, menus, toasts, the frames cache and "Ask Claude".
'use strict';
const D = window.dither;
const call = D.call;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const baseName = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || String(p || '');
const tildify = (p) => (S.info && p && String(p).startsWith(S.info.home) ? '~' + String(p).slice(S.info.home.length) : p);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

const S = { info: null, settings: {}, project: null, projects: [], effects: [], sprites: [], view: 'drafts', arg: null, bridge: {}, ai: null, activity: [], boardId: null };
const VIEWS = {};

function ago(t) { if (!t) return ''; const s = (Date.now() - t) / 1000; if (s < 45) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago'; if (s < 6 * 86400) return new Date(t).toLocaleDateString(undefined, { weekday: 'short' }); return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
const byWho = (b) => (!b || b === 'you' ? 'You' : /codex/i.test(b) ? 'Codex' : /claude/i.test(b) ? (/code/i.test(b) ? 'Claude Code' : 'Claude') : b);

// ───────── toasts
function toast(title, text = '', kind = 'ok', ms = 4200) {
  const el = document.createElement('div'); el.className = 'toast ' + kind;
  el.innerHTML = `<span class="t-ic">${kind === 'busy' ? '<span class="spin"></span>' : icon(kind === 'bad' ? 'alert' : kind === 'info' ? 'sparkle' : 'check', 16)}</span><div class="grow"><div class="t-title">${esc(title)}</div>${text ? `<div class="t-text">${esc(text)}</div>` : ''}</div>`;
  $('#toasts').appendChild(el);
  if (ms) setTimeout(() => { el.style.transition = 'opacity .2s'; el.style.opacity = 0; setTimeout(() => el.remove(), 220); }, ms);
  return el;
}
const fail = (e) => toast('That didn’t work', e.message || String(e), 'bad', 8000);

// ───────── navigation
function go(view, arg) {
  const v0 = VIEWS[S.view]; if (v0 && v0.leave && (S.view !== view || S.arg !== arg)) v0.leave();
  S.view = view; S.arg = arg ?? null;
  const navOf = { lab: 'effects', editor: 'sprites' };
  $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === (navOf[view] || view)));
  render();
}
function render() {
  const v = VIEWS[S.view]; if (!v) return;
  Players.clear();
  const view = $('#view'); view.className = v.flush ? 'flush' : ''; view.scrollTop = 0;
  $('#headLeft').innerHTML = v.head ? v.head() : `<h1>${esc(v.title)}</h1>`;
  $('#headRight').innerHTML = v.actions ? v.actions() : '';
  v.render(view); if (v.after) v.after(); hydrateIcons(document); fitTitles();
}
const _mc = document.createElement('canvas').getContext('2d');
function fitTitles() { $$('.title-input').forEach((i) => { const f = () => { const cs = getComputedStyle(i); _mc.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; i.style.width = Math.ceil(_mc.measureText(i.value || ' ').width + 22) + 'px'; }; f(); i.addEventListener('input', f); }); }
function refresh(views) { if (!views || views.includes(S.view)) { const v = VIEWS[S.view]; if (v && v.update) v.update(); else render(); } }

// ───────── sheets (dialogs)
function openSheet(html, { onClose, width, cls = '' } = {}) {
  closeSheet(); const host = $('#sheetHost');
  host.innerHTML = `<div class="scrim"><div class="sheet ${cls}"${width ? ` style="width:min(${width}px,calc(100vw - 48px))"` : ''}>${html}</div></div>`;
  const scrim = host.firstChild; scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) closeSheet(); });
  S.sheetClose = onClose; hydrateIcons(host);
  const first = host.querySelector('[autofocus],input:not([type=hidden]):not([type=range]):not([type=checkbox]),textarea'); if (first) setTimeout(() => first.focus(), 30);
  return scrim.firstChild;
}
function closeSheet() { const h = $('#sheetHost'); if (h.firstChild) { h.innerHTML = ''; if (S.sheetClose) { const f = S.sheetClose; S.sheetClose = null; f(); } } }
function confirmBox({ title, text, ok = 'OK', danger = false }) {
  return new Promise((res) => {
    const el = openSheet(`<div class="sheet-head"><h3>${esc(title)}</h3></div><div class="sheet-body"><p class="muted" style="margin:0">${esc(text)}</p></div><div class="sheet-foot"><span class="grow"></span><button class="btn" data-a="no">Cancel</button><button class="btn ${danger ? 'danger-fill' : 'primary'}" data-a="yes">${esc(ok)}</button></div>`, { width: 460, onClose: () => res(false) });
    el.querySelector('[data-a=yes]').onclick = () => { S.sheetClose = null; closeSheet(); res(true); };
    el.querySelector('[data-a=no]').onclick = () => closeSheet();
  });
}
function promptBox({ title, text = '', label, value = '', placeholder = '', ok = 'Save', fields, area }) {
  return new Promise((res) => {
    const fs = fields || [{ key: 'v', label, value, placeholder, area }];
    const el = openSheet(`<div class="sheet-head"><h3>${esc(title)}</h3></div><div class="sheet-body">${text ? `<p class="muted" style="margin:0">${esc(text)}</p>` : ''}${fs.map((f) => `<div class="field">${f.label ? `<label>${esc(f.label)}</label>` : ''}${f.area ? `<textarea class="input area" rows="4" data-k="${f.key}" placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea>` : f.options ? `<select class="select" data-k="${f.key}">${f.options.map((o) => `<option value="${esc(o.value)}" ${o.value === f.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>` : `<input class="input" data-k="${f.key}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}" ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} spellcheck="false">`}${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`).join('')}</div><div class="sheet-foot"><span class="grow"></span><button class="btn" data-a="no">Cancel</button><button class="btn primary" data-a="yes">${esc(ok)}</button></div>`, { width: 500, onClose: () => res(null) });
    const done = () => { const o = {}; $$('[data-k]', el).forEach((i) => { o[i.dataset.k] = i.value; }); S.sheetClose = null; closeSheet(); res(fields ? o : o.v); };
    el.querySelector('[data-a=yes]').onclick = done; el.querySelector('[data-a=no]').onclick = () => closeSheet();
    $$('input', el).forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(); }));
  });
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if ($('#popHost').firstChild) closePop(); else if ($('#sheetHost').firstChild) closeSheet(); } });

// ───────── menus and popovers
function closePop() { $('#popHost').innerHTML = ''; }
function popAt(anchor, html, { width, align = 'left', cls = '' } = {}) {
  closePop(); const host = $('#popHost');
  host.innerHTML = `<div class="pop-catch"></div><div class="menu ${cls}"${width ? ` style="width:${width}px"` : ''}>${html}</div>`;
  const m = host.lastChild; const r = anchor.getBoundingClientRect(); const mw = m.offsetWidth, mh = m.offsetHeight;
  let x = align === 'right' ? r.right - mw : r.left; let y = r.bottom + 6;
  if (y + mh > innerHeight - 10) y = Math.max(10, r.top - mh - 6);
  x = Math.max(10, Math.min(x, innerWidth - mw - 10)); m.style.left = x + 'px'; m.style.top = y + 'px';
  host.firstChild.onmousedown = closePop; hydrateIcons(host); return m;
}
function menu(anchor, items, opts) {
  const m = popAt(anchor, items.map((it, i) => it === '-' ? '<hr>' : it.header ? `<div class="menu-label">${esc(it.label)}</div>` : `<button data-i="${i}" class="${it.danger ? 'danger' : ''}${it.on ? ' on' : ''}" ${it.disabled ? 'disabled' : ''}>${it.icon ? icon(it.icon, 16) : it.swatch ? `<i class="sw" style="background:${it.swatch}"></i>` : ''}<span class="grow">${esc(it.label)}</span>${it.hint ? `<span class="muted tiny">${esc(it.hint)}</span>` : ''}${it.on ? icon('check', 14) : ''}</button>`).join(''), opts);
  $$('button[data-i]', m).forEach((b) => b.onclick = () => { closePop(); const it = items[+b.dataset.i]; if (it.run) it.run(); });
  return m;
}

// ───────── project state
async function loadProject() {
  const [sum, effects, sprites] = await Promise.all([call('project:summary'), call('effects:list'), call('sprites:list')]);
  S.project = sum; S.effects = effects; S.sprites = sprites;
  $('#projName').textContent = sum.name;
  const drafts = effects.filter((e) => e.boardId && !e.feedback?.verdict).length;
  $('#draftCount').textContent = drafts || ''; $('#draftCount').classList.toggle('live', drafts > 0);
  $('#effectCount').textContent = effects.filter((e) => e.kept || !e.boardId).length || '';
  $('#spriteCount').textContent = sprites.length || ''; call('clips:list').then((c) => { const el = $('#clipCount'); if (el) el.textContent = c.length || ''; }).catch(() => {}); $('#refCount').textContent = sum.refs.length || '';
}
const effectById = (id) => S.effects.find((e) => e.id === id);
async function projectMenu(anchor) {
  const { list, active } = await call('projects:list');
  menu(anchor, [{ header: true, label: 'Projects' }, ...list.map((p) => ({ label: p.name, on: p.id === active, hint: `${p.counts.effects + p.counts.drafts} fx · ${p.counts.sprites} spr`, run: async () => { await call('projects:open', p.id); Frames.clear(); await loadProject(); go(S.view === 'lab' || S.view === 'editor' ? 'drafts' : S.view); } })), '-',
    { label: 'New project…', icon: 'plus', run: newProject }, { label: 'Rename this project…', icon: 'edit', run: async () => { const n = await promptBox({ title: 'Rename project', value: S.project.name, ok: 'Rename' }); if (n) { await call('projects:rename', S.project.id, n); await loadProject(); } } }, { label: 'Show the project folder', icon: 'folder', run: () => call('projects:reveal') }], { width: 300 });
}
async function newProject() { const n = await promptBox({ title: 'New project', text: 'One project per game, site or app. Effects, sprites, drafts and references live in its own folder.', label: 'Name', placeholder: 'e.g. Skyline Protocol', ok: 'Create' }); if (!n) return; await call('projects:create', n); Frames.clear(); await loadProject(); go('drafts'); }

// ───────── frames cache (renders happen in the sandbox; the window keeps the results)
const Frames = {
  map: new Map(), pending: new Map(),
  key: (id, o = {}) => `${id}@${o.version || ''}|${JSON.stringify(o.params || {})}|${o.seed ?? ''}`,
  async effect(id, o = {}) {
    const k = this.key(id, o); if (this.map.has(k)) return this.map.get(k); if (this.pending.has(k)) return this.pending.get(k);
    const p = call('fx:renderEffect', id, o).then((r) => { this.map.set(k, r); this.pending.delete(k); return r; }, (e) => { this.pending.delete(k); throw e; });
    this.pending.set(k, p); return p;
  },
  async code(code, o = {}) { return call('fx:render', code, o); },
  drop(id) { for (const k of [...this.map.keys()]) if (k.startsWith(id + '@')) this.map.delete(k); },
  clear() { this.map.clear(); },
};

// ───────── Claude card + Ask Claude
function renderAiCard() {
  const el = $('#aiCard'); if (!el) return; const b = S.bridge || {}; const last = S.activity[0];
  const who = b.client ? byWho(b.client) : null;
  el.innerHTML = `<div class="ac-row"><span class="dot ${b.connected ? 'on' : ''}"></span><span class="grow ellip">${b.connected ? `${esc(who || 'Claude')} is here` : 'Claude isn’t connected'}</span></div>
    ${last ? `<div class="ac-last"><b>${esc(byWho(last.by || who || 'Claude'))}</b> ${esc(last.msg)}<span class="muted"> · ${esc(ago(last.at))}</span></div>` : `<div class="ac-last muted">${b.connected ? 'Ask in your chat, or right here.' : 'Add the plugin in Connections, or ask from here.'}</div>`}
    <button class="btn sm ac-ask" id="askBtn"><span data-icon="chat" data-size="15"></span>Ask Claude…</button>`;
  hydrateIcons(el); $('#askBtn').onclick = () => askClaude();
}
let asking = false;
async function askClaude(prefill = '') {
  if (!S.ai) S.ai = await call('ai:status').catch(() => ({}));
  const has = S.ai && (S.ai.claude || S.ai.codex);
  const examples = ['Make 6 drafts of a lightning strike for a top-down shooter, 48×64, cold palette', 'Refine my picks on the latest board using my notes', 'Draw a 16×16 slime enemy with a 4-frame idle bounce', 'Make an 8-frame coin spin sprite, 12×12, gold palette'];
  const el = openSheet(`<div class="sheet-head">${icon('chat', 20)}<div class="grow"><h3>Ask ${S.ai?.claude ? 'Claude' : S.ai?.codex ? 'Codex' : 'Claude'}</h3><div class="muted small">${has ? `Runs your own ${S.ai.claude ? 'Claude Code' : 'Codex'} with only Dither’s tools. Watch the board fill in.` : 'Claude Code or Codex isn’t installed here — copy the prompt into Claude Desktop with the Dither plugin added instead.'}</div></div></div>
    <div class="sheet-body"><textarea class="input area" id="askText" rows="4" placeholder="Describe what you want…" autofocus>${esc(prefill)}</textarea>
    <div class="examples">${examples.map((x) => `<button class="ex">${esc(x)}</button>`).join('')}</div>
    <div class="ask-log" id="askLog" hidden></div></div>
    <div class="sheet-foot"><button class="btn ghost sm" id="askCopy">${icon('copy', 14)}Copy prompt</button><span class="grow"></span><button class="btn" id="askClose">Close</button><button class="btn primary" id="askGo" ${has ? '' : 'disabled'}>${icon('sparkle', 15)}Ask</button></div>`, { width: 640, cls: 'ask-sheet' });
  $$('.ex', el).forEach((b) => b.onclick = () => { $('#askText').value = b.textContent; $('#askText').focus(); });
  $('#askClose').onclick = closeSheet;
  $('#askCopy').onclick = () => { call('clipboard:write', `${$('#askText').value.trim()}\n\n(Use the Dither tools. Project: ${S.project.name}.)`); toast('Copied', 'Paste it into Claude with the Dither plugin added.'); };
  $('#askGo').onclick = async () => {
    if (asking) { await call('ask:stop'); return; }
    const p = $('#askText').value.trim(); if (!p) return;
    const log = $('#askLog'); log.hidden = false; log.innerHTML = ''; asking = true; $('#askGo').innerHTML = `${icon('stop', 14)}Stop`; $('#askGo').classList.remove('primary');
    const add = (cls, html) => { const d = document.createElement('div'); d.className = 'al ' + cls; d.innerHTML = html; log.appendChild(d); log.scrollTop = log.scrollHeight; };
    add('busy', `<span class="spin"></span>Starting…`);
    const off = D.on('ask:event', (ev) => { if (ev.kind === 'tool') add('tool', `${icon('bolt', 13)}${esc(ev.name.replace(/_/g, ' '))}`); else add('text', esc(ev.text)); });
    try { const r = await call('ask:start', p); add('done', `${icon('check', 14)}${esc(r.text ? r.text.slice(0, 600) : 'Done')}`); }
    catch (e) { add('bad', `${icon('alert', 14)}${esc(e.message)}`); }
    finally { off(); asking = false; const g = $('#askGo'); if (g) { g.innerHTML = `${icon('sparkle', 15)}Ask again`; g.classList.add('primary'); } $$('.al.busy', log).forEach((x) => x.remove()); }
  };
}

async function openPath(p) { try { await call('shell:open', p); } catch (e) { fail(e); } }
function reveal(p) { call('shell:reveal', p).catch(fail); }
function filesDone(r, what = 'Saved') { if (!r || !r.files) return; const real = r.files.filter((f) => !/^\(/.test(f)); const t = toast(what, real.map(baseName).join(', '), 'ok', 7000); t.style.cursor = 'pointer'; t.title = 'Show in folder'; t.onclick = () => real[0] && reveal(real[0]); }
