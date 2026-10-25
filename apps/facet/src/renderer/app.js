// Facet — window shell: state, navigation, the sidebar power card and live events.
import { $, $$, esc, toast } from './util.js';
import { ic } from './icons.js';
import * as Create from './create.js';
import * as Library from './library.js';
import * as Models from './models.js';
import * as Settings from './settings.js';
import { maybeOnboard } from './onboarding.js';

const F = window.facet;
export const S = { info: null, settings: null, hw: null, engine: null, models: [], jobs: new Map(), library: [], view: 'create' };
const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const changed = (what) => { for (const fn of listeners) { try { fn(what); } catch (e) { console.error(e); } } };

const VIEWS = { create: Create, library: Library, models: Models, settings: Settings };
const TITLES = { create: ['Create', 'from a prompt or a picture'], library: ['Library', ''], models: ['Models', 'everything runs on this computer'], settings: ['Settings', ''] };

export function setHead(left, right = '') { $('#headLeft').innerHTML = left; $('#headRight').innerHTML = right; }
export function defaultHead(view) {
  const [t, sub] = TITLES[view];
  setHead(`<h1>${esc(t)}${sub ? `<small>${esc(sub)}</small>` : ''}</h1>`);
}

export function go(view, arg) {
  if (!VIEWS[view]) return;
  const prev = S.view;
  S.view = view;
  for (const b of $$('#nav button')) b.classList.toggle('on', b.dataset.view === view);
  for (const p of $$('.pane')) p.hidden = p.dataset.pane !== view;
  if (prev !== view) VIEWS[prev]?.hide?.();
  defaultHead(view);
  VIEWS[view].show($(`.pane[data-pane="${view}"]`), arg);
}

/* ── shared helpers about models and hardware ── */
export const model = (id) => S.models.find((m) => m.id === id);
export const installed = (id) => !!model(id)?.installed;
export const accel = () => (S.settings?.device === 'cpu' ? 'cpu' : S.hw?.accel || 'cpu');
export function fit(m) {
  const a = accel();
  if (!m?.needs) return 'great';
  if (a === 'cuda') { const g = (S.hw.vramMB || 0) / 1024; return g >= m.needs.cudaGB ? 'great' : g >= m.needs.cudaGB * 0.6 ? 'tight' : 'heavy'; }
  if (a === 'mps') { const g = (S.hw.ramMB || 0) / 1024; return g >= m.needs.macGB ? 'great' : g >= m.needs.macGB * 0.66 ? 'tight' : 'heavy'; }
  return m.needs.cpu === 'ok' ? 'ok' : m.needs.cpu === 'slow' ? 'slow' : 'heavy';
}
export const FIT_LABEL = { great: ['ok', 'Runs well here'], ok: ['ok', 'Runs on the CPU'], tight: ['warn', 'Tight on memory'], slow: ['warn', 'Slow on the CPU'], heavy: ['bad', 'Very slow here'] };
export const speed = (m) => m?.speed?.[accel()] || '';
export function deviceLabel() {
  const hw = S.hw;
  if (!hw) return { name: 'Checking…', sub: '' };
  const gb = (mb) => Math.round(mb / 1024) + ' GB';
  if (S.settings?.device === 'cpu') return { name: 'CPU only', sub: `${hw.cores} cores · ${gb(hw.ramMB)} memory` };
  if (hw.accel === 'cuda') return { name: hw.best.name.replace(/^NVIDIA\s+/i, '').replace(/GeForce\s+/i, ''), sub: `NVIDIA CUDA · ${gb(hw.vramMB)} graphics memory` };
  if (hw.accel === 'mps') return { name: (hw.chip || 'Apple Silicon').replace(/^Apple\s+/, 'Apple '), sub: `Metal GPU · ${gb(hw.ramMB)} unified memory` };
  return { name: 'CPU', sub: `${hw.cores} cores · ${gb(hw.ramMB)} memory${hw.gpus?.length ? ' · no CUDA GPU' : ''}` };
}

/* ── refreshers ── */
export async function refreshModels() { S.models = await F.models.list(); changed('models'); renderCounts(); }
export async function refreshEngine() { S.engine = await F.engine.status(); changed('engine'); renderPower(); }
export async function refreshLibrary() { S.library = await F.library.list(); changed('library'); renderCounts(); }
export async function refreshSettings() { S.info = await F.info(); S.settings = S.info.settings; applyTheme(); changed('settings'); renderPower(); }
export async function saveSettings(p) { S.settings = await F.settings(p); S.info.settings = S.settings; applyTheme(); changed('settings'); renderPower(); return S.settings; }

function applyTheme() {
  const t = S.settings?.theme || 'system';
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

function renderCounts() {
  $('#libCount').textContent = S.library.length || '';
  const dl = S.models.filter((m) => m.downloading).length;
  const mc = $('#modelsCount');
  mc.textContent = dl ? `${dl}↓` : (S.engine?.running ? '…' : '');
  mc.classList.toggle('live', !!dl || !!S.engine?.running);
}

export function renderPower() {
  const d = deviceLabel();
  const env = S.engine;
  const running = [...S.jobs.values()].find((j) => j.status === 'running');
  let state = '<span class="dot"></span>Engine not set up';
  if (env?.running) state = '<span class="dot busy"></span>Setting up the engine';
  else if (env?.installed && !env.upToDate) state = '<span class="dot warn"></span>Engine needs an update';
  else if (env?.installed) state = `<span class="dot ${running ? 'busy' : 'on'}"></span>${running ? 'Working' : 'Ready'}`;
  $('#powerCard').innerHTML = `
    <div class="pc-dev"><span class="chipbox">${ic('chip', 16)}</span><div class="grow"><b class="ellip">${esc(d.name)}</b><span class="ellip">${esc(d.sub)}</span></div></div>
    <div class="pc-top">${state}</div>
    ${running ? `<div class="pc-job"><div class="pc-line"><span class="ellip">${esc(running.kind === 'imagine' ? 'Sketching ideas' : running.name || 'Making a model')}</span><b>${Math.round((running.pct || 0) * 100)}%</b></div><div class="bar"><i style="width:${Math.round((running.pct || 0) * 100)}%"></i></div></div>` : ''}
    <div class="local-badge">${ic('check', 13)}On this computer · no tokens, no uploads</div>`;
  $('#powerCard').onclick = () => go('models');
  renderCounts();
}

/* ── drag & drop anywhere ── */
function wireDrop() {
  let depth = 0;
  const veil = $('#dropVeil');
  $('.veil-ic', veil).innerHTML = ic('gem', 40);
  addEventListener('dragenter', (e) => { if (!e.dataTransfer?.types?.includes('Files')) return; depth++; veil.classList.add('on'); });
  addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) veil.classList.remove('on'); });
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', async (e) => {
    e.preventDefault(); depth = 0; veil.classList.remove('on');
    if (e.defaultPrevented && e._handled) return;
    const files = [...(e.dataTransfer?.files || [])].map((f) => F.pathFor(f)).filter(Boolean);
    if (!files.length) return;
    const models3d = files.filter((p) => /\.(glb|obj|stl|ply)$/i.test(p));
    const images = files.filter((p) => /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(p));
    if (models3d.length) {
      const close = toast('Adding to your library', models3d.length + ' file' + (models3d.length > 1 ? 's' : ''), 'busy', 0);
      try { await F.library.import(models3d); close(); toast('Added to your library'); await refreshLibrary(); go('library'); }
      catch (err) { close(); toast('Could not add that file', err.message, 'bad'); }
    } else if (images.length) {
      go('create');
      Create.useImages(images);
    }
  });
}

/* ── live events ── */
function wireEvents() {
  F.on.models((e) => {
    if (e.type === 'progress') {
      const m = model(e.id);
      if (m) { m.downloading = { got: e.got, total: e.total, file: e.file }; m.installed = false; }
      changed('model-progress');
      renderCounts();
      return;
    }
    if (e.type === 'done') toast(`${model(e.id)?.name || 'Model'} is ready`, 'Downloaded to this computer');
    if (e.type === 'error') toast(`${model(e.id)?.name || 'Model'} did not download`, e.error, 'bad', 8000);
    refreshModels();
  });
  F.on.engine((e) => {
    if (e.type === 'log') { changed({ log: e.line }); return; }
    if (e.type === 'done') toast('The 3D engine is ready', 'Everything now runs on this computer');
    if (e.type === 'error' && e.error !== 'Stopped') toast('Engine setup stopped', e.error, 'bad', 9000);
    refreshEngine();
  });
  F.on.worker((e) => { if (e.type === 'log') changed({ workerLog: e.line }); if (e.type === 'state') refreshEngine(); });
  F.on.job((j) => {
    S.jobs.set(j.id, j);
    changed({ job: j });
    renderPower();
    if (j.status === 'done' && j.kind === 'make') refreshLibrary();
  });
  F.on.library(() => refreshLibrary());
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
}

async function boot() {
  if (/Win/.test(navigator.platform)) document.documentElement.classList.add('win');
  for (const el of $$('[data-icon]')) el.innerHTML = ic(el.dataset.icon, Number(el.dataset.size) || 17);
  for (const b of $$('#nav button')) b.onclick = () => go(b.dataset.view);
  await refreshSettings();
  [S.hw] = await Promise.all([F.hw(), refreshModels(), refreshEngine(), refreshLibrary()]);
  for (const j of await F.create.jobs()) S.jobs.set(j.id, j);
  wireEvents();
  wireDrop();
  renderPower();
  go('create');
  document.body.classList.add('ready');
  addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && /^[1-4]$/.test(e.key)) { e.preventDefault(); go(['create', 'library', 'models', 'settings'][Number(e.key) - 1]); }
  });
  maybeOnboard();
}
boot().catch((e) => { console.error(e); document.body.classList.add('ready'); toast('Facet could not start', e.message, 'bad', 0); });
