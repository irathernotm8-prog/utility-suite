// Helm overlay: draws whatever the main process says is showing. It never handles input itself.
'use strict';
const { icon, glyph, family, esc } = window.HelmUI;
const $ = (id) => document.getElementById(id);
let fam = 'ps';
const isWin = () => document.body.dataset.platform === 'win32';
function theme(d) { if (!d) return; if (d.platform) document.body.dataset.platform = d.platform; fam = family(d.kind); }

// ---------------------------------------------------------------- HUD
const hud = $('hud');
window.helm.on('hud', (d) => {
  if (!d) { hud.classList.remove('on'); return; }
  theme(d);
  hud.innerHTML = `<span class="bubble">${icon(d.icon || 'controller')}</span><span>${esc(d.text)}</span>`;
  hud.classList.remove('on'); void hud.offsetWidth; hud.classList.add('on');
});

// ---------------------------------------------------------------- keyboard
const kb = $('kb'); let lastSel = '';
window.helm.on('keyboard', (v) => {
  document.body.classList.toggle('kb-open', !!v);
  if (!v) { kb.classList.remove('on'); return; }
  theme(v);
  const help = [
    [glyph('cross', fam), 'Type'], [glyph('square', fam), 'Delete'], [glyph('triangle', fam), 'Space'], [glyph('r2', fam), 'Return'],
    [glyph('l2', fam), 'Shift (hold)'], [glyph('l1', fam) + glyph('r1', fam), 'Move cursor'], [glyph('options', fam), v.layout === 'abc' ? 'Symbols' : 'Letters'],
    [glyph('create', fam), isWin() ? 'Ctrl + key' : '⌘ + key'], [glyph('circle', fam), 'Done']
  ];
  let sel = '';
  kb.innerHTML = `<div class="rows">${v.rows.map((r, ri) => `<div class="row">${r.map((k, ci) => {
    if (k.sel) sel = ri + ':' + ci;
    const fn = k.type !== 'char' || k.label === 'space';
    return `<div class="key${fn ? ' fn' : ''}${k.sel ? ' sel' : ''}${k.on ? ' on' : ''}${k.disabled ? ' disabled' : ''}" style="flex:${k.w} 1 0">${esc(k.label)}</div>`;
  }).join('')}</div>`).join('')}</div>
  <div class="help">${help.map(([g, t]) => `<span>${g}${esc(t)}</span>`).join('')}</div>`;
  kb.classList.add('card', 'on');
  document.documentElement.style.setProperty('--kbh', kb.offsetHeight + 'px');
  if (sel && sel === lastSel) { const k = kb.querySelector('.key.sel'); if (k) { k.classList.add('press'); } }
  lastSel = sel;
});

// ---------------------------------------------------------------- quick panel
const panel = $('panel'); let clock = null;
function meta(v) {
  const t = new Date(); const time = t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const b = v.battery && v.battery.level != null ? `<span>${icon(v.battery.charging ? 'bolt' : 'battery')}${v.battery.level}%</span>` : '';
  return `${b}<span>${esc(time)}</span>`;
}
let lastPanel = null;
window.helm.on('panel', (v) => {
  lastPanel = v;
  if (!v) { panel.classList.remove('on'); clearInterval(clock); return; }
  theme(v);
  panel.innerHTML = `<div class="top"><span class="mark">${icon('controller')}</span><b>Helm</b><span class="grow"></span><span class="meta" id="meta">${meta(v)}</span></div>
  <div class="tiles">${v.tiles.map((t, i) => `<div class="tile${i === v.sel ? ' sel' : ''}">${icon(t.icon)}<div><b>${esc(t.label)}</b>${t.sub ? `<small>${esc(t.sub)}</small>` : ''}</div></div>`).join('')}</div>
  <div class="help"><span>${glyph('cross', fam)}Open</span><span>${glyph('triangle', fam)}Keyboard</span><span>${glyph('circle', fam)}Close</span><span>${icon('touch')}Point with the touchpad</span></div>`;
  panel.classList.add('card', 'on');
  clearInterval(clock); clock = setInterval(() => { const m = $('meta'); if (m && lastPanel) m.innerHTML = meta(lastPanel); }, 15000);
});

// ---------------------------------------------------------------- command layer hint
const hint = $('hint');
const ORDER = ['up', 'down', 'left', 'right', 'l1', 'r1', 'cross', 'circle', 'square', 'triangle', 'l2', 'l3', 'r3', 'create', 'options', 'ps', 'mute'];
window.helm.on('hint', (d) => {
  if (!d) { hint.classList.remove('on'); return; }
  theme(d);
  const items = ORDER.filter((k) => d.bindings[k] && d.bindings[k] !== 'none').map((k) => `<div class="it"><span class="gls">${glyph(k, fam)}</span><span class="lab">${esc(d.labels[d.bindings[k]] || d.bindings[k])}</span></div>`);
  items.splice(6, 0, `<div class="it"><span class="gls"><span class="gl txt wide">R stick</span></span><span class="lab">Volume up / down</span></div>`);
  hint.innerHTML = `<h3>Holding ${glyph('r2', fam)}</h3><div class="items">${items.join('')}</div><div class="foot">Let go to return to the pointer.</div>`;
  hint.classList.add('card', 'on');
});
