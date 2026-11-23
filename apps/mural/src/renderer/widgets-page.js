// Mural — the Widgets page: the gallery, what's on your desktop, each widget's settings, and the widget editor.
import { icon } from './icons.js';
import { skyAt } from './runtime/sun.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const GLASS = [['dark', 'Dark glass'], ['light', 'Light glass'], ['solid', 'Solid'], ['clear', 'No card']];
const PERMS = [['network', 'Internet'], ['system', 'System stats'], ['open', 'Open links & apps'], ['location', 'Location']];

export class WidgetsPage {
  constructor(el, ctx) {
    this.el = el; this.ctx = ctx; this.state = null; this.thumbs = new Map(); this.mode = 'list'; this.drawer = null;
    addEventListener('message', (e) => this.onFrameMessage(e));
    addEventListener('keydown', (e) => { if (this.mode === 'edit' && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && this.ctx.S.page === 'widgets') { e.preventDefault(); this.saveEdit(); } });
  }
  async load() { this.state = await this.ctx.call('widgets.state'); }
  update(st) { this.state = st; if (this.ctx.S.page === 'widgets' && this.mode === 'list') this.render(); if (this.drawer) this.renderDrawer(); }
  async show() { if (!this.state) await this.load(); if (this.mode === 'list') this.render(); }
  displayLabel(key) { const d = (this.state.displays || []).find((x) => x.key === key); return d ? d.label : 'Display'; }

  // ------------------------------------------------------------------------------------------------- list
  render() {
    const st = this.state; const editing = st.layer.editing; const inst = st.instances;
    this.el.innerHTML = `
      <div class="head"><h1>Widgets</h1><span class="sub">Interactive pieces that live on your desktop, above the wallpaper and below your apps</span><div class="spacer"></div>
        <button class="btn" id="wImp">${icon('plus')}Add from file</button><button class="btn" id="wNew">${icon('code')}Make one</button>
        <button class="btn ${editing ? 'primary' : ''}" id="wArr">${icon('layers')}${editing ? 'Done arranging' : 'Arrange on desktop'}</button></div>
      <div class="scroll">
        ${inst.length ? `<div class="section-title">On your desktop</div><div class="box" style="padding:6px 16px">${inst.map((i) => { const t = st.types.find((x) => x.type === i.type); return `<div class="row"><div class="t"><b>${esc(t ? t.name : i.type)}</b><span>${esc(this.displayLabel(i.display))} · ${i.w}×${i.h}</span></div><button class="btn sm" data-set="${esc(i.id)}">${icon('settings')}Settings</button><button class="btn sm icon ghost" data-rm="${esc(i.id)}" title="Take off the desktop">${icon('close')}</button></div>`; }).join('')}</div>` : ''}
        <div class="section-title">Gallery</div>
        <div class="grid" id="wGrid">${st.types.map((t) => `
          <div class="card" data-type="${esc(t.type)}">
            <div class="thumb" style="aspect-ratio:16/10;${this.thumbs.get(t.type) ? `background-image:url('${this.thumbs.get(t.type)}');background-size:contain;background-color:#0e1220` : ''}">${this.thumbs.get(t.type) ? '' : `<div class="ph">${icon('layers')}</div>`}
              <div class="tr">${t.builtin ? '' : '<span class="badge">Yours</span>'}<button class="round more" title="More">${icon('more')}</button></div>
              <div class="over"><button class="btn sm primary add">${icon('plus')}Add to desktop</button><button class="btn sm edit">${icon('code')}${t.builtin ? 'Open' : 'Edit'}</button></div></div>
            <div class="meta-row" style="flex-direction:column;align-items:flex-start;gap:3px"><span class="nm">${esc(t.name)}</span><span class="ty" style="white-space:normal">${esc(t.description)}</span>
              ${t.permissions.length ? `<span class="traits" style="gap:4px;flex-wrap:wrap">${t.permissions.map((p) => `<span class="badge" style="background:var(--bg);color:var(--dim)">${esc(p.text)}</span>`).join('')}</span>` : ''}</div>
          </div>`).join('')}</div>
        <div class="box" style="margin-top:22px"><h3>${icon('claude')}Make widgets with Claude</h3><p class="desc">With Mural connected in Settings › Claude & Codex, ask Claude for any widget — “a stock ticker for AAPL and NVDA”, “a Premier League table”, “a pomodoro that logs my sessions” — and it writes, previews and places it for you. Widgets are plain web pages; share them as <kbd>.muralwidget</kbd> files.</p></div>
      </div>`;
    $('#wArr', this.el).onclick = async () => { await this.ctx.call('widgets.arrange', !editing); await this.load(); this.render(); };
    $('#wImp', this.el).onclick = async () => { const r = await this.ctx.call('widgets.import'); for (const x of r) x.error ? this.ctx.toast(`${x.path.split(/[\\/]/).pop()}: ${x.error}`, true) : this.ctx.toast('Widget added to the gallery'); await this.load(); this.render(); };
    $('#wNew', this.el).onclick = async () => { const t = await this.ctx.call('widgets.create', 'My widget'); await this.load(); this.edit(t); };
    this.el.querySelectorAll('[data-set]').forEach((b) => (b.onclick = () => this.openDrawer(b.dataset.set)));
    this.el.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = async () => { await this.ctx.call('widgets.remove', b.dataset.rm); await this.load(); this.render(); }));
    this.el.querySelectorAll('#wGrid .card').forEach((card) => {
      const t = st.types.find((x) => x.type === card.dataset.type);
      $('.add', card).onclick = (e) => this.addMenu(t, e.currentTarget);
      $('.edit', card).onclick = () => this.edit(t.type);
      $('.more', card).onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); this.ctx.menu(r.left, r.bottom + 4, [
        { label: t.builtin ? 'Open in the editor' : 'Edit', icon: 'code', hint: t.builtin ? 'Saving makes your own copy' : '', run: () => this.edit(t.type) },
        { label: 'Duplicate', icon: 'copy', run: async () => { await this.ctx.call('widgets.duplicate', t.type); await this.load(); this.render(); } },
        { label: 'Export .muralwidget…', icon: 'export', run: () => this.ctx.call('widgets.export', t.type) },
        { label: 'Show files', icon: 'folder', run: () => this.ctx.call('widgets.reveal', t.type) },
        ...(t.builtin ? [] : ['-', { label: 'Move to Trash', icon: 'trash', danger: true, run: async () => { if (await this.ctx.call('widgets.removeType', t.type)) { this.thumbs.delete(t.type); await this.load(); this.render(); } } }])
      ]); };
    });
    this.loadThumbs();
  }
  async loadThumbs() {
    if (this.thumbBusy) return; this.thumbBusy = true;
    try {
      for (const t of this.state.types) {
        if (this.thumbs.has(t.type)) continue;
        const url = await this.ctx.raw.call('widgets.thumb', t.type).catch(() => null); if (!url) continue;
        this.thumbs.set(t.type, url);
        const th = this.el.querySelector(`.card[data-type="${CSS.escape(t.type)}"] .thumb`);
        if (th) { th.style.backgroundImage = `url('${url}')`; th.style.backgroundSize = 'contain'; th.style.backgroundColor = '#0e1220'; const ph = $('.ph', th); if (ph) ph.remove(); }
      }
    } finally { this.thumbBusy = false; }
  }
  addMenu(t, anchor) {
    const ds = this.state.displays; const add = async (key) => {
      if (t.permissions.length) { const ok = confirm(`${t.name} will be able to:\n\n• ${t.permissions.map((p) => p.text).join('\n• ')}\n\nAdd it to your desktop?`); if (!ok) return; }
      await this.ctx.call('widgets.add', t.type, key); this.ctx.toast(`${t.name} is on your desktop`); await this.load(); this.render();
    };
    if (ds.length < 2) return add(ds[0] && ds[0].key);
    const r = anchor.getBoundingClientRect(); this.ctx.menu(r.left, r.bottom + 4, ds.map((d) => ({ label: d.label, icon: 'display', run: () => add(d.key) })));
  }

  // ------------------------------------------------------------------------------------------------- settings drawer
  openDrawer(id) { this.drawer = id; this.renderDrawer(); }
  closeDrawer() { this.drawer = null; const d = $('#wDrawer'); if (d) d.remove(); }
  renderDrawer() {
    const inst = this.state.instances.find((i) => i.id === this.drawer); let d = $('#wDrawer');
    if (!inst) { if (d) d.remove(); this.drawer = null; return; }
    const t = this.state.types.find((x) => x.type === inst.type) || { name: inst.type, settings: [] };
    if (!d) { d = h('<div id="wDrawer" class="menu" style="right:18px;top:64px;left:auto;width:340px;max-height:calc(100vh - 90px);overflow:auto;padding:14px"></div>'); document.body.appendChild(d); }
    const field = (f, v) => {
      switch (f.type) {
        case 'toggle': return `<button class="switch ${v ? 'on' : ''}" data-tg="${esc(f.key)}"></button>`;
        case 'select': return `<select class="txt" data-k="${esc(f.key)}" style="flex:1">${(f.options || []).map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
        case 'color': return `<input type="color" data-k="${esc(f.key)}" value="${esc(v || '#888888')}">`;
        case 'range': return `<input type="range" data-k="${esc(f.key)}" data-num="1" min="${f.min ?? 0}" max="${f.max ?? 100}" step="${f.step ?? 1}" value="${v}"><span class="hint" style="margin:0;min-width:28px">${esc(v)}</span>`;
        case 'list': return `<textarea class="txt" data-list="${esc(f.key)}" style="flex:1;height:110px;padding:7px;font:12px var(--mono)">${esc((v || []).join('\n'))}</textarea>`;
        case 'textarea': return `<textarea class="txt" data-k="${esc(f.key)}" style="flex:1;height:90px;padding:7px">${esc(v)}</textarea>`;
        default: return `<input class="txt" data-k="${esc(f.key)}" value="${esc(v)}" style="flex:1">`;
      }
    };
    d.innerHTML = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><b style="font-size:14px;flex:1">${esc(t.name)}</b><button class="btn sm icon ghost" id="dX">${icon('close')}</button></div>
      ${(t.settings || []).map((f) => `<div class="field" style="grid-template-columns:110px 1fr"><label>${esc(f.label)}</label><div class="ctl">${field(f, inst.settings[f.key])}</div></div>`).join('') || '<p class="hint">This widget has no settings.</p>'}
      <div class="group" style="border-top:1px solid var(--line);margin-top:8px"><div class="gt">Look</div>
        <div class="seg" id="dGlass" style="display:grid;grid-template-columns:1fr 1fr;width:100%">${GLASS.map(([k, l]) => `<button data-g="${k}" class="${(inst.style || {}).glass === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="field" style="grid-template-columns:110px 1fr"><label>Opacity</label><div class="ctl"><input type="range" id="dOp" min="0.3" max="1" step="0.05" value="${(inst.style || {}).opacity ?? 1}"></div></div>
        <div class="field" style="grid-template-columns:110px 1fr"><label>Size</label><div class="ctl"><input class="num" id="dW" value="${inst.w}"> × <input class="num" id="dH" value="${inst.h}"></div></div>
        ${this.state.displays.length > 1 ? `<div class="field" style="grid-template-columns:110px 1fr"><label>Display</label><div class="ctl"><select class="txt" id="dDisp" style="flex:1">${this.state.displays.map((x) => `<option value="${esc(x.key)}" ${x.key === inst.display ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></div></div>` : ''}
      </div>
      <div style="display:flex;gap:8px;margin-top:10px"><button class="btn sm" id="dArr">${icon('layers')}Arrange</button><div class="spacer"></div><button class="btn sm danger" id="dRm">${icon('trash')}Take off desktop</button></div>`;
    const set = (patch) => this.ctx.call('widgets.update', inst.id, patch);
    d.querySelectorAll('[data-k]').forEach((x) => (x.oninput = () => { const v = x.dataset.num ? Number(x.value) : x.value; if (x.nextElementSibling && x.dataset.num) x.nextElementSibling.textContent = x.value; set({ settings: { [x.dataset.k]: v } }); }));
    d.querySelectorAll('[data-tg]').forEach((b) => (b.onclick = () => { const on = !b.classList.contains('on'); b.classList.toggle('on', on); set({ settings: { [b.dataset.tg]: on } }); }));
    d.querySelectorAll('[data-list]').forEach((x) => (x.onchange = () => set({ settings: { [x.dataset.list]: x.value.split('\n').map((l) => l.trim()).filter(Boolean) } })));
    d.querySelectorAll('#dGlass button').forEach((b) => (b.onclick = () => set({ style: { glass: b.dataset.g } })));
    $('#dOp', d).oninput = (e) => set({ style: { opacity: Number(e.target.value) } });
    const sz = () => set({ w: Number($('#dW', d).value) || inst.w, h: Number($('#dH', d).value) || inst.h }); $('#dW', d).onchange = sz; $('#dH', d).onchange = sz;
    if ($('#dDisp', d)) $('#dDisp', d).onchange = (e) => set({ display: e.target.value, x: 40, y: 60 });
    $('#dX', d).onclick = () => this.closeDrawer();
    $('#dArr', d).onclick = () => this.ctx.call('widgets.arrange', true);
    $('#dRm', d).onclick = async () => { await this.ctx.call('widgets.remove', inst.id); this.closeDrawer(); };
  }

  // ------------------------------------------------------------------------------------------------- editor
  async edit(type) {
    const full = await this.ctx.call('widgets.get', type); if (!full) return;
    this.closeDrawer(); this.mode = 'edit'; this.ed = { type, builtin: full.builtin, manifest: full.manifest, files: full.files, file: Object.keys(full.files).includes(full.manifest.page) ? full.manifest.page : Object.keys(full.files)[0] || 'index.html', dirty: false };
    this.renderEditor(); this.runPreview();
  }
  renderEditor() {
    const E = this.ed, m = E.manifest;
    this.el.innerHTML = `
      <div class="head"><button class="btn icon ghost" id="eBack" title="Back">${icon('library')}</button>
        <input class="namebox" id="eName" value="${esc(m.name)}"><span class="dirty-dot ${E.dirty ? 'on' : ''}" id="eDirty"></span>${E.builtin ? '<span class="sub">Built in · saving makes your own copy</span>' : ''}
        <div class="spacer"></div><button class="btn" id="eAsk">${icon('claude')}Ask Claude</button><button class="btn" id="eExp">${icon('export')}Export</button>
        <button class="btn" id="eRun">${icon('play')}Save & run</button><button class="btn primary" id="eAdd">${icon('plus')}Add to desktop</button></div>
      <div class="body" style="flex:1;display:grid;grid-template-columns:minmax(320px,38%) 1fr 280px;min-height:0;border-top:1px solid var(--line)">
        <div class="pane left" style="display:flex;flex-direction:column"><div class="pane-h">${icon('code')}<div class="seg" id="eFiles">${Object.keys(E.files).map((f) => `<button data-f="${esc(f)}" class="${f === E.file ? 'on' : ''}">${esc(f)}</button>`).join('')}</div><div class="spacer"></div><button class="btn sm icon ghost" id="eAddFile" title="Add a file">${icon('plus')}</button></div>
          <textarea class="code" id="eCode" spellcheck="false"></textarea></div>
        <div class="center"><div class="stage-wrap" id="eStageWrap" style="background:radial-gradient(80% 90% at 30% 20%,#2a3563,#0b0e1a)"><div id="eCard" class="w-preview" style="position:relative;border-radius:18px;background:rgba(14,17,26,.66);box-shadow:0 0 0 1px rgba(255,255,255,.08) inset,0 18px 44px rgba(0,0,0,.35);width:${m.size.w}px;height:${m.size.h}px;max-width:100%;max-height:100%;resize:both;overflow:hidden"><iframe id="eFrame" sandbox="allow-scripts allow-forms" style="position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:18px;background:transparent"></iframe></div></div>
          <div class="timebar"><span class="hint" style="margin:0">Drag the card’s corner to try other sizes. Errors show here:</span><span class="stats-mini" id="eErr" style="color:var(--danger);white-space:normal"></span></div></div>
        <div class="pane right"><div class="pane-h">${icon('settings')}Widget</div><div class="props">
          <div class="field wide"><textarea class="txt" id="eDesc" placeholder="What it does" style="height:54px;padding:7px">${esc(m.description)}</textarea></div>
          <div class="field"><label>Size</label><div class="ctl"><input class="num" id="eW" value="${m.size.w}"> × <input class="num" id="eH" value="${m.size.h}"></div></div>
          <div class="field"><label>Resizable</label><div class="ctl"><button class="switch ${m.size.resizable ? 'on' : ''}" id="eRs"></button></div></div>
          <div class="group"><div class="gt">Permissions</div>${PERMS.map(([k, l]) => `<div class="field"><label>${l}</label><div class="ctl"><button class="switch ${m.permissions.includes(k) ? 'on' : ''}" data-perm="${k}"></button></div></div>`).join('')}
            <div class="field"><label>Suite apps</label><div class="ctl"><input class="txt" id="eSuite" placeholder="scene, vitals" value="${esc(m.permissions.filter((p) => p.startsWith('suite:')).map((p) => p.slice(6)).join(', '))}"></div></div>
            <p class="hint">Without Internet, the widget can’t load anything from the web. People see these before adding it.</p></div>
          <div class="group"><div class="gt">Settings (JSON)</div><textarea class="code" id="eSet" spellcheck="false" style="min-height:180px;border-radius:8px">${esc(JSON.stringify(m.settings, null, 1))}</textarea>
            <p class="hint">Each: <kbd>{ "key", "label", "type": text|textarea|toggle|select|color|range|list, "default", "options", "min", "max" }</kbd>. They appear in the widget’s settings and as <kbd>mural.settings</kbd>.</p></div>
          <p class="hint">SDK: <kbd>mural.ready()</kbd>, <kbd>mural.settings</kbd>, <kbd>mural.storage.get/set</kbd>, <kbd>mural.on('pause'|'resume'|'settings'|'resize'|'sky')</kbd>, <kbd>mural.system()</kbd>, <kbd>mural.open()</kbd>, <kbd>mural.suite(app, call)</kbd>.</p>
        </div></div>
      </div>`;
    const code = $('#eCode', this.el); code.value = E.files[E.file] || '';
    const dirty = () => { E.dirty = true; $('#eDirty', this.el).classList.add('on'); };
    code.oninput = () => { E.files[E.file] = code.value; dirty(); };
    code.onkeydown = (e) => { if (e.key === 'Tab') { e.preventDefault(); code.setRangeText('  ', code.selectionStart, code.selectionEnd, 'end'); code.dispatchEvent(new Event('input')); } };
    this.el.querySelectorAll('#eFiles button').forEach((b) => (b.onclick = () => { E.file = b.dataset.f; this.renderEditor(); this.runPreview(); }));
    $('#eAddFile', this.el).onclick = () => { const n = prompt('File name (e.g. style.css, data.json)'); if (!n || !/^[\w.-]+\.(html|css|js|json|svg|txt|md)$/i.test(n)) return; E.files[n] = ''; E.file = n; dirty(); this.renderEditor(); };
    $('#eName', this.el).oninput = (e) => { m.name = e.target.value; dirty(); };
    $('#eDesc', this.el).oninput = (e) => { m.description = e.target.value; dirty(); };
    const size = () => { m.size.w = Number($('#eW', this.el).value) || m.size.w; m.size.h = Number($('#eH', this.el).value) || m.size.h; const c = $('#eCard', this.el); c.style.width = m.size.w + 'px'; c.style.height = m.size.h + 'px'; dirty(); };
    $('#eW', this.el).onchange = size; $('#eH', this.el).onchange = size;
    $('#eRs', this.el).onclick = (e) => { m.size.resizable = !m.size.resizable; e.currentTarget.classList.toggle('on', m.size.resizable); dirty(); };
    this.el.querySelectorAll('[data-perm]').forEach((b) => (b.onclick = () => { const k = b.dataset.perm; const on = !m.permissions.includes(k); m.permissions = on ? [...m.permissions, k] : m.permissions.filter((p) => p !== k); b.classList.toggle('on', on); dirty(); }));
    $('#eSuite', this.el).onchange = (e) => { m.permissions = [...m.permissions.filter((p) => !p.startsWith('suite:')), ...e.target.value.split(',').map((x) => x.trim().toLowerCase()).filter((x) => /^[a-z0-9-]+$/.test(x)).map((x) => 'suite:' + x)]; dirty(); };
    $('#eSet', this.el).onchange = (e) => { try { const v = JSON.parse(e.target.value); if (!Array.isArray(v)) throw new Error('Settings must be a list'); m.settings = v; dirty(); $('#eErr', this.el).textContent = ''; } catch (err) { $('#eErr', this.el).textContent = 'Settings: ' + err.message; } };
    $('#eBack', this.el).onclick = () => { if (E.dirty && !confirm('Leave without saving?')) return; this.mode = 'list'; this.load().then(() => this.render()); };
    $('#eRun', this.el).onclick = () => this.saveEdit();
    $('#eExp', this.el).onclick = async () => { const t = await this.saveEdit(true); if (t) this.ctx.call('widgets.export', t); };
    $('#eAdd', this.el).onclick = async () => { const t = await this.saveEdit(true); if (!t) return; const tt = (await this.ctx.call('widgets.types')).find((x) => x.type === t); this.state = await this.ctx.call('widgets.state'); this.addMenu(tt, $('#eAdd', this.el)); };
    $('#eAsk', this.el).onclick = (e) => this.askBox(e.currentTarget);
    new ResizeObserver(() => { const c = $('#eCard', this.el); if (c && this.preview) this.post({ ev: 'resize', data: { w: c.clientWidth, h: c.clientHeight } }); }).observe($('#eCard', this.el));
  }
  async saveEdit(quiet = false) {
    const E = this.ed; if (!E) return null;
    if (!E.dirty && !E.builtin) { if (!quiet) this.runPreview(); return E.type; }
    const was = E.type; const t = await this.ctx.call('widgets.save', E.type, E.manifest, E.files);
    E.type = t; E.dirty = false; this.thumbs.delete(t);
    if (t !== was) { E.builtin = false; this.ctx.toast('Saved as your own widget'); this.renderEditor(); } else { const d = $('#eDirty', this.el); if (d) d.classList.remove('on'); }
    this.runPreview(); return t;
  }
  async runPreview() {
    const E = this.ed; const f = $('#eFrame', this.el); if (!f) return;
    const c = $('#eCard', this.el);
    const inst = await this.ctx.call('widgets.temp', E.type, null, { w: c.clientWidth, h: c.clientHeight });
    this.preview = { id: inst.id, inst, frame: f };
    $('#eErr', this.el).textContent = '';
    f.onload = () => this.post({ ev: 'init', data: { id: inst.id, settings: inst.settings, style: inst.style, size: { w: c.clientWidth, h: c.clientHeight }, permissions: E.manifest.permissions, sky: (() => { const s = skyAt(new Date(), this.ctx.S.settings.location); return { phases: s.phases, daylight: s.daylight }; })(), paused: false } });
    f.src = `mural://widget/${E.type}/${E.manifest.page}?i=${inst.id}&r=${Date.now()}`;
  }
  post(msg) { const p = this.preview; if (p && p.frame.contentWindow) p.frame.contentWindow.postMessage({ mw: 1, ...msg }, '*'); }
  async onFrameMessage(e) {
    const p = this.preview; if (!p || !p.frame || e.source !== p.frame.contentWindow) return;
    const m = e.data; if (!m || m.mw !== 1 || !m.id || !m.call) return;
    try { let data = await this.ctx.raw.call('widgets.call', p.id, String(m.call), Array.isArray(m.args) ? m.args : []); if (m.call === 'system' && navigator.getBattery) { try { const b = await navigator.getBattery(); data = { ...data, battery: { level: b.level, charging: b.charging } }; } catch (_) {} } this.post({ re: m.id, ok: true, data }); }
    catch (err) { const msg = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); this.post({ re: m.id, ok: false, error: msg }); const el = $('#eErr', this.el); if (el) el.textContent = msg; }
  }
  askBox(anchor) {
    document.querySelectorAll('.menu:not(#wDrawer)').forEach((m) => m.remove());
    const E = this.ed;
    const box = h(`<div class="menu" style="width:420px;padding:12px"><div style="font-weight:650;margin-bottom:6px;display:flex;align-items:center;gap:7px">${icon('claude')}Ask Claude about “${esc(E.manifest.name)}”</div>
      <textarea class="txt" id="aT" style="width:100%;height:80px;padding:8px;resize:vertical" placeholder="e.g. Show my next three calendar-style deadlines from a list I can edit in settings"></textarea>
      <div id="aLog" class="hint" style="max-height:160px;overflow:auto;white-space:pre-wrap"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button class="btn sm ghost" id="aX">Close</button><button class="btn sm primary" id="aGo">Ask</button></div></div>`);
    document.body.appendChild(box); const r = anchor.getBoundingClientRect(); box.style.left = Math.max(8, r.right - 420) + 'px'; box.style.top = r.bottom + 6 + 'px';
    const log = $('#aLog', box), t = $('#aT', box); t.focus(); let off = null, busy = false;
    $('#aX', box).onclick = () => { if (busy) this.ctx.call('ai.stop'); if (off) off(); box.remove(); };
    $('#aGo', box).onclick = async () => {
      const q = t.value.trim(); if (!q || busy) return; const type = await this.saveEdit(true); busy = true; $('#aGo', box).disabled = true; log.textContent = 'Starting…';
      off = this.ctx.raw.on('ask', (ev) => { if (ev.kind === 'tool') log.textContent += `\n• ${ev.name.replace(/_/g, ' ')}`; else if (ev.kind === 'text') log.textContent += `\n${ev.text}`; log.scrollTop = 1e9; });
      const prompt = `The user is editing the Mural widget "${E.manifest.name}" (type ${type}) in Mural's widget editor. Use the Mural widget tools to make this change to that widget (update_widget, then preview_widget to check it), and don't place it on the desktop unless asked.\n\nRequest: ${q}`;
      try { const res = await this.ctx.call('ai.ask', prompt); log.textContent += `\n\n${res.who}: ${res.text || 'Done.'}`; const full = await this.ctx.call('widgets.get', type); if (full) { this.ed.manifest = full.manifest; this.ed.files = full.files; this.ed.dirty = false; this.renderEditor(); this.runPreview(); } }
      catch (_) { log.textContent += '\nStopped.'; } finally { busy = false; if (off) off(); off = null; const g = $('#aGo', box); if (g) g.disabled = false; }
    };
  }
}
