// Dither — runs effect code off the page thread, inside the sandboxed window. Nothing here can reach files or the network.
'use strict';
importScripts('../core/fxruntime.js');
self.onmessage = (e) => {
  const { id, code, opts } = e.data;
  try {
    const r = DitherFX.render(code, opts || {});
    const frames = r.frames.map((f) => f.buffer);
    self.postMessage({ id, ok: true, meta: r.meta, frames }, frames);
  } catch (err) {
    let line = null; const m = /<anonymous>:(\d+):(\d+)/.exec(err && err.stack || ''); if (m) line = Math.max(1, Number(m[1]) - 3);
    self.postMessage({ id, ok: false, error: String(err && err.message || err), line });
  }
};
