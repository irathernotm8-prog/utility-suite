// Bench — a tiny DevTools-protocol client over Node's built-in WebSocket. Used for an app's main process (Node's
// inspector speaks the same protocol as Chrome's DevTools).
'use strict';

class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.wait = new Map(); this.handlers = new Map(); this.closed = false; }
  open(timeoutMs = 10000) {
    return new Promise((res, rej) => {
      let ws;
      try { ws = new WebSocket(this.url); } catch (e) { return rej(e); }
      this.ws = ws;
      const to = setTimeout(() => { try { ws.close(); } catch {} rej(new Error('The app’s debugger didn’t answer')); }, timeoutMs);
      ws.onopen = () => { clearTimeout(to); res(this); };
      ws.onerror = (e) => { clearTimeout(to); rej(new Error('Couldn’t connect to the app: ' + (e.message || 'socket error'))); };
      ws.onclose = () => {
        this.closed = true;
        for (const [, w] of this.wait) w.rej(new Error('The app closed'));
        this.wait.clear();
        (this.handlers.get('close') || []).forEach((f) => f());
      };
      ws.onmessage = (m) => {
        let d; try { d = JSON.parse(typeof m.data === 'string' ? m.data : Buffer.from(m.data).toString()); } catch { return; }
        if (d.id && this.wait.has(d.id)) { const w = this.wait.get(d.id); this.wait.delete(d.id); d.error ? w.rej(new Error(d.error.message || 'Protocol error')) : w.res(d.result); }
        else if (d.method) (this.handlers.get(d.method) || []).forEach((f) => { try { f(d.params || {}); } catch {} });
      };
    });
  }
  send(method, params = {}, ms = 60000) {
    if (this.closed) return Promise.reject(new Error('The app closed'));
    const id = ++this.id;
    try { this.ws.send(JSON.stringify({ id, method, params })); } catch (e) { return Promise.reject(e); }
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.wait.delete(id); rej(new Error(`The app didn’t answer in time (${method})`)); }, ms);
      this.wait.set(id, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
    });
  }
  on(method, fn) { if (!this.handlers.has(method)) this.handlers.set(method, []); this.handlers.get(method).push(fn); return () => this.handlers.set(method, this.handlers.get(method).filter((x) => x !== fn)); }
  close() { try { this.ws.close(); } catch {} }
}

/** Turns a protocol RemoteObject / exceptionDetails into a readable value or error. */
function unwrap(r) {
  if (!r) return undefined;
  if (r.exceptionDetails) {
    const ex = r.exceptionDetails.exception;
    const msg = (ex && (ex.description || ex.value)) || r.exceptionDetails.text || 'Script error';
    throw new Error(String(msg).split('\n    at ')[0]);
  }
  const v = r.result;
  if (!v) return undefined;
  if ('value' in v) return v.value;
  if (v.type === 'undefined') return undefined;
  return v.description;
}

module.exports = { Cdp, unwrap };
