// The quick switcher (a small floating picker) and the switching HUD shown when a shortcut or trigger fires.
'use strict';
const api = window.scene;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const gl = (n, s = 16) => `<svg class="ic" width="${s}" height="${s}"><use href="#g-${n || 'spark'}"/></svg>`;
const ic = (n, s = 16) => `<svg class="ic" width="${s}" height="${s}"><use href="#i-${n}"/></svg>`;
let D = null; let q = ''; let idx = 0; let mode = 'pick';

function theme() {
  const t = D && D.theme; const dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
function pretty(a) {
  if (!a) return ''; const mac = D.platform === 'darwin';
  return a.split('+').map((p) => (mac ? ({ CommandOrControl: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧' })[p] || p : ({ CommandOrControl: 'Ctrl', Control: 'Ctrl', Super: 'Win' })[p] || p)).join(mac ? '' : '+');
}
function list() {
  const l = D.scenes.filter((s) => !q || s.name.toLowerCase().includes(q.toLowerCase()));
  if (D.state && D.state.previous && (!q || 'restore previous'.includes(q.toLowerCase()))) l.push({ id: 'previous', name: 'Restore previous layout', color: 'slate', glyph: null, prev: true, apps: [] });
  return l;
}
function render() {
  theme();
  if (mode !== 'pick') return;
  const l = list(); idx = Math.max(0, Math.min(idx, l.length - 1));
  $('#sw').innerHTML = `<div class="sw-q">${ic('search', 18)}<input id="q" placeholder="Switch to…" value="${esc(q)}" spellcheck="false"></div>
    <div class="sw-list">${l.map((s, i) => `<div class="sw-row c-${s.color || 'amber'}${i === idx ? ' on' : ''}" data-i="${i}"><span class="gl">${s.prev ? ic('undo', 16) : gl(s.glyph, 16)}</span><div style="min-width:0"><b>${esc(s.name)}</b><span class="s">${s.prev ? esc(D.state.previous.name) : `${(s.apps || []).length} app${(s.apps || []).length === 1 ? '' : 's'}`}</span></div>${s.hotkey ? `<span class="kbd">${esc(pretty(s.hotkey))}</span>` : '<span></span>'}${s.id === (D.state || {}).activeId ? '<span class="act"></span>' : `<span class="n">${i < 9 && !s.prev ? i + 1 : ''}</span>`}</div>`).join('') || `<div class="empty">${D.scenes.length ? 'No scene matches.' : 'No scenes yet. Open Scene to make one.'}</div>`}</div>
    <div class="sw-foot"><span><span class="kbd">↑↓</span> choose</span><span><span class="kbd">↩</span> switch</span><span><span class="kbd">1–9</span> quick pick</span><span class="grow"></span><button class="link-btn" id="open">Open Scene</button></div>`;
  const inp = $('#q'); inp.focus(); inp.setSelectionRange(q.length, q.length);
  inp.oninput = () => { q = inp.value; idx = 0; render(); };
  document.querySelectorAll('.sw-row').forEach((r) => { r.onclick = () => pick(+r.dataset.i); r.onmousemove = () => { if (idx !== +r.dataset.i) { idx = +r.dataset.i; document.querySelectorAll('.sw-row').forEach((x) => x.classList.toggle('on', x === r)); } }; });
  $('#open').onclick = () => api.call('switcher:open-app');
}
function pick(i) {
  const s = list()[i]; if (!s) return;
  mode = 'hud'; hud({ name: s.name, scene: s.id, steps: [{ label: 'Starting', status: 'run' }], done: false });
  api.call('scene:activate', s.id, 'switcher').catch((e) => { hud({ name: s.name, scene: s.id, steps: [{ label: e.message, status: 'warn' }], done: true, ok: false, ms: 0 }); setTimeout(() => api.call('switcher:hide'), 2500); });
}
function hud(p) {
  const s = (D.scenes || []).find((x) => x.id === p.scene) || { color: 'slate', glyph: null };
  const sym = (st) => st === 'run' ? '<span class="spin"></span>' : st === 'ok' ? ic('check', 14) : ic('alert', 14);
  const cur = p.steps.filter((x) => x.status === 'run').pop();
  $('#sw').innerHTML = `<div class="hud c-${s.color || 'amber'}"><div class="hud-h"><span class="gl">${p.scene === 'previous' ? ic('undo', 20) : gl(s.glyph, 20)}</span><div><b>${p.done ? (p.ok ? 'Switched to ' : 'Switched, with notes: ') : 'Switching to '}${esc(p.name)}</b><span>${p.done ? `${(p.ms / 1000).toFixed(1)} s` : esc(cur ? cur.label : 'One moment…')}</span></div></div>
    <div class="prog-steps" style="padding:0">${p.steps.map((x) => `<div class="step ${x.status}"><span class="si">${sym(x.status)}</span><div>${esc(x.label)}${x.detail ? `<span class="sd">${esc(x.detail)}</span>` : ''}</div></div>`).join('')}</div></div>`;
}
document.addEventListener('keydown', (e) => {
  if (mode !== 'pick') { if (e.key === 'Escape') api.call('switcher:hide'); return; }
  const l = list();
  if (e.key === 'Escape') { api.call('switcher:hide'); }
  else if (e.key === 'ArrowDown') { idx = (idx + 1) % Math.max(1, l.length); render(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { idx = (idx - 1 + l.length) % Math.max(1, l.length); render(); e.preventDefault(); }
  else if (e.key === 'Enter') { pick(idx); }
  else if (/^[1-9]$/.test(e.key) && !q) { e.preventDefault(); pick(+e.key - 1); }
});
api.on('switcher', (d) => { D = d; mode = d.mode; if (mode === 'pick') { q = ''; idx = Math.max(0, d.scenes.findIndex((s) => s.id !== (d.state || {}).activeId)); render(); } else theme(); document.body.classList.add('ready'); });
api.on('progress', (p) => { if (mode === 'hud' && D) hud(p); });
api.on('switched', (d) => { if (D) { D.scenes = d.scenes; D.state = d.state; } });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', theme);
