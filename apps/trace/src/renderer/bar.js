(async () => {
  const $ = (id) => document.getElementById(id);
  let lastCount = 0;
  const mod = (s) => String(s || '').replace('CommandOrControl', navigator.platform.includes('Mac') ? '⌘' : 'Ctrl').replace(/Alt/g, navigator.platform.includes('Mac') ? '⌥' : 'Alt').replace(/Shift/g, navigator.platform.includes('Mac') ? '⇧' : 'Shift').replace(/\+/g, navigator.platform.includes('Mac') ? '' : '+');
  function render(s) {
    const sel = $('target');
    sel.innerHTML = '';
    for (const p of s.projects) { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; sel.appendChild(o); }
    sel.value = s.target;
    $('n').textContent = s.count;
    if (s.thumb) { $('thumb').src = s.thumb; $('thumb').style.display = 'block'; }
    if (s.count !== lastCount) { $('count').classList.remove('pop'); void $('count').offsetWidth; $('count').classList.add('pop'); lastCount = s.count; }
    $('bRegion').title = 'Drag over an area' + (s.shortcut ? ' (' + mod(s.shortcut) + ')' : '');
    $('bRepeat').title = 'Same area as last time' + (s.repeatShortcut ? ' (' + mod(s.repeatShortcut) + ')' : '');
  }
  render(await window.bar.state());
  window.bar.onState(render);
  $('target').addEventListener('change', (e) => window.bar.setTarget(e.target.value));
  document.querySelectorAll('button[data-m]').forEach((b) => b.addEventListener('click', () => window.bar.capture(b.dataset.m)));
  $('close').addEventListener('click', () => window.bar.close());
  $('count').addEventListener('click', () => window.bar.openApp());
})();
