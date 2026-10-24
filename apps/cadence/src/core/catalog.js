// Cadence — the step catalog. One description per step type: what it does, its fields (the editor builds forms
// from these), and what it hands to later steps. Shared by the editor, validation, the AI builder and the MCP plugin.
'use strict';

const GROUPS = [
  { id: 'web', label: 'Web', color: 'sky' },
  { id: 'files', label: 'Files & folders', color: 'amber' },
  { id: 'data', label: 'Data', color: 'teal' },
  { id: 'docs', label: 'Slides & reports', color: 'rose' },
  { id: 'ai', label: 'AI', color: 'violet' },
  { id: 'logic', label: 'Flow & system', color: 'slate' },
];

const IF_EXISTS = [{ value: 'replace', label: 'Replace it' }, { value: 'keepBoth', label: 'Keep both (add a number)' }, { value: 'skip', label: 'Skip' }];
const TESTS = [
  { value: 'equals', label: 'is' }, { value: 'notEquals', label: 'is not' }, { value: 'contains', label: 'contains' }, { value: 'notContains', label: 'doesn’t contain' },
  { value: 'gt', label: 'is more than' }, { value: 'gte', label: 'is at least' }, { value: 'lt', label: 'is less than' }, { value: 'lte', label: 'is at most' },
  { value: 'between', label: 'is between' }, { value: 'empty', label: 'is empty' }, { value: 'notEmpty', label: 'is not empty' }, { value: 'in', label: 'is one of (comma list)' }, { value: 'matches', label: 'matches pattern' },
];
const PROVIDERS = [
  { value: 'auto', label: 'Best available' },
  { value: 'claude', label: 'Claude (your Claude Code sign-in)' },
  { value: 'codex', label: 'Codex (your ChatGPT sign-in)' },
  { value: 'anthropic', label: 'Anthropic API key' },
  { value: 'openai', label: 'OpenAI API key' },
];

const BROWSER_ACTIONS = {
  goto: { label: 'Go to page', fields: ['url'] },
  click: { label: 'Click', fields: ['target'] },
  type: { label: 'Type into', fields: ['target', 'value'] },
  select: { label: 'Choose option', fields: ['target', 'value'] },
  press: { label: 'Press key', fields: ['key'] },
  waitFor: { label: 'Wait for', fields: ['target', 'timeout'] },
  waitText: { label: 'Wait for text', fields: ['value', 'timeout'] },
  wait: { label: 'Pause', fields: ['seconds'] },
  download: { label: 'Click and download', fields: ['target', 'saveAs', 'timeout'] },
  downloadUrl: { label: 'Download link address', fields: ['target', 'saveAs'] },
  extractTable: { label: 'Copy table', fields: ['target', 'name'] },
  extractText: { label: 'Copy text', fields: ['target', 'name', 'all'] },
  screenshot: { label: 'Screenshot', fields: ['target', 'saveAs'] },
  pdf: { label: 'Save page as PDF', fields: ['saveAs'] },
  scroll: { label: 'Scroll to', fields: ['target'] },
  script: { label: 'Run page script', fields: ['code', 'name'] },
  ifExists: { label: 'Skip next unless present', fields: ['target', 'count'] },
};

const SLIDE_LAYOUTS = {
  title: { label: 'Title', fields: ['title', 'subtitle'] },
  section: { label: 'Section header', fields: ['title', 'subtitle'] },
  kpis: { label: 'Big numbers', fields: ['title', 'items'] },
  chart: { label: 'Chart', fields: ['title', 'table', 'chart', 'x', 'y', 'notes'] },
  table: { label: 'Table', fields: ['title', 'table', 'columns', 'maxRows'] },
  bullets: { label: 'Bullet points', fields: ['title', 'bullets'] },
  text: { label: 'Paragraph', fields: ['title', 'text'] },
  image: { label: 'Picture', fields: ['title', 'image'] },
};

const f = (key, label, kind, extra = {}) => ({ key, label, kind, ...extra });

const STEPS = {
  // ───────── web
  'web.browser': {
    group: 'web', label: 'Browser', icon: 'globe', summary: 'Open a site, sign in once, click through it, and download or copy what you need.',
    doc: 'Runs a real browser window in the background with a saved sign-in profile (sign in once from Connections › Browser profiles, or the Sign in button). Actions run in order. Targets are CSS selectors or "text=Export CSV" (an element containing that text) or "label=Email" (the input for that label). Downloads land in the run folder; use Save files to put them somewhere permanent.',
    fields: [
      f('profile', 'Browser profile', 'profile', { default: 'default', help: 'Keeps cookies and sign-ins between runs.' }),
      f('url', 'Start page', 'text', { placeholder: 'https://example.com/reports', required: true }),
      f('actions', 'Steps in the browser', 'actions'),
      f('show', 'Show the window while it runs', 'bool', { default: false, help: 'Handy while setting up. Leave off for scheduled runs.' }),
      f('timeout', 'Give up after (seconds)', 'number', { default: 120 }),
    ],
    outputs: [{ key: 'file', label: 'Downloaded file', kind: 'file' }, { key: 'files', label: 'All downloads', kind: 'files' }, { key: 'table', label: 'First copied table', kind: 'table' }, { key: 'tables', label: 'Copied tables by name', kind: 'object' }, { key: 'text', label: 'Copied text by name', kind: 'object' }, { key: 'url', label: 'Last page address', kind: 'text' }],
  },
  'web.download': {
    group: 'web', label: 'Download a file', icon: 'download', summary: 'Fetch a file from a link (direct export links, APIs that return CSV, shared drive links).',
    fields: [
      f('url', 'Link', 'text', { placeholder: 'https://…/export.csv?from={{lastWeek.start}}', required: true }),
      f('method', 'Method', 'select', { options: ['GET', 'POST'], default: 'GET' }),
      f('headers', 'Headers', 'kv', { help: 'e.g. Authorization → Bearer {{secrets.REPORT_TOKEN}}' }),
      f('body', 'Body', 'textarea', { show: { method: 'POST' } }),
      f('profile', 'Use browser sign-in', 'profile', { allowNone: true, help: 'Send the cookies from a browser profile, for links that need you signed in.' }),
      f('saveAs', 'File name', 'text', { placeholder: 'Leave blank to use the site’s name' }),
    ],
    outputs: [{ key: 'file', label: 'Downloaded file', kind: 'file' }, { key: 'status', label: 'HTTP status', kind: 'number' }],
  },
  'web.request': {
    group: 'web', label: 'Call an API', icon: 'api', summary: 'Send a request and use the JSON or text that comes back.',
    fields: [
      f('url', 'URL', 'text', { required: true }),
      f('method', 'Method', 'select', { options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], default: 'GET' }),
      f('headers', 'Headers', 'kv'),
      f('body', 'Body (JSON or text)', 'textarea', { show: { method: ['POST', 'PUT', 'PATCH', 'DELETE'] } }),
      f('jsonPath', 'Rows are at', 'text', { placeholder: 'data.items (optional)', help: 'Where the list of records is, to make a table.' }),
    ],
    outputs: [{ key: 'json', label: 'JSON response', kind: 'object' }, { key: 'text', label: 'Response text', kind: 'text' }, { key: 'table', label: 'Response as a table', kind: 'table' }, { key: 'status', label: 'HTTP status', kind: 'number' }],
  },
  'web.post': {
    group: 'web', label: 'Post to Slack / Teams', icon: 'send', summary: 'Send a message to a Slack, Teams, Discord or Google Chat webhook.',
    fields: [
      f('url', 'Webhook link', 'text', { placeholder: '{{secrets.SLACK_WEBHOOK}}', required: true, help: 'Keep the link in Secrets and use {{secrets.NAME}}.' }),
      f('text', 'Message', 'textarea', { required: true, placeholder: 'Weekly report for {{week.range}} is ready: {{steps.slides.file | basename}}' }),
    ],
    outputs: [{ key: 'status', label: 'HTTP status', kind: 'number' }],
  },

  // ───────── files
  'folder.make': {
    group: 'files', label: 'Make a folder', icon: 'folderPlus', summary: 'Create a folder, e.g. one named after the week.',
    fields: [f('path', 'Folder', 'folder', { placeholder: '~/Documents/Reports/{{week.label}}', required: true, help: 'Fine if it already exists. ~ is your home folder.' })],
    outputs: [{ key: 'folder', label: 'Folder', kind: 'folder' }],
  },
  'file.save': {
    group: 'files', label: 'Save files', icon: 'save', summary: 'Copy or move files into a folder, optionally renaming them.',
    fields: [
      f('files', 'Files', 'ref', { accepts: ['file', 'files'], required: true, placeholder: '{{steps.pull.files}}' }),
      f('to', 'Into folder', 'folder', { required: true, placeholder: '{{steps.folder.folder}}' }),
      f('rename', 'Rename to', 'text', { placeholder: 'Sales {{week.start}}.{{ext}}', help: '{{name}}, {{stem}}, {{ext}} and {{index}} are the original file’s name parts.' }),
      f('mode', 'Copy or move', 'select', { options: [{ value: 'copy', label: 'Copy' }, { value: 'move', label: 'Move' }], default: 'copy' }),
      f('ifExists', 'If a file has that name', 'select', { options: IF_EXISTS, default: 'replace' }),
    ],
    outputs: [{ key: 'file', label: 'Saved file', kind: 'file' }, { key: 'files', label: 'Saved files', kind: 'files' }],
  },
  'file.find': {
    group: 'files', label: 'Find files', icon: 'search', summary: 'Pick files from a folder by name pattern and age.',
    fields: [
      f('folder', 'In folder', 'folder', { required: true, placeholder: '~/Downloads' }),
      f('pattern', 'Name pattern', 'text', { default: '*', placeholder: '*.csv, report-*.xlsx' }),
      f('subfolders', 'Include subfolders', 'bool', { default: false }),
      f('within', 'Changed in the last (hours)', 'number', { placeholder: 'any time' }),
      f('pick', 'Keep', 'select', { options: [{ value: 'all', label: 'All matches' }, { value: 'newest', label: 'Newest only' }, { value: 'oldest', label: 'Oldest only' }], default: 'all' }),
      f('required', 'Stop if nothing is found', 'bool', { default: true }),
    ],
    outputs: [{ key: 'file', label: 'First file', kind: 'file' }, { key: 'files', label: 'Files', kind: 'files' }, { key: 'count', label: 'How many', kind: 'number' }],
  },
  'file.unzip': {
    group: 'files', label: 'Unzip', icon: 'archive', summary: 'Extract a .zip file.',
    fields: [f('file', 'Zip file', 'ref', { accepts: ['file'], required: true }), f('to', 'Into folder', 'folder', { placeholder: 'Run folder if blank' })],
    outputs: [{ key: 'folder', label: 'Folder', kind: 'folder' }, { key: 'files', label: 'Files', kind: 'files' }, { key: 'file', label: 'First file', kind: 'file' }],
  },
  'file.write': {
    group: 'files', label: 'Write a text file', icon: 'fileText', summary: 'Write text, Markdown, JSON or CSV you compose here.',
    fields: [f('path', 'File', 'file', { required: true, placeholder: '{{steps.folder.folder}}/notes.md' }), f('content', 'Content', 'textarea', { required: true }), f('append', 'Add to the end instead of replacing', 'bool', { default: false })],
    outputs: [{ key: 'file', label: 'File', kind: 'file' }],
  },
  'file.cleanup': {
    group: 'files', label: 'Clean up old files', icon: 'trash', summary: 'Move files older than a number of days to the Trash / Recycle Bin.',
    fields: [f('folder', 'Folder', 'folder', { required: true }), f('pattern', 'Name pattern', 'text', { default: '*' }), f('days', 'Older than (days)', 'number', { default: 30 }), f('folders', 'Include folders (like old week folders)', 'bool', { default: false })],
    outputs: [{ key: 'count', label: 'Files removed', kind: 'number' }],
  },

  // ───────── data
  'data.read': {
    group: 'data', label: 'Read data', icon: 'table', summary: 'Open a CSV, Excel or JSON file as a table (several files are stacked into one).',
    fields: [
      f('file', 'File(s)', 'ref', { accepts: ['file', 'files'], required: true, placeholder: '{{steps.pull.file}}' }),
      f('sheet', 'Sheet (Excel)', 'text', { placeholder: 'First sheet' }),
      f('skip', 'Skip lines at the top', 'number', { default: 0, help: 'For exports with a title block above the headers.' }),
      f('header', 'First row has column names', 'bool', { default: true }),
      f('jsonPath', 'Rows are at (JSON)', 'text', { placeholder: 'data.items' }),
    ],
    outputs: [{ key: 'table', label: 'Table', kind: 'table' }, { key: 'row', label: 'First row', kind: 'row' }, { key: 'count', label: 'Row count', kind: 'number' }, { key: 'columns', label: 'Column names', kind: 'list' }],
  },
  'data.transform': {
    group: 'data', label: 'Shape data', icon: 'filter', summary: 'Filter, sort, group, total, add calculated columns.',
    doc: 'Ops run in order: filter/exclude {column,test,value[,value2]}, select {columns}, drop {columns}, rename {from,to}, sort {column,dir}, limit {count,from:"top"|"bottom"}, group {by:[cols], aggregates:[{column,fn,as}]}, total {aggregates}, compute {as, formula:"[Revenue] / [Orders]"}, percentOfTotal {column,as}, totalRow {label}, dedupe {columns}, fill {column,value}, skipRows {count}. fn: sum avg min max count countDistinct median first last. Formula functions: round, abs, min, max, if, pct, change, num, concat.',
    fields: [f('table', 'Data', 'ref', { accepts: ['table'], required: true }), f('ops', 'Changes', 'ops')],
    outputs: [{ key: 'table', label: 'Table', kind: 'table' }, { key: 'row', label: 'First row', kind: 'row' }, { key: 'count', label: 'Row count', kind: 'number' }],
  },
  'data.compare': {
    group: 'data', label: 'Compare with last run', icon: 'compare', summary: 'Week-over-week (or run-over-run) changes for each number.',
    doc: 'Remembers this table after every successful run and compares the next run against it. Outputs a table with value, previous, change and change % per number column, plus totals.<Column>.{now,previous,change,changePct}.',
    fields: [
      f('table', 'Data', 'ref', { accepts: ['table'], required: true }),
      f('key', 'Match rows by', 'column', { placeholder: 'Totals only (no matching)', help: 'e.g. Channel or Region. Leave blank to compare totals.' }),
      f('columns', 'Numbers to compare', 'columns', { placeholder: 'All number columns' }),
      f('memory', 'Remember as', 'text', { placeholder: 'This step’s name', help: 'Change only if two steps should share history.' }),
    ],
    outputs: [{ key: 'table', label: 'Comparison table', kind: 'table' }, { key: 'totals', label: 'Totals (now, previous, change, changePct)', kind: 'object' }, { key: 'hadPrevious', label: 'Had an earlier run', kind: 'bool' }],
  },
  'data.write': {
    group: 'data', label: 'Save as spreadsheet', icon: 'sheet', summary: 'Write one or more tables to Excel or CSV.',
    fields: [
      f('path', 'File', 'file', { required: true, placeholder: '{{steps.folder.folder}}/Data {{week.start}}.xlsx', help: 'Ends in .xlsx or .csv' }),
      f('sheets', 'Tables', 'sheets', { help: 'Each becomes a sheet in Excel. CSV uses the first.' }),
    ],
    outputs: [{ key: 'file', label: 'File', kind: 'file' }],
  },
  'data.set': {
    group: 'data', label: 'Set values', icon: 'variable', summary: 'Name values to reuse later: totals, labels, file names.',
    doc: 'Each value is templated and stored under steps.<id>.values.<name> and vars.<name>.',
    fields: [f('values', 'Values', 'kv', { keyLabel: 'Name', valueLabel: 'Value' })],
    outputs: [{ key: 'values', label: 'Values', kind: 'object' }],
  },

  // ───────── slides & reports
  'doc.slides': {
    group: 'docs', label: 'Make PowerPoint', icon: 'slides', summary: 'Build a .pptx deck with real, editable charts and tables.',
    doc: 'slides: [{layout, ...}] — title {title, subtitle}; section {title, subtitle}; kpis {title, items:[{label, value, delta, note, good:"up"|"down"}]}; chart {title, table:"{{steps.x.table}}", chart:"bar"|"column"|"line"|"area"|"pie"|"doughnut", x:"Label column", y:["Value col"], notes}; table {title, table, columns, maxRows}; bullets {title, bullets:[...]}; text {title, text}; image {title, image}. Every slide also takes notes (speaker notes). slidesFrom can point at a list of slides an AI step returned as JSON.',
    fields: [
      f('path', 'Save as', 'file', { required: true, placeholder: '{{steps.folder.folder}}/Weekly Report {{week.start}}.pptx' }),
      f('theme', 'Look', 'select', { options: [{ value: 'midnight', label: 'Midnight (dark)' }, { value: 'paper', label: 'Paper (light)' }, { value: 'slate', label: 'Slate (light, bold headers)' }], default: 'paper' }),
      f('accent', 'Accent colour', 'color', { default: '#7C5CFF' }),
      f('logo', 'Logo (optional)', 'file', { placeholder: 'A PNG shown on every slide' }),
      f('footer', 'Footer', 'text', { placeholder: '{{week.range}}' }),
      f('slides', 'Slides', 'slides'),
      f('slidesFrom', 'Add slides from', 'ref', { accepts: ['list', 'object'], placeholder: '{{steps.ai.json.slides}} (optional)', help: 'A list of slides written by an AI step.' }),
    ],
    outputs: [{ key: 'file', label: 'PowerPoint file', kind: 'file' }, { key: 'count', label: 'Slide count', kind: 'number' }],
  },
  'doc.report': {
    group: 'docs', label: 'Make a report', icon: 'report', summary: 'A clean PDF (and/or web page) with numbers, charts, tables and text.',
    doc: 'sections use the same shapes as slides (title, section, kpis, chart, table, bullets, text, image). sectionsFrom can point at a list an AI step returned.',
    fields: [
      f('path', 'Save as', 'file', { required: true, placeholder: '{{steps.folder.folder}}/Weekly Report {{week.start}}.pdf', help: '.pdf, .html or .md' }),
      f('title', 'Title', 'text', { placeholder: 'Weekly report' }),
      f('subtitle', 'Subtitle', 'text', { placeholder: '{{week.range}}' }),
      f('accent', 'Accent colour', 'color', { default: '#7C5CFF' }),
      f('sections', 'Sections', 'slides'),
      f('sectionsFrom', 'Add sections from', 'ref', { accepts: ['list', 'object'], placeholder: '{{steps.ai.json.sections}} (optional)' }),
    ],
    outputs: [{ key: 'file', label: 'Report file', kind: 'file' }],
  },

  // ───────── AI
  'ai.ask': {
    group: 'ai', label: 'Ask AI', icon: 'sparkle', summary: 'Have Claude or Codex read data or files and write a summary, insights or slides.',
    doc: 'Runs your own Claude Code (claude -p) or Codex (codex exec) sign-in, or an API key from Connections. Tables in attach are sent as CSV; files as paths the AI can read (Claude/Codex) or inline text (API). With "Reply as JSON" the answer is parsed so later steps can use {{steps.<id>.json.field}} — e.g. ask for {"headline": "...", "bullets": [...], "slides": [...]}.',
    fields: [
      f('provider', 'Use', 'select', { options: PROVIDERS, default: 'auto' }),
      f('prompt', 'Ask', 'textarea', { required: true, placeholder: 'Here are this week’s sign-ups vs last week. Write 3 short insights for a leadership slide.' }),
      f('attach', 'Give it', 'refs', { accepts: ['table', 'file', 'files', 'text', 'object'], placeholder: '{{steps.compare.table}}' }),
      f('json', 'Reply as JSON', 'bool', { default: false }),
      f('shape', 'JSON shape', 'textarea', { show: { json: true }, placeholder: '{"headline": "string", "bullets": ["string"]}' }),
      f('model', 'Model', 'text', { placeholder: 'Default' }),
      f('timeout', 'Give up after (seconds)', 'number', { default: 300 }),
    ],
    outputs: [{ key: 'text', label: 'Answer', kind: 'text' }, { key: 'json', label: 'Answer as JSON', kind: 'object' }],
  },
  'ai.agent': {
    group: 'ai', label: 'AI agent task', icon: 'agent', summary: 'Let Claude Code or Codex work in a folder: clean files, write scripts, build outputs.',
    doc: 'Starts Claude Code or Codex non-interactively in the folder with your task. It can read and write files only inside that folder. Use for things no other step covers.',
    fields: [
      f('provider', 'Use', 'select', { options: PROVIDERS.filter((p) => ['auto', 'claude', 'codex'].includes(p.value)), default: 'auto' }),
      f('folder', 'Work in folder', 'folder', { required: true, placeholder: '{{run.dir}}' }),
      f('task', 'Task', 'textarea', { required: true }),
      f('allowEdits', 'Allow it to create and change files there', 'bool', { default: true }),
      f('allowCommands', 'Allow it to run commands', 'bool', { default: false }),
      f('timeout', 'Give up after (seconds)', 'number', { default: 900 }),
    ],
    outputs: [{ key: 'text', label: 'What it said', kind: 'text' }, { key: 'files', label: 'Files it made or changed', kind: 'files' }, { key: 'file', label: 'First new file', kind: 'file' }],
  },

  // ───────── flow & system
  'logic.if': {
    group: 'logic', label: 'Only continue if', icon: 'branch', summary: 'Stop here unless a condition is true (e.g. the report has rows).',
    fields: [
      f('left', 'Value', 'text', { required: true, placeholder: '{{steps.read.count}}' }),
      f('test', 'Test', 'select', { options: TESTS, default: 'gt' }),
      f('right', 'Compare to', 'text', { placeholder: '0', show: { test: ['equals', 'notEquals', 'contains', 'notContains', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'matches'] } }),
      f('right2', 'and', 'text', { show: { test: 'between' } }),
      f('otherwise', 'Otherwise', 'select', { options: [{ value: 'stop', label: 'Stop quietly (counts as done)' }, { value: 'fail', label: 'Stop and mark the run failed' }, { value: 'skip', label: 'Skip just the next step' }], default: 'stop' }),
    ],
    outputs: [{ key: 'passed', label: 'Passed', kind: 'bool' }],
  },
  'logic.notify': {
    group: 'logic', label: 'Notify me', icon: 'bell', summary: 'Show a notification; clicking it opens a file or folder.',
    fields: [f('title', 'Title', 'text', { required: true, default: '{{flow.name}} is done' }), f('body', 'Message', 'text'), f('open', 'Open on click', 'text', { placeholder: '{{steps.slides.file}}' })],
    outputs: [],
  },
  'logic.open': {
    group: 'logic', label: 'Open', icon: 'external', summary: 'Open a file, folder or web page.',
    fields: [f('target', 'File, folder or link', 'text', { required: true })], outputs: [],
  },
  'logic.wait': {
    group: 'logic', label: 'Wait', icon: 'clock', summary: 'Pause before the next step.',
    fields: [f('seconds', 'Seconds', 'number', { default: 10 })], outputs: [],
  },
  'logic.script': {
    group: 'logic', label: 'Run a script', icon: 'terminal', summary: 'Run a shell command or a Python / Node script.',
    doc: 'stdout is captured; if it is JSON it is parsed into json. Exit code ≠ 0 fails the step unless "Keep going on errors" is set.',
    fields: [
      f('language', 'Language', 'select', { options: [{ value: 'shell', label: 'Shell command' }, { value: 'python', label: 'Python' }, { value: 'node', label: 'JavaScript (Node)' }], default: 'shell' }),
      f('code', 'Script', 'code', { required: true }),
      f('cwd', 'Run in folder', 'folder', { placeholder: '{{run.dir}}' }),
    ],
    outputs: [{ key: 'text', label: 'Output', kind: 'text' }, { key: 'json', label: 'Output as JSON', kind: 'object' }, { key: 'code', label: 'Exit code', kind: 'number' }],
  },
  'logic.run': {
    group: 'logic', label: 'Run another automation', icon: 'flow', summary: 'Run another automation and wait for it.',
    fields: [f('flow', 'Automation', 'flow', { required: true }), f('inputs', 'Pass in', 'kv', { help: 'Available there as {{inputs.name}}.' })],
    outputs: [{ key: 'outputs', label: 'Its step outputs', kind: 'object' }, { key: 'status', label: 'Status', kind: 'text' }],
  },
};

const TRIGGERS = {
  manual: { label: 'Only when I run it', icon: 'play' },
  schedule: { label: 'On a schedule', icon: 'clock' },
  watch: { label: 'When a file arrives', icon: 'folderIn' },
};

// Shared step options every step has
const COMMON = [
  f('name', 'Step name', 'text'),
  f('continueOnError', 'Keep going if this step fails', 'bool', { default: false }),
  f('retries', 'Retry if it fails', 'number', { default: 0 }),
];

function defaults(type) {
  const s = STEPS[type]; if (!s) return {};
  const o = {};
  for (const fl of s.fields) if (fl.default !== undefined) o[fl.key] = fl.default;
  if (type === 'web.browser') o.actions = [];
  if (type === 'doc.slides' || type === 'doc.report') o[type === 'doc.slides' ? 'slides' : 'sections'] = [{ layout: 'title', title: '', subtitle: '{{week.range}}' }];
  if (type === 'data.transform') o.ops = [];
  return o;
}

// Plain-text reference for AI builders (MCP and the in-app "Describe it").
function referenceText() {
  const lines = [];
  lines.push('AUTOMATION JSON: {"name": str, "description": str, "trigger": TRIGGER, "steps": [STEP...], "output": "~/Documents/Cadence/<name>" (optional default folder)}');
  lines.push('TRIGGER: {"type":"manual"} | {"type":"schedule","every":"minutes"|"hours"|"day"|"week"|"month","interval":N,"time":"HH:MM","days":[0-6, 0=Sun] ,"dayOfMonth":1-31|"last"|"firstWeekday"|"lastWeekday","catchUp":true} | {"type":"watch","folder":path,"pattern":"*.csv","subfolders":false}');
  lines.push('STEP: {"id": short_snake_id, "type": TYPE, "name": label, "with": {fields}, "continueOnError": bool, "retries": N}');
  lines.push('TEMPLATES: any text field can use {{ }}: steps.<id>.<output>, week.{label,start,end,iso,number,range,title}, lastWeek.*, nextWeek.*, today, yesterday, month.{name,label,key}, lastMonth.*, quarter, flow.name, run.dir (scratch folder for this run), run.id, vars.<name>, inputs.<name>, secrets.<NAME>, env.<NAME>. A field that is exactly one {{ }} passes the raw value (table/list). Filters: date:"MMM D", addDays:-7, upper, lower, slug, safe, default:"x", number:2, compact, currency:"$", percent:1, change (0.12 → +12.0%), signed, round:2, plus/minus/times/dividedBy, join:", ", count, sum:"Col", avg:"Col", column:"Col", basename, stem, ext, dirname, replace:"a","b", truncate:80, json.');
  lines.push('Date format tokens: YYYY MM DD MMM MMMM D ddd dddd HH mm A WW (ISO week) Q. Paths may start with ~.');
  lines.push('STEP TYPES:');
  for (const [type, s] of Object.entries(STEPS)) {
    lines.push(`- ${type} — ${s.label}: ${s.summary}`);
    lines.push(`  fields: ${s.fields.map((x) => `${x.key}${x.required ? '*' : ''} (${x.kind}${x.options ? ': ' + x.options.map((o) => (typeof o === 'string' ? o : o.value)).join('|') : ''}${x.default !== undefined ? ', default ' + JSON.stringify(x.default) : ''})`).join('; ')}`);
    if (s.outputs.length) lines.push(`  outputs: ${s.outputs.map((o) => `${o.key} (${o.kind})`).join(', ')}`);
    if (s.doc) lines.push(`  notes: ${s.doc}`);
  }
  lines.push('BROWSER ACTIONS (web.browser with.actions): ' + Object.entries(BROWSER_ACTIONS).map(([k, v]) => `{"do":"${k}", ${v.fields.map((x) => `"${x}"`).join(', ')}}`).join(' | '));
  lines.push('  target = CSS selector, or "text=Export" (smallest visible element containing the text; clickable ancestors preferred), "label=Email" (input labelled Email), "placeholder=Search", "xpath=//…". value/url may use templates and {{secrets.X}}. download waits for the file the click starts. extractTable copies an HTML <table> (or a grid with role=row) to a table named by name. ifExists skips the next `count` actions (default 1) unless target exists.');
  lines.push('SLIDE / SECTION SHAPES: ' + Object.entries(SLIDE_LAYOUTS).map(([k, v]) => `{"layout":"${k}", ${v.fields.map((x) => `"${x}"`).join(', ')}}`).join(' | '));
  return lines.join('\n');
}

module.exports = { GROUPS, STEPS, TRIGGERS, COMMON, BROWSER_ACTIONS, SLIDE_LAYOUTS, TESTS, PROVIDERS, defaults, referenceText };
