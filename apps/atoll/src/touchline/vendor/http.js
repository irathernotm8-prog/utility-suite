// Vendored from apps/touchline/src/data by `npm run sync-touchline`. Edit it in Touchline, not here.
// Touchline — one place for network requests: timeouts, retries, polite pacing
// and transparent gzip (data.fotmob.com serves raw .gz bodies).
'use strict';
const zlib = require('zlib');

let netFetch = null;
try { const { net } = require('electron'); if (net && typeof net.fetch === 'function') netFetch = (u, o) => net.fetch(u, o); } catch {}
const doFetch = (u, o) => (netFetch ? netFetch(u, o) : fetch(u, o));

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36';
const hostGap = new Map();          // host -> next allowed time (ms)
const MIN_GAP = { 'www.fotmob.com': 120, 'query.wikidata.org': 1100, 'www.wikidata.org': 250 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pace(host) {
  const gap = MIN_GAP[host] || 0;
  if (!gap) return;
  const now = Date.now();
  const next = hostGap.get(host) || 0;
  hostGap.set(host, Math.max(now, next) + gap);
  if (next > now) await sleep(next - now);
}

class HttpError extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}

async function getBuffer(url, { headers = {}, timeout = 20000, retries = 2 } = {}) {
  if (/wikidata\.org/.test(url)) retries = Math.max(retries, 3);
  const host = new URL(url).host;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await pace(host);
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await doFetch(url, { signal: ctl.signal, headers: { 'user-agent': UA, accept: 'application/json, text/plain, */*', 'accept-language': 'en-US,en;q=0.9', ...headers } });
      if (res.status === 404) throw new HttpError('Not found', 404);
      if (res.status === 429 || res.status === 503) {
        const wait = Math.min(15, Number(res.headers.get('retry-after')) || 3 + attempt * 3) * 1000;
        hostGap.set(host, Date.now() + wait);
        throw new HttpError(res.status === 429 ? 'Busy, try again in a moment' : `HTTP ${res.status}`, res.status);
      }
      if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status);
      let buf = Buffer.from(await res.arrayBuffer());
      if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
      return buf;
    } catch (err) {
      lastErr = err.name === 'AbortError' ? new HttpError('Timed out', 0) : err;
      if (err.status === 404 || (err.status >= 400 && err.status < 500 && err.status !== 429)) break;
      if (attempt < retries && err.status !== 429 && err.status !== 503) await sleep(500 * (attempt + 1) + Math.random() * 300);
    } finally { clearTimeout(t); }
  }
  throw lastErr;
}

async function getJson(url, opts) {
  const buf = await getBuffer(url, opts);
  const text = buf.toString('utf8');
  try { return JSON.parse(text); }
  catch { throw new HttpError(`Expected JSON from ${new URL(url).host}, got "${text.slice(0, 60)}"`, 0); }
}

module.exports = { getJson, getBuffer, HttpError, UA };
