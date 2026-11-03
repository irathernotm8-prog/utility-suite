# Atrium: handoff for the Atrium chat

Atrium is the Utility Package's website builder. It has premium sections and themes, and a live preview you click to edit. Claude, GPT, Gemini or a local model gets full control of the site through 36 tools, including screenshots so it can see its work. It runs quality checks and exports to any host, WordPress, Weebly and other site builders. It lives in `apps/atrium` inside `~/Downloads/Utility Package`. `README.md` has the feature list, the formats, the data folders and the code map.

## Working on it

```bash
cd ~/Downloads/Utility\ Package/apps/atrium
npm install
npm start
npm test                                     # 13 Node checks, no network
xvfb-run node test/e2e/shots.js /tmp/shots   # (Linux) every screen, in-preview editing, the real MCP → bridge → app path, all exports
python3 build/make-icon.py                   # regenerates build/icon.png (Pillow)
```

To ship a change, bump `version` in `package.json`, then from the Utility Package folder:

```bash
./utility note atrium "what changed"
./utility publish
```

Pull before starting work. Stay inside `apps/atrium`. `tools/`, `suite.json` and `apps/hub` belong to the Utility Package chat.

## State at first release (0.1.0)

- **Verified here (Linux)**:
  - `npm test` passes: content library, CSS scoping, markdown, zip, site edits/undo/versions, rendering, and every export format for all 8 templates. That includes:
    - Every internal link and asset in the static export resolves.
    - WordPress links are all tokenised.
    - Embed CSS never touches the host page.
  - Both in-app agent loops pass against stand-in Anthropic and OpenAI servers.
  - The e2e run screenshots every screen (builder, every panel, phone/tablet, AI tab, code editor, export, audit, versions, publish, phone QR, all sites, new site with live template previews, settings) with no console errors.
  - The e2e run also edits a headline in place and drives the real `mcp/atrium-mcp.js` over stdio: 36 tools, site_context, add_section returning a picture, a phone screenshot, an audit, and all six exports.
  - The WordPress `functions.php` passes `php -l`. Its `{{atrium:…}}` resolver was run on an exported header and home page with stand-in WordPress functions; every page link, the blog link and every asset resolved.
- **Not yet run on a real Mac/PC or a real WordPress.** Check these first:
  1. **The preview iframe** loads `http://127.0.0.1:<port>`. The window's CSP allows `frame-src http://127.0.0.1:*`, so check that the editing layer (`/__atrium/overlay.js`) loads and that click, double-click and edit work in the packaged app.
  2. **Screenshots** come from a hidden `BrowserWindow` that is resized to the page height and captured in slices (`src/capture.js`). If a Mac returns blank captures, try `offscreen: true` in `makeWin`.
  3. **The WordPress theme on a real site**. Expected behaviour:
     - Upload › Activate creates the pages and posts and sets the front page.
     - Header and footer are template parts holding a Custom HTML block.
     - Post covers are sideloaded into the media library.
     - The contact form uses `admin-post.php` → `wp_mail`.
     - Check the Site Editor opens the template parts without "invalid block" warnings.
  4. **The Weebly theme files** follow Weebly's documented tags (`{menu}`, `{content}`, `{logo}`, `{title}`) but weren't imported into Weebly here. The embed pack is the safer route.
  5. **Netlify** (`POST /sites`, then a zip deploy to `/sites/:id/deploys`) and **GitHub Pages** (`gh repo create`, push `gh-pages` with `gh auth git-credential`, `POST repos/:o/:r/pages`) weren't run against the real services.
  6. **Model IDs** default to `claude-sonnet-5-5`, `gpt-5`, `gemini-2.5-pro`, and so on. Each provider has "Load models" in Settings › AI if a default is retired.
  7. **Photo search** uses the Openverse API without a key, which is rate-limited. If it starts failing, add a registered client later.

## How it fits together

- **A section is `{ html, css, js }`.** The html has one root element, and the renderer adds `data-s="<id>"` to it. CSS is scoped by `src/core/scope.js`, where `&` is the root. JS runs as `(function(root){…})`. `CONTRACT.md` is the full content contract: tokens, base classes, placeholders (`data-at-nav`, `data-at-logo`, `data-at-posts`, `data-at-form`, `data-count`, `<i data-icon>`), and placeholder art at `assets/ph/WxH-N.svg`.
- **One renderer for everything.** `src/core/render.js` feeds the preview, the AI's screenshots and every exporter. Exporters only change the link and asset mapping (`ctx.link`, `ctx.asset`, `ctx.postLink`) and the target (`wordpress` turns post lists and forms into tokens).
- **Every mutation goes through `Site.mutate()`**, which handles the undo point, saving, a version snapshot for AI changes, and the change event. `main.js` turns change events into preview updates: `section` events swap one section in place, `css` events refresh the stylesheet, and anything else reloads while keeping the scroll position.
- **The editing layer** (`src/renderer/overlay.js`) is served only in Edit mode, through the `atrium_edit` cookie. It talks to the window with `postMessage`. When it saves a section it strips everything the renderer adds: icon SVGs, filled nav/posts/logo, reveal classes and the preview-form marker. If you add a new placeholder, clean it there too.
- **AI tools are written once** (`src/mcp-handlers.js`) and listed once (`mcp/tools.js`). The MCP server, the in-app Claude Code / Codex route and the API-key models all use them. Keep the rule: anything that changes how a page looks should return a screenshot, or offer `look:true`.
- **Keys** (API and Netlify) are encrypted with `safeStorage` in `settings.json`, and `settings:get` never returns them.

## Rules specific to Atrium

- Don't edit `src/suitelink.js`. Atrium doesn't carry it yet; ask the Utility Package chat if it should join the Suite link.
- New sections go in `src/core/sections/*.js` and must pass `node test/content-check.js`: one root, known icons, balanced CSS, theme tokens only.
- Template `replace` keys must match the section html exactly; the check enforces this.
- The preview, screenshots and exports must stay identical. Never special-case the preview in `render.js` beyond `ctx.mode === 'preview'`, which exists only for forms, the empty-page hint and analytics.
- No native modules. The only dependency is `qrcode-generator`, which is pure JS.
