// Helm — turns controller frames into pointer motion, scrolling, clicks, keys and shortcuts.
// It runs on a fixed tick (main.js calls tick() ~125 times a second) against the latest frame, so motion stays smooth
// whatever rate the controller reports at. Everything it does goes through `out` (real input) and `ui` (Helm's own
// overlays), so it can be tested with fakes.
'use strict';

const { BY_ID, DEFAULT_BINDINGS, specFor } = require('./actions');
const { Touchpad } = require('./touchpad');
const { Keyboard } = require('./keyboard');
const { Panel } = require('./panel');
const { blank, BUTTONS } = require('./parse');

const HUD_GROUPS = new Set(['Desktop', 'Media', 'Windows']);
const CHORD_MS = 700;

class Mapper {
  constructor({ out, ui, settings = () => ({}), platform = process.platform }) {
    this.out = out; this.ui = ui; this.settings = settings; this.platform = platform;
    this.touch = new Touchpad(() => this.settings());
    this.kb = new Keyboard(platform); this.panel = new Panel(platform);
    this.frame = null; this.prev = blank().b; this.last = 0;
    this.enabled = true; this.paused = null; this.mode = 'pointer';
    this.pressed = new Map();   // button -> action id it started (so the release goes to the same one)
    this.repeats = new Map();   // key -> { fn, next, every }
    this.layerHeld = false; this.layerAt = 0; this.hint = false; this.switcher = null;
    this.precise = false; this.vel = { x: 0, y: 0 }; this.boostSince = 0; this.navDir = null; this.navNext = 0;
    this.chordAt = 0; this.chordDone = false; this.volNext = 0;
    this.activity = 0;
  }
  s() {
    const s = this.settings() || {};
    return {
      pointerSpeed: s.pointerSpeed ?? 1, curve: s.pointerCurve ?? 2, deadzone: s.deadzone ?? 0.14, precisionStrength: s.precisionStrength ?? 0.7,
      scrollSpeed: s.scrollSpeed ?? 1, invertScroll: !!s.invertScroll, swapSticks: !!s.swapSticks, hints: s.showHints !== false,
      bindings: { base: { ...DEFAULT_BINDINGS.base, ...((s.bindings && s.bindings.base) || {}) }, layer: { ...DEFAULT_BINDINGS.layer, ...((s.bindings && s.bindings.layer) || {}) } }
    };
  }

  // ------------------------------------------------------------ state from outside
  update(frame) { this.frame = frame; }
  setEnabled(on, why = null) {
    on = !!on; if (on === this.enabled) return;
    this.enabled = on; if (!on) this.releaseAll();
    this.ui.state && this.ui.state({ enabled: this.enabled, paused: this.paused, why });
  }
  setPaused(reason) {
    reason = reason || null; if (reason === this.paused) return;
    this.paused = reason; if (reason) this.releaseAll();
    this.ui.state && this.ui.state({ enabled: this.enabled, paused: this.paused });
  }
  active() { return this.enabled && !this.paused; }

  releaseAll() {
    for (const [btn, id] of this.pressed) this.release(btn, id);
    this.pressed.clear(); this.repeats.clear(); this.endSwitcher();
    if (this.layerHeld) { this.layerHeld = false; this.setHint(false); }
    if (this.touch.clicked) { this.out.mouse(this.touch.clickButton, false); }
    this.touch.reset(); this.vel = { x: 0, y: 0 };
    if (this.mode !== 'pointer') this.setMode('pointer');
  }

  // ------------------------------------------------------------ the tick
  tick(now) {
    const dt = this.last ? Math.min(50, Math.max(1, now - this.last)) : 8; this.last = now;
    const f = this.frame || blank();
    const b = f.b, p = this.prev;
    const edge = (k) => (b[k] && !p[k] ? 1 : !b[k] && p[k] ? -1 : 0);

    // Create + Options held together: Helm on / off, and the way back in while a game has the controller
    if (b.create && b.options) {
      if (!this.chordAt) this.chordAt = now;
      if (!this.chordDone && now - this.chordAt >= CHORD_MS) {
        this.chordDone = true;
        // drop whatever those two buttons were about to do so nothing fires on release
        for (const k of ['create', 'options']) this.pressed.set(k, 'none');
        if (this.ui.chord) this.ui.chord(); else this.setEnabled(!this.enabled, 'chord');
        this.haptic('toggle');
      }
    } else { this.chordAt = 0; this.chordDone = false; }

    if (!this.active()) { this.prev = { ...b }; return; }
    if (this.anyInput(f)) this.activity = now;

    if (this.mode === 'keyboard') this.tickKeyboard(f, edge, now, dt);
    else if (this.mode === 'panel') this.tickPanel(f, edge, now, dt);
    else this.tickPointer(f, edge, now, dt);

    for (const [k, r] of this.repeats) { if (now >= r.next) { r.fn(); r.next = now + r.every; } else void k; }
    if (this.layerHeld && !this.hint && this.s().hints && now - this.layerAt > 420) this.setHint(true);
    this.prev = { ...b };
  }
  anyInput(f) {
    if (f.t && f.t.length) return true;
    if (Math.abs(f.a.lx) > 0.2 || Math.abs(f.a.ly) > 0.2 || Math.abs(f.a.rx) > 0.2 || Math.abs(f.a.ry) > 0.2) return true;
    return BUTTONS.some((k) => f.b[k]);
  }

  // ------------------------------------------------------------ pointer mode
  tickPointer(f, edge, now, dt) {
    const s = this.s();
    for (const k of BUTTONS) {
      if (k === 'pad') continue;
      const e = edge(k); if (!e) continue;
      // Create and Options act when they're let go, so holding both for the on/off chord never fires either one
      const deferred = k === 'create' || k === 'options';
      if (e > 0) {
        if (s.bindings.base[k] === 'layer' && !this.layerHeld) { this.layerHeld = true; this.layerAt = now; this.pressed.set(k, 'layer'); continue; }
        const id = (this.layerHeld ? s.bindings.layer[k] : s.bindings.base[k]) || 'none';
        if (deferred) { this.pressed.set(k, 'later:' + id); continue; }
        this.pressed.set(k, id); this.press(k, id, now);
      } else {
        const id = this.pressed.get(k); if (!id) continue;
        this.pressed.delete(k);
        if (id === 'layer') { this.layerHeld = false; this.setHint(false); this.endSwitcher(); continue; }
        if (id.startsWith('later:')) { const real = id.slice(6); if (!(f.b.create || f.b.options) || !this.chordAt) { this.press(k, real, now); this.release(k, real); } continue; }
        this.release(k, id);
      }
    }
    if (this.mode !== 'pointer') return; // a press just opened the keyboard or the panel

    // sticks
    const lx = s.swapSticks ? f.a.rx : f.a.lx, ly = s.swapSticks ? f.a.ry : f.a.ly;
    const rx = s.swapSticks ? f.a.lx : f.a.rx, ry = s.swapSticks ? f.a.ly : f.a.ry;
    const slow = this.precisionFactor(f, s);
    this.pointerFromStick(lx, ly, dt, now, s, slow);
    if (this.layerHeld && Math.abs(ry) > 0.45 && Math.abs(ry) > Math.abs(rx)) {
      // command layer: right stick up / down is the volume
      if (now >= this.volNext) { this.runAction(BY_ID[ry < 0 ? 'volumeUp' : 'volumeDown'], { quiet: true }); this.volNext = now + 260 - 170 * Math.min(1, (Math.abs(ry) - 0.45) / 0.5); this.ui.hud && this.ui.hud(ry < 0 ? 'Volume +' : 'Volume −', { icon: ry < 0 ? 'volup' : 'voldown' }); }
    } else {
      this.volNext = 0;
      this.scrollFromStick(rx, ry, dt, s);
    }

    // touchpad
    if (f.hasTouch) {
      for (const ev of this.touch.update(f.t || [], !!f.b.pad, now)) {
        if (ev.type === 'move') this.out.moveBy(ev.dx * slow, ev.dy * slow);
        else if (ev.type === 'scroll') this.out.scroll(ev.dx, ev.dy, { touch: true, momentum: !!ev.momentum });
        else if (ev.type === 'button') this.out.mouse(ev.button, ev.down);
        else if (ev.type === 'tap') { this.out.mouse(ev.button, true); this.out.mouse(ev.button, false); }
        else if (ev.type === 'swipe') {
          // fingers left reveals the desktop on the right, like a Mac trackpad
          this.runAction(BY_ID[ev.dir === 'left' ? 'desktopRight' : 'desktopLeft']); this.haptic('tick');
        }
      }
    }
  }
  precisionFactor(f, s) {
    let p = this.precise ? 0.65 : 0;
    for (const k of ['l2', 'r2', 'l1', 'r1', 'l3', 'r3', 'cross', 'circle', 'square', 'triangle', 'paddleL', 'paddleR']) {
      if ((this.pressed.get(k) === 'precision') || (s.bindings.base[k] === 'precision' && !this.layerHeld)) {
        const analog = k === 'l2' ? f.a.lt : k === 'r2' ? f.a.rt : f.b[k] ? 1 : 0;
        p = Math.max(p, analog);
      }
    }
    return 1 - s.precisionStrength * Math.min(1, p);
  }
  pointerFromStick(x, y, dt, now, s, slow) {
    const mag = Math.hypot(x, y);
    let tx = 0, ty = 0;
    if (mag > s.deadzone) {
      const m = Math.min(1, (mag - s.deadzone) / (1 - s.deadzone - 0.04));
      if (m > 0.97) { if (!this.boostSince) this.boostSince = now; } else this.boostSince = 0;
      const boost = this.boostSince ? 1 + 0.75 * Math.min(1, Math.max(0, now - this.boostSince - 300) / 600) : 1;
      const speed = 1450 * s.pointerSpeed * Math.pow(m, s.curve) * boost * slow; // DIP per second
      tx = (x / mag) * speed; ty = (y / mag) * speed;
    } else this.boostSince = 0;
    const k = 1 - Math.exp(-dt / (tx || ty ? 32 : 16)); // eases in, stops quicker
    this.vel.x += (tx - this.vel.x) * k; this.vel.y += (ty - this.vel.y) * k;
    if (!tx && !ty && Math.hypot(this.vel.x, this.vel.y) < 4) { this.vel.x = 0; this.vel.y = 0; }
    if (this.vel.x || this.vel.y) this.out.moveBy(this.vel.x * dt / 1000, this.vel.y * dt / 1000);
  }
  scrollFromStick(x, y, dt, s) {
    const dz = Math.max(0.12, s.deadzone);
    const f = (v) => { const a = Math.abs(v); if (a < dz) return 0; const m = Math.min(1, (a - dz) / (1 - dz - 0.04)); return Math.sign(v) * Math.pow(m, 1.7); };
    const sx = f(x), sy = f(y);
    if (!sx && !sy) return;
    const k = 2100 * s.scrollSpeed * dt / 1000 * (s.invertScroll ? -1 : 1);
    this.out.scroll(sx * k, sy * k, { touch: false });
  }

  // ------------------------------------------------------------ actions
  press(btn, id, now) {
    const a = BY_ID[id]; if (!a || id === 'none') return;
    if (this.layerHeld) this.layerUsedAt = now;
    switch (a.kind) {
      case 'mouse': this.out.mouse(a.button, true); return;
      case 'key': {
        const sp = specFor(a, this.platform); if (!sp) return;
        this.out.key(sp.key, sp.mods || [], true);
        if (a.repeat) this.repeat(btn, () => this.out.key(sp.key, sp.mods || [], true), now);
        return;
      }
      case 'switcher': this.switch(a.dir); return;
      case 'helm': this.helm(id, btn); return;
      default:
        this.runAction(a);
        if (a.repeat) this.repeat(btn, () => this.runAction(a, { quiet: true }), now);
    }
  }
  release(btn, id) {
    this.repeats.delete(btn);
    const a = BY_ID[id]; if (!a) return;
    if (a.kind === 'mouse') this.out.mouse(a.button, false);
    else if (a.kind === 'key') { const sp = specFor(a, this.platform); if (sp) this.out.key(sp.key, sp.mods || [], false); }
    else if (a.kind === 'switcher' && !this.layerHeld) this.endSwitcher();
  }
  repeat(key, fn, now, delay = 420, every = 55) { this.repeats.set(key, { fn, next: now + delay, every }); }
  runAction(a, { quiet = false } = {}) {
    if (!a) return;
    const sp = a.kind === 'media' ? { media: a.media } : specFor(a, this.platform);
    if (!sp) { this.ui.hud && this.ui.hud(`${a.label} isn’t available here`, { icon: 'info' }); return; }
    if (sp.media) this.out.media(sp.media);
    else if (sp.cmd) this.out.command(sp.cmd);
    else this.out.combo(sp.key, sp.mods || []);
    if (!quiet && this.ui.hud && (a.hud || HUD_GROUPS.has(a.group))) this.ui.hud(a.hud || a.label, { icon: a.icon || a.group.toLowerCase() });
  }
  switch(dir) {
    const mod = this.platform === 'win32' ? 'alt' : 'cmd';
    if (!this.switcher) { this.switcher = { mod }; this.out.key(mod, [], true); }
    this.out.combo('tab', dir < 0 ? [mod, 'shift'] : [mod]);
  }
  endSwitcher() { if (this.switcher) { this.out.key(this.switcher.mod, [], false); this.switcher = null; } }
  helm(id) {
    if (id === 'keyboard') this.setMode(this.mode === 'keyboard' ? 'pointer' : 'keyboard');
    else if (id === 'quickPanel') this.setMode(this.mode === 'panel' ? 'pointer' : 'panel');
    else if (id === 'precisionToggle') { this.precise = !this.precise; this.ui.hud && this.ui.hud(this.precise ? 'Precision on' : 'Precision off', { icon: 'target' }); }
    else if (id === 'toggleHelm') { this.setEnabled(false, 'button'); this.haptic('toggle'); }
    else if (id === 'openHelm') this.ui.openSettings && this.ui.openSettings();
  }
  setHint(on) { if (on === this.hint) return; this.hint = on; this.ui.layerHint && this.ui.layerHint(on ? this.s().bindings.layer : null); }
  haptic(kind) { this.ui.haptic && this.ui.haptic(kind); }

  // ------------------------------------------------------------ modes: keyboard and quick panel
  setMode(mode) {
    // let go of anything held in the old mode
    for (const [btn, id] of this.pressed) { if (id !== 'layer') this.release(btn, id); }
    for (const k of [...this.pressed.keys()]) if (this.pressed.get(k) !== 'layer') this.pressed.set(k, 'none');
    this.repeats.clear(); this.endSwitcher(); this.touch.reset(); this.vel = { x: 0, y: 0 };
    if (this.layerHeld) { this.layerHeld = false; this.setHint(false); }
    this.mode = mode; this.navDir = null; this.kb.held = false; this.padWas = false;
    this.ui.keyboard && this.ui.keyboard(mode === 'keyboard' ? this.kb.view() : null);
    this.ui.panel && this.ui.panel(mode === 'panel' ? this.panel.view() : null);
  }
  /** One direction from the d-pad or a stick, with keyboard-style repeat. */
  nav(f, now) {
    let dir = f.b.up ? 'up' : f.b.down ? 'down' : f.b.left ? 'left' : f.b.right ? 'right' : null;
    let depth = 1;
    if (!dir) {
      const x = f.a.lx, y = f.a.ly, m = Math.hypot(x, y);
      if (m > 0.55) { dir = Math.abs(x) > Math.abs(y) ? (x < 0 ? 'left' : 'right') : (y < 0 ? 'up' : 'down'); depth = Math.min(1, (m - 0.55) / 0.4); }
    }
    if (!dir) { this.navDir = null; return null; }
    if (dir !== this.navDir) { this.navDir = dir; this.navNext = now + 330; return dir; }
    if (now >= this.navNext) { this.navNext = now + 120 - 60 * depth; return dir; }
    return null;
  }
  pressedEdge(edge, k) { const e = edge(k); if (e > 0) this.pressed.set(k, 'none'); if (e < 0) this.pressed.delete(k); return e; }
  sendKey(r) {
    if (!r) return;
    if (r.type === 'text') this.out.text(r.text);
    else if (r.type === 'key') this.out.combo(r.key, []);
    else if (r.type === 'combo') this.out.combo(r.key, r.mods);
    else if (r.type === 'hide') this.setMode('pointer');
  }
  tickKeyboard(f, edge, now, dt) {
    const kb = this.kb; let changed = false;
    const d = this.nav(f, now); if (d) { kb.move(d); changed = true; }
    const p = f.t && f.t[0];
    if (p) { const before = kb.row + ':' + kb.col; kb.pointAt(p.x, p.y); if (before !== kb.row + ':' + kb.col) changed = true; }
    const held = !!(f.b.l2 || f.a.lt > 0.4); if (held !== kb.held) { kb.held = held; changed = true; }
    const pe = this.pressedEdge.bind(this, edge);
    const type = (r) => { this.sendKey(r); changed = true; };
    if (pe('cross') > 0 || pe('pad') > 0) type(kb.press());
    if (pe('square') > 0) { type(kb.press('backspace')); this.repeat('kb-bs', () => this.out.combo('backspace', []), now); }
    if (edge('square') < 0) this.repeats.delete('kb-bs');
    if (pe('triangle') > 0) { type(kb.press(' ')); this.repeat('kb-sp', () => this.out.text(' '), now); }
    if (edge('triangle') < 0) this.repeats.delete('kb-sp');
    if (pe('l1') > 0) { this.out.combo('left', []); this.repeat('kb-l', () => this.out.combo('left', []), now); }
    if (edge('l1') < 0) this.repeats.delete('kb-l');
    if (pe('r1') > 0) { this.out.combo('right', []); this.repeat('kb-r', () => this.out.combo('right', []), now); }
    if (edge('r1') < 0) this.repeats.delete('kb-r');
    if (pe('r2') > 0) type({ type: 'key', key: 'return' });
    if (pe('options') > 0 && !f.b.create) { kb.press('mode'); changed = true; }
    if (pe('create') > 0 && !f.b.options) { kb.mod = !kb.mod; changed = true; }
    if (pe('circle') > 0) { this.setMode('pointer'); return; }
    if (pe('ps') > 0) { this.setMode('panel'); return; }
    this.scrollFromStick(f.a.rx, f.a.ry, dt, this.s());
    if (changed && this.mode === 'keyboard') this.ui.keyboard && this.ui.keyboard(kb.view());
  }
  tickPanel(f, edge, now) {
    const pn = this.panel; let changed = false;
    const d = this.nav(f, now); if (d) { pn.move(d); changed = true; }
    const p = f.t && f.t[0];
    if (p) { const i = pn.i; pn.pointAt(p.x, p.y); if (i !== pn.i) changed = true; }
    const pe = this.pressedEdge.bind(this, edge);
    if (pe('cross') > 0 || pe('pad') > 0) {
      const t = pn.current();
      if (!t.keepOpen) this.setMode('pointer');
      if (t.id === 'keyboard') { this.setMode('keyboard'); return; }
      const a = BY_ID[t.id]; if (a.kind === 'helm') this.helm(a.id); else this.runAction(a);
      if (!t.keepOpen) return;
      this.haptic('tick');
    }
    if (pe('circle') > 0 || pe('ps') > 0) { this.setMode('pointer'); return; }
    if (pe('triangle') > 0) { this.setMode('keyboard'); return; }
    if (changed) this.ui.panel && this.ui.panel(pn.view());
  }
}

module.exports = { Mapper };
