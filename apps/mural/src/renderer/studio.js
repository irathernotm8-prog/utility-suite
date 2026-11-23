// Mural — the Studio: build and tune wallpapers with a live preview that plays exactly as the desktop will.
import { icon, KIND_ICON, TYPE_ICON } from './icons.js';
import { KINDS, COMMON, EFFECTS, PHASES, makeLayer, normalizeManifest } from './runtime/schema.js';
import { createPlayer } from './runtime/player.js';
import { skyAt } from './runtime/sun.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const clone = (o) => JSON.parse(JSON.stringify(o));
const fmtHour = (x) => { const hh = Math.floor(x) % 24, mm = Math.round((x - Math.floor(x)) * 60); const d = new Date(); d.setHours(hh, mm === 60 ? 59 : mm, 0, 0); return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };

const SHADER_TEMPLATE = `// A shader wallpaper. mainImage runs for every pixel; keep it light, it runs all day.
// iTime seconds · iResolution size · iPointer cursor 0..1 · iClick xy + z = seconds since the click
// iDaylight 0 night…1 day · iPhase (night, dawn, day, dusk) · iParams the sliders below
void mainImage(out vec4 o, in vec2 fc) {
  vec2 uv = fc / iResolution.xy;
  vec2 m = iPointer;
  float d = length(uv - m);
  vec3 a = vec3(0.08, 0.1, 0.22), b = vec3(0.45, 0.3, 0.9);
  vec3 col = mix(a, b, uv.y + 0.1 * sin(iTime * 0.3 + uv.x * 3.0));
  col += 0.25 * exp(-d * 6.0) * (0.6 + 0.4 * iParams.x);
  if (iClick.z < 2.0) col += 0.3 * exp(-iClick.z * 2.0) * smoothstep(0.03, 0.0, abs(length(uv - iClick.xy) - iClick.z * 0.4));
  o = vec4(col, 1.0);
}
`;

const STARTERS = [
  { key: 'landscape', icon: 'sun', title: 'Time-of-day landscape', text: 'A sky that follows the sun, layered hills that shift with the cursor, stars at night.' },
  { key: 'dynamic', icon: 'image', title: 'Dynamic from pictures', text: 'Four pictures — dawn, day, dusk and night — that fade into each other through the day.' },
  { key: 'photo', icon: 'sparkles', title: 'Picture + effects', text: 'Your photo with depth, falling particles, a clock and click ripples on top.' },
  { key: 'video', icon: 'film', title: 'Video wallpaper', text: 'A looping clip, decoded by the graphics chip, with optional effects on top.' },
  { key: 'shader', icon: 'code', title: 'Shader', text: 'GLSL that draws every pixel on the GPU. Paste one from Shadertoy or start from ours.' },
  { key: 'blank', icon: 'layers', title: 'Blank scene', text: 'A gradient to start from. Add any layers you like.' }
];

export class Studio {
  constructor(el, ctx) {
    this.el = el; this.ctx = ctx; this.id = null; this.m = null; this.code = ''; this.dirty = false; this.sel = null; this.player = null; this.hour = null; this.ratio = 'r1610';
    this.undo = []; this.redo = []; this.lastSnap = null; this.saving = false;
    addEventListener('keydown', (e) => {
      if (this.ctx.S.page !== 'studio' || !this.m) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); this.save(); }
      if (mod && e.key.toLowerCase() === 'z' && !/TEXTAREA|INPUT/.test(document.activeElement.tagName)) { e.preventDefault(); e.shiftKey ? this.doRedo() : this.doUndo(); }
    });
  }
  show() { if (!this.m && !this.el.dataset.mode) this.showStarters(); else if (this.player) this.player.resume(); }
  hide() { if (this.player) this.player.pause(); }
  libraryChanged() { if (this.id && !this.dirty && !this.saving && this.ctx.S.page === 'studio' && this.asked) { this.asked = false; this.open(this.id, true); } }

  // ------------------------------------------------------------------------------------------------- starting
  showStarters() {
    this.destroyPlayer(); this.m = null; this.id = null; this.el.dataset.mode = 'start';
    this.el.innerHTML = `<div class="head"><h1>Studio</h1><span class="sub">Start from a template, or pick a wallpaper in the Library and press Edit</span><div class="spacer"></div></div>
      <div class="studio-empty"><div class="starters">${STARTERS.map((s) => `<button class="starter" data-k="${s.key}"><div class="ic">${icon(s.icon)}</div><b>${s.title}</b><span>${s.text}</span></button>`).join('')}</div></div>`;
    this.el.querySelectorAll('.starter').forEach((b) => (b.onclick = () => this.start(b.dataset.k)));
  }
  async start(kind) {
    const { call } = this.ctx; let m;
    const L = makeLayer;
    if (kind === 'landscape') m = { name: 'My landscape', type: 'scene', scene: { layers: [L('sky', { depth: 0.08 }), L('particles', { name: 'Stars', preset: 'stars', count: 220, cursor: 'none', clickBurst: false, bottom: 0.6, when: { night: 1, dawn: 0.15, day: 0, dusk: 0.3 } }), L('hills', { name: 'Mountains', style: 'mountains', color: '#7d87b8', nightColor: '#1a2040', base: 0.62, depth: 0.2 }), L('hills', { name: 'Hills', color: '#3e5778', nightColor: '#0f1630', base: 0.76, seed: 12, depth: 0.45 }), L('hills', { name: 'Trees', style: 'forest', color: '#1d2a40', nightColor: '#060a15', base: 0.88, seed: 40, depth: 0.8 })], effects: { click: 'sparkle' } } };
    else if (kind === 'dynamic') m = { name: 'My dynamic wallpaper', type: 'scene', tags: ['dynamic'], scene: { layers: [['Night', { night: 1, dawn: 0, day: 0, dusk: 0 }], ['Dawn', { night: 0, dawn: 1, day: 0, dusk: 0 }], ['Day', { night: 0, dawn: 0, day: 1, dusk: 0 }], ['Dusk', { night: 0, dawn: 0, day: 0, dusk: 1 }]].map(([n, w], i) => L('image', { name: n + ' picture', when: i === 0 ? null : w })), effects: { click: 'none' } } };
    else if (kind === 'photo') m = { name: 'My photo', type: 'scene', scene: { layers: [L('image', { name: 'Photo', depth: 0.25 }), L('glow', { name: 'Cursor light', follow: true, color: '#ffffff', strength: 0.18, r: 0.3, blend: 'screen' }), L('text', { name: 'Clock', text: '{time}', size: 0.1, weight: 200, y: 0.3 }), L('particles', { name: 'Snow', preset: 'snow', count: 260 })], effects: { click: 'ripple' } } };
    else if (kind === 'video') m = { name: 'My video', type: 'video', src: '', fit: 'cover', scene: { layers: [], effects: { click: 'ripple' } } };
    else if (kind === 'shader') m = { name: 'My shader', type: 'shader', shader: 'main.frag', params: [{ name: 'Glow', value: 0.5, min: 0, max: 1 }], quality: { fps: 30, scale: 0.5 } };
    else m = { name: 'Untitled scene', type: 'scene', scene: { layers: [L('gradient')], effects: { click: 'ripple' } } };
    const id = await call('library.create', m);
    if (kind === 'shader') await call('library.save', id, { ...m }, { 'main.frag': SHADER_TEMPLATE });
    await this.open(id);
    if (kind === 'video') this.pickFile('video', (name) => { this.m.src = name; this.change(true); });
    if (kind === 'photo') this.pickFile('image', (name) => { this.m.scene.layers[0].src = name; this.change(true); });
    if (kind === 'dynamic') this.ctx.toast('Pick a picture for each part of the day in the layer settings');
  }
  async pickFile(kind, done) { const name = await this.ctx.call('library.addAsset', this.id, kind); if (name) done(name); }

  // ------------------------------------------------------------------------------------------------- opening
  async open(id, keepView = false) {
    const full = await this.ctx.call('library.get', id); if (!full) return;
    this.id = id; this.builtin = full.builtin; this.m = clone(full.manifest); this.code = full.code || this.m.code || ''; this.files = full.files; this.base = full.base;
    if (!keepView) { this.sel = null; this.undo = []; this.redo = []; }
    this.dirty = false; this.lastSnap = this.snap();
    this.el.dataset.mode = 'edit';
    this.build(); await this.restart();
  }
  snap() { return JSON.stringify({ m: this.m, code: this.code }); }
  layout() {
    const t = this.m.type; const hasLayers = t === 'scene' || t === 'video' || t === 'image';
    return { hasLayers, shader: t === 'shader', web: t === 'web' };
  }
  build() {
    const L = this.layout(); const m = this.m;
    this.el.innerHTML = `
      <div class="head">
        <span class="typetag">${icon(TYPE_ICON[m.type] || 'layers')}</span>
        <input class="namebox" id="nm" value="${esc(m.name)}" spellcheck="false"><span class="dirty-dot" id="dd"></span>
        ${this.builtin ? '<span class="sub">Built in · saving makes your own copy</span>' : ''}
        <div class="spacer"></div>
        <button class="btn icon ghost" id="undo" title="Undo">${icon('undo')}</button><button class="btn icon ghost" id="redo" title="Redo">${icon('redo')}</button>
        <button class="btn" id="ask">${icon('claude')}Ask Claude</button>
        <button class="btn" id="newB">${icon('plus')}New</button>
        <button class="btn" id="exp">${icon('export')}Export</button>
        <button class="btn" id="save">Save</button>
        <button class="btn primary" id="apply">${icon('display')}Set as wallpaper</button>
      </div>
      <div class="body">
        <div class="pane left" id="left"></div>
        <div class="center">
          <div class="stage-wrap"><div class="stage ${this.ratio}" id="stage"></div></div>
          <div class="timebar">
            <span class="phase" id="phase"></span>
            <input type="range" id="hour" min="0" max="24" step="0.05" value="${this.hour ?? 12}">
            <button class="btn sm ${this.hour == null ? 'primary' : ''}" id="live">Now</button>
            <div class="seg" id="ratio">${[['r169', '16:9'], ['r1610', '16:10'], ['r219', '21:9'], ['r32', '3:2']].map(([k, l]) => `<button data-r="${k}" class="${this.ratio === k ? 'on' : ''}">${l}</button>`).join('')}</div>
            <span class="stats-mini" id="smini"></span>
          </div>
        </div>
        <div class="pane right" id="right"></div>
      </div>`;
    const nm = $('#nm', this.el); nm.oninput = () => { this.m.name = nm.value; this.change(false); };
    $('#save', this.el).onclick = () => this.save();
    $('#apply', this.el).onclick = async () => { const id = await this.save(true); if (id) { await this.ctx.call('apply', id, this.ctx.S.target); this.ctx.toast(`${this.m.name} is on your desktop`); } };
    $('#exp', this.el).onclick = async () => { const id = await this.save(true); if (id) this.ctx.call('library.export', id); };
    $('#newB', this.el).onclick = () => { if (this.dirty && !confirm('Leave without saving your changes?')) return; this.showStarters(); };
    $('#undo', this.el).onclick = () => this.doUndo(); $('#redo', this.el).onclick = () => this.doRedo();
    $('#ask', this.el).onclick = (e) => this.askBox(e.currentTarget);
    const hr = $('#hour', this.el);
    hr.oninput = () => { this.hour = Number(hr.value); $('#live', this.el).classList.remove('primary'); if (this.player) this.player.setHour(this.hour); this.phaseLabel(); };
    $('#live', this.el).onclick = () => { this.hour = null; $('#live', this.el).classList.add('primary'); const d = new Date(); hr.value = d.getHours() + d.getMinutes() / 60; if (this.player) this.player.setHour(null); this.phaseLabel(); };
    $('#ratio', this.el).querySelectorAll('button').forEach((b) => (b.onclick = () => { this.ratio = b.dataset.r; $('#stage', this.el).className = 'stage ' + this.ratio; $('#ratio', this.el).querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); }));
    const stage = $('#stage', this.el);
    stage.onmousemove = (e) => { const r = stage.getBoundingClientRect(); if (this.player) this.player.pointer((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, true); };
    stage.onmouseleave = () => { if (this.player) this.player.pointer(0.5, 0.5, false); };
    stage.onmousedown = (e) => { const r = stage.getBoundingClientRect(); if (this.player) this.player.click((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e.button); };
    stage.ondragover = (e) => e.preventDefault();
    stage.ondrop = (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; const p = f && this.ctx.raw.pathFor(f); if (p) this.dropFile(p); };
    this.renderLeft(); this.renderRight(); this.phaseLabel(); this.updateDirty();
  }
  phaseLabel() {
    const el = $('#phase', this.el); if (!el) return;
    const sky = skyAt(new Date(), this.ctx.S.settings.location, this.hour);
    const p = sky.phases; const top = Object.entries(p).sort((a, b) => b[1] - a[1])[0][0];
    const names = { night: 'Night', dawn: 'Dawn', day: 'Day', dusk: 'Dusk' };
    el.innerHTML = `${icon(top === 'night' ? 'moon' : 'sun')}${this.hour == null ? 'Now' : fmtHour(this.hour)} · ${names[top]}`;
  }

  // ------------------------------------------------------------------------------------------------- preview
  destroyPlayer() { if (this.player) { this.player.destroy(); this.player = null; } }
  async restart() {
    this.destroyPlayer();
    const stage = $('#stage', this.el); if (!stage) return;
    const err = h('<div class="err" style="display:none"></div>');
    try {
      const man = { ...this.m, code: this.layout().shader ? this.code : undefined };
      this.player = await createPlayer(stage, { manifest: man, base: this.base + '', fps: 30, scale: 1, location: this.ctx.S.settings.location, hour: this.hour, onError: (e) => this.showError(e), onStats: (s) => { const sm = $('#smini', this.el); if (sm) sm.textContent = `${s.fps} fps · ${s.ms} ms${s.particles ? ' · ' + s.particles + ' particles' : ''}`; } });
      if (this.m.type === 'shader') this.player.setParams((this.m.params || []).map((p) => p.value));
      stage.appendChild(err);
    } catch (e) { stage.appendChild(err); this.showError(e.message || String(e)); }
  }
  showError(msg) { const stage = $('#stage', this.el); if (!stage) return; let e = $('.err', stage); if (!e) { e = h('<div class="err"></div>'); stage.appendChild(e); } e.style.display = msg ? 'block' : 'none'; e.textContent = msg || ''; }

  /** Something changed. structural: layers added/removed/reordered, files swapped (rebuild); else just push settings. */
  change(structural = false) {
    this.dirty = true; this.updateDirty();
    clearTimeout(this.snapT); this.snapT = setTimeout(() => this.commitHistory(), 350);
    clearTimeout(this.liveT);
    this.liveT = setTimeout(async () => {
      if (!this.player) return this.restart();
      const t = this.m.type;
      if (structural) return this.restart();
      if (this.m.scene && this.m.scene.layers) {
        if (!this.player.manifest.scene || !this.player.manifest.scene.layers.length) return this.restart();
        await this.player.updateScene(this.m.scene);
      }
    }, 50);
  }
  commitHistory() { const s = this.snap(); if (s === this.lastSnap) return; this.undo.push(this.lastSnap); if (this.undo.length > 80) this.undo.shift(); this.redo = []; this.lastSnap = s; }
  restoreSnap(s) { const o = JSON.parse(s); this.m = o.m; this.code = o.code; this.lastSnap = s; this.dirty = true; this.build(); this.restart(); }
  doUndo() { this.commitHistory(); if (!this.undo.length) return; this.redo.push(this.lastSnap); this.restoreSnap(this.undo.pop()); }
  doRedo() { if (!this.redo.length) return; this.undo.push(this.lastSnap); this.restoreSnap(this.redo.pop()); }
  updateDirty() { const d = $('#dd', this.el); if (d) d.classList.toggle('on', this.dirty); }

  async save(quiet = false) {
    if (!this.m) return null;
    if (!this.dirty && !this.builtin) return this.id;
    this.saving = true;
    try {
      const m = normalizeManifest(clone(this.m)); const files = {};
      if (m.type === 'shader') { m.shader = m.shader || 'main.frag'; delete m.code; files[m.shader] = this.code; }
      const was = this.id;
      const id = await this.ctx.call('library.save', this.id, m, files);
      const shot = this.player && this.player.snapshot(560);
      if (shot) await this.ctx.call('library.saveThumb', id, shot);
      this.dirty = false; this.updateDirty();
      if (id !== was) { this.ctx.toast('Saved as your own copy'); await this.open(id, true); }
      else if (!quiet) this.ctx.toast('Saved');
      return id;
    } finally { this.saving = false; }
  }
  async dropFile(p) {
    const ext = p.split('.').pop().toLowerCase();
    const kind = ['mp4', 'webm', 'mov', 'm4v'].includes(ext) ? 'video' : ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'].includes(ext) ? 'image' : null;
    if (!kind) return this.ctx.toast('Drop a picture or a video', true);
    if (this.builtin) { await this.save(true); }
    const name = await this.ctx.call('library.addAsset', this.id, kind, p); if (!name) return;
    if (this.m.type === 'video' && kind === 'video') { this.m.src = name; return this.change(true); }
    if (!this.m.scene) this.m.scene = { layers: [], effects: {} };
    this.m.scene.layers.splice(0, 0, makeLayer(kind, { name: p.split(/[\\/]/).pop(), src: name }));
    this.sel = this.m.scene.layers[0].id; this.renderLeft(); this.renderRight(); this.change(true);
  }

  // ------------------------------------------------------------------------------------------------- left pane
  renderLeft() {
    const left = $('#left', this.el); const Lo = this.layout();
    if (Lo.shader) {
      left.innerHTML = `<div class="code-wrap"><div class="pane-h">${icon('code')}Shader<div class="spacer"></div><span class="hint" style="margin:0;text-transform:none;letter-spacing:0">Updates as you type</span></div><textarea class="code" id="code" spellcheck="false"></textarea></div>`;
      left.style.width = ''; const ta = $('#code', left); ta.value = this.code;
      ta.onkeydown = (e) => { if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('  ', s, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); } };
      ta.oninput = () => { this.code = ta.value; this.dirty = true; this.updateDirty(); clearTimeout(this.cT); this.cT = setTimeout(() => { this.commitHistory(); const e = this.player ? this.player.compile(this.code) : null; this.showError(e); }, 350); };
      this.el.querySelector('.body').style.gridTemplateColumns = 'minmax(380px, 40%) 1fr 280px';
      return;
    }
    this.el.querySelector('.body').style.gridTemplateColumns = '';
    if (Lo.web) { left.innerHTML = `<div class="pane-h">${icon('globe')}Web page</div><div class="props"><p class="hint">This wallpaper is a web page (${esc(this.m.page || 'index.html')}). Edit its files in any editor, then reload the preview.</p><button class="btn" id="rev">${icon('folder')}Show files</button> <button class="btn" id="rel">${icon('refresh')}Reload</button><p class="hint" style="margin-top:14px">Mural sends the page <kbd>{mural:'pointer'}</kbd>, <kbd>{mural:'click'}</kbd>, <kbd>{mural:'pause'}</kbd> and <kbd>{mural:'resume'}</kbd> messages. Stop timers on pause.</p></div>`; $('#rev', left).onclick = () => this.ctx.call('library.reveal', this.id); $('#rel', left).onclick = () => this.restart(); return; }
    const layers = (this.m.scene && this.m.scene.layers) || [];
    left.innerHTML = `<div class="pane-h">${icon('layers')}Layers<div class="spacer"></div><button class="btn sm icon ghost" id="addL" title="Add a layer">${icon('plus')}</button></div>
      <div class="scene-row"><div class="layer ${!this.sel ? 'on' : ''}" data-id="">${icon(this.m.type === 'video' ? 'film' : this.m.type === 'image' ? 'image' : 'sparkles')}<span class="nm">${this.m.type === 'scene' ? 'Scene & effects' : this.m.type === 'video' ? 'Video & effects' : 'Picture & effects'}</span></div></div>
      <div class="layers">${[...layers].reverse().map((l) => `<div class="layer ${this.sel === l.id ? 'on' : ''} ${l.hidden ? 'hid' : ''}" data-id="${esc(l.id)}">${icon(KIND_ICON[l.kind])}<span class="nm">${esc(l.name)}</span>${l.when ? `<span class="tod" title="Shows by time of day">${icon('sun')}</span>` : ''}<button class="eye" title="${l.hidden ? 'Show' : 'Hide'}">${icon(l.hidden ? 'eyeoff' : 'eye')}</button></div>`).join('') || '<div class="hint" style="padding:6px 8px">No layers yet.</div>'}</div>
      ${this.sel ? `<div style="display:flex;gap:4px;padding:0 12px 12px"><button class="btn sm icon" id="lUp" title="Bring forward">${icon('up')}</button><button class="btn sm icon" id="lDn" title="Send back">${icon('down')}</button><button class="btn sm icon" id="lDup" title="Duplicate">${icon('copy')}</button><div class="spacer"></div><button class="btn sm icon danger" id="lDel" title="Delete">${icon('trash')}</button></div>` : ''}`;
    left.querySelectorAll('.layer').forEach((row) => {
      row.onclick = (e) => { if (e.target.closest('.eye')) return; this.sel = row.dataset.id || null; this.renderLeft(); this.renderRight(); };
      const eye = $('.eye', row); if (eye) eye.onclick = () => { const l = layers.find((x) => x.id === row.dataset.id); l.hidden = !l.hidden; this.renderLeft(); this.change(); };
      row.ondblclick = () => { const l = layers.find((x) => x.id === row.dataset.id); if (!l) return; const n = prompt('Layer name', l.name); if (n) { l.name = n; this.renderLeft(); this.change(); } };
    });
    $('#addL', left).onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); this.ctx.menu(r.left, r.bottom + 4, Object.entries(KINDS).filter(([k]) => this.m.type === 'scene' || k !== 'video').map(([k, v]) => ({ label: v.label, icon: KIND_ICON[k], hint: v.hint, run: () => this.addLayer(k) }))); };
    const idx = () => layers.findIndex((l) => l.id === this.sel);
    const mv = (d) => { const i = idx(); const j = i + d; if (i < 0 || j < 0 || j >= layers.length) return; [layers[i], layers[j]] = [layers[j], layers[i]]; this.renderLeft(); this.change(true); };
    if ($('#lUp', left)) { $('#lUp', left).onclick = () => mv(1); $('#lDn', left).onclick = () => mv(-1); $('#lDup', left).onclick = () => { const i = idx(); const c = { ...clone(layers[i]), id: makeLayer(layers[i].kind).id, name: layers[i].name + ' copy' }; layers.splice(i + 1, 0, c); this.sel = c.id; this.renderLeft(); this.renderRight(); this.change(true); }; $('#lDel', left).onclick = () => { layers.splice(idx(), 1); this.sel = null; this.renderLeft(); this.renderRight(); this.change(true); }; }
  }
  addLayer(kind) {
    if (!this.m.scene) this.m.scene = { layers: [], effects: {} };
    const l = makeLayer(kind); this.m.scene.layers.push(l); this.sel = l.id; this.renderLeft(); this.renderRight(); this.change(true);
    if ((kind === 'image' || kind === 'video') && !this.builtin) this.pickFile(kind, (name) => { l.src = name; this.renderRight(); this.change(true); });
  }

  // ------------------------------------------------------------------------------------------------- right pane
  renderRight() {
    const right = $('#right', this.el); const Lo = this.layout(); const m = this.m;
    if (Lo.shader) {
      const ps = m.params || (m.params = []);
      right.innerHTML = `<div class="pane-h">${icon('settings')}Sliders</div><div class="props">
        <p class="hint">Up to four sliders, read in the shader as <kbd>iParams.x</kbd> … <kbd>.w</kbd>.</p>
        ${ps.map((p, i) => `<div class="group"><div class="field"><label>Name</label><div class="ctl"><input class="txt" data-pn="${i}" value="${esc(p.name)}"></div></div>
          <div class="field"><label>${esc(p.name || 'Value')}</label><div class="ctl"><input type="range" data-pv="${i}" min="${p.min ?? 0}" max="${p.max ?? 1}" step="${((p.max ?? 1) - (p.min ?? 0)) / 200}" value="${p.value}"><input class="num" data-pvn="${i}" value="${p.value}"></div></div>
          <div class="field"><label>Range</label><div class="ctl"><input class="num" data-pmin="${i}" value="${p.min ?? 0}"> to <input class="num" data-pmax="${i}" value="${p.max ?? 1}"><div class="spacer"></div><button class="btn sm icon ghost" data-pdel="${i}">${icon('trash')}</button></div></div></div>`).join('')}
        ${ps.length < 4 ? `<button class="btn sm" id="addP">${icon('plus')}Add slider</button>` : ''}
        <div class="group"><div class="gt">Performance</div>${this.fieldHtml({ key: 'q.scale', label: 'Resolution', type: 'range', min: 0.25, max: 1, step: 0.05 }, (m.quality || {}).scale ?? 0.5)}${this.fieldHtml({ key: 'q.fps', label: 'Frame rate (max)', type: 'select', options: ['15', '24', '30', '60'] }, String((m.quality || {}).fps ?? 30))}
        <p class="hint">Half resolution looks the same for soft shaders and costs a quarter. Use full only for fine lines.</p></div></div>`;
      const sync = () => { if (this.player) this.player.setParams(ps.map((p) => p.value)); this.dirty = true; this.updateDirty(); clearTimeout(this.snapT); this.snapT = setTimeout(() => this.commitHistory(), 350); };
      right.querySelectorAll('[data-pv]').forEach((r) => (r.oninput = () => { const i = +r.dataset.pv; ps[i].value = Number(r.value); right.querySelector(`[data-pvn="${i}"]`).value = r.value; sync(); }));
      right.querySelectorAll('[data-pvn]').forEach((r) => (r.onchange = () => { ps[+r.dataset.pvn].value = Number(r.value); this.renderRight(); sync(); }));
      right.querySelectorAll('[data-pn]').forEach((r) => (r.onchange = () => { ps[+r.dataset.pn].name = r.value; this.renderRight(); sync(); }));
      right.querySelectorAll('[data-pmin]').forEach((r) => (r.onchange = () => { ps[+r.dataset.pmin].min = Number(r.value); this.renderRight(); sync(); }));
      right.querySelectorAll('[data-pmax]').forEach((r) => (r.onchange = () => { ps[+r.dataset.pmax].max = Number(r.value); this.renderRight(); sync(); }));
      right.querySelectorAll('[data-pdel]').forEach((b) => (b.onclick = () => { ps.splice(+b.dataset.pdel, 1); this.renderRight(); sync(); }));
      if ($('#addP', right)) $('#addP', right).onclick = () => { ps.push({ name: 'Slider ' + (ps.length + 1), value: 0.5, min: 0, max: 1 }); this.renderRight(); sync(); };
      this.bindFields(right, (key, v) => { m.quality = m.quality || {}; if (key === 'q.scale') m.quality.scale = v; if (key === 'q.fps') m.quality.fps = Number(v); this.change(true); });
      return;
    }
    if (Lo.web) { right.innerHTML = `<div class="pane-h">${icon('cursor')}Reacts to</div><div class="props">${this.fieldHtml({ key: 'cursor', label: 'Cursor', type: 'toggle' }, !!(m.interactive || {}).cursor)}${this.fieldHtml({ key: 'click', label: 'Clicks', type: 'toggle' }, !!(m.interactive || {}).click)}</div>`; this.bindFields(right, (k, v) => { m.interactive = { ...(m.interactive || {}), [k]: v }; this.change(true); }); return; }
    const layers = (m.scene && m.scene.layers) || [];
    const L = layers.find((l) => l.id === this.sel);
    if (!L) {
      const eff = (m.scene && m.scene.effects) || {};
      right.innerHTML = `<div class="pane-h">${icon('sparkles')}${m.type === 'scene' ? 'Scene' : m.type === 'video' ? 'Video' : 'Picture'}</div><div class="props">
        ${m.type !== 'scene' ? `<div class="group"><div class="gt">Source</div>${this.fieldHtml({ key: 'src', label: m.type === 'video' ? 'Video' : 'Picture', type: 'file', accept: m.type }, m.src)}${this.fieldHtml({ key: 'fit', label: 'Fit', type: 'select', options: ['cover', 'contain', 'stretch'] }, m.fit)}${m.type === 'video' ? this.fieldHtml({ key: 'speed', label: 'Speed', type: 'range', min: 0.25, max: 2, step: 0.05 }, m.speed || 1) : ''}</div>` : ''}
        <div class="group"><div class="gt">On top</div>${EFFECTS.map((f) => this.fieldHtml(f, eff[f.key] ?? f.default, 'e.')).join('')}</div>
        <div class="group"><div class="gt">Tags</div><div class="field wide"><input class="txt" id="tags" value="${esc((m.tags || []).join(', '))}" placeholder="calm, night, city"></div></div>
        <div class="group"><p class="hint">${icon('cursor')} Move over the preview to try the cursor, click it to try clicks. Drag the time bar to see other parts of the day.</p></div></div>`;
      this.bindFields(right, (key, v) => {
        if (key.startsWith('e.')) { m.scene = m.scene || { layers: [], effects: {} }; m.scene.effects = { ...(m.scene.effects || {}), [key.slice(2)]: v }; this.change(m.type !== 'scene'); }
        else { m[key] = v; this.change(true); }
      });
      $('#tags', right).onchange = (e) => { m.tags = e.target.value.split(',').map((x) => x.trim()).filter(Boolean); this.change(); };
      return;
    }
    const K = KINDS[L.kind];
    right.innerHTML = `<div class="pane-h">${icon(KIND_ICON[L.kind])}${esc(K.label)}</div><div class="props">
      <p class="hint">${esc(K.hint)}</p>
      <div class="group"><div class="gt">Settings</div>${K.fields.map((f) => this.fieldHtml(f, L[f.key])).join('')}</div>
      <div class="group"><div class="gt">Look & motion</div>${COMMON.map((f) => this.fieldHtml(f, L[f.key])).join('')}</div>
      <div class="group"><div class="gt">${icon('sun')}Time of day<div class="spacer"></div><button class="switch ${L.when ? 'on' : ''}" id="todOn" title="Show by time of day"></button></div>
        ${L.when ? PHASES.map((p) => this.fieldHtml({ key: 'w.' + p, label: p[0].toUpperCase() + p.slice(1), type: 'range', min: 0, max: 1, step: 0.05 }, L.when[p] ?? 1)).join('') + '<p class="hint">How visible the layer is in each part of the day. Drag the time bar under the preview to check.</p>' : '<p class="hint">Shown all day. Turn on to fade it in and out with the sun.</p>'}</div></div>`;
    this.bindFields(right, (key, v) => {
      if (key.startsWith('w.')) { L.when = { ...(L.when || {}), [key.slice(2)]: v }; this.change(); return; }
      L[key] = v; if (key === 'src') this.change(true); else this.change(); if (key === 'name') this.renderLeft();
    });
    $('#todOn', right).onclick = () => { L.when = L.when ? null : { night: 1, dawn: 1, day: 1, dusk: 1 }; this.renderRight(); this.renderLeft(); this.change(); };
  }

  fieldHtml(f, v, prefix = '') {
    const k = prefix + f.key; let ctl = '';
    switch (f.type) {
      case 'range': ctl = `<input type="range" data-k="${k}" min="${f.min}" max="${f.max}" step="${f.step}" value="${v}"><input class="num" data-kn="${k}" value="${v}">`; break;
      case 'color': ctl = v ? `<input type="color" data-k="${k}" value="${esc(v)}"><input class="txt" data-kc="${k}" value="${esc(v)}" style="font:11.5px var(--mono)">${f.default === '' ? `<button class="btn sm icon ghost" data-kclear="${k}" title="None">${icon('close')}</button>` : ''}` : `<div class="empty-color" data-kset="${k}" title="Pick a color"></div><span class="hint" style="margin:0">None</span>`; break;
      case 'select': ctl = f.options.length <= 3 && f.options.every((o) => o.length < 9) ? `<div class="seg" data-ks="${k}">${f.options.map((o) => `<button data-v="${esc(o)}" class="${o === v ? 'on' : ''}">${esc(o)}</button>`).join('')}</div>` : `<select class="txt" data-k="${k}">${f.options.map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`; break;
      case 'toggle': ctl = `<button class="switch ${v ? 'on' : ''}" data-kt="${k}"></button>`; break;
      case 'text': ctl = `<input class="txt" data-k="${k}" value="${esc(v)}">`; break;
      case 'file': ctl = `<span class="hint" style="margin:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${v ? esc(v) : 'None yet'}</span><button class="btn sm" data-kf="${k}" data-accept="${f.accept}">Choose…</button>`; break;
    }
    return `<div class="field"><label>${esc(f.label)}</label><div class="ctl">${ctl}</div></div>`;
  }
  bindFields(root, set) {
    root.querySelectorAll('input[type=range][data-k]').forEach((r) => (r.oninput = () => { const n = root.querySelector(`[data-kn="${r.dataset.k}"]`); if (n) n.value = r.value; set(r.dataset.k, Number(r.value)); }));
    root.querySelectorAll('[data-kn]').forEach((n) => (n.onchange = () => { const r = root.querySelector(`input[type=range][data-k="${n.dataset.kn}"]`); const v = Number(n.value); if (!isFinite(v)) return; if (r) r.value = v; set(n.dataset.kn, v); }));
    root.querySelectorAll('input[type=color][data-k]').forEach((c) => (c.oninput = () => { const t = root.querySelector(`[data-kc="${c.dataset.k}"]`); if (t) t.value = c.value; set(c.dataset.k, c.value); }));
    root.querySelectorAll('[data-kc]').forEach((t) => (t.onchange = () => { if (/^#[0-9a-f]{6}$/i.test(t.value)) { root.querySelector(`input[type=color][data-k="${t.dataset.kc}"]`).value = t.value; set(t.dataset.kc, t.value); } }));
    root.querySelectorAll('[data-kclear]').forEach((b) => (b.onclick = () => { set(b.dataset.kclear, ''); this.renderRight(); }));
    root.querySelectorAll('[data-kset]').forEach((b) => (b.onclick = () => { set(b.dataset.kset, '#888888'); this.renderRight(); }));
    root.querySelectorAll('select[data-k]').forEach((s) => (s.onchange = () => set(s.dataset.k, s.value)));
    root.querySelectorAll('input.txt[data-k]').forEach((s) => (s.oninput = () => set(s.dataset.k, s.value)));
    root.querySelectorAll('[data-ks] button').forEach((b) => (b.onclick = () => { b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); set(b.parentElement.dataset.ks, b.dataset.v); }));
    root.querySelectorAll('[data-kt]').forEach((b) => (b.onclick = () => { const on = !b.classList.contains('on'); b.classList.toggle('on', on); set(b.dataset.kt, on); }));
    root.querySelectorAll('[data-kf]').forEach((b) => (b.onclick = async () => {
      if (this.builtin) await this.save(true);
      const name = await this.ctx.call('library.addAsset', this.id, b.dataset.accept === 'video' ? 'video' : 'image'); if (name) { set(b.dataset.kf, name); this.renderRight(); }
    }));
  }

  // ------------------------------------------------------------------------------------------------- ask Claude
  askBox(anchor) {
    document.querySelectorAll('.menu').forEach((m) => m.remove());
    const box = h(`<div class="menu" style="width:420px;padding:12px">
      <div style="font-weight:650;margin-bottom:6px;display:flex;align-items:center;gap:7px">${icon('claude')}Ask Claude about “${esc(this.m.name)}”</div>
      <textarea class="txt" id="askT" style="width:100%;height:80px;padding:8px;resize:vertical" placeholder="e.g. Make the snow heavier at night and add a soft moon glow that follows the cursor"></textarea>
      <div id="askLog" class="hint" style="max-height:160px;overflow:auto;white-space:pre-wrap"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button class="btn sm ghost" id="askX">Close</button><button class="btn sm primary" id="askGo">Ask</button></div></div>`);
    document.body.appendChild(box);
    const r = anchor.getBoundingClientRect(); box.style.left = Math.max(8, r.right - 420) + 'px'; box.style.top = r.bottom + 6 + 'px';
    const log = $('#askLog', box); const t = $('#askT', box); t.focus();
    let off = null;
    $('#askX', box).onclick = () => { if (this.askBusy) this.ctx.call('ai.stop'); if (off) off(); box.remove(); };
    $('#askGo', box).onclick = async () => {
      const q = t.value.trim(); if (!q || this.askBusy) return;
      if (this.dirty) await this.save(true);
      this.askBusy = true; $('#askGo', box).disabled = true; log.textContent = 'Starting…';
      off = this.ctx.raw.on('ask', (ev) => { if (ev.kind === 'tool') log.textContent += `\n• ${ev.name.replace(/_/g, ' ')}`; else if (ev.kind === 'text') log.textContent += `\n${ev.text}`; log.scrollTop = 1e9; });
      const prompt = `The user is editing the wallpaper "${this.m.name}" (id ${this.id}) in Mural's Studio. Use the Mural tools to make this change to that wallpaper, preview it to check, and don't put anything on the desktop unless asked.\n\nRequest: ${q}`;
      try { const res = await this.ctx.call('ai.ask', prompt); log.textContent += `\n\n${res.who}: ${res.text || 'Done.'}`; this.asked = true; await this.reloadAfterAsk(); }
      catch (_) { log.textContent += '\nStopped.'; }
      finally { this.askBusy = false; if (off) off(); off = null; const g = $('#askGo', box); if (g) g.disabled = false; }
    };
  }
  async reloadAfterAsk() {
    // a built-in gets copied on its first edit: follow the newest of the user's wallpapers with this name
    const lib = await this.ctx.call('library.list');
    let id = this.id;
    if (this.builtin) { const mine = lib.filter((w) => !w.builtin && w.name.startsWith(this.m.name)).sort((a, b) => b.mtime - a.mtime)[0]; if (mine) id = mine.id; }
    await this.open(id, true);
  }
}
