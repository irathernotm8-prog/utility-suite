# Fresh Desk 0.3.0

A Mac/Windows folder organizer for Utility Package. Preview every move, understand its reason, correct it, and optionally ask an AI advisor. Filesystem operations remain under the organizer's control.

## Run, test and build

Use Node.js 24+ and npm. Run `npm ci`, `npm start`, and `npm test`. Installers: `npm run dist:mac` (universal Intel/Apple Silicon DMG) and `npm run dist:win` (Windows x64 NSIS). Build macOS on a Mac. Installers are unsigned, as with the rest of Utility Package.

## Rules and profiles

Choose Everyday, Creative work, Business records, or create a named profile. Rules are ordered: the first enabled matching rule wins. Each rule combines all its conditions (AND): extensions, filename contains/exact match, path contains, text contains, required spreadsheet headers, minimum/maximum file bytes, minimum/maximum age in days, exact/minimum image dimensions, or exact aspect ratio such as 1:1.

Actions: group into a folder, or keep in place. Destinations support up to four levels with `/`, and `{year}` expands to the file's last-modified year. This is not a transaction-date extractor. Recent-file protection takes precedence over every rule and blocks both moving and Trash. Enable local content reading for content/header rules.

Each row shows the decision's reason. Change group corrects a destination; optionally remember that correction as a top-priority rule for that exact filename. Saving a rule clears the current preview so you rescan with the saved profile. Profile rules persist in per-user app-data; scan preferences are chosen per scan.

## Local content analysis and duplicates

Content reading is optional and runs in bounded worker threads (15-second timeout, 192 MB JS heap per file). Inputs over 20 MB are skipped. PDF reading extracts text from up to the first 3 pages; XLSX reads the first nonempty row in the first sheet's first 10 rows (up to 80 columns); CSV/TSV and supported text files read up to 64 KB. Stored excerpts are capped at 12,000 characters. No formulas/macros execute. XLS, ODS, DOCX, and image OCR are not content-parsed.

Receipt detection requires receipt/invoice words plus amount and payment/tax terms. Reports with identical ordered, normalized headers share a stable schema folder. These are heuristics: content decisions start unselected and require review. Explicit rules take priority. Extension-only mode suppresses built-in content grouping, but explicit user rules still apply.

Optional duplicate scanning hashes equal-size candidates with streaming SHA-256 and labels matching groups. Copies remain individually reviewable; no copy is automatically discarded. A hash describes contents at scan time, not future changes.

## AI advisor

Select 1–8 visible files not governed by saved rules or recent-file protection. Enter an organization goal. Choose Assist, OpenAI/GPT, or Claude. Review request shows the exact payload before sending: filenames, IDs, extension, size, modification time, dimensions, current group, and your goal. Full filesystem paths, file binaries and duplicate hashes are omitted. Optional excerpts (up to 1,500 characters/file) and headers are included only when explicitly enabled. The fixed advisor instructions accompany this payload.

Assist uses its existing authenticated loopback bridge, discovering the current token from Assist's app-data `bridge.json`. Open Assist, download its model, and enable Settings → Plugins. No Assist source modifications are required. There is no automatic fallback to cloud. A live local test with an invented receipt filename succeeded. Small local models can produce generic reasons or invalid JSON: invalid responses are rejected, and all suggestions still require review.

For GPT or Claude, enter an API key and a model ID your API account can access. The key is passed only for that request, never saved to disk, and the input is cleared after the request. Cloud calls use fixed official HTTPS endpoints; redirects are refused. OpenAI requests use the Responses API with `store:false` (this is not a claim of zero provider retention). Provider API charges/terms apply. Cloud adapters are covered by simulated-response tests; no live cloud call was made without user credentials.

AI can only return folder suggestions for known file IDs. Absolute paths, traversal, reserved OS names, duplicate/unknown IDs, malformed responses, and invalid confidence values are rejected. Model confidence is self-rated, not calibrated. Check desired suggestions and add them to the preview; this performs no filesystem operation. All rows then start unselected so the resulting plan is reviewed again before organizing.

API references: [OpenAI text generation](https://developers.openai.com/api/docs/guides/text), [Claude Messages](https://platform.claude.com/docs/en/api/messages/create). Assist bridge behavior was verified against the user's Assist source ZIP.

## Review and safety behavior

Combine older/recent filtering, group filtering, filename/path search, sort order, and decision filters (needs review, duplicates, kept/protected, conflicts). Counts include bytes and selected files. Actions use selected visible rows only. Changing scan settings invalidates stale UI decisions. Canceling a scan clears its preview; cancellation can wait for the current bounded content read.

Hidden files, symlinks, app bundles, and common system/build folders are skipped. Include subfolders explicitly to review already organized files as well. Image dimensions depend on Electron decoder support. Destination conflicts and multiple files mapping to the same path are flagged. Files are never overwritten. Nested symlink destinations are refused before creating child folders. Source identity, size and modification time are checked again before moves. Cross-volume/unsupported-hardlink moves fail safely rather than copy/delete.

Move history is written before and after operations in per-user app-data. Undo attempts recorded moves in reverse order, refusing changed files and original-path collisions. Partial successes remain recorded if another move fails. Empty created folders can remain. New history entries retain file paths and fingerprints, not extracted text; treat app-data as private. Source porting never includes this data.

Older means last modified, not last accessed or unused. Only selected, unprotected older files can go to Trash, after a separate native confirmation. Restore them through Finder/Recycle Bin. Move undo does not restore Trash. No permanent deletion or AI-driven deletion is offered.

## Verification and Utility Package

25 automated tests cover file moves/undo/conflicts, symlink refusal, rule precedence/protection, content reading, schema matching, duplicate hashes, profiles, filters, provider request/response handling, and renderer request-review/acceptance flows. PDF text extraction also passed with native graphics intentionally unavailable. The packaged universal Mac app passed a non-graphical Electron-runtime test covering worker threads and synthetic PDF/CSV/XLSX/text inputs from its app archive. Runtime dependency audit reported zero vulnerabilities after the scoped UUID compatibility override. Visual desktop review and Windows runtime testing remain outstanding.

Registered as `fresh-desk` in Utility Package. Develop here; bump version and run `./utility port fresh-desk` after changes, followed by `./utility build fresh-desk --mac` or `--win`, or a suite build. The direct Mac installer is universal; suite.json currently defaults this app to Apple Silicon. Saved rules, keys, Assist tokens, scan data and histories are never included in ported source.

## Still future work

Image OCR, semantic near-duplicate detection, transaction-date extraction, folder watching with review queues, and RO3/Datum handoffs are not implemented. The advisor currently proposes destinations for selected files; it does not translate freeform requests into persistent generalized rules automatically.
