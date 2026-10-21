// Trace — a note on its own page.
(function () {
  const T = window.T;
  class NoteView {
    constructor(host, { app, item }) {
      this.app = app; this.item = item;
      this.root = T.el(`<div class="doc-view note-view">
        <div class="view-bar">
          <div class="vb-title">${T.icon('note', 16)}<span class="crumb-proj">${T.esc(app.project.name)}</span><i>/</i><span class="vb-name">${T.esc(item.title)}</span></div>
          <div class="grow"></div>
          <span class="saved muted"></span>
          <button class="btn ghost sm" data-act="present">${T.icon('present')}Present</button>
          <button class="icon-btn" data-act="export" title="Export PDF ${T.kbd('Mod+E')}">${T.icon('pdf', 17)}</button>
          <button class="icon-btn" data-act="more" title="More">${T.icon('more', 17)}</button>
        </div>
        <div class="doc-scroll"><article class="doc">
          <input class="doc-title" spellcheck="true" placeholder="Untitled note" value="${T.esc(item.title)}">
          <div class="doc-meta"></div>
          <div class="doc-body"></div>
        </article></div>
      </div>`);
      host.appendChild(this.root);
      this.title = T.$('.doc-title', this.root);
      this.title.addEventListener('input', () => { this.app.mutate(this.item, () => { this.item.title = this.title.value; }, 'note-title'); T.$('.vb-name', this.root).textContent = this.title.value || 'Untitled'; this.app.renderSidebar(); });
      this.title.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); this.editor.focus(); } });
      this.editor = new T.RichText(T.$('.doc-body', this.root), {
        html: item.html, app, placeholder: 'Start writing. Type # for a heading, - for bullets, [] for a checklist…',
        onChange: (html) => { this.app.mutate(this.item, () => { this.item.html = html; }, 'note-body'); this.meta(); }
      });
      this.root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        if (b.dataset.act === 'present') this.app.present(this.item);
        if (b.dataset.act === 'export') this.app.exportItem(this.item);
        if (b.dataset.act === 'more') this.app.itemMenu(this.item, b);
      });
      this.meta();
      if (!item.html && !item.title) setTimeout(() => this.title.focus(), 30);
      else if (!item.html) setTimeout(() => this.editor.focus(), 30);
    }
    meta() {
      const words = T.textOf(this.editor.getHTML()).split(/\s+/).filter(Boolean).length;
      T.$('.doc-meta', this.root).textContent = `${T.plural(words, 'word')} · edited ${T.fmtDate(this.item.updated)}`;
    }
    reload(item) { if (item) this.item = item; this.title.value = this.item.title; this.editor.setHTML(this.item.html); this.meta(); }
    flush() { this.editor.flush(); }
    destroy() { this.editor.flush(); this.root.remove(); }
  }
  T.NoteView = NoteView;
})();
