// App shell: tabs, menu routing, file opening, crash recovery, startup.
(async () => {
  FORMATS = await ro3.formats();
  const modules = { photo: PhotoEditor, video: VideoEditor, convert: QuickConvert };
  let active = 'photo';

  // Surface unexpected errors instead of failing silently.
  let lastErr = 0;
  const report = (msg) => { if (Date.now() - lastErr < 3000) return; lastErr = Date.now(); console.error(msg); toast('Something went wrong: ' + String(msg).split('\n')[0].slice(0, 160), 'error', 6000); };
  window.addEventListener('error', e => report(e.message || e.error));
  window.addEventListener('unhandledrejection', e => report(e.reason && e.reason.message || e.reason));

  $$('[data-icon]').forEach(el => { el.outerHTML = icon(el.dataset.icon); });
  modules.convert.init($('#view-convert'));
  modules.photo.init($('#view-photo'));
  modules.video.init($('#view-video'));

  function show(tab) {
    if (!modules[tab]) return;
    if (modules[active].deactivate) modules[active].deactivate();
    active = tab;
    $$('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === tab)));
    $$('.view').forEach(v => { v.hidden = v.dataset.view !== tab; });
    $('#topbar-actions').innerHTML = '';
    if (modules[tab].activate) modules[tab].activate($('#topbar-actions'));
    try { localStorage.setItem('ro3.tab', tab); } catch (_) {}
  }
  $$('.tab').forEach(t => t.addEventListener('click', () => show(t.dataset.tab)));

  /** Open a file in the workspace that suits it. */
  function openPath(p) {
    const ext = (p.split('.').pop() || '').toLowerCase();
    if (ext === 'ro3v') { show('video'); return VideoEditor.openProjectPath(p); }
    if (ext === 'ro3' || FORMATS.IMAGE_IN.includes(ext)) { show('photo'); return PhotoEditor.openPath(p, false); }
    if (FORMATS.VIDEO_IN.includes(ext) || FORMATS.AUDIO_IN.includes(ext)) { show('video'); return VideoEditor.importPaths([p]); }
    toast(`RO3 can't open .${ext} files.`, 'error');
  }

  window.RO3App = {
    show, openPath,
    get active() { return active; },
    unsaved: () => [...PhotoEditor.unsaved(), ...VideoEditor.unsaved()],
  };

  ro3.onMenu(cmd => {
    if (cmd.startsWith('tab:')) return show(cmd.slice(4));
    if (cmd.startsWith('open-path:')) return openPath(cmd.slice(10));
    if ((cmd === 'undo' || cmd === 'redo') && isTyping()) { document.execCommand(cmd); return; }
    if (document.querySelector('.modal-backdrop')) return;
    if (cmd.startsWith('photo:')) { if (active !== 'photo') show('photo'); return PhotoEditor.menu(cmd); }
    if (cmd.startsWith('video:')) { if (active !== 'video') show('video'); return VideoEditor.menu(cmd); }
    modules[active].menu && modules[active].menu(cmd);
  });

  // Stop the window from navigating when a file is dropped somewhere unhandled.
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => e.preventDefault());

  let start = 'photo';
  try { start = localStorage.getItem('ro3.tab') || 'photo'; } catch (_) {}
  show(start);
  document.body.dataset.ready = '1';

  // Files passed on launch (double-click / Open with).
  try { for (const p of await ro3.pendingOpen()) openPath(p); } catch (_) {}

  // Offer to recover work from a crash or a forced quit.
  const when = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'moments ago' : m < 60 ? `${m} min ago` : new Date(t).toLocaleString(); };
  const photo = await ro3.autosaveRead('photo.ro3').catch(() => null);
  const video = await ro3.autosaveRead('video.ro3v').catch(() => null);
  const items = [photo && { label: 'Image', t: photo.mtime, run: () => { show('photo'); return PhotoEditor.recover(photo.text); }, clear: () => ro3.autosaveClear('photo.ro3') },
    video && { label: 'Video edit', t: video.mtime, run: () => { show('video'); return VideoEditor.recover(video.text); }, clear: () => ro3.autosaveClear('video.ro3v') }].filter(Boolean);
  if (items.length && !window.RO3_NO_RECOVERY) {
    modal({ title: 'Recover unsaved work?', body: `<p class="muted">RO3 closed before these were saved:</p><ul class="recover-list">${items.map(i => `<li><strong>${i.label}</strong> — autosaved ${when(i.t)}</li>`).join('')}</ul>`,
      actions: [
        { label: 'Discard', kind: 'ghost', onClick: () => { items.forEach(i => i.clear()); } },
        { label: 'Recover', kind: 'primary', onClick: async () => { for (const i of items) { try { await i.run(); } catch (e) { toast(`Couldn't recover the ${i.label.toLowerCase()}: ${e.message}`, 'error'); } } } },
      ] });
  }
})().catch(e => {
  document.body.innerHTML = `<pre style="color:#ff6b5e;padding:20px">RO3 failed to start:\n${e.stack || e}</pre>`;
});
