// Trace — reads a real folder into a tree so it can become a folder-plan chart. Folders only, read-only, never follows links.
const fs = require('fs');
const path = require('path');

const SKIP = new Set(['node_modules', '$RECYCLE.BIN', 'System Volume Information', '__pycache__', '.git', 'Thumbs.db']);
// Folders that are really documents/bundles on a Mac; treat them like files.
const BUNDLE = /\.(app|photoslibrary|musiclibrary|tvlibrary|fcpbundle|logicx|band|framework|bundle|plugin|kext|pkg|rtfd|sparsebundle|xcodeproj|xcworkspace|lrdata|lrlibrary)$/i;

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i).toLowerCase() : '';
}

function scan(root, opts = {}) {
  const depth = Math.max(1, Math.min(6, opts.depth || 3));
  const maxFolders = opts.maxFolders || 400;
  const maxChildren = opts.maxChildren || 40;
  let folders = 0;
  const base = path.resolve(root);
  const st = fs.lstatSync(base);
  if (!st.isDirectory()) throw new Error('Pick a folder, not a file.');

  function walk(dir, level) {
    folders++;
    const node = { name: path.basename(dir) || dir, rel: path.relative(base, dir) || '.', files: 0, counts: {}, children: [], more: 0 };
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { node.unreadable = true; return node; }
    const subdirs = [];
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory() && !BUNDLE.test(e.name)) { subdirs.push(e.name); continue; }
      if (e.isFile() || e.isDirectory()) {
        node.files++;
        const x = BUNDLE.test(e.name) ? extOf(e.name) : extOf(e.name) || '(none)';
        node.counts[x] = (node.counts[x] || 0) + 1;
      }
    }
    subdirs.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
    if (level < depth) {
      for (const name of subdirs) {
        if (node.children.length >= maxChildren || folders >= maxFolders) { node.more++; continue; }
        node.children.push(walk(path.join(dir, name), level + 1));
      }
    } else node.more = subdirs.length;
    return node;
  }
  const tree = walk(base, 1);
  tree.path = base;
  tree.truncated = folders >= maxFolders;
  return tree;
}

// The biggest file types in a folder, e.g. [['.pdf', 34], ['.jpg', 12]]
const topTypes = (counts, n = 4) => Object.entries(counts || {}).sort((a, b) => b[1] - a[1]).slice(0, n);

module.exports = { scan, topTypes, extOf };
