'use strict';
// One undo history for everything Fresh Desk changes: explorer moves,
// renames, copies, new folders and Tidy batches. Persisted in app-data so
// Undo survives a restart. Entries hold paths only, never file contents.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const organizer = require('./organizer');

const LIMIT = 60;

class History {
  constructor(dir, trash) {
    this.file = path.join(dir, 'history.json');
    this.trash = trash; // async (path) => void, moves to OS Trash
    this.batches = null;
  }
  async load() {
    if (this.batches) return this.batches;
    let raw;
    try { raw = JSON.parse(await fs.readFile(this.file, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') console.error('history unreadable', e.message); raw = []; }
    // Fresh Desk 0.x stored a flat list of organizer moves. Keep them undoable.
    if (Array.isArray(raw)) {
      const legacy = raw.filter(e => e && ['moved', 'pending'].includes(e.status));
      this.batches = legacy.length ? [{id: 'legacy', label: `Earlier organize (${legacy.length} files)`, time: Date.now(), type: 'tidy', ops: legacy, status: 'done'}] : [];
    } else this.batches = Array.isArray(raw.batches) ? raw.batches : [];
    return this.batches;
  }
  async save() {
    await fs.mkdir(path.dirname(this.file), {recursive: true});
    const tmp = this.file + '.tmp';
    await fs.writeFile(tmp, JSON.stringify({version: 2, batches: this.batches.slice(-LIMIT)}), {mode: 0o600});
    await fs.rename(tmp, this.file);
  }
  async begin(label, type = 'file') {
    await this.load();
    const batch = {id: crypto.randomUUID(), label, time: Date.now(), type, ops: [], status: 'open'};
    this.batches.push(batch);
    return batch;
  }
  async commit(batch) {
    batch.status = 'done';
    if (!batch.ops.length) this.batches = this.batches.filter(b => b !== batch);
    await this.save();
  }
  async record(label, ops) {
    const batch = await this.begin(label);
    batch.ops.push(...ops);
    await this.commit(batch);
    return batch;
  }
  async peek() {
    await this.load();
    return [...this.batches].reverse().find(b => b.status === 'done') || null;
  }
  async list() { await this.load(); return [...this.batches].reverse().filter(b => b.status === 'done').map(({id, label, time, type, ops}) => ({id, label, time, type, count: ops.length})); }

  async undo(id) {
    await this.load();
    const batch = id ? this.batches.find(b => b.id === id && b.status === 'done') : await this.peek();
    if (!batch) return {label: null, results: []};
    let results;
    if (batch.type === 'tidy') {
      results = await organizer.undo(batch.ops, () => this.save());
    } else {
      results = [];
      for (const op of [...batch.ops].reverse()) {
        try {
          if (op.type === 'move' || op.type === 'rename') {
            if (!(await exists(op.to))) throw Error('It’s no longer where Fresh Desk put it.');
            if (await exists(op.from) && op.from.toLowerCase() !== op.to.toLowerCase()) throw Error('Something else now has its original name.');
            await fs.mkdir(path.dirname(op.from), {recursive: true});
            await fs.rename(op.to, op.from);
          } else if (op.type === 'create') {
            if (await exists(op.path)) await this.trash(op.path);
          }
          op.undone = true;
          results.push({name: path.basename(op.from || op.path), ok: true});
        } catch (e) { results.push({name: path.basename(op.from || op.path), ok: false, error: e.message}); }
      }
    }
    batch.status = results.every(r => r.ok) ? 'undone' : 'partial';
    // Partially undone batches drop the parts that worked so a retry only touches the rest.
    if (batch.status === 'partial') { batch.ops = batch.ops.filter(o => !o.undone && o.status !== 'undone'); batch.status = 'done'; }
    await this.save();
    return {label: batch.label, results};
  }
}
async function exists(p) { try { await fs.lstat(p); return true; } catch { return false; } }

module.exports = {History};
