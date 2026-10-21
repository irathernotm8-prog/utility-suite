// Docket — storage. Everything lives in one visible folder (default ~/Documents/Docket):
//   meetings/<id>/meeting.json   the meeting (the window owns this file; main only writes what the window sends)
//   meetings/<id>/audio.webm     the recording, appended in chunks while it runs
//   meetings/<id>/notes.md       a readable copy written on every save, so notes are useful outside the app
//   todos.json                   every to-do across meetings (main owns this file)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const uid = (n = 10) => crypto.randomBytes(16).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, n).toLowerCase();
const ID_RE = /^[a-z0-9]{6,24}$/;
const checkId = (id) => { if (!ID_RE.test(String(id || ''))) throw new Error('Bad meeting id'); return String(id); };

function writeAtomic(file, data) {
  const tmp = file + '.' + uid(6) + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; } };

const clock = (sec) => {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(s).padStart(2, '0');
};
const speakerName = (m, ch) => (m.speakers && m.speakers[ch]) || (ch === 'me' ? 'You' : ch === 'them' ? 'Them' : 'Speaker');

// The readable copy. Plain Markdown, newest content first: summary, decisions, to-dos, your notes, transcript.
function toMarkdown(m, todos = []) {
  const L = [];
  const when = m.startedAt ? new Date(m.startedAt) : null;
  L.push('# ' + (m.title || 'Meeting'), '');
  const meta = [when ? when.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '', m.durationMs ? clock(m.durationMs / 1000) : '', m.app || ''].filter(Boolean);
  if (meta.length) L.push('_' + meta.join(' · ') + '_', '');
  const s = m.summary;
  if (s) {
    if (s.text) L.push('## Summary', '', s.text, '');
    if (s.keyPoints && s.keyPoints.length) L.push('## Key points', '', ...s.keyPoints.map((x) => '- ' + x), '');
    if (s.decisions && s.decisions.length) L.push('## Decisions', '', ...s.decisions.map((x) => '- ' + x), '');
    if (s.openQuestions && s.openQuestions.length) L.push('## Open questions', '', ...s.openQuestions.map((x) => '- ' + x), '');
  }
  if (todos.length) {
    L.push('## To-dos', '');
    for (const t of todos) L.push(`- [${t.done ? 'x' : ' '}] ${t.text}${t.owner ? ' — ' + t.owner : ''}${t.due ? ' (due ' + t.due + ')' : ''}`);
    L.push('');
  }
  if (m.notes && m.notes.trim()) L.push('## My notes', '', m.notes.trim(), '');
  const segs = (m.segments || []).filter((x) => x.text && x.text.trim());
  if (segs.length) {
    L.push('## Transcript', '');
    for (const x of segs) L.push(`**[${clock(x.t0)}] ${speakerName(m, x.ch)}:** ${x.text.trim()}`, '');
  }
  return L.join('\n');
}

class Store {
  constructor(root) {
    this.root = root;
    this.meetingsDir = path.join(root, 'meetings');
    fs.mkdirSync(this.meetingsDir, { recursive: true });
    this.todosFile = path.join(root, 'todos.json');
    this._todos = null;
  }
  dir(id) { return path.join(this.meetingsDir, checkId(id)); }
  file(id, name) {
    if (!/^[a-z0-9._-]{1,40}$/i.test(name) || name.includes('..')) throw new Error('Bad file name');
    return path.join(this.dir(id), name);
  }

  // ---- meetings ----
  create(init = {}) {
    const id = uid(10);
    const now = Date.now();
    const m = {
      id, version: 1, title: init.title || defaultTitle(now), titleEdited: false,
      createdAt: now, startedAt: init.startedAt || now, endedAt: null, durationMs: 0,
      source: init.source || 'live', app: init.app || '', status: init.status || 'recording',
      speakers: { me: init.myName || 'You', them: 'Them', mix: 'Speaker' },
      segments: [], marks: [], notes: '', summary: null, audio: null, sourceFile: init.sourceFile || ''
    };
    fs.mkdirSync(this.dir(id), { recursive: true });
    this.save(m);
    return m;
  }
  load(id) {
    const m = readJson(this.file(id, 'meeting.json'), null);
    if (!m) throw new Error('That meeting could not be opened.');
    return m;
  }
  save(m) {
    checkId(m.id);
    if (!fs.existsSync(this.dir(m.id))) fs.mkdirSync(this.dir(m.id), { recursive: true });
    m.updatedAt = Date.now();
    writeAtomic(this.file(m.id, 'meeting.json'), JSON.stringify(m, null, 1));
    try { writeAtomic(this.file(m.id, 'notes.md'), toMarkdown(m, this.todos().filter((t) => t.meetingId === m.id))); } catch (_) {}
    return { updatedAt: m.updatedAt };
  }
  remove(id) {
    fs.rmSync(this.dir(id), { recursive: true, force: true });
    this.writeTodos(this.todos().filter((t) => t.meetingId !== id || t.done));
  }
  list() {
    let ids = [];
    try { ids = fs.readdirSync(this.meetingsDir).filter((d) => ID_RE.test(d)); } catch (_) {}
    const out = [];
    for (const id of ids) {
      const m = readJson(path.join(this.meetingsDir, id, 'meeting.json'), null);
      if (m) out.push(summaryOf(m));
    }
    return out.sort((a, b) => b.startedAt - a.startedAt);
  }
  // Plain text search over titles, summaries, notes and transcripts. Returns ids with a snippet.
  search(q) {
    const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const out = [];
    for (const meta of this.list()) {
      const m = readJson(path.join(this.meetingsDir, meta.id, 'meeting.json'), null); if (!m) continue;
      const hay = searchText(m);
      const low = hay.toLowerCase();
      if (!words.every((w) => low.includes(w))) continue;
      const i = low.indexOf(words[0]);
      out.push({ id: m.id, snippet: hay.slice(Math.max(0, i - 50), i + 110).replace(/\s+/g, ' ').trim() });
    }
    return out;
  }

  // ---- audio: chunks append; when the recording ends the file gets a Duration so players can seek ----
  appendAudio(id, bytes) { fs.appendFileSync(this.file(id, 'audio.webm'), Buffer.from(bytes)); }
  finishAudio(id, durationMs) {
    const f = this.file(id, 'audio.webm');
    if (!fs.existsSync(f)) return false;
    try { const fixed = require('./webm').setDuration(fs.readFileSync(f), durationMs); if (fixed) writeAtomic(f, fixed); } catch (_) {}
    return true;
  }
  removeAudio(id) { fs.rmSync(this.file(id, 'audio.webm'), { force: true }); }

  // ---- to-dos ----
  todos() { if (!this._todos) this._todos = readJson(this.todosFile, []); return this._todos; }
  writeTodos(list) { this._todos = list; writeAtomic(this.todosFile, JSON.stringify(list, null, 1)); return list; }
  addTodos(items) {
    const now = Date.now();
    const made = (items || []).map((t) => cleanTodo({ ...t, id: uid(10), createdAt: now, done: false }));
    this.writeTodos([...this.todos(), ...made]);
    return made;
  }
  updateTodo(id, patch) {
    const list = this.todos().map((t) => t.id === id ? cleanTodo({ ...t, ...patch, id: t.id, createdAt: t.createdAt, edited: t.edited || ('text' in patch || 'owner' in patch || 'due' in patch), doneAt: 'done' in patch ? (patch.done ? Date.now() : null) : t.doneAt }) : t);
    this.writeTodos(list);
    return list.find((t) => t.id === id) || null;
  }
  deleteTodos(ids) { const s = new Set(ids); this.writeTodos(this.todos().filter((t) => !s.has(t.id))); }
  // A fresh summary replaces the AI to-dos it made last time, except ones you've ticked or edited.
  replaceAiTodos(meetingId, items) {
    const keep = this.todos().filter((t) => !(t.meetingId === meetingId && t.source === 'ai' && !t.done && !t.edited));
    const have = new Set(keep.filter((t) => t.meetingId === meetingId).map((t) => norm(t.text)));
    const now = Date.now();
    const made = (items || []).filter((t) => t.text && !have.has(norm(t.text))).map((t) => cleanTodo({ ...t, id: uid(10), createdAt: now, done: false, meetingId, source: 'ai' }));
    this.writeTodos([...keep, ...made]);
    return made;
  }
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
function cleanTodo(t) {
  return {
    id: t.id, text: String(t.text || '').trim().slice(0, 500), done: !!t.done, owner: String(t.owner || '').trim().slice(0, 80),
    due: String(t.due || '').trim().slice(0, 40), meetingId: t.meetingId && ID_RE.test(t.meetingId) ? t.meetingId : null,
    t: Number.isFinite(+t.t) && t.t !== '' && t.t !== null ? +t.t : null, source: ['ai', 'manual', 'suggested'].includes(t.source) ? t.source : 'manual',
    createdAt: t.createdAt || Date.now(), doneAt: t.doneAt || null, edited: !!t.edited
  };
}
function defaultTitle(ts) {
  return 'Meeting · ' + new Date(ts).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function searchText(m) {
  const s = m.summary || {};
  return [m.title, s.text, ...(s.keyPoints || []), ...(s.decisions || []), m.notes, ...(m.segments || []).map((x) => x.text)].filter(Boolean).join('  ');
}
function summaryOf(m) {
  const words = (m.segments || []).reduce((n, x) => n + (x.text ? x.text.split(/\s+/).length : 0), 0);
  return {
    id: m.id, title: m.title, startedAt: m.startedAt, durationMs: m.durationMs, app: m.app, status: m.status, source: m.source,
    hasSummary: !!(m.summary && m.summary.text), gist: m.summary && m.summary.text ? m.summary.text.slice(0, 160) : '', words, hasAudio: !!m.audio
  };
}

module.exports = { Store, uid, toMarkdown, clock, defaultTitle, cleanTodo, ID_RE };
