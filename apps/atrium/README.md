# Atrium

A website builder for you and your AI. Premium sections and themes, a live preview you click to edit, Claude, GPT, Gemini or a local model with full control of the site, quality checks, and exports to any host, WordPress, Weebly and the other site builders. Mac and Windows, part of the Utility Suite.

## What it does

- **Sites from starters or from nothing**: 8 starter sites (SaaS, agency, portfolio, restaurant, local fiber ISP, creator, event, landing page), a blank site, "describe it and the AI builds it", or **rebuild any live site from its URL**. You can also import an existing static site (a folder of .html files) or an `.atrium` backup.
- **Section library**: 43 responsive sections in 15 categories: headers, heroes, logos, features, content, stats, social proof, pricing, CTAs, FAQ, gallery, team, blog, contact and footers. Each one uses the theme tokens, so re-theming changes the whole site.
- **Themes**: 14 presets, including Liquid Metal and Gold Leaf. You can build a full palette from one brand colour, pick from 42 fonts and 16 pairings, and set corner radius, button shape, density, shadows and width. Contrast checks run as you change colours.
- **Live preview**: the real site at desktop, tablet or phone width.
  - Click any section or element to select it.
  - Double-click text to edit it in place, or double-click an image to replace it.
  - Each section has a floating toolbar (move, duplicate, code, AI, delete) and an "+ Add section" button below it.
  - Changed sections swap in without a reload.
  - Preview mode lets you use the site like a visitor.
  - Phone preview over Wi-Fi with a QR code, and Open in your browser.
- **Inspector**: per-element text colour (from the theme), size, weight, alignment, background (with the gradient), padding, corners, max width, links (pick a page or a URL, open in a new tab), image replacement and alt text. You can also move, duplicate or delete an element. Section background and spacing live here too.
- **Code**: an HTML / CSS / JS editor for every section, with highlighting and checks. Section CSS is scoped automatically, with `&` meaning the section. Site-wide CSS, JS and head/body code are also available.
- **Assets**: drop images anywhere in the window, and big photos are resized for the web. Free photo search (Openverse, openly licensed). Any image can be set as the logo, favicon or share image.
- **Blog**: Markdown posts with covers, tags and drafts. They appear in "Latest posts" sections, get their own pages, and become real posts on WordPress.
- **Site settings**: SEO (titles, descriptions, canonical, Open Graph, sitemap, robots, structured data), GA4, GTM, Meta Pixel and Plausible (exported sites only), forms (Formspree / any endpoint, Netlify Forms, email, WordPress mail) and social profiles.
- **Quality check**: SEO, accessibility (alt text, labels, link text, heading order) and contrast measured on the rendered page. It also checks mobile layout at 390px (overflow, tap targets), broken links and heavy images, gives a score per page, and clicking an issue jumps to its section. "Fix these with AI" hands the list to the AI.
- **Versions**: every AI change and every few minutes of your edits are saved, and any version can be restored. Undo and redo are also available.

## AI

- **In the app** (the AI tab, ⌘K):
  - **Claude Code** or **Codex** using your own subscription.
  - Your own API key for **Anthropic (Claude)**, **OpenAI (GPT)**, **Google Gemini**, **OpenRouter** (any model), **xAI**, **Mistral**, **DeepSeek** or **Groq**.
  - A local model through **Ollama** or **LM Studio**.
  - Any OpenAI-compatible address.
  - The AI knows what you have selected ("this section").
  - You see its steps and the screenshots it takes.
- **From Claude and Codex**: Settings › "Use Atrium from Claude and Codex" adds Atrium's MCP server to the Claude desktop app, Claude Code and Codex. Atrium starts in the background when they call it.
- **The same 36 tools for every AI**:
  - Pages, sections (library or hand-written), find and replace, theme, settings, posts, assets, free photo search.
  - **Screenshots** at desktop, tablet and phone widths (full pages in readable slices, or one section), so the AI checks its own work.
  - Audits, `fetch_url` to read any website (text, structure, colours, fonts, screenshot), static-site import, export, publish, and versions.

## Export & publish

| Format | What you get |
|---|---|
| Static website | HTML/CSS/JS for any host, plus sitemap.xml, robots.txt and 404.html |
| WordPress theme | A block theme `.zip`. Activating it creates the pages and posts (never overwrites), sets the front page and "Post name" links, and makes contact forms email the admin. Menus, post cards and assets resolve live through `{{atrium:…}}` tokens in `functions.php`. Also a WXR file for Tools › Import. |
| Site builders | For Weebly, Wix, Squarespace, Webflow, Shopify, Google Sites, Carrd and others: `head-code.html`, whole-page and per-section snippets (scoped inside `.atrium-embed` so they don't restyle the host site), iframe-ready pages, and steps for each platform |
| Weebly theme files | `header.html` / `no-header.html` with `{menu}` `{content}` `{footer}`, `main.css` and assets |
| Single-file pages | Each page in one .html file with CSS, JS and images inside |
| Atrium backup | `.atrium` (zip of the site and its assets). Import it to move a site to another computer |

Publish to **Netlify** (personal access token, zip deploy) or **GitHub Pages** (the GitHub CLI's sign-in, `gh-pages` branch).

## Data

- Sites live in `~/Documents/Atrium/<Site>/` (change this in Settings). Each site folder holds:
  - `atrium.json`: pages, sections, theme, settings and posts.
  - `assets/`
  - `exports/`
  - `.atrium/versions/`: snapshots.
  - `.atrium/thumb.jpg`
  - `.atrium/chat.json`: the AI conversation, without images.
  - Trashed sites go to `.trash/` in the sites folder.
- The app-data folder holds:
  - `settings.json`: API keys and the Netlify token, encrypted with the system keychain and never sent to the window.
  - `bridge.json`: the plugin's private connection.
  - `mcp/`: the MCP server copy.
  - `ask/`: working folders for Claude Code / Codex.

## Code map

```
src/main.js            window, settings, sites, IPC, the in-app chat (CLI or API)
src/preview.js         live preview server (127.0.0.1; LAN for phones) + SSE hot updates, library/template previews
src/capture.js         hidden browser: screenshots, in-page audit, reading websites, HTML parsing for imports
src/mcp-handlers.js    every AI tool (shared by the MCP bridge and the in-app models)
src/llm.js             in-app agent loop: Anthropic Messages + OpenAI-compatible Chat Completions with tools
src/ai.js              finds Claude Code / Codex / gh; runs Claude Code with --resume per site
src/connectors.js      installs the MCP server into Claude Desktop / Claude Code / Codex; the local bridge
src/publish.js         Netlify and GitHub Pages
src/assets.js          image import + web resizing, favicon
src/importer.js        static-site and .atrium import
src/core/site.js       sites on disk: pages, sections, theme, settings, posts, assets, versions, undo
src/core/render.js     site → pages (placeholders, icons, SEO, analytics), placeholder art
src/core/scope.js      section CSS scoping (& = root)
src/core/theme.js      theme → CSS variables, Google Fonts, contrast, palette from one colour
src/core/exporters.js  static, single, WordPress (+WXR), embed pack, Weebly, backup
src/core/{sections/*,sections,templates,presets,site-icons,base-css}.js   the content library (see CONTRACT.md)
src/core/{markdown,zip}.js
mcp/atrium-mcp.js      stdio MCP server → the app's bridge;  mcp/tools.js  the tools;  mcp/guide.js  the AI's guide
src/renderer/          the window (app, builder, panels, inspector, chat, sheets, home, boot) + overlay.js/css (the in-preview editing layer)
```

## Tests

```bash
npm test                                      # 13 Node checks: content library, scoping, markdown, zip, sites, render, every export of every template, tools, both agent loops (stand-in servers)
xvfb-run node test/e2e/shots.js /tmp/shots    # (Linux) every screen, in-preview editing, the real MCP script → bridge → app path, all exports
node test/content-check.js                    # the section/template/preset library on its own
```
