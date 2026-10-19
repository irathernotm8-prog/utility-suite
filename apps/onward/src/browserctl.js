// Onward — lets Claude drive the browser pane. The <webview> tabs live in the renderer; the renderer
// registers each tab's webContents id here, and Claude's tools act on the active tab.
const { webContents } = require('electron');
const K = require('./pagekit');

const tabs = new Map();      // tabId -> { wcId, jobId }
let onPage = () => {};       // (tabId) page changed — the Apply Guide rescans
let activeTab = null;
let send = () => {};         // (channel, payload) to the renderer
let onSubmitted = () => {};  // (jobId, url) when the user presses a highlighted submit button
const waiters = new Map();   // reqId -> resolve
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let ensureUi = async () => {};
function init({ sendToRenderer, submitted, ensureWindow }) { send = sendToRenderer; onSubmitted = submitted; if (ensureWindow) ensureUi = ensureWindow; }
const tabOfWc = (wcId) => { for (const [id, t] of tabs) if (t.wcId === wcId) return { tabId: id, ...t }; return null; };
const jobForWc = (wcId) => tabOfWc(wcId)?.jobId || null;

function register({ tabId, wcId, reqId }) {
  const prev = tabs.get(tabId);
  tabs.set(tabId, { wcId, jobId: prev?.jobId || null });
  const wc = webContents.fromId(wcId);
  if (wc && !wc.__onwardHooked) {
    wc.__onwardHooked = true;
    wc.on('console-message', (e, ...rest) => {
      const message = e && typeof e.message === 'string' ? e.message : rest[1];
      if (typeof message === 'string' && message.startsWith('__onward_submit__')) {
        let payload = {};
        try { payload = JSON.parse(message.slice('__onward_submit__'.length) || '{}'); } catch {}
        onSubmitted(jobForWc(wcId), wc.getURL(), payload);
      }
    });
    // Re-hook submit buttons whenever a page (or an embedded form) finishes loading
    const rehook = () => setTimeout(() => hookSubmits(wc).catch(() => {}), 900);
    wc.on('did-finish-load', rehook);
    wc.on('did-frame-finish-load', rehook);
    wc.on('did-navigate-in-page', rehook);
  }
  if (reqId && waiters.has(reqId)) { waiters.get(reqId)(tabId); waiters.delete(reqId); }
}
function setActive(tabId) { activeTab = tabId; }
function closed(tabId) { tabs.delete(tabId); if (activeTab === tabId) activeTab = [...tabs.keys()].pop() || null; }

function current() {
  const t = activeTab && tabs.get(activeTab);
  const wc = t && webContents.fromId(t.wcId);
  if (!wc || wc.isDestroyed()) return null;
  return { tabId: activeTab, tab: t, wc };
}
function need() {
  const c = current();
  if (!c) throw new Error('No browser tab is open. Use onward_browser_open first.');
  return c;
}

async function newTab(url) {
  const reqId = 'r' + Date.now() + Math.random().toString(36).slice(2, 6);
  const p = new Promise((resolve, reject) => {
    waiters.set(reqId, resolve);
    setTimeout(() => { if (waiters.has(reqId)) { waiters.delete(reqId); reject(new Error('The browser tab did not open')); } }, 15000);
  });
  send('browser:new-tab', { url, reqId });
  const tabId = await p;
  activeTab = tabId;
  return current();
}

async function settle(wc, max = 15000) {
  const t0 = Date.now();
  await sleep(300);
  while (Date.now() - t0 < max) {
    if (!wc.isLoading()) { await sleep(700); if (!wc.isLoading()) return; }
    await sleep(200);
  }
}

async function open(url, { newTab: nt, jobId } = {}) {
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  await ensureUi();
  send('ui:view', 'browser');
  let c = current();
  if (!c || nt) c = await newTab(url);
  let loadError = null;
  if (c.wc.getURL() !== url) { try { await c.wc.loadURL(url); } catch (e) { if (!/ERR_ABORTED/.test(e.message)) loadError = e.message; } }
  if (jobId) { c.tab.jobId = jobId; send('browser:linked', { tabId: c.tabId, jobId }); }
  await settle(c.wc);
  return { ...c, loadError };
}

function linkTab(tabId, jobId) { const t = tabs.get(tabId); if (t) t.jobId = jobId || null; }
function linkJob(jobId, fromUi) {
  const c = current();
  if (!c) return;
  c.tab.jobId = jobId || null;
  if (!fromUi && jobId) send('browser:linked', { tabId: c.tabId, jobId });
}

// ---------- frames & refs ----------
function frames(wc) {
  try { return wc.mainFrame.framesInSubtree.filter(f => f && !f.isDestroyed?.() && f.url && !/^(about:|chrome-error:|data:)/.test(f.url)).slice(0, 15); }
  catch { return [wc.mainFrame]; }
}
function withTimeout(p, ms) { return Promise.race([p, sleep(ms).then(() => { throw new Error('timeout'); })]); }

function parseRef(ref) {
  const m = String(ref || '').trim().match(/^(?:f(\d+):)?(e\d+)$/);
  if (!m) throw new Error(`"${ref}" isn't a ref. Use a ref like "e12" from onward_browser_read.`);
  return { frameId: m[1] ? Number(m[1]) : null, ref: m[2] };
}
function frameFor(wc, frameId) {
  if (frameId === null) return wc.mainFrame;
  const f = frames(wc).find(x => x.frameTreeNodeId === frameId);
  if (!f) throw new Error('That embedded form is gone — read the page again.');
  return f;
}
// Embedded-form refs are only trusted while that frame still shows what was read
const lastRead = new Map(); // wcId -> Map(frameTreeNodeId -> url)
function checkFrame(wc, frameId, f) {
  if (frameId === null) return;
  const seen = lastRead.get(wc.id);
  if (!seen || !seen.has(frameId) || seen.get(frameId) !== f.url) throw new Error('That embedded form has changed since it was read — call onward_browser_read again and use the new refs.');
}
async function inFrame(wc, ref, fn, ...args) {
  const { frameId, ref: r } = parseRef(ref);
  const f = frameFor(wc, frameId);
  checkFrame(wc, frameId, f);
  return withTimeout(f.executeJavaScript(K.call(fn, r, ...args), true), 8000);
}

// ---------- tools ----------
async function read({ include, text = true, maxText = 12000 } = {}) {
  const { wc } = need();
  await settle(wc, 6000);
  const main = wc.mainFrame;
  const parts = [];
  const seen = new Map();
  lastRead.set(wc.id, seen);
  for (const f of frames(wc)) {
    const isMain = f === main || f.frameTreeNodeId === main.frameTreeNodeId;
    try {
      const r = await withTimeout(f.executeJavaScript(K.call(K.readPage, { include: include || ['fields', 'buttons'], text: text !== false, maxText: isMain ? maxText : 6000 })), 4000);
      if (!isMain) seen.set(f.frameTreeNodeId, f.url);
      if (!isMain && !r.elements.length) continue;
      parts.push({ isMain, prefix: isMain ? '' : `f${f.frameTreeNodeId}:`, r });
    } catch { /* cross-process frame still loading or ad frame — skip */ }
  }
  return format(parts, wc);
}

function format(parts, wc) {
  const main = parts.find(p => p.isMain)?.r || { url: wc.getURL(), title: wc.getTitle(), text: '', elements: [], errors: [] };
  const lines = [`URL: ${main.url}`, `Title: ${main.title}`];
  if (main.scroll) lines.push(`Scroll: ${main.scroll.y}/${Math.max(0, main.scroll.height - main.scroll.viewport)}px`);
  const errs = parts.flatMap(p => p.r.errors || []);
  if (errs.length) lines.push('', 'Messages on the page:', ...[...new Set(errs)].map(e => '  ! ' + e));
  for (const p of parts) {
    if (!p.r.elements.length) continue;
    lines.push('', p.isMain ? 'Elements:' : `Elements in embedded form (${hostOf(p.r.url)}):`);
    for (const el of p.r.elements) lines.push('  ' + elLine(el, p.prefix));
  }
  if (main.text) lines.push('', 'Page text:', main.text);
  for (const p of parts) if (!p.isMain && p.r.text) lines.push('', `Text in embedded form (${hostOf(p.r.url)}):`, p.r.text);
  return lines.join('\n');
}
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return u; } };
function elLine(el, px) {
  const q = (s) => JSON.stringify(s || '');
  const req = el.required ? ' *required' : '';
  const bad = el.invalid ? ' (invalid)' : '';
  switch (el.type) {
    case 'radio': return `[${px}${el.ref}] radio ${q(el.label)}${req} options: ${el.options.map(o => `${o.label}${o.checked ? ' (selected)' : ''}`).join(' | ')}`;
    case 'select': return `[${px}${el.ref}] select ${q(el.label)}${req}${bad} = ${q(el.value)} options: ${el.options.slice(0, 40).join(' | ')}${el.options.length > 40 ? ` | …${el.options.length - 40} more` : ''}`;
    case 'checkbox': case 'switch': return `[${px}${el.ref}] checkbox ${q(el.label)}${req} = ${el.checked}`;
    case 'file': return `[${px}${el.ref}] file ${q(el.label)}${req}${el.accept ? ` accepts ${el.accept}` : ''}${el.value ? ` = ${q(el.value)}` : ' (empty)'}`;
    case 'button': return `[${px}${el.ref}] button ${q(el.label)}${el.disabled ? ' (disabled)' : ''}`;
    case 'link': return `[${px}${el.ref}] link ${q(el.label)} → ${el.href}`;
    default: return `[${px}${el.ref}] ${el.type} ${q(el.label)}${req}${bad}${el.value ? ` = ${q(el.value)}` : ''}${el.maxLength ? ` (max ${el.maxLength})` : ''}`;
  }
}

async function fill(fields = []) {
  const { wc } = need();
  // group by frame so each frame gets one call
  const byFrame = new Map();
  for (const f of fields) {
    const { frameId, ref } = parseRef(f.ref);
    if (!byFrame.has(frameId)) byFrame.set(frameId, []);
    byFrame.get(frameId).push({ ref, value: f.value, original: f.ref });
  }
  const results = [];
  for (const [frameId, items] of byFrame) {
    const f = frameFor(wc, frameId);
    checkFrame(wc, frameId, f);
    const res = await withTimeout(f.executeJavaScript(K.call(K.fillFields, items.map(({ ref, value }) => ({ ref, value }))), true), 10000);
    res.forEach((r, i) => results.push({ ...r, ref: items[i].original }));
  }
  await sleep(400);
  return results;
}

async function click(ref, { allowSubmit = false } = {}) {
  const { wc, tab } = need();
  const check = await inFrame(wc, ref, K.looksLikeSubmit);
  if (!check.found) return { ok: false, note: 'not on this page any more — read the page again' };
  if (check.final && !allowSubmit) {
    await inFrame(wc, ref, K.markSubmit);
    send('browser:ready-to-submit', { jobId: tab.jobId, text: check.text });
    return { ok: true, held: true, note: `"${check.text}" looks like the final submit, so Onward highlighted it for the user instead of clicking. Tell the user it's ready for their review and that they should press it themselves; Onward will mark the job as applied when they do.` };
  }
  const before = wc.getURL();
  const r = await inFrame(wc, ref, K.clickRef);
  await settle(wc, 8000);
  return { ...r, navigated: wc.getURL() !== before ? wc.getURL() : undefined };
}

const KEYS = { enter: 'Enter', return: 'Enter', tab: 'Tab', escape: 'Escape', esc: 'Escape', arrowdown: 'Down', down: 'Down', arrowup: 'Up', up: 'Up', backspace: 'Backspace', space: 'Space', arrowleft: 'Left', arrowright: 'Right' };
async function key(name) {
  const { wc, tab } = need();
  const keyCode = KEYS[String(name).toLowerCase()] || name;
  if (keyCode === 'Enter' || keyCode === 'Space') {
    // Pressing Enter/Space must not become a way around the "you press Submit" rule
    for (const f of frames(wc)) {
      let r = null;
      try { r = await withTimeout(f.executeJavaScript(K.call(K.focusedSubmitsFinal)), 3000); } catch {}
      if (r && r.final) {
        if (r.ref) { try { await withTimeout(f.executeJavaScript(K.call(K.markSubmit, r.ref)), 3000); } catch {} }
        send('browser:ready-to-submit', { jobId: tab.jobId, text: r.text });
        return { ok: true, held: true, note: `Pressing ${name} here would submit the application ("${r.text}"), so Onward highlighted the button for the user instead. Ask them to review and press it.` };
      }
    }
  }
  wc.sendInputEvent({ type: 'keyDown', keyCode });
  if (keyCode === 'Enter') wc.sendInputEvent({ type: 'char', keyCode: '\r' });
  wc.sendInputEvent({ type: 'keyUp', keyCode });
  await sleep(350);
  return { ok: true };
}

// Where is an element on screen (webview coordinates)? Walks up through embedded frames.
async function pointFor(wc, ref) {
  const { frameId, ref: r } = parseRef(ref);
  let f = frameFor(wc, frameId);
  checkFrame(wc, frameId, f);
  let pt = await withTimeout(f.executeJavaScript(K.call(function (r) {
    const el = document.querySelector(`[data-onward-ref="${r}"]`);
    if (!el) return null;
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const b = el.getBoundingClientRect();
    return { x: b.left + Math.min(b.width / 2, 40), y: b.top + b.height / 2 };
  }, r)), 4000);
  if (!pt) return null;
  while (f.parent) {
    const childUrl = f.url;
    const parent = f.parent;
    const off = await withTimeout(parent.executeJavaScript(K.call(function (u) {
      const same = (a, b) => { try { const x = new URL(a, location.href), y = new URL(b); return x.origin + x.pathname === y.origin + y.pathname; } catch { return false; } };
      const sameOrigin = (a, b) => { try { return new URL(a, location.href).origin === new URL(b).origin; } catch { return false; } };
      const frames = [...document.querySelectorAll('iframe, frame')];
      const el = frames.find(i => same(i.getAttribute('src') || '', u)) || frames.filter(i => sameOrigin(i.getAttribute('src') || '', u))[0];
      if (!el) return null;
      el.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      const b = el.getBoundingClientRect();
      return { x: b.left + el.clientLeft, y: b.top + el.clientTop };
    }, childUrl)), 4000);
    if (!off) return null;
    pt = { x: pt.x + off.x, y: pt.y + off.y };
    f = parent;
  }
  return { x: Math.round(pt.x), y: Math.round(pt.y) };
}

async function mouseClick(wc, pt) {
  wc.sendInputEvent({ type: 'mouseMove', x: pt.x, y: pt.y });
  wc.sendInputEvent({ type: 'mouseDown', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await sleep(120);
}

async function type(ref, text, thenKey) {
  const { wc } = need();
  const chk = await inFrame(wc, ref, K.looksLikeSubmit);
  if (!chk.found) return { ok: false, note: 'not on this page any more — read the page again' };
  if (chk.final) return { ok: false, note: 'That is the final submit button — the user presses it. Use onward_browser_click on it to highlight it for them.' };
  wc.focus();
  // Clear the field, then give it real focus with a real click (works inside embedded forms too)
  await inFrame(wc, ref, function (r) {
    const el = document.querySelector(`[data-onward-ref="${r}"]`);
    if (!el) return false;
    el.focus();
    if ('value' in el && el.tagName !== 'BUTTON') { const s = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set; s ? s.call(el, '') : (el.value = ''); el.dispatchEvent(new Event('input', { bubbles: true })); }
    else if (el.isContentEditable) document.execCommand('selectAll');
    return true;
  });
  const pt = await pointFor(wc, ref).catch(() => null);
  if (pt) await mouseClick(wc, pt);
  // Real key events go to whichever frame has focus
  for (const ch of String(text)) {
    if (ch === '\n') { wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' }); }
    else wc.sendInputEvent({ type: 'char', keyCode: ch });
    await sleep(18);
  }
  // If real keys didn't reach the field (e.g. window not focused), type with page events instead
  const landed = await inFrame(wc, ref, function (r, t) {
    const el = document.querySelector(`[data-onward-ref="${r}"]`);
    if (!el) return true;
    const v = 'value' in el && el.tagName !== 'BUTTON' ? el.value : el.innerText;
    return String(v || '').includes(t.replace(/\n/g, ''));
  }, String(text));
  if (!landed) await inFrame(wc, ref, K.typeChars, String(text));
  await sleep(600); // let autocomplete menus appear
  if (thenKey) { const k = await key(thenKey); if (k.held) return { ok: true, note: k.note }; }
  return { ok: true };
}

async function upload(ref, file) {
  const { wc } = need();
  return inFrame(wc, ref, K.setFile, file.name, file.mime, file.b64);
}

async function scroll(o = {}) {
  const { wc } = need();
  if (o.ref) return inFrame(wc, o.ref, function (r) { const el = document.querySelector(`[data-onward-ref="${r}"]`); if (!el) return { ok: false }; el.scrollIntoView({ block: 'center' }); return { ok: true }; });
  const r = await wc.mainFrame.executeJavaScript(K.call(K.scrollPage, o));
  await sleep(700);
  return r;
}

async function back() {
  const { wc } = need();
  const nav = wc.navigationHistory;
  if (nav ? nav.canGoBack() : wc.canGoBack()) { nav ? nav.goBack() : wc.goBack(); await settle(wc); return { ok: true, url: wc.getURL() }; }
  return { ok: false, note: 'nothing to go back to' };
}

async function screenshot() {
  const { wc } = need();
  let img = await wc.capturePage();
  const { width } = img.getSize();
  if (width > 1280) img = img.resize({ width: 1280 });
  return img.toJPEG(72).toString('base64');
}

// Structured read for the Apply Guide / autofill: fields per frame, refs prefixed with their frame
async function scan({ tabId } = {}) {
  const c = tabId ? (() => { const t = tabs.get(tabId); const wc = t && webContents.fromId(t.wcId); return wc && !wc.isDestroyed() ? { tabId, tab: t, wc } : null; })() : current();
  if (!c) return null;
  const { wc } = c;
  const main = wc.mainFrame;
  const seen = new Map();
  lastRead.set(wc.id, seen);
  const fields = [], buttons = [], errors = [];
  let title = wc.getTitle(), url = wc.getURL(), heading = '', hasPassword = false, text = '';
  for (const f of frames(wc)) {
    const isMain = f === main || f.frameTreeNodeId === main.frameTreeNodeId;
    try {
      const r = await withTimeout(f.executeJavaScript(K.call(K.readPage, { include: ['fields', 'buttons'], text: true, maxText: 4000, maxElements: 260 })), 4000);
      if (!isMain) seen.set(f.frameTreeNodeId, f.url);
      const px = isMain ? '' : `f${f.frameTreeNodeId}:`;
      for (const el of r.elements) {
        const ref = px + el.ref;
        const opts = el.options?.map(o => typeof o === 'string' ? o : { ...o, ref: px + o.ref });
        if (el.type === 'button' || el.type === 'link' || el.type === 'tab') buttons.push({ ...el, ref });
        else fields.push({ ...el, ref, options: opts, frame: isMain ? '' : hostOf(r.url) });
        if (el.type === 'password') hasPassword = true;
      }
      errors.push(...(r.errors || []));
      if (isMain) { heading = r.heading || ''; text = r.text || ''; }
      else if (!text && r.text) text = r.text;
    } catch { /* frame not ready */ }
  }
  return { tabId: c.tabId, jobId: c.tab.jobId, url, title, heading, fields, buttons, errors: [...new Set(errors)], hasPassword, text };
}

// Watch for the user pressing the final submit; send back what was in the form at that moment
async function hookSubmits(wc) {
  if (!wc || wc.isDestroyed()) return;
  const js = `(function(){ try { window.__onwardRead = window.__onwardRead || ${K.readPage.toString()}; (${K.hookSubmits.toString()})(); } catch (e) {} })()`;
  for (const f of frames(wc)) { try { await withTimeout(f.executeJavaScript(js), 3000); } catch {} }
}

module.exports = { init, register, setActive, closed, current, open, linkJob, linkTab, jobForWc, read, scan, hookSubmits, fill, click, key, type, upload, scroll, back, screenshot, settle };
