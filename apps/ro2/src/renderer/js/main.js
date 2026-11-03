// RO2 boot: title bar, views, keyboard, drag & drop, paste, pages strip and zoom.
import { h, ico, $, loadIcons, toast, toastErr, debounce, menu, MOD, isMac, closePopover, slider } from './ui.js';
import { initFonts } from './fonts.js';
import { app, ensureEditor, openFile, saveNow, renameDesign, addFiles, addImage, runStudio } from './app.js';
import { buildRail, open as openPanel, refresh, currentPanel, register } from './drawer.js';
import { renderHome } from './home.js';
import { renderCtx, placeFloat, contextMenu } from './ctxbar.js';
import { fabric, kindOf } from './editor/fab.js';
import { thumb } from './editor/render.js';
import { setRecent } from './panels/color.js';
import { adjustPanel } from './panels/image.js';
import { startCrop } from './editor/crop.js';
import { makeShape, makeLine } from './editor/objects.js';
import { byId, LINES } from './editor/shapes.js';
import './panels/elements.js'; import './panels/brand.js'; import './panels/text.js'; import './panels/photos.js'; import './panels/background.js'; import './panels/ai.js'; import './panels/layers.js'; import './panels/props.js'; import './panels/assistant.js';
import { addPayload } from './panels/elements.js';
import { addTextPreset } from './panels/text.js';

register('adjust', { label: 'Adjust', icon: 'sliders-horizontal', render(root) { const a = app.editor?.active(); if (!(a instanceof fabric.FabricImage)) { root.append(h('p.muted', 'Select a photo.')); return; } adjustPanel(root, a, app.editor); } });

// Theme: 'dark' | 'light' | 'system'
export function applyTheme(t = app.settings.theme || 'dark') {
  const light = t === 'light' || (t === 'system' && matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  window.ro2.setTheme(t).catch(() => {});
  if (app.editor) app.editor.applyTheme();
  app.emit('theme', light ? 'light' : 'dark');
}
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (app.settings.theme === 'system') applyTheme('system'); });
export function setTheme(t) { app.settings.theme = t; window.ro2.settings.set({ theme: t }); applyTheme(t); renderTbRight(); }
async function boot() {
  document.body.classList.add(isMac ? 'mac' : navigator.platform.toLowerCase().includes('win') ? 'win' : 'linux');
  await loadIcons();
  await initFonts();
  app.settings = await window.ro2.settings.get(); app.info = await window.ro2.info();
  setRecent(app.settings.recentColors); applyTheme();
  await (await import('./panels/brand.js')).loadBrand().catch(() => {});
  buildRail(); wireTitle(); wireStage(); wireKeys(); wireDrop(); wireMenu();
  (await import('./agent.js')).initAgent();
  app.on('view', setView);
  app.on('doc', () => { titleInput.value = app.editor.doc.name; renderPages(); renderCtx(); });
  app.on('saved-state', (s) => { saveState.innerHTML = s === 'saving' ? '<span class="spinner" style="width:12px;height:12px"></span>Saving' : s === 'saved' ? ico('cloud-check') + 'Saved' : s === 'error' ? ico('cloud-alert') + 'Not saved' : ico('cloud') + 'Edited'; });
  app.on('refresh-panel', () => refresh());
  app.on('home-refresh', () => { if (app.view === 'home') renderHome(); });
  setView('home');
  document.body.classList.remove('booting');
  // files opened with RO2 (double-click a .ro2, drop on the Dock icon)
  const pend = await window.ro2.pendingOpen(); if (pend.length) openPaths(pend);
  window.ro2.onOpenFiles(openPaths);
  window.ro2.onBeforeClose(async () => { try { if (app.editor && app.view === 'editor') await saveNow(true); } finally { window.ro2.readyToClose(); } });
  window.__ro2 = app; window.__ro2app = await import('./app.js'); // for tests
}
async function openPaths(paths) {
  for (const p of paths) {
    if (/\.ro2$/i.test(p)) { await openFile(p); continue; }
    try { const f = await window.ro2.files.readImage(p); const { photoDesign } = await import('./app.js'); if (app.view === 'editor') await saveNow(true); await photoDesign(f, null); } catch (e) { toastErr(e); }
  }
}

// ───── title bar ─────
let titleInput, saveState, undoB, redoB;
function wireTitle() {
  $('#brand').onclick = () => goHome();
  const left = $('#tbLeftTools');
  const fileB = h('button.btn.ghost.sm', { html: '<span>File</span>' + ico('chevron-down'), on: { click: () => menu(fileB, [
    { label: 'New design…', icon: 'plus', key: MOD + 'N', run: () => import('./modals/new.js').then((m) => m.openNew()) },
    { label: 'Open design…', icon: 'folder-open', run: async () => { const f = await window.ro2.designs.openDialog(); if (f) { await saveNow(true); openFile(f); } } },
    '-', { label: 'Resize…', icon: 'scaling', run: () => import('./modals/resize.js').then((m) => m.openResize()) },
    { label: 'Export…', icon: 'download', key: MOD + 'E', run: () => import('./modals/export.js').then((m) => m.openExport()) },
    { label: 'Copy page as PNG', icon: 'clipboard-copy', key: MOD + '⇧C', run: () => import('./modals/export.js').then((m) => m.copyPng(false)) },
    '-', { label: 'Show in folder', icon: 'folder', disabled: !app.file, run: () => window.ro2.shell.reveal(app.file) },
    { label: 'Settings', icon: 'settings', run: () => import('./modals/settings.js').then((m) => m.openSettings()) },
  ]) } });
  undoB = h('button.btn.ghost.icon.sm', { title: `Undo (${MOD}Z)`, html: ico('undo-2'), on: { click: () => app.editor.undo() } });
  redoB = h('button.btn.ghost.icon.sm', { title: `Redo (${MOD}⇧Z)`, html: ico('redo-2'), on: { click: () => app.editor.redo() } });
  saveState = h('span.save-state', { html: ico('cloud-check') + 'Saved' });
  left.append(h('div.tb-divider'), fileB, undoB, redoB, saveState);
  titleInput = h('input.title-input', { value: 'Untitled design', spellcheck: false, on: { change: () => renameDesign(titleInput.value.trim() || 'Untitled design'), keydown: (e) => { if (e.key === 'Enter') titleInput.blur(); e.stopPropagation(); } } });
  $('#tbCenter').append(titleInput);
  renderTbRight();
}
function renderTbRight() {
  const r = $('#tbRight'); r.innerHTML = '';
  const light = document.documentElement.dataset.theme === 'light';
  r.append(h('button.btn.ghost.icon', { title: light ? 'Dark theme' : 'Light theme', html: ico(light ? 'moon' : 'sun'), on: { click: () => setTheme(light ? 'dark' : 'light') } }));
  if (app.view === 'home') {
    r.append(h('button.btn.ghost.icon', { title: 'Settings', html: ico('settings'), on: { click: () => import('./modals/settings.js').then((m) => m.openSettings()) } }),
      h('button.btn.primary', { html: ico('plus') + '<span>New design</span>', on: { click: () => import('./modals/new.js').then((m) => m.openNew()) } }));
  } else {
    r.append(h('button.btn', { html: ico('scaling') + '<span>Resize</span>', on: { click: () => import('./modals/resize.js').then((m) => m.openResize()) } }),
      h('button.btn.primary', { html: ico('download') + '<span>Export</span>', on: { click: () => import('./modals/export.js').then((m) => m.openExport()) } }));
  }
}
function setView(v) {
  app.view = v; document.body.classList.toggle('home-mode', v === 'home');
  $('#home').classList.toggle('hidden', v !== 'home'); $('#editor').classList.toggle('hidden', v !== 'editor');
  renderTbRight();
  if (v === 'home') renderHome();
  else { ensureEditor(); if (!currentPanel()) openPanel('templates'); }
}
async function goHome() { if (app.view === 'home') return renderHome(); closePopover(); if (app.editor?.cropping) app.editor.cropping.done(); await saveNow(true); setView('home'); }

// ───── stage: selection → toolbars, pages, zoom ─────
function wireStage() {
  const ed = ensureEditor(); ed.applyTheme();
  const onSel = () => { renderCtx(); placeFloat(); syncUndo(); if (ed.cropping) return; const cp = currentPanel(); if (['position', 'effects', 'adjust'].includes(cp)) refresh(); else if (cp === 'layers' || cp === 'ai') refresh(); };
  ed.on('selection', onSel);
  ed.on('modified', debounce(() => { renderCtx(); placeFloat(); const cp = currentPanel(); if (cp === 'position' || cp === 'layers') refresh(); }, 60));
  ed.on('history', syncUndo); ed.on('change', debounce(updateThumb, 1500));
  ed.on('view', () => placeFloat()); ed.on('layers', () => { if (currentPanel() === 'layers') refresh(); });
  ed.on('transform', () => { app.transforming = true; $('#floatbar').classList.add('hidden'); });
  ed.canvas.on('mouse:down', () => { closePopover(); });
  ed.canvas.on('mouse:up', () => { if (app.transforming) { app.transforming = false; placeFloat(); } });
  ed.canvas.on('object:moving', () => { app.transforming = true; $('#floatbar').classList.add('hidden'); });
  const tlBtn = h('button.btn.ghost.sm.tl-toggle', { title: 'Timeline: page durations, transitions and music for video', html: ico('clapperboard') + '<span>Timeline</span>', on: { click: () => import('./timeline.js').then((m) => m.toggleTimeline()) } });
  $('#stageBottom').prepend(tlBtn);
  app.on('timeline', (v) => tlBtn.classList.toggle('on', !!v));
  const tlRefresh = debounce(() => import('./timeline.js').then((m) => m.timelineOpen() && m.renderTimeline()), 120);
  ed.on('pages', tlRefresh); ed.on('page', tlRefresh); ed.on('timeline', () => {}); ed.on('change', tlRefresh);
  ed.on('pages', renderPages); ed.on('page', () => { renderPages(); renderCtx(); if (['layers', 'background'].includes(currentPanel())) refresh(); });
  ed.on('zoom', (z) => { zoomLabel.textContent = Math.round(z * 100) + '%'; zoomRow.set(Math.log2(z)); });
  ed.on('background', () => { if (!ed.active()) renderCtx(); if (currentPanel() === 'background') refresh(); });
  ed.on('image-dblclick', (img) => { if (img.ro2Html) return import('./modals/html-editor.js').then((m) => m.openHtmlEditor(img)); if (img.ro2Video) return import('./video-layer.js').then((m) => m.openTrim(ed, img)); if (ed.cropping) return ed.cropping.done(); startCrop(ed, img, { onEnd: async (applied) => { if (applied && img.ro2Frame) { (await import('./panels/image.js')).applyFrame(img, img.ro2Frame); ed.canvas.requestRenderAll(); ed.commit(); } renderCtx(); } }).then(renderCtx); });
  ed.on('contextmenu', ({ target, x, y }) => { if (target && target.selectable !== false && !ed.selected().includes(target)) ed.select(target); contextMenu({ x, y }); });
  // zoom box
  const zb = $('#zoomBox');
  const zoomLabel = h('span.z', { title: 'Fit to window', on: { click: () => ed.fit() } }, '100%');
  const zoomRow = slider('', { min: -4, max: 3, step: 0.01, value: 0, fmt: () => '', onInput: (v) => ed.setZoom(2 ** v) });
  zb.append(h('button.btn.ghost.icon.sm', { title: 'Zoom out', html: ico('minus'), on: { click: () => ed.zoomBy(1 / 1.25) } }), zoomRow.input, h('button.btn.ghost.icon.sm', { title: 'Zoom in', html: ico('plus'), on: { click: () => ed.zoomBy(1.25) } }), zoomLabel,
    h('button.btn.ghost.icon.sm', { title: 'Fit page', html: ico('maximize'), on: { click: () => ed.fit() } }));
}
function syncUndo() { if (!app.editor) return; undoB.disabled = !app.editor.canUndo(); redoB.disabled = !app.editor.canRedo(); }
const thumbs = new Map();
async function updateThumb() { const ed = app.editor; if (!ed || app.view !== 'editor') return; const id = ed.pageData.id; thumbs.set(id, await thumb(ed, ed.page, 160).catch(() => null)); renderPages(); }
async function renderPages() {
  const ed = app.editor; if (!ed || !ed.doc) return;
  const p = $('#pages'); p.innerHTML = '';
  const ar = ed.W / ed.H; const w = Math.max(20, Math.min(80, 32 * ar));
  ed.doc.pages.forEach((pg, i) => {
    const t = h('div.page-th' + (i === ed.page ? '.on' : ''), { title: `Page ${i + 1}`, style: { width: w + 'px', backgroundImage: thumbs.get(pg.id) ? `url(${thumbs.get(pg.id)})` : null }, draggable: true,
      on: {
        click: () => ed.gotoPage(i),
        contextmenu: (e) => { e.preventDefault(); menu({ x: e.clientX, y: e.clientY }, [
          { label: 'Duplicate page', icon: 'copy', run: () => ed.addPage(i, true) }, { label: 'Add page after', icon: 'file-plus-2', run: () => ed.addPage(i) },
          { label: 'Move left', icon: 'arrow-left', disabled: i === 0, run: () => ed.movePage(i, i - 1) }, { label: 'Move right', icon: 'arrow-right', disabled: i === ed.doc.pages.length - 1, run: () => ed.movePage(i, i + 1) },
          '-', { label: 'Delete page', icon: 'trash-2', danger: true, disabled: ed.doc.pages.length < 2, run: () => ed.deletePage(i) }]); },
        dragstart: (e) => { e.dataTransfer.setData('text/x-ro2-page', String(i)); },
        dragover: (e) => { if (e.dataTransfer.types.includes('text/x-ro2-page')) e.preventDefault(); },
        drop: (e) => { const from = +e.dataTransfer.getData('text/x-ro2-page'); if (!isNaN(from) && from !== i) ed.movePage(from, i); },
      } }, h('span', String(i + 1)));
    p.append(t);
    if (!thumbs.has(pg.id)) { thumbs.set(pg.id, null); thumb(ed, i, 160).then((u) => { thumbs.set(pg.id, u); t.style.backgroundImage = `url(${u})`; }).catch(() => {}); }
  });
  p.append(h('button.page-add', { html: ico('plus') + '<span>Page</span>', on: { click: () => ed.addPage() } }));
}

// ───── keyboard ─────
// The app menu and the page can both see a shortcut; run each action once.
const lastRun = {};
function once(name) { const t = performance.now(); if (lastRun[name] && t - lastRun[name] < 150) return false; lastRun[name] = t; return true; }
function wireKeys() {
  addEventListener('keydown', async (e) => {
    const ed = app.editor; if (app.view !== 'editor' || !ed || document.querySelector('.studio, .backdrop')) return;
    const t = e.target; const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    const a = ed.active(); const editingText = a && a.isEditing;
    const mod = e.metaKey || e.ctrlKey; const k = e.key.toLowerCase();
    if (typing && !editingText) return;
    if (editingText) {
      if (mod && ['b', 'i', 'u'].includes(k)) { e.preventDefault(); const btn = [...document.querySelectorAll('#ctxbar .cb-btn')].find((b) => b.title.toLowerCase().startsWith({ b: 'bold', i: 'italic', u: 'underline' }[k])); btn && btn.click(); }
      if (e.key === 'Escape') { a.exitEditing(); ed.canvas.requestRenderAll(); }
      return;
    }
    if (ed.cropping) { if (e.key === 'Enter') ed.cropping.done(); if (e.key === 'Escape') ed.cropping.cancel(); return; }
    if (mod && k === 'z') { e.preventDefault(); if (once(e.shiftKey ? 'redo' : 'undo')) e.shiftKey ? ed.redo() : ed.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); if (once('redo')) ed.redo(); return; }
    if (mod && k === 'd') { e.preventDefault(); ed.duplicate(); return; }
    if (mod && k === 'a') { e.preventDefault(); ed.selectAll(); return; }
    if (mod && k === 'g') { e.preventDefault(); e.shiftKey ? ed.ungroup() : ed.group(); return; }
    if (mod && e.key === ']') { e.preventDefault(); e.altKey ? ed.bringToFront() : ed.bringForward(); return; }
    if (mod && e.key === '[') { e.preventDefault(); e.altKey ? ed.sendToBack() : ed.sendBackward(); return; }
    if (mod && (k === '=' || k === '+')) { e.preventDefault(); if (once('zoom-in')) ed.zoomBy(1.25); return; }
    if (mod && k === '-') { e.preventDefault(); if (once('zoom-out')) ed.zoomBy(0.8); return; }
    if (mod && k === '0') { e.preventDefault(); if (once('zoom-fit')) ed.fit(); return; }
    if (mod && k === '1') { e.preventDefault(); if (once('zoom-100')) ed.setZoom(1); return; }
    if (mod && k === 'e') { e.preventDefault(); if (once('export')) import('./modals/export.js').then((m) => m.openExport()); return; }
    if (mod && k === 'b' && kindOf(a) === 'text') { e.preventDefault(); document.querySelector('#ctxbar .cb-btn[title^="Bold"]')?.click(); return; }
    if (mod && k === 'i' && kindOf(a) === 'text') { e.preventDefault(); document.querySelector('#ctxbar .cb-btn[title^="Italic"]')?.click(); return; }
    if (mod && k === 'u' && kindOf(a) === 'text') { e.preventDefault(); document.querySelector('#ctxbar .cb-btn[title^="Underline"]')?.click(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { if (a) { e.preventDefault(); ed.remove(); } return; }
    if (e.key === 'Escape') { ed.select(null); closePopover(); return; }
    if (e.key === 'Enter' && a && kindOf(a) === 'text') { e.preventDefault(); a.enterEditing(); a.selectAll(); ed.canvas.requestRenderAll(); return; }
    const step = e.shiftKey ? 10 : 1;
    if (e.key.startsWith('Arrow') && a) { e.preventDefault(); ed.nudge(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0); placeFloat(); return; }
    if (!mod && !e.altKey) {
      if (k === 't') { e.preventDefault(); addTextPreset('body'); }
      else if (k === 'r') ed.add(makeShape(ed, byId('square')), { at: ed.dropPoint() });
      else if (k === 'o') ed.add(makeShape(ed, byId('circle')), { at: ed.dropPoint() });
      else if (k === 'l') ed.add(makeLine(ed, LINES[0]), { at: ed.dropPoint() });
    }
  });
  // copy / paste: our objects inside RO2, pictures and text from anywhere else
  document.addEventListener('copy', (e) => {
    const ed = app.editor; if (app.view !== 'editor' || !ed || isField(e.target) || ed.active()?.isEditing) return;
    if (!ed.selected().length) return;
    const clip = ed.copy(); const marker = 'ro2:clip:' + Math.random().toString(36).slice(2); clip.marker = marker;
    e.clipboardData.setData('text/plain', marker); e.preventDefault();
  });
  document.addEventListener('cut', (e) => {
    const ed = app.editor; if (app.view !== 'editor' || !ed || isField(e.target) || ed.active()?.isEditing || !ed.selected().length) return;
    const clip = ed.copy(); const marker = 'ro2:clip:' + Math.random().toString(36).slice(2); clip.marker = marker;
    e.clipboardData.setData('text/plain', marker); e.preventDefault(); ed.remove();
  });
  document.addEventListener('paste', async (e) => {
    const ed = app.editor; if (app.view !== 'editor' || !ed || isField(e.target) || ed.active()?.isEditing || document.querySelector('.studio')) return;
    const text = e.clipboardData.getData('text/plain');
    if (ed._clip && text === ed._clip.marker) { e.preventDefault(); return ed.paste(); }
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); return addFiles(files); }
    const html = e.clipboardData.getData('text/html'); const m = html && html.match(/<img[^>]+src="(https?:[^"]+)"/i);
    if (m) { e.preventDefault(); try { const url = await window.ro2.library.fetch(m[1]); return addImage(url, { name: 'Pasted image' }); } catch {} }
    if (text && text.trim()) { e.preventDefault(); const tb = await addTextPreset('body'); tb.set({ text: text.trim().slice(0, 5000) }); tb.initDimensions(); ed.canvas.requestRenderAll(); ed.commit(); }
  });
}
const isField = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

// ───── drag & drop ─────
function wireDrop() {
  const stage = $('#stage'); const hint = $('#dropHint'); let n = 0;
  const scenePt = (e) => { const ed = app.editor; const r = $('#canvasHost').getBoundingClientRect(); const v = ed.canvas.viewportTransform; return { x: (e.clientX - r.left - v[4]) / v[0], y: (e.clientY - r.top - v[5]) / v[3] }; };
  stage.addEventListener('dragenter', (e) => { if (e.dataTransfer.types.includes('Files')) { n++; hint.classList.remove('hidden'); } });
  stage.addEventListener('dragleave', () => { n = Math.max(0, n - 1); if (!n) hint.classList.add('hidden'); });
  stage.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('application/x-ro2')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  stage.addEventListener('drop', async (e) => {
    n = 0; hint.classList.add('hidden'); e.preventDefault(); if (!app.editor) return;
    const at = scenePt(e);
    const p = e.dataTransfer.getData('application/x-ro2');
    if (p) return addPayload(JSON.parse(p), at);
    if (e.dataTransfer.files.length) return addFiles([...e.dataTransfer.files], at);
  });
  // dropping on Home opens the photo as a new design
  $('#home').addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  $('#home').addEventListener('drop', async (e) => { e.preventDefault(); const f = [...e.dataTransfer.files][0]; if (!f) return; if (/\.ro2$/i.test(f.name)) return openFile(window.ro2.files.pathOf(f)); const path = window.ro2.files.pathOf(f); if (path) openPaths([path]); });
}
function wireMenu() {
  window.ro2.onMenu(async (c) => {
    const ed = app.editor; const inEd = app.view === 'editor' && ed;
    if (c === 'new') return import('./modals/new.js').then((m) => m.openNew());
    if (c === 'open-image') { const { quickPhoto } = await import('./app.js'); return quickPhoto(null); }
    if (c === 'open-design') { const f = await window.ro2.designs.openDialog(); if (f) { if (inEd) await saveNow(true); openFile(f); } return; }
    if (c === 'settings') return import('./modals/settings.js').then((m) => m.openSettings());
    if (c === 'home') return goHome();
    if ((c === 'undo' || c === 'redo') && isField(document.activeElement)) { document.execCommand(c); return; }
    if (!inEd || document.querySelector('.backdrop')) return;
    if (document.querySelector('.studio')) { if (c === 'undo' || c === 'redo') document.dispatchEvent(new CustomEvent('studio-' + c)); return; }
    if (!once(c)) return;
    if (c === 'export') import('./modals/export.js').then((m) => m.openExport());
    if (c === 'copy-png') import('./modals/export.js').then((m) => m.copyPng(ed.selected().length > 0));
    if (c === 'undo' && !ed.active()?.isEditing) ed.undo();
    if (c === 'redo' && !ed.active()?.isEditing) ed.redo();
    if (c === 'zoom-in') ed.zoomBy(1.25); if (c === 'zoom-out') ed.zoomBy(0.8); if (c === 'zoom-fit') ed.fit(); if (c === 'zoom-100') ed.setZoom(1);
  });
}
window.addEventListener('error', (e) => { window.ro2.log(String(e.error?.stack || e.message)); });
window.addEventListener('unhandledrejection', (e) => { window.ro2.log(String(e.reason?.stack || e.reason)); });
boot().catch((e) => { console.error(e); document.body.append(h('pre', { style: { color: '#f66', padding: '80px 20px' } }, String(e.stack || e))); });
export { runStudio, toast };
