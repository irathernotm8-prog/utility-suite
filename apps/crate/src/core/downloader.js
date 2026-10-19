// Crate — finding and downloading audio with yt-dlp, then turning it into a tagged MP3 in the library
const fs = require('fs');
const path = require('path');
const tools = require('./tools');
const audio = require('./audio');
const meta = require('./metadata');
const library = require('./library');

function baseArgs(settings) {
  const a = ['--no-color', '--ignore-config'];
  const d = tools.deno();
  if (d) a.push('--js-runtimes', `deno:${d}`);
  a.push('--ffmpeg-location', tools.ffmpeg());
  if (settings.cookiesBrowser) a.push('--cookies-from-browser', settings.cookiesBrowser);
  return a;
}

function friendlyError(stderr) {
  const s = String(stderr || '');
  const line = (s.match(/ERROR: (.+)/g) || []).slice(-1)[0] || s.trim().split('\n').slice(-1)[0] || 'Unknown error';
  const msg = line.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?([\w-]{6,}:\s*)?/, '');
  if (/confirm you.?re not a bot|Sign in to confirm/i.test(s)) return { message: 'YouTube wants a signed-in browser for this. In Settings → Downloads, pick the browser you use YouTube in and try again.', code: 'bot' };
  if (/HTTP Error 403/i.test(s)) return { message: 'The site refused the download (403). Update the download tools in Settings, or use your browser sign-in (Settings → Downloads).', code: '403' };
  if (/Private video|members-only|This video is private/i.test(s)) return { message: 'This video is private or members-only.', code: 'private' };
  if (/age/i.test(s) && /confirm your age|age-restricted|inappropriate/i.test(s)) return { message: 'This video is age-restricted. Use your browser sign-in (Settings → Downloads) to download it.', code: 'age' };
  if (/Unsupported URL/i.test(s)) return { message: 'That link isn\'t from a site Crate can download from.', code: 'unsupported' };
  if (/Video unavailable|not available/i.test(s)) return { message: 'That video isn\'t available (removed, blocked in your country, or private).', code: 'unavailable' };
  if (/could not find .* cookies|cookies database|Operation not permitted.*Cookies/i.test(s)) return { message: 'Crate couldn\'t read that browser\'s sign-in. Close the browser and try again, or choose another browser in Settings.', code: 'cookies' };
  return { message: msg.slice(0, 300), code: 'other' };
}

function ytErr(r) { const f = friendlyError(r.stderr); const e = new Error(f.message); e.code = f.code; return e; }

function entryFrom(e, i) {
  const url = e.webpage_url || e.original_url || e.url || (/^[\w-]{11}$/.test(e.id || '') ? `https://www.youtube.com/watch?v=${e.id}` : '');
  const thumbs = e.thumbnails || [];
  const thumb = e.thumbnail || (thumbs.length ? (thumbs.find((t) => (t.width || 0) >= 300) || thumbs[thumbs.length - 1]).url : '');
  return {
    id: e.id, url, title: e.title || e.id || 'Untitled', duration: e.duration || 0,
    uploader: e.channel || e.uploader || e.playlist_uploader || '', thumb, index: e.playlist_index || i + 1,
    track: e.track || '', artist: e.artist || (e.artists && e.artists.join(', ')) || '', album: e.album || ''
  };
}

/** Look at a link: a single video/song, or a playlist/album. */
async function probe(url, settings, signal) {
  const r = await tools.run(tools.ytdlp(), [...baseArgs(settings), '-J', '--flat-playlist', '--no-warnings', url], { signal });
  if (r.aborted) throw new Error('Canceled');
  if (r.code !== 0) throw ytErr(r);
  const j = JSON.parse(r.stdout);
  if (j._type === 'playlist' || Array.isArray(j.entries)) {
    const entries = (j.entries || []).filter(Boolean).filter((e) => !/\[(Private|Deleted) video\]/i.test(e.title || '')).map(entryFrom);
    const title = String(j.title || '').replace(/^Album - /, '');
    const uploader = meta.cleanUploader(j.channel || j.uploader || '');
    return { kind: 'playlist', id: j.id, url: j.webpage_url || url, title, uploader, isAlbum: /^OLAK5uy_/.test(j.id || '') || /^Album - /.test(j.title || ''), entries, thumb: (j.thumbnails || []).slice(-1)[0]?.url || entries[0]?.thumb || '' };
  }
  return { kind: 'single', ...entryFrom(j, 0), url: j.webpage_url || url, year: j.release_year || (j.upload_date ? String(j.upload_date).slice(0, 4) : '') };
}

async function search(query, settings, { limit = 15, site = 'youtube', signal } = {}) {
  let target;
  if (site === 'playlists') target = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAw%253D%253D`;
  else if (site === 'soundcloud') target = `scsearch${limit}:${query}`;
  else target = `ytsearch${limit}:${query}`;
  const r = await tools.run(tools.ytdlp(), [...baseArgs(settings), '-J', '--flat-playlist', '--no-warnings', '--playlist-end', String(limit), target], { signal });
  if (r.aborted) throw new Error('Canceled');
  if (r.code !== 0) throw ytErr(r);
  const j = JSON.parse(r.stdout);
  return (j.entries || []).filter(Boolean).map((e, i) => ({ ...entryFrom(e, i), kind: site === 'playlists' ? 'playlist' : 'single', count: e.playlist_count || 0 }));
}

/* ---------------- the queue ---------------- */

const jobs = [];
let running = 0;
let notify = () => {};
let getSettings = () => ({});
let seq = 0;

function configure({ onUpdate, settings }) { if (onUpdate) notify = onUpdate; if (settings) getSettings = settings; }

const pub = (j) => ({ id: j.id, url: j.url, title: j.title, thumb: j.thumb, status: j.status, stage: j.stage, progress: j.progress, error: j.error, errorCode: j.errorCode, trackId: j.trackId, createdAt: j.createdAt, finishedAt: j.finishedAt, options: j.options, duplicateOf: j.duplicateOf });
function list() { return jobs.map(pub); }
function emit(j) { notify(pub(j)); }

/**
 * items: [{ url, title, thumb, id(videoId), duration, uploader, artist, track, album }]
 * options: { asAlbum, album, albumArtist, year, genre, artUrl, trackNumbers: {videoId: n}, trackTotal, quality, normalize, force, catalog: {videoId: catalogSong} }
 */
function enqueue(items, options = {}) {
  const added = [];
  for (const it of items) {
    const dup = !options.force && library.findBySource(it.id, it.url);
    const j = {
      id: `j${Date.now().toString(36)}${(seq++).toString(36)}`, url: it.url, videoId: it.id, title: it.title || it.url, thumb: it.thumb || '',
      item: it, options, status: dup ? 'skipped' : 'queued', stage: dup ? 'Already in your library' : 'Waiting', progress: 0,
      createdAt: Date.now(), duplicateOf: dup ? dup.id : null, ctrl: null
    };
    jobs.unshift(j); added.push(pub(j)); emit(j);
  }
  while (jobs.length > 300) { const k = jobs.findLastIndex((x) => ['done', 'error', 'canceled', 'skipped'].includes(x.status)); if (k < 0) break; jobs.splice(k, 1); }
  pump();
  return added;
}

function cancel(id) {
  const j = jobs.find((x) => x.id === id);
  if (!j) return;
  if (j.status === 'queued') { j.status = 'canceled'; j.stage = 'Canceled'; emit(j); }
  else if (j.ctrl) j.ctrl.abort();
}
function retry(id, { force } = {}) {
  const j = jobs.find((x) => x.id === id);
  if (!j || !['error', 'canceled', 'skipped'].includes(j.status)) return;
  if (force) j.options = { ...j.options, force: true };
  j.status = 'queued'; j.stage = 'Waiting'; j.error = null; j.progress = 0; j.duplicateOf = null; emit(j); pump();
}
function clearFinished() { for (let i = jobs.length - 1; i >= 0; i--) if (['done', 'canceled', 'skipped'].includes(jobs[i].status)) jobs.splice(i, 1); notify(null); }

function pump() {
  const limit = Math.max(1, Math.min(4, Number(getSettings().concurrency) || 2));
  while (running < limit) {
    const next = [...jobs].reverse().find((j) => j.status === 'queued');
    if (!next) return;
    running++;
    run(next).finally(() => { running--; pump(); });
  }
}

const set = (j, patch) => { Object.assign(j, patch); emit(j); };

const albumCache = new Map();
function catalogAlbum(id) {
  if (!albumCache.has(id)) albumCache.set(id, meta.albumTracks(id).catch(() => { albumCache.delete(id); return { tracks: [] }; }));
  return albumCache.get(id);
}

async function run(j) {
  const settings = getSettings();
  const o = j.options || {};
  const ctrl = new AbortController(); j.ctrl = ctrl;
  const work = library.tmp('dl');
  fs.mkdirSync(work, { recursive: true });
  try {
    set(j, { status: 'working', stage: 'Starting', progress: 0, error: null });
    if (!fs.existsSync(tools.ytdlp())) throw new Error('The download tools aren\'t installed yet — open Settings → Download tools.');

    // 1. fetch the best audio + thumbnail + info
    const args = [...baseArgs(settings), '-f', 'bestaudio/best', '--no-playlist', '--write-thumbnail', '--write-info-json', '--no-write-playlist-metafiles',
      '--newline', '--progress-template', 'download:CRATE|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s',
      '-o', path.join(work, 'media.%(ext)s'), '-o', `thumbnail:${path.join(work, 'thumb.%(ext)s')}`, '-o', `infojson:${path.join(work, 'info')}`, j.url];
    set(j, { stage: 'Downloading' });
    const r = await tools.run(tools.ytdlp(), args, {
      signal: ctrl.signal,
      onLine: (l) => {
        if (!l.startsWith('CRATE|')) return;
        const [, got, total, est] = l.split('|');
        const t = Number(total) || Number(est) || 0;
        if (t) set(j, { progress: Math.min(1, Number(got) / t) * 0.7 });
      }
    });
    if (r.aborted) throw Object.assign(new Error('Canceled'), { canceled: true });
    if (r.code !== 0) throw ytErr(r);
    const files = fs.readdirSync(work);
    const media = files.find((f) => f.startsWith('media.') && !/\.part$|\.ytdl$/.test(f));
    if (!media) throw new Error('The download finished but no audio came back.');
    let info = {};
    const infoFile = files.find((f) => f.startsWith('info'));
    try { info = JSON.parse(fs.readFileSync(path.join(work, infoFile), 'utf8')); } catch {}
    const thumbFile = files.find((f) => f.startsWith('thumb.'));

    // 2. work out the song info
    set(j, { stage: 'Finding song info', progress: 0.72 });
    const it = j.item || {};
    let artist = info.artist || (info.artists && info.artists.join(', ')) || it.artist || '';
    let title = info.track || it.track || '';
    if (!title || !artist) {
      const c = settings.cleanTitles !== false ? meta.cleanTitle(info.title || it.title || '', info.channel || info.uploader || it.uploader || '') : { title: info.title || it.title, artist: meta.cleanUploader(info.channel || info.uploader || '') };
      title = title || c.title; artist = artist || c.artist;
    }
    const tags = {
      title, artist, album: info.album || it.album || '', albumArtist: '', year: info.release_year ? String(info.release_year) : '',
      genre: '', track: 0, trackTotal: 0, disc: 0, discTotal: 0, comment: '', lyrics: ''
    };
    if (info.album && info.artist) tags.albumArtist = meta.primaryArtist(info.album_artist || info.artist);
    let artUrl = null;
    const catalog = o.catalog && o.catalog[j.videoId];
    let match = catalog || null;
    if (!match && settings.autoLookup !== false && !o.asAlbum) match = await meta.bestSong({ artist, title, duration: info.duration });
    if (match) {
      tags.title = tags.title || match.title;
      if (!tags.album) { tags.album = match.album; tags.albumArtist = match.albumArtist; tags.track = match.track; tags.trackTotal = match.trackTotal; tags.disc = match.disc; tags.discTotal = match.discTotal; }
      if (!tags.year) tags.year = match.year;
      tags.genre = tags.genre || match.genre;
      if (settings.preferCatalogArt !== false && match.art) artUrl = match.art;
      if (catalog) { tags.title = match.title; tags.artist = match.artist; tags.track = match.track; tags.disc = match.disc; tags.discTotal = match.discTotal; }
    }
    if (o.asAlbum) {
      tags.album = o.album || tags.album;
      tags.albumArtist = o.albumArtist || tags.albumArtist || meta.primaryArtist(artist);
      if (o.year) tags.year = o.year;
      if (o.genre) tags.genre = o.genre;
      const n = o.trackNumbers && o.trackNumbers[j.videoId];
      if (n) tags.track = n;
      if (o.trackTotal) tags.trackTotal = o.trackTotal;
      // a catalog album was picked: use its song titles and numbering when this song is on it
      if (o.collectionId) {
        const { tracks } = await catalogAlbum(o.collectionId);
        const [m] = meta.matchTracks([{ id: j.id, title: tags.title, duration: info.duration }], tracks);
        if (m && m.match) { tags.title = m.match.title; tags.track = m.match.track; tags.disc = m.match.disc; tags.discTotal = m.match.discTotal; tags.trackTotal = m.match.trackTotal || tags.trackTotal; }
      }
      if (o.artUrl) artUrl = o.artUrl;
    }
    if (!tags.albumArtist && tags.album) tags.albumArtist = meta.primaryArtist(tags.artist);

    // 3. artwork
    set(j, { stage: 'Artwork', progress: 0.76 });
    let art = null;
    if (artUrl) { try { art = await library.prepareArt({ url: artUrl }); } catch {} }
    if (!art && thumbFile) { try { art = await library.prepareArt({ path: path.join(work, thumbFile) }); } catch {} }

    // 4. convert
    set(j, { stage: 'Converting to MP3', progress: 0.78 });
    const out = path.join(work, 'song.mp3');
    await audio.toMp3(path.join(work, media), out, {
      quality: o.quality || settings.quality, normalize: o.normalize ?? settings.normalize, signal: ctrl.signal, duration: info.duration,
      onProgress: (p) => set(j, { progress: 0.78 + p * 0.2 })
    });

    // 5. into the library
    set(j, { stage: 'Adding to library', progress: 0.99 });
    const track = await library.addTrack(out, {
      ...tags,
      source: { kind: 'download', url: info.webpage_url || j.url, videoId: info.id || j.videoId, site: info.extractor_key || '', uploader: info.channel || info.uploader || '', originalTitle: info.title || '' }
    }, art, settings);
    set(j, { status: 'done', stage: 'Added', progress: 1, trackId: track.id, finishedAt: Date.now(), title: `${track.artist ? track.artist + ' — ' : ''}${track.title}` });
  } catch (e) {
    if (e.canceled || ctrl.signal.aborted) set(j, { status: 'canceled', stage: 'Canceled', progress: 0 });
    else set(j, { status: 'error', stage: 'Failed', error: e.message, errorCode: e.code || 'other' });
  } finally {
    j.ctrl = null;
    fs.rmSync(work, { recursive: true, force: true });
  }
}

module.exports = { probe, search, enqueue, cancel, retry, clearFinished, list, configure, friendlyError };
