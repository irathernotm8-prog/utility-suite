// Datum — the guide every AI reads: how a project is put together, dashboards and their widgets, and how to work.
'use strict';

const INSTRUCTIONS = `Datum is the user's data workstation: spreadsheets (Data Sheets), live dashboards that export to PDF (the reports), documents and slide decks, in one project. You control it through these tools and the user watches Datum update as you work.
Start with project_context, and read datum_guide once before building. For a new report, profile_sheet then quick_dashboard, then screenshot and dashboard_data to check it, then refine with add_widget / update_widget. Only quote numbers that Datum's tools returned.`;

function guideText() {
  return `# Datum guide

${INSTRUCTIONS}

## Projects and sheets
- A **project** is a folder of real files. Each sheet saves as its own file: Data Sheets as .xlsx, dashboards as .pdf, documents as .docx, decks as .pptx. Nothing is written until save_project.
- **Data Sheet** (type data): a spreadsheet with Excel formulas. Imported workbooks give one Data Sheet per tab, named "Workbook · Tab". A **data set** is a Data Sheet that combines a folder of files and refreshes itself.
- **Dashboard Sheet** (type dash): Datum's reports. Live cards on a 12-column grid, all following the dashboard's filters; exports to PDF at a real page size with no card split across pages. (Older "Report Sheets" still open; they can be converted.)
- **Docu Sheet** (docu): a document. **Slide Sheet** (slide): a deck.
- Refer to sheets by name or id. Most tools default to the sheet the user has open.

## Building a report (the usual job)
1. project_context → find the Data Sheet. profile_sheet → what it holds: the date column, groups, measures, rates, and **questions** (ids) and **kpis** (keys) Datum recommends, plus facts with the real numbers.
2. quick_dashboard {sheet, title, questions?, kpis?} builds the whole thing: a title band (date range, filters, row count), date and category filters, headline numbers, a "What stands out" card of written insights, charts and a table. Leave questions/kpis out to take Datum's recommendations. Add rates with calc_metrics, e.g. {name:"Conversion rate", a:"Sales", b:"Leads", op:"/", k:100, fmt:"pct"}.
3. screenshot it, and dashboard_data to read the numbers. Then refine: add_widget, update_widget (charts types, groupings, top N, colours, titles, sizes), remove_widget, update_dashboard (title, PDF page size and orientation).
4. If the user wants a written summary, write_document with numbers from dashboard_data / profile_sheet only. export_pdf when they want the file.

## Dashboard widgets (kind and settings)
Columns are referred to by their exact names (get_dashboard lists them with role: date, dimension = a group, measure = a number to add up, ratio = a rate).
- **kpi**: one big number. metric + how (auto/sum/avg/min/max/count/distinct; no metric + how:"count" counts records). compare:true shows the change vs the previous period of the same length (needs a date filter). span:"latest" shows the latest week/month vs the one before. leader:"<group column>" shows which group is out in front and its share. where:{col, vals} limits it.
- **chart**: chartType bar | hbar | line | area | stacked | doughnut | pie | combo | scatter. metric (+ metric2), by a column or "@date" (+ bucket day/week/month/quarter/year), split for one series per value, top N, sort, showValues, showAs:"pct", colors.
- **table**: mode summary (by + metrics), pivot (by × split, one measure), rows (columns, sortBy, top).
- **insights**: sentences Datum writes from the numbers (no AI involved, always right): the total and its change, the latest period, the best period and the trend, the leader and its share, concentration, biggest rises and drops. metric, by (optional), max.
- **text**: text, size heading/subheading/body/small, bullets, align. Live values: {{SUM('Sales Data'!C2:C500)}}.
- **image**: a logo or picture (image_path).
- **filter** (col: a group column), **daterange** (col: a date column), **sheetfilter** (dashboards over several tabs): controls the user clicks. They're left out of the PDF; the active filters are listed in the title band.
- Layout: 12 columns, rows of 44px. Typical sizes: kpi 3×3, chart 6×7, table 12×8, insights 12×4, filter 4×4. Widgets never overlap; Datum pushes others down.

## Good reports
- Lead with what changed and what leads: 3-4 headline numbers, then written insights, then 2-6 charts, then one table. Not more.
- Titles say what the chart shows ("Sign-ups by source"). Group small categories with top N. Over time → bar or line by @date; parts of a whole → doughnut with ≤6 slices; ranking → hbar sorted desc.
- Rates (cost per lead, conversion) are worked out from totals, so they stay right under any filter: add them with calc_metrics rather than averaging a rate column.
- Never invent or estimate numbers. Everything you state should come from dashboard_data, profile_sheet facts or read_sheet.
- People's names, addresses, emails and phone numbers in the data are personal: don't put them on dashboards or into documents unless the user asks.
`;
}

module.exports = { INSTRUCTIONS, guideText };
