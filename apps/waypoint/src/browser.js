'use strict';
// Waypoint — the booking browser: Google Flights, Kayak, Booking.com, Airbnb, airline and hotel sites
// open inside Waypoint with your search filled in. Sign-ins stick (its own saved session). When you
// reach a confirmation page, "Save to trip" saves the page as a PDF in the trip's Documents and opens a
// booking already filled in with the reference, total and dates it found.
const { BaseWindow, WebContentsView, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { looksConfirmed, readConfirmation } = require('./core/capture');

const BAR = 56;
let win = null, bar = null, view = null, ctx = null, hooks = null, checkTimer = null, state = {};

function open(url, context, h) {
  hooks = h; ctx = context;
  if (win && !win.isDestroyed()) { view.webContents.loadURL(url); win.show(); win.focus(); push(); return; }
  win = new BaseWindow({ width: 1280, height: 880, minWidth: 760, minHeight: 520, title: 'Waypoint — booking', backgroundColor: h.dark() ? '#0d0c12' : '#f7f4f0',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden', trafficLightPosition: { x: 16, y: 20 },
    titleBarOverlay: process.platform === 'darwin' ? undefined : { color: '#00000000', symbolColor: h.dark() ? '#efeae3' : '#2a241e', height: BAR }, icon: h.icon });
  bar = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'browser-preload.js'), contextIsolation: true, sandbox: false } });
  const ses = session.fromPartition('persist:waypoint-web');
  view = new WebContentsView({ webPreferences: { session: ses, contextIsolation: true, sandbox: true } });
  // look like an ordinary browser: some booking sites turn away anything that says "Electron"
  view.webContents.setUserAgent(view.webContents.getUserAgent().replace(/\s(Electron|waypoint|Waypoint)\/\S+/g, ''));
  win.contentView.addChildView(view); win.contentView.addChildView(bar);
  const layout = () => { const [w, hgt] = win.getContentSize(); bar.setBounds({ x: 0, y: 0, width: w, height: BAR }); view.setBounds({ x: 0, y: BAR, width: w, height: Math.max(0, hgt - BAR) }); };
  win.on('resize', layout); layout();
  bar.webContents.loadFile(path.join(__dirname, 'renderer', 'browser.html'));
  const wc = view.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'allow', overrideBrowserWindowOptions: { width: 600, height: 760, webPreferences: { session: ses, sandbox: true } } }));
  for (const ev of ['did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading', 'page-title-updated']) wc.on(ev, () => { push(); scheduleCheck(); });
  wc.on('did-fail-load', (_e, code, desc, u, main) => { if (main && code !== -3) { state.error = desc; push(); } });
  win.on('closed', () => { win = null; bar = null; view = null; });
  wc.loadURL(url);
}

function scheduleCheck() {
  clearTimeout(checkTimer);
  checkTimer = setTimeout(async () => {
    if (!view) return;
    try { const txt = await view.webContents.executeJavaScript('document.body ? document.body.innerText.slice(0, 60000) : ""', true); state.confirmed = looksConfirmed(txt); push(); } catch {}
  }, 900);
}
function push() {
  if (!bar || bar.webContents.isDestroyed() || !view) return;
  const wc = view.webContents;
  state = { ...state, url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading(), back: wc.navigationHistory.canGoBack(), forward: wc.navigationHistory.canGoForward(),
    trip: ctx && ctx.tripName, kind: ctx && ctx.kind, sites: ctx && ctx.sites, site: ctx && ctx.site, dark: hooks.dark(), platform: process.platform };
  if (!state.loading) delete state.error;
  bar.webContents.send('state', state);
}

async function command(cmd, arg) {
  if (!view) return null;
  const wc = view.webContents;
  switch (cmd) {
    case 'ready': push(); return true;
    case 'back': if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); return true;
    case 'forward': if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); return true;
    case 'reload': wc.reload(); return true;
    case 'site': { const u = hooks.siteUrl(ctx.kind, arg, ctx.q); ctx.site = arg; wc.loadURL(u.url); return true; }
    case 'external': shell.openExternal(wc.getURL()); return true;
    case 'save': return save();
  }
  return null;
}

async function save() {
  const wc = view.webContents;
  const url = wc.getURL(), title = wc.getTitle();
  const text = await wc.executeJavaScript('document.body ? document.body.innerText.slice(0, 200000) : ""', true).catch(() => '');
  const guess = readConfirmation(text, url, title);
  let host = ''; try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
  const pdf = await wc.printToPDF({ printBackground: true, pageSize: 'Letter' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waypoint-cap-'));
  const name = `${(guess.provider || host || 'Booking').replace(/[\\/:*?"<>|]/g, '-')} confirmation${guess.ref ? ' ' + guess.ref : ''}.pdf`;
  const f = path.join(dir, name);
  fs.writeFileSync(f, pdf);
  try {
    const r = await hooks.saved({ tripId: ctx.tripId, file: f, guess, url, kind: ctx.kind, q: ctx.q });
    state.savedAt = Date.now(); push();
    return r;
  } finally { fs.rm(dir, { recursive: true, force: true }, () => {}); }
}

module.exports = { open, command, isOpen: () => !!win, close: () => { if (win) win.close(); } };
