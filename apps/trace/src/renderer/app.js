// Trace — the app shell: projects, sidebar, views, undo, saving, search, settings and the screenshot hooks.
(function () {
  const T = window.T;
  const api = window.api;
  const TYPE_ICON = { chart: 'chart', note: 'note', guide: 'guide' };
  const TYPE_LABEL = { chart: 'Charts', note: 'Notes', guide: 'Guides' };

  const app = {
    settings: {}, platform: '', projects: [], project: null, media: new Map(), view: null, current: null,
    history: new Map(), clipboard: null, barOpen: false, capSize: 230, presenting: null,

    // ---------------------------------------------------------------- boot
    async boot() {
      const b = await api.bootstrap();
      this.settings = b.settings; this.platform = b.platform; this.projects = b.projects; this.version = b.version; this.library = b.library;
      document.documentElement.classList.add('os-' + b.platform);
      this.applyTheme();
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyTheme());
      this.save = T.debounce(() => this.saveNow(), 450);
      if (!this.projects.length && !this.settings.seeded) await this.seedWelcome();
      else if (!this.projects.length) await this.createProject('My project', { open: false });
      this.projects = await api.projects();
      const first = this.projects.find((p) => p.id === this.settings.lastProject) || this.projects[0];
      this.bindGlobal();
      await this.openProject(first.id);
      if (b.shortcutsFailed && b.shortcutsFailed.length) T.toast(`Another app is using ${b.shortcutsFailed.map((s) => T.kbd(T.accel(s))).join(' and ')}. Pick a different screenshot shortcut in Settings.`, { ms: 7000, action: 'Settings', onAction: () => this.openSettings() });
    },
    applyTheme() {
      const t = this.settings.theme || 'system';
      const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      const cs = getComputedStyle(document.documentElement);
      api.windowChrome(cs.getPropertyValue('--bg-side').trim() || (dark ? '#0c0d12' : '#f5f5f8'), dark ? '#a9adbb' : '#4a4d58').catch(() => {});
    },
    async setSetting(patch) {
      const r = await api.setSettings(patch);
      this.settings = r.settings;
      if ('theme' in patch) this.applyTheme();
      return r;
    },

    // ---------------------------------------------------------------- projects
    async createProject(name, opts = {}) {
      const colors = Object.keys(T.COLORS);
      const p = await api.createProject({ name, color: opts.color || colors[this.projects.length % colors.length], items: opts.items || [] });
      this.projects = await api.projects();
      if (opts.open !== false) await this.openProject(p.id);
      return p;
    },
    async openProject(id) {
      await this.flush();
      const { project, media } = await api.loadProject(id);
      this.project = project;
      this.media = new Map(media.map((m) => [m.id, m]));
      this.history.clear();
      api.setActiveProject(id).catch(() => {});
      const last = project.lastView;
      this.renderSidebar();
      if (last && last.kind === 'item' && project.items.find((i) => i.id === last.id)) this.show(last);
      else this.show({ kind: 'home' });
    },
    async seedWelcome() {
      const items = T.welcomeItems();
      const p = await api.createProject({ name: 'Welcome to Trace', color: 'violet', items });
      try {
        const media = await api.seedMedia(p.id);
        const ann = SEED_ANNOTATIONS;
        const updated = [];
        for (let i = 0; i < media.length; i++) updated.push(ann[i] ? await api.updateMedia(p.id, media[i].id, { annotations: ann[i].annotations, name: ann[i].name }) : media[i]);
        const { project } = await api.loadProject(p.id);
        const guide = project.items.find((x) => x.type === 'guide');
        if (guide) guide.steps = updated.map((m, i) => T.newStep(m.id, SEED_ANNOTATIONS[i] ? SEED_ANNOTATIONS[i].step : m.name, SEED_ANNOTATIONS[i] ? SEED_ANNOTATIONS[i].html : ''));
        // the first screenshot also illustrates a step in the decision chart
        const dec = project.items.find((x) => x.type === 'chart');
        const full = dec && dec.nodes.find((n) => n.title.startsWith('Is the full week'));
        if (full && updated[1]) full.images = [updated[1].id];
        project.captureOrder = [];
        project.captureGroups = [{ id: T.uid(8), name: 'Weekly sign-up report', media: updated.map((m) => m.id) }];
        project.lastView = { kind: 'item', id: (project.items.find((x) => x.type === 'note') || {}).id };
        await api.saveProject(project);
      } catch (e) { console.error(e); }
      await this.setSetting({ seeded: true });
    },
    async flush() {
      if (this.current && this.current.flush) this.current.flush();
      if (this.project && this.dirty) { this.save.cancel(); await this.saveNow(); }
    },
    async saveNow() {
      if (!this.project) return;
      this.dirty = false;
      try { this.project.updated = await api.saveProject(this.project); this.saveFailed = false; }
      catch (e) { this.dirty = true; if (!this.saveFailed) T.toast('Couldn’t save: ' + e.message, { kind: 'error' }); this.saveFailed = true; }
    },

    // ---------------------------------------------------------------- undo & saving
    hist(id) { if (!this.history.has(id)) this.history.set(id, { undo: [], redo: [], key: null, at: 0 }); return this.history.get(id); },
    mutate(target, fn, key, opts = {}) {
      if (!opts.project) {
        const h = this.hist(target.id), now = Date.now();
        if (!(key && h.key === key && now - h.at < 1500)) { h.undo.push(JSON.stringify(target)); if (h.undo.length > 200) h.undo.shift(); h.redo.length = 0; }
        h.key = key; h.at = now;
      }
      fn();
      if (!opts.project) target.updated = new Date().toISOString();
      this.dirty = true;
      this.save();
    },
    currentItem() { return this.view && this.view.kind === 'item' ? this.item(this.view.id) : null; },
    item(id) { return this.project.items.find((i) => i.id === id); },
    restore(item, json) { const data = JSON.parse(json); for (const k of Object.keys(item)) delete item[k]; Object.assign(item, data); },
    undo() {
      const it = this.currentItem(); if (!it) return;
      const h = this.hist(it.id);
      if (!h.undo.length) return T.toast('Nothing to undo');
      h.redo.push(JSON.stringify(it)); this.restore(it, h.undo.pop()); h.key = null;
      this.dirty = true; this.save();
      this.current && this.current.reload && this.current.reload(it);
      this.renderSidebar();
    },
    redo() {
      const it = this.currentItem(); if (!it) return;
      const h = this.hist(it.id);
      if (!h.redo.length) return T.toast('Nothing to redo');
      h.undo.push(JSON.stringify(it)); this.restore(it, h.redo.pop()); h.key = null;
      this.dirty = true; this.save();
      this.current && this.current.reload && this.current.reload(it);
      this.renderSidebar();
    },

    // ---------------------------------------------------------------- media
    mediaAdded(m, opts = {}) {
      if (this.media.has(m.id)) return;
      this.media.set(m.id, m);
      this.renderSidebar();
      if (this.view && this.view.kind === 'captures' && this.current && this.current.added) this.current.added(m);
      if (!opts.silent && document.hasFocus()) T.toast('Screenshot added to Captures', { action: 'Annotate', onAction: () => T.annot.edit(this, m) });
    },
    mediaChanged(m, opts = {}) {
      this.media.set(m.id, m);
      if (opts.quiet) return;
      if (this.current) {
        if (this.current.mediaChanged) this.current.mediaChanged(m);
        else if (this.current instanceof T.ChartView) { this.current.keys.clear(); this.current.render({ animate: false }); if (this.current.sel.size) this.current.renderInspector(); }
      }
    },
    mediaRemoved(ids) {
      const gone = new Set(ids);
      ids.forEach((id) => this.media.delete(id));
      // drop references everywhere
      this.mutate(this.project, () => {
        for (const it of this.project.items) {
          if (it.type === 'chart') it.nodes.forEach((n) => { if (n.images) n.images = n.images.filter((x) => !gone.has(x)); });
          if (it.type === 'guide') it.steps.forEach((s) => { if (gone.has(s.media)) s.media = null; });
          if (it.type === 'note' && it.html) { const d = document.createElement('div'); d.innerHTML = it.html; d.querySelectorAll('img[data-media]').forEach((img) => { if (gone.has(img.dataset.media)) img.remove(); }); it.html = d.innerHTML; }
        }
        this.project.captureOrder = this.project.captureOrder.filter((x) => !gone.has(x));
        this.project.captureGroups.forEach((g) => { g.media = g.media.filter((x) => !gone.has(x)); });
      }, null, { project: true });
      this.renderSidebar();
    },
    mediaUsage(ids) {
      const set = new Set(ids); let n = 0;
      for (const id of set) {
        const used = this.project.items.some((it) => (it.type === 'chart' && it.nodes.some((x) => (x.images || []).includes(id))) || (it.type === 'guide' && it.steps.some((s) => s.media === id)) || (it.type === 'note' && (it.html || '').includes(id)));
        if (used) n++;
      }
      return n;
    },
    // A picker over this project's screenshots (plus import and capture). Resolves to a list of media.
    pickMedia(opts = {}) {
      return new Promise((resolve) => {
        let chosen = [];
        const pid = this.project.id;
        const body = T.el(`<div class="picker"><div class="picker-bar"><button class="btn sm" data-p="import">${T.icon('upload')}Import…</button><button class="btn sm" data-p="capture">${T.icon('region')}Capture now</button><span class="muted small">${opts.multi ? 'Click to pick several, in order' : 'Click one'}</span></div><div class="picker-grid"></div></div>`);
        const grid = T.$('.picker-grid', body);
        const draw = () => {
          const all = [...this.media.values()].filter((m) => !(opts.hide && opts.hide.has(m.id))).sort((a, b) => String(b.created).localeCompare(String(a.created)));
          grid.innerHTML = all.map((m) => `<button class="pick ${chosen.includes(m.id) ? 'on' : ''}" data-id="${m.id}">${T.annot.svg(m, T.mediaUrl(pid, m.file))}${chosen.includes(m.id) ? `<span class="pick-n">${opts.multi ? chosen.indexOf(m.id) + 1 : T.icon('check', 12)}</span>` : ''}<span class="pick-name">${T.esc(m.name || T.fmtDate(m.created))}</span></button>`).join('') || '<p class="muted">No screenshots in this project yet. Capture or import some.</p>';
        };
        draw();
        let result = null;
        const md = T.modal({ title: opts.title || 'Choose images', body, wide: true, onClose: () => resolve(result),
          actions: [{ label: 'Cancel' }, { label: opts.multi ? 'Add' : 'Choose', kind: 'primary', onClick: () => { result = chosen.map((id) => this.media.get(id)).filter(Boolean); } }] });
        body.addEventListener('click', async (e) => {
          const p = e.target.closest('[data-p]');
          if (p && p.dataset.p === 'import') { const list = await api.importMedia(pid); list.forEach((m) => this.mediaAdded(m, { silent: true })); chosen.push(...list.map((m) => m.id)); draw(); return; }
          if (p && p.dataset.p === 'capture') { md.el.style.visibility = 'hidden'; try { const r = await api.capture('region'); if (r && r.pid === pid) { this.mediaAdded(r.media, { silent: true }); chosen.push(r.media.id); } } finally { md.el.style.visibility = ''; } draw(); return; }
          const b = e.target.closest('.pick'); if (!b) return;
          const id = b.dataset.id;
          if (!opts.multi) { result = [this.media.get(id)]; md.close(); return; }
          chosen = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id];
          draw();
        });
        body.addEventListener('dblclick', (e) => { const b = e.target.closest('.pick'); if (b && opts.multi) { if (!chosen.includes(b.dataset.id)) chosen.push(b.dataset.id); result = chosen.map((id) => this.media.get(id)); md.close(); } });
      });
    },
    // Full-size viewer with next/previous, annotate, copy, save.
    viewMedia(id, list) {
      list = (list && list.length ? list : [id]).filter((x) => this.media.has(x));
      let i = Math.max(0, list.indexOf(id));
      const pid = this.project.id;
      const v = T.el(`<div class="viewer"><div class="vw-bar"><span class="vw-name"></span><div class="grow"></div>
        <button class="btn sm glass" data-v="annotate">${T.icon('pen')}Annotate</button><button class="btn sm glass" data-v="copy">${T.icon('copy')}Copy</button><button class="btn sm glass" data-v="save">${T.icon('download')}Save</button>
        <button class="icon-btn glass" data-v="close">${T.icon('x', 17)}</button></div><div class="vw-stage"></div>
        <button class="vw-nav prev" data-v="prev">${T.icon('chevleft', 22)}</button><button class="vw-nav next" data-v="next">${T.icon('chevron', 22)}</button></div>`);
      document.body.appendChild(v);
      const draw = () => {
        const m = this.media.get(list[i]);
        T.$('.vw-stage', v).innerHTML = T.annot.svg(m, T.mediaUrl(pid, m.file));
        T.$('.vw-name', v).textContent = (list.length > 1 ? `${i + 1} of ${list.length} · ` : '') + (m.name || T.fmtDate(m.created));
        T.$('.prev', v).hidden = i === 0; T.$('.next', v).hidden = i === list.length - 1;
      };
      const close = () => { document.removeEventListener('keydown', key, true); v.classList.add('out'); setTimeout(() => v.remove(), 160); };
      const key = (e) => {
        if (document.querySelector('.annot')) return;
        if (e.key === 'Escape' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); close(); }
        if (e.key === 'ArrowRight' && i < list.length - 1) { i++; draw(); }
        if (e.key === 'ArrowLeft' && i > 0) { i--; draw(); }
      };
      document.addEventListener('keydown', key, true);
      v.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-v]');
        if (!b) { if (e.target === v || e.target.classList.contains('vw-stage')) close(); return; }
        const m = this.media.get(list[i]);
        if (b.dataset.v === 'close') close();
        if (b.dataset.v === 'prev' && i > 0) { i--; draw(); }
        if (b.dataset.v === 'next' && i < list.length - 1) { i++; draw(); }
        if (b.dataset.v === 'annotate') { await T.annot.edit(this, m); draw(); }
        if (b.dataset.v === 'copy') { try { await api.copyImage(await T.annot.toPng(pid, m)); T.toast('Copied'); } catch (err) { T.toast(err.message, { kind: 'error' }); } }
        if (b.dataset.v === 'save') { const f = await api.saveFile(await T.annot.toPng(pid, m), m.name || 'Screenshot', 'png'); if (f) T.toast('Saved', { action: 'Show', onAction: () => api.reveal(f) }); }
      });
      requestAnimationFrame(() => v.classList.add('in'));
      draw();
    },

    // ---------------------------------------------------------------- capture
    async capture(mode) {
      try { const r = await api.capture(mode); if (r && r.pid === this.project.id) this.mediaAdded(r.media, { silent: true }); if (r && this.view.kind !== 'captures') T.toast('Screenshot saved to Captures', { action: 'Open', onAction: () => this.show({ kind: 'captures' }) }); }
      catch (e) { T.toast(e.message, { kind: 'error' }); }
    },
    async toggleBar() { this.barOpen = await api.captureBar(!this.barOpen); },

    // ---------------------------------------------------------------- items
    async newItem(type, opts = {}) {
      let item;
      if (type === 'chart') {
        const key = opts.template || await this.chooseTemplate();
        if (!key) return;
        if (key === 'folder-scan') return this.mapFolder();
        item = T.fromTemplate(key, { orientation: key === 'workflow' ? 'horizontal' : this.settings.orientation || 'vertical' });
        if (key === 'blank') item.title = 'Untitled chart';
      } else if (type === 'note') item = T.newNote('');
      else item = T.newGuide('');
      if (type === 'note') item.title = '';
      this.mutate(this.project, () => { this.project.items.push(item); }, null, { project: true });
      this.show({ kind: 'item', id: item.id });
      return item;
    },
    chooseTemplate() {
      return new Promise((resolve) => {
        let v = null;
        const keys = Object.keys(T.TEMPLATES);
        const body = T.el(`<div class="tpl-grid">${keys.map((k) => { const t = T.TEMPLATES[k]; return `<button class="tpl" data-k="${k}"><div class="tpl-art t-${k}">${T.icon(t.icon, 26)}</div><b>${T.esc(t.label)}</b><span>${T.esc(t.blurb)}</span></button>`; }).join('')}
          <button class="tpl" data-k="folder-scan"><div class="tpl-art t-scan">${T.icon('search', 26)}</div><b>Map a real folder</b><span>Read a folder on this computer into a chart, with the file types in each.</span></button></div>`);
        const m = T.modal({ title: 'New chart', body, wide: true, onClose: () => resolve(v) });
        body.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) { v = b.dataset.k; m.close(); } });
      });
    },
    async mapFolder() {
      const dir = await api.pickFolder(); if (!dir) return;
      T.toast('Reading the folder…');
      let tree;
      try { tree = await api.scanFolder(dir, { depth: 3 }); } catch (e) { return T.toast(e.message, { kind: 'error' }); }
      const c = T.newChart('Folder map: ' + tree.name, { orientation: 'horizontal', edgeStyle: 'elbow' });
      const top = (counts) => Object.entries(counts || {}).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const walk = (n, parent) => {
        const node = T.newNode('folder', n.name, { sub: parent ? n.rel : tree.path, stats: top(n.counts),
          note: `<p>${T.plural(n.files, 'file')} directly inside${n.more ? `, plus ${T.plural(n.more, 'more folder')} not shown` : ''}.</p>` });
        c.nodes.push(node);
        if (parent) c.edges.push(T.newEdge(parent.id, node.id));
        n.children.forEach((ch) => walk(ch, node));
      };
      walk(tree, null);
      this.mutate(this.project, () => { this.project.items.push(c); }, null, { project: true });
      this.show({ kind: 'item', id: c.id });
      T.toast(`Mapped ${T.plural(c.nodes.length, 'folder')}${tree.truncated ? ' (stopped at 400)' : ''}. Add rules to each folder to say what belongs there.`, { ms: 6000 });
    },
    newGuideFrom(ids, name) {
      const g = T.newGuide(name || 'New guide');
      g.steps = ids.map((id) => { const m = this.media.get(id); return T.newStep(id, (m && m.name) || '', ''); });
      this.mutate(this.project, () => { this.project.items.push(g); }, null, { project: true });
      this.show({ kind: 'item', id: g.id });
      T.toast(`Guide made with ${T.plural(ids.length, 'step')}. Give each one a line about what to do.`);
    },
    addToGuide(g, ids) {
      this.mutate(g, () => { g.steps.push(...ids.map((id) => { const m = this.media.get(id); return T.newStep(id, (m && m.name) || '', ''); })); });
      T.toast(`Added ${T.plural(ids.length, 'step')} to “${g.title || 'Untitled guide'}”`, { action: 'Open', onAction: () => this.show({ kind: 'item', id: g.id }) });
    },
    async renameItem(it) {
      const v = await T.prompt('Rename', it.title || '', 'Name');
      if (v == null) return;
      this.mutate(it, () => { it.title = v; });
      if (this.view.id === it.id) this.current.reload(it);
      this.renderSidebar();
    },
    duplicateItem(it) {
      const c = T.clone(it); c.id = T.uid(10); c.title = (it.title || 'Untitled') + ' copy'; c.created = c.updated = new Date().toISOString();
      if (c.type === 'chart') { const map = {}; c.nodes.forEach((n) => { map[n.id] = T.uid(10); n.id = map[n.id]; }); c.edges.forEach((e) => { e.id = T.uid(10); e.from = map[e.from]; e.to = map[e.to]; }); (c.scenarios || []).forEach((s) => { s.id = T.uid(8); s.path = s.path.map((x) => map[x]).filter(Boolean); }); }
      if (c.type === 'guide') c.steps.forEach((s) => { s.id = T.uid(10); });
      const i = this.project.items.indexOf(it);
      this.mutate(this.project, () => { this.project.items.splice(i + 1, 0, c); }, null, { project: true });
      this.show({ kind: 'item', id: c.id });
    },
    deleteItem(it) {
      const i = this.project.items.indexOf(it);
      this.mutate(this.project, () => { this.project.items.splice(i, 1); }, null, { project: true });
      if (this.view.id === it.id) this.show({ kind: 'home' }); else this.renderSidebar();
      T.toast(`Deleted “${it.title || 'Untitled'}”`, { action: 'Undo', onAction: () => { this.mutate(this.project, () => { this.project.items.splice(i, 0, it); }, null, { project: true }); this.show({ kind: 'item', id: it.id }); } });
    },
    itemMenu(it, anchor, at) {
      const items = [
        { label: 'Open', icon: TYPE_ICON[it.type], onClick: () => this.show({ kind: 'item', id: it.id }) },
        { label: 'Present', icon: 'present', kbd: 'Mod+Enter', onClick: () => this.present(it) },
        { label: 'Export PDF…', icon: 'pdf', kbd: 'Mod+E', onClick: () => this.exportItem(it) },
        { sep: true },
        { label: 'Rename', icon: 'edit', onClick: () => this.renameItem(it) },
        { label: 'Duplicate', icon: 'copy', onClick: () => this.duplicateItem(it) },
        this.projects.length > 1 && { label: 'Move to project', icon: 'next', sub: this.projects.filter((p) => p.id !== this.project.id).map((p) => ({ label: p.name, swatch: T.colorOf(p.color), onClick: () => this.moveItem(it, p.id) })) },
        { sep: true },
        { label: 'Delete', icon: 'trash', danger: true, onClick: () => this.deleteItem(it) }
      ];
      return at ? T.menu(at.x, at.y, items) : T.menuAt(anchor, items);
    },
    async moveItem(it, pid) {
      // images an item uses stay in this project; the item keeps working there only if it has none
      const uses = it.type === 'chart' ? it.nodes.some((n) => (n.images || []).length) : it.type === 'guide' ? it.steps.some((s) => s.media) : /data-media/.test(it.html || '');
      if (uses && !(await T.confirm('Move without its images?', 'Screenshots stay in this project, so they won’t show in the moved copy. Duplicate the screenshots by exporting first if you need them.', 'Move anyway'))) return;
      await this.flush();
      const { project } = await api.loadProject(pid);
      project.items.push(T.clone(it));
      await api.saveProject(project);
      await api.loadProject(this.project.id); await api.setActiveProject(this.project.id);
      this.deleteItem(it);
      this.projects = await api.projects();
    },

    // ---------------------------------------------------------------- present & export
    present(it, opts) { if (!it) return; this.flush(); T.present(this, it, opts); },
    presentMedia(ids, title) { if (ids.length) T.presentMedia(this, ids, title); },
    exportItem(it) {
      if (!it) return;
      const isChart = it.type === 'chart';
      const hasNotes = isChart && it.nodes.some((n) => (n.note && T.textOf(n.note)) || (n.images || []).length);
      const body = T.el(`<div class="export-opts">
        <label class="fld">Paper<div class="seg wide" data-g="paper"><button class="on" data-v="letter">Letter</button><button data-v="a4">A4</button>${isChart ? '<button data-v="poster">One big page</button>' : ''}</div></label>
        ${isChart ? `<label class="fld row"><input type="checkbox" data-o="notes" ${hasNotes ? 'checked' : ''}> Add each step’s notes and images after the chart</label>
          <label class="fld row"><input type="checkbox" data-o="scenarios" ${(it.scenarios || []).length ? 'checked' : ''} ${(it.scenarios || []).length ? '' : 'disabled'}> Add the scenarios (${(it.scenarios || []).length})</label>
          <p class="muted small">“One big page” makes a single page the size of the whole chart, sharp at any zoom. Good for big org charts and folder maps.</p>` : ''}
      </div>`);
      let paper = 'letter';
      body.addEventListener('click', (e) => { const b = e.target.closest('[data-g="paper"] button'); if (!b) return; paper = b.dataset.v; T.$$('[data-g="paper"] button', body).forEach((x) => x.classList.toggle('on', x === b)); });
      T.modal({ title: 'Export “' + (it.title || 'Untitled') + '” to PDF', body, actions: [{ label: 'Cancel' }, { label: 'Export PDF', kind: 'primary', icon: 'pdf', onClick: () => {
        const o = { paper: paper === 'poster' ? 'letter' : paper, poster: paper === 'poster', notes: !!(T.$('[data-o="notes"]', body) || {}).checked, scenarios: !!(T.$('[data-o="scenarios"]', body) || {}).checked };
        this.runExport(it, o);
      } }] });
    },
    async runExport(it, o) {
      await this.flush();
      let html;
      const E = T.exportHtml;
      try {
        if (it.type === 'note') html = E.doc(E.noteBody(this, it), { title: it.title, paper: o.paper });
        else if (it.type === 'guide') html = E.doc(E.guideBody(this, it), { title: it.title, paper: o.paper });
        else {
          const snap = await this.chartSnapshot(it);
          const r = E.chartBody(this, it, snap, o);
          html = E.doc(r.body, { title: it.title, paper: o.paper, chartPage: r.chartPage, chartMargin: r.chartMargin });
        }
        T.toast('Making the PDF…');
        const file = await api.exportPdf(html, { name: it.title || 'Trace' });
        if (file) T.toast('Exported to PDF', { action: 'Open', onAction: () => api.openPath(file), ms: 7000 });
      } catch (e) { T.toast('Export failed: ' + e.message, { kind: 'error' }); }
    },
    // Lay a chart out off-screen (with no trace or selection) and take its static markup.
    async chartSnapshot(it) {
      const host = T.el('<div class="offscreen"></div>');
      document.body.appendChild(host);
      const v = new T.ChartView(host, { app: this, item: it, mode: 'present' });
      await new Promise((r) => setTimeout(r, 60));
      const snap = v.staticMarkup();
      v.destroy(); host.remove();
      return snap;
    },
    async exportProject() {
      await this.flush();
      const E = T.exportHtml;
      const parts = [`<article class="pdoc cover"><div class="p-kicker">Project</div><h1>${T.esc(this.project.name)}</h1><div class="foot">${E.today()}</div>
        <ol class="toc">${this.project.items.map((i) => `<li>${T.esc(i.title || 'Untitled')} <span class="muted">· ${i.type}</span></li>`).join('')}</ol></article>`];
      for (const it of this.project.items) {
        let b;
        if (it.type === 'note') b = E.noteBody(this, it);
        else if (it.type === 'guide') b = E.guideBody(this, it);
        else b = E.chartBody(this, it, await this.chartSnapshot(it), { paper: 'letter', notes: true, scenarios: true }).body;
        parts.push(`<div class="pbreak"></div>${b}`);
      }
      T.toast('Making the PDF…');
      try { const f = await api.exportPdf(E.doc(parts.join(''), { title: this.project.name }), { name: this.project.name }); if (f) T.toast('Exported to PDF', { action: 'Open', onAction: () => api.openPath(f) }); }
      catch (e) { T.toast('Export failed: ' + e.message, { kind: 'error' }); }
    },

    // ---------------------------------------------------------------- views
    show(view) {
      if (this.presenting) this.presenting.close();
      if (this.current) { if (this.current.flush) this.current.flush(); this.current.destroy(); this.current = null; }
      this.view = view;
      const host = T.$('#view');
      host.innerHTML = '';
      if (view.kind === 'item') {
        const it = this.item(view.id);
        if (!it) return this.show({ kind: 'home' });
        if (it.type === 'chart') this.current = new T.ChartView(host, { app: this, item: it });
        if (it.type === 'note') this.current = new T.NoteView(host, { app: this, item: it });
        if (it.type === 'guide') this.current = new T.GuideView(host, { app: this, item: it });
        if (it.type === 'chart') setTimeout(() => this.current && this.current.canvas && this.current.canvas.focus({ preventScroll: true }), 50);
      } else if (view.kind === 'captures') this.current = new T.CapturesView(host, { app: this });
      else this.current = new HomeView(host, this);
      if (this.project.lastView === undefined || JSON.stringify(this.project.lastView) !== JSON.stringify(view)) { this.project.lastView = view; this.dirty = true; this.save(); }
      this.renderSidebar();
    },
    toggleInspector() {
      const on = this.settings.inspector === false;
      this.setSetting({ inspector: on });
      T.$$('.chart-view').forEach((c) => c.classList.toggle('no-insp', !on));
      setTimeout(() => { if (this.current && this.current.applyCam) this.current.applyCam(); }, 260);
    },
    toggleSidebar() {
      const on = this.settings.sidebar === false;
      this.setSetting({ sidebar: on });
      document.getElementById('app').classList.toggle('no-side', !on);
    },

    // ---------------------------------------------------------------- sidebar
    renderSidebar() {
      const side = T.$('#side');
      if (!this.project) return;
      document.getElementById('app').classList.toggle('no-side', this.settings.sidebar === false);
      const p = this.project, v = this.view || {};
      const sec = (type) => {
        const list = p.items.filter((i) => i.type === type);
        return `<div class="side-sec"><div class="side-h"><span>${TYPE_LABEL[type]}</span><button class="icon-btn ghost xs" data-new="${type}" title="New ${type}">${T.icon('plus', 13)}</button></div>
          ${list.map((i) => `<button class="side-item ${v.kind === 'item' && v.id === i.id ? 'on' : ''}" data-item="${i.id}" draggable="false">${T.icon(TYPE_ICON[type], 15)}<span>${T.esc(i.title || 'Untitled')}</span></button>`).join('') || `<div class="side-empty">None yet</div>`}</div>`;
      };
      const mediaCount = this.media.size;
      side.innerHTML = `<div class="side-top"><div class="brand"><svg viewBox="0 0 24 24" width="18" height="18"><defs><linearGradient id="bg1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b08cff"/><stop offset="1" stop-color="#50dcff"/></linearGradient></defs><path d="M8 5h3v4h7v6" fill="none" stroke="url(#bg1)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><rect x="4" y="2.5" width="7" height="5.5" rx="2" fill="url(#bg1)"/><rect x="14.5" y="14" width="7" height="5.5" rx="2" fill="url(#bg1)"/></svg>Trace</div></div>
        <button class="proj-switch" data-act="projects"><i class="pdot" style="background:${T.colorOf(p.color)}"></i><span>${T.esc(p.name)}</span>${T.icon('chevdown', 13)}</button>
        <button class="side-search" data-act="palette">${T.icon('search', 14)}<span>Search</span><kbd>${T.kbd('Mod+K')}</kbd></button>
        <nav class="side-nav">
          <button class="side-item ${v.kind === 'home' ? 'on' : ''}" data-act="home">${T.icon('home', 15)}<span>Overview</span></button>
          <button class="side-item ${v.kind === 'captures' ? 'on' : ''}" data-act="captures">${T.icon('images', 15)}<span>Captures</span>${mediaCount ? `<em>${mediaCount}</em>` : ''}</button>
        </nav>
        <div class="side-scroll">${sec('chart')}${sec('note')}${sec('guide')}</div>
        <div class="side-foot">
          <button class="cap-btn" data-act="capture" title="Capture a region (${T.esc(T.kbd(T.accel(this.settings.shortcut)))})">${T.icon('region', 16)}<span>Capture</span>${T.kbd(T.accel(this.settings.shortcut)).length <= 5 ? `<kbd>${T.esc(T.kbd(T.accel(this.settings.shortcut)))}</kbd>` : ''}</button>
          <button class="icon-btn ${this.barOpen ? 'on' : ''}" data-act="bar" title="Capture bar: screenshot while you work in other apps">${T.icon('camera', 16)}</button>
          <button class="icon-btn" data-act="settings" title="Settings">${T.icon('settings', 16)}</button>
        </div>`;
    },

    // ---------------------------------------------------------------- palette (search everything)
    palette() {
      if (T.$('.palette')) return;
      const box = T.el(`<div class="modal-back pal-back"><div class="palette"><div class="pal-in">${T.icon('search', 17)}<input placeholder="Search charts, steps, notes, guides, or type a command…" spellcheck="false"></div><div class="pal-res"></div></div></div>`);
      document.body.appendChild(box);
      requestAnimationFrame(() => box.classList.add('in'));
      const input = T.$('input', box), res = T.$('.pal-res', box);
      let rows = [], at = 0;
      const close = () => { box.remove(); document.removeEventListener('keydown', key, true); };
      const cmds = [
        { t: 'New chart', i: 'chart', run: () => this.newItem('chart') }, { t: 'New note', i: 'note', run: () => this.newItem('note') }, { t: 'New guide', i: 'guide', run: () => this.newItem('guide') },
        { t: 'Capture a region', i: 'region', run: () => this.capture('region') }, { t: 'Capture the whole screen', i: 'screen', run: () => this.capture('screen') },
        { t: (this.barOpen ? 'Close' : 'Open') + ' the capture bar', i: 'camera', run: () => this.toggleBar() }, { t: 'Open Captures', i: 'images', run: () => this.show({ kind: 'captures' }) },
        { t: 'New project', i: 'plus', run: () => this.newProjectFlow() }, { t: 'Export the whole project to PDF', i: 'pdf', run: () => this.exportProject() },
        { t: 'Map a real folder into a chart', i: 'folder', run: () => this.mapFolder() }, { t: 'Settings', i: 'settings', run: () => this.openSettings() },
        { t: 'Switch to ' + (document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark') + ' mode', i: document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon', run: () => this.setSetting({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' }) }
      ];
      const score = (text, q) => {
        const t = String(text || '').toLowerCase();
        if (!q) return 1;
        const i = t.indexOf(q);
        if (i < 0) return q.split(/\s+/).every((w) => t.includes(w)) ? 20 : 0;
        return 100 - i - (i && /\w/.test(t[i - 1]) ? 30 : 0);
      };
      const search = () => {
        const q = input.value.trim().toLowerCase();
        const out = [];
        for (const it of this.project.items) { const s = score(it.title || 'untitled', q); if (s) out.push({ s: s + 10, i: TYPE_ICON[it.type], t: it.title || 'Untitled', d: it.type, run: () => this.show({ kind: 'item', id: it.id }) }); }
        if (q) {
          for (const it of this.project.items.filter((x) => x.type === 'chart')) for (const n of it.nodes) {
            const s = Math.max(score(n.title, q), score(n.sub, q) * 0.8, score(T.textOf(n.note || ''), q) * 0.5, score((n.rules || []).join(' '), q) * 0.7);
            if (s) out.push({ s, i: (T.NODE_TYPES[n.type] || {}).icon || 'step', t: n.title || 'Untitled', d: 'step in ' + it.title, run: () => { this.show({ kind: 'item', id: it.id }); setTimeout(() => { const v = this.current; v.select([n.id]); v.fit(true, [n.id]); }, 120); } });
          }
          for (const it of this.project.items.filter((x) => x.type !== 'chart')) { const s = score(T.textOf(it.html || it.intro || '') + ' ' + (it.steps || []).map((x) => x.title).join(' '), q) * 0.5; if (s) out.push({ s, i: TYPE_ICON[it.type], t: it.title || 'Untitled', d: 'text in ' + it.type, run: () => this.show({ kind: 'item', id: it.id }) }); }
          for (const p of this.projects) if (p.id !== this.project.id) { const s = score(p.name, q); if (s) out.push({ s, i: 'grid', t: p.name, d: 'project', run: () => this.openProject(p.id) }); }
          for (const c of cmds) { const s = score(c.t, q); if (s) out.push({ s: s - 5, i: c.i, t: c.t, d: 'command', run: c.run }); }
        } else out.push(...cmds.slice(0, 6).map((c) => ({ s: 0, i: c.i, t: c.t, d: 'command', run: c.run })));
        rows = out.sort((a, b) => b.s - a.s).slice(0, 40);
        at = 0; draw();
      };
      const draw = () => {
        res.innerHTML = rows.map((r, i) => `<button class="pal-row ${i === at ? 'on' : ''}" data-i="${i}">${T.icon(r.i, 16)}<span class="pt">${T.esc(r.t)}</span><span class="pd">${T.esc(r.d)}</span></button>`).join('') || '<div class="pal-none">Nothing found</div>';
        const on = T.$('.pal-row.on', res); if (on) on.scrollIntoView({ block: 'nearest' });
      };
      const key = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        if (e.key === 'ArrowDown') { e.preventDefault(); at = Math.min(rows.length - 1, at + 1); draw(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); at = Math.max(0, at - 1); draw(); }
        if (e.key === 'Enter') { e.preventDefault(); const r = rows[at]; close(); if (r) r.run(); }
      };
      document.addEventListener('keydown', key, true);
      input.addEventListener('input', search);
      res.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) { const r = rows[+b.dataset.i]; close(); r.run(); } });
      box.addEventListener('pointerdown', (e) => { if (e.target === box) close(); });
      search(); input.focus();
    },

    // ---------------------------------------------------------------- projects menu & settings
    projectMenu(anchor) {
      T.menuAt(anchor, [
        { header: 'Projects' },
        ...this.projects.map((p) => ({ label: p.name, swatch: T.colorOf(p.color), checked: p.id === this.project.id, onClick: () => this.openProject(p.id) })),
        { sep: true },
        { label: 'New project…', icon: 'plus', kbd: 'Mod+Shift+N', onClick: () => this.newProjectFlow() },
        { label: 'Rename this project', icon: 'edit', onClick: () => this.renameProject() },
        { label: 'Color', icon: 'palette', sub: Object.entries(T.COLORS).map(([k, v]) => ({ label: k, swatch: v, onClick: () => { this.mutate(this.project, () => { this.project.color = k; }, null, { project: true }); this.saveNow().then(async () => { this.projects = await api.projects(); this.renderSidebar(); }); } })) },
        { label: 'Export the whole project to PDF', icon: 'pdf', onClick: () => this.exportProject() },
        { sep: true },
        { label: 'Delete this project…', icon: 'trash', danger: true, onClick: () => this.deleteProject() }
      ]);
    },
    async newProjectFlow() {
      const name = await T.prompt('New project', '', 'e.g. Onboarding, Q4 reporting, Home office', 'Create');
      if (!name) return;
      await this.flush();
      await this.createProject(name);
    },
    async renameProject() {
      const v = await T.prompt('Rename project', this.project.name);
      if (!v) return;
      this.mutate(this.project, () => { this.project.name = v; }, null, { project: true });
      await this.saveNow();
      this.projects = await api.projects();
      this.renderSidebar();
      if (this.view.kind === 'home') this.show({ kind: 'home' });
    },
    async deleteProject() {
      const ok = await T.confirm(`Delete “${this.project.name}”?`, 'Its charts, notes, guides and screenshots move to the Trash, so you can still get them back from there.', 'Delete project', true);
      if (!ok) return;
      const id = this.project.id;
      this.save.cancel(); this.dirty = false;
      if (this.current) { this.current.destroy(); this.current = null; }
      await api.deleteProject(id);
      this.projects = await api.projects();
      if (!this.projects.length) await this.createProject('My project', { open: false });
      this.projects = await api.projects();
      this.project = null;
      await this.openProject(this.projects[0].id);
    },
    openSettings() {
      const s = this.settings;
      const body = T.el(`<div class="settings">
        <div class="set-row"><div><b>Appearance</b></div><div class="seg" data-g="theme">${['system', 'light', 'dark'].map((t) => `<button class="${(s.theme || 'system') === t ? 'on' : ''}" data-v="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></div>
        <div class="set-row"><div><b>New charts start</b></div><div class="seg" data-g="orientation">${['vertical', 'horizontal'].map((t) => `<button class="${(s.orientation || 'vertical') === t ? 'on' : ''}" data-v="${t}">${T.icon(t, 14)}${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></div>
        <div class="set-row"><div><b>Mouse wheel</b><p class="muted small">Trackpads always scroll to pan and pinch to zoom.</p></div><div class="seg" data-g="wheelZoom">${[['zoom', 'Zooms'], ['pan', 'Pans']].map(([v, l]) => `<button class="${((s.wheelZoom != null ? s.wheelZoom : !T.isMac) ? 'zoom' : 'pan') === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div></div>
        <h4>Screenshots</h4>
        <div class="set-row"><div><b>Capture a region</b><p class="muted small">Works from any app.</p></div><input class="input key-in" data-k="shortcut" readonly value="${T.esc(T.kbd(T.accel(s.shortcut)))}"></div>
        <div class="set-row"><div><b>Repeat the last region</b><p class="muted small">Same spot every time: great for step-by-step guides.</p></div><input class="input key-in" data-k="repeatShortcut" readonly value="${T.esc(T.kbd(T.accel(s.repeatShortcut)))}"></div>
        <div class="set-row"><div><b>Screenshots go to</b></div><select class="input" data-k="captureTarget"><option value="">The project that’s open</option>${this.projects.map((p) => `<option value="${p.id}" ${s.captureTarget === p.id ? 'selected' : ''}>${T.esc(p.name)}</option>`).join('')}</select></div>
        ${T.isMac ? '<div class="set-row"><div><b>Screen recording permission</b><p class="muted small perm-st">Checking…</p></div><button class="btn sm" data-a="perm">Open Settings</button></div>' : ''}
        <h4>Library</h4>
        <div class="set-row"><div><b>Where your projects live</b><p class="muted small mono">${T.esc(this.library)}</p></div><button class="btn sm" data-a="lib">${T.icon('folder')}Show</button></div>
        <p class="muted small">Trace ${T.esc(this.version)} · part of the Utility Package</p></div>`);
      T.modal({ title: 'Settings', body, actions: [{ label: 'Done', kind: 'primary' }] });
      if (T.isMac) api.capturePermission().then((st) => { const el = T.$('.perm-st', body); if (el) el.textContent = st === 'granted' ? 'Allowed' : st === 'denied' ? 'Not allowed yet: turn Trace on, then reopen it' : 'Trace will ask the first time you capture'; });
      body.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-g] button');
        if (b) {
          const g = b.closest('[data-g]').dataset.g;
          T.$$('button', b.parentNode).forEach((x) => x.classList.toggle('on', x === b));
          if (g === 'wheelZoom') await this.setSetting({ wheelZoom: b.dataset.v === 'zoom' }); else await this.setSetting({ [g]: b.dataset.v });
          return;
        }
        const a = e.target.closest('[data-a]');
        if (a && a.dataset.a === 'perm') api.openCaptureSettings();
        if (a && a.dataset.a === 'lib') api.openLibrary();
      });
      T.$('[data-k="captureTarget"]', body).addEventListener('change', (e) => this.setSetting({ captureTarget: e.target.value || null }));
      T.$$('.key-in', body).forEach((inp) => {
        inp.addEventListener('focus', () => { inp.value = 'Press keys…'; inp.classList.add('rec'); });
        inp.addEventListener('blur', () => { inp.classList.remove('rec'); inp.value = T.kbd(T.accel(this.settings[inp.dataset.k])); });
        inp.addEventListener('keydown', async (e) => {
          e.preventDefault(); e.stopPropagation();
          if (e.key === 'Escape') return inp.blur();
          if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return;
          const mods = []; if (e.metaKey || e.ctrlKey) mods.push('CommandOrControl'); if (e.altKey) mods.push('Alt'); if (e.shiftKey) mods.push('Shift');
          if (!mods.length || (mods.length === 1 && mods[0] === 'Shift')) { inp.value = 'Use ' + (T.isMac ? '⌘' : 'Ctrl') + ' or ' + (T.isMac ? '⌥' : 'Alt') + ' with a key'; return; }
          let k = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : /^F\d+$/.test(e.key) ? e.key : e.key.length === 1 ? e.key.toUpperCase() : null;
          if (!k) return;
          const acc = [...mods, k].join('+');
          const r = await this.setSetting({ [inp.dataset.k]: acc });
          inp.blur();
          if (r.shortcutsFailed && r.shortcutsFailed.includes(acc)) T.toast(T.kbd(T.accel(acc)) + ' is taken by another app. Try a different one.', { kind: 'error' });
          else T.toast('Shortcut set to ' + T.kbd(T.accel(acc)));
          this.renderSidebar();
        });
      });
    },

    // ---------------------------------------------------------------- global events
    bindGlobal() {
      T.$('#side').addEventListener('click', (e) => {
        const it = e.target.closest('[data-item]'); if (it) return this.show({ kind: 'item', id: it.dataset.item });
        const nw = e.target.closest('[data-new]'); if (nw) return this.newItem(nw.dataset.new);
        const a = e.target.closest('[data-act]'); if (!a) return;
        const act = a.dataset.act;
        if (act === 'home') this.show({ kind: 'home' });
        if (act === 'captures') this.show({ kind: 'captures' });
        if (act === 'projects') this.projectMenu(a);
        if (act === 'palette') this.palette();
        if (act === 'capture') this.capture('region');
        if (act === 'bar') this.toggleBar();
        if (act === 'settings') this.openSettings();
      });
      T.$('#side').addEventListener('contextmenu', (e) => { const it = e.target.closest('[data-item]'); if (!it) return; e.preventDefault(); this.itemMenu(this.item(it.dataset.item), null, { x: e.clientX, y: e.clientY }); });
      // screenshots and images dropped onto the sidebar's Captures go to the project
      const sideCaps = () => T.$('#side [data-act="captures"]');
      T.$('#side').addEventListener('dragover', (e) => { const c = e.target.closest('[data-act="captures"]'); if (c && e.dataTransfer.types.includes('Files')) { e.preventDefault(); c.classList.add('drop'); } });
      T.$('#side').addEventListener('dragleave', () => { const c = sideCaps(); if (c) c.classList.remove('drop'); });
      T.$('#side').addEventListener('drop', async (e) => {
        const c = e.target.closest('[data-act="captures"]'); if (!c) return; e.preventDefault(); c.classList.remove('drop');
        for (const f of Array.from(e.dataTransfer.files || []).filter((x) => x.type.startsWith('image/'))) { const m = await api.mediaFromBuffer(this.project.id, new Uint8Array(await f.arrayBuffer()), f.name); this.mediaAdded(m, { silent: true }); }
      });
      api.onMediaAdded(({ pid, media }) => { if (this.project && pid === this.project.id) this.mediaAdded(media, { silent: !document.hasFocus() }); });
      api.onBar((on) => { this.barOpen = on; this.renderSidebar(); if (this.current && this.current.setBar) this.current.setBar(on); });
      api.onError((msg) => T.toast(msg, { kind: 'error' }));
      api.onFullscreen((on) => document.documentElement.classList.toggle('fullscreen', on));
      api.onFlush(() => this.flush());
      api.onMenu((cmd) => this.command(cmd));
      document.addEventListener('keydown', (e) => {
        if (T.mod(e) && e.key.toLowerCase() === 'k' && !e.target.closest('.rt-body')) { e.preventDefault(); this.palette(); }
        if (T.mod(e) && e.key === 'Enter' && !document.querySelector('.modal-back,.annot')) { e.preventDefault(); this.command('present'); }
      });
      window.addEventListener('beforeunload', () => { if (this.dirty) this.saveNow(); });
    },
    command(cmd) {
      const typing = document.activeElement && document.activeElement.closest && document.activeElement.closest('input,textarea,[contenteditable="true"],[contenteditable="plaintext-only"]');
      switch (cmd) {
        case 'undo': if (typing) document.execCommand('undo'); else if (document.querySelector('.annot')) T.$('.annot [data-act="undo"]').click(); else this.undo(); break;
        case 'redo': if (typing) document.execCommand('redo'); else if (document.querySelector('.annot')) T.$('.annot [data-act="redo"]').click(); else this.redo(); break;
        case 'new-project': this.newProjectFlow(); break;
        case 'new-chart': this.newItem('chart'); break;
        case 'new-note': this.newItem('note'); break;
        case 'new-guide': this.newItem('guide'); break;
        case 'capture-region': this.capture('region'); break;
        case 'capture-bar': this.toggleBar(); break;
        case 'import-images': this.show({ kind: 'captures' }); setTimeout(() => T.$('.cap-view [data-act="import"]') && T.$('.cap-view [data-act="import"]').click(), 50); break;
        case 'present': { const it = this.currentItem(); if (it) this.present(it); else if (this.view.kind === 'captures') this.presentMedia([...this.media.keys()], 'Captures'); break; }
        case 'export': { const it = this.currentItem(); if (it) this.exportItem(it); else this.exportProject(); break; }
        case 'palette': this.palette(); break;
        case 'settings': this.openSettings(); break;
        case 'toggle-sidebar': this.toggleSidebar(); break;
        case 'toggle-inspector': this.toggleInspector(); break;
      }
    }
  };

  // ---------------------------------------------------------------- Overview (home) for a project
  class HomeView {
    constructor(host, app) {
      this.app = app;
      const p = app.project;
      const items = p.items.slice().sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
      const recentMedia = [...app.media.values()].sort((a, b) => String(b.created).localeCompare(String(a.created))).slice(0, 8);
      const card = (it) => {
        let art = '', meta = '';
        if (it.type === 'chart') { art = this.miniChart(it); meta = `${T.plural(it.nodes.length, 'step')}${(it.scenarios || []).length ? ' · ' + T.plural(it.scenarios.length, 'scenario') : ''}`; }
        if (it.type === 'note') { const t = T.textOf(it.html || ''); art = `<div class="mini-note">${T.esc(t.slice(0, 260)) || '<span class="muted">Empty note</span>'}</div>`; meta = T.plural(t.split(/\s+/).filter(Boolean).length, 'word'); }
        if (it.type === 'guide') { const m = it.steps.map((s) => s.media && app.media.get(s.media)).find(Boolean); art = m ? `<div class="mini-img">${T.annot.svg(m, T.mediaUrl(p.id, m.file))}</div>` : `<div class="mini-note muted">${T.icon('guide', 26)}</div>`; meta = T.plural(it.steps.length, 'step'); }
        return `<button class="icard" data-open="${it.id}"><div class="icard-art">${art}</div><div class="icard-meta">${T.icon(TYPE_ICON[it.type], 14)}<b>${T.esc(it.title || 'Untitled')}</b><span>${meta} · ${T.fmtDate(it.updated)}</span></div><span class="icard-more" data-more="${it.id}">${T.icon('more', 15)}</span></button>`;
      };
      this.root = T.el(`<div class="home">
        <div class="view-bar"><div class="vb-title">${T.icon('home', 16)}<span class="vb-name">Overview</span></div><div class="grow"></div>
          <button class="btn ghost sm" data-h="export">${T.icon('pdf')}Export project</button></div>
        <div class="home-scroll"><div class="home-in">
          <header class="home-head"><i class="pdot big" style="background:${T.colorOf(p.color)}"></i><div><h1>${T.esc(p.name)}</h1><p class="muted">${T.plural(p.items.filter((i) => i.type === 'chart').length, 'chart')} · ${T.plural(p.items.filter((i) => i.type === 'note').length, 'note')} · ${T.plural(p.items.filter((i) => i.type === 'guide').length, 'guide')} · ${T.plural(app.media.size, 'screenshot')}</p></div></header>
          <h2 class="home-h">Start something</h2>
          <div class="starts">
            ${['decision', 'org', 'folders', 'workflow', 'blank'].map((k) => `<button class="start" data-tpl="${k}"><div class="start-ic t-${k}">${T.icon(T.TEMPLATES[k].icon, 20)}</div><b>${T.TEMPLATES[k].label}</b><span>${T.esc(T.TEMPLATES[k].blurb)}</span></button>`).join('')}
            <button class="start" data-h="scan"><div class="start-ic t-scan">${T.icon('search', 20)}</div><b>Map a real folder</b><span>See what’s really where, then plan where it should go.</span></button>
            <button class="start" data-h="note"><div class="start-ic t-note">${T.icon('note', 20)}</div><b>Note</b><span>Write it down: headings, checklists, images.</span></button>
            <button class="start" data-h="guide"><div class="start-ic t-guide">${T.icon('guide', 20)}</div><b>Guide</b><span>A step-by-step tutorial from screenshots.</span></button>
          </div>
          ${items.length ? `<h2 class="home-h">In this project</h2><div class="icards">${items.map(card).join('')}</div>` : ''}
          <h2 class="home-h">Recent screenshots <button class="link-btn" data-h="captures">See all</button></h2>
          ${recentMedia.length ? `<div class="recent-media">${recentMedia.map((m) => `<button class="rm-item" data-media="${m.id}" draggable="true">${T.annot.svg(m, T.mediaUrl(p.id, m.file))}</button>`).join('')}</div>`
            : `<div class="home-empty">${T.icon('region', 18)}<span>Press <kbd>${T.esc(T.kbd(T.accel(app.settings.shortcut)))}</kbd> in any app to capture a region. It lands here.</span><button class="btn sm" data-h="bar">${T.icon('camera')}Open the capture bar</button></div>`}
        </div></div></div>`);
      host.appendChild(this.root);
      this.root.addEventListener('click', (e) => {
        const more = e.target.closest('[data-more]'); if (more) { e.stopPropagation(); return app.itemMenu(app.item(more.dataset.more), more); }
        const o = e.target.closest('[data-open]'); if (o) return app.show({ kind: 'item', id: o.dataset.open });
        const t = e.target.closest('[data-tpl]'); if (t) return app.newItem('chart', { template: t.dataset.tpl });
        const m = e.target.closest('[data-media]'); if (m) return app.viewMedia(m.dataset.media, recentMedia.map((x) => x.id));
        const h = e.target.closest('[data-h]'); if (!h) return;
        const a = h.dataset.h;
        if (a === 'scan') app.mapFolder();
        if (a === 'note') app.newItem('note');
        if (a === 'guide') app.newItem('guide');
        if (a === 'captures') app.show({ kind: 'captures' });
        if (a === 'bar') app.toggleBar();
        if (a === 'export') app.exportProject();
      });
      T.$$('.rm-item', this.root).forEach((el) => el.addEventListener('dragstart', (e) => e.dataTransfer.setData('application/x-trace-media', el.dataset.media)));
    }
    // a tiny static picture of a chart's shape
    miniChart(it) {
      if (!it.nodes.length) return `<div class="mini-note muted">${T.icon('chart', 26)}</div>`;
      const nodes = it.nodes.map((n) => ({ id: n.id, w: n.type === 'and' || n.type === 'or' ? 60 : 150, h: 46 }));
      const lay = T.layout.layout(nodes, it.edges, { orientation: it.orientation, rankGap: 50, siblingGap: 18 });
      const b = lay.bounds, pad = 20;
      const P = new Map(nodes.map((n) => [n.id, { ...lay.pos.get(n.id), w: n.w, h: n.h }]));
      const edges = it.edges.map((e) => { const a = P.get(e.from), c = P.get(e.to); if (!a || !c) return ''; return `<path d="${T.layout.route(a, c, { orientation: it.orientation, rankGap: 50 }).d}"/>`; }).join('');
      const rects = it.nodes.map((n) => { const q = P.get(n.id); return `<rect x="${q.x}" y="${q.y}" width="${q.w}" height="${q.h}" rx="12" style="fill:${T.colorOf(n.color || (T.NODE_TYPES[n.type] || {}).color)}"/>`; }).join('');
      return `<svg class="mini-chart" viewBox="${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}" preserveAspectRatio="xMidYMid meet"><g class="mc-e">${edges}</g><g class="mc-n">${rects}</g></svg>`;
    }
    destroy() { this.root.remove(); }
  }

  // Annotations for the three example screenshots in the Welcome guide (pixel positions in src/seed/*.png).
  const SEED_ANNOTATIONS = [
    { name: 'Open Reports', step: 'Open Reports from the left menu', html: '<p>It’s under <b>Analytics</b>. If you don’t see it, ask for the Reporting role.</p>',
      annotations: [{ id: 's1a', t: 'box', x1: 14, y1: 310, x2: 326, y2: 378, color: '#ff4d6d', sw: 6 }, { id: 's1b', t: 'arrow', x1: 640, y1: 520, x2: 342, y2: 352, color: '#ff4d6d', sw: 6 }, { id: 's1c', t: 'number', x1: 676, y1: 540, x2: 676, y2: 540, color: '#ff4d6d', fs: 40, n: 1 }] },
    { name: 'Set the dates', step: 'Set the dates to last week and filter to Sign-ups', html: '<ul><li>Date range: <b>Last week (Mon–Sun)</b></li><li>Event: <b>Sign-up completed</b></li></ul>',
      annotations: [{ id: 's2a', t: 'box', x1: 384, y1: 150, x2: 820, y2: 222, color: '#9d8cff', sw: 6 }, { id: 's2b', t: 'highlight', x1: 846, y1: 156, x2: 1182, y2: 216, color: '#ffd23f', sw: 6 }, { id: 's2c', t: 'number', x1: 384, y1: 150, x2: 384, y2: 150, color: '#9d8cff', fs: 40, n: 2 }, { id: 's2d', t: 'text', x1: 860, y1: 250, x2: 860, y2: 250, color: '#111318', fs: 30, text: 'Filter to Sign-ups only' }] },
    { name: 'Download CSV', step: 'Export → Download CSV', html: '<p>The file lands in Downloads. Rename it <code>signups-YYYY-MM-DD.csv</code> and move it to <b>Work › Reports</b>.</p>',
      annotations: [{ id: 's3a', t: 'arrow', x1: 1090, y1: 470, x2: 1298, y2: 266, color: '#22c55e', sw: 6 }, { id: 's3b', t: 'number', x1: 1062, y1: 494, x2: 1062, y2: 494, color: '#22c55e', fs: 40, n: 3 }, { id: 's3c', t: 'blur', x1: 384, y1: 330, x2: 640, y2: 900, color: '#111318', sw: 6 }] }
  ];

  window.app = app;
  app.boot().catch((e) => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<pre class="boot-err">Trace couldn’t start: ${T.esc(e.message)}</pre>`); });
})();
