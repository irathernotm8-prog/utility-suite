'use strict';
// Waypoint — .waypoint files: a whole trip with every document in one file, for moving a trip to
// another computer (by Beam, USB, email, a shared drive…). Built for speed: no compression (PDFs and
// photos are already compressed), files are streamed straight in and out, and each one carries a
// SHA-256 so a damaged copy is caught on import.
//
//   "WAYPOINT" · 1 byte format version · 4 bytes header length (big-endian) · header JSON · file bytes…
//   header = { app, format, exported, trip, files: [{ id, name, size, sha256 }] }  (files in order)
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');
const { normalize, newId, slug, uniquePath, safeName } = require('./store');

const MAGIC = Buffer.from('WAYPOINT');
const FORMAT = 1;

function sha256File(p) {
  return new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(p).on('error', rej).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))); });
}

// stream one file onto the end of an open write stream (backpressure via pipe, no listener build-up)
function appendFile(src, out, onChunk) {
  return new Promise((resolve, reject) => {
    const r = fs.createReadStream(src, { highWaterMark: 1024 * 1024 });
    const fail = (e) => { out.off('error', fail); r.destroy(); reject(e); };
    out.on('error', fail);
    r.on('error', fail);
    r.on('data', (c) => onChunk(c.length));
    r.on('end', () => { out.off('error', fail); resolve(); });
    r.pipe(out, { end: false });
  });
}

async function exportTrip(store, id, outPath, { onProgress } = {}) {
  const trip = store.get(id);
  const files = [];
  const docs = [];
  for (const d of trip.docs) {
    const p = store.docPath(id, d);
    let st; try { st = await fsp.stat(p); } catch { continue; }   // missing on disk: leave it out
    files.push({ id: d.id, name: path.basename(p), size: st.size, sha256: await sha256File(p), abs: p });
    docs.push(d);
  }
  const header = Buffer.from(JSON.stringify({ app: 'Waypoint', format: FORMAT, exported: Date.now(), trip: { ...trip, docs }, files: files.map(({ abs, ...f }) => f) }));
  const head = Buffer.alloc(MAGIC.length + 5);
  MAGIC.copy(head, 0); head.writeUInt8(FORMAT, MAGIC.length); head.writeUInt32BE(header.length, MAGIC.length + 1);
  const tmp = outPath + '.part';
  const out = fs.createWriteStream(tmp);
  const total = files.reduce((a, f) => a + f.size, 0); let done = 0;
  await new Promise((res, rej) => { out.write(Buffer.concat([head, header]), (e) => e ? rej(e) : res()); });
  for (const f of files) {
    await appendFile(f.abs, out, (n) => { done += n; if (onProgress) onProgress(done, total); });
  }
  await new Promise((res, rej) => out.end((e) => e ? rej(e) : res()));
  await fsp.rename(tmp, outPath);
  return { path: outPath, size: head.length + header.length + total, docs: files.length };
}

async function readHeader(file) {
  const fh = await fsp.open(file, 'r');
  try {
    const head = Buffer.alloc(MAGIC.length + 5);
    await fh.read(head, 0, head.length, 0);
    if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('That isn’t a Waypoint trip file.');
    const fmt = head.readUInt8(MAGIC.length);
    if (fmt > FORMAT) throw new Error('This trip was saved by a newer Waypoint. Update Waypoint in Utility Hub, then open it again.');
    const len = head.readUInt32BE(MAGIC.length + 1);
    if (len > 64 * 1024 * 1024) throw new Error('That trip file looks damaged.');
    const hb = Buffer.alloc(len);
    await fh.read(hb, 0, len, head.length);
    const h = JSON.parse(hb.toString('utf8'));
    if (!h.trip || !Array.isArray(h.files)) throw new Error('That trip file looks damaged.');
    let off = head.length + len;
    for (const f of h.files) { f.offset = off; off += f.size; }
    const st = await fh.stat();
    if (st.size < off) throw new Error('That trip file is incomplete — it may not have finished copying.');
    return h;
  } finally { await fh.close(); }
}

// what's in a .waypoint, for the "Open trip" sheet
async function peek(store, file) {
  const h = await readHeader(file);
  const t = h.trip;
  const mine = store.has(t.id) ? store.get(t.id) : null;
  return { id: t.id, name: t.name, destination: t.destination, start: t.start, end: t.end, cover: t.cover, docs: h.files.length,
    bytes: h.files.reduce((a, f) => a + f.size, 0), items: (t.items || []).length, bookings: (t.bookings || []).length, exported: h.exported,
    exists: !!mine, newer: mine ? (t.updated || 0) > (mine.updated || 0) : false, mineUpdated: mine ? mine.updated : null };
}

// mode: 'copy' (a new trip beside any existing one) or 'replace' (overwrite the trip with the same id)
async function importTrip(store, file, mode = 'copy', { onProgress } = {}) {
  const h = await readHeader(file);
  let t = normalize(h.trip);
  const exists = store.has(t.id);
  let folder;
  if (exists && mode === 'replace') {
    folder = store.folder(t.id);
    const docsDir = path.join(folder, 'Documents');
    // move the old documents aside; they're removed only once the new ones are in
    const old = path.join(folder, `.old-${Date.now()}`);
    if (fs.existsSync(docsDir)) await fsp.rename(docsDir, old);
    try { await writeDocs(file, h, t, folder, onProgress); } catch (e) { await fsp.rm(path.join(folder, 'Documents'), { recursive: true, force: true }); if (fs.existsSync(old)) await fsp.rename(old, docsDir); throw e; }
    await fsp.rm(old, { recursive: true, force: true });
  } else {
    if (exists) { t.id = newId(); t.name = `${t.name} (copy)`; }
    folder = uniquePath(store.dir, slug(t.name));
    await fsp.mkdir(path.join(folder, 'Documents'), { recursive: true });
    try { await writeDocs(file, h, t, folder, onProgress); } catch (e) { await fsp.rm(folder, { recursive: true, force: true }); throw e; }
  }
  store.index.set(t.id, { folder, trip: t });
  store.write(t.id);
  return t;
}

async function writeDocs(file, h, t, folder, onProgress) {
  const dir = path.join(folder, 'Documents');
  await fsp.mkdir(dir, { recursive: true });
  const total = h.files.reduce((a, f) => a + f.size, 0); let done = 0;
  const byId = new Map(t.docs.map(d => [d.id, d]));
  for (const f of h.files) {
    const dest = uniquePath(dir, safeName(f.name));
    if (f.size > 0) {
      const hash = crypto.createHash('sha256');
      await pipeline(fs.createReadStream(file, { start: f.offset, end: f.offset + f.size - 1 }),
        new Transform({ transform(c, _e, cb) { hash.update(c); done += c.length; if (onProgress) onProgress(done, total); cb(null, c); } }),
        fs.createWriteStream(dest));
      if (f.sha256 && hash.digest('hex') !== f.sha256) throw new Error(`“${f.name}” didn’t come through intact. Send the trip again.`);
    } else await fsp.writeFile(dest, Buffer.alloc(0));
    const d = byId.get(f.id);
    if (d) { d.file = path.relative(folder, dest).split(path.sep).join('/'); d.size = f.size; }
  }
  const have = new Set(h.files.map(f => f.id));
  t.docs = t.docs.filter(d => have.has(d.id));
}

module.exports = { exportTrip, importTrip, peek, readHeader, MAGIC };
