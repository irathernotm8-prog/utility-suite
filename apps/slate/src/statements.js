// Slate — statements: every file downloaded in Slate's browser (or dropped in, or picked up
// from ~/Downloads when that's turned on) lands in the Inbox inside the statements folder.
// Filing it moves it to  <Statements>/<Institution>/<Year>/<YYYY-MM> <Account>.<ext>
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, ipcMain, shell, dialog } = require('electron');
const P = require('./parse');

let ctx = null; // { getStore, saveStore, getWin, toast }
const attached = new WeakSet();
const ACCEPT = /\.(pdf|csv|ofx|qfx|qbo|xlsx?|txt)$/i;

const root = () => {
  const s = ctx.getStore();
  const d = s.settings.statementsDir || path.join(app.getPath('documents'), 'Slate', 'Statements');
  try { fs.mkdirSync(path.join(d, 'Inbox'), { recursive: true }); } catch {}
  return d;
};
const inboxDir = () => path.join(root(), 'Inbox');
const list = () => { const s = ctx.getStore(); return (s.statements = s.statements || []); };
const find = (id) => list().find(x => x.id === id);
const send = (ch, data) => { const w = ctx.getWin(); if (w && !w.isDestroyed()) w.webContents.send(ch, data); };
const pub = (x) => ({ ...x, exists: fs.existsSync(x.path) });
const publish = () => send('statements:update', list().map(pub));
const safe = (s) => String(s || '').replace(/[/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();

function uniquePath(dir, name) {
  name = safe(name) || 'statement';
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(name), base = path.basename(name, ext);
  let target = path.join(dir, name), n = 2;
  while (fs.existsSync(target)) target = path.join(dir, `${base} (${n++})${ext}`);
  return target;
}

// Guess which of the user's accounts a statement belongs to
function guessAccount(rec, text = '') {
  const accts = ctx.getStore().accounts || [];
  const inst = (rec.institution || '').toLowerCase();
  const name = rec.name.toLowerCase();
  const body = String(text).slice(0, 6000).toLowerCase();
  // the statement names the account ("Sapphire Preferred", "ending in 1234")
  const pool = accts.filter(a => !inst || !a.institution || a.institution.toLowerCase() === inst);
  const named = pool.find(a => (a.last4 && (body.includes('ending in ' + a.last4) || body.includes('...' + a.last4) || body.includes('xxxx' + a.last4) || name.includes(a.last4))) || (a.name && a.name.length > 4 && body.includes(a.name.toLowerCase())));
  if (named) return named.id;
  const byInst = accts.filter(a => inst && (a.institution || '').toLowerCase() === inst);
  if (byInst.length === 1) return byInst[0].id;
  const last4 = name.match(/(\d{4})(?!.*\d{4})/);
  const hit = accts.find(a => a.last4 && (name.includes(a.last4) || (last4 && last4[1] === a.last4)));
  if (hit) return hit.id;
  const byWord = byInst.find(a => name.includes((a.name || '').toLowerCase().split(' ')[0]));
  return byWord ? byWord.id : (byInst[0]?.id || null);
}

async function analyse(rec) {
  rec.parsing = true; publish();
  const r = await P.parseFile(rec.path, { host: rec.sourceHost });
  rec.parsing = false;
  rec.parsed = r;
  rec.kind = r.kind;
  if (!rec.institution) rec.institution = r.institution || '';
  if (!rec.period) rec.period = r.period || null;
  if (!rec.accountId) rec.accountId = guessAccount(rec, r.text);
  // match every account the statement covers to one of yours (by last 4, then by name)
  for (const a of r.accounts || []) a.match = matchAccount(a, rec.institution) || null;
  if ((r.accounts || []).length === 1 && !r.accounts[0].match && rec.accountId) {
    const g = accountOf(rec.accountId);
    if (g && (!r.accounts[0].last4 || !g.last4 || g.last4 === r.accounts[0].last4)) r.accounts[0].match = g.id;
  }
  if (r.report) rec.kindLabel = 'Credit report';
  ctx.saveStore(); publish();
  return rec;
}

function matchAccount(a, institution) {
  const accts = ctx.getStore().accounts || [];
  const inst = (institution || '').toLowerCase();
  const same = (x) => !inst || !x.institution || x.institution.toLowerCase() === inst;
  if (a.last4) { const m = accts.find(x => x.last4 === a.last4 && same(x)); if (m) return m.id; }
  if (a.name) { const n = a.name.toLowerCase().replace(/^chase |^bank of america |^wells fargo /, ''); const m = accts.find(x => same(x) && !x.last4 && x.name && (x.name.toLowerCase() === a.name.toLowerCase() || x.name.toLowerCase().includes(n))); if (m) return m.id; }
  // a card statement for a card in the wallet with the same last 4
  if (a.last4) { const w = (ctx.getStore().wallet || []).find(x => x.last4 === a.last4 && x.accountId); if (w) return w.accountId; }
  return null;
}

function add(filePath, source = {}) {
  const rec = {
    id: crypto.randomUUID(), name: path.basename(filePath), path: filePath, status: 'inbox',
    addedAt: Date.now(), source: source.kind || 'browser', sourceHost: source.host || '', sourceTitle: source.title || '',
    institution: P.institutionFrom({ host: source.host, name: path.basename(filePath) }), period: null, accountId: null, kind: P.kindOf(filePath)
  };
  list().unshift(rec);
  ctx.saveStore(); publish();
  analyse(rec).catch(() => {});
  return rec;
}

// Copy (not move) a file the user dropped or picked into the Inbox
function importPath(p, kind = 'added') {
  if (!fs.statSync(p).isFile() || !ACCEPT.test(p)) return null;
  const target = uniquePath(inboxDir(), path.basename(p));
  fs.copyFileSync(p, target);
  return add(target, { kind });
}

/* ---------- downloads from the Slate browser ---------- */
function attach(ses) {
  if (attached.has(ses)) return;
  attached.add(ses);
  ses.on('will-download', (_e, item, wc) => {
    const target = uniquePath(inboxDir(), item.getFilename());
    item.setSavePath(target);
    let host = '', title = '';
    try { host = new URL(wc?.getURL() || item.getURL()).hostname; title = wc?.getTitle() || ''; } catch {}
    send('statements:downloading', { name: path.basename(target) });
    item.once('done', (_ev, state) => {
      if (state !== 'completed') { ctx.toast(`Download didn’t finish: ${path.basename(target)}`, 'error'); return; }
      const rec = add(target, { kind: 'browser', host, title });
      ctx.toast(`Saved to your statement inbox: ${rec.name}`);
    });
  });
}

/* ---------- optional: watch ~/Downloads ---------- */
let watcher = null;
const seen = new Set();
function watchDownloads(on) {
  if (watcher) { watcher.close(); watcher = null; }
  if (!on) return;
  const dir = app.getPath('downloads');
  try {
    watcher = fs.watch(dir, (_ev, name) => {
      if (!name || !ACCEPT.test(name) || name.startsWith('.') || /\.(crdownload|download|part)$/i.test(name)) return;
      const p = path.join(dir, name);
      if (seen.has(p)) return;
      // wait for the browser to finish writing
      setTimeout(() => {
        try {
          const st = fs.statSync(p);
          if (!st.isFile() || Date.now() - st.birthtimeMs > 5 * 60 * 1000) return;
          seen.add(p);
          const rec = importPath(p, 'downloads');
          if (rec) ctx.toast(`Copied from Downloads to your statement inbox: ${rec.name}`);
        } catch {}
      }, 1500);
    });
  } catch (e) { ctx.toast('Couldn’t watch your Downloads folder', 'error'); }
}

/* ---------- filing ---------- */
function accountOf(id) { return (ctx.getStore().accounts || []).find(a => a.id === id); }
// allocations: [{ index, accountId, create: { name, type, institution, last4 }, amount, date }]
// Older single-account calls pass accountId + recordBalance instead.
function file(id, { accountId, period, institution, recordBalance, allocations }) {
  const rec = find(id);
  if (!rec) throw new Error('Statement not found');
  const store = ctx.getStore();
  if (!allocations) allocations = [{ index: 0, accountId, amount: recordBalance?.amount, date: recordBalance?.date }];
  rec.period = period || rec.period;
  const parsed = rec.parsed || {};
  const used = [];
  for (const al of allocations) {
    let acc = al.accountId ? accountOf(al.accountId) : null;
    if (!acc && al.create) {
      acc = { id: crypto.randomUUID(), name: al.create.name, institution: al.create.institution || rec.institution || '', type: al.create.type || 'checking', last4: al.create.last4 || '', balances: [] };
      acc.inPlanner = !['checking', 'credit', 'loan', 'mortgage', 'auto-loan', 'student-loan'].includes(acc.type);
      store.accounts.push(acc);
    }
    if (!acc) continue;
    const det = (parsed.accounts || [])[al.index] || {};
    // fill in what the statement tells us
    if (!acc.last4 && det.last4) acc.last4 = det.last4;
    if (!acc.institution && rec.institution) acc.institution = rec.institution;
    if (det.apy != null) acc.apy = det.apy;
    if (det.creditLimit) acc.creditLimit = det.creditLimit;
    if (det.closingDate && !acc.statementDay) acc.statementDay = Math.min(28, Number(det.closingDate.slice(8, 10)) + 1);
    if (al.amount != null && !isNaN(al.amount)) {
      const date = al.date || det.closingDate || parsed.endingDate || `${rec.period}-28`;
      acc.balances = (acc.balances || []).filter(b => b.statementId !== rec.id);
      acc.balances.push({ date, amount: Number(al.amount), source: 'statement', statementId: rec.id });
      acc.balances.sort((a, b) => a.date < b.date ? -1 : 1);
      used.push({ accountId: acc.id, date, amount: Number(al.amount) });
    } else used.push({ accountId: acc.id });
    // card statement with the annual fee on it → that's the card's fee month
    if (parsed.card?.annualFee) {
      for (const w of store.wallet || []) if (w.accountId === acc.id && !w.feeMonth) w.feeMonth = Number((parsed.card.annualFee.md || '').split('/')[0]) || Number(rec.period.slice(5, 7));
    }
  }
  const first = used[0] ? accountOf(used[0].accountId) : null;
  rec.accountId = first?.id || null;
  rec.accountIds = used.map(u => u.accountId);
  rec.recordedAll = used.filter(u => u.amount != null);
  rec.recorded = rec.recordedAll[0] ? { date: rec.recordedAll[0].date, amount: rec.recordedAll[0].amount } : undefined;
  rec.institution = institution || first?.institution || rec.institution || 'Other';
  const year = (rec.period || '').slice(0, 4) || String(new Date().getFullYear());
  const ext = path.extname(rec.name);
  const names = used.map(u => accountOf(u.accountId)?.name).filter(Boolean);
  // "Chase Total Checking + Savings" — drop the bank name the others share
  const shared = names.length > 1 && names.every(n => n.split(' ')[0] === names[0].split(' ')[0]) ? names[0].split(' ')[0] + ' ' : '';
  const label = names.length > 3 ? `${names[0]} + ${names.length - 1} more` : names.length > 1 ? [names[0], ...names.slice(1).map(n => n.slice(shared.length))].join(' + ') : names[0] || path.basename(rec.name, ext);
  const dir = path.join(root(), safe(rec.institution), year);
  if (fs.existsSync(rec.path)) {
    const target = uniquePath(dir, `${rec.period || 'undated'} ${label}${ext}`);
    fs.renameSync(rec.path, target);
    rec.path = target; rec.name = path.basename(target);
  }
  rec.status = 'filed';
  rec.filedAt = Date.now();
  ctx.saveStore(true);
  send('store:accounts', store.accounts);
  send('store:wallet', store.wallet);
  publish();
  return pub(rec);
}

function register(c) {
  ctx = c;
  root();
  ipcMain.handle('statements:list', () => list().map(pub));
  ipcMain.handle('statements:folder', () => root());
  ipcMain.handle('statements:open-folder', () => shell.openPath(root()));
  ipcMain.handle('statements:open', (_e, id) => { const r = find(id); return r ? shell.openPath(r.path) : 'not found'; });
  ipcMain.handle('statements:show', (_e, id) => { const r = find(id); if (r) shell.showItemInFolder(r.path); });
  ipcMain.handle('statements:update', (_e, { id, patch }) => { const r = find(id); if (r) Object.assign(r, patch); ctx.saveStore(); publish(); return r && pub(r); });
  ipcMain.handle('statements:reparse', async (_e, id) => { const r = find(id); if (r) await analyse(r); return r && pub(r); });
  ipcMain.handle('statements:file', (_e, { id, ...opts }) => file(id, opts));
  ipcMain.handle('statements:unfile', (_e, id) => {
    const r = find(id);
    if (!r) return null;
    if (fs.existsSync(r.path)) { const t = uniquePath(inboxDir(), r.name); fs.renameSync(r.path, t); r.path = t; r.name = path.basename(t); }
    r.status = 'inbox';
    for (const a of ctx.getStore().accounts || []) a.balances = (a.balances || []).filter(b => b.statementId !== r.id);
    delete r.recorded; delete r.recordedAll;
    ctx.saveStore(); publish(); send('store:accounts', ctx.getStore().accounts);
    return pub(r);
  });
  ipcMain.handle('statements:trash', async (_e, id) => {
    const r = find(id);
    if (r && fs.existsSync(r.path)) await shell.trashItem(r.path).catch(() => {});
    const s = ctx.getStore();
    s.statements = list().filter(x => x.id !== id);
    for (const a of s.accounts || []) a.balances = (a.balances || []).filter(b => b.statementId !== id);
    ctx.saveStore(); publish(); send('store:accounts', s.accounts);
    return true;
  });
  ipcMain.handle('statements:import-paths', (_e, paths) => (paths || []).map(p => { try { return importPath(p); } catch { return null; } }).filter(Boolean).length);
  ipcMain.handle('statements:pick', async () => {
    const r = await dialog.showOpenDialog(ctx.getWin(), { title: 'Add statements to Slate', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Statements', extensions: ['pdf', 'csv', 'ofx', 'qfx', 'qbo', 'xlsx', 'xls'] }] });
    if (r.canceled) return 0;
    return r.filePaths.map(p => importPath(p)).filter(Boolean).length;
  });
  ipcMain.handle('statements:choose-folder', async () => {
    const r = await dialog.showOpenDialog(ctx.getWin(), { title: 'Choose where Slate keeps statements', properties: ['openDirectory', 'createDirectory'], defaultPath: root() });
    if (r.canceled || !r.filePaths[0]) return null;
    ctx.getStore().settings.statementsDir = r.filePaths[0];
    ctx.saveStore();
    root();
    return r.filePaths[0];
  });
  ipcMain.handle('statements:watch-downloads', (_e, on) => { ctx.getStore().settings.watchDownloads = !!on; ctx.saveStore(); watchDownloads(!!on); return !!on; });
  watchDownloads(!!ctx.getStore().settings.watchDownloads);
  // finish reading anything that was still waiting when Slate last closed
  for (const r of list()) { if (r.status === 'inbox' && (!r.parsed || r.parsing) && fs.existsSync(r.path)) analyse(r).catch(() => {}); }
}

module.exports = { register, attach, add, importPath, root };
