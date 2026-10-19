// Datum - main process
const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const { pathToFileURL } = require('url');
const formats = require('./lib/formats');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } }
]);

// the optional offline assistant runs on the graphics chip (WebGPU); Linux needs it switched on
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-unsafe-webgpu');

const ROOT = __dirname;
let win = null;
const userData = () => app.getPath('userData');
const recentFile = () => path.join(userData(), 'recent.json');
const recoveryFile = () => path.join(userData(), 'recovery.datum');

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#070B16',
    title: 'Datum',
    icon: path.join(ROOT, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true
    }
  });
  Menu.setApplicationMenu(null);
  win.loadURL('app://datum/renderer/index.html');
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('close', (e) => {
    if (win.__forceClose) return;
    e.preventDefault();
    win.webContents.send('app:before-close');
  });
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    const abs = path.normalize(path.join(ROOT, rel));
    if (!abs.startsWith(ROOT)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(abs).toString());
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ---------- helpers ----------
async function readRecent() {
  try { return JSON.parse(await fsp.readFile(recentFile(), 'utf8')); } catch { return []; }
}
async function pushRecent(dir, name) {
  let list = (await readRecent()).filter((r) => r.path !== dir);
  list.unshift({ path: dir, name, openedAt: Date.now() });
  list = list.slice(0, 12);
  await fsp.mkdir(userData(), { recursive: true });
  await fsp.writeFile(recentFile(), JSON.stringify(list, null, 2));
}
function safeName(s) {
  return String(s || 'Untitled').replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';
}

// Render HTML to PDF in an offscreen window
async function htmlToPdf(html, opts = {}) {
  const tmp = path.join(os.tmpdir(), `datum-print-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  await fsp.writeFile(tmp, html, 'utf8');
  const pw = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    await pw.loadFile(tmp);
    await pw.webContents.executeJavaScript('document.fonts ? document.fonts.ready.then(() => true) : true').catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
    return await pw.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      margins: { marginType: 'none' },
      ...opts
    });
  } finally {
    pw.destroy();
    fsp.unlink(tmp).catch(() => {});
  }
}

async function htmlToPng(html, w, h) {
  const tmp = path.join(os.tmpdir(), `datum-png-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  await fsp.writeFile(tmp, html, 'utf8');
  const pw = new BrowserWindow({ show: false, width: Math.round(w), height: Math.round(h), useContentSize: true, webPreferences: { offscreen: true } });
  try {
    await pw.loadFile(tmp);
    await new Promise((r) => setTimeout(r, 300));
    const img = await pw.webContents.capturePage({ x: 0, y: 0, width: Math.round(w), height: Math.round(h) });
    return img.toDataURL();
  } finally {
    pw.destroy();
    fsp.unlink(tmp).catch(() => {});
  }
}

// ---------- IPC ----------
ipcMain.handle('render:png', (_e, { html, w, h }) => htmlToPng(html, w, h));
ipcMain.handle('app:close-confirmed', () => { win.__forceClose = true; win.close(); });
ipcMain.handle('app:recent', async () => {
  const list = await readRecent();
  return list.filter((r) => fs.existsSync(r.path));
});
ipcMain.handle('app:recovery-read', async () => {
  try { return await fsp.readFile(recoveryFile(), 'utf8'); } catch { return null; }
});
ipcMain.handle('app:recovery-write', async (_e, json) => {
  await fsp.mkdir(userData(), { recursive: true });
  if (json == null) { await fsp.unlink(recoveryFile()).catch(() => {}); return true; }
  await writeAtomic(recoveryFile(), json, 'utf8');
  return true;
});
ipcMain.handle('app:reveal', (_e, p) => shell.showItemInFolder(p));

ipcMain.handle('dialog:open-files', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Open files as sheets',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Supported files', extensions: ['xlsx', 'csv', 'tsv', 'pptx', 'docx', 'pdf', 'txt', 'md', 'png', 'jpg', 'jpeg', 'gif', 'webp'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  return r.canceled ? [] : r.filePaths;
});
// Data sets: pick spreadsheets, or list every spreadsheet in a folder
const DATA_EXT = /\.(xlsx|xlsm|csv|tsv)$/i;
ipcMain.handle('dialog:open-data', async (_e, mode) => {
  const r = await dialog.showOpenDialog(win, mode === 'folder'
    ? { title: 'Choose a folder of spreadsheets', properties: ['openDirectory'] }
    : { title: 'Choose spreadsheets to combine', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Spreadsheets', extensions: ['xlsx', 'xlsm', 'csv', 'tsv'] }] });
  return r.canceled ? null : r.filePaths;
});
ipcMain.handle('dataset:scan', async (_e, { dir, recursive, paths }) => {
  const out = [];
  const add = async (fp) => {
    const base = path.basename(fp);
    if (!DATA_EXT.test(base) || base.startsWith('~$') || base.startsWith('.')) return;
    try { const st = await fsp.stat(fp); out.push({ path: fp, name: base, mtime: st.mtimeMs, size: st.size }); } catch {}
  };
  const walk = async (d, depth) => {
    let ents = [];
    try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) { if (recursive && depth < 6 && !e.name.startsWith('.') && e.name !== 'node_modules') await walk(fp, depth + 1); }
      else await add(fp);
    }
  };
  if (dir) await walk(dir, 0);
  for (const p of paths || []) await add(p);
  out.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  return out;
});
ipcMain.handle('dialog:open-folder', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Open project folder', properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dialog:pick-save-parent', async (_e, name) => {
  const r = await dialog.showOpenDialog(win, {
    title: `Choose where to create the "${safeName(name)}" project folder`,
    buttonLabel: 'Create project here',
    properties: ['openDirectory', 'createDirectory']
  });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dialog:save-file', async (_e, { defaultName, ext }) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: defaultName,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
  });
  return r.canceled ? null : r.filePath;
});
ipcMain.handle('dialog:pick-image', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }]
  });
  if (r.canceled) return null;
  return formats.imageToDataUrl(r.filePaths[0]);
});

// Import a single file -> array of sheet payloads
ipcMain.handle('file:import', async (_e, filePath) => formats.importFile(filePath));

// Write a file without ever leaving a half-written one behind: write a hidden temp file next to it, then swap it in.
async function writeAtomic(fp, data, enc) {
  const tmp = path.join(path.dirname(fp), `.${path.basename(fp)}.${process.pid}.tmp`);
  await fsp.writeFile(tmp, data, enc);
  try { await fsp.rename(tmp, fp); }
  catch (err) {
    // Windows can refuse to replace a file another app has open; fall back to a plain write
    await fsp.unlink(tmp).catch(() => {});
    if (err.code === 'EBUSY' || err.code === 'EPERM') throw new Error(`"${path.basename(fp)}" is open in another app. Close it and save again.`);
    await fsp.writeFile(fp, data, enc);
  }
}

// Save whole project as a folder of native files + manifest
ipcMain.handle('project:save', async (_e, { project, parentDir, folder, exports }) => {
  const dir = folder || path.join(parentDir, safeName(project.name));
  await fsp.mkdir(dir, { recursive: true });
  const written = [];
  const used = new Set();
  const uniqueFile = (base, ext) => {
    let n = safeName(base), f = `${n}.${ext}`, i = 2;
    while (used.has(f.toLowerCase())) f = `${n} (${i++}).${ext}`;
    used.add(f.toLowerCase());
    return f;
  };
  const fileMap = {};
  const failed = [];
  let oldManifest = null;
  try { oldManifest = JSON.parse(await fsp.readFile(path.join(dir, 'project.datum'), 'utf8')); } catch {}
  for (const sheet of project.sheets) {
    const ex = exports[sheet.id] || {};
    try {
      let file, buf;
      if (ex.keepOriginal && fs.existsSync(ex.keepOriginal)) {
        file = path.basename(ex.keepOriginal);
        let i = 2;
        const parsed = path.parse(file);
        while (used.has(file.toLowerCase())) file = `${parsed.name} (${i++})${parsed.ext}`;
        used.add(file.toLowerCase());
        if (path.resolve(path.dirname(ex.keepOriginal)) !== path.resolve(dir) || path.basename(ex.keepOriginal) !== file) {
          await fsp.copyFile(ex.keepOriginal, path.join(dir, file));
        }
        fileMap[sheet.id] = file;
        written.push(file);
        continue;
      }
      if (sheet.type === 'data') {
        file = uniqueFile(sheet.name, 'xlsx');
        buf = await formats.writeXlsx(sheet, ex);
      } else if (sheet.type === 'slide') {
        file = uniqueFile(sheet.name, 'pptx');
        buf = await formats.writePptx(sheet, ex, project.brand);
      } else if (sheet.type === 'docu') {
        if (sheet.format === 'pdf') {
          file = uniqueFile(sheet.name, 'pdf');
          buf = (!sheet.edited && sheet.pdfOriginal)
            ? Buffer.from(sheet.pdfOriginal, 'base64')
            : await htmlToPdf(ex.printHtml);
        } else {
          file = uniqueFile(sheet.name, 'docx');
          buf = await formats.writeDocx(ex.html, project.brand);
        }
      } else if (sheet.type === 'report' || sheet.type === 'dash') {
        file = uniqueFile(sheet.name, 'pdf');
        buf = await htmlToPdf(ex.printHtml);
      }
      if (file) {
        await writeAtomic(path.join(dir, file), buf);
        fileMap[sheet.id] = file;
        written.push(file);
      }
    } catch (err) {
      // one sheet failing (a file open in Excel, an odd image) shouldn't lose the rest of the save
      console.error(err);
      failed.push({ id: sheet.id, msg: `${sheet.name}: ${err.message}` });
      const prev = oldManifest && oldManifest.files && oldManifest.files[sheet.id];
      if (prev) { fileMap[sheet.id] = prev; written.push(prev); used.add(prev.toLowerCase()); }
    }
  }
  // Remove files we wrote last time that no longer belong to a sheet
  if (oldManifest) {
    for (const f of Object.values(oldManifest.files || {})) {
      if (!written.includes(f)) await fsp.unlink(path.join(dir, f)).catch(() => {});
    }
  }
  const savedAt = Date.now();
  const manifest = { app: 'Datum', version: 1, savedAt, files: fileMap, project };
  // keep the previous manifest as a backup, in case this one is ever damaged
  if (oldManifest) await fsp.copyFile(path.join(dir, 'project.datum'), path.join(dir, '.project.datum.bak')).catch(() => {});
  await writeAtomic(path.join(dir, 'project.datum'), JSON.stringify(manifest), 'utf8');
  await pushRecent(dir, project.name);
  return { ok: true, dir, files: written, fileMap, savedAt, failed };
});

// Open a folder: manifest if present (merging newer external Excel edits), else import each file
ipcMain.handle('project:open-folder', async (_e, dir) => {
  const manifestPath = path.join(dir, 'project.datum');
  let m = null;
  const notes = [];
  if (fs.existsSync(manifestPath)) {
    try { m = JSON.parse(await fsp.readFile(manifestPath, 'utf8')); } catch (err) {
      try { m = JSON.parse(await fsp.readFile(path.join(dir, '.project.datum.bak'), 'utf8')); notes.push('project.datum was damaged, so the previous save was opened'); } catch { notes.push('project.datum was damaged, so the files were opened one by one'); }
    }
    if (m && !(m.project && Array.isArray(m.project.sheets))) m = null;
  }
  if (m) {
    const updates = [];
    for (const sheet of m.project.sheets) {
      const f = m.files && m.files[sheet.id];
      if (!f) continue;
      const fp = path.join(dir, f);
      if (!fs.existsSync(fp)) continue;
      const mtime = (await fsp.stat(fp)).mtimeMs;
      if (sheet.type === 'data' && mtime > m.savedAt + 3000) {
        try {
          const imported = await formats.importFile(fp);
          if (imported[0] && imported[0].type === 'data') {
            sheet.cells = imported[0].cells;
            sheet.styles = imported[0].styles || {};
            updates.push(sheet.name);
          }
        } catch (err) { console.error(err); notes.push(`${f} changed outside Datum but couldn't be read (${err.message}); the last saved version is shown`); }
      }
    }
    // pick up new files dropped into the folder
    const known = new Set(Object.values(m.files || {}).map((f) => f.toLowerCase()));
    const extra = [];
    for (const f of await fsp.readdir(dir)) {
      if (known.has(f.toLowerCase()) || f === 'project.datum' || f.startsWith('~$') || f.startsWith('.')) continue;
      if (!formats.isSupported(f)) continue;
      try { extra.push(...(await formats.importFile(path.join(dir, f)))); } catch (err) { console.error(err); }
    }
    await pushRecent(dir, m.project.name);
    return { project: m.project, dir, updates, extra, notes };
  }
  const sheets = [];
  const skipped = [];
  for (const f of (await fsp.readdir(dir)).sort()) {
    if (f.startsWith('~$') || f.startsWith('.')) continue;
    const fp = path.join(dir, f);
    if (f === 'project.datum' || f.endsWith('.tmp')) continue;
    if ((await fsp.stat(fp)).isDirectory()) continue;
    if (!formats.isSupported(f)) { skipped.push(f); continue; }
    try { sheets.push(...(await formats.importFile(fp))); } catch (err) { skipped.push(f); console.error(err); }
  }
  await pushRecent(dir, path.basename(dir));
  return { project: null, name: path.basename(dir), dir, sheets, skipped, notes };
});

// Single-file exports
ipcMain.handle('export:pdf', async (_e, { html, filePath }) => {
  const buf = await htmlToPdf(html);
  await writeAtomic(filePath, buf);
  return true;
});
ipcMain.handle('export:sheet', async (_e, { sheet, ex, brand, filePath }) => {
  let buf;
  if (sheet.type === 'data') buf = await formats.writeXlsx(sheet, ex);
  else if (sheet.type === 'slide') buf = await formats.writePptx(sheet, ex, brand);
  else if (sheet.type === 'docu') buf = filePath.endsWith('.pdf') ? await htmlToPdf(ex.printHtml) : await formats.writeDocx(ex.html, brand);
  else buf = await htmlToPdf(ex.printHtml);
  await writeAtomic(filePath, buf);
  return true;
});
