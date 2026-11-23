// Mural — the page inside each wallpaper window: plays whatever the host sends, forwards cursor and clicks to it.
import { createPlayer } from './runtime/player.js';

const H = window.muralHost;
const stage = document.getElementById('stage'), hud = document.getElementById('hud');
let player = null, loading = 0, cfg = {}, paused = false, quality = { fps: 30, scale: 1 };

H.onLoad(async (c) => {
  cfg = c; quality = c.quality || quality; const my = ++loading;
  if (player) { player.destroy(); player = null; }
  try {
    const p = await createPlayer(stage, { manifest: c.manifest, base: c.base, fps: quality.fps, scale: quality.scale, location: c.location, hour: c.hour ?? null, onStats: report, onError: (e) => H.error(e) });
    if (my !== loading) { p.destroy(); return; }
    player = p; if (paused) player.pause();
  } catch (e) { H.error(e.message || String(e)); }
  hud.style.display = c.showStats ? 'block' : 'none';
});
function report(s) { H.stats(s); if (cfg.showStats) hud.textContent = `${s.fps} fps · ${s.ms} ms/frame${s.particles ? ' · ' + s.particles + ' particles' : ''} · ${quality.fps} cap`; }
H.onPointer((p) => { if (player && !paused) player.pointer(p.x, p.y, p.inside); });
H.onClick((p) => { if (player && !paused) player.click(p.x, p.y, p.button); });
H.onPause(() => { paused = true; if (player) player.pause(); });
H.onResume(() => { paused = false; if (player) player.resume(); });
H.onQuality((q) => { quality = q; if (player) player.setQuality(q); });
H.onSettings((s) => { if (player && s.location !== undefined) player.setLocation(s.location); if (s.showStats !== undefined) { cfg.showStats = s.showStats; hud.style.display = s.showStats ? 'block' : 'none'; } });
// in the e2e run the wallpaper window is a normal window: let real mouse events through too
window.addEventListener('mousemove', (e) => { if (player && window.__muralLocalInput) player.pointer(e.clientX / innerWidth, e.clientY / innerHeight, true); });
window.addEventListener('mousedown', (e) => { if (player && window.__muralLocalInput) player.click(e.clientX / innerWidth, e.clientY / innerHeight, e.button); });
window.__muralPlayer = () => player;
