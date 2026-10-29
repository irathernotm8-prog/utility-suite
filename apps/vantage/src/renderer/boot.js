/* Vantage — start-up: load this window's state and wire everything together. */
(async () => {
  const init = await vantage.init();
  Object.assign(V, { isPrivate: init.isPrivate, platform: init.platform, settings: init.settings, bookmarks: init.bookmarks || [], parts: init.partitions });
  document.body.classList.add('plat-' + init.platform);
  if (init.fullscreen) document.body.classList.add('fullscreen');
  if (V.isPrivate) {
    document.body.classList.add('private');
    const b = $('#privateBadge'); b.hidden = false; b.innerHTML = `${ic('mask', 15)}<span>Private</span>`;
  }

  const mq = matchMedia('(prefers-color-scheme: dark)');
  const applyTheme = () => { document.documentElement.dataset.theme = mq.matches ? 'dark' : 'light'; };
  mq.addEventListener('change', applyTheme);
  applyTheme();

  V.applySettings = () => {
    applyTheme();
    const s = V.settings;
    const root = document.documentElement;
    root.dataset.accent = s.accent || 'ocean';
    if (s.accent === 'custom' && /^#[0-9a-f]{6}$/i.test(s.accentCustom || '')) {
      root.style.setProperty('--accent', s.accentCustom);
      root.style.setProperty('--accent-2', `color-mix(in srgb, ${s.accentCustom} 60%, #6a7dff)`);
      root.style.setProperty('--gradient', `linear-gradient(120deg, ${s.accentCustom}, color-mix(in srgb, ${s.accentCustom} 55%, #6a7dff))`);
    } else ['--accent', '--accent-2', '--gradient'].forEach(k => root.style.removeProperty(k));
    document.body.classList.toggle('compact', s.density === 'compact');
    const tb = s.toolbar || {};
    $('#btnVpn').hidden = tb.vpn === false; $('#btnSplit').hidden = tb.split === false; $('#btnDownloads').hidden = tb.downloads === false;
    $('#btnVault').hidden = tb.vault === false; $('#btnLibrary').hidden = tb.library === false;
    document.body.classList.toggle('side-tabs', !!V.settings.tabsOnSide);
    V.renderBookmarksBar();
    V.renderTabs();
    V.updateToolbar();
    requestAnimationFrame(() => V.applyLayout());
  };

  V.restore(init.saved, init.urls);
  V.applySettings();
  V.loadDownloads();
  V.vpn = await vantage.vpn.state();
  V.renderVpnPill();
  relay.vault.onLocked(() => window.Vault?.onLocked());
  relay.library.onChanged?.(() => {});

  // Escape leaves focus mode when nothing else wants it
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && V.focusMode && !$('#modalRoot').children.length && !$('#popRoot').children.length && document.activeElement?.tagName !== 'INPUT') V.toggleFocusMode(false);
  });
  // double-clicking the empty part of the tab strip zooms the window (Windows/Linux; macOS does this itself)
  if (init.platform !== 'darwin') $('.strip-fill').addEventListener('dblclick', () => vantage.titleDblClick());
})();
