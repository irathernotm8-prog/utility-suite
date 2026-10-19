/* Kiln — quick search (Ctrl+K): jump anywhere, launch packages, use prompts. */
(() => {
  const { $, $$, esc } = K;
  let root = null, items = [], sel = 0;

  function entries(q) {
    const out = [];
    const page = (id, label, icon) => out.push({ label, icon, group: 'Go to', run: () => K.go(id) });
    [['home', 'Home', 'home'], ['generate', 'Generate', 'wand'], ['gallery', 'Gallery', 'image'], ['prompts', 'Prompts', 'quote'], ['models', 'My models', 'cube'], ['discover', 'Find models', 'compass'], ['packages', 'Packages', 'pkg'], ['browser', 'Browser', 'globe'], ['settings', 'Settings', 'settings']].forEach(a => page(...a));
    for (const p of K.state.packages) {
      const s = p.status?.state;
      if (s === 'running') { out.push({ label: `Stop ${p.name}`, icon: 'stop', group: 'Packages', run: () => kiln.pkg.stop(p.id) }); if (p.status.url) out.push({ label: `Open ${p.name}`, icon: 'globe', group: 'Packages', run: () => window.Browser.openUrl(p.status.url, { title: p.name }) }); }
      else out.push({ label: `Launch ${p.name}`, icon: 'play', group: 'Packages', run: () => window.Home.launch(p.id) });
    }
    for (const p of K.state.prompts.slice(0, 200)) out.push({ label: p.name, sub: p.positive.slice(0, 60), icon: 'bookmark', group: 'Saved prompts', run: () => window.Generate.usePrompt(p) });
    for (const p of K.state.app.profiles.filter(x => x.id !== K.state.profile.id)) out.push({ label: `Switch to ${p.name}`, icon: 'user', group: 'Profiles', run: () => window.Profiles.open(p.id) });
    out.push({ label: 'New browser tab', icon: 'plus', group: 'Actions', run: () => window.Browser.openTab() });
    out.push({ label: 'Downloads', icon: 'download', group: 'Actions', run: () => window.Downloads.toggle(true) });
    if (q) {
      const s = q.toLowerCase();
      const hits = out.filter(e => (e.label + ' ' + (e.sub || '')).toLowerCase().includes(s));
      hits.push({ label: `Search CivitAI for “${q}”`, icon: 'compass', group: 'Search', run: () => { K.go('discover', { source: 'civitai' }); setTimeout(() => { const i = $('#dsQ'); if (i) { i.value = q; $('#dsForm').requestSubmit(); } }, 80); } });
      hits.push({ label: `Search the web for “${q}”`, icon: 'globe', group: 'Search', run: () => window.Browser.openTab(q) });
      return hits.slice(0, 40);
    }
    return out.slice(0, 40);
  }
  function open() {
    if (root) return close();
    root = document.createElement('div');
    root.className = 'modal-wrap';
    root.style.background = 'var(--scrim)';
    root.innerHTML = `<div class="palette"><input placeholder="Go to, launch, or search…" id="palQ"><div class="res" id="palR"></div></div>`;
    document.body.appendChild(root);
    root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
    const q = $('#palQ', root);
    q.oninput = () => { sel = 0; draw(q.value.trim()); };
    q.onkeydown = (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % Math.max(1, items.length); mark(); }
      if (e.key === 'Enter') { e.preventDefault(); const it = items[sel]; close(); it?.run(); }
    };
    draw(''); q.focus();
  }
  function draw(q) {
    items = entries(q);
    let last = '';
    $('#palR', root).innerHTML = items.map((e, i) => { const h = e.group !== last ? `<div class="menu-h">${esc(e.group)}</div>` : ''; last = e.group; return `${h}<button data-i="${i}" class="${i === sel ? 'on' : ''}">${ic(e.icon, 15)}<span>${esc(e.label)}</span>${e.sub ? `<small>${esc(e.sub)}</small>` : ''}</button>`; }).join('') || '<div class="menu-h">Nothing found</div>';
    $$('[data-i]', root).forEach(b => b.onclick = () => { const it = items[Number(b.dataset.i)]; close(); it.run(); });
  }
  function mark() { $$('[data-i]', root).forEach(b => b.classList.toggle('on', Number(b.dataset.i) === sel)); $(`[data-i="${sel}"]`, root)?.scrollIntoView({ block: 'nearest' }); }
  function close() { root?.remove(); root = null; }
  window.Palette = { open };
})();
