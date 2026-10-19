// Crate — getting songs onto a phone: Apple Music (then sync to iPhone) or any folder / USB drive / Android phone
const fs = require('fs');
const os = require('os');
const path = require('path');
const library = require('./library');

function appleMusicFolder() {
  const home = os.homedir();
  const candidates = process.platform === 'darwin'
    ? [path.join(home, 'Music', 'Music', 'Media.localized', 'Automatically Add to Music.localized'),
       path.join(home, 'Music', 'Music', 'Media', 'Automatically Add to Music.localized'),
       path.join(home, 'Music', 'Music', 'Media', 'Automatically Add to Music')]
    : process.platform === 'win32'
      ? [path.join(home, 'Music', 'iTunes', 'iTunes Media', 'Automatically Add to iTunes'),
         path.join(home, 'Music', 'Apple Music', 'Media', 'Automatically Add to Apple Music')]
      : [];
  return candidates.find((p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } }) || null;
}

function targets() {
  const am = appleMusicFolder();
  return {
    appleMusic: am ? { path: am, label: process.platform === 'win32' ? (am.includes('iTunes') ? 'iTunes' : 'Apple Music') : 'Apple Music' } : null,
    platform: process.platform
  };
}

const sameFile = (a, b) => { try { const x = fs.statSync(a); const y = fs.statSync(b); return x.size === y.size; } catch { return false; } };

/**
 * mode 'apple'  → copies into "Automatically Add to Music" (Music imports and files them; Crate tracks what it already sent)
 * mode 'folder' → mirrors Artist/Album/NN Title.mp3 (or flat) into `folder`, plus .m3u8 playlists
 */
async function run({ mode, folder, trackIds, playlistIds = [], onlyNew = false, structure = 'artist-album', playlists = true, onProgress, signal }) {
  const all = new Map(library.all().map((t) => [t.id, t]));
  const ids = [...new Set(trackIds)].filter((id) => all.has(id));
  const targetKey = mode === 'apple' ? 'apple' : `folder:${folder}`;
  const sent = library.exportedAt(targetKey);
  const dest = mode === 'apple' ? appleMusicFolder() : folder;
  if (!dest) throw new Error(mode === 'apple' ? 'Couldn\'t find the Music app\'s "Automatically Add" folder. Open the Music app once, then try again.' : 'Choose a folder first.');
  fs.mkdirSync(dest, { recursive: true });
  const todo = ids.filter((id) => !(onlyNew && sent[id] && sent[id] >= (all.get(id).modifiedAt || 0)));
  let copied = 0; let skipped = ids.length - todo.length; const failed = []; const done = [];
  const relFor = new Map();
  for (let i = 0; i < todo.length; i++) {
    if (signal && signal.aborted) break;
    const t = all.get(todo[i]);
    onProgress && onProgress({ index: i, total: todo.length, name: t.title });
    try {
      const src = library.abs(t.file);
      let rel;
      if (mode === 'apple') rel = library.sanitize(`${t.artist || 'Unknown'} - ${t.title}`) + '.mp3';
      else rel = structure === 'flat' ? library.sanitize(`${t.artist || 'Unknown'} - ${t.title}`) + '.mp3' : t.file;
      const out = path.join(dest, ...rel.split('/'));
      relFor.set(t.id, rel);
      if (mode !== 'apple' && sameFile(src, out) && sent[t.id] && sent[t.id] >= (t.modifiedAt || 0)) { skipped++; done.push(t.id); continue; }
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await fs.promises.copyFile(src, out);
      copied++; done.push(t.id);
    } catch (e) { failed.push({ title: t.title, error: e.message }); }
  }
  for (const id of ids) if (!relFor.has(id)) { const t = all.get(id); relFor.set(id, structure === 'flat' ? library.sanitize(`${t.artist || 'Unknown'} - ${t.title}`) + '.mp3' : t.file); }
  library.markExported(targetKey, done);

  let lists = 0;
  if (mode === 'folder' && playlists) {
    for (const pl of library.playlists().filter((p) => playlistIds.includes(p.id))) {
      const lines = ['#EXTM3U', `#PLAYLIST:${pl.name}`];
      for (const id of pl.trackIds) {
        const t = all.get(id); if (!t || !relFor.has(id)) continue;
        lines.push(`#EXTINF:${Math.round(t.duration || 0)},${t.artist ? t.artist + ' - ' : ''}${t.title}`);
        lines.push(relFor.get(id));
      }
      fs.writeFileSync(path.join(dest, library.sanitize(pl.name) + '.m3u8'), lines.join('\n') + '\n');
      lists++;
    }
  }
  onProgress && onProgress({ index: todo.length, total: todo.length, done: true });
  return { copied, skipped, failed, playlists: lists, dest };
}

module.exports = { targets, run, appleMusicFolder };
