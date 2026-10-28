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
