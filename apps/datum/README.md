# Datum

A desktop workstation where spreadsheets, slides, documents, reports and dashboards live in one **project**, all linked. Change a number once on a Data Sheet and every chart, table, KPI and sentence that uses it updates.

## Run it

1. Install **Node.js 20 or newer** (nodejs.org).
2. Unzip this folder, open a terminal in it, then:

```
npm install
npm start
```

### Build something you can send to other people

```
npm run dist:mac     # on a Mac
npm run dist:win     # on a Windows PC
```

Everything lands in `dist/`:

| File | What it is |
|---|---|
| `Datum-1.5.1-mac-universal.dmg` | Mac installer (drag to Applications). Works on Apple Silicon and Intel Macs |
| `Datum-1.5.1-mac-universal.zip` | Mac app, zipped. Unzip and double-click Datum |
| `Datum-1.5.1-win-x64.exe` | Windows installer |
| `Datum-1.5.1-win-x64.zip` | Windows app, zipped. Unzip and run `Datum.exe`, no install needed |

The people you send these to don't need Node.js or anything else installed.

The app isn't code-signed, so the first launch shows a warning. On a Mac, right-click Datum, choose **Open**, then **Open** again. On Windows, click **More info**, then **Run anyway**.

## The four sheets

| Sheet | Works like | Saves as |
|---|---|---|
| **Data Sheet** | Excel - formulas, formats, sort, freeze header | `.xlsx` |
| **Slide Sheet** | PowerPoint - layouts, shapes, images, speaker notes, presenter mode | `.pptx` (native, editable charts and tables) |
| **Docu Sheet** | Word - headings, lists, tables, images, page breaks. Opens PDFs too | `.docx` or `.pdf` |
| **Report Sheet** | Report pages of charts, KPI cards, tables, images and insights | `.pdf` |
| **Dashboard Sheet** | A live grid of widgets (KPIs, charts, tables) with date range, sheet and value filters | `.pdf` (a snapshot with the current filters) |

## Projects are folders

- **Save** (Ctrl+S) creates a folder named after the project, with one native file per sheet plus a small `project.datum` file that remembers your links and layout.
- **Open project folder** (Ctrl+O) opens every supported file in a folder as its own sheet. Drop a folder onto the window to do the same.
- Files you didn't change are left **byte-for-byte untouched** when you save.
- If someone edits the `.xlsx` in Excel, Datum picks up their changes the next time you open the folder. New files dropped into the folder are added as sheets.

## Linking - the core idea

- **Send to** (Data Sheet toolbar): select a range → send it to any slide, report or doc as a chart, table, KPI card or live value.
- **Insert from data** (Chart / Table / KPI buttons on other sheets): pick a range on a mini-grid with a live preview.
- **Live values in text**: type `{{'Weekly Data'!B9}}` or `{{SUM(Sales!B2:B13)}}` inside any text box. The ⚡ button builds these for you.
- **Paste cells into a Docu Sheet**: copy a range in a Data Sheet, paste into a document, and choose linked table, linked chart or live total.
- Linked cells show a small cyan corner on the Data Sheet; the status bar tells you how many places use the sheet. Renaming a sheet or inserting rows updates every reference.

## Shortcuts that save time

- **Quick report** turns a table into a finished report.
  - **It reads the table first.** Datum works out which column names each row (campaign, product, store), which is a timeline, and which are amounts, rates or categories. Rates such as cost per result or CPC are recognised as one column divided by another and totalled properly (total spend ÷ total results), not averaged. Columns that never change, such as a status of "active" on every row, are set aside, and fixed reporting dates go into the subtitle. Click any column chip to correct a guess.
  - **Suggested for you** lists plain-language questions to tick, such as "Where is the spend going?", "Which campaigns are most efficient?" and "Does more spend bring more results?". The recommended ones are pre-ticked.
  - **Build your own** is for experienced users: pick up to 8 headline numbers in your order; add charts (over time, ranking, share, bar + line, scatter, table) and choose the metric, grouping, sort and chart type for each; and create calculated metrics (CTR, CPM, cost per click, ROAS and conversion rate are suggested when the columns exist).
  - **Layouts:** Landscape, Portrait (vertical, scrolls down) or a Slides deck. Insights flow onto the next page instead of leaving gaps.
  - **What you get:** headline cards, live-sorted rankings, scatter plots with point labels, bar + line combos, and written insights (leaders, concentration, best and worst, how many beat the overall rate, correlations), all as live formulas on a "· Calc" sheet.
  - **Edit report** on the report reopens the builder with your choices, and **Apply brand** restyles the header, cards, charts and tables with the project's brand kit.
- **Data sets** - New sheet → *Data set (combine files)*, or *Combine files* on the start screen. Pick a set of spreadsheets or a whole folder (monthly exports, one file per region…) and Datum stacks them into one Data Sheet without opening each file. It finds the header row in each file, lines columns up by name (any order) or by position, skips total rows and repeated headers, and can add **Source** and **Period** columns (the period comes from dates in file names such as `Sales 2024-03.xlsx`, `Q1 2024` or `March 2024`). Formulas in the files are calculated, and the preview flags files with missing or extra columns. **It stays current on its own:** drop a new export into the folder (or save over one) and within about 20 seconds the data set re-reads itself. Dashboards update live, and reports built from it are rebuilt automatically (both can be switched off in the data set's *files* panel). **Refresh** does the same on demand. Formulas and charts that cover the whole data grow with it, and columns you added keep their formulas. **One workbook with a tab per week or month:** pick the workbook and Datum stacks every tab with a date in its name (`10-04-26`, `9-7-25`, `Mar 2024`…), leaving summary, blank and helper tabs out. It adds **Worksheet** and **Period** columns (the period comes from the tab name), and when you add a new week's tab and save the workbook, the data set picks it up within about 20 seconds. If the file can't be read for a moment (Excel or OneDrive still saving it), the data set keeps its last rows and tries again on the next save. **Duplicates:** when the files share an ID column (Order ID, Email, Object Number…), the preview says how many records repeat and can remove repeats, keeping the copy from the newest file or the first one found.
- **Doc → Deck** - headings become slides, bullets become bullet points, linked charts come along still linked.
- **PDF pages → slides** - hover a PDF page and send it to a deck or report as an image.
- **Brand kit** - colors, chart palette, fonts and logo used across the project. *Apply brand* restyles a whole deck and stamps the logo.
- **Command palette** (Ctrl+K) - jump to any sheet, slide or heading, or run any command.
- **Export → Combine sheets into one PDF** - a single board-pack PDF with slides, reports and docs at their correct page sizes.
- Crash recovery autosaves unsaved work every 30 seconds.

Full shortcut list: Ctrl+K → "Keyboard shortcuts".

## Data Sheet tools

- **Formatting:** bold, italic, underline, strikethrough, alignment, wrap text, and fill and text colors.
- **Borders:** a visual picker with 14 placements (all, outside, inside, top, bottom, thick outside, double bottom…), six line styles (thin, medium, thick, dashed, dotted, double) and any color. Borders save to Excel and come back when you reopen the file.
- **Numbers:** General, Number, Whole number, Currency, Accounting, Percent, Scientific, Date, Plain text - plus **more/fewer decimals** and **thousands separator on/off**.
- **Rows & columns:** drag row or column edges to resize, double-click an edge to auto-fit, or set exact sizes from the Rows & columns menu. Freeze the top rows.
- **Merged cells:** Merge & center, Merge, Merge across (each row), Unmerge.
- **Sort & filter:** quick sort or a multi-level Custom sort. **Filter** adds ▾ buttons to the header row - filter by values or by condition (greater than, between, contains, top N, blanks…). Filtered-out rows also drop out of linked charts and tables.
- **Conditional formatting:** highlight rules (greater/less than, between, equal, text contains, duplicates, negatives, blanks), top/bottom N, above/below average, data bars, color scales and custom formulas. Manage rules to edit or reorder them.
- **Fill handle:** drag the small square at the bottom-right of a selection down, up or across. Formulas shift their references (`=A2*2` becomes `=A3*2`), numbers and dates continue their step (1, 2 → 3, 4; one date counts up by day), "Week 1" becomes "Week 2", and months, weekdays and quarters continue. Hold Alt to copy instead. Double-click the handle to fill down as far as the column next to it goes. Ctrl+D still fills down a selection.
- **Duplicates** (toolbar, or Sort → Find duplicates): Datum picks the column that most likely identifies each record (an ID, order number, email) - tick other columns to match on several. It lists every value that repeats with its row numbers, and can shade the copies, add a live *Duplicate?* column (Unique / First / Repeat, as Excel formulas you can filter), or remove the repeats keeping the first copy (undoable).
- All of the above saves into the .xlsx and opens in Excel.

## Selecting

- Drag to select. Drag past the edge of the grid and it scrolls (and grows) so you can keep going.
- **Ctrl-click** (⌘-click on a Mac) or Ctrl-drag adds more cells or ranges to the selection, including whole rows and columns. Formatting, clearing, copying, charts and *Send to* all work on the combined selection. For example, select `A1:A9` and then Ctrl-drag `C1:C9` to chart column C against the labels in column A.

## Dashboard Sheets

A Dashboard Sheet is a live grid of widgets over one or more Data Sheets or a data set, similar to a Salesforce dashboard.

- **Widgets:** KPI (with change vs the previous period), chart (columns, bars, line, area, stacked, bar + line, doughnut, pie, scatter), table (totals per group, a rows × columns grid, or individual rows), date range, sheet filter, value filter and text.
- **Counts as well as sums.** Every KPI, chart and table can show the *number of records*, the number of *different* values of a column (cities, customers…), or a number column. Lists with nothing to add up (sign-ups, tickets, leads) work as well as spend and revenue.
- **Comparing:** *Split into series by* breaks a chart into one series per value of another column (sign-ups per market, split by source), side by side or stacked. *Values as share* turns it into percentages (100% stacked when split). The grid table shows counts or totals for every pair, for example source × status, shaded by size. *Only count rows where* limits one widget to some rows (only Active, only D2D) while the rest of the dashboard stays as it is.
- **Colours per chart:** pick a preset palette (Vivid, Ocean, Sunset, Forest, Grays, Pastel), set each series or slice yourself, or give every bar its own colour. *Brand* goes back to the project palette.
- **Layout:** drag a widget's header to move it and its corner to resize it. Everything snaps to a 12-column grid and other widgets move out of the way.
- **Filters apply to every widget.** The date range widget offers presets (last 30/90 days, this or last month and quarter, year to date, last 12 months, custom). For historical data, ranges count back from the latest date in the data. The sheet filter switches between the files in a data set (its Source column), the tabs of a dated-tab data set (its Worksheet column, newest first) or between several Data Sheets used together. Clicking a bar, slice or table row filters the whole dashboard by it.
- **Build from data** lays out a starter dashboard: filter controls, headline numbers, trend and breakdown charts, and a summary table. Lists with nothing to add up (sign-ups, tickets, orders) get counts instead: records over time and records by each field. New dashboards are offered when you create a data set, and from the *Dashboard* button on any Data Sheet.
- **Workbooks with one tab per week or month:** right-click any of those tabs and choose *Build dashboard from all N tabs like this*. The Sheet filter then picks weeks. In *Choose data*, tabs from one workbook are grouped with an *All / none* switch. Hidden Excel tabs (lookup lists) are left out.
- When a sheet has summary blocks or helper formulas beside its records, the dashboard and Quick report read only the records table (labelled columns, down to the last row with typed data).
- **Repeated records:** when the data has an ID column that repeats (the same customer in two weeks' exports, say), the toolbar shows how many, and *Count each … once* leaves the repeats out of every widget.
- Rates such as cost per result are worked out from the filtered totals, so they stay correct at any date range.
- **PDF** exports the dashboard as it looks with the current filters, which are listed in the header.

## Ask Datum

Click **Ask Datum** in the top bar (Ctrl+J) and ask in plain words: "build me a portrait report", "make an interactive dashboard", "chart cost per result by campaign", "spend vs results scatter", "which campaigns are most efficient?", "what stands out?". It answers from Datum's own calculations and offers actions (build a report or a dashboard, add a chart, a headline number or live insights to the open report or deck) that you confirm with **Do it**. Everything can be undone.

- Works straight away with Datum's built-in planner.
- Optionally download an offline language model in Ask Datum's settings (⋯): Swift (about 0.9 GB), Balanced (about 1.6 GB, recommended) or Sharp (about 2.3 GB). It downloads once, then runs on your Mac's graphics chip with nothing leaving the computer. It handles looser requests and can write executive summaries.
- Every number placed is a live formula. Any figure in a written reply that can't be matched to your data is flagged.

## Formulas

About 430 Excel functions, browsable by category with the **fx** button. They include:

- **Logic:** `IF IFS AND OR XOR NOT SWITCH CHOOSE IFERROR IFNA LET`
- **Conditional math:** `COUNTIF(S) SUMIF(S) AVERAGEIF(S) MAXIFS MINIFS`, with wildcards, dates and blanks
- **Math:** `INT ROUND ROUNDUP ROUNDDOWN MROUND CEILING FLOOR MOD SUMPRODUCT SUBTOTAL AGGREGATE`
- **Lookup:** `XLOOKUP VLOOKUP HLOOKUP LOOKUP INDEX MATCH XMATCH OFFSET INDIRECT`
- **Dynamic arrays:** `FILTER SORT SORTBY UNIQUE SEQUENCE TAKE DROP VSTACK HSTACK TEXTSPLIT`, which spill into neighbouring cells
- **Text:** `TEXT TEXTJOIN TEXTBEFORE TEXTAFTER SUBSTITUTE REGEXEXTRACT`
- **Dates:** `DATEDIF NETWORKDAYS WORKDAY EOMONTH EDATE YEARFRAC ISOWEEKNUM`
- **Statistics:** `MEDIAN MODE STDEV PERCENTILE QUARTILE RANK CORREL FORECAST TREND`
- **Finance:** `PMT IPMT PPMT FV PV NPER RATE NPV IRR XNPV XIRR MIRR DB VDB FVSCHEDULE`, plus depreciation and T-bill functions
- **LAMBDA and friends:** `LAMBDA MAP REDUCE SCAN BYROW BYCOL MAKEARRAY GROUPBY`, including LAMBDAs named with `LET`
- **Database:** `DSUM DAVERAGE DCOUNT DCOUNTA DMAX DMIN DGET DPRODUCT DSTDEV DVAR`
- **Statistics and engineering:** `T.TEST T.DIST T.INV CHISQ.TEST F.DIST Z.TEST LINEST LOGEST GAMMA ERF MDETERM MINVERSE CONVERT DEC2HEX BITAND`

Datum also adds `GROWTH(new, old)`, `CAGR`, `LAST(range)` and `FIRST(range)`.

Other things that work:

- References to other sheets (`'Sheet Name'!A1:B9`), whole columns and rows (`A:A`, `3:5`), named ranges and array constants `{1,2;3}`.
- While typing a formula, click or drag on cells to insert references.

**Opening other people's files.** Datum calculates Excel formulas itself. If a file uses something Datum can't compute, such as a link to another workbook, the value Excel last saved is shown instead, so a cell never comes up broken. Hover the small mark in the corner of such a cell to see the reason. Sheet names (including `INDIRECT` text that names a tab), named ranges, hidden tabs and spilled array results are carried over. When you save, any formula Excel can't read the same way is written as its value, so the .xlsx always opens cleanly.

## Reports and images

- Report Sheets can be Letter, Legal, Tabloid, A3, A4, A5, 16:9, 4:3, Square or a custom size, in portrait or landscape. Content can scale automatically when you change size, and the PDF exports at that page size.
- Images on slides and reports can have a border (any color and thickness), rounded corners, a circle crop and a drop shadow - with one-click presets. Borders and shadows carry into PowerPoint.

## Known limits

- Data sets read .xlsx, .xlsm, .csv and .tsv files. Up to 150,000 rows per worksheet are read.
- **Saving is crash-safe:** files are written to a hidden temporary file first and swapped in, so a crash or full disk never leaves a half-written file. If one sheet can't be written (for example its file is open in Excel), the rest is still saved and that sheet stays marked unsaved. The previous `project.datum` is kept as a hidden backup and used automatically if the main one is ever damaged. A widget whose column has disappeared says so, and unexpected errors show a short message instead of failing silently.
- Imports keep content, layout and most styling, including Excel merged cells, borders and conditional formatting. Animations, SmartArt, Excel charts and pivot tables, and complex Word page layouts are not reproduced - but untouched files are never overwritten.
- Old `.xls` files aren't supported; save them as `.xlsx` first.
- In the saved `.xlsx`, formulas that point at *other* Datum sheets are written as their values (Excel can't reference a separate file the same way). Same-sheet formulas stay live.
- Editing a PDF works by extracting its text into an editable page; the original PDF is kept unless you edit it.
- Fonts: Inter is used on screen and exported to PowerPoint as Calibri so decks render the same on any machine.
