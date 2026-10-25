// Facet — Settings: look, folders, engine behaviour, export defaults, about.
import { $, $$, esc, toast, sheet } from './util.js';
import { ic } from './icons.js';
import { S, onChange, saveSettings, refreshSettings, refreshEngine, refreshLibrary } from './app.js';

const F = window.facet;
let root = null, wired = false;

export function show(pane, arg) {
  root = pane;
  pane.classList.remove('flush');
  if (!wired) { wired = true; onChange((w) => { if (w === 'settings' && S.view === 'settings') render(); }); }
  render();
  if (arg?.log) openLog();
}
export function hide() {}

function render() {
  const s = S.settings;
  const p = S.info.paths;
  root.innerHTML = `<div class="set-wrap">
    <div class="section-title">Appearance</div>
    <div class="set-group">
      <div class="set-row"><div class="grow"><b>Theme</b><span>Follow the system, or pick one</span></div><div class="seg" id="theme">${[['system', 'System'], ['dark', 'Dark'], ['light', 'Light']].map(([k, l]) => `<button data-v="${k}" class="${s.theme === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    </div>

    <div class="section-title">Folders</div>
    <div class="set-group">
      <div class="set-row"><div class="grow"><b>Library</b><span class="mono ellip">${esc(p.output)}</span></div><button class="btn sm ghost" data-open="${esc(p.output)}">Show</button><button class="btn sm" id="chOut">Change</button></div>
      <div class="set-row"><div class="grow"><b>Models</b><span class="mono ellip">${esc(p.models)}</span></div><button class="btn sm ghost" data-open="${esc(p.models)}">Show</button></div>
      <div class="set-row"><div class="grow"><b>Engine</b><span class="mono ellip">${esc(p.engine)}</span></div><button class="btn sm ghost" data-open="${esc(p.engine)}">Show</button></div>
    </div>

    <div class="section-title">Engine</div>
    <div class="set-group">
      <div class="set-row"><div class="grow"><b>Run on</b><span>Auto uses the NVIDIA or Apple GPU when there is one</span></div><div class="seg" id="device">${[['auto', 'Auto'], ['cpu', 'CPU only']].map(([k, l]) => `<button data-v="${k}" class="${s.device === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="set-row"><div class="grow"><b>Keep models loaded</b><span>Faster repeat runs. Turn off to free memory after each model.</span></div><button class="switch ${s.keepLoaded ? 'on' : ''}" id="keep"></button></div>
      <div class="set-row"><div class="grow"><b>Restart the engine</b><span>Frees all memory the engine is holding</span></div><button class="btn sm" id="restart">${ic('rotate', 13)}Restart</button></div>
      <div class="set-row"><div class="grow"><b>Engine log</b><span>What the engine printed, for troubleshooting</span></div><button class="btn sm" id="log">${ic('terminal', 13)}Open log</button></div>
    </div>

    <div class="section-title">Export</div>
    <div class="set-group">
      <div class="set-row"><div class="grow"><b>STL height</b><span>How tall exported STL files are, for 3D printing</span></div><input class="input" id="stlH" type="number" min="5" max="2000" style="width:90px" value="${s.export.stlHeight}"><span class="muted">mm</span></div>
    </div>

    <div class="section-title">About</div>
    <div class="set-group">
      <div class="set-row"><div class="grow"><b>Facet ${esc(S.info.version)}</b><span>Every model runs on this computer. Prompts, pictures and models never leave it, and nothing is billed per use.</span></div></div>
      <div class="set-row"><div class="grow"><b>Open-source parts</b><span>TripoSR (MIT, Stability AI & Tripo), Hunyuan3D 2 (Tencent Hunyuan Community licence), SD Turbo and SDXL Turbo (Stability AI Community licence), IS-Net background removal (Apache 2.0), three.js (MIT), PyTorch, diffusers, trimesh.</span></div></div>
    </div>
  </div>`;
  for (const b of $$('#theme button', root)) b.onclick = () => saveSettings({ theme: b.dataset.v });
  for (const b of $$('#device button', root)) b.onclick = async () => { await saveSettings({ device: b.dataset.v }); toast('Engine will restart', b.dataset.v === 'cpu' ? 'Models now run on the processor' : 'Using the GPU when available', 'info'); refreshEngine(); };
  $('#keep', root).onclick = () => saveSettings({ keepLoaded: !s.keepLoaded });
  $('#restart', root).onclick = async () => { await F.engine.restart(); toast('Engine restarted', 'Memory freed', 'ok'); };
  $('#log', root).onclick = openLog;
  const h = $('#stlH', root); h.onchange = () => { const v = Math.max(5, Math.min(2000, Number(h.value) || 100)); saveSettings({ export: { ...s.export, stlHeight: v } }); };
  for (const b of $$('[data-open]', root)) b.onclick = () => F.openPath(b.dataset.open);
  $('#chOut', root).onclick = async () => {
    const dir = await F.chooseFolder('Choose the Facet library folder', p.output);
    if (!dir) return;
    await saveSettings({ outputDir: dir });
    await refreshSettings();
    await refreshLibrary();
    toast('Library folder changed', 'New models are saved there');
  };
}

async function openLog() {
  const text = await F.engine.log();
  const s = sheet({ title: 'Engine log', sub: 'The last lines printed by the setup and the 3D engine', wide: true, body: `<pre class="logbox" style="max-height:60vh">${esc(text || 'Nothing logged yet.')}</pre>`, foot: `<div class="grow"></div><button class="btn" id="lgShow">${ic('folder', 14)}Show file</button><button class="btn primary" data-close2>Done</button>` });
  const lb = $('.logbox', s.el); lb.scrollTop = lb.scrollHeight;
  $('#lgShow', s.el).onclick = () => F.reveal(S.info.paths.engine + (S.info.platform === 'win32' ? '\\' : '/') + 'engine.log');
  $('[data-close2]', s.el).onclick = s.close;
}
