// Trace — the notes editor: headings, lists, checklists, quotes, code, links and images, with Markdown-style shortcuts.
(function () {
  const T = window.T;
  const ex = (cmd, val) => document.execCommand(cmd, false, val);

  class RichText {
    constructor(host, opts = {}) {
      this.o = Object.assign({ html: '', placeholder: 'Write something…', compact: false, onChange: () => {}, app: null }, opts);
      const full = !this.o.compact;
      const btn = (cmd, icon, tip) => `<button class="icon-btn" data-cmd="${cmd}" title="${T.esc(tip)}" tabindex="-1">${T.icon(icon, 15)}</button>`;
      this.el = T.el(`<div class="rt ${this.o.compact ? 'compact' : ''}">
        <div class="rt-bar">
          ${full ? `<div class="seg">${btn('h1', 'h1', 'Heading (# space)')}<button class="icon-btn txt" data-cmd="h2" title="Subheading (## space)" tabindex="-1">H2</button><button class="icon-btn txt" data-cmd="p" title="Body text" tabindex="-1">¶</button></div>` : ''}
          <div class="seg">${btn('bold', 'bold', 'Bold ' + T.kbd('Mod+B'))}${btn('italic', 'italic', 'Italic ' + T.kbd('Mod+I'))}${btn('underline', 'underline', 'Underline ' + T.kbd('Mod+U'))}${full ? btn('strikeThrough', 'strike', 'Strikethrough') : ''}</div>
          <div class="seg">${btn('ul', 'ul', 'Bullets (- space)')}${btn('ol', 'ol', 'Numbered (1. space)')}${btn('check', 'checklist', 'Checklist ([] space)')}</div>
          ${full ? `<div class="seg">${btn('quote', 'quote', 'Quote (> space)')}${btn('code', 'code', 'Code')}${btn('hr', 'hr', 'Divider (---)')}</div>` : ''}
          <div class="seg">${btn('link', 'link', 'Link')}${this.o.app ? btn('image', 'image', 'Add a screenshot or image') : ''}</div>
        </div>
        <div class="rt-body" contenteditable="true" spellcheck="true" data-placeholder="${T.esc(this.o.placeholder)}"></div>
      </div>`);
      host.appendChild(this.el);
      this.body = T.$('.rt-body', this.el);
      try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (_) {}
      this.setHTML(this.o.html);
      this.emit = T.debounce(() => this.o.onChange(this.getHTML()), 350);
      this.bind();
    }
    getHTML() { return T.sanitize(this.body.innerHTML).replace(/^(<p><br><\/p>|<br>)$/, ''); }
    setHTML(html) { this.body.innerHTML = T.sanitize(html || ''); this.updateEmpty(); }
    flush() { this.emit.flush(); }
    focus() { this.body.focus(); }
    updateEmpty() { this.body.classList.toggle('empty', !this.body.textContent.trim() && !this.body.querySelector('img,hr,li')); }

    block() {
      const s = getSelection(); if (!s.rangeCount) return null;
      let n = s.anchorNode;
      while (n && n !== this.body) { if (n.nodeType === 1 && /^(P|H1|H2|H3|H4|LI|BLOCKQUOTE|PRE|DIV)$/.test(n.tagName)) return n; n = n.parentNode; }
      return null;
    }
    textBefore() {
      const s = getSelection(); if (!s.rangeCount) return '';
      const r = s.getRangeAt(0).cloneRange();
      const b = this.block() || this.body;
      r.setStart(b, 0);
      return r.toString();
    }
    eat(n) { const s = getSelection(); for (let i = 0; i < n; i++) s.modify('extend', 'backward', 'character'); ex('delete'); }
    checklist() {
      const s = getSelection();
      let li = s.anchorNode; while (li && li.tagName !== 'LI' && li !== this.body) li = li.parentNode;
      if (!li || li.tagName !== 'LI') { ex('insertUnorderedList'); li = s.anchorNode; while (li && li.tagName !== 'LI' && li !== this.body) li = li.parentNode; }
      if (!li || li.tagName !== 'LI') return;
      const ul = li.parentNode;
      if (ul.tagName === 'OL') { ex('insertUnorderedList'); return this.checklist(); }
      const on = !ul.classList.contains('checklist');
      ul.classList.toggle('checklist', on);
      ul.querySelectorAll(':scope > li').forEach((x) => { if (on) { if (!x.hasAttribute('data-checked')) x.setAttribute('data-checked', 'false'); } else x.removeAttribute('data-checked'); });
    }
    run(cmd) {
      this.body.focus();
      switch (cmd) {
        case 'h1': case 'h2': case 'h3': ex('formatBlock', this.block() && this.block().tagName === cmd.toUpperCase() ? 'p' : cmd); break;
        case 'p': ex('formatBlock', 'p'); break;
        case 'quote': ex('formatBlock', this.block() && this.block().closest('blockquote') ? 'p' : 'blockquote'); break;
        case 'code': ex('formatBlock', this.block() && this.block().closest('pre') ? 'p' : 'pre'); break;
        case 'ul': ex('insertUnorderedList'); break;
        case 'ol': ex('insertOrderedList'); break;
        case 'check': this.checklist(); break;
        case 'hr': ex('insertHorizontalRule'); break;
        case 'link': this.link(); return;
        case 'image': this.pickImage(); return;
        default: ex(cmd);
      }
      this.changed();
    }
    async link() {
      const s = getSelection(); const range = s.rangeCount ? s.getRangeAt(0).cloneRange() : null;
      const url = await T.prompt('Link', 'https://', 'https://…', 'Add link');
      if (!url || url === 'https://') return;
      this.body.focus();
      if (range) { s.removeAllRanges(); s.addRange(range); }
      const href = /^(https?:|mailto:)/i.test(url) ? url : 'https://' + url;
      if (range && !range.collapsed) ex('createLink', href); else ex('insertHTML', `<a href="${T.esc(href)}">${T.esc(url)}</a>&nbsp;`);
      this.changed();
    }
    async pickImage() {
      const s = getSelection(); const range = s.rangeCount ? s.getRangeAt(0).cloneRange() : null;
      const list = await this.o.app.pickMedia({ multi: true, title: 'Add images to this note' });
      if (!list || !list.length) return;
      this.body.focus();
      if (range) { s.removeAllRanges(); s.addRange(range); }
      this.insertImages(list);
    }
    insertImages(list) {
      const pid = this.o.app.project.id;
      ex('insertHTML', list.map((m) => `<p><img src="${T.mediaUrl(pid, m.file)}" data-media="${m.id}" alt="${T.esc(m.name || '')}"></p>`).join('') + '<p><br></p>');
      this.changed();
    }
    changed() { this.updateEmpty(); this.emit(); }

    bind() {
      const b = this.body;
      this.el.querySelector('.rt-bar').addEventListener('mousedown', (e) => e.preventDefault());
      this.el.querySelector('.rt-bar').addEventListener('click', (e) => { const x = e.target.closest('[data-cmd]'); if (x) this.run(x.dataset.cmd); });
      b.addEventListener('input', (e) => {
        if (e.inputType === 'insertParagraph') {
          const li = this.block();
          if (li && li.tagName === 'LI' && li.parentNode.classList.contains('checklist')) li.setAttribute('data-checked', 'false');
        }
        this.changed();
      });
      b.addEventListener('keydown', (e) => {
        if (e.key === ' ' && !e.shiftKey) {
          const t = this.textBefore();
          const blocks = { '#': 'h1', '##': 'h2', '###': 'h3', '>': 'blockquote', '```': 'pre' };
          if (blocks[t]) { e.preventDefault(); this.eat(t.length); ex('formatBlock', blocks[t]); return this.changed(); }
          if (t === '-' || t === '*') { e.preventDefault(); this.eat(1); ex('insertUnorderedList'); return this.changed(); }
          if (/^1[.)]$/.test(t)) { e.preventDefault(); this.eat(2); ex('insertOrderedList'); return this.changed(); }
          if (t === '[]' || t === '[ ]') { e.preventDefault(); this.eat(t.length); this.checklist(); return this.changed(); }
        }
        if (e.key === 'Enter' && !e.shiftKey && this.textBefore() === '---') { e.preventDefault(); this.eat(3); ex('insertHorizontalRule'); return this.changed(); }
        if (T.mod(e) && e.key.toLowerCase() === 'k') { e.preventDefault(); e.stopPropagation(); this.link(); }
        if (e.key === 'Tab') {
          const li = this.block();
          if (li && li.tagName === 'LI') { e.preventDefault(); ex(e.shiftKey ? 'outdent' : 'indent'); this.changed(); }
        }
        e.stopPropagation(); // keep chart shortcuts from firing while typing
      });
      b.addEventListener('click', (e) => {
        const li = e.target.closest('ul.checklist > li');
        if (li && e.clientX < li.getBoundingClientRect().left + 24) {
          li.setAttribute('data-checked', li.getAttribute('data-checked') === 'true' ? 'false' : 'true');
          this.changed();
        }
        const a = e.target.closest('a');
        if (a && (T.mod(e) || !b.isContentEditable)) { e.preventDefault(); window.api.open(a.href); }
      });
      b.addEventListener('paste', async (e) => {
        const dt = e.clipboardData;
        const files = Array.from(dt.files || []).filter((f) => f.type.startsWith('image/'));
        if (files.length && this.o.app) { e.preventDefault(); return this.uploadFiles(files); }
        const html = dt.getData('text/html');
        if (html) { e.preventDefault(); ex('insertHTML', T.sanitize(html)); return this.changed(); }
      });
      b.addEventListener('drop', (e) => {
        const files = Array.from(e.dataTransfer.files || []).filter((f) => f.type.startsWith('image/'));
        const mid = e.dataTransfer.getData('application/x-trace-media');
        if (mid && this.o.app) {
          e.preventDefault();
          const m = this.o.app.media.get(mid);
          if (m) { this.caretAt(e); this.insertImages([m]); }
          return;
        }
        if (files.length && this.o.app) { e.preventDefault(); this.caretAt(e); this.uploadFiles(files); }
      });
    }
    caretAt(e) {
      const r = document.caretRangeFromPoint && document.caretRangeFromPoint(e.clientX, e.clientY);
      if (r) { const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    }
    async uploadFiles(files) {
      const app = this.o.app, out = [];
      for (const f of files) {
        try { const m = await window.api.mediaFromBuffer(app.project.id, new Uint8Array(await f.arrayBuffer()), f.name || 'Pasted image'); app.mediaAdded(m, { silent: true }); out.push(m); }
        catch (err) { T.toast(err.message, { kind: 'error' }); }
      }
      if (out.length) this.insertImages(out);
    }
  }
  T.RichText = RichText;
})();
