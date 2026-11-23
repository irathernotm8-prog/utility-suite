// Mural — Linux / test stand-in: wallpaper windows are ordinary windows filling each display, and the tests drive
// clicks and "covered" through emit(). Lets the whole app run under Xvfb.
'use strict';
const { EventEmitter } = require('events');
class DemoDesktop extends EventEmitter {
  get name() { return 'demo'; }
  windowOptions() { return {}; }
  start() {} configure() {}
  async attach(win) { win.setIgnoreMouseEvents(!process.env.MURAL_E2E); return { ok: true, mode: 'window' }; }
  async place(win, display) { win.setBounds(display.bounds); return { ok: true }; }
  forget() { return Promise.resolve(); }
  restoreDesktop() { return Promise.resolve({ ok: true }); }
  async getWallpaper() { return this.paper || null; }
  async setWallpaper(p) { this.paper = p; return { ok: true }; }
  stop() {}
}
module.exports = { DemoDesktop };
