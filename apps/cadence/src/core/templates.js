// Cadence — starter automations in the gallery. Each is a normal automation; column names and links are
// placeholders to change to match your own export.
'use strict';

const TEMPLATES = [
  {
    id: 'weekly-report', name: 'Weekly report to slides', color: 'violet', icon: 'slides',
    blurb: 'Every Monday: sign in to a site, export last week’s report, file it in a folder named for the week, compare with the week before and build a PowerPoint deck (with an AI-written summary if you have Claude or Codex).',
    flow: {
      name: 'Weekly report', description: 'Pull last week’s report, file it by week, and build the slides.',
      trigger: { type: 'schedule', every: 'week', days: [1], time: '08:00', catchUp: true },
      steps: [
        { id: 'pull', type: 'web.browser', name: 'Export last week’s report', with: { profile: 'work', url: 'https://example.com/reports', show: false, timeout: 180, actions: [
          { do: 'waitFor', target: 'text=Export' },
          { do: 'select', target: 'label=Date range', value: 'Last week' },
          { do: 'download', target: 'text=Export CSV', saveAs: 'Report {{lastWeek.start}}' },
        ] } },
        { id: 'folder', type: 'folder.make', name: 'Folder for this week', with: { path: '~/Documents/Reports/{{week.label}}' } },
        { id: 'save', type: 'file.save', name: 'File the export', with: { files: '{{steps.pull.files}}', to: '{{steps.folder.folder}}', mode: 'copy', ifExists: 'replace' } },
        { id: 'read', type: 'data.read', name: 'Read the export', with: { file: '{{steps.save.file}}', header: true, skip: 0 } },
        { id: 'check', type: 'logic.if', name: 'Make sure it has rows', with: { left: '{{steps.read.count}}', test: 'gt', right: '0', otherwise: 'fail' } },
        { id: 'by_channel', type: 'data.transform', name: 'Totals by channel', with: { table: '{{steps.read.table}}', ops: [
          { op: 'group', by: ['Channel'], aggregates: [{ column: 'Signups', fn: 'sum' }, { column: 'Spend', fn: 'sum' }] },
          { op: 'compute', as: 'Cost per signup', formula: 'round([Spend] / [Signups], 2)' },
          { op: 'sort', column: 'Signups', dir: 'desc' },
        ] } },
        { id: 'compare', type: 'data.compare', name: 'Compare with last week', with: { table: '{{steps.by_channel.table}}', key: 'Channel', columns: ['Signups', 'Spend'] } },
        { id: 'summary', type: 'ai.ask', name: 'Write the takeaways', continueOnError: true, with: { provider: 'auto', prompt: 'This is last week’s sign-ups and spend by channel compared with the week before. Write a one-line headline and 3 short, specific takeaways for a leadership slide. Use the numbers.', attach: ['{{steps.compare.table}}'], json: true, shape: '{"headline": "string", "bullets": ["string", "string", "string"]}', timeout: 300 } },
        { id: 'slides', type: 'doc.slides', name: 'Build the deck', with: { path: '{{steps.folder.folder}}/Weekly Report {{lastWeek.start}}.pptx', theme: 'paper', accent: '#7C5CFF', footer: 'Weekly report · {{lastWeek.range}}', slides: [
          { layout: 'title', title: 'Weekly report', subtitle: '{{lastWeek.range}}' },
          { layout: 'kpis', title: '{{steps.summary.json.headline | default:"Last week at a glance"}}', items: [
            { label: 'Sign-ups', value: '{{steps.compare.totals.Signups.now | number}}', delta: '{{steps.compare.totals.Signups.changePct | change}}', note: 'vs prior week', good: 'up' },
            { label: 'Spend', value: '{{steps.compare.totals.Spend.now | currency}}', delta: '{{steps.compare.totals.Spend.changePct | change}}', note: 'vs prior week', good: 'down' },
            { label: 'Channels', value: '{{steps.by_channel.count}}' },
          ] },
          { layout: 'chart', title: 'Sign-ups by channel', table: '{{steps.by_channel.table}}', chart: 'column', x: 'Channel', y: ['Signups'], notes: '{{steps.summary.json.bullets}}' },
          { layout: 'table', title: 'Week over week', table: '{{steps.compare.table}}', columns: ['Channel', 'Signups', 'Signups (previous)', 'Signups change %', 'Spend'], maxRows: 12 },
        ] } },
        { id: 'done', type: 'logic.notify', name: 'Tell me', with: { title: 'Weekly report is ready', body: '{{steps.slides.file | basename}}', open: '{{steps.slides.file}}' } },
      ],
    },
  },
  {
    id: 'daily-download', name: 'Download a file every morning', color: 'sky', icon: 'download',
    blurb: 'Grab a file from a link each weekday and keep it in a dated folder. Works with export links, APIs that return CSV and shared-drive download links.',
    flow: {
      name: 'Morning download', trigger: { type: 'schedule', every: 'day', days: [1, 2, 3, 4, 5], time: '07:30', catchUp: true },
      steps: [
        { id: 'get', type: 'web.download', name: 'Download', with: { url: 'https://example.com/export.csv?date={{yesterday}}', method: 'GET', saveAs: 'Export {{yesterday}}.csv' } },
        { id: 'folder', type: 'folder.make', with: { path: '~/Documents/Daily exports/{{month.key}}' } },
        { id: 'save', type: 'file.save', with: { files: '{{steps.get.file}}', to: '{{steps.folder.folder}}', mode: 'move', ifExists: 'replace' } },
        { id: 'tidy', type: 'file.cleanup', name: 'Clear out exports older than 90 days', with: { folder: '~/Documents/Daily exports', pattern: '*', days: 90, folders: true } },
      ],
    },
  },
  {
    id: 'file-downloads', name: 'File new downloads by week', color: 'amber', icon: 'folderIn',
    blurb: 'Whenever a CSV or Excel file lands in Downloads, move it into a folder named for the week.',
    flow: {
      name: 'File my reports', trigger: { type: 'watch', folder: '~/Downloads', pattern: '*.csv, *.xlsx', subfolders: false },
      steps: [
        { id: 'folder', type: 'folder.make', with: { path: '~/Documents/Reports/{{week.label}}' } },
        { id: 'move', type: 'file.save', with: { files: '{{inputs.files}}', to: '{{steps.folder.folder}}', mode: 'move', ifExists: 'keepBoth' } },
        { id: 'tell', type: 'logic.notify', with: { title: 'Filed {{inputs.file | basename}}', body: 'In {{week.label}}', open: '{{steps.folder.folder}}' } },
      ],
    },
  },
  {
    id: 'monthly-rollup', name: 'Monthly Excel roll-up', color: 'teal', icon: 'sheet',
    blurb: 'On the 1st, combine last month’s exports into one workbook with totals, plus a one-page PDF summary.',
    flow: {
      name: 'Monthly roll-up', trigger: { type: 'schedule', every: 'month', dayOfMonth: 1, time: '09:00', catchUp: true },
      steps: [
        { id: 'find', type: 'file.find', name: 'Last month’s exports', with: { folder: '~/Documents/Daily exports/{{lastMonth.key}}', pattern: '*.csv', pick: 'all', required: true } },
        { id: 'read', type: 'data.read', name: 'Stack them', with: { file: '{{steps.find.files}}' } },
        { id: 'totals', type: 'data.transform', name: 'Totals by day', with: { table: '{{steps.read.table}}', ops: [{ op: 'group', by: ['Date'], aggregates: [] }, { op: 'sort', column: 'Date', dir: 'asc' }] } },
        { id: 'book', type: 'data.write', name: 'Workbook', with: { path: '~/Documents/Roll-ups/{{lastMonth.label}}.xlsx', sheets: [{ name: 'Totals by day', table: '{{steps.totals.table}}' }, { name: 'All rows', table: '{{steps.read.table}}' }] } },
        { id: 'pdf', type: 'doc.report', name: 'One-page summary', with: { path: '~/Documents/Roll-ups/{{lastMonth.label}}.pdf', title: '{{lastMonth.label}} roll-up', subtitle: '{{steps.find.count}} files · {{steps.read.count | number}} rows', accent: '#20C2B0', sections: [
          { layout: 'chart', title: 'By day', table: '{{steps.totals.table}}', chart: 'line' },
          { layout: 'table', title: 'Daily totals', table: '{{steps.totals.table}}', maxRows: 31 },
        ] } },
      ],
    },
  },
  {
    id: 'ai-digest', name: 'Weekly AI digest of a folder', color: 'rose', icon: 'sparkle',
    blurb: 'Every Friday, have Claude or Codex read what changed in a folder this week and write a short PDF digest.',
    flow: {
      name: 'Friday digest', trigger: { type: 'schedule', every: 'week', days: [5], time: '16:00', catchUp: true },
      steps: [
        { id: 'find', type: 'file.find', name: 'This week’s files', with: { folder: '~/Documents/Notes', pattern: '*.md, *.txt, *.docx, *.pdf', subfolders: true, within: 168, pick: 'all', required: true } },
        { id: 'ai', type: 'ai.ask', name: 'Summarize', with: { provider: 'auto', prompt: 'Read these files from this week and write a digest: a headline, the 5 most important points, and open questions. Keep it tight.', attach: ['{{steps.find.files}}'], json: true, shape: '{"headline":"string","points":["string"],"questions":["string"]}' } },
        { id: 'pdf', type: 'doc.report', name: 'Digest PDF', with: { path: '~/Documents/Digests/Digest {{today}}.pdf', title: '{{steps.ai.json.headline}}', subtitle: 'Week of {{week.start}} · {{steps.find.count}} files', accent: '#E64980', sections: [
          { layout: 'bullets', title: 'What mattered', bullets: '{{steps.ai.json.points}}' },
          { layout: 'bullets', title: 'Open questions', bullets: '{{steps.ai.json.questions}}' },
        ] } },
        { id: 'tell', type: 'logic.notify', with: { title: 'Your digest is ready', open: '{{steps.pdf.file}}' } },
      ],
    },
  },
  {
    id: 'blank', name: 'Start from scratch', color: 'slate', icon: 'plus', blurb: 'An empty automation you run yourself. Add steps and a schedule when you’re ready.',
    flow: { name: 'New automation', trigger: { type: 'manual' }, steps: [] },
  },
];

module.exports = { TEMPLATES };
