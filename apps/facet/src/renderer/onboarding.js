// Facet — first launch: explain the on-device promise, size up this computer, pick a starter set.
import { $, $$, esc, sheet, fmtMB } from './util.js';
import { ic } from './icons.js';
import { S, go, fit, deviceLabel, saveSettings, refreshModels, refreshEngine } from './app.js';

const F = window.facet;

export function maybeOnboard() {
  if (S.settings.setupDone) return;
  const strong = ['great'].includes(fit(S.models.find((m) => m.id === 'hy3d-mini-turbo')));
  const packs = [
    { id: 'starter', name: 'Starter', blurb: 'Fast engine with colour, quick prompt sketches, background remover.', models: ['triposr', 'sd-turbo', 'cutout'] },
    { id: 'full', name: 'Recommended', blurb: 'Starter plus Hunyuan3D 2 mini Turbo for much sharper shapes.', models: ['triposr', 'hy3d-mini-turbo', 'sd-turbo', 'cutout'] },
    { id: 'none', name: 'I’ll choose', blurb: 'Set up the engine only and pick models yourself in Models.', models: [] }
  ];
  let pick = strong ? 'full' : 'starter';
  const env = S.engine?.flavor === 'cuda' ? 4800 : 1500;
  const size = (p) => p.models.reduce((n, id) => n + (S.models.find((m) => m.id === id)?.sizeMB || 0), 0) + (S.engine?.installed ? 0 : env);
  const d = deviceLabel();
  const s = sheet({
    title: 'Welcome to Facet',
    sub: 'Make 3D models from a prompt or a picture, right here on this computer.',
    body: `<div class="welcome-art"><img src="../../build/icon.png" alt=""></div>
      <div class="promise">
        <div><b>${ic('chip', 14)}Your hardware</b>${esc(d.name)} does the work</div>
        <div><b>${ic('check', 14)}No tokens</b>Nothing is billed, nothing is uploaded</div>
        <div><b>${ic('download', 14)}One download</b>Then it works offline</div>
      </div>
      <div class="label">Pick a starting set ${strong ? '' : '<span class="muted" style="font-weight:500">· Recommended may be slow on this computer</span>'}</div>
      <div class="packs">${packs.map((p) => `<button class="pack ${p.id === pick ? 'on' : ''}" data-p="${p.id}"><span class="radio"></span><div><b>${esc(p.name)}</b><span>${esc(p.blurb)}</span></div><div class="p-size">${fmtMB(size(p))}<br>to download</div></button>`).join('')}</div>
      <div class="hint">Includes Facet’s private Python and PyTorch. Everything goes into Facet’s own app folder and can be removed from Models.</div>`,
    foot: `<button class="btn ghost" id="obLater">Later</button><div class="grow"></div><button class="btn primary lg" id="obGo">${ic('download', 16)}Set up Facet</button>`
  });
  for (const b of $$('.pack', s.el)) b.onclick = () => { pick = b.dataset.p; for (const x of $$('.pack', s.el)) x.classList.toggle('on', x === b); };
  $('#obLater', s.el).onclick = async () => { await saveSettings({ setupDone: true }); s.close(); };
  $('#obGo', s.el).onclick = async () => {
    const p = packs.find((x) => x.id === pick);
    await saveSettings({ setupDone: true, create: { engine: p.models.includes('hy3d-mini-turbo') ? 'hy3d-mini-turbo' : 'triposr' } });
    s.close();
    if (!S.engine?.installed || !S.engine?.upToDate) await F.engine.install({});
    for (const id of p.models) await F.models.download(id);
    await Promise.all([refreshEngine(), refreshModels()]);
    go('models');
  };
}
