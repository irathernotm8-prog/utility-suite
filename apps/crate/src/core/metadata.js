// Crate — turning video titles into clean song info, and looking songs/albums up in the iTunes catalog (free, no key)

const NOISE = [
  'official\\s*(music\\s*)?video', 'official\\s*audio', 'official\\s*lyric\\s*video', 'official\\s*visuali[sz]er', 'official\\s*hd\\s*video',
  'official', 'lyric\\s*video', 'lyrics?', 'audio', 'visuali[sz]er', 'music\\s*video', 'video\\s*oficial', 'clip\\s*officiel', 'video',
  'hd', 'hq', '4k', '1080p', '720p', 'm/?v', 'explicit', 'clean', 'dirty', 'full\\s*song', 'out\\s*now', 'premiere', 'with\\s*lyrics', 'color\\s*coded'
];
const NOISE_RE = new RegExp(`\\s*[\\(\\[【]\\s*(?:${NOISE.join('|')})(?:\\s*[-/|,&]\\s*(?:${NOISE.join('|')}))*\\s*[\\)\\]】]`, 'gi');
const SEPS = /\s+[-–—~|]\s+|\s*\|\s*/;

function tidy(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—|:~"'“”]+|[\s\-–—|:~"'“”]+$/g, '')
    .trim();
}

function normFeat(s) {
  return s
    .replace(/\(\s*(?:ft\.?|feat\.?|featuring)\s+([^)]+)\)/gi, '(feat. $1)')
    .replace(/\[\s*(?:ft\.?|feat\.?|featuring)\s+([^\]]+)\]/gi, '(feat. $1)')
    .replace(/\s(?:ft\.?|feat\.?|featuring)\s+(.+)$/i, (m, who) => (/\(feat\./i.test(s) ? m : ` (feat. ${who.trim()})`));
}

function cleanUploader(u) {
  return tidy(String(u || '')
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/VEVO$/i, '')
    .replace(/\s*(?:Official(?:\s+Channel)?|Music|Records)$/i, (m) => (/official/i.test(m) ? '' : m)));
}

/** Split a raw video title into { artist, title }. `uploader` helps when the title has no "Artist - Song". */
function cleanTitle(raw, uploader = '') {
  let t = String(raw || '');
  t = t.replace(NOISE_RE, '');
  t = t.replace(/\s*\(\s*\)|\s*\[\s*\]/g, '');
  t = t.replace(/\s*#\w+/g, '');
  t = t.replace(/\s*(?:\||\/\/)\s*(?:official|lyrics?|audio|video|new|out now|prod\.?|4k|hd|hq)\b.*$/i, '');
  let artist = '';
  let title = t;
  const parts = t.split(SEPS).map(tidy).filter(Boolean);
  if (parts.length >= 2) {
    artist = parts[0];
    title = parts.slice(1).join(' - ');
  }
  // "Song by Artist"
  if (!artist) {
    const by = /^(.+?)\s+by\s+(.+)$/i.exec(t);
    if (by && by[2].length < 40) { title = by[1]; artist = by[2]; }
  }
  // quotes: Artist "Song"
  if (!artist) {
    const q = /^(.+?)\s+["“](.+?)["”]\s*$/.exec(t);
    if (q) { artist = q[1]; title = q[2]; }
  }
  if (!artist) artist = cleanUploader(uploader);
  title = tidy(normFeat(tidy(title.replace(/^["“]|["”]$/g, ''))));
  artist = tidy(artist);
  // move "ft. X" from the artist into the title
  const af = /\s+(?:ft\.?|feat\.?|featuring)\s+(.+)$/i.exec(artist);
  if (af) { artist = tidy(artist.slice(0, af.index)); if (!/feat\./i.test(title)) title = `${title} (feat. ${tidy(af[1])})`; }
  return { artist, title };
}

/** Primary artist for an "Album artist" default: "A, B & C" → "A" */
function primaryArtist(a) { return tidy(String(a || '').split(/\s*(?:,|&| x | and |;|\/)\s*/i)[0]); }

const norm = (s) => String(s || '').toLowerCase()
  .replace(/\(.*?\)|\[.*?\]/g, ' ')
  .replace(/feat\..*$/, ' ')
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

function similarity(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;
  const A = new Set(a.split(' ')); const B = new Set(b.split(' '));
  let hit = 0; for (const w of A) if (B.has(w)) hit++;
  return hit / Math.max(A.size, B.size);
}

function getFetch() {
  if (process.versions.electron) { const { net } = require('electron'); if (net && net.fetch) return net.fetch.bind(net); }
  return fetch;
}

// The catalog allows roughly 20 lookups a minute per connection: queue them, cache answers, back off when told to.
const cache = new Map();
let chain = Promise.resolve();
let last = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function itunes(pathAndQuery) {
  if (cache.has(pathAndQuery)) return Promise.resolve(cache.get(pathAndQuery));
  const job = chain.then(async () => {
    if (cache.has(pathAndQuery)) return cache.get(pathAndQuery);
    for (let attempt = 0; ; attempt++) {
      const wait = last + 400 - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      const res = await getFetch()(`https://itunes.apple.com/${pathAndQuery}`);
      if (res.ok) {
        const out = (await res.json()).results || [];
        cache.set(pathAndQuery, out);
        if (cache.size > 500) cache.delete(cache.keys().next().value);
        return out;
      }
      if ((res.status === 403 || res.status === 429 || res.status >= 500) && attempt < 3) { await sleep([3000, 8000, 20000][attempt]); continue; }
      throw new Error(res.status === 403 || res.status === 429 ? 'The iTunes catalog is busy right now — try again in a minute.' : `Catalog lookup failed (${res.status})`);
    }
  });
  chain = job.catch(() => {});
  return job;
}

const bigArt = (u) => (u ? u.replace(/\/\d+x\d+(bb)?\.(jpg|png)$/i, '/1200x1200bb.jpg') : '');

function songFrom(r) {
  return {
    catalogId: r.trackId, collectionId: r.collectionId,
    title: r.trackName || '', artist: r.artistName || '', album: (r.collectionName || '').replace(/ - (Single|EP)$/i, (m) => m),
    albumArtist: r.collectionArtistName || r.artistName || '',
    year: r.releaseDate ? String(r.releaseDate).slice(0, 4) : '', genre: r.primaryGenreName || '',
    track: r.trackNumber || 0, trackTotal: r.trackCount || 0, disc: r.discNumber || 0, discTotal: r.discCount || 0,
    duration: r.trackTimeMillis ? r.trackTimeMillis / 1000 : 0,
    explicit: r.trackExplicitness === 'explicit',
    art: bigArt(r.artworkUrl100), thumb: r.artworkUrl100 || ''
  };
}
function albumFrom(r) {
  return {
    collectionId: r.collectionId, album: r.collectionName || '', albumArtist: r.artistName || '',
    year: r.releaseDate ? String(r.releaseDate).slice(0, 4) : '', genre: r.primaryGenreName || '',
    trackTotal: r.trackCount || 0, art: bigArt(r.artworkUrl100), thumb: r.artworkUrl100 || ''
  };
}

async function searchSongs(term, limit = 10) {
  if (!String(term || '').trim()) return [];
  return (await itunes(`search?media=music&entity=song&limit=${limit}&term=${encodeURIComponent(term)}`)).map(songFrom);
}
async function searchAlbums(term, limit = 10) {
  if (!String(term || '').trim()) return [];
  return (await itunes(`search?media=music&entity=album&limit=${limit}&term=${encodeURIComponent(term)}`)).map(albumFrom);
}
async function albumTracks(collectionId) {
  const rows = await itunes(`lookup?id=${encodeURIComponent(collectionId)}&entity=song&limit=200`);
  const album = rows.find((r) => r.wrapperType === 'collection');
  return { album: album ? albumFrom(album) : null, tracks: rows.filter((r) => r.wrapperType === 'track').map(songFrom) };
}

/** Best catalog match for a song, or null when nothing is confidently the same song. */
async function bestSong({ artist, title, duration }) {
  if (!title) return null;
  let results = [];
  try { results = await searchSongs(`${artist || ''} ${title}`.trim(), 15); } catch { return null; }
  let best = null; let bestScore = 0;
  for (const r of results) {
    const ts = similarity(r.title, title);
    const as = artist ? Math.max(similarity(r.artist, artist), similarity(r.albumArtist, artist)) : 0.5;
    let score = ts * 0.6 + as * 0.4;
    if (duration && r.duration) { const d = Math.abs(r.duration - duration); score += d < 4 ? 0.1 : d > 25 ? -0.2 : 0; }
    if (/ - single$/i.test(r.album)) score -= 0.02; // prefer the album version when both exist
    if (score > bestScore) { best = r; bestScore = score; }
  }
  return bestScore >= 0.75 ? { ...best, score: +bestScore.toFixed(2) } : null;
}

/** Match local tracks to a catalog track list by title. Returns [{ id, match }] */
function matchTracks(local, catalog) {
  const used = new Set();
  return local.map((t) => {
    let best = null; let bs = 0;
    for (const c of catalog) {
      if (used.has(c.catalogId)) continue;
      let s = similarity(c.title, t.title);
      if (t.duration && c.duration && Math.abs(t.duration - c.duration) < 5) s += 0.1;
      if (s > bs) { bs = s; best = c; }
    }
    if (best && bs >= 0.6) { used.add(best.catalogId); return { id: t.id, match: best }; }
    return { id: t.id, match: null };
  });
}

module.exports = { cleanTitle, cleanUploader, primaryArtist, similarity, searchSongs, searchAlbums, albumTracks, bestSong, matchTracks, bigArt };
