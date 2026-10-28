// Bench — findings: bugs and problems found while testing (filed by Claude or by you), each with the app and
// version, steps, what was expected and what happened, a screenshot and the logs around it. Copy one as Markdown to
// paste into that app's chat.
'use strict';
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { Collection, newId, safeRemove } = require('./store');

const SEVERITY = ['high', 'medium', 'low'];
const STATUS = ['open', 'fixed', 'wontfix', 'dismissed'];

class Findings extends EventEmitter {
  constructor(dataDir) { super(); this.dir = path.join(dataDir, 'findings'); fs.mkdirSync(this.dir, { recursive: true }); this.store = new Collection(path.join(dataDir, 'findings.json')); }
  list({ status, app } = {}) { return this.store.all().filter((f) => (!status || status === 'all' || f.status === status) && (!app || (f.app || '').toLowerCase() === String(app).toLowerCase())); }
  get(id) { return this.store.get(id) || this.store.all().find((f) => f.number === +id) || null; }
  add(o) {
    if (!o.title || !String(o.title).trim()) throw new Error('A finding needs a title');
    const id = newId('f'); const folder = path.join(this.dir, id); fs.mkdirSync(folder, { recursive: true });
    const steps = Array.isArray(o.steps) ? o.steps.map(String).filter(Boolean) : String(o.steps || '').split(/\n+/).map((s) => s.replace(/^\s*(\d+[.)]|[-*•])\s*/, '').trim()).filter(Boolean);
    const rec = {
      id, number: (this.store.all().reduce((m, f) => Math.max(m, f.number || 0), 0) || 0) + 1,
      title: String(o.title).trim().slice(0, 160), severity: SEVERITY.includes(o.severity) ? o.severity : 'medium', status: 'open',
      app: o.app || '', version: o.version || '', desk: o.desk || '', deskName: o.deskName || '', platform: o.platform || process.platform,
      steps, expected: o.expected || '', actual: o.actual || '', notes: o.notes || '', who: o.who || 'Claude', created: Date.now(), updated: Date.now(), shots: [], logFile: null,
    };
    for (const [i, s] of (o.screenshots || []).entries()) { const f = path.join(folder, `screenshot-${i + 1}.${s.mime === 'image/jpeg' ? 'jpg' : 'png'}`); fs.writeFileSync(f, s.buffer); rec.shots.push(f); }
    if (o.logs) { const f = path.join(folder, 'logs.txt'); fs.writeFileSync(f, o.logs); rec.logFile = f; rec.logExcerpt = String(o.logs).split('\n').filter((l) => /\[error\]|\[warning\]/.test(l)).slice(-12).join('\n').slice(0, 3000); }
    this.store.add(rec); this.emit('changed', { id }); return rec;
  }
  update(id, patch) {
    const f = this.get(id); if (!f) throw new Error(`No finding ${id}`);
    const p = {}; if (patch.status) { if (!STATUS.includes(patch.status)) throw new Error(`Status is one of ${STATUS.join(', ')}`); p.status = patch.status; }
    for (const k of ['title', 'severity', 'expected', 'actual']) if (patch[k] != null) p[k] = patch[k];
    if (patch.note) p.notes = (f.notes ? f.notes + '\n' : '') + patch.note;
    p.updated = Date.now();
    const r = this.store.update(f.id, p); this.emit('changed', { id: f.id }); return r;
  }
  remove(id) { const f = this.get(id); if (!f) return false; try { safeRemove(path.join(this.dir, f.id), [this.dir]); } catch {} this.store.remove(f.id); this.emit('changed', { id: f.id }); return true; }
  markdown(id) {
    const f = this.get(id); if (!f) throw new Error(`No finding ${id}`);
    const L = [`## ${f.title}`, '', `**App:** ${f.app || 'unknown'}${f.version ? ' ' + f.version : ''} · **Severity:** ${f.severity} · **Found by:** ${f.who} in Bench (${f.deskName || 'desk'}, ${{ darwin: 'Mac', win32: 'Windows', linux: 'Linux' }[f.platform] || f.platform}) · ${new Date(f.created).toLocaleString()}`, ''];
    if (f.steps.length) { L.push('**Steps**', ''); f.steps.forEach((s, i) => L.push(`${i + 1}. ${s}`)); L.push(''); }
    if (f.expected) L.push(`**Expected:** ${f.expected}`, '');
    if (f.actual) L.push(`**What happened:** ${f.actual}`, '');
    if (f.notes) L.push(f.notes, '');
    if (f.logExcerpt) L.push('**Errors from the logs**', '', '```', f.logExcerpt, '```', '');
    if (f.shots.length) L.push(`Screenshot${f.shots.length > 1 ? 's' : ''}: ${f.shots.join(', ')}`);
    if (f.logFile) L.push(`Full logs: ${f.logFile}`);
    return L.join('\n').trim() + '\n';
  }
}

module.exports = { Findings, SEVERITY, STATUS };
