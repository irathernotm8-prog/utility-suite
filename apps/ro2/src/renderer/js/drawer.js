// The left rail and the panel drawer beside it. Rail panels add things; "detail" panels edit the selection.
import { h, ico, $ } from './ui.js';

const panels = new Map(); let current = null; let lastRail = 'elements'; let renderToken = 0;
export const RAIL = ['templates', 'elements', 'text', 'brand', 'photos', 'uploads', 'background', 'ai', 'assistant', 'layers'];

export function register(id, def) { panels.set(id, def); }
export function buildRail() {
  const rail = $('#rail'); rail.innerHTML = '';
  for (const id of RAIL) {
    const p = panels.get(id); if (!p) continue;
    const b = h('button.rail-btn' + (p.ai ? '.ai' : ''), { 'data-id': id, on: { click: () => (current === id && !$('#drawer').classList.contains('closed') ? close() : open(id)) } }, h('span.ri', { html: ico(p.icon) }), h('span', p.label));
    rail.append(b);
  }
  $('#drawerCollapse').onclick = () => ($('#drawer').classList.contains('closed') ? open(current || lastRail) : close());
}
export async function open(id, opts = {}) {
  const p = panels.get(id); if (!p) return;
  current = id; if (RAIL.includes(id)) lastRail = id;
  $('#drawer').classList.remove('closed');
  document.querySelectorAll('.rail-btn').forEach((b) => b.classList.toggle('on', b.dataset.id === (RAIL.includes(id) ? id : null)));
  const inner = $('#drawerInner'); const token = ++renderToken;
  const root = h('div');
  if (!RAIL.includes(id)) {
    const back = h('button.btn.ghost.sm', { style: { marginBottom: '10px', paddingLeft: '4px' }, html: ico('chevron-left') + '<span>Back</span>', on: { click: () => open(lastRail) } });
    root.append(back);
  }
  inner.innerHTML = ''; inner.append(root); inner.scrollTop = 0;
  try { await p.render(root, opts, () => token === renderToken); } catch (e) { console.error(e); root.append(h('p.muted', String(e.message || e))); }
}
export function close() { $('#drawer').classList.add('closed'); document.querySelectorAll('.rail-btn').forEach((b) => b.classList.remove('on')); }
export function refresh(onlyIf) { if (current && !$('#drawer').classList.contains('closed') && (!onlyIf || onlyIf.includes(current))) open(current, { refresh: true }); }
export const currentPanel = () => current;
export const isOpen = () => !$('#drawer').classList.contains('closed');
