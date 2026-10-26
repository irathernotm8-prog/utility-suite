// Atoll — a pretend music player for tests and ATOLL_DEMO=1 (and for Linux, which has neither backend).
'use strict';
const TRACKS = [
  { title: 'Midnight City', artist: 'M83', album: "Hurry Up, We're Dreaming", duration: 243, hue: 280 },
  { title: 'Nights', artist: 'Frank Ocean', album: 'Blonde', duration: 307, hue: 30 },
  { title: 'Redbone', artist: 'Childish Gambino', album: 'Awaken, My Love!', duration: 327, hue: 350 }
];
let i = 0, playing = true, pos = 71, at = Date.now(), vol = 62, muted = false;
const now = () => (playing ? pos + (Date.now() - at) / 1000 : pos);
function tick() { if (now() >= TRACKS[i].duration) { i = (i + 1) % TRACKS.length; pos = 0; at = Date.now(); } }

async function poll() {
  tick(); const t = TRACKS[i];
  return [{ player: 'Music', state: playing ? 'playing' : 'paused', title: t.title, artist: t.artist, album: t.album, duration: t.duration, position: now(), id: `demo-${i}`, hasArt: true, volume: vol }];
}
async function command(_p, cmd, v) {
  const p = now();
  if (cmd === 'toggle') { pos = p; at = Date.now(); playing = !playing; }
  if (cmd === 'play') { pos = p; at = Date.now(); playing = true; }
  if (cmd === 'pause') { pos = p; playing = false; }
  if (cmd === 'next') { i = (i + 1) % TRACKS.length; pos = 0; at = Date.now(); }
  if (cmd === 'prev') { if (p > 3) pos = 0; else i = (i + TRACKS.length - 1) % TRACKS.length; pos = 0; at = Date.now(); }
  if (cmd === 'seek') { pos = Number(v) || 0; at = Date.now(); }
  if (cmd === 'volume') vol = Number(v);
  return { ok: true };
}
/** Draws a gradient "album cover" so the island has artwork to show. */
function artSvg() {
  const h = TRACKS[i].hue;
  return 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},85%,62%)"/><stop offset="1" stop-color="hsl(${(h + 60) % 360},80%,38%)"/></linearGradient><radialGradient id="r" cx=".3" cy=".25" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><rect width="256" height="256" fill="url(#g)"/><rect width="256" height="256" fill="url(#r)"/><circle cx="170" cy="160" r="54" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="10"/></svg>`).toString('base64');
}
async function getVolume() { return { volume: vol, muted }; }
async function setVolume(v) { vol = Number(v); }
async function setMute(m) { muted = !!m; }
module.exports = { poll, command, artSvg, getVolume, setVolume, setMute };
