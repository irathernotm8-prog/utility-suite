// Cadence — file and folder steps.
'use strict';
const fs = require('fs');
const path = require('path');

function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') re += '[^/\\\\]*';
    else if (c === '?') re += '.';
    else if (c === '{') { const e = glob.indexOf('}', i); if (e > i) { re += '(' + glob.slice(i + 1, e).split(',').map((x) => x.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')).join('|') + ')'; i = e; } else re += '\\{'; }
    else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$', 'i');
}
function matcher(patterns) {
  const list = String(patterns || '*').split(/[,;]\s*/).map((p) => p.trim()).filter(Boolean);
  const res = list.map(globToRegex);
  return (name) => res.some((r) => r.test(name));
}

// Accept "a", ["a","b"], {file}, {files}, outputs of earlier steps.
function fileList(v) {
  if (v == null || v === '') return [];
  if (typeof v === 'string') return v.split(/\n/).map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(v)) return v.flatMap(fileList);
  if (typeof v === 'object') { if (Array.isArray(v.files)) return fileList(v.files); if (v.file) return fileList(v.file); if (v.folder) return [v.folder]; }
  return [];
}

function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const dir = path.dirname(p), ext = path.extname(p), stem = path.basename(p, ext);
  for (let i = 2; i < 10000; i++) { const q = path.join(dir, `${stem} (${i})${ext}`); if (!fs.existsSync(q)) return q; }
  throw new Error('Too many files with that name');
}

function walk(dir, { subfolders, folders = false } = {}, out = []) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { throw new Error(`Can’t open ${dir}: ${e.code === 'ENOENT' ? 'it doesn’t exist' : e.message}`); }
  for (const e of ents) {
    if (e.name.startsWith('.') || e.name === 'Thumbs.db' || e.name === 'desktop.ini') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (folders) out.push(p); if (subfolders) walk(p, { subfolders, folders }, out); }
    else if (e.isFile() && !/\.(crdownload|part|download|tmp)$/i.test(e.name)) out.push(p);
  }
  return out;
}

module.exports = {
  'folder.make': async (w, x) => {
    const p = x.resolvePath(w.path);
    if (!p) throw new Error('Choose a folder path');
    fs.mkdirSync(p, { recursive: true });
    x.log(`Folder ready: ${p}`);
    return { folder: p };
  },

  'file.save': async (w, x) => {
    const files = fileList(w.files);
    if (!files.length) throw new Error('No files to save. Check the Files field points at an earlier step’s file or files.');
    const to = x.resolvePath(w.to);
    if (!to) throw new Error('Choose a folder to save into');
    fs.mkdirSync(to, { recursive: true });
    const out = [];
    files.forEach((src, i) => {
      if (!fs.existsSync(src)) throw new Error(`File not found: ${src}`);
      const ext = path.extname(src).replace(/^\./, ''); const stem = path.basename(src, path.extname(src));
      let name = w.rename ? x.renderText(w.rename, { name: path.basename(src), stem, ext, index: i + 1 }).trim() : path.basename(src);
      name = name.replace(/[\\/:*?"<>|]+/g, '-');
      if (w.rename && ext && !path.extname(name)) name += '.' + ext;
      let dest = path.join(to, name);
      if (path.resolve(dest) === path.resolve(src)) { out.push(dest); return; }
      if (fs.existsSync(dest)) {
        if (w.ifExists === 'skip') { x.log(`Already there, skipped: ${name}`); out.push(dest); return; }
        if (w.ifExists === 'keepBoth') dest = uniquePath(dest);
      }
      if (w.mode === 'move') { try { fs.renameSync(src, dest); } catch (e) { if (e.code !== 'EXDEV') throw e; fs.copyFileSync(src, dest); fs.unlinkSync(src); } }
      else fs.copyFileSync(src, dest);
      x.log(`${w.mode === 'move' ? 'Moved' : 'Saved'} ${path.basename(dest)} → ${to}`);
      out.push(dest);
    });
    return { file: out[0], files: out, folder: to };
  },

  'file.find': async (w, x) => {
    const dir = x.resolvePath(w.folder);
    const match = matcher(w.pattern || '*');
    let files = walk(dir, { subfolders: !!w.subfolders }).filter((p) => match(path.basename(p)));
    const within = Number(w.within);
    const stat = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
    if (within > 0) { const cut = Date.now() - within * 3600e3; files = files.filter((p) => stat(p) >= cut); }
    files.sort((a, b) => stat(b) - stat(a));
    if (w.pick === 'newest') files = files.slice(0, 1);
    if (w.pick === 'oldest') files = files.slice(-1);
    if (!files.length && w.required !== false) throw new Error(`No files matching “${w.pattern || '*'}” in ${dir}${within > 0 ? ` from the last ${within} hours` : ''}`);
    x.log(`Found ${files.length} file${files.length === 1 ? '' : 's'}`);
    return { file: files[0] || '', files, count: files.length };
  },

  'file.unzip': async (w, x) => {
    const [zip] = fileList(w.file);
    if (!zip) throw new Error('Choose a zip file');
    const { unzipSync } = require('fflate');
    const to = w.to ? x.resolvePath(w.to) : path.join(x.dir, path.basename(zip, path.extname(zip)));
    fs.mkdirSync(to, { recursive: true });
    const entries = unzipSync(new Uint8Array(fs.readFileSync(zip)));
    const files = [];
    for (const [name, data] of Object.entries(entries)) {
      if (name.endsWith('/') || name.startsWith('__MACOSX/') || /(^|\/)\.DS_Store$/.test(name)) continue;
      const dest = path.resolve(to, name);
      if (!dest.startsWith(path.resolve(to) + path.sep)) throw new Error(`Unsafe path in zip: ${name}`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, data); files.push(dest);
    }
    x.log(`Extracted ${files.length} file${files.length === 1 ? '' : 's'} to ${to}`);
    return { folder: to, files, file: files[0] || '' };
  },

  'file.write': async (w, x) => {
    const p = x.resolvePath(w.path);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const text = typeof w.content === 'string' ? w.content : JSON.stringify(w.content, null, 2);
    if (w.append) fs.appendFileSync(p, (fs.existsSync(p) && fs.statSync(p).size ? '\n' : '') + text); else fs.writeFileSync(p, text);
    x.log(`Wrote ${path.basename(p)}`);
    return { file: p };
  },

  'file.cleanup': async (w, x) => {
    const dir = x.resolvePath(w.folder);
    const days = Math.max(0, Number(w.days) || 0);
    if (!days) throw new Error('Set how many days old files must be');
    const home = require('os').homedir();
    if ([home, path.parse(dir).root].includes(path.resolve(dir))) throw new Error('Pick a specific folder, not your whole home folder or drive');
    const match = matcher(w.pattern || '*');
    const cut = Date.now() - days * 864e5;
    const items = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith('.') && (e.isFile() || (w.folders && e.isDirectory())) && match(e.name)).map((e) => path.join(dir, e.name));
    let n = 0;
    for (const p of items) {
      if (fs.statSync(p).mtimeMs >= cut) continue;
      if (x.services.trash) await x.services.trash(p); else fs.rmSync(p, { recursive: true, force: true });
      x.log(`Moved to Trash: ${path.basename(p)}`); n++;
    }
    if (!n) x.log('Nothing old enough');
    return { count: n };
  },
};
module.exports._ = { globToRegex, matcher, fileList, uniquePath };
