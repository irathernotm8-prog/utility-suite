// Crate — ID3 tags (v2.3, which every phone and Apple Music read)
const NodeID3 = require('node-id3');

const num = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; };
const pair = (s) => { const [a, b] = String(s || '').split('/'); return [num(a), num(b)]; };

function read(file) {
  const t = NodeID3.read(file, { noRaw: true }) || {};
  const [track, trackTotal] = pair(t.trackNumber);
  const [disc, discTotal] = pair(t.partOfSet);
  const img = t.image && typeof t.image === 'object' && t.image.imageBuffer ? t.image : null;
  const lyr = t.unsynchronisedLyrics;
  const com = Array.isArray(t.comment) ? t.comment[0] : t.comment;
  return {
    title: t.title || '', artist: t.artist || '', album: t.album || '', albumArtist: t.performerInfo || '',
    year: String(t.year || t.recordingTime || '').slice(0, 4), genre: (t.genre || '').replace(/^\((\d+)\)$/, ''),
    track, trackTotal, disc, discTotal, composer: t.composer || '',
    bpm: num(t.bpm), comment: com && com.text ? com.text : '', lyrics: lyr && lyr.text ? lyr.text : '',
    image: img ? { mime: img.mime || 'image/jpeg', buffer: img.imageBuffer } : null
  };
}

/** Replace the file's tags with `m` (a track record). `art` is a Buffer (JPEG) or null for none. */
function write(file, m, art) {
  const tags = {
    title: m.title || '', artist: m.artist || '', album: m.album || '', performerInfo: m.albumArtist || '',
    year: m.year ? String(m.year) : '', genre: m.genre || '', composer: m.composer || '',
    trackNumber: m.track ? (m.trackTotal ? `${m.track}/${m.trackTotal}` : String(m.track)) : '',
    partOfSet: m.disc ? (m.discTotal ? `${m.disc}/${m.discTotal}` : String(m.disc)) : '',
    bpm: m.bpm ? String(m.bpm) : ''
  };
  if (m.comment) tags.comment = { language: 'eng', text: m.comment };
  if (m.lyrics) tags.unsynchronisedLyrics = { language: 'eng', text: m.lyrics };
  if (art) tags.image = { mime: 'image/jpeg', type: { id: 3, name: 'front cover' }, description: 'Cover', imageBuffer: art };
  for (const k of Object.keys(tags)) if (tags[k] === '') delete tags[k];
  const res = NodeID3.write(tags, file);
  if (res !== true) throw new Error('Could not write tags: ' + (res && res.message ? res.message : 'unknown error'));
}

module.exports = { read, write };
