/* Relay — quick switcher (⌘K). Type to jump to any account, chat, tab or action. */
(() => {
  const R = () => window.RelayApp;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  let root = null, items = [], sel = 0;

  function entries() {
    const { state, PLATFORMS, esc, chatService } = R();
    const out = [];
    const tab = (id, label, icon, hint) => out.push({ group: 'Go to', label, icon, hint, run: () => R().setPlatform(id) });
    tab('home', 'Home', 'home', '⌘1');
    for (const [id, p] of Object.entries(PLATFORMS)) tab(id, p.label, id === 'chats' ? 'chat' : 'mail');
    [['calendar', 'Calendar', 'calendar'], ['storage', 'Storage', 'cloud'], ['browser', 'Browser', 'globe'], ['vault', 'Vault', 'lock'], ['library', 'Library', 'library'], ['downloads', 'Downloads', 'download'], ['tracking', 'Package tracking', 'box']].forEach(([id, l, i]) => tab(id, l, i));
    for (const a of state.accounts) {
      const sub = a.platform === 'chats' ? chatService(a)?.label : PLATFORMS[a.platform]?.label;
      out.push({ group: 'Accounts', label: a.name || a.email || sub, sub: [sub, a.email].filter(Boolean).join(' · '), avatar: R().avatarHTML(a, 'sm'),
        run: () => { state.ui.selected[a.platform] = a.id; relay.saveUI({ selected: state.ui.selected }); R().setPlatform(a.platform); } });
      out.push({ group: 'Split view', label: `${a.name || a.email || sub} on the right`, sub: 'Open side by side', icon: 'columns', run: () => window.Split?.openRight(a.id), quiet: true });
    }
    for (const it of state.storage || []) out.push({ group: 'Accounts', label: it.name || 'Storage', sub: 'Storage', icon: 'cloud', run: () => { state.ui.selected.storage = it.id; R().setPlatform('storage'); } });
    const act = (label, icon, run, hint) => out.push({ group: 'Actions', label, icon, run, hint });
    act('New task', 'checkCircle', () => { state.ui.homeView = 'tasks'; relay.saveUI({ homeView: 'tasks' }); R().setPlatform('home'); window.Home?.focusNewTask(); }, '⌘T');
    act('New calendar event', 'calendar', () => { R().setPlatform('calendar'); window.Calendar?.newEvent(); });
    act('Add an email account', 'plus', () => R().openAccountModal({ platform: 'gmail' }));
    act('Add a chat app (Teams, Slack, WhatsApp…)', 'chat', () => R().openChatModal({}));
    act('Track a package', 'box', () => window.Tracking?.openAdd());
    act('Inbox briefing', 'inbox', () => { state.ui.homeView = 'briefing'; relay.saveUI({ homeView: 'briefing' }); R().setPlatform('home'); }, '⌘B');
    act('Assistant panel', 'sparkles', () => R().toggleAI(), '⌘J');
    act('Split view', 'columns', () => window.Split?.toggle(document.getElementById('splitBtn')), '⌘⇧S');
    act(R().isDark() ? 'Switch to light mode' : 'Switch to dark mode', 'sun', async () => { state.settings = await relay.saveSettings({ theme: R().isDark() ? 'light' : 'dark' }); R().applyTheme(); window.Skins?.reapplyAll(); R().render(); });
    act('Settings', 'settings', () => R().openSettings(), '⌘,');
    return out;
  }

  const score = (q, t) => {
    t = t.toLowerCase(); if (!q) return 1;
    if (t.startsWith(q)) return 100 - t.length / 100;
    const i = t.indexOf(q); if (i >= 0) return 60 - i;
    let p = 0; for (const ch of q) { p = t.indexOf(ch, p); if (p < 0) return 0; p++; }
    return 10;
  };

  function draw(q = '') {
    const { esc } = R();
    const query = q.trim().toLowerCase();
    let list = entries().filter(e => !e.quiet || query).map(e => ({ ...e, s: Math.max(score(query, e.label), score(query, e.sub || '') * 0.6) })).filter(e => e.s > 0);
    if (query) list.sort((a, b) => b.s - a.s);
    if (/^(https?:\/\/|www\.)|^[\w-]+\.[a-z]{2,}(\/|$)/i.test(q.trim())) list.unshift({ group: 'Web', label: `Open ${q.trim()}`, icon: 'globe', run: () => { R().setPlatform('browser'); window.Browser?.openTab(/^https?:/.test(q.trim()) ? q.trim() : 'https://' + q.trim()); } });
    else if (query.length > 1) list.push({ group: 'Web', label: `Search the web for “${q.trim()}”`, icon: 'search', run: () => { R().setPlatform('browser'); window.Browser?.openTab(q.trim()); } });
    items = list.slice(0, 40); sel = 0;
    let g = null;
    $('#palList', root).innerHTML = items.map((e, i) => {
      const head = !query && e.group !== g ? `<div class="pal-g">${esc(e.group)}</div>` : '';
      g = e.group;
      return `${head}<button class="pal-item ${i === sel ? 'on' : ''}" data-i="${i}">${e.avatar || `<span class="pal-ic">${ic(e.icon || 'arrowRight', 15)}</span>`}<span class="pal-t">${esc(e.label)}${e.sub ? `<small>${esc(e.sub)}</small>` : ''}</span>${e.hint ? `<kbd>${esc(e.hint)}</kbd>` : ''}</button>`;
    }).join('') || '<div class="pal-empty">Nothing matches</div>';
    $$('.pal-item', root).forEach(b => { b.onclick = () => choose(+b.dataset.i); b.onmousemove = () => mark(+b.dataset.i); });
  }
  function mark(i) { sel = i; $$('.pal-item', root).forEach((b, k) => b.classList.toggle('on', k === i)); $$('.pal-item', root)[i]?.scrollIntoView({ block: 'nearest' }); }
  function choose(i) { const e = items[i]; close(); if (e) setTimeout(() => e.run(), 0); }
  function close() { if (root) { root.remove(); root = null; } }

  function open() {
    if (root) { close(); return; }
    root = document.createElement('div');
    root.className = 'pal-back';
    root.innerHTML = `<div class="pal"><div class="pal-in">${ic('search', 16)}<input id="palQ" placeholder="Jump to an account, chat or tab — or type an action…" autocomplete="off" spellcheck="false"><kbd>esc</kbd></div><div class="pal-list" id="palList"></div></div>`;
    document.body.appendChild(root);
    root.onmousedown = (e) => { if (e.target === root) close(); };
    const q = $('#palQ', root);
    q.oninput = () => draw(q.value);
    q.onkeydown = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); mark(Math.min(items.length - 1, sel + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); mark(Math.max(0, sel - 1)); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
    };
    draw('');
    setTimeout(() => q.focus(), 10);
  }
  window.Palette = { open, close };
})();
