// Markdown → safe HTML for chat messages (works offline: libraries are bundled).
import { marked } from "./vendor/marked.js";
import DOMPurify from "./vendor/purify.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    code(token) {
      const lang = (token.lang || "").trim().split(/\s+/)[0];
      return `<div class="code"><div class="code-head"><span>${esc(lang || "code")}</span><button type="button" class="code-copy" data-copy>Copy</button></div><pre><code>${esc(token.text)}</code></pre></div>`;
    },
    link(token) {
      const href = token.href || "";
      const text = this.parser.parseInline(token.tokens);
      if (!/^https?:|^mailto:/i.test(href)) return text;
      return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" title="${esc(href)}">${text}</a>`;
    },
    table(token) {
      // default rendering wrapped so wide tables scroll
      const head = token.header.map((c) => `<th${c.align ? ` style="text-align:${c.align}"` : ""}>${this.parser.parseInline(c.tokens)}</th>`).join("");
      const rows = token.rows.map((r) => `<tr>${r.map((c) => `<td${c.align ? ` style="text-align:${c.align}"` : ""}>${this.parser.parseInline(c.tokens)}</td>`).join("")}</tr>`).join("");
      return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
    },
  },
});

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.getAttribute("href")) { node.setAttribute("target", "_blank"); node.setAttribute("rel", "noopener noreferrer"); }
});

// Close an unfinished code fence while streaming so the rest doesn't render as code
function balance(md) {
  const fences = (md.match(/^```/gm) || []).length;
  return fences % 2 ? md + "\n```" : md;
}

export function renderMarkdown(md, { sources = [] } = {}) {
  let src = balance(String(md || ""));
  if (sources.length) {
    // [1] or [1][2] → citation chips (not inside links like [text](url))
    src = src.replace(/\[(\d{1,2})\](?!\()/g, (m, n) => {
      const s = sources[+n - 1];
      return s ? `<sup class="cite"><a href="${esc(s.url)}" title="${esc(s.title || s.url)}">${n}</a></sup>` : m;
    });
  }
  const html = marked.parse(src);
  return DOMPurify.sanitize(html, { ADD_ATTR: ["target", "data-copy"], FORBID_TAGS: ["style", "form", "input", "img"] });
}

export function plainText(md) {
  return String(md || "").replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, "")).replace(/[*_`#>]+/g, "").replace(/\[(\d+)\]/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}
