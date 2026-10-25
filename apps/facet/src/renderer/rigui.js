// Facet — rigging sheet (place markers, rig, watch progress) and the "Export for…" presets.
import { $, esc, sheet, toast, menu } from './util.js';
import { ic } from './icons.js';
import { RigEditor, MARKERS } from './rig-editor.js';
import { S, onChange, refreshLibrary } from './app.js';

const F = window.facet;

export function openRig(project, onDone) {
  let editor = null, markers = null, guessed = null, job = null, off = null;
  const s = sheet({
    title: project.rig ? `Re-rig ${project.name}` : `Rig ${project.name}`,
    sub: 'Give the character a skeleton so it can be posed and animated in Blender, Unity, Unreal, Godot, Roblox or three.js.',
    wide: true,
    body: `<div class="rig-wrap">
      <div class="rig-stage" id="rgStage"><div class="rig-wait"><span class="spin"></span>Finding the joints…</div></div>
      <div class="rig-side">
        <div class="hint">Drag each dot onto the joint. <b>Left</b> is the character’s left, which is on <b>your right</b>.</div>
        <div class="rig-legend">${MARKERS.map(([, l, c]) => `<span><i style="background:${c}"></i>${esc(l)}</span>`).join('')}</div>
        <button class="btn sm" id="rgAuto">${ic('wand', 14)}Place automatically</button>
        <div class="field"><label>Height in engines</label><div class="row"><input class="input" id="rgH" type="number" step="0.05" min="0.1" max="50" value="${project.rig?.heightM || 1.8}" style="width:90px"><span class="muted">metres</span></div><span class="hint">1.8 m is a typical adult. Engines read glTF in metres.</span></div>
        <div class="opt-row"><div class="grow"><b>Add animations</b><span>Idle, Walk and Wave clips to test with</span></div><button class="switch on" id="rgAnim"></button></div>
        <div class="note info">${ic('info', 15)}<div>Bones use Mixamo names, so Unity’s Humanoid avatar, Unreal’s retargeter and Mixamo animations map onto them automatically.</div></div>
        <div class="rig-progress" id="rgProg" hidden><div class="row"><span class="spin"></span><span id="rgMsg">Rigging…</span></div><div class="bar"><i id="rgBar" style="width:0%"></i></div></div>
      </div></div>`,
    foot: `${project.rig ? `<button class="btn ghost danger" id="rgRemove">${ic('trash', 14)}Remove rig</button>` : ''}<div class="grow"></div><button class="btn" data-cancel>Cancel</button><button class="btn primary" id="rgGo" disabled>${ic('bolt', 15)}Rig character</button>`,
    onClose: () => { editor?.dispose(); off?.(); }
  });
  $('[data-cancel]', s.el).onclick = s.close;
  const anim = $('#rgAnim', s.el);
  anim.onclick = () => anim.classList.toggle('on');
  const rm = $('#rgRemove', s.el);
  if (rm) rm.onclick = async () => { await F.library.unrig(project.id); await refreshLibrary(); s.close(); onDone?.(); };

  F.library.rigGuess(project.id).then((g) => {
    markers = g.markers; guessed = g.saved ? null : g.markers;
    const host = $('#rgStage', s.el);
    host.innerHTML = '';
    try {
      editor = new RigEditor(host, project.paths.model, markers, (m) => { markers = m; });
      $('#rgGo', s.el).disabled = false;
    } catch (e) { host.innerHTML = `<div class="rig-wait">${esc('This computer can’t draw the 3D preview, so the markers can’t be shown. Rig with the automatic markers instead.')}</div>`; $('#rgGo', s.el).disabled = false; }
  }).catch((e) => { $('#rgStage', s.el).innerHTML = `<div class="rig-wait" style="color:var(--bad)">${esc(e.message)}</div>`; });

  $('#rgAuto', s.el).onclick = async () => {
    if (!guessed) guessed = (await F.library.rigGuess(project.id, true).catch(() => null))?.markers;
    if (guessed) { markers = JSON.parse(JSON.stringify(guessed)); editor?.set(markers); }
  };

  $('#rgGo', s.el).onclick = async () => {
    $('#rgGo', s.el).disabled = true;
    $('#rgProg', s.el).hidden = false;
    try {
      job = await F.library.rig(project.id, markers, { heightM: Number($('#rgH', s.el).value) || 1.8, animations: anim.classList.contains('on') });
    } catch (e) { toast('Could not rig', e.message, 'bad'); $('#rgGo', s.el).disabled = false; return; }
    const apply = (j) => {
      if (j.id !== job) return;
      const msg = $('#rgMsg', s.el), bar = $('#rgBar', s.el);
      if (msg) msg.textContent = j.msg || 'Rigging…';
      if (bar) bar.style.width = Math.round((j.pct || 0) * 100) + '%';
      if (j.status === 'done') { toast('Rigged', 'Skeleton, skin weights and test animations added'); s.close(); refreshLibrary().then(() => onDone?.(j.project)); }
      else if (j.status === 'failed') { toast('Rigging stopped', j.error, 'bad', 9000); $('#rgGo', s.el).disabled = false; $('#rgProg', s.el).hidden = true; }
    };
    off = onChange((w) => { if (w?.job) apply(w.job); });
    if (S.jobs.get(job)) apply(S.jobs.get(job));
  };
}

/* ── export presets ── */
const PRESETS = [
  { id: 'unity', name: 'Unity', sub: 'GLB · glTFast', tip: 'In Unity, add the glTFast package (Window › Package Manager), then drag the file into Assets. For a rigged character set Rig › Animation Type to Humanoid.' },
  { id: 'unreal', name: 'Unreal Engine', sub: 'GLB', tip: 'Drag the file into the Content Browser (Unreal 5 imports glTF, including skeletons and animations).' },
  { id: 'godot', name: 'Godot', sub: 'GLB', tip: 'Drop the file into your project folder; Godot imports it as a scene with its animations.' },
  { id: 'blender', name: 'Blender', sub: 'GLB', tip: 'File › Import › glTF 2.0. The armature, weights and animations come in ready to pose.' },
  { id: 'roblox', name: 'Roblox', sub: 'GLB · 20k faces', faces: 20000, tip: 'In Studio use Home › Import 3D. Roblox meshes are limited to 20,000 triangles, so the model is reduced to fit (a rigged model is re-rigged at that size).' },
  { id: 'web', name: 'three.js / web', sub: 'GLB · 50k faces', faces: 50000, tip: 'Load it with GLTFLoader; rigged files play their clips through AnimationMixer.' },
  { id: 'print', name: '3D printing', sub: 'STL', tip: 'Open the STL in your slicer (Bambu Studio, PrusaSlicer, Cura). Height is set in Settings › Export.' }
];

export function exportFor(anchor, r) {
  const rigged = !!r.paths?.rigged;
  const go = async (p) => {
    const fmt = p.id === 'print' ? 'stl' : 'glb';
    const opts = { suffix: p.name };
    if (fmt === 'stl') opts.heightMm = S.settings.export.stlHeight;
    else if (rigged) { opts.rigged = true; if (p.faces) opts.faces = p.faces; }
    else if (p.faces && (r.stats?.faces || 0) > p.faces) opts.faces = p.faces;
    const close = toast(`Exporting for ${p.name}`, '', 'busy', 0);
    try {
      const res = await F.library.export(r.id, fmt, opts);
      close();
      if (res) toast(`Ready for ${p.name}`, p.tip, 'info', 12000);
    } catch (e) { close(); toast('Export failed', e.message, 'bad'); }
  };
  menu(anchor, [{ label: rigged ? 'Export for (rigged)' : 'Export for' }, ...PRESETS.map((p) => ({ icon: p.id === 'print' ? 'printer' : 'cube', text: p.name, sub: p.sub, run: () => go(p) }))]);
}
