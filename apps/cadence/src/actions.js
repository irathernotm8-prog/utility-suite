// Cadence — the actions shared by the Browser step and the Use an app step. A "driver" knows how to talk to one
// window (Cadence's own hidden browser, or another app's window over its debugging port); the actions here
// (click, type, choose, wait, download, copy tables and cards, screenshots…) are the same for both.
// Keyboard/menu/clipboard actions go through native.js and work with any app.
'use strict';
const fs = require('fs');
const path = require('path');
const { fromMatrix, parseCSV } = require('./core/table');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => JSON.stringify(String(s ?? ''));

// Injected into pages: finds elements by CSS, text=, label=, placeholder=, xpath=, and reads tables and cards.
const HELPER = `(() => { if (window.__cadence && window.__cadence.v === 3) return true;
  const vis = (el) => { if (!el || !el.getBoundingClientRect) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity !== 0; };
  const clickable = 'a,button,[role=button],[role=link],[role=menuitem],[role=tab],[role=option],input[type=submit],input[type=button],label,summary,[onclick]';
  const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  function byText(t) {
    const want = norm(t); const all = [...document.querySelectorAll('body *')].filter((e) => !['SCRIPT','STYLE','NOSCRIPT','HEAD','TITLE','svg','path'].includes(e.tagName) && vis(e));
    const txt = (e) => norm(e.innerText || e.value || e.getAttribute('aria-label') || e.title || '');
    let hits = all.filter((e) => txt(e) === want); if (!hits.length) hits = all.filter((e) => txt(e).includes(want));
    hits = hits.filter((e) => !hits.some((o) => o !== e && e.contains(o)));
    hits.sort((a, b) => (txt(a) === want ? 0 : 1) - (txt(b) === want ? 0 : 1) || txt(a).length - txt(b).length);
    return hits.map((e) => e.closest(clickable) || e);
  }
  function byLabel(t) {
    const want = norm(t); const out = [];
    for (const l of document.querySelectorAll('label')) if (norm(l.innerText).includes(want)) { const c = l.control || l.querySelector('input,select,textarea'); if (c) out.push(c); }
    for (const e of document.querySelectorAll('input,select,textarea,[contenteditable=true]')) { const a = norm(e.getAttribute('aria-label') || e.getAttribute('name') || ''); if (a && a.includes(want)) out.push(e); const id = e.getAttribute('aria-labelledby'); if (id) { const lb = document.getElementById(id); if (lb && norm(lb.innerText).includes(want)) out.push(e); } }
    return out.filter(vis);
  }
  function find(target, all) {
    const t = String(target || '').trim(); let list = [];
    try {
      if (/^text=/i.test(t)) list = byText(t.slice(5));
      else if (/^label=/i.test(t)) list = byLabel(t.slice(6));
      else if (/^placeholder=/i.test(t)) { const w = norm(t.slice(12)); list = [...document.querySelectorAll('[placeholder]')].filter((e) => norm(e.placeholder).includes(w)); }
      else if (/^xpath=/i.test(t)) { const r = document.evaluate(t.slice(6), document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null); for (let i = 0; i < r.snapshotLength; i++) list.push(r.snapshotItem(i)); }
      else list = [...document.querySelectorAll(t)];
    } catch (e) { throw new Error('Bad target ' + t + ': ' + e.message); }
    const v = list.filter(vis); const pick = v.length ? v : list;
    return all ? pick : pick[0] || null;
  }
  function rect(target) { const e = find(target); if (!e) return null; e.scrollIntoView({ block: 'center', inline: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, tag: e.tagName, href: e.href || e.getAttribute('href') || null }; }
  function hit(target, x, y) { const e = find(target); const at = document.elementFromPoint(x, y); return !!(e && at && (e === at || e.contains(at) || at.contains(e))); }
  // cell text: child pieces joined with spaces, so "Spring sale<span>demo</span>" reads "Spring sale demo"
  const cellText = (c) => { const parts = []; const walk = (n) => { for (const k of n.childNodes) { if (k.nodeType === 3) { const t = k.textContent.replace(/\\s+/g, ' ').trim(); if (t) parts.push(t); } else if (k.nodeType === 1 && !['SCRIPT','STYLE','svg'].includes(k.tagName) && getComputedStyle(k).display !== 'none') walk(k); } }; walk(c); return parts.join(' ').trim(); };
  function table(target) {
    const root = target ? find(target) : document.querySelector('table') || document.querySelector('[role=grid],[role=table]');
    if (!root) return null; const el = root.tagName === 'TABLE' || root.getAttribute('role') ? root : root.querySelector('table,[role=grid],[role=table]') || root;
    let rows;
    if (el.tagName === 'TABLE') rows = [...el.rows].map((r) => [...r.cells].flatMap((c) => Array(Math.min(20, c.colSpan || 1)).fill(0).map((_, i) => (i ? '' : cellText(c)))));
    else rows = [...el.querySelectorAll('[role=row]')].map((r) => [...r.querySelectorAll('[role=columnheader],[role=cell],[role=gridcell],[role=rowheader]')].map(cellText));
    return rows.filter((r) => r.some((x) => x));
  }
  // repeated cards → rows: fields "Label=.l, Value=.v"; blank fields = each card's text lines
  function list(target, fields) {
    const items = find(target, true); if (!items.length) return null;
    const spec = String(fields || '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => { const i = s.indexOf('='); return i > 0 ? [s.slice(0, i).trim(), s.slice(i + 1).trim()] : [s, s]; });
    if (!spec.length) return [['Text'], ...items.map((e) => [cellText(e)])];
    return [spec.map((s) => s[0]), ...items.map((e) => spec.map(([, sel]) => { const k = e.querySelector(sel); return k ? cellText(k) : ''; }))];
  }
  function text(target, all) { if (all) return find(target, true).map((e) => (e.innerText || e.value || '').trim()); const e = find(target); return e ? (e.innerText || e.value || '').trim() : null; }
  function focus(target) { const e = find(target); if (!e) return false; e.scrollIntoView({ block: 'center' }); e.focus(); if (e.select && /^(INPUT|TEXTAREA)$/.test(e.tagName)) e.select(); else if (e.isContentEditable) { const r = document.createRange(); r.selectNodeContents(e); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } return true; }
  function setValue(target, v) { const e = find(target); if (!e) return false; if (e.tagName === 'SELECT') { const o = [...e.options].find((o) => o.value === v || norm(o.text) === norm(v)) || [...e.options].find((o) => norm(o.text).includes(norm(v))); if (!o) throw new Error('No option ' + v + ' (options: ' + [...e.options].map((o) => o.text.trim()).join(', ') + ')'); e.value = o.value; } else { const p = Object.getPrototypeOf(e); const d = Object.getOwnPropertyDescriptor(p, 'value'); d && d.set ? d.set.call(e, v) : (e.value = v); } e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; }
  window.__cadence = { v: 3, find, rect, hit, table, list, text, focus, setValue, click: (t) => { const e = find(t); if (!e) return false; e.click(); return true; } };
  return true; })()`;

const PAGE_ACTIONS = new Set(['goto', 'click', 'type', 'select', 'press', 'waitFor', 'waitText', 'download', 'downloadUrl', 'extractTable', 'extractList', 'extractText', 'screenshot', 'pdf', 'scroll', 'script', 'ifExists']);
const NATIVE_ACTIONS = new Set(['shortcut', 'keys', 'menu', 'clipboard', 'appScript', 'focus', 'openFile']);

function uniq(p) { let d = p; for (let i = 2; fs.existsSync(d); i++) d = path.join(path.dirname(p), `${path.basename(p, path.extname(p))} (${i})${path.extname(p)}`); return d; }
function addExt(name, from) { return path.extname(name) ? name : name + path.extname(from); }
function withTimeout(p, secs, msg) { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), secs * 1000); })]).finally(() => clearTimeout(t)); }

// driver: { js(code), mouseClick(x, y), insertText(s), key(name), goto(url), isLoading(), url(), expectDownload(dir, saveAs, secs),
//           downloadURL(url), capture(rect) → Buffer, pdf() → Buffer, alive(), where }   (page actions)
// native: { shortcut, keys, menu, clipboard, script, focus, openFile }                       (native actions; optional)
async function runActions({ driver, native, actions, x, out, deadline, hint = '' }) {
  const left = () => Math.max(1, (deadline - Date.now()) / 1000);
  const need = (what) => { if (!driver) throw new Error(`“${what}” reads and clicks inside the window, so pick “Read and click inside it” for this app (it works with apps built on Electron or Chromium, like the Utility Suite apps).`); };
  const js = async (code) => { need('this action'); if (!driver.alive()) throw new Error('The window closed'); await driver.js(HELPER); return driver.js(code); };
  const settle = async (ms = 400) => { await sleep(ms); const t0 = Date.now(); while (driver.alive() && (await driver.isLoading()) && Date.now() - t0 < Math.min(30000, left() * 1000)) await sleep(150); await sleep(150); };
  const waitFor = async (target, secs = 15) => {
    const t0 = Date.now();
    while (Date.now() - t0 < Math.min(secs, left()) * 1000) {
      if (x.signal.aborted || !driver.alive()) throw new Error('Cancelled');
      try { if (await js(`!!window.__cadence.find(${q(target)})`)) return true; } catch (e) { if (/Bad target/.test(e.message)) throw e; }
      await sleep(300);
    }
    const where = await driver.url();
    throw new Error(`Couldn’t find “${target}”${where ? ` on ${where}` : ''}${looksLikeLogin(where) && hint ? ` — ${hint}` : ''}`);
  };
  const click = async (target) => {
    await waitFor(target);
    await js(`window.__cadence.rect(${q(target)})`); await sleep(120);
    const r = await js(`window.__cadence.rect(${q(target)})`);
    if (r && (await js(`window.__cadence.hit(${q(target)}, ${r.x}, ${r.y})`))) await driver.mouseClick(Math.round(r.x), Math.round(r.y));
    else await js(`window.__cadence.click(${q(target)})`);
  };
  const actionsList = Array.isArray(actions) ? actions : [];
  for (let i = 0; i < actionsList.length; i++) {
    if (x.signal.aborted) throw new Error('Cancelled');
    const a = x.render(actionsList[i]);
    if (!a || a.off) continue;
    const label = `${i + 1}. ${a.do}${a.target ? ' ' + a.target : a.url ? ' ' + a.url : a.keys ? ' ' + a.keys : a.menu ? ' ' + a.menu : ''}`;
    try {
      if (PAGE_ACTIONS.has(a.do)) need(a.do);
      switch (a.do) {
        case 'goto': await withTimeout(driver.goto(String(a.url)), left(), 'The page took too long to load'); await settle(500); break;
        case 'click': await click(a.target); await settle(); break;
        case 'type': {
          await waitFor(a.target);
          if (!(await js(`window.__cadence.focus(${q(a.target)})`))) throw new Error('Couldn’t focus it');
          const val = String(a.value ?? '');
          await driver.key('Backspace'); await sleep(40);
          if (val) await driver.insertText(val);
          await sleep(80);
          const got = await js(`(() => { const e = window.__cadence.find(${q(a.target)}); return e ? (e.value ?? e.innerText) : null; })()`);
          if (got != null && got !== val && !/password/i.test(String(a.target))) await js(`window.__cadence.setValue(${q(a.target)}, ${q(val)})`);
          break;
        }
        case 'select': await waitFor(a.target); await js(`window.__cadence.setValue(${q(a.target)}, ${q(a.value)})`); await settle(300); break;
        case 'press': await driver.key(a.key || 'Enter'); await settle(); break;
        case 'waitFor': await waitFor(a.target, Number(a.timeout) || 30); break;
        case 'waitText': { const t0 = Date.now(); const lim = Math.min(Number(a.timeout) || 30, left()); while (!(await js(`!!document.body && document.body.innerText.toLowerCase().includes(${q(String(a.value).toLowerCase())})`))) { if (Date.now() - t0 > lim * 1000) throw new Error(`The text “${a.value}” never appeared`); await sleep(400); } break; }
        case 'wait': await sleep(Math.min(600, Number(a.seconds) || 1) * 1000); break;
        case 'download': {
          const p = driver.expectDownload(x.dir, a.saveAs, Math.min(Number(a.timeout) || 60, left()));
          await click(a.target);
          const file = await withTimeout(p, left(), 'The download didn’t finish in time');
          out.files.push(file); x.log(`Downloaded ${path.basename(file)}`); break;
        }
        case 'downloadUrl': {
          await waitFor(a.target);
          const href = await js(`(() => { const e = window.__cadence.find(${q(a.target)}); return e && (e.href || e.src || e.getAttribute('href')); })()`);
          if (!href) throw new Error('That element has no link address');
          const p = driver.expectDownload(x.dir, a.saveAs, Math.min(60, left()));
          await driver.downloadURL(new URL(href, await driver.url()).href);
          const file = await withTimeout(p, left(), 'The download didn’t finish in time');
          out.files.push(file); x.log(`Downloaded ${path.basename(file)}`); break;
        }
        case 'extractTable': {
          if (a.target) await waitFor(a.target);
          const m = await js(`window.__cadence.table(${a.target ? q(a.target) : 'null'})`);
          if (!m || !m.length) throw new Error('No table found');
          keepTable(out, a.name || `table${Object.keys(out.tables).length + 1}`, fromMatrix(m, { header: true, types: true }), x); break;
        }
        case 'extractList': {
          await waitFor(a.target);
          const m = await js(`window.__cadence.list(${q(a.target)}, ${q(a.fields || '')})`);
          if (!m || m.length < 2) throw new Error('Nothing matched');
          keepTable(out, a.name || `list${Object.keys(out.tables).length + 1}`, fromMatrix(m, { header: true, types: true }), x); break;
        }
        case 'extractText': {
          await waitFor(a.target);
          const v = await js(`window.__cadence.text(${q(a.target)}, ${a.all ? 'true' : 'false'})`);
          out.text[a.name || `text${Object.keys(out.text).length + 1}`] = v; x.log(`Copied text: ${String(Array.isArray(v) ? v.join(' | ') : v).slice(0, 120)}`); break;
        }
        case 'screenshot': {
          let rect;
          if (a.target) { await waitFor(a.target); rect = await js(`(() => { const e = window.__cadence.find(${q(a.target)}); e.scrollIntoView({block:'center'}); const b = e.getBoundingClientRect(); return { x: Math.max(0, Math.floor(b.left)), y: Math.max(0, Math.floor(b.top)), width: Math.ceil(b.width), height: Math.ceil(b.height) }; })()`); await sleep(250); }
          const png = await driver.capture(rect);
          const f = uniq(path.join(x.dir, addExt(a.saveAs || `screenshot-${i + 1}`, 'x.png'))); fs.writeFileSync(f, png); out.files.push(f); out.images = [...(out.images || []), f]; x.log(`Screenshot ${path.basename(f)}`); break;
        }
        case 'pdf': { const buf = await driver.pdf(); const f = uniq(path.join(x.dir, addExt(a.saveAs || 'page', 'x.pdf'))); fs.writeFileSync(f, buf); out.files.push(f); x.log(`Saved ${path.basename(f)}`); break; }
        case 'scroll': await waitFor(a.target); await js(`window.__cadence.find(${q(a.target)}).scrollIntoView({block:'center'})`); await sleep(400); break;
        case 'script': { const v = await js(String(a.code || '')); const name = a.name || `script${i + 1}`; out.text[name] = v; if (Array.isArray(v) && v.length && typeof v[0] === 'object') keepTable(out, name, require('./core/table').fromObjects(v), x); x.log(`Script returned ${String(JSON.stringify(v)).slice(0, 140)}`); break; }
        case 'ifExists': { const there = await js(`!!window.__cadence.find(${q(a.target)})`); if (!there) { const n = Math.max(1, Number(a.count) || 1); x.log(`Not there, skipping the next ${n}`); i += n; } break; }
        // ───── any app
        case 'shortcut': case 'keys': case 'menu': case 'focus': case 'appScript': case 'clipboard': case 'openFile': {
          if (!native) throw new Error(`“${a.do}” only works in a Use an app step`);
          if (a.do === 'shortcut') { await native.shortcut(String(a.keys || '')); await sleep(Number(a.wait) > 0 ? Number(a.wait) * 1000 : 500); }
          else if (a.do === 'keys') { await native.typeText(String(a.value ?? '')); await sleep(200); }
          else if (a.do === 'menu') { await native.menu(String(a.menu || '')); await sleep(Number(a.wait) > 0 ? Number(a.wait) * 1000 : 700); }
          else if (a.do === 'focus') { await native.focus(); await sleep(300); }
          else if (a.do === 'openFile') { await native.openFile(x.resolvePath(String(a.value || ''))); await sleep(1500); }
          else if (a.do === 'appScript') { const v = await native.script(String(a.code || '')); out.text[a.name || `script${i + 1}`] = v; x.log(`Script said: ${String(v).slice(0, 140)}`); }
          else if (a.do === 'clipboard') {
            const t = native.readClipboard(); const name = a.name || `clipboard${i + 1}`;
            out.text[name] = t;
            if (/\t/.test(t) || (t.split('\n').length > 1 && /,/.test(t))) { try { const tb = parseCSV(t, { delimiter: /\t/.test(t) ? '\t' : ',' }); if (tb.rows.length) keepTable(out, name, tb, x); } catch {} }
            x.log(`Clipboard: ${t.length} characters`);
          }
          break;
        }
        default: throw new Error(`Unknown action “${a.do}”`);
      }
    } catch (e) { throw new Error(`Action ${label}: ${e.message}`); }
    x.log(`✓ ${label}`);
  }
  return out;
}
function keepTable(out, name, t, x) {
  out.tables[name] = t; if (!out.table) out.table = t;
  // label/value cards (KPI tiles) also become name → value, e.g. {{steps.lumen.values.kpis.Spend}}
  if (t.columns.length >= 2 && t.rows.length && t.rows.length <= 200) { out.values = out.values || {}; out.values[name] = Object.fromEntries(t.rows.map((r) => [String(r[t.columns[0]]), r[t.columns[1]]])); } x.log(`Copied “${name}”: ${t.rows.length} rows × ${t.columns.length} columns`); }
function looksLikeLogin(u) { return /log-?in|sign-?in|auth|sso|account\/|oauth|saml/i.test(String(u || '')); }

module.exports = { runActions, HELPER, PAGE_ACTIONS, NATIVE_ACTIONS, withTimeout, sleep, uniq, addExt };
