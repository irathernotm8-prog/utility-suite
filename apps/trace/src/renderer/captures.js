// Trace — Captures: every screenshot in the project, in an Inbox and named groups you can reorder and turn into guides.
(function () {
  const T = window.T;
  class CapturesView {
    constructor(host, { app }) {
      this.app = app; this.sel = new Set(); this.last = null;
      this.root = T.el(`<div class="cap-view">
        <div class="view-bar">
          <div class="vb-title">${T.icon('images', 16)}<span class="crumb-proj">${T.esc(app.project.name)}</span><i>/</i><span class="vb-name">Captures</span></div>
          <div class="grow"></div>
          <div class="size-ctl" title="Thumbnail size">${T.icon('grid', 14)}<input type="range" min="140" max="420" step="10" value="${app.capSize || 230}"></div>
          <button class="btn ghost sm" data-act="import">${T.icon('upload')}Import</button>
          <button class="btn ghost sm" data-act="group">${T.icon('plus')}Group</button>
          <button class="btn ghost sm ${app.barOpen ? 'on' : ''}" data-act="bar" title="A small floating bar for taking screenshots while you work in other apps">${T.icon('camera')}Capture bar</button>
          <button class="btn primary sm" data-act="capture" title="${T.esc(T.kbd(T.accel(app.settings.shortcut)))}">${T.icon('region')}Capture</button>
        </div>
        <div class="perm-banner" hidden></div>
        <div class="cap-scroll"><div class="cap-groups"></div></div>
        <div class="selbar" hidden></div>
      </div>`);
      host.appendChild(this.root);
      this.root.style.setProperty('--thumb', (app.capSize || 230) + 'px');
      T.$('.size-ctl input', this.root).addEventListener('input', (e) => { app.capSize = +e.target.value; this.root.style.setProperty('--thumb', e.target.value + 'px'); });
      this.root.addEventListener('click', (e) => this.onClick(e));
      this.root.addEventListener('dblclick', (e) => { const c = e.target.closest('.cap'); if (c && !e.target.closest('input')) this.annotate(c.dataset.id); });
      this.root.addEventListener('contextmenu', (e) => { const c = e.target.closest('.cap'); if (!c) return; e.preventDefault(); if (!this.sel.has(c.dataset.id)) this.select(c.dataset.id); this.cardMenu(e.clientX, e.clientY); });
      this.keyH = (e) => this.onKey(e);
      document.addEventListener('keydown', this.keyH);
      this.pasteH = (e) => this.onPaste(e);
      document.addEventListener('paste', this.pasteH);
      this.render();
      this.checkPermission();
    }
    async checkPermission() {
      if (!T.isMac) return;
      const st = await window.api.capturePermission();
      const b = T.$('.perm-banner', this.root);
      if (st === 'granted') { b.hidden = true; return; }
      b.hidden = false;
      b.innerHTML = `${T.icon('info', 16)}<span>${st === 'denied' ? 'Trace isn’t allowed to take screenshots yet.' : 'The first screenshot will ask for permission.'} Turn Trace on in <b>Privacy & Security → Screen & System Audio Recording</b>, then reopen Trace.</span><button class="btn sm" data-act="perm">Open Settings</button>`;
    }

    // ---- model ----
    groups() {
      const p = this.app.project;
      const all = [...this.app.media.values()].filter((m) => !m.hidden);
      const inGroup = new Set(p.captureGroups.flatMap((g) => g.media));
      const order = p.captureOrder.filter((id) => this.app.media.has(id) && !inGroup.has(id));
      const rest = all.filter((m) => !inGroup.has(m.id) && !order.includes(m.id)).sort((a, b) => String(a.created).localeCompare(String(b.created))).map((m) => m.id);
      return [{ id: 'inbox', name: 'Inbox', media: [...order, ...rest], inbox: true }, ...p.captureGroups.map((g) => ({ ...g, media: g.media.filter((id) => this.app.media.has(id)) }))];
    }
    setGroups(gs) {
      this.app.mutate(this.app.project, () => {
        this.app.project.captureOrder = gs[0].media.slice();
        this.app.project.captureGroups = gs.slice(1).map((g) => ({ id: g.id, name: g.name, media: g.media.slice() }));
      }, null, { project: true });
    }

    // ---- render ----
    render() {
      const gs = this.groups();
      const pid = this.app.project.id;
      const total = gs.reduce((a, g) => a + g.media.length, 0);
      const box = T.$('.cap-groups', this.root);
      if (!total && gs.length === 1) {
        box.innerHTML = `<div class="cap-empty">
          <div class="ce-art">${T.icon('region', 34)}</div>
          <h2>Screenshots for your tutorials</h2>
          <p>Press <kbd>${T.esc(T.kbd(T.accel(this.app.settings.shortcut)))}</kbd> in any app, drag over what you want, and it lands here. Open the <b>capture bar</b> to keep a button floating while you click through a process.</p>
          <div class="ce-actions"><button class="btn primary" data-act="capture">${T.icon('region')}Capture a region</button><button class="btn" data-act="bar">${T.icon('camera')}Open the capture bar</button><button class="btn ghost" data-act="import">${T.icon('upload')}Import images</button></div>
          <p class="muted small">You can also paste images here, or drag them in from Finder or Explorer.</p></div>`;
        this.selbar();
        return;
      }
      let n = 0;
      box.innerHTML = gs.map((g) => `<section class="cap-group ${g.inbox ? 'inbox' : ''}" data-g="${g.id}">
        <header><div class="cg-name">${g.inbox ? `${T.icon('download', 15)}<b>Inbox</b>` : `${T.icon('images', 15)}<input class="cg-in" value="${T.esc(g.name)}" spellcheck="false">`}<span class="count">${g.media.length}</span></div>
          <div class="cg-actions">${g.media.length ? `<button class="btn ghost sm" data-act="guide-from" data-g="${g.id}">${T.icon('guide')}Make a guide</button><button class="btn ghost sm" data-act="present-group" data-g="${g.id}">${T.icon('present')}Slideshow</button>` : ''}
          ${g.inbox ? '' : `<button class="icon-btn ghost sm" data-act="gmenu" data-g="${g.id}">${T.icon('more', 15)}</button>`}</div></header>
        <div class="cap-grid" data-g="${g.id}">${g.media.map((id) => { const m = this.app.media.get(id); n++; return this.card(m, pid, g.inbox ? null : g.media.indexOf(id) + 1); }).join('') || '<div class="cap-drop-hint">Drag screenshots here</div>'}</div>
      </section>`).join('');
      void n;
      T.$$('.cg-in', box).forEach((inp) => {
        inp.addEventListener('change', () => { const gid = inp.closest('.cap-group').dataset.g; this.app.mutate(this.app.project, () => { const g = this.app.project.captureGroups.find((x) => x.id === gid); if (g) g.name = inp.value.trim() || 'Group'; }, null, { project: true }); });
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); e.stopPropagation(); });
      });
      this.bindDnd();
      this.selbar();
    }
    card(m, pid, num) {
      return `<div class="cap ${this.sel.has(m.id) ? 'sel' : ''}" data-id="${m.id}" draggable="true">
        <div class="cap-img">${T.annot.svg(m, T.mediaUrl(pid, m.file))}${num ? `<span class="cap-num">${num}</span>` : ''}
          <div class="cap-tools"><button class="icon-btn glass sm" data-act="annotate" title="Annotate">${T.icon('pen', 14)}</button><button class="icon-btn glass sm" data-act="view" title="View">${T.icon('eye', 14)}</button></div>
          <span class="cap-check">${T.icon('check', 12)}</span></div>
        <div class="cap-meta"><input class="cap-name" value="${T.esc(m.name || '')}" placeholder="${T.esc(T.fmtDate(m.created))}" spellcheck="false"><span class="cap-dim">${m.crop ? Math.round(m.crop.w) + '×' + Math.round(m.crop.h) : m.w + '×' + m.h}${(m.annotations || []).length ? ' · ' + T.plural(m.annotations.length, 'mark') : ''}</span></div>
      </div>`;
    }
    bindDnd() {
      const box = T.$('.cap-groups', this.root);
      T.$$('.cap-name', box).forEach((inp) => {
        inp.addEventListener('change', async () => { const id = inp.closest('.cap').dataset.id; const m = await window.api.updateMedia(this.app.project.id, id, { name: inp.value.trim() }); this.app.mediaChanged(m, { quiet: true }); });
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); e.stopPropagation(); });
        inp.addEventListener('mousedown', (e) => e.stopPropagation());
      });
      T.$$('.cap', box).forEach((el) => {
        el.addEventListener('dragstart', (e) => {
          if (!this.sel.has(el.dataset.id)) this.select(el.dataset.id);
          const ids = this.orderedSel();
          e.dataTransfer.setData('application/x-trace-media', ids.join(','));
          e.dataTransfer.effectAllowed = 'copyMove';
          const img = el.querySelector('.cap-img');
          if (img) e.dataTransfer.setDragImage(img, 40, 30);
          this.dragging = ids;
          requestAnimationFrame(() => ids.forEach((id) => { const c = T.$(`.cap[data-id="${id}"]`, box); if (c) c.classList.add('ghosted'); }));
        });
        el.addEventListener('dragend', () => { this.dragging = null; T.$$('.cap.ghosted', box).forEach((c) => c.classList.remove('ghosted')); T.$$('.drop-at', box).forEach((x) => x.classList.remove('drop-at', 'before', 'after')); });
      });
      T.$$('.cap-grid', box).forEach((grid) => {
        grid.addEventListener('dragover', (e) => {
          if (!this.dragging && !e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          T.$$('.drop-at', box).forEach((x) => x.classList.remove('drop-at', 'before', 'after'));
          const t = this.dropTarget(grid, e);
          if (t.el) t.el.classList.add('drop-at', t.after ? 'after' : 'before'); else grid.classList.add('drop-at');
        });
        grid.addEventListener('dragleave', (e) => { if (!grid.contains(e.relatedTarget)) grid.classList.remove('drop-at'); });
        grid.addEventListener('drop', async (e) => {
          e.preventDefault();
          const t = this.dropTarget(grid, e);
          T.$$('.drop-at', box).forEach((x) => x.classList.remove('drop-at', 'before', 'after'));
          let ids = this.dragging;
          if (!ids) {
            const files = Array.from(e.dataTransfer.files || []).filter((f) => f.type.startsWith('image/'));
            ids = [];
            for (const f of files) { try { const m = await window.api.mediaFromBuffer(this.app.project.id, new Uint8Array(await f.arrayBuffer()), f.name); this.app.mediaAdded(m, { silent: true }); ids.push(m.id); } catch (err) { T.toast(err.message, { kind: 'error' }); } }
          }
          if (!ids.length) return;
          this.moveTo(ids, grid.dataset.g, t.el ? t.el.dataset.id : null, t.after);
        });
      });
    }
    dropTarget(grid, e) {
      const cards = T.$$('.cap', grid).filter((c) => !(this.dragging || []).includes(c.dataset.id));
      let best = null, bd = Infinity, after = false;
      for (const c of cards) {
        const r = c.getBoundingClientRect();
        const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
        if (d < bd) { bd = d; best = c; after = e.clientX > r.left + r.width / 2; }
      }
      return { el: best, after };
    }
    moveTo(ids, gid, beforeId, after) {
      const gs = this.groups();
      for (const g of gs) g.media = g.media.filter((x) => !ids.includes(x));
      const g = gs.find((x) => x.id === gid) || gs[0];
      let at = beforeId ? g.media.indexOf(beforeId) + (after ? 1 : 0) : g.media.length;
      if (at < 0) at = g.media.length;
      g.media.splice(at, 0, ...ids);
      this.setGroups(gs);
      this.render();
    }
    orderedSel() { return this.groups().flatMap((g) => g.media).filter((id) => this.sel.has(id)); }

    // ---- selection ----
    select(id, e) {
      const flat = this.groups().flatMap((g) => g.media);
      if (e && e.shiftKey && this.last) {
        const a = flat.indexOf(this.last), b = flat.indexOf(id);
        const [s, t] = a < b ? [a, b] : [b, a];
        flat.slice(s, t + 1).forEach((x) => this.sel.add(x));
      } else if (e && T.mod(e)) { if (this.sel.has(id)) this.sel.delete(id); else this.sel.add(id); }
      else { this.sel.clear(); this.sel.add(id); }
      this.last = id;
      T.$$('.cap', this.root).forEach((c) => c.classList.toggle('sel', this.sel.has(c.dataset.id)));
      this.selbar();
    }
    selbar() {
      const bar = T.$('.selbar', this.root);
      const n = this.sel.size;
      bar.hidden = !n;
      if (!n) return;
      bar.innerHTML = `<b>${n} selected</b><button class="btn sm" data-act="new-guide">${T.icon('guide')}New guide</button><button class="btn sm" data-act="to-guide">Add to guide${T.icon('chevdown', 12)}</button>
        <button class="btn sm" data-act="move">Move to${T.icon('chevdown', 12)}</button>${n === 1 ? `<button class="btn sm" data-act="copy">${T.icon('copy')}Copy</button>` : ''}<button class="btn sm" data-act="png">${T.icon('download')}Save</button>
        <button class="btn sm danger" data-act="delete">${T.icon('trash')}</button><button class="icon-btn ghost sm" data-act="clear" title="Clear selection (Esc)">${T.icon('x', 14)}</button>`;
    }

    // ---- actions ----
    async onClick(e) {
      const a = e.target.closest('[data-act]');
      const card = e.target.closest('.cap');
      if (!a && card && !e.target.closest('input')) return this.select(card.dataset.id, e);
      if (!a) { if (!e.target.closest('.selbar,.view-bar,input,.cap-group header') && this.sel.size) { this.sel.clear(); this.render(); } return; }
      const act = a.dataset.act;
      if (act === 'capture') return this.app.capture('region');
      if (act === 'bar') return this.app.toggleBar();
      if (act === 'perm') return window.api.openCaptureSettings();
      if (act === 'import') { const list = await window.api.importMedia(this.app.project.id); list.forEach((m) => this.app.mediaAdded(m, { silent: true })); if (list.length) { this.render(); T.toast(T.plural(list.length, 'image') + ' imported'); } return; }
      if (act === 'group') return this.newGroup();
      if (act === 'annotate' && card) return this.annotate(card.dataset.id);
      if (act === 'view' && card) return this.app.viewMedia(card.dataset.id, this.groups().flatMap((g) => g.media));
      if (act === 'gmenu') return this.groupMenu(a, a.dataset.g);
      if (act === 'guide-from') { const g = this.groups().find((x) => x.id === a.dataset.g); return this.app.newGuideFrom(g.media, g.inbox ? '' : g.name); }
      if (act === 'present-group') { const g = this.groups().find((x) => x.id === a.dataset.g); return this.app.presentMedia(g.media, g.inbox ? 'Captures' : g.name); }
      if (act === 'clear') { this.sel.clear(); return this.render(); }
      const ids = this.orderedSel();
      if (act === 'new-guide') return this.app.newGuideFrom(ids);
      if (act === 'to-guide') {
        const guides = this.app.project.items.filter((i) => i.type === 'guide');
        return T.menuAt(a, guides.length ? guides.map((gd) => ({ label: gd.title || 'Untitled guide', icon: 'guide', onClick: () => this.app.addToGuide(gd, ids) })) : [{ label: 'No guides yet: make one', icon: 'plus', onClick: () => this.app.newGuideFrom(ids) }]);
      }
      if (act === 'move') {
        const gs = this.groups();
        return T.menuAt(a, [...gs.map((g) => ({ label: g.name, icon: g.inbox ? 'download' : 'images', onClick: () => this.moveTo(ids, g.id) })), { sep: true }, { label: 'New group…', icon: 'plus', onClick: () => this.newGroup(ids) }]);
      }
      if (act === 'copy') { const m = this.app.media.get(ids[0]); try { await window.api.copyImage(await T.annot.toPng(this.app.project.id, m)); T.toast('Copied with annotations'); } catch (err) { T.toast(err.message, { kind: 'error' }); } return; }
      if (act === 'png') return this.savePngs(ids);
      if (act === 'delete') return this.remove(ids);
    }
    async savePngs(ids) {
      for (const id of ids) {
        const m = this.app.media.get(id);
        try { const f = await window.api.saveFile(await T.annot.toPng(this.app.project.id, m), m.name || 'Screenshot ' + T.fmtDate(m.created), 'png'); if (!f) break; } catch (err) { T.toast(err.message, { kind: 'error' }); break; }
      }
    }
    async newGroup(ids) {
      const name = await T.prompt('New group', 'Group ' + (this.app.project.captureGroups.length + 1), 'e.g. Pulling the report');
      if (!name) return;
      const gs = this.groups();
      const g = { id: T.uid(8), name, media: [] };
      if (ids) { for (const x of gs) x.media = x.media.filter((id) => !ids.includes(id)); g.media = ids.slice(); }
      gs.push(g);
      this.setGroups(gs);
      this.render();
    }
    groupMenu(btn, gid) {
      const gs = this.groups(), g = gs.find((x) => x.id === gid), i = gs.indexOf(g);
      T.menuAt(btn, [
        { label: 'Make a guide from this group', icon: 'guide', onClick: () => this.app.newGuideFrom(g.media, g.name) },
        { label: 'Select all in group', onClick: () => { this.sel = new Set(g.media); this.render(); } },
        i > 1 && { label: 'Move group up', onClick: () => { [gs[i - 1], gs[i]] = [gs[i], gs[i - 1]]; this.setGroups(gs); this.render(); } },
        i < gs.length - 1 && { label: 'Move group down', onClick: () => { [gs[i + 1], gs[i]] = [gs[i], gs[i + 1]]; this.setGroups(gs); this.render(); } },
        { sep: true },
        { label: 'Remove group (keeps screenshots)', onClick: () => { gs[0].media.push(...g.media); gs.splice(i, 1); this.setGroups(gs); this.render(); } },
        { label: 'Delete group and its screenshots', danger: true, icon: 'trash', onClick: () => this.remove(g.media.slice(), gid) }
      ]);
    }
    cardMenu(x, y) {
      const ids = this.orderedSel(), one = ids.length === 1 ? this.app.media.get(ids[0]) : null;
      T.menu(x, y, [
        one && { label: 'Annotate', icon: 'pen', onClick: () => this.annotate(one.id) },
        one && { label: 'View', icon: 'eye', onClick: () => this.app.viewMedia(one.id, this.groups().flatMap((g) => g.media)) },
        one && { label: 'Copy with annotations', icon: 'copy', onClick: () => T.$('[data-act="copy"]', this.root).click() },
        { label: ids.length > 1 ? `Save ${ids.length} as PNG…` : 'Save as PNG…', icon: 'download', onClick: () => this.savePngs(ids) },
        one && { label: T.isMac ? 'Show in Finder' : 'Show in Explorer', icon: 'folder', onClick: () => window.api.revealMedia(this.app.project.id, one.id) },
        { sep: true },
        { label: 'New guide from selection', icon: 'guide', onClick: () => this.app.newGuideFrom(ids) },
        { label: 'Move to new group…', icon: 'images', onClick: () => this.newGroup(ids) },
        { sep: true },
        { label: ids.length > 1 ? `Delete ${ids.length}` : 'Delete', icon: 'trash', danger: true, onClick: () => this.remove(ids) }
      ]);
    }
    async remove(ids, dropGroup) {
      if (!ids.length && !dropGroup) return;
      const used = this.app.mediaUsage(ids);
      const ok = await T.confirm(ids.length === 1 ? 'Delete this screenshot?' : `Delete ${ids.length} screenshots?`,
        (used ? `${used} of them ${used === 1 ? 'is' : 'are'} used in a chart, note or guide and will disappear there too. ` : '') + 'They go to the Trash.', 'Delete', true);
      if (!ok) return;
      await window.api.deleteMedia(this.app.project.id, ids);
      this.app.mediaRemoved(ids);
      if (dropGroup) this.app.mutate(this.app.project, () => { this.app.project.captureGroups = this.app.project.captureGroups.filter((g) => g.id !== dropGroup); }, null, { project: true });
      this.sel.clear();
      this.render();
    }
    async annotate(id) { const m = this.app.media.get(id); if (!m) return; await T.annot.edit(this.app, m); this.render(); }
    onKey(e) {
      if (e.target.closest('input,textarea,[contenteditable="true"]') || document.querySelector('.modal-back,.annot,.viewer')) return;
      if (e.key === 'Escape' && this.sel.size) { this.sel.clear(); this.render(); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel.size) { e.preventDefault(); this.remove(this.orderedSel()); }
      if (T.mod(e) && e.key.toLowerCase() === 'a') { e.preventDefault(); this.sel = new Set(this.groups().flatMap((g) => g.media)); this.render(); }
      if (e.key === 'Enter' && this.sel.size === 1) this.annotate([...this.sel][0]);
      if (e.key === ' ' && this.sel.size === 1) { e.preventDefault(); this.app.viewMedia([...this.sel][0], this.groups().flatMap((g) => g.media)); }
    }
    async onPaste(e) {
      if (e.target.closest('input,textarea,[contenteditable="true"]')) return;
      const files = Array.from(e.clipboardData.files || []).filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      for (const f of files) { const m = await window.api.mediaFromBuffer(this.app.project.id, new Uint8Array(await f.arrayBuffer()), 'Pasted image'); this.app.mediaAdded(m, { silent: true }); }
      this.render();
      T.toast(T.plural(files.length, 'image') + ' pasted');
    }
    added(m) {
      this.render();
      const el = T.$(`.cap[data-id="${m.id}"]`, this.root);
      if (el) { el.classList.add('arrive'); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    }
    mediaChanged() { this.render(); }
    reload() { this.render(); }
    setBar(on) { const b = T.$('[data-act="bar"]', this.root); if (b) b.classList.toggle('on', on); }
    destroy() { document.removeEventListener('keydown', this.keyH); document.removeEventListener('paste', this.pasteH); this.root.remove(); }
  }
  T.CapturesView = CapturesView;
})();
