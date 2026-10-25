// Facet — Models: this computer, the Python engine, and every model with its size, licence and fit.
import { $, $$, esc, toast, menu, fmtBytes, fmtMB, confirmSheet } from './util.js';
import { ic } from './icons.js';
import { S, onChange, go, fit, FIT_LABEL, speed, deviceLabel, refreshModels, refreshEngine, saveSettings } from './app.js';

const F = window.facet;
let root = null, wired = false, showLog = false, logLines = [], focusId = null;

export function show(pane, arg) {
  root = pane;
  pane.classList.remove('flush');
  focusId = arg?.focus || null;
  if (!wired) {
    wired = true;
    onChange((w) => {
      if (w?.log) { logLines.push(w.log); if (logLines.length > 400) logLines.splice(0, logLines.length - 400); const lb = $('#envLog', root); if (lb) { lb.textContent = logLines.join('\n'); lb.scrollTop = lb.scrollHeight; } return; }
      if (S.view !== 'models') return;
      if (w === 'model-progress') updateProgress();
      else if (w === 'models' || w === 'engine' || w === 'settings') render();
    });
  }
  render();
  if (focusId) setTimeout(() => $(`[data-row="${focusId}"]`, root)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60);
}
export function hide() {}

const KIND = { shape: ['3D engines', 'Turn a picture into a mesh.'], image: ['Sketch models', 'Turn a prompt into pictures to build from.'], helper: ['Helpers', 'Needed by every engine.'] };
const KCOL = { triposr: 'a-teal', 'hy3d-mini-turbo': 'a-violet', 'hy3d-mini': 'a-violet', 'hy3d-turbo': 'a-sky', 'hy3d-mv-turbo': 'a-rose', 'sd-turbo': 'a-amber', 'sdxl-turbo': 'a-amber', cutout: 'a-slate' };
const KICO = { shape: 'cube', image: 'sparkle', helper: 'wand' };

function render() {
  const d = deviceLabel();
  const hw = S.hw;
  const e = S.engine || {};
  const accelTxt = S.settings.device === 'cpu' ? 'Set to CPU only in Settings.' : hw?.accel === 'cuda' ? 'PyTorch will use CUDA on your NVIDIA card.' : hw?.accel === 'mps' ? 'PyTorch will use Metal on the Apple GPU.' : 'No CUDA or Metal GPU found, so models run on the processor. TripoSR is the quickest choice here.';
  const total = S.models.filter((m) => m.installed).reduce((n, m) => n + (m.bytes || 0), 0);
  const groups = ['shape', 'image', 'helper'].map((k) => {
    const list = S.models.filter((m) => m.kind === k);
    return `<div class="section-title"><span class="grow">${KIND[k][0]} <span class="muted" style="font-weight:500">· ${KIND[k][1]}</span></span></div><div class="mlist">${list.map(row).join('')}</div>`;
  }).join('');

  let envState, envBtns;
  if (e.running) { envState = `<b>Setting up the engine</b><br><span>${esc(e.msg || '')}</span>`; envBtns = `<button class="btn sm" id="envStop">${ic('stop', 13)}Stop</button>`; }
  else if (e.installed && e.upToDate) { envState = `<b>Engine ready</b><br><span>Python ${esc(e.python || '')} · PyTorch ${esc(e.torch || '')} · ${e.accel === 'cuda' ? 'CUDA' : e.accel === 'mps' ? 'Metal' : 'CPU'}</span>`; envBtns = `<button class="btn sm ghost" id="envRepair">${ic('rotate', 13)}Repair</button>`; }
  else if (e.installed) { envState = '<b>Engine update available</b><br><span>A newer set of libraries ships with this version of Facet.</span>'; envBtns = `<button class="btn sm primary" id="envInstall">${ic('download', 13)}Update engine</button>`; }
  else { envState = `<b>Engine not set up</b><br><span>Facet installs its own private Python and PyTorch (${e.flavor === 'cuda' ? 'about 5 GB with CUDA' : e.flavor === 'mac' ? 'about 1.5 GB' : 'about 1.5 GB'}). Your system is not touched.</span>`; envBtns = `<button class="btn sm primary" id="envInstall">${ic('download', 13)}Set up engine</button>`; }
  if (e.error && !e.running) envState += `<br><span style="color:var(--bad)">${esc(e.error)}</span>`;

  root.innerHTML = `
    <div class="hw-card"><span class="kicon a-violet">${ic('chip', 24)}</span><div><h3>${esc(d.name)}</h3><p>${esc(d.sub)} · ${esc(accelTxt)}</p></div><span class="pill ok">${ic('check', 12)}Fully offline once downloaded</span></div>
    <div class="env-card">
      <div class="env-top"><span class="kicon ${e.installed && e.upToDate ? 'a-teal' : 'a-slate'}">${ic('terminal', 18)}</span><div class="grow">${envState}</div><button class="btn sm ghost" id="envLogBtn">${ic('terminal', 13)}${showLog ? 'Hide log' : 'Log'}</button>${envBtns}</div>
      ${e.running ? `<div class="bar"><i style="width:${Math.round((e.pct || 0) * 100)}%"></i></div>` : ''}
      ${showLog ? `<pre class="logbox" id="envLog">${esc(logLines.join('\n') || 'Nothing logged yet.')}</pre>` : ''}
    </div>
    ${groups}
    <div class="store-line">${ic('folder', 15)}<span>Models are stored in</span><span class="mono grow ellip">${esc(S.info.paths.models)}</span><span>${fmtBytes(total)}</span><button class="btn sm" id="mvModels">Change</button><button class="btn sm ghost" id="openModels">Show</button></div>`;
  wire();
  if (showLog && !logLines.length) F.engine.log().then((t) => { logLines = t.split('\n').slice(-400); const lb = $('#envLog', root); if (lb) { lb.textContent = logLines.join('\n'); lb.scrollTop = lb.scrollHeight; } });
}

function row(m) {
  const f = fit(m);
  const [cls, label] = FIT_LABEL[f];
  const dl = m.downloading;
  let act;
  if (dl) {
    const pct = dl.total ? dl.got / dl.total : 0;
    act = `<div class="small muted" data-prog="${m.id}">${fmtBytes(dl.got)} of ${fmtBytes(dl.total)}</div><div class="bar"><i data-bar="${m.id}" style="width:${Math.round(pct * 100)}%"></i></div><button class="btn xs" data-cancel="${m.id}">${ic('x', 12)}Stop</button>`;
  } else if (m.installed) {
    act = `<span class="pill ok">${ic('check', 12)}Downloaded</span><div class="row"><span class="small muted">${fmtBytes(m.bytes)}</span><button class="icon-btn sm" data-more="${m.id}">${ic('more', 16)}</button></div>`;
  } else {
    act = `<button class="btn sm ${m.recommended || m.required ? 'primary' : ''}" data-dl="${m.id}">${ic('download', 14)}Download · ${fmtMB(m.sizeMB)}</button>${m.error ? `<span class="small" style="color:var(--bad)">${esc(m.error)}</span>` : ''}`;
  }
  return `<div class="mrow" data-row="${m.id}" ${focusId === m.id ? 'style="border-color:color-mix(in srgb,var(--acc) 60%,transparent)"' : ''}>
    <span class="kicon ${KCOL[m.id] || 'a-violet'}">${ic(KICO[m.kind], 18)}</span>
    <div class="grow"><div class="m-title"><b>${esc(m.name)}</b><span class="pill acc">${esc(m.label)}</span>${m.colors ? '<span class="pill info">Colour</span>' : ''}${m.multiview ? '<span class="pill">2–4 photos</span>' : ''}</div>
      <div class="m-blurb">${esc(m.blurb)}</div>
      <div class="m-meta"><span class="pill ${cls}">${esc(label)}</span>${speed(m) ? `<span>${ic('clock', 12)} ${esc(speed(m))}</span>` : ''}<a href="#" data-lic="${esc(m.licenseUrl)}">${esc(m.license)} licence</a>${m.licenseNote ? `<span>${esc(m.licenseNote)}</span>` : ''}</div>
    </div>
    <div class="m-act">${act}</div></div>`;
}

function updateProgress() {
  for (const m of S.models) {
    if (!m.downloading) continue;
    const p = $(`[data-prog="${m.id}"]`, root), b = $(`[data-bar="${m.id}"]`, root);
    if (!p || !b) { render(); return; }
    p.textContent = `${fmtBytes(m.downloading.got)} of ${fmtBytes(m.downloading.total)}`;
    b.style.width = Math.round((m.downloading.total ? m.downloading.got / m.downloading.total : 0) * 100) + '%';
  }
}

function wire() {
  const i = $('#envInstall', root); if (i) i.onclick = async () => { await F.engine.install({}); refreshEngine(); };
  const r = $('#envRepair', root); if (r) r.onclick = async () => { if (await confirmSheet({ title: 'Repair the engine?', text: 'Facet reinstalls its private Python environment from scratch. Your models and library stay as they are.', ok: 'Repair' })) { await F.engine.install({ repair: true }); refreshEngine(); } };
  const s = $('#envStop', root); if (s) s.onclick = () => F.engine.cancel();
  $('#envLogBtn', root).onclick = () => { showLog = !showLog; render(); };
  for (const b of $$('[data-dl]', root)) b.onclick = async () => { b.disabled = true; await F.models.download(b.dataset.dl); setTimeout(refreshModels, 300); };
  for (const b of $$('[data-cancel]', root)) b.onclick = () => F.models.cancel(b.dataset.cancel);
  for (const a of $$('[data-lic]', root)) a.onclick = (e) => { e.preventDefault(); F.openExternal(a.dataset.lic); };
  for (const b of $$('[data-more]', root)) b.onclick = () => {
    const m = S.models.find((x) => x.id === b.dataset.more);
    menu(b, [
      { icon: 'external', text: 'Model page', run: () => F.openExternal(m.repo ? `https://huggingface.co/${m.repo}` : m.licenseUrl) },
      { icon: 'download', text: 'Check files again', run: () => F.models.download(m.id).then(() => setTimeout(refreshModels, 300)) },
      '-',
      { icon: 'trash', text: `Remove (${fmtBytes(m.bytes)})`, danger: true, run: async () => {
        if (!await confirmSheet({ title: `Remove ${m.name}?`, text: 'Its files are deleted from this computer. You can download it again any time.', ok: 'Remove', danger: true })) return;
        try { await F.models.remove(m.id); toast(`${m.name} removed`); } catch (e) { toast('Could not remove', e.message, 'bad'); }
        refreshModels();
      } }
    ]);
  };
  $('#openModels', root).onclick = () => F.openPath(S.info.paths.models);
  $('#mvModels', root).onclick = async () => {
    if (S.models.some((m) => m.downloading)) { toast('Wait for downloads to finish', '', 'info'); return; }
    const dir = await F.chooseFolder('Choose where Facet keeps its models', S.info.paths.models);
    if (!dir) return;
    if (!await confirmSheet({ title: 'Use this folder for models?', text: `New downloads go to <b>${esc(dir)}</b>. Models already downloaded stay where they are; move their folders across yourself if you want to keep them.`, ok: 'Use folder' })) return;
    await saveSettings({ modelsDir: dir });
    S.info = await F.info();
    refreshModels();
  };
}
