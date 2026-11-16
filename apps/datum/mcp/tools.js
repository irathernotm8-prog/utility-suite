// Datum — what Claude, Codex/ChatGPT and the in-app models can do. Shared by the MCP server (Claude Desktop / Claude
// Code / Codex) and the in-app assistant (Anthropic, OpenAI, Gemini, OpenRouter, Ollama…), so every AI has the same tools.
'use strict';
const { INSTRUCTIONS } = require('./guide');

const S = (props, required = []) => ({ type: 'object', properties: props, required });
const str = (d) => ({ type: 'string', description: d });
const num = (d) => ({ type: 'number', description: d });
const bool = (d) => ({ type: 'boolean', description: d });
const arr = (d, items = { type: 'string' }) => ({ type: 'array', description: d, items });
const obj = (d, props) => ({ type: 'object', description: d, ...(props ? { properties: props } : {}) });
const sheet = str('Sheet name or id (optional: defaults to the sheet open in Datum)');
const dash = str('Dashboard sheet name or id (optional: defaults to the open dashboard)');
const RO = { readOnlyHint: true };

const widgetProps = {
  kind: str('kpi | chart | table | insights | text | image | filter | daterange | sheetfilter'),
  title: str('Card title (optional; Datum writes a good one when left out)'),
  metric: str('Column to measure (exact name from get_dashboard columns). Leave empty with how:"count" to count records.'),
  how: str('auto (sum, or the right rate for ratio columns) | sum | avg | min | max | count | distinct'),
  by: str('Charts/tables: group by this column, or "@date" for over time'),
  bucket: str('With by "@date": auto | day | week | month | quarter | year'),
  chartType: str('bar | hbar | line | area | stacked | doughnut | pie | combo | scatter'),
  metric2: str('Second measure (combo, scatter, or a second series)'),
  split: str('Chart: one series per value of this column (stacked bars etc.). Table pivot: the columns.'),
  top: num('Show only the top N groups (rest grouped as Other); 0 = all'),
  sort: str('desc (default) | asc | label | order'),
  showValues: bool('Print values on the chart'),
  showAs: str('Chart: "pct" shows shares instead of values'),
  compare: bool('KPI: show the change vs the previous period of the same length'),
  span: str('KPI: "latest" shows the latest week/month vs the one before'),
  leader: str('KPI: name of a group column; shows which group leads and its share'),
  mode: str('Table: summary (grouped by "by") | pivot (by × split) | rows (the records)'),
  metrics: arr('Table summary: the measure columns to show'),
  columns: arr('Table rows mode: the columns to show'),
  col: str('Filter / daterange widget: the column it filters'),
  where: obj('Only rows where col is (or with not:true, is not) one of vals: {col, vals:[...], not}'),
  max: num('Insights: how many sentences (3-8)'),
  text: str('Text widget: the text (supports live values like {{SUM(Sales!B2:B99)}}); one point per line with bullets:true'),
  size: str('Text widget: heading | subheading | body | small'),
  bullets: bool('Text widget: bullet list'),
  image_path: str('Image widget: a picture file on this computer'),
  colors: arr('Chart colours as hex, e.g. ["#1F6BFF","#00C2FF"]'),
  x: num('Column 0-11 on the 12-column grid'), y: num('Row (each row is 44px)'), w: num('Width in columns (1-12)'), h: num('Height in rows'),
};

const TOOLS = [
  { name: 'datum_guide', title: 'Datum guide', description: 'How Datum works: sheets, data, dashboards and their widgets, filters, written insights, PDF export, and how to build a good report. Read once per session before building.', inputSchema: S({}), annotations: RO },
  { name: 'project_context', title: 'What’s open in Datum', description: 'The open project (name, folder, saved or not), every sheet (id, name, type, size), the sheet the user is looking at, its selection, and recent projects.', inputSchema: S({}), annotations: RO },
  { name: 'open_project', title: 'Open a project', description: 'Open a Datum project folder (or any folder of spreadsheets) by path. Asks nothing; unsaved changes in the current project are kept in recovery.', inputSchema: S({ path: str('Folder path') }, ['path']) },
  { name: 'new_project', title: 'New project', description: 'Start a new empty project (nothing on disk until save_project).', inputSchema: S({ name: str('Project name') }) },
  { name: 'save_project', title: 'Save the project', description: 'Save the project as a folder of real files (xlsx, pdf, docx…). A project that was never saved needs parent_dir (or it goes to ~/Documents/Datum).', inputSchema: S({ parent_dir: str('Folder to create the project folder in (first save only)'), name: str('Project name (first save only)') }) },
  { name: 'import_files', title: 'Import files', description: 'Bring spreadsheets (xlsx, xls, csv, tsv), documents (docx, pdf), decks (pptx) or images into the open project as sheets. Each workbook tab becomes a Data Sheet.', inputSchema: S({ paths: arr('File paths') }, ['paths']) },
  { name: 'read_sheet', title: 'Read cells', description: 'Values from a Data Sheet as rows (first row is usually the header). Formulas are returned as their results, or as formulas with formulas:true.', inputSchema: S({ sheet, range: str('A1-style range, e.g. A1:F50 (default: the used range)'), limit: num('Max rows (default 200)'), formulas: bool('Return formulas instead of values') }), annotations: RO },
  { name: 'profile_sheet', title: 'Understand a table', description: 'What Datum sees in a Data Sheet: rows, the date column, groups, measures and rates, the questions it can answer (ids for quick_dashboard), suggested headline numbers (kpi keys), and plain-English facts with the real numbers. Use before building.', inputSchema: S({ sheet, range: str('Range (default: the whole table)') }), annotations: RO },
  { name: 'write_cells', title: 'Write cells', description: 'Write values or formulas (starting with =) into a Data Sheet, from a start cell. Excel functions work (SUM, XLOOKUP, FILTER, SUMIFS…).', inputSchema: S({ sheet, start: str('Top-left cell, e.g. A1'), values: arr('Rows of cells: [["Region","Sales"],["North",120]]', { type: 'array', items: {} }) }, ['start', 'values']) },
  { name: 'create_sheet', title: 'New sheet', description: 'Add a sheet: data (optionally filled with values), dash (an empty dashboard over source sheets), docu (a document, optionally with HTML), slide.', inputSchema: S({ type: str('data | dash | docu | slide'), name: str('Sheet name'), values: arr('Data: rows of cells', { type: 'array', items: {} }), sources: arr('Dash: the Data Sheets it reads'), html: str('Docu: the document body as HTML') }, ['type']) },
  { name: 'quick_dashboard', title: 'Build a dashboard', description: 'The fast way to a complete, good-looking report: builds a dashboard from a table with filters, headline numbers, written insights, charts and a table, all live and filter-aware. Pick questions/kpis from profile_sheet, or leave them out for Datum’s recommendations. layout "slides" builds a slide deck instead. Rebuild an existing one with into.', inputSchema: S({ sheet, range: str('Range (default: the whole table)'), title: str('Title'), layout: str('landscape (default) | portrait (PDF orientation) | slides'), questions: arr('Question ids from profile_sheet'), kpis: arr('Headline number keys from profile_sheet (count, latest:<key>, top:<col>, <metric key>)'), calc_metrics: arr('Rates to add: {name, a, b, op:"/", k:100, fmt:"pct"} with a/b as column names', { type: 'object' }), insights: bool('Include written insights (default true)'), table: bool('Include tables (default true)'), into: str('Rebuild this dashboard instead of making a new one') }) },
  { name: 'get_dashboard', title: 'Read a dashboard', description: 'A dashboard’s widgets (id, kind, position, settings, title), its columns (name, type, role, distinct values), filters, title band and PDF settings.', inputSchema: S({ dashboard: dash }), annotations: RO },
  { name: 'add_widget', title: 'Add a widget', description: 'Add a card to a dashboard: kpi, chart, table, insights (written sentences), text, image, filter, daterange. Unset fields get good defaults; position defaults to the bottom.', inputSchema: S({ dashboard: dash, ...widgetProps }, ['kind']) },
  { name: 'update_widget', title: 'Change a widget', description: 'Change a widget’s settings or position/size. Only the fields given change; null removes a setting.', inputSchema: S({ dashboard: dash, id: str('Widget id from get_dashboard'), ...widgetProps }, ['id']) },
  { name: 'remove_widget', title: 'Remove a widget', description: 'Delete a widget from a dashboard (undoable with Ctrl+Z).', inputSchema: S({ dashboard: dash, id: str('Widget id') }, ['id']), annotations: { destructiveHint: true } },
  { name: 'update_dashboard', title: 'Dashboard settings', description: 'Rename, set the title band, PDF page size/orientation, the source sheets, or tidy the layout.', inputSchema: S({ dashboard: dash, name: str('Sheet name'), title: str('Title shown in the band and the PDF'), show_title: bool('Show the title band'), pdf_size: str('letter | a4 | legal | tabloid | a3 | fit (one long page)'), pdf_orient: str('landscape | portrait'), sources: arr('Data Sheets it reads'), tidy: bool('Close gaps in the layout') }) },
  { name: 'set_filters', title: 'Filter a dashboard', description: 'Set the date range and category filters every widget follows. clear:true removes all.', inputSchema: S({ dashboard: dash, date: obj('{col, preset: all|ytd|thisYear|lastYear|thisQuarter|lastQuarter|thisMonth|lastMonth|last7|last30|last90|last12m|custom, from, to}'), values: obj('{ "<column>": ["value", …] } (an empty list clears that column)'), clear: bool('Clear every filter') }) },
  { name: 'dashboard_data', title: 'The numbers on a dashboard', description: 'The numbers every widget currently shows (KPI values and changes, chart series, table rows, insight sentences), after filters. Quote these, never invent numbers.', inputSchema: S({ dashboard: dash, widget: str('Only this widget id') }), annotations: RO },
  { name: 'write_document', title: 'Write a document', description: 'Create or add to a Docu Sheet (a Word-style document) with HTML: <h1>, <h2>, <p>, <ul>, <table>, <b>. Live values like {{SUM(Sales!B2:B9)}} stay linked to the data.', inputSchema: S({ document: str('Docu Sheet name or id (new if it doesn’t exist)'), html: str('Body HTML'), append: bool('Add to the end instead of replacing') }, ['html']) },
  { name: 'show_sheet', title: 'Show a sheet', description: 'Switch Datum to a sheet so the user sees it.', inputSchema: S({ sheet }, ['sheet']) },
  { name: 'screenshot', title: 'Look at it', description: 'A picture of a sheet as the user sees it in Datum (switches to it first). Use after building to check the result.', inputSchema: S({ sheet }), annotations: RO },
  { name: 'export_pdf', title: 'Export PDF', description: 'Save a dashboard (or document / deck) as a PDF, paginated at its PDF page settings. Returns the file path.', inputSchema: S({ sheet, path: str('Where to save (default: the project folder, or Downloads)') }) },
];

module.exports = { TOOLS, INSTRUCTIONS };
