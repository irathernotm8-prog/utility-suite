// Atoll — Now Playing on macOS. Music and Spotify answer Apple Events; asking `running()` first means polling
// never launches either app. Artwork: Spotify gives a URL, Music hands over the raw image, which goes to a file.
// (macOS 15.4 closed the private system-wide Now Playing API to other apps, so browsers aren't covered here.)
'use strict';
const fs = require('fs');
const { run } = require('../../platform/run');

const jxa = (src, args = [], timeout = 6000) => run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', src, ...args], { timeout });
const as = (lines, args = [], timeout = 6000) => run('/usr/bin/osascript', [...lines.flatMap((l) => ['-e', l]), ...args], { timeout });

const POLL = `
function info(name) {
  try {
    var a = Application(name);
    if (!a.running()) return null;
    var st = String(a.playerState());
    var o = { player: name, state: st };
    if (st === 'stopped') return o;
    var t = a.currentTrack;
    o.title = t.name(); o.artist = t.artist(); o.album = t.album();
    o.duration = Number(t.duration()) || 0;
    o.position = Number(a.playerPosition()) || 0;
    try { o.volume = a.soundVolume(); } catch (e) {}
    if (name === 'Spotify') { o.duration = o.duration / 1000; try { o.art = t.artworkUrl(); } catch (e) {} try { o.id = t.id(); } catch (e) {} }
    else { try { o.id = String(t.persistentID()); } catch (e) {} }
    return o;
  } catch (e) { return { player: name, error: String(e) }; }
}
function run(argv) { var names = JSON.parse(argv[0]); var out = []; for (var i = 0; i < names.length; i++) out.push(info(names[i])); return JSON.stringify(out); }`;

const SAFE = new Set(['Music', 'Spotify']);
const app = (name) => (SAFE.has(name) ? name : 'Music');

async function poll(players) {
  const names = (players || ['Music', 'Spotify']).filter((n) => SAFE.has(n));
  if (!names.length) return [];
  const r = await jxa(POLL, [JSON.stringify(names)]);
  if (!r.ok) return [{ error: r.error || r.stderr }];
  try { return JSON.parse(r.stdout.trim()).filter(Boolean); } catch { return []; }
}

async function command(player, cmd, value) {
  const a = app(player);
  const line = {
    toggle: 'playpause', play: 'play', pause: 'pause', next: 'next track', prev: 'previous track',
    seek: `set player position to ${Math.max(0, Number(value) || 0)}`,
    volume: `set sound volume to ${Math.round(Math.max(0, Math.min(100, Number(value) || 0)))}`,
    shuffle: a === 'Spotify' ? 'set shuffling to not shuffling' : 'set shuffle enabled to not shuffle enabled'
  }[cmd];
  if (!line) return { ok: false };
  return as([`tell application "${a}" to ${line}`]);
}

/** Music's artwork for the current track, written to `file`. true if there was one. */
async function musicArt(file) {
  const r = await as([
    'on run argv',
    'tell application "Music"',
    'try',
    'set d to raw data of artwork 1 of current track',
    'on error',
    'return "none"',
    'end try',
    'end tell',
    'set fh to open for access (POSIX file (item 1 of argv)) with write permission',
    'set eof fh to 0',
    'write d to fh',
    'close access fh',
    'return "ok"',
    'end run'
  ], [file], 8000);
  return r.ok && r.stdout.trim() === 'ok' && fs.existsSync(file);
}

async function getVolume() {
  const r = await as(['set s to get volume settings', 'return ((output volume of s) as text) & "," & ((output muted of s) as text)']);
  const [v, m] = r.stdout.trim().split(','); return { volume: Number.isFinite(Number(v)) ? Number(v) : null, muted: m === 'true' };
}
const setVolume = (v) => as([`set volume output volume ${Math.round(Math.max(0, Math.min(100, Number(v) || 0)))}`]);
const setMute = (m) => as([`set volume output muted ${m ? 'true' : 'false'}`]);
const openPlayer = (name) => run('/usr/bin/open', ['-a', app(name)]);

module.exports = { poll, command, musicArt, getVolume, setVolume, setMute, openPlayer, POLL };
