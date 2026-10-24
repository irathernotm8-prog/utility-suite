// A decompile job: inspects the file, unpacks whatever contains other things, hands code to the right
// engine, then (in deep mode) does the same for everything it found inside — all fanned out across
// the worker pool and the engine slots so every allowed core is busy.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const detect = require('./detect');
const analysis = require('./analysis');
const runners = require('./runners');
const python = require('./formats/python');
const PYSTD = require('./pystdlib');
const { TYPES, label: kindLabel } = require('./types');
const { safeJoin, walk, writeJson, fmtSize, stamp, FileReader, copyRange } = require('./util');
const plural = (n, one, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`;

const FRAMEWORK_DLL = /^(System(\..*)?|Microsoft\..*|mscorlib|netstandard|WindowsBase|Presentation(Core|Framework).*|UIAutomation.*|Mono\..*|UnityEngine(\..*)?|Unity\..*|nunit\..*|Accessibility|ReachFramework|DirectWriteForwarder|WindowsFormsIntegration|Windows|WinRT\..*)\.dll$/i;
const CONTAINERS = new Set(['zip', 'apkbundle', 'nupkg', 'msix', 'crx', 'pyarchive', 'ipa', 'sevenz', 'rar', 'tar', 'compressed', 'arc', 'msi', 'cab', 'dmg', 'vdisk', 'wim', 'fsimage', 'udf', 'iso', 'xiso', 'gcm', 'cso', 'squashfs', 'cramfs', 'ihex', 'deb', 'rpm', 'snap', 'nsis', 'sfx', 'pkg', 'godot', 'rgss', 'asar', 'appimage', 'inno', 'dotnetbundle', 'pyinstaller', 'swf', 'upx', 'uimage', 'electron']);
const SEVENZIP_KINDS = new Set(['sevenz', 'rar', 'compressed', 'arc', 'msi', 'cab', 'dmg', 'vdisk', 'wim', 'fsimage', 'udf', 'squashfs', 'cramfs', 'ihex', 'deb', 'rpm', 'snap', 'nsis', 'pkg']);
const NATIVE = new Set(['pe', 'elf', 'macho']);
const CARVE_EXT = { zip: 'zip', '7z': '7z', rar: 'rar', gzip: 'gz', xz: 'xz', bzip2: 'bz2', zstd: 'zst', lzma: 'lzma', cab: 'cab', squashfs: 'squashfs', cramfs: 'cramfs', png: 'png', jpeg: 'jpg', gif: 'gif', pdf: 'pdf', sqlite: 'sqlite', elf: 'elf', pe: 'exe', 'mach-o': 'macho', cpio: 'cpio', uimage: 'uimage', dtb: 'dtb', ubi: 'ubi', jffs2: 'jffs2', ext: 'ext', dex: 'dex', wasm: 'wasm', unity: 'unity3d', riff: 'riff', ogg: 'ogg' };

let jobSeq = 0;

class Job extends EventEmitter {
  constructor({ input, identity, outRoot, options = {}, ctx }) {
    super();
    this.ctx = ctx; // { engines, pool, scheduler, budget() }
    this.opt = { deep: true, maxDepth: 4, native: true, nativeDeep: false, libraries: false, deobf: false, strings: true, resources: true, ...options };
    this.input = input;
    this.identity = identity || detect.full(input);
    this.id = `${Date.now().toString(36)}${(++jobSeq).toString(36)}`;
    const base = this.identity.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80);
    this.outDir = options.outDir || path.join(outRoot, `${base} (${stamp()})`);
    this.dirs = { unpacked: path.join(this.outDir, 'Unpacked'), source: path.join(this.outDir, 'Source'), analysis: path.join(this.outDir, 'Analysis') };
    this.steps = []; this.units = []; this.notes = [...(this.identity.notes || [])]; this.needs = new Set();
    this.status = 'queued'; this.startedAt = null; this.endedAt = null; this.error = null;
    this.stats = { files: 0, bytes: 0, sources: 0, units: 0, peakThreads: 0 };
    this.abort = new AbortController();
    this.unitCount = 0; this.seenFiles = new Set();
    this.summary = {}; // things the overview tab shows (strings highlights, entropy, signatures)
  }

  // ── public
  snapshot() {
    return {
      id: this.id, input: this.input, name: this.identity.name, kind: this.identity.kind, label: this.identity.label, family: this.identity.family,
      traits: this.identity.traits, outDir: this.outDir, status: this.status, startedAt: this.startedAt, endedAt: this.endedAt, error: this.error,
      steps: this.steps.map((s) => ({ id: s.id, title: s.title, engine: s.engine, state: s.state, progress: s.progress, detail: s.detail, threads: s.threads, rel: s.rel, startedAt: s.startedAt, endedAt: s.endedAt, needs: s.needs, depth: s.depth })),
      stats: this.stats, notes: this.notes, needs: [...this.needs], options: this.opt, progress: this.progress(),
    };
  }
  progress() {
    const s = this.steps.filter((x) => x.state !== 'skipped');
    if (!s.length) return 0;
    return s.reduce((a, x) => a + (x.state === 'done' || x.state === 'failed' || x.state === 'needs' ? 1 : x.state === 'running' ? (x.progress || 0) : 0), 0) / s.length;
  }
  cancel() { if (this.status === 'running' || this.status === 'queued') { this.abort.abort(); this.status = 'cancelled'; this.changed(); } }

  async run() {
    this.status = 'running'; this.startedAt = Date.now(); this.changed();
    for (const d of Object.values(this.dirs)) fs.mkdirSync(d, { recursive: true });
    const meter = setInterval(() => { this.stats.peakThreads = Math.max(this.stats.peakThreads, this.ctx.scheduler.threadsInUse + this.ctx.pool.active); }, 500);
    try {
      this.inspection = this.inspect().catch((e) => { this.notes.push('Inspection stopped: ' + e.message); if (e.cancelled) throw e; });
      await Promise.all([this.inspection, this.unit(this.input, { depth: 0, top: true, identity: this.identity })]);
      if (this.abort.signal.aborted) throw Object.assign(new Error('Cancelled'), { cancelled: true });
      this.status = 'done';
    } catch (e) {
      if (e.cancelled || this.abort.signal.aborted) this.status = 'cancelled';
      else { this.status = 'failed'; this.error = e.message; }
    } finally {
      clearInterval(meter);
      this.endedAt = Date.now();
      this.stats.seconds = Math.round((this.endedAt - this.startedAt) / 100) / 10;
      try { this.writeReport(); } catch (e) { this.notes.push('Couldn’t write the report: ' + e.message); }
      this.changed(true);
    }
    return this.snapshot();
  }

  // ── steps
  step(title, { engine = null, rel = '', depth = 0 } = {}) {
    const s = { id: this.steps.length + 1, title, engine, rel, depth, state: 'waiting', progress: null, detail: '', threads: null, startedAt: null, endedAt: null };
    const self = this;
    Object.assign(s, {
      start(threads) { s.state = 'running'; s.startedAt = Date.now(); s.threads = threads || null; self.changed(); return s; },
      update(progress, detail) { if (progress != null) s.progress = Math.max(0, Math.min(1, progress)); if (detail) s.detail = detail; self.changed(); },
      done(detail) { s.state = 'done'; s.progress = 1; s.endedAt = Date.now(); if (detail != null) s.detail = detail; self.changed(); },
      fail(e) { s.state = e && e.cancelled ? 'cancelled' : 'failed'; s.endedAt = Date.now(); s.detail = e ? (e.message || String(e)) : 'Failed'; self.changed(); },
      skip(why) { s.state = 'skipped'; s.detail = why || ''; s.endedAt = Date.now(); self.changed(); },
      need(engineId, why) { s.state = 'needs'; s.needs = engineId; s.detail = why; s.endedAt = Date.now(); self.needs.add(engineId); self.changed(); },
    });
    this.steps.push(s); this.changed();
    return s;
  }
  changed(force) { this.emit('change', force); }
  check() { if (this.abort.signal.aborted) throw Object.assign(new Error('Cancelled'), { cancelled: true }); }

  // Where a unit's unpacked files and source go.
  placesFor(file, top) {
    if (top) return { unpack: this.dirs.unpacked, source: this.dirs.source, rel: '' };
    const inside = (root) => { const r = path.relative(root, file); return r && !r.startsWith('..') && !path.isAbsolute(r) ? r : null; };
    // "app/hello.jar" → "app/hello (jar)": readable, never clashes with copied files, and engines
    // that treat a .jar/.zip destination as an archive don't get confused.
    const free = (p) => { const ext = path.extname(p); return ext ? path.join(path.dirname(p), `${path.basename(p, ext)} (${ext.slice(1).toLowerCase()})`) : p + ' (source)'; };
    let rel = inside(this.dirs.unpacked);
    if (rel != null) return { unpack: file + ' (unpacked)', source: free(path.join(this.dirs.source, rel)), rel };
    if (this.identity.dir && (rel = inside(this.input)) != null) return { unpack: path.join(this.dirs.unpacked, rel + ' (unpacked)'), source: free(path.join(this.dirs.source, rel)), rel };
    rel = inside(this.dirs.source) || path.basename(file);
    return { unpack: file + ' (unpacked)', source: free(file), rel };
  }

  // ── inspection: hashes, entropy, strings and embedded files, split across the worker pool
  async inspect() {
    if (this.identity.dir) return;
    const s = this.step('Inspect: hashes, entropy, strings', { engine: 'builtin' });
    const file = this.input, size = this.identity.size, pool = this.ctx.pool;
    s.start(this.ctx.budget().workers);
    const fam = this.identity.family, k = this.identity.kind;
    const doStrings = this.opt.strings && !['disc', 'archive'].includes(fam) && !['iso', 'udf', 'xiso', 'gcm', 'cso', 'dmg', 'vdisk', 'wim'].includes(k);
    const doScan = ['firmware', 'unknown', 'uimage', 'pe', 'elf', 'macho', 'upx', 'nes', 'gba', 'nds', 'lua', 'unrealpak'].includes(k) || fam === 'firmware';
    const n = Math.max(1, this.ctx.budget().workers);
    const sl = analysis.slices(size, Math.min(n * 2, Math.max(1, Math.ceil(size / (1 << 20)))));
    const block = Math.max(4096, Math.ceil(size / 600 / 4096) * 4096);
    const entSl = analysis.slices(size, n, block);
    const tasks = [['hash', { file }], ...entSl.map(([a, b]) => ['entropy', { file, start: a, end: b, block }])];
    if (doStrings) for (const [a, b] of sl) tasks.push(['strings', { file, start: a, end: b, min: 5 }]);
    if (doScan) for (const [a, b] of sl) tasks.push(['scan', { file, start: a, end: b }]);
    const results = await pool.all(tasks, (d, t) => s.update(d / t, `${d} of ${t} slices`));
    this.check();
    const hashes = results[0] && !results[0].error ? results[0] : {};
    const entropy = results.slice(1, 1 + entSl.length).flatMap((r) => (Array.isArray(r) ? r : []));
    let i = 1 + entSl.length;
    const strings = doStrings ? results.slice(i, i + sl.length).flatMap((r) => (Array.isArray(r) ? r : [])) : []; if (doStrings) i += sl.length;
    const sigs = doScan ? results.slice(i).flatMap((r) => (Array.isArray(r) ? r : [])).filter((h, j, a) => h.offset > 0 && !(j && a[j - 1].offset === h.offset)) : [];
    const avgEnt = entropy.length ? entropy.reduce((a, b) => a + b, 0) / entropy.length : 0;
    this.summary = { hashes, entropy, entropyBlock: block, avgEntropy: +avgEnt.toFixed(2), signatures: sigs.slice(0, 2000), interesting: interesting(strings), stringCount: strings.length };
    if (avgEnt > 7.6 && ['pe', 'elf', 'macho', 'unknown', 'firmware'].includes(k)) this.notes.push('Most of this file looks compressed or encrypted (high entropy), so much of its content isn’t readable directly.');
    if (strings.length) fs.writeFileSync(path.join(this.dirs.analysis, 'strings.txt'), strings.slice(0, 400000).map((x) => `${x.o.toString(16).padStart(8, '0')}  ${x.w ? 'U ' : '  '}${x.s}`).join('\n') + '\n');
    writeJson(path.join(this.dirs.analysis, 'overview.json'), { identity: strip(this.identity), ...this.summary });
    if (this.identity.pe) writeJson(path.join(this.dirs.analysis, 'pe-headers.json'), this.identity.pe);
    if (this.identity.elf) writeJson(path.join(this.dirs.analysis, 'elf-headers.json'), this.identity.elf);
    if (this.identity.macho) writeJson(path.join(this.dirs.analysis, 'macho-headers.json'), this.identity.macho);
    s.done(`${strings.length.toLocaleString()} strings${sigs.length ? `, ${sigs.length} embedded signatures` : ''}`);
  }

  // ── one unit (a file or folder): unpack it and/or decompile it, then look inside
  async unit(file, { depth, top = false, identity = null, kind = null }) {
    this.check();
    if (this.seenFiles.has(file)) return; this.seenFiles.add(file);
    if (++this.unitCount > 5000) { if (this.unitCount === 5001) this.notes.push('Stopped looking deeper after 5,000 items.'); return; }
    const id = identity || detect.quick(file);
    const k = kind || id.kind;
    const where = this.placesFor(file, top);
    const name = path.basename(file);
    const label = (t) => (top ? t : `${t} — ${where.rel || name}`);
    const opts = { depth, top, where, label, id, name };
    this.units.push({ path: path.relative(this.outDir, file).startsWith('..') ? file : path.relative(this.outDir, file), kind: k, depth });
    this.stats.units++;
    const handler = HANDLERS[k];
    if (!handler) { if (top) await this.carve(file, opts); return; }
    await handler.call(this, file, opts);
  }

  // Looks at everything inside an unpacked folder and starts a unit for anything worth opening.
  async explore(dir, depth, { skip } = {}) {
    if (!this.opt.deep || depth > this.opt.maxDepth) return;
    this.check();
    if (!fs.existsSync(dir)) return;
    const files = walk(dir).filter((f) => !(skip && skip(f)));
    if (!files.length) return;
    this.stats.files += files.length;
    // identify in batches on the worker pool
    const batches = []; for (let i = 0; i < files.length; i += 150) batches.push(['identify', { files: files.slice(i, i + 150) }]);
    const found = (await this.ctx.pool.all(batches)).flatMap((r) => (Array.isArray(r) ? r : []));
    this.check();
    const units = []; const classDirs = new Set(); const pycs = []; const scripts = [];
    for (const f of found) {
      const k = f.kind, base = path.basename(f.path);
      if (k === 'class') { classDirs.add(classRoot(f.path)); continue; }
      if (k === 'pyc') { pycs.push(f.path); continue; }
      if (k === 'js' && !/node_modules/.test(f.path) && f.size > 2000) { scripts.push(f.path); continue; }
      if (k === 'axml') { units.push([f.path, 'axml']); continue; }
      if (k === 'dotnet') { if (!this.opt.libraries && FRAMEWORK_DLL.test(base)) continue; units.push([f.path, k]); continue; }
      if (NATIVE.has(k)) { if (this.opt.nativeDeep) units.push([f.path, k]); continue; }
      if (k === 'unknown' || k === 'empty' || k === 'firmware' || k === 'lua' || k === 'nes' || k === 'gba' || k === 'nds') continue;
      if (k === 'iso' && f.size < 64 * 1024) continue;
      if (k === 'jar' && !this.opt.libraries && /[/\\](lib|libs|libraries|jre|jdk|runtime)[/\\]/i.test(f.path)) continue;
      units.push([f.path, k]);
    }
    const jobs = units.map(([p, k]) => this.unit(p, { depth, kind: k }));
    for (const cd of classDirs) jobs.push(this.javaClasses(cd, depth));
    if (pycs.length) jobs.push(this.pycBatch(pycs, depth, dir));
    if (scripts.length) jobs.push(this.beautify(scripts.map((f) => [f, this.placesFor(f).source]), `Beautify ${scripts.length} script${scripts.length > 1 ? 's' : ''}`, depth));
    await settle(jobs);
  }

  // ── building blocks
  // Built-in containers: entries split across workers, biggest first, so every core extracts.
  async unpackBuiltin(format, file, dest, title, depth) {
    const s = this.step(title, { engine: 'builtin', depth });
    const mod = { iso9660: './formats/iso9660', xiso: './formats/xiso', gcm: './formats/gcm', zip: './formats/zip', asar: './formats/asar', godot: './formats/godot', 'dotnet-bundle': './formats/dotnetbundle' }[format];
    const c = format === 'dotnet-bundle' ? require(mod).open(file) : require(mod).open(file);
    let entries; try { entries = c.entries.map((e, i) => ({ i, size: e.size || 0, dir: e.dir, path: e.path })); } finally { c.close(); }
    const n = this.ctx.budget().workers;
    s.start(n);
    fs.mkdirSync(dest, { recursive: true });
    for (const e of entries) if (e.dir) fs.mkdirSync(safeJoin(dest, e.path), { recursive: true });
    const files = entries.filter((e) => !e.dir).sort((a, b) => b.size - a.size);
    const total = files.reduce((a, e) => a + e.size, 0) || 1;
    // greedy bins by size, then split big bins into chunks so progress moves
    const bins = Array.from({ length: Math.min(n, Math.max(1, files.length)) }, () => ({ size: 0, idx: [] }));
    for (const e of files) { bins.sort((a, b) => a.size - b.size); bins[0].size += e.size; bins[0].idx.push(e.i); }
    const doneBytes = new Array(bins.length).fill(0); let failed = 0; const errors = [];
    await Promise.all(bins.filter((b) => b.idx.length).map((b, bi) => this.ctx.pool.run('extract', { format, file, indexes: b.idx, outDir: dest }, (p) => { doneBytes[bi] = p.bytes; s.update(doneBytes.reduce((a, x) => a + x, 0) / total, `${fmtSize(doneBytes.reduce((a, x) => a + x, 0))} of ${fmtSize(total)}`); })
      .then((r) => { doneBytes[bi] = r.bytes; failed += r.failed; errors.push(...r.errors); })));
    this.check();
    this.stats.bytes += total;
    if (failed) { this.notes.push(`${failed} file(s) in ${path.basename(file)} couldn’t be extracted (${errors[0]})`); }
    s.done(`${plural(files.length, 'file')}, ${fmtSize(total)} on ${plural(bins.length, 'core')}`);
    return { files: files.length, failed };
  }

  async unpack7z(file, dest, title, depth, { password } = {}) {
    const s = this.step(title, { engine: 'sevenzip', depth });
    const bin = this.ctx.engines.path('sevenzip');
    if (!bin) { s.need('sevenzip', '7-Zip is needed for this format'); return null; }
    await this.ctx.scheduler.engine(title, async ({ threads, priority }) => {
      s.start(threads);
      // Non-solid archives with many files: several 7-Zip processes each take a share.
      let list = null; try { list = await runners.sevenZipList(bin, file, { signal: this.abort.signal }); } catch {}
      const files = list ? list.entries.filter((e) => !e.dir) : [];
      const total = files.reduce((a, e) => a + e.size, 0);
      if (list && !list.solid && files.length > 200 && total > 256 << 20 && threads > 1) {
        const parts = Math.min(threads, 8); const bins = Array.from({ length: parts }, () => ({ size: 0, names: [] }));
        for (const e of files.sort((a, b) => b.size - a.size)) { bins.sort((a, b) => a.size - b.size); bins[0].size += e.size; bins[0].names.push(e.path); }
        const prog = new Array(parts).fill(0);
        await Promise.all(bins.map((b, i) => runners.sevenZip(bin, file, dest, { threads: 1, priority, signal: this.abort.signal, only: b.names, onProgress: (p) => { prog[i] = p * b.size; s.update(prog.reduce((a, x) => a + x, 0) / total); } })));
        s.done(`${files.length.toLocaleString()} files, ${fmtSize(total)} on ${parts} processes`);
      } else {
        const r = await runners.sevenZip(bin, file, dest, { threads, priority, signal: this.abort.signal, password, onProgress: (p) => s.update(p) });
        s.done(`${files.length ? files.length.toLocaleString() + ' files' : 'Unpacked'}${list && list.type ? ' (' + list.type + ')' : ''}${r.warnings ? ' with warnings' : ''}`);
      }
      this.stats.bytes += total;
    }).catch((e) => { s.fail(e); if (e.cancelled) throw e; });
    return dest;
  }

  async beautify(pairs, title, depth) {
    const s = this.step(title, { engine: 'builtin', depth }); s.start(this.ctx.budget().workers);
    const kindOf = (f) => (/\.css$/i.test(f) ? 'css' : /\.html?$/i.test(f) ? 'html' : 'js');
    const jobs = []; const per = Math.max(1, Math.ceil(pairs.length / (this.ctx.budget().workers * 3)));
    for (let i = 0; i < pairs.length; i += per) jobs.push(['beautify', { pairs: pairs.slice(i, i + per).map(([src, dest]) => [src, dest, kindOf(src)]) }]);
    const r = await this.ctx.pool.all(jobs, (d, t) => s.update(d / t));
    const n = r.reduce((a, x) => a + (x.files || 0), 0); this.stats.sources += n;
    s.done(plural(n, 'file'));
  }

  async javaClasses(dir, depth) {
    const s = this.step(`Java classes — ${path.relative(this.outDir, dir) || path.basename(dir)}`, { engine: 'vineflower', depth });
    if (!this.ctx.engines.usable('vineflower')) return s.need('vineflower', 'Vineflower turns class files into Java');
    const out = this.placesFor(dir).source;
    const total = walk(dir).filter((f) => f.endsWith('.class') && !path.basename(f).includes('$')).length;
    await this.ctx.scheduler.engine(s.title, async ({ threads, heapMB, priority }) => {
      s.start(threads);
      const r = await runners.vineflower({ java: this.ctx.engines.path('jdk'), jar: this.ctx.engines.path('vineflower') }, [dir], out, { threads, heapMB, priority, total, signal: this.abort.signal, onProgress: (p, d) => s.update(p, d) });
      this.stats.sources += r.classes; s.done(plural(r.classes, 'class', 'classes'));
    }).catch((e) => { s.fail(e); if (e.cancelled) throw e; });
  }

  async pycBatch(files, depth, root) {
    const own = files.filter((f) => { const rel = path.relative(root, f).split(path.sep); const top = (rel.find((x) => !/ \(modules\)$|^PYZ|\.pyz/.test(x) && x !== '') || '').replace(/\.pyc$/, ''); return this.opt.libraries || !PYSTD.has(top) && !/^(pyi|_)/.test(top); });
    if (!own.length) return;
    const pycdc = this.ctx.engines.path('pycdc'), py = this.ctx.engines.path('python');
    const s = this.step(`Python modules (${own.length})`, { engine: pycdc ? 'pycdc' : 'python', depth });
    if (!pycdc && !py) return s.need('pycdc', 'pycdc turns .pyc files back into Python (it isn’t on this computer). The .pyc files are in Unpacked.');
    s.start(this.ctx.budget().threads);
    let n = 0, ok = 0;
    await settle(own.map((f) => this.ctx.scheduler.lightRun(async () => {
      this.check();
      const dest = path.join(this.placesFor(f).source.replace(/\.pyc$/, ''), '..', path.basename(f).replace(/\.pyc$/, pycdc ? '.py' : '.dis.txt'));
      const r = pycdc ? await runners.pycdc(pycdc, f, dest, { signal: this.abort.signal }) : await runners.pythonDis(py, f, dest, { signal: this.abort.signal });
      if (r.ok) ok++; s.update(++n / own.length, `${n} of ${own.length}`);
    })));
    this.stats.sources += ok;
    if (!pycdc && !ok) s.need('pycdc', 'pycdc isn’t on this computer and this Python version differs, so modules stay as .pyc');
    else s.done(`${ok} of ${own.length} ${pycdc ? 'decompiled' : 'disassembled'}`);
  }

  async jadx(file, out, title, depth) {
    const s = this.step(title, { engine: 'jadx', depth });
    if (!this.ctx.engines.usable('jadx')) return s.need('jadx', 'JADX turns Android apps into Java');
    await this.ctx.scheduler.engine(title, async ({ threads, heapMB, priority }) => {
      s.start(threads);
      const r = await runners.jadx({ java: this.ctx.engines.path('jdk'), jar: this.ctx.engines.path('jadx') }, file, out, { threads, heapMB, priority, deobf: this.opt.deobf, signal: this.abort.signal, onProgress: (p, d) => s.update(p, d) });
      const n = walk(path.join(out, 'sources')).length; this.stats.sources += n;
      s.done(`${plural(n, 'source file')}${r.errors ? `, ${r.errors} with decompiler errors` : ''}`);
    }).catch((e) => { s.fail(e); if (e.cancelled) throw e; });
    return out;
  }

  async ilspy(file, out, title, depth) {
    const s = this.step(title, { engine: 'ilspy', depth });
    if (!this.ctx.engines.usable('ilspy')) return s.need('ilspy', 'ILSpy turns .NET assemblies into C#');
    await this.ctx.scheduler.engine(title, async ({ threads, priority }) => {
      s.start(threads);
      await runners.ilspy({ dotnet: this.ctx.engines.path('dotnet'), dll: this.ctx.engines.path('ilspy') }, file, out, { threads, priority, refs: [path.dirname(file)], signal: this.abort.signal, onProgress: (p, d) => s.update(p, d) });
      const n = walk(out).filter((f) => f.endsWith('.cs')).length; this.stats.sources += n;
      s.done(plural(n, 'C# file'));
    }).catch((e) => { s.fail(e); if (e.cancelled) throw e; });
  }

  async ghidra(file, out, title, depth) {
    const s = this.step(title, { engine: 'ghidra', depth });
    if (!this.opt.native) return s.skip('Native decompiling is off for this job');
    if (!this.ctx.engines.usable('ghidra')) return s.need('ghidra', this.ctx.engines.ready('ghidra') ? 'Ghidra needs Java 25' : 'Ghidra turns machine code into C pseudocode');
    await this.ctx.scheduler.engine(title, async ({ threads, heapMB, priority }) => {
      s.start(threads); s.update(0.02, 'Importing');
      await runners.ghidra({ home: this.ctx.engines.path('ghidra'), java: this.ctx.engines.path('jdk') }, file, out, { threads, heapMB, priority, timeoutMin: this.opt.ghidraTimeout || 60, signal: this.abort.signal, onProgress: (p, d) => s.update(p, d) });
      const fn = fs.readFileSync(path.join(out, 'functions.tsv'), 'utf8').split('\n').length - 2; this.stats.sources += Math.max(0, fn);
      s.done(plural(Math.max(0, fn), 'function'));
    }).catch((e) => { s.fail(e); if (e.cancelled) throw e; });
  }

  // Unknown/firmware: carve out what the signature scan found, then look at the pieces.
  async carve(file, { depth, where, top }) {
    if (top && this.inspection) await this.inspection;
    const hits = top ? (this.summary.signatures || []) : [];
    const want = hits.filter((h) => CARVE_EXT[h.type] && !(h.type === 'pe' && h.offset === 0)).slice(0, 400);
    if (!want.length) return;
    const s = this.step(`Carve ${want.length} embedded file${want.length > 1 ? 's' : ''}`, { engine: 'builtin', depth });
    s.start();
    const r = new FileReader(file); const dest = path.join(where.unpack, 'carved'); fs.mkdirSync(dest, { recursive: true });
    try {
      for (let i = 0; i < want.length; i++) {
        const h = want[i]; const end = i + 1 < want.length ? want[i + 1].offset : r.size;
        copyRange(r.fd, h.offset, end - h.offset, path.join(dest, `${h.offset.toString(16).padStart(8, '0')}.${CARVE_EXT[h.type]}`));
        s.update((i + 1) / want.length);
      }
    } finally { r.close(); }
    s.done(`${want.length} pieces`);
    await this.explore(dest, depth + 1);
  }

  writeReport() {
    const snap = this.snapshot();
    writeJson(path.join(this.outDir, 'report.json'), { ...snap, identity: strip(this.identity), units: this.units.slice(0, 5000), summary: { ...this.summary, entropy: undefined }, power: this.ctx.budget(), machine: { platform: process.platform, arch: process.arch, cpu: (os.cpus()[0] || {}).model, cores: os.cpus().length, memory: os.totalmem() } });
    const id = this.identity; const L = [];
    L.push(`# ${id.name}`, '', `**${id.label}**${id.traits.length ? ' · ' + id.traits.join(' · ') : ''}  `, `${fmtSize(id.size)} · decompiled ${new Date(this.startedAt).toLocaleString()} in ${snap.stats.seconds}s on ${this.ctx.budget().threads} threads`, '');
    for (const [k, v] of Object.entries(id.details || {})) { if (v && typeof v === 'object') { L.push(`## ${k[0].toUpperCase() + k.slice(1)}`, ''); for (const [a, b] of Object.entries(v)) if (b !== '' && b != null && typeof b !== 'object') L.push(`- **${a}**: ${b}`); L.push(''); } }
    if (this.summary.hashes && this.summary.hashes.sha256) L.push('## Hashes', '', ...Object.entries(this.summary.hashes).map(([a, b]) => `- ${a.toUpperCase()}: \`${b}\``), '');
    L.push('## Steps', '', ...this.steps.map((s) => `- ${{ done: '✓', failed: '✗', needs: '!', skipped: '–', cancelled: '✗' }[s.state] || '·'} ${s.title}${s.detail ? ' — ' + s.detail : ''}`), '');
    if (this.notes.length) L.push('## Notes', '', ...this.notes.map((n) => `- ${n}`), '');
    L.push('## Folders', '', '- **Source**: decompiled code', '- **Unpacked**: everything that was inside', '- **Analysis**: strings, headers and the raw report', '');
    fs.writeFileSync(path.join(this.outDir, 'Overview.md'), L.join('\n'));
    for (const d of Object.values(this.dirs)) { try { if (!fs.readdirSync(d).length) fs.rmdirSync(d); } catch {} }
  }
}

// ───────── what each kind does (called with `this` = the job)
const HANDLERS = {
  async folder(dir, { depth }) { await this.explore(dir, depth + (depth ? 1 : 0)); },
  async app(dir, o) {
    const plist = path.join(dir, 'Contents', 'Info.plist');
    if (fs.existsSync(plist)) { try { const p = require('./formats/plist').parse(fs.readFileSync(plist)); fs.mkdirSync(o.where.source, { recursive: true }); fs.writeFileSync(path.join(o.where.source, 'Info.plist.json'), JSON.stringify(p, null, 2)); } catch {} }
    // the main executable gets decompiled even when native libraries don't
    const exe = path.join(dir, 'Contents', 'MacOS');
    if (fs.existsSync(exe)) for (const f of fs.readdirSync(exe)) { const p = path.join(exe, f); if (detect.quick(p).kind === 'macho') await this.unit(p, { depth: o.depth + 1, kind: 'macho' }); }
    await this.explore(dir, o.depth + 1, { skip: (f) => f.includes(`${path.sep}Contents${path.sep}MacOS${path.sep}`) || /\.framework[/\\]/.test(f) && !this.opt.nativeDeep });
  },
  async electron(file, o) {
    const root = this.identity.electronRoot && o.top ? this.identity.electronRoot : file;
    const asar = [path.join(root, 'resources', 'app.asar'), path.join(root, 'Contents', 'Resources', 'app.asar')].find((p) => fs.existsSync(p));
    if (asar) await this.unit(asar, { depth: o.depth, top: o.top, kind: 'asar' });
  },
  async asar(file, { depth, where, label }) {
    const dest = where.unpack;
    await this.unpackBuiltin('asar', file, dest, label('Unpack Electron archive'), depth);
    const js = walk(dest).filter((f) => /\.(m?js|cjs|css|html?)$/i.test(f) && !/node_modules/.test(f));
    if (js.length) await this.beautify(js.map((f) => [f, path.join(where.source, path.relative(dest, f))]), label(`Beautify ${js.length} script${js.length > 1 ? 's' : ''}`), depth);
    await this.explore(dest, depth + 1, { skip: (f) => /\.(m?js|cjs|css|html?|map|json|md|txt)$/i.test(f) });
  },
  async js(file, { depth, where, label, top }) { await this.beautify([[file, top ? path.join(this.dirs.source, path.basename(file)) : where.source + '.pretty.js']], label('Beautify'), depth); },
  async wasm(file, { depth, where, label, top }) {
    const s = this.step(label('WebAssembly to text'), { engine: 'builtin', depth }); s.start(1);
    const dest = top ? path.join(this.dirs.source, path.basename(file, '.wasm') + '.wat') : where.source + '.wat';
    try { await this.ctx.pool.run('wat', { file, dest }); this.stats.sources++; s.done(path.basename(dest)); } catch (e) { s.fail(e); }
  },
  async axml(file, { where }) { try { await this.ctx.pool.run('axml', { src: file, dest: where.source.replace(/\.xml$/, '') + '.xml' }); } catch {} },
  // zip family
  async zip(file, o) {
    const z = require('./formats/zip').open(file); const bad = z.info.unsupported + z.info.encrypted; z.close();
    if (bad && this.ctx.engines.ready('sevenzip')) await this.unpack7z(file, o.where.unpack, o.label('Unpack (7-Zip)'), o.depth);
    else await this.unpackBuiltin('zip', file, o.where.unpack, o.label('Unpack'), o.depth);
    await this.explore(o.where.unpack, o.depth + 1);
  },
  async apkbundle(file, o) { await HANDLERS.zip.call(this, file, o); },
  async nupkg(file, o) { await HANDLERS.zip.call(this, file, o); },
  async msix(file, o) { await HANDLERS.zip.call(this, file, o); },
  async pyarchive(file, o) { await HANDLERS.zip.call(this, file, o); },
  async crx(file, o) {
    const r = new FileReader(file); const h = r.read(0, 16); let start = 0;
    if (h.toString('latin1', 0, 4) === 'Cr24') { const v = h.readUInt32LE(4); start = v === 3 ? 12 + h.readUInt32LE(8) : 16 + h.readUInt32LE(8) + h.readUInt32LE(12); }
    let src = file;
    if (start) { src = path.join(o.where.unpack + ' (zip)', path.basename(file) + '.zip'); fs.mkdirSync(path.dirname(src), { recursive: true }); copyRange(r.fd, start, r.size - start, src); }
    r.close();
    await this.unpackBuiltin('zip', src, o.where.unpack, o.label('Unpack extension'), o.depth);
    const js = walk(o.where.unpack).filter((f) => /\.(m?js|css|html?)$/i.test(f));
    if (js.length) await this.beautify(js.map((f) => [f, path.join(o.where.source, path.relative(o.where.unpack, f))]), o.label(`Beautify ${js.length} scripts`), o.depth);
  },
  async ipa(file, o) {
    await this.unpackBuiltin('zip', file, o.where.unpack, o.label('Unpack iOS app'), o.depth);
    const app = (fs.readdirSync(path.join(o.where.unpack, 'Payload')).find((n) => n.endsWith('.app'))) || '';
    const appDir = path.join(o.where.unpack, 'Payload', app);
    try { const p = require('./formats/plist').parse(fs.readFileSync(path.join(appDir, 'Info.plist'))); fs.mkdirSync(o.where.source, { recursive: true }); fs.writeFileSync(path.join(o.where.source, 'Info.plist.json'), JSON.stringify(p, null, 2)); if (p.CFBundleExecutable) { const exe = path.join(appDir, p.CFBundleExecutable); if (fs.existsSync(exe)) await this.unit(exe, { depth: o.depth + 1, kind: 'macho' }); } } catch {}
    await this.explore(o.where.unpack, o.depth + 1);
  },
  // Android
  async apk(file, o) { await this.jadx(file, o.where.source, o.label('Decompile Android app'), o.depth); await this.explore(path.join(o.where.source, 'resources'), o.depth + 1, { skip: (f) => /[/\\]res[/\\]|\.xml$|\.png$|\.webp$/.test(f) }); },
  async aab(file, o) { await HANDLERS.apk.call(this, file, o); },
  async aar(file, o) { await HANDLERS.apk.call(this, file, o); },
  async dex(file, o) { await this.jadx(file, o.where.source, o.label('Decompile DEX'), o.depth); },
  // Java
  async jar(file, o) {
    const s = this.step(o.label('Decompile Java'), { engine: 'vineflower', depth: o.depth });
    if (!this.ctx.engines.usable('vineflower')) return s.need('vineflower', 'Vineflower turns JARs into Java');
    let total = 0; try { const z = require('./formats/zip').open(file); total = z.entries.filter((e) => e.path.endsWith('.class') && !e.path.includes('$')).length; z.close(); } catch {}
    await this.ctx.scheduler.engine(s.title, async ({ threads, heapMB, priority }) => {
      s.start(threads);
      const r = await runners.vineflower({ java: this.ctx.engines.path('jdk'), jar: this.ctx.engines.path('vineflower') }, [file], o.where.source, { threads, heapMB, priority, total, signal: this.abort.signal, onProgress: (p, d) => s.update(p, d) });
      this.stats.sources += r.classes; s.done(plural(r.classes, 'class', 'classes'));
    }).catch((e) => { s.fail(e); if (e.cancelled) throw e; });
    if (this.opt.deep && o.depth < this.opt.maxDepth) {
      // nested jars (Spring Boot, fat jars) and anything else that isn't a class
      try { const z = require('./formats/zip').open(file); const inner = z.entries.filter((e) => /\.(jar|war|dex|so|dll|wasm)$/.test(e.path)); z.close(); if (inner.length) { await this.unpackBuiltin('zip', file, o.where.unpack, o.label('Unpack nested files'), o.depth); await this.explore(o.where.unpack, o.depth + 1, { skip: (f) => f.endsWith('.class') || !this.opt.libraries && /[/\\]lib[/\\][^/\\]+\.jar$/.test(f) }); } } catch {}
    }
  },
  async class(file, o) { await this.javaClasses(path.dirname(file), o.depth); },
  // .NET
  async dotnet(file, o) {
    if (o.top && this.opt.resources && this.ctx.engines.ready('sevenzip')) await this.unpack7z(file, path.join(o.where.unpack, 'resources'), o.label('Windows resources'), o.depth);
    await this.ilspy(file, o.where.source, o.label('Decompile .NET assembly'), o.depth);
  },
  async dotnetbundle(file, o) {
    await this.unpackBuiltin('dotnet-bundle', file, o.where.unpack, o.label('Unpack single-file bundle'), o.depth);
    const dlls = walk(o.where.unpack).filter((f) => f.endsWith('.dll') && (this.opt.libraries || !FRAMEWORK_DLL.test(path.basename(f))));
    const managed = (await this.ctx.pool.all([['identify', { files: dlls }]]))[0] || [];
    await settle(managed.filter((x) => x.kind === 'dotnet').map((x) => this.ilspy(x.path, path.join(o.where.source, path.basename(x.path, '.dll')), `Decompile ${path.basename(x.path)}`, o.depth + 1)));
  },
  async unity(file, o) {
    const root = this.identity.unityRoot && o.top ? this.identity.unityRoot : (fs.statSync(file).isDirectory() ? file : path.dirname(file));
    const data = fs.readdirSync(root).find((n) => /_Data$/.test(n));
    const managed = data ? path.join(root, data, 'Managed') : null;
    if (managed && fs.existsSync(managed)) {
      const dlls = fs.readdirSync(managed).filter((n) => n.endsWith('.dll') && (this.opt.libraries || !FRAMEWORK_DLL.test(n)));
      dlls.sort((a, b) => (/^Assembly-CSharp/.test(b) ? 1 : 0) - (/^Assembly-CSharp/.test(a) ? 1 : 0));
      await settle(dlls.map((n) => this.ilspy(path.join(managed, n), path.join(o.where.source, n.replace(/\.dll$/, '')), `Decompile ${n}`, o.depth + 1)));
    } else {
      const s = this.step('IL2CPP build', { depth: o.depth }); s.skip('This Unity game is compiled to native code (IL2CPP). Its scripts can be recovered with Il2CppDumper using GameAssembly and global-metadata.dat; Ghidra can decompile GameAssembly.');
      const ga = ['GameAssembly.dll', 'GameAssembly.so', 'UnityFramework'].map((n) => path.join(root, n)).find((p) => fs.existsSync(p));
      if (ga && this.opt.native) await this.ghidra(ga, path.join(o.where.source, 'GameAssembly'), 'Decompile GameAssembly (native)', o.depth + 1);
    }
  },
  // Python
  async pyinstaller(file, o) {
    const s = this.step(o.label('Unpack Python app'), { engine: 'builtin', depth: o.depth }); s.start(1);
    let r; try { r = await this.ctx.pool.run('pyinstaller', { file, outDir: o.where.unpack }, (p) => s.update(p.fraction)); } catch (e) { s.fail(e); return; }
    s.done(`Python ${r.version}: ${r.scripts.length} script(s), ${r.modules} modules${r.encrypted ? `, ${r.encrypted} encrypted` : ''}`);
    if (r.encrypted) this.notes.push(`${r.encrypted} module(s) are encrypted with PyInstaller’s key and stay as-is.`);
    const scripts = r.scripts.map((x) => path.join(o.where.unpack, x)).filter((x) => !/pyi(boot|_rth|mod)/.test(path.basename(x)));
    const mods = walk(o.where.unpack).filter((f) => f.endsWith('.pyc') && !scripts.includes(f));
    await this.pycBatch([...scripts, ...mods], o.depth, o.where.unpack);
    await this.explore(o.where.unpack, o.depth + 1, { skip: (f) => f.endsWith('.pyc') || /\.(pyd|so|dll|dylib)$/i.test(f) && !this.opt.nativeDeep });
  },
  async pyc(file, o) { await this.pycBatch([file], o.depth, path.dirname(file)); },
  // Native
  async pe(file, o) {
    if (o.top && this.ctx.engines.ready('sevenzip')) await this.unpack7z(file, path.join(o.where.unpack, 'Resources and sections'), o.label('Resources and sections'), o.depth);
    await this.ghidra(file, path.join(o.where.source, 'C'), o.label('Decompile native code'), o.depth);
  },
  async elf(file, o) { await this.ghidra(file, o.top ? path.join(o.where.source, 'C') : o.where.source, o.label('Decompile native code'), o.depth); },
  async macho(file, o) {
    const m = o.top ? this.identity.macho : null;
    if (m && m.arches.some((a) => a.encrypted)) { const s = this.step('Decompile native code', { engine: 'ghidra' }); return s.skip('Encrypted by the App Store'); }
    await this.ghidra(file, o.top ? path.join(o.where.source, 'C') : o.where.source, o.label('Decompile native code'), o.depth);
  },
  async upx(file, o) {
    const s = this.step(o.label('Unpack UPX'), { engine: 'upx', depth: o.depth });
    const bin = this.ctx.engines.path('upx');
    if (!bin) return s.need('upx', 'UPX unpacks this compressed program');
    s.start(1);
    const out = path.join(o.where.unpack, path.basename(file)); fs.mkdirSync(o.where.unpack, { recursive: true });
    try { await runners.upx(bin, file, out, { signal: this.abort.signal }); s.done('Unpacked'); } catch (e) { s.fail(e); return; }
    await this.unit(out, { depth: o.depth + 1 });
  },
  async appimage(file, o) {
    const e = require('./formats/elf').parse(file);
    const r = new FileReader(file); const sq = o.where.unpack + '.squashfs'; fs.mkdirSync(path.dirname(sq), { recursive: true });
    try { copyRange(r.fd, e.endOfElf, r.size - e.endOfElf, sq); } finally { r.close(); }
    await this.unpack7z(sq, o.where.unpack, o.label('Unpack AppImage'), o.depth);
    fs.rmSync(sq, { force: true });
    await this.explore(o.where.unpack, o.depth + 1);
  },
  // Installers & archives through 7-Zip
  ...Object.fromEntries([...SEVENZIP_KINDS].map((k) => [k, async function (file, o) {
    if (k === 'pkg') return HANDLERS._pkg.call(this, file, o);
    const ok = await this.unpack7z(file, o.where.unpack, o.label(k === 'nsis' ? 'Unpack NSIS installer' : k === 'msi' ? 'Unpack Windows Installer' : `Unpack ${kindLabel(k)}`), o.depth);
    if (ok) await this.explore(o.where.unpack, o.depth + 1);
  }])),
  async _pkg(file, o) {
    if (!(await this.unpack7z(file, o.where.unpack, o.label('Unpack installer package'), o.depth))) return;
    // Payload files are pbzx or gzip'd cpio archives
    for (const p of walk(o.where.unpack).filter((f) => path.basename(f) === 'Payload')) {
      const misc = require('./formats/misc'); const r = misc.pbzx(p, p + '.pbzx');
      if (r && r.xz) { await this.unpack7z(r.xz, p + ' (xz)', `Payload — ${path.relative(o.where.unpack, p)}`, o.depth + 1); fs.rmSync(r.xz, { force: true }); }
    }
    await this.explore(o.where.unpack, o.depth + 1);
  },
  async sfx(file, o) {
    const traits = o.id.traits || [];
    if (traits.includes('ZIP')) { await this.unpackBuiltin('zip', file, o.where.unpack, o.label('Unpack self-extractor'), o.depth); }
    else await this.unpack7z(file, o.where.unpack, o.label('Unpack self-extractor'), o.depth);
    await this.explore(o.where.unpack, o.depth + 1);
  },
  async inno(file, o) {
    const bin = this.ctx.engines.path('innoextract');
    const s = this.step(o.label('Unpack Inno Setup installer'), { engine: 'innoextract', depth: o.depth });
    if (!bin) { s.need('innoextract', 'innoextract isn’t on this computer'); if (o.top && this.ctx.engines.ready('sevenzip')) await this.unpack7z(file, path.join(o.where.unpack, 'Resources'), 'Installer resources', o.depth); return; }
    s.start(1);
    try { await runners.innoextract(bin, file, o.where.unpack, { signal: this.abort.signal }); s.done(); } catch (e) { s.fail(e); return; }
    await this.explore(o.where.unpack, o.depth + 1);
  },
  // Discs
  async iso(file, o) {
    let info = null; try { const c = require('./formats/iso9660').open(file); info = c.info; c.close(); } catch {}
    if (!info) return HANDLERS.udf.call(this, file, o);
    await this.unpackBuiltin('iso9660', file, o.where.unpack, o.label(`Read disc (${info.names}${info.rockRidge ? ' + Rock Ridge' : ''})`), o.depth);
    await this.explore(o.where.unpack, o.depth + 1);
  },
  async xiso(file, o) { await this.unpackBuiltin('xiso', file, o.where.unpack, o.label('Read Xbox disc'), o.depth); await this.explore(o.where.unpack, o.depth + 1); },
  async gcm(file, o) { await this.unpackBuiltin('gcm', file, o.where.unpack, o.label('Read GameCube disc'), o.depth); await this.explore(o.where.unpack, o.depth + 1); },
  async wii(file, o) { this.step(o.label('Wii disc'), { depth: o.depth }).skip('Partitions are encrypted; header shown in the overview'); },
  async cso(file, o) {
    const cso = require('./formats/cso'); const s = this.step(o.label('Decompress CSO/ZSO'), { engine: 'builtin', depth: o.depth });
    const info = cso.info(file); const out = path.join(o.where.unpack, path.basename(file).replace(/\.(cso|zso|ciso)$/i, '') + '.iso'); fs.mkdirSync(o.where.unpack, { recursive: true });
    cso.prepare(file, out);
    const n = this.ctx.budget().workers; s.start(n);
    const per = Math.ceil(info.blocks / (n * 4)); const tasks = [];
    for (let b = 0; b < info.blocks; b += per) tasks.push(['cso', { file, dest: out, from: b, to: Math.min(info.blocks, b + per) }]);
    const r = await this.ctx.pool.all(tasks, (d, t) => s.update(d / t, `${fmtSize(info.size * d / t)} of ${fmtSize(info.size)}`));
    const bad = r.filter((x) => x.error); if (bad.length) { s.fail(new Error(bad[0].error)); return; }
    s.done(`${fmtSize(info.size)} on ${Math.min(n, tasks.length)} cores`);
    await this.unit(out, { depth: o.depth + 1 });
  },
  // Games
  async godot(file, o) {
    await this.unpackBuiltin('godot', file, o.where.unpack, o.label('Unpack Godot pack'), o.depth);
    const gdc = walk(o.where.unpack).filter((f) => f.endsWith('.gdc')).length;
    if (gdc) this.notes.push(`${gdc} script(s) are compiled GDScript (.gdc); gdsdecomp can turn them back into .gd.`);
    await this.explore(o.where.unpack, o.depth + 1);
  },
  async rgss(file, o) {
    const s = this.step(o.label('Decrypt RPG Maker archive'), { engine: 'builtin', depth: o.depth }); s.start(1);
    const a = require('./formats/misc').openRgss(file);
    try { a.entries.forEach((e, i) => { a.extract(e, safeJoin(o.where.unpack, e.path)); if (i % 20 === 0) s.update(i / a.entries.length); }); } finally { a.close(); }
    s.done(`${a.entries.length} files`);
    await this.explore(o.where.unpack, o.depth + 1);
  },
  async swf(file, o) {
    const s = this.step(o.label('Flash movie'), { engine: 'builtin', depth: o.depth }); s.start(1);
    try {
      const r = require('./formats/misc').swf(file, o.where.unpack, { lzma: null });
      s.done(`Flash ${r.version}: ${r.abc} ActionScript block(s), ${r.images} images, ${r.classes} classes`);
    } catch (e) { if (e.needs7z) s.skip('LZMA-compressed SWF; open it with 7-Zip first'); else s.fail(e); }
  },
  async uimage(file, o) {
    const r = new FileReader(file); const h = r.read(0, 64);
    const size = h.readUInt32BE(12), comp = ['none', 'gzip', 'bzip2', 'lzma', 'lzo', 'lz4', 'zstd'][h[31]] || 'unknown', name = h.toString('latin1', 32, 64).replace(/\0.*$/, '');
    const out = path.join(o.where.unpack, `${name.replace(/[^\w.-]+/g, '_') || 'payload'}.${{ gzip: 'gz', bzip2: 'bz2', lzma: 'lzma', zstd: 'zst', lz4: 'lz4' }[comp] || 'bin'}`);
    try { copyRange(r.fd, 64, Math.min(size, r.size - 64), out); } finally { r.close(); }
    this.step(o.label('U-Boot payload'), { depth: o.depth }).done(`${name} (${comp})`);
    await this.explore(o.where.unpack, o.depth + 1);
  },
  async firmware(file, o) { await this.carve(file, o); },
  async unknown(file, o) { await this.carve(file, o); },
};

// ───────── helpers
function settle(promises) { return Promise.allSettled(promises).then((rs) => { const c = rs.find((r) => r.status === 'rejected' && r.reason && r.reason.cancelled); if (c) throw c.reason; return rs; }); }
function classRoot(f) {
  // Walk up while the folder name looks like a Java package segment.
  let d = path.dirname(f);
  while (/^[a-z_$][\w$]*$/.test(path.basename(d)) && path.dirname(d) !== d) d = path.dirname(d);
  return d;
}
function strip(id) { const { pe, elf, macho, ...rest } = id; return rest; }
function interesting(strings) {
  const out = { urls: new Set(), paths: new Set(), emails: new Set(), ips: new Set(), keys: new Set(), registry: new Set() };
  for (const { s } of strings) {
    for (const m of s.matchAll(/\bhttps?:\/\/[^\s"'<>\\)]{4,200}/g)) out.urls.add(m[0]);
    for (const m of s.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/g)) if (!/\.(png|jpg|so|dll)$/.test(m[0])) out.emails.add(m[0]);
    for (const m of s.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{2,5})?\b/g)) if (!/^(\d+\.){3}\d+$/.test(m[0]) || m[0].split('.').every((x) => +x.split(':')[0] < 256)) out.ips.add(m[0]);
    if (/^(HKEY_|HKLM\\|HKCU\\|SOFTWARE\\)/i.test(s)) out.registry.add(s);
    if (/^([A-Za-z]:\\|\/(usr|etc|var|home|Users|Library|System|opt|tmp)\/)/.test(s)) out.paths.add(s);
    if (/\b(AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|sk_live_[0-9a-zA-Z]{20,}|ghp_[0-9A-Za-z]{36}|xox[baprs]-[0-9A-Za-z-]{10,})\b/.test(s)) out.keys.add(s.slice(0, 120));
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v].slice(0, 300)]));
}

// Engines a job will probably need, so the start sheet can offer them up front.
function plannedEngines(identity, opt = {}) {
  const k = identity.kind; const out = new Set();
  if (['apk', 'aab', 'aar', 'dex', 'apkbundle'].includes(k)) out.add('jadx');
  if (['jar', 'class'].includes(k)) out.add('vineflower');
  if (['dotnet', 'dotnetbundle', 'nupkg'].includes(k) || (k === 'unity' && identity.traits.includes('Mono'))) out.add('ilspy');
  if ((NATIVE.has(k) || k === 'app' || k === 'upx') && opt.native !== false) out.add('ghidra');
  if (SEVENZIP_KINDS.has(k) || k === 'udf' || k === 'appimage' || k === 'sfx' && !identity.traits.includes('ZIP') || k === 'pe') out.add('sevenzip');
  if (k === 'upx') out.add('upx');
  if (k === 'electron' || k === 'asar') out.add('builtin');
  out.delete('builtin');
  return [...out];
}

module.exports = { Job, HANDLERS, plannedEngines, CONTAINERS, interesting };
