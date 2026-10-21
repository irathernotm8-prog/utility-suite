// Trace — guides: step-by-step tutorials built from screenshots (what to click, why), ready to present or export.
(function () {
  const T = window.T;
  class GuideView {
    constructor(host, { app, item }) {
      this.app = app; this.item = item; this.editors = new Map();
      this.root = T.el(`<div class="doc-view guide-view">
        <div class="view-bar">
          <div class="vb-title">${T.icon('guide', 16)}<span class="crumb-proj">${T.esc(app.project.name)}</span><i>/</i><span class="vb-name">${T.esc(item.title)}</span></div>
          <div class="grow"></div>
          <button class="btn ghost sm" data-act="add">${T.icon('plus')}Add steps<span class="caret">${T.icon('chevdown', 12)}</span></button>
          <button class="btn ghost sm" data-act="present">${T.icon('present')}Present</button>
          <button class="icon-btn" data-act="export" title="Export PDF ${T.kbd('Mod+E')}">${T.icon('pdf', 17)}</button>
          <button class="icon-btn" data-act="more" title="More">${T.icon('more', 17)}</button>
        </div>
        <div class="doc-scroll"><article class="doc wide">
          <input class="doc-title" placeholder="Untitled guide" value="${T.esc(item.title)}">
          <div class="doc-meta"></div>
          <div class="guide-intro"></div>
          <div class="steps"></div>
          <div class="steps-add">
            <button class="add-tile" data-act="from-captures">${T.icon('images', 20)}<b>Add from Captures</b><span>Pick screenshots you’ve taken</span></button>
            <button class="add-tile" data-act="capture">${T.icon('region', 20)}<b>Capture a step</b><span>${T.esc(T.kbd(T.accel(app.settings.shortcut)))} works from any app</span></button>
            <button class="add-tile" data-act="blank">${T.icon('plus', 20)}<b>Text-only step</b><span>Add the picture later</span></button>
          </div>
        </article></div>
      </div>`);
      host.appendChild(this.root);
      const title = T.$('.doc-title', this.root);
      title.addEventListener('input', () => { this.app.mutate(this.item, () => { this.item.title = title.value; }, 'guide-title'); T.$('.vb-name', this.root).textContent = title.value || 'Untitled'; this.app.renderSidebar(); });
      this.intro = new T.RichText(T.$('.guide-intro', this.root), { html: item.intro, compact: true, app, placeholder: 'What this guide is for and who it’s for (optional)',
        onChange: (html) => this.app.mutate(this.item, () => { this.item.intro = html; }, 'guide-intro') });
      this.root.addEventListener('click', (e) => this.onClick(e));
      this.renderSteps();
    }
    meta() { T.$('.doc-meta', this.root).textContent = `${T.plural(this.item.steps.length, 'step')} · edited ${T.fmtDate(this.item.updated)}`; }
    async onClick(e) {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const act = b.dataset.act, sid = b.closest('.step') && b.closest('.step').dataset.id;
      if (act === 'present') return this.app.present(this.item);
      if (act === 'export') return this.app.exportItem(this.item);
      if (act === 'more') return this.app.itemMenu(this.item, b);
      if (act === 'add') return T.menuAt(b, [
        { label: 'From Captures…', icon: 'images', onClick: () => this.addFromCaptures() },
        { label: 'Capture a region now', icon: 'region', onClick: () => this.captureStep() },
        { label: 'Import images…', icon: 'upload', onClick: () => this.importStep() },
        { label: 'Text-only step', icon: 'plus', onClick: () => this.addSteps([null]) }
      ]);
      if (act === 'from-captures') return this.addFromCaptures();
      if (act === 'capture') return this.captureStep();
      if (act === 'blank') return this.addSteps([null]);
      if (act === 'annotate' && sid) { const s = this.step(sid); const m = s && this.app.media.get(s.media); if (m) { await T.annot.edit(this.app, m); this.renderSteps(); } return; }
      if (act === 'pick' && sid) { const list = await this.app.pickMedia({ multi: false, title: 'Choose the screenshot for this step' }); if (list && list[0]) { this.app.mutate(this.item, () => { this.step(sid).media = list[0].id; }); this.renderSteps(); } return; }
      if (act === 'view' && sid) { const ids = this.item.steps.map((s) => s.media).filter(Boolean); return this.app.viewMedia(this.step(sid).media, ids); }
      if (act === 'step-menu' && sid) return this.stepMenu(b, sid);
      if (act === 'insert' && sid) { const i = this.item.steps.findIndex((s) => s.id === sid); return this.addSteps([null], i + 1); }
    }
    step(id) { return this.item.steps.find((s) => s.id === id); }
    stepMenu(btn, sid) {
      const i = this.item.steps.findIndex((s) => s.id === sid), s = this.step(sid);
      T.menuAt(btn, [
        s.media && { label: 'Annotate', icon: 'pen', onClick: () => T.$(`.step[data-id="${sid}"] [data-act="annotate"]`, this.root).click() },
        { label: s.media ? 'Replace screenshot' : 'Add screenshot', icon: 'image', onClick: () => T.$(`.step[data-id="${sid}"] [data-act="pick"]`, this.root).click() },
        s.media && { label: 'Remove screenshot', onClick: () => { this.app.mutate(this.item, () => { s.media = null; }); this.renderSteps(); } },
        { sep: true },
        i > 0 && { label: 'Move up', icon: 'chevleft', onClick: () => this.move(i, i - 1) },
        i < this.item.steps.length - 1 && { label: 'Move down', icon: 'chevron', onClick: () => this.move(i, i + 1) },
        { label: 'Insert step below', icon: 'plus', onClick: () => this.addSteps([null], i + 1) },
        { sep: true },
        { label: 'Delete step', icon: 'trash', danger: true, onClick: () => { this.app.mutate(this.item, () => { this.item.steps.splice(i, 1); }); this.renderSteps(); T.toast('Step deleted', { action: 'Undo', onAction: () => this.app.undo() }); } }
      ]);
    }
    move(from, to) { this.app.mutate(this.item, () => { const [s] = this.item.steps.splice(from, 1); this.item.steps.splice(to, 0, s); }); this.renderSteps(); }
    async addFromCaptures() {
      const used = new Set(this.item.steps.map((s) => s.media));
      const list = await this.app.pickMedia({ multi: true, title: 'Add steps from Captures', hide: used });
      if (list && list.length) this.addSteps(list.map((m) => m.id));
    }
    async importStep() { const list = await window.api.importMedia(this.app.project.id); list.forEach((m) => this.app.mediaAdded(m, { silent: true })); if (list.length) this.addSteps(list.map((m) => m.id)); }
    async captureStep() {
      try {
        const r = await window.api.capture('region');
        if (!r) return;
        if (r.pid !== this.app.project.id) return T.toast('That screenshot went to another project (see the capture bar)');
        this.app.mediaAdded(r.media, { silent: true });
        this.addSteps([r.media.id]);
      } catch (err) { T.toast(err.message, { kind: 'error' }); }
    }
    addSteps(mediaIds, at) {
      this.flushEditors();
      const steps = mediaIds.map((mid) => { const m = mid && this.app.media.get(mid); return T.newStep(mid, m && m.name ? m.name : '', ''); });
      this.app.mutate(this.item, () => { this.item.steps.splice(at == null ? this.item.steps.length : at, 0, ...steps); });
      this.renderSteps();
      const el = T.$(`.step[data-id="${steps[0].id}"]`, this.root);
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('flash'); setTimeout(() => { const t = T.$('.step-title', el); if (t && !t.value) t.focus(); }, 300); }
    }
    flushEditors() { this.editors.forEach((ed) => ed.flush()); }
    renderSteps() {
      this.flushEditors();
      this.editors.clear();
      const box = T.$('.steps', this.root);
      const pid = this.app.project.id;
      box.innerHTML = this.item.steps.map((s, i) => {
        const m = s.media && this.app.media.get(s.media);
        return `<section class="step" data-id="${s.id}">
          <div class="step-rail"><div class="step-num">${i + 1}</div><button class="icon-btn ghost sm grip" draggable="true" title="Drag to reorder">${T.icon('grip', 14)}</button></div>
          <div class="step-main">
            <div class="step-head"><input class="step-title" placeholder="What to do, e.g. Click Reports in the left menu" value="${T.esc(s.title || '')}">
              <button class="icon-btn ghost sm" data-act="step-menu" title="More">${T.icon('more', 15)}</button></div>
            <div class="step-text"></div>
            ${m ? `<div class="step-media"><button class="step-img" data-act="view">${T.annot.svg(m, T.mediaUrl(pid, m.file))}</button>
                <div class="step-img-tools"><button class="btn sm glass" data-act="annotate">${T.icon('pen')}Annotate</button><button class="btn sm glass" data-act="pick">${T.icon('image')}Replace</button></div></div>`
              : `<button class="step-media empty" data-act="pick">${T.icon('image', 22)}<span>Add a screenshot</span></button>`}
          </div>
          <button class="step-insert" data-act="insert" title="Insert a step here">${T.icon('plus', 13)}</button>
        </section>`;
      }).join('') || '<div class="steps-empty">No steps yet. Take screenshots as you go through the task, then add them here in order.</div>';
      for (const el of T.$$('.step', box)) {
        const s = this.step(el.dataset.id);
        const ti = T.$('.step-title', el);
        ti.addEventListener('input', () => this.app.mutate(this.item, () => { s.title = ti.value; }, 'step-title:' + s.id));
        ti.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const ed = this.editors.get(s.id); ed && ed.focus(); } });
        this.editors.set(s.id, new T.RichText(T.$('.step-text', el), { html: s.html, compact: true, app: this.app, placeholder: 'Details, tips, why it matters (optional)',
          onChange: (html) => this.app.mutate(this.item, () => { s.html = html; }, 'step-body:' + s.id) }));
        // reorder by dragging the grip; captures can be dropped onto a step's picture
        const grip = T.$('.grip', el);
        grip.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-trace-step', s.id); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
        grip.addEventListener('dragend', () => el.classList.remove('dragging'));
        el.addEventListener('dragover', (e) => {
          const types = e.dataTransfer.types;
          if (types.includes('application/x-trace-step') || types.includes('application/x-trace-media') || types.includes('Files')) {
            e.preventDefault();
            const r = el.getBoundingClientRect();
            el.classList.toggle('drop-before', e.clientY < r.top + r.height / 2);
            el.classList.toggle('drop-after', e.clientY >= r.top + r.height / 2);
          }
        });
        el.addEventListener('dragleave', () => el.classList.remove('drop-before', 'drop-after'));
        el.addEventListener('drop', async (e) => {
          const after = el.classList.contains('drop-after');
          el.classList.remove('drop-before', 'drop-after');
          const sid = e.dataTransfer.getData('application/x-trace-step');
          let idx = this.item.steps.findIndex((x) => x.id === s.id) + (after ? 1 : 0);
          e.preventDefault();
          if (sid) {
            const from = this.item.steps.findIndex((x) => x.id === sid);
            if (from < idx) idx--;
            if (from !== idx) this.move(from, idx);
            return;
          }
          const ids = (e.dataTransfer.getData('application/x-trace-media') || '').split(',').filter(Boolean);
          for (const f of Array.from(e.dataTransfer.files || []).filter((x) => x.type.startsWith('image/'))) { const m = await window.api.mediaFromBuffer(this.app.project.id, new Uint8Array(await f.arrayBuffer()), f.name); this.app.mediaAdded(m, { silent: true }); ids.push(m.id); }
          if (ids.length) {
            // dropping a single picture onto a step that has none fills it
            if (ids.length === 1 && !s.media && e.target.closest('.step-media')) { this.app.mutate(this.item, () => { s.media = ids[0]; }); this.renderSteps(); }
            else this.addSteps(ids, idx);
          }
        });
      }
      this.meta();
    }
    reload(item) { if (item) this.item = item; T.$('.doc-title', this.root).value = this.item.title; this.intro.setHTML(this.item.intro); this.renderSteps(); }
    mediaChanged() { this.renderSteps(); }
    flush() { this.intro.flush(); this.flushEditors(); }
    destroy() { this.flush(); this.root.remove(); }
  }
  T.GuideView = GuideView;
})();
