'use strict';
// Pure helpers that turn a Tidy plan into what the Tidy screen shows.
// Shared by the renderer and the Node tests.
(function (scope) {
  const sum = rows => rows.reduce((n, r) => n + (r.bytes || 0), 0);
  const movable = r => r.canMove !== false && !r.conflict && !r.keep;

  function groupPlan(rows) {
    const byFolder = new Map(), staying = [], blocked = [];
    for (const r of rows) {
      if (r.keep || r.canMove === false) { staying.push(r); continue; }
      if (r.conflict) { blocked.push(r); continue; }
      if (!byFolder.has(r.folder)) byFolder.set(r.folder, []);
      byFolder.get(r.folder).push(r);
    }
    const moves = [...byFolder].map(([folder, list]) => ({folder, rows: list.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true})), bytes: sum(list)}))
      .sort((a, b) => b.rows.length - a.rows.length || a.folder.localeCompare(b.folder));
    return {moves, staying, blocked};
  }

  const SECTIONS = [
    ['duplicate', 'Duplicate copies', 'Exact copies of another file here. The oldest copy stays.'],
    ['installer', 'Old installers', 'Disk images and setup files more than two weeks old — usually safe once the app is installed.'],
    ['partial', 'Unfinished downloads', 'Downloads that never completed.'],
    ['large', 'Large files', 'Files over 1 GB.'],
    ['old', 'Not changed in a long time', 'Files not modified in over a year.'],
  ];
  function cleanup(plan) {
    const rows = plan?.rows || [];
    const out = SECTIONS.map(([id, title, desc]) => {
      const list = rows.filter(r => (r.flags || []).includes(id) && r.source !== 'protected');
      return {id, title, desc, rows: list, bytes: sum(list)};
    }).filter(s => s.rows.length);
    if (plan?.emptyDirs?.length) out.push({id: 'empty', title: 'Empty folders', desc: 'Folders with nothing inside.', dirs: plan.emptyDirs, rows: [], bytes: 0});
    return out;
  }
  function defaultChecked(rows) { return new Set(rows.filter(r => movable(r) && r.confidence !== 'review').map(r => r.id)); }
  function summary(rows, checked) {
    const picked = rows.filter(r => checked.has(r.id) && movable(r));
    return {files: picked.length, folders: new Set(picked.map(r => r.folder)).size, bytes: sum(picked)};
  }

  // Back-compat for the older list filters (still used by tests and search).
  function visibleRows(rows, {age = 'all', group = '', query = '', sort = 'name', decision = ''} = {}) {
    const needle = query.toLowerCase();
    return rows.filter(r => (!decision || decision === 'review' && r.confidence === 'review' || decision === 'duplicates' && r.duplicate || decision === 'protected' && r.keep || decision === 'conflicts' && r.conflict) && (age !== 'old' || r.old) && (age !== 'recent' || !r.old) && (!group || r.folder === group) && `${r.name} ${r.from}`.toLowerCase().includes(needle))
      .sort((a, b) => sort === 'largest' ? b.bytes - a.bytes : sort === 'oldest' ? a.modified.localeCompare(b.modified) : sort === 'group' ? (a.folder || '').localeCompare(b.folder || '') || a.name.localeCompare(b.name) : a.name.localeCompare(b.name));
  }
  function selectedVisible(rows, checked, filters) { return visibleRows(rows, filters).filter(r => checked.has(r.id)); }

  const api = {groupPlan, cleanup, defaultChecked, summary, movable, visibleRows, selectedVisible, SECTIONS};
  if (typeof module === 'object') module.exports = api; else scope.reviewModel = api;
})(globalThis);
