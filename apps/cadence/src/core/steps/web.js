// Cadence — web steps: download a file, call an API, post to a chat webhook. The browser step lives in browser.js (Electron).
'use strict';
const fs = require('fs');
const path = require('path');
const { fromObjects, parseCSV } = require('../table');
const { get } = require('../template');
const { uniquePath } = require('./files')._;

function headersFrom(kv) {
  const h = {};
  if (Array.isArray(kv)) for (const r of kv) { if (r && r.key) h[r.key] = String(r.value ?? ''); }
  else if (kv && typeof kv === 'object') for (const [k, v] of Object.entries(kv)) h[k] = String(v ?? '');
  return h;
}
function nameFromResponse(res, url) {
  const cd = res.headers.get('content-disposition') || '';
  let m = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(cd); if (m) { try { return decodeURIComponent(m[1].trim().replace(/^"|"$/g, '')); } catch {} }
  m = /filename\s*=\s*"?([^";]+)"?/i.exec(cd); if (m) return m[1].trim();
  let base = ''; try { base = decodeURIComponent(path.basename(new URL(url).pathname)); } catch {}
  const type = (res.headers.get('content-type') || '').split(';')[0].trim();
  const ext = { 'text/csv': '.csv', 'application/json': '.json', 'application/pdf': '.pdf', 'application/zip': '.zip', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx', 'text/plain': '.txt', 'text/html': '.html', 'image/png': '.png', 'image/jpeg': '.jpg' }[type] || '';
  if (!base || base === '/') base = 'download';
  if (!path.extname(base) && ext) base += ext;
  return base;
}
async function doFetch(w, x, { cookies } = {}) {
  const url = String(w.url || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error(`“${url || '(blank)'}” isn’t a web address`);
  const headers = headersFrom(w.headers);
  if (cookies && x.services.browser && w.profile) { const c = await x.services.browser.cookieHeader(w.profile, url); if (c) headers.Cookie = c; }
  if (!Object.keys(headers).some((k) => k.toLowerCase() === 'user-agent')) headers['User-Agent'] = 'Mozilla/5.0 (Cadence automation)';
  const method = (w.method || 'GET').toUpperCase();
  let body;
  if (!['GET', 'HEAD'].includes(method) && w.body != null && w.body !== '') {
    body = typeof w.body === 'string' ? w.body : JSON.stringify(w.body);
    if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['Content-Type'] = /^\s*[[{]/.test(body) ? 'application/json' : 'text/plain';
  }
  x.log(`${method} ${url.replace(/([?&](?:key|token|api_key|apikey|access_token|sig)=)[^&]+/gi, '$1••••')}`);
  const ctl = new AbortController(); const onAbort = () => ctl.abort(); x.signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctl.abort(), (Number(w.timeout) || 180) * 1000);
  try { return { res: await fetch(url, { method, headers, body, redirect: 'follow', signal: ctl.signal }), url }; }
  catch (e) { throw new Error(x.signal.aborted ? 'Cancelled' : e.name === 'AbortError' ? 'The site took too long to answer' : `Couldn’t reach the site: ${e.cause ? e.cause.code || e.cause.message : e.message}`); }
  finally { clearTimeout(timer); x.signal.removeEventListener('abort', onAbort); }
}

module.exports = {
  'web.download': async (w, x) => {
    const { res, url } = await doFetch(w, x, { cookies: true });
    if (!res.ok) throw new Error(`The site answered ${res.status} ${res.statusText}${res.status === 401 || res.status === 403 ? ' — it may need you signed in (pick a browser profile) or a token in the headers' : ''}`);
    const type = res.headers.get('content-type') || '';
    const buf = Buffer.from(await res.arrayBuffer());
    let name = (w.saveAs && String(w.saveAs).trim()) || nameFromResponse(res, res.url || url);
    name = name.replace(/[\\/:*?"<>|]+/g, '-');
    if (/text\/html/i.test(type) && !/\.html?$/i.test(name)) x.log('Heads up: the site sent a web page, not a file. You may need to be signed in — try a Browser step instead.', 'warn');
    const dest = uniquePath(path.join(x.dir, name));
    fs.writeFileSync(dest, buf);
    x.log(`Saved ${name} (${(buf.length / 1024).toFixed(buf.length < 10240 ? 1 : 0)} KB)`);
    return { file: dest, files: [dest], status: res.status };
  },

  'web.request': async (w, x) => {
    const { res } = await doFetch(w, x);
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    let json = null; try { json = JSON.parse(text); } catch {}
    let tbl = null;
    if (json) {
      const pick = w.jsonPath ? get(json, w.jsonPath) : json;
      const arr = Array.isArray(pick) ? pick : Array.isArray(pick?.data) ? pick.data : Array.isArray(pick?.items) ? pick.items : Array.isArray(pick?.results) ? pick.results : null;
      if (arr) tbl = fromObjects(arr.map((o) => (o && typeof o === 'object' ? flat(o) : { value: o })));
    } else if (/text\/csv/i.test(res.headers.get('content-type') || '')) tbl = parseCSV(text);
    x.log(`HTTP ${res.status}${tbl ? ` · ${tbl.rows.length} rows` : ''}`);
    return { status: res.status, text, json, table: tbl };
  },

  'web.post': async (w, x) => {
    const url = String(w.url || '');
    const text = String(w.text || '');
    let payload;
    if (/hooks\.slack\.com/.test(url)) payload = { text };
    else if (/discord(app)?\.com\/api\/webhooks/.test(url)) payload = { content: text.slice(0, 2000) };
    else if (/chat\.googleapis\.com/.test(url)) payload = { text };
    else if (/office\.com|logic\.azure\.com|powerautomate|webhook\.office/.test(url)) payload = { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: { type: 'AdaptiveCard', version: '1.4', $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', body: [{ type: 'TextBlock', text, wrap: true }] } }] };
    else payload = { text };
    const { res } = await doFetch({ url, method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } }, x);
    if (!res.ok) throw new Error(`The webhook answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    x.log('Posted');
    return { status: res.status };
  },
};
function flat(o, pre = '', out = {}) {
  for (const [k, v] of Object.entries(o)) { const key = pre ? `${pre}.${k}` : k; if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, key, out); else out[key] = Array.isArray(v) ? v.map((z) => (typeof z === 'object' ? JSON.stringify(z) : z)).join(', ') : v; }
  return out;
}
module.exports._ = { headersFrom, nameFromResponse };
