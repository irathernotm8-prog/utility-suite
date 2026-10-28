// Relay — where Relay keeps its files, and resume points for the player.
// (The Library moved to Vantage in Relay 2.1; its folders stay where they are and Vantage uses them in place.)
const path = require('path');
const { app, ipcMain } = require('electron');

let ctx = null;
function root() {
  const s = ctx.getStore().settings;
  return s.filesRoot || path.join(app.getPath('downloads'), 'Relay', 'Relay Files');
}

function register(c) {
  ctx = c;
  // playback position for local videos & music (resume where you left off)
  ipcMain.handle('media:progress', (_e, { file, pos, dur }) => {
    if (!file || !dur) return;
    const s = ctx.getStore();
    s.mediaProgress = s.mediaProgress || {};
    const done = pos >= dur - Math.min(90, dur * 0.05);
    s.mediaProgress[file] = { pos: done ? 0 : pos, dur, done, at: Date.now() };
    ctx.saveStore();
  });
  ipcMain.handle('media:get-progress', (_e, file) => (ctx.getStore().mediaProgress || {})[file] || null);
}

module.exports = { register, root };
