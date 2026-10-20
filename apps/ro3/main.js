// RO3 — main process: window, dialogs and the bridge to the conversion engine.
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Menu, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');

const formats = require('./engine/formats');
let image, media, timeline, probe;
try {
  image = require('./engine/image');
  media = require('./engine/media');
  timeline = require('./engine/timeline');
  ({ probe } = require('./engine/ffmpeg'));
} catch (e) {
  // A native component wasn't installed for this computer. Explain plainly instead of crashing.
  dialog.showErrorBox('RO3 is missing a component',
    'RO3 could not load its image/video engine on this computer, so it needs to be rebuilt here.\n\n' +
    'In the RO3 project folder, run:\n' +
    '  1. Delete the node_modules folder, the dist folder and package-lock.json\n' +
    '  2. npm install\n' +
    `  3. npm run ${process.platform === 'darwin' ? 'dist:mac' : 'dist:win'}\n\n` +
    'Details: ' + String(e && e.message || e).split('\n')[0]);
  app.exit(1);
}

let win;
const jobs = new Map(); // jobId -> AbortController
const TMP = path.join(os.tmpdir(), 'ro3-cache');
fs.mkdirSync(TMP, { recursive: true });

function createWindow() {
  nativeTheme.themeSource = 'dark';
  win = new BrowserWindow({
    width: 1480, height: 920, minWidth: 1100, minHeight: 700,
    backgroundColor: '#000000',
    title: 'RO3',
    icon: path.join(__dirname, 'build', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => win.show());
  // Links open in the real browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());
  // Ask before closing with unsaved work.
  let closing = false;
  win.on('close', async (e) => {
    if (closing || process.env.RO3_SMOKE) return;
    e.preventDefault();
    let unsaved = [];
    try { unsaved = await win.webContents.executeJavaScript('window.RO3App ? RO3App.unsaved() : []', true); } catch (_) {}
    if (unsaved.length) {
      const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Cancel', 'Quit without saving'], defaultId: 0, cancelId: 0,
        message: 'You have unsaved changes', detail: `${unsaved.join(' and ')} ${unsaved.length > 1 ? 'have' : 'has'} changes that haven't been saved. RO3 keeps a recovery copy, but saving is safer.` });
      if (r.response !== 1) return;
    }
    closing = true;
    win.close();
  });
  // A crashed renderer shouldn't lose the window; reload and offer recovery.
  win.webContents.on('render-process-gone', (_e, d) => {
    if (d.reason === 'clean-exit') return;
    dialog.showMessageBox(win, { type: 'error', message: 'RO3 hit a problem and reloaded', detail: 'Your work from the last autosave can be recovered.' }).then(() => win.reload());
  });
}

// ---------- recent files ----------
const RECENT_FILE = () => path.join(app.getPath('userData'), 'recent.json');
let recent = [];
function loadRecent() { try { recent = JSON.parse(fs.readFileSync(RECENT_FILE(), 'utf8')).filter(p => typeof p === 'string'); } catch (_) { recent = []; } }
function addRecent(p) {
  recent = [p, ...recent.filter(x => x !== p)].slice(0, 12);
  try { fs.writeFileSync(RECENT_FILE(), JSON.stringify(recent)); } catch (_) {}
  if (process.platform !== 'linux') app.addRecentDocument(p);
  buildMenu();
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const send = (cmd) => () => win && win.webContents.send('menu', cmd);
  // Shortcuts the page already handles are shown here but not registered twice.
  const hint = (accelerator) => ({ accelerator, registerAccelerator: false });
  const item = (label, cmd, accel, extra = {}) => ({ label, id: cmd, click: send(cmd), ...(accel ? hint(accel) : {}), ...extra });
  const recentItems = recent.length
    ? [...recent.map(p => ({ label: path.basename(p), sublabel: path.dirname(p), click: send('open-path:' + p) })), { type: 'separator' }, { label: 'Clear recent', click: () => { recent = []; try { fs.writeFileSync(RECENT_FILE(), '[]'); } catch (_) {} buildMenu(); } }]
    : [{ label: 'No recent files', enabled: false }];
  const adjKinds = [['brightness', 'Brightness/Contrast…'], ['levels', 'Levels…'], ['curves', 'Curves…'], ['exposure', 'Exposure…'], ['vibrance', 'Vibrance…'], ['huesat', 'Hue/Saturation…'],
    ['colorbalance', 'Color Balance…'], ['bw', 'Black & White…'], ['photofilter', 'Photo Filter…'], ['channelmixer', 'Channel Mixer…'], ['selectivecolor', 'Selective Color…'], ['gradientmap', 'Gradient Map…'], ['lookup', 'Color Lookup…'], ['grade', 'Color Grade…'], ['invert', 'Invert'], ['posterize', 'Posterize…'], ['threshold', 'Threshold…']];
  // Filter menu straight from the filter catalogue (shared with the renderer).
  const PF = require('./src/js/photo-filters.js').F, fgroups = {};
  for (const f of Object.values(PF)) (fgroups[f.group] = fgroups[f.group] || []).push(f);
  const filterMenus = Object.entries(fgroups).filter(([g]) => g !== 'Adjust').map(([g, list]) => ({ label: g, submenu: list.map(f => item(f.name, 'photo:filter:' + f.id)) }));
  const adjustItems = (fgroups.Adjust || []).map(f => item(f.name, 'photo:filter:' + f.id));
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      item('New Image…', 'photo:new', 'CmdOrCtrl+N'),
      { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: send('open') },
      { label: 'Open Recent', submenu: recentItems },
      { type: 'separator' },
      { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('save') },
      { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: send('save-as') },
      { label: 'Export…', accelerator: 'CmdOrCtrl+Alt+E', click: send('export') },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ] },
    { label: 'Edit', submenu: [
      item('Undo', 'undo', 'CmdOrCtrl+Z'),
      item('Redo', 'redo', isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y'),
      { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, item('Copy Merged', 'photo:copy-merged', 'CmdOrCtrl+Shift+C'), { role: 'paste' }, item('Paste as New Image', 'photo:paste-new', 'CmdOrCtrl+Shift+V'),
      { type: 'separator' },
      item('Fill Selection', 'photo:fill', 'Alt+Backspace'), item('Content-Aware Fill', 'photo:content-aware', 'Shift+Backspace'), item('Free Transform', 'photo:transform', 'CmdOrCtrl+T'),
    ] },
    { label: 'Image', submenu: [
      { label: 'Adjustments', submenu: [
        item('Auto Tone', 'photo:filter:autotone', 'CmdOrCtrl+Shift+L'), ...adjustItems.slice(0, 2), item('Brightness / Color sliders', 'photo:panel:adjust'),
        { type: 'separator' }, ...adjustItems.slice(2),
        { type: 'separator' }, { label: 'As Adjustment Layer', submenu: adjKinds.map(([k, l]) => item(l, 'photo:adjlayer:' + k)) },
        { type: 'separator' }, item('Black & White', 'photo:filter:grayscale'), item('Sepia', 'photo:filter:sepia'), item('Invert', 'photo:filter:invert', 'CmdOrCtrl+I'), item('Posterize…', 'photo:filter:posterize'),
      ] },
      { type: 'separator' },
      item('Image Size…', 'photo:image-size', 'CmdOrCtrl+Alt+I'), item('Canvas Size…', 'photo:canvas-size', 'CmdOrCtrl+Alt+C'), item('Trim Transparent Edges', 'photo:trim'),
      { label: 'Rotate', submenu: [item('90° Clockwise', 'photo:rot:cw'), item('90° Counter-clockwise', 'photo:rot:ccw'), item('180°', 'photo:rot:180'), { type: 'separator' }, item('Flip Horizontal', 'photo:rot:fh'), item('Flip Vertical', 'photo:rot:fv')] },
      item('Crop to Selection', 'photo:crop-selection'),
    ] },
    { label: 'Layer', submenu: [
      item('New Layer', 'photo:new-layer', 'CmdOrCtrl+Shift+N'), item('Duplicate Layer', 'photo:duplicate', 'CmdOrCtrl+J'), item('Delete Layer', 'photo:delete-layer'),
      { label: 'New Adjustment Layer', submenu: adjKinds.map(([k, l]) => item(l, 'photo:adjlayer:' + k)) },
      { type: 'separator' },
      item('Layer Style…', 'photo:layer-style'), { label: 'Layer Style Clipboard', submenu: [item('Copy Layer Style', 'photo:copy-style'), item('Paste Layer Style', 'photo:paste-style'), item('Clear Layer Style', 'photo:clear-style')] }, item('Add Layer Mask', 'photo:add-mask'),
      item('Create / Release Clipping Mask', 'photo:clip', 'CmdOrCtrl+Alt+G'), item('Lock / Unlock Layer', 'photo:lock', 'CmdOrCtrl+/'),
      { type: 'separator' },
      item('Group Layers', 'photo:group', 'CmdOrCtrl+G'), item('Ungroup Layers', 'photo:ungroup', 'CmdOrCtrl+Shift+G'),
      { label: 'Align', submenu: [item('Left Edges', 'photo:align:left'), item('Horizontal Centers', 'photo:align:hcenter'), item('Right Edges', 'photo:align:right'), { type: 'separator' }, item('Top Edges', 'photo:align:top'), item('Vertical Centers', 'photo:align:vcenter'), item('Bottom Edges', 'photo:align:bottom')] },
      { label: 'Distribute', submenu: [item('Horizontally', 'photo:distribute:h'), item('Vertically', 'photo:distribute:v')] },
      { type: 'separator' },
      item('Merge Down', 'photo:merge-down', 'CmdOrCtrl+E'), item('Merge Visible', 'photo:merge-visible', 'CmdOrCtrl+Shift+E'), item('Flatten Image', 'photo:flatten'),
    ] },
    { label: 'Select', submenu: [
      item('All', 'photo:select-all', 'CmdOrCtrl+A'), item('Deselect', 'photo:deselect', 'CmdOrCtrl+D'), item('Reselect', 'photo:reselect', 'CmdOrCtrl+Shift+D'), item('Inverse', 'photo:inverse', 'CmdOrCtrl+Shift+I'),
      { type: 'separator' },
      item('Select and Mask…', 'photo:select-mask', 'CmdOrCtrl+Alt+R'), item('Color Range…', 'photo:color-range'), item('Layer Pixels', 'photo:layer-pixels'),
      { label: 'Modify', submenu: [item('Expand…', 'photo:sel:expand'), item('Contract…', 'photo:sel:contract'), item('Feather…', 'photo:sel:feather', 'Shift+F6'), item('Border…', 'photo:sel:border'), item('Smooth…', 'photo:sel:smooth')] },
      { type: 'separator' },
      item('Save Selection as Mask', 'photo:sel-to-mask'),
    ] },
    { label: 'Filter', submenu: [
      item('Last Filter', 'photo:last-filter', 'CmdOrCtrl+Alt+F'), { type: 'separator' },
      item('Liquify…', 'photo:liquify', 'CmdOrCtrl+Shift+X'), { type: 'separator' },
      ...filterMenus,
      { type: 'separator' },
      { label: 'Classic', submenu: [item('Sharpen…', 'photo:filter:sharpen'), item('Pixelate…', 'photo:filter:pixelate'), item('Vignette…', 'photo:filter:vignette'), item('Posterize…', 'photo:filter:posterize')] },
    ] },
    { label: 'Timeline', submenu: [
      item('Split at Playhead', 'video:split', 'S'), item('Add Marker', 'video:marker', 'M'), item('Add Title', 'video:title', 'T'), item('Add Caption', 'video:caption', 'C'),
      item('Freeze Frame', 'video:freeze', 'Shift+F'), item('Paste Effects onto Clip', 'video:paste-attrs', 'CmdOrCtrl+Alt+V'),
      { type: 'separator' },
      item('Import Captions…', 'video:import-captions'), item('Save Captions as SRT…', 'video:export-srt'), item('Save Captions as VTT…', 'video:export-vtt'), item('Copy YouTube Chapters', 'video:chapters'),
      { type: 'separator' },
      { label: 'Export Timeline', submenu: [item('Final Cut Pro / Resolve (FCPXML)…', 'video:export-fcpxml'), item('EDL (CMX 3600)…', 'video:export-edl'), item('OpenTimelineIO…', 'video:export-otio')] },
      { type: 'separator' },
      item('Video Scopes', 'video:scopes'), item('Audio Meters', 'video:meters'), item('Render Preview', 'video:render-preview'),
    ] },
    { label: 'View', submenu: [
      { label: 'Photo', accelerator: 'CmdOrCtrl+1', click: send('tab:photo') },
      { label: 'Video', accelerator: 'CmdOrCtrl+2', click: send('tab:video') },
      { label: 'Quick Convert', accelerator: 'CmdOrCtrl+3', click: send('tab:convert') },
      { type: 'separator' },
      item('Command Palette…', 'palette', 'CmdOrCtrl+K'),
      { type: 'separator' },
      item('Rulers', 'photo:rulers', 'CmdOrCtrl+R'), item('Guides', 'photo:guides', 'CmdOrCtrl+;'), item('Rule of Thirds Grid', 'photo:thirds', "'"), item('Clear Guides', 'photo:clear-guides'),
      { type: 'separator' },
      item('Fit on Screen', 'photo:fit', 'CmdOrCtrl+0'), item('Actual Pixels', 'photo:actual', 'CmdOrCtrl+Alt+1'),
      { type: 'separator' },
      { role: 'togglefullscreen' }, { role: 'toggleDevTools' },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  // Flattened list for the command palette.
  menuCommands = [];
  const walk = (items, trail) => items.forEach(it => {
    if (it.submenu && Array.isArray(it.submenu)) return walk(it.submenu, [...trail, it.label]);
    if (it.id && it.label) menuCommands.push({ label: it.label.replace('…', ''), cmd: it.id, path: trail.join(' › '), accel: it.accelerator || '' });
  });
  walk(template, []);
}
let menuCommands = [];

// ---------- helpers ----------

/** Pick a free output path: name.ext, name (1).ext, … — never overwrites the source. */
function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const dir = path.dirname(p), ext = path.extname(p), base = path.basename(p, ext);
  for (let i = 1; i < 10000; i++) {
    const c = path.join(dir, `${base} (${i})${ext}`);
    if (!fs.existsSync(c)) return c;
  }
  return p;
}

function progressSender(jobId) {
  let last = -1;
  return (pct) => {
    const r = Math.round(pct * 1000);
    if (r !== last && win && !win.isDestroyed()) { last = r; win.webContents.send('job:progress', { jobId, progress: pct }); }
  };
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try { return { ok: true, value: await fn(...args) }; }
    catch (e) { return { ok: false, error: e && e.message || String(e), cancelled: !!(e && e.cancelled) }; }
  });
}

async function withJob(jobId, fn) {
  const ac = new AbortController();
  jobs.set(jobId, ac);
  try { return await fn(ac.signal, progressSender(jobId)); }
  finally { jobs.delete(jobId); }
}

// ---------- IPC ----------

handle('app:formats', () => JSON.parse(JSON.stringify(formats)));
handle('app:info', () => ({ platform: process.platform, version: app.getVersion(), tmp: TMP }));

handle('dialog:open', async (opts = {}) => {
  const r = await dialog.showOpenDialog(win, {
    title: opts.title || 'Open',
    properties: ['openFile', ...(opts.multi ? ['multiSelections'] : [])],
    filters: opts.filters || [],
  });
  return r.canceled ? [] : r.filePaths;
});
handle('dialog:save', async (opts = {}) => {
  const r = await dialog.showSaveDialog(win, { title: opts.title || 'Save', defaultPath: opts.defaultPath, filters: opts.filters || [] });
  return r.canceled ? null : r.filePath;
});
handle('dialog:folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

handle('fs:stat', async (p) => { const s = await fs.promises.stat(p); return { size: s.size, mtime: s.mtimeMs }; });
handle('fs:readText', (p) => fs.promises.readFile(p, 'utf8'));
handle('fs:readBytes', async (p) => new Uint8Array(await fs.promises.readFile(p)));
handle('fs:writeBytes', async (p, bytes) => { const tmp = p + '.ro3tmp'; await fs.promises.writeFile(tmp, Buffer.from(bytes)); await fs.promises.rename(tmp, p); return p; });
handle('recent:add', (p) => { addRecent(p); return true; });
handle('ora:read', async (p) => require('./engine/ora').readORA(p));
handle('ora:write', async (p, d) => { const ora = require('./engine/ora'); const buf = ora.buildORA({ ...d, layers: d.layers.map(l => ({ ...l, png: Buffer.from(l.png) })), merged: Buffer.from(d.merged) }); const tmp = p + '.ro3tmp'; await fs.promises.writeFile(tmp, buf); await fs.promises.rename(tmp, p); return buf.length; });
handle('text:export', async (p, text) => { await fs.promises.writeFile(p, text, 'utf8'); return p; });
handle('recent:list', () => recent);

// Crash-recovery copies live in the app-data folder, never next to the user's files.
const AUTOSAVE = () => { const d = path.join(app.getPath('userData'), 'autosave'); fs.mkdirSync(d, { recursive: true }); return d; };
const safeName = n => String(n).replace(/[^a-z0-9._-]/gi, '_');
handle('autosave:write', async (name, text) => { const p = path.join(AUTOSAVE(), safeName(name)); await fs.promises.writeFile(p + '.tmp', text, 'utf8'); await fs.promises.rename(p + '.tmp', p); return true; });
handle('autosave:read', async (name) => { const p = path.join(AUTOSAVE(), safeName(name)); try { const st = await fs.promises.stat(p); return { text: await fs.promises.readFile(p, 'utf8'), mtime: st.mtimeMs }; } catch (_) { return null; } });
handle('autosave:clear', async (name) => { try { await fs.promises.rm(path.join(AUTOSAVE(), safeName(name)), { force: true }); } catch (_) {} return true; });
handle('fs:writeText', async (p, text) => { const tmp = p + '.ro3tmp'; await fs.promises.writeFile(tmp, text, 'utf8'); await fs.promises.rename(tmp, p); return p; });
handle('fs:unique', (p) => uniquePath(p));
handle('fs:fileUrl', (p) => pathToFileURL(p).href);
handle('shell:show', (p) => { shell.showItemInFolder(p); return true; });
handle('shell:open', (p) => shell.openPath(p));

handle('media:probe', (p) => probe(p));
handle('media:thumb', async (p) => {
  const kind = formats.kindOf(p);
  if (kind === 'image') return image.thumbnail(p, 200);
  if (kind === 'video') return media.thumbnail(p);
  return null;
});
handle('media:filmstrip', (p, duration, frames) => media.filmstrip(p, duration, frames));
handle('media:waveform', (p) => media.waveform(p));
handle('media:frame', (p, t) => media.frameAt(p, t, 360));
handle('media:still', async (p, t) => {
  fs.mkdirSync(TMP, { recursive: true });
  const out = path.join(TMP, `still-${Buffer.from(p).toString('base64url').slice(-24)}-${Math.round(t * 1000)}.png`);
  if (!fs.existsSync(out)) await require('./engine/ffmpeg').runFfmpeg(['-ss', String(Math.max(0, t)), '-i', p, '-frames:v', '1', out]);
  return out;
});
handle('video:interchange', async (project, fmt, out) => {
  const ic = require('./engine/interchange');
  const text = fmt === 'edl' ? ic.toEDL(project, { title: project.name }) : fmt === 'otio' ? ic.toOTIO(project) : ic.toFCPXML(project, { eventName: 'RO3' });
  await fs.promises.writeFile(out, text, 'utf8'); return out;
});
handle('video:transitions', () => [...timeline.supportedTransitions()]);
handle('media:proxy', (jobId, p) => withJob(jobId, (signal, progress) => {
  const out = path.join(TMP, 'proxy-' + Buffer.from(p).toString('base64url').slice(-40) + '.mp4');
  if (fs.existsSync(out)) return out;
  return media.makeProxy(p, out + '.part.mp4', progress, signal).then(() => { fs.renameSync(out + '.part.mp4', out); return out; });
}));

// Photo editor: decode any image to PNG bytes (Chromium can't read TIFF/ICO/etc. itself)
handle('image:decode', async (p) => {
  const r = await image.toPngBuffer(p);
  return { width: r.width, height: r.height, dataUrl: 'data:image/png;base64,' + r.data.toString('base64') };
});
handle('image:info', (p) => image.imageInfo(p));

// Photo editor export: renderer hands over a flattened PNG
handle('image:exportBuffer', async (pngBytes, job) => {
  const buf = Buffer.from(pngBytes);
  if (job.preview) {
    const r = await image.convertImage({ ...job, buffer: buf, output: null });
    return job.format === 'svg' ? r.data.toString('utf8') : 'data:application/octet-stream;base64,' + r.data.toString('base64');
  }
  return image.convertImage({ ...job, buffer: buf });
});

// Quick Convert / generic conversion
handle('convert:file', (jobId, job) => withJob(jobId, async (signal, progress) => {
  const kind = formats.kindOf(job.input);
  const outExt = formats.extOf(job.output);
  job.output = uniquePath(job.output);
  if (kind === 'image') {
    progress(0.2);
    const r = await image.convertImage(job);
    progress(1);
    return r;
  }
  if (outExt === 'gif' || formats.VIDEO_OUT.some(f => f.ext === outExt) || formats.AUDIO_OUT.some(f => f.ext === outExt)) {
    return media.convertMedia(job, progress, signal);
  }
  throw new Error(`Can't convert ${kind} files to .${outExt}`);
}));

handle('video:render', (jobId, project, out) => withJob(jobId, (signal, progress) => {
  if (!out.preview) out.output = uniquePath(out.output);
  return timeline.renderProject(project, out, progress, signal);
}));
handle('video:previewPath', () => path.join(TMP, `preview-${Date.now()}.mp4`));
handle('video:writeTemp', async (bytes, name) => { const p = path.join(TMP, String(name).replace(/[^a-z0-9._-]/gi, '_')); await fs.promises.writeFile(p, Buffer.from(bytes)); return p; });

handle('clipboard:writeImage', (bytes) => { clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(bytes))); return true; });
handle('clipboard:readImage', () => {
  const img = clipboard.readImage();
  if (img.isEmpty()) return null;
  const { width, height } = img.getSize();
  return { width, height, dataUrl: 'data:image/png;base64,' + img.toPNG().toString('base64') };
});
handle('job:cancel', (jobId) => { const ac = jobs.get(jobId); if (ac) ac.abort(); return !!ac; });

// ---------- lifecycle ----------

// Files opened by double-click / "Open with" (macOS sends open-file, Windows passes argv).
const pendingOpen = [];
const openableArg = a => /\.(ro3|ro3v|psd|png|jpe?g|webp|tiff?|gif|bmp|mp4|mov|mkv|webm)$/i.test(a) && fs.existsSync(a);
process.argv.slice(1).filter(openableArg).forEach(a => pendingOpen.push(a));
app.on('open-file', (e, p) => { e.preventDefault(); if (win && win.webContents && !win.webContents.isLoading()) win.webContents.send('menu', 'open-path:' + p); else pendingOpen.push(p); });
const gotLock = process.env.RO3_SMOKE ? true : app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', (_e, argv) => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  argv.slice(1).filter(openableArg).forEach(p => win.webContents.send('menu', 'open-path:' + p));
});
handle('app:pendingOpen', () => pendingOpen.splice(0));
handle('app:commands', () => menuCommands);

app.whenReady().then(() => {
  loadRecent();
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => {
  for (const ac of jobs.values()) ac.abort();
  if (process.platform !== 'darwin') app.quit();
});
app.on('will-quit', () => {
  // Clear old preview renders and proxies older than a week.
  try {
    const week = Date.now() - 7 * 864e5;
    for (const f of fs.readdirSync(TMP)) {
      const p = path.join(TMP, f);
      const st = fs.statSync(p);
      if (f.startsWith('preview-') || st.mtimeMs < week) fs.rmSync(p, { force: true });
    }
  } catch (_) {}
});

// Developer test hook (only when the test harness is present and asked for).
if (process.env.RO3_SMOKE && fs.existsSync(path.join(__dirname, 'test', 'smoke.js'))) require('./test/smoke')(app, () => win);
