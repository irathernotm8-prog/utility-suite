// Internet access for Assist: keyless web search and readable page text.
// Runs in the main process (not the page), so searches go straight from this computer
// to the search engine. The AI model itself still runs on-device.
const { net } = require("electron");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

async function get(url, { method = "GET", body, headers = {}, timeout = 9000, maxBytes = 3_000_000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await net.fetch(url, {
      method, body, signal: ctrl.signal, redirect: "follow",
      headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9", accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.5", ...headers },
    });
    const reader = res.body && res.body.getReader();
    const chunks = []; let size = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length; chunks.push(value);
        if (size > maxBytes) { try { reader.cancel(); } catch {} break; }
      }
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    return { ok: res.ok, status: res.status, url: res.url || url, type: res.headers.get("content-type") || "", text: buf.toString("utf8") };
  } finally { clearTimeout(t); }
}

/* ---------- HTML helpers ---------- */
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", reg: "®", trade: "™", middot: "·", bull: "•" };
function decode(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch { return m; } }
    return ENT[e.toLowerCase()] ?? m;
  });
}
const strip = (s) => decode(String(s).replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

function htmlToText(html) {
  let h = html;
  const title = strip((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
  const desc = strip((h.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i) || h.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["']/i) || [])[1] || "");
  h = h.replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|canvas|iframe|template|form|button|select|nav|footer|aside)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<header\b[\s\S]*?<\/header>/gi, " ");
  // Prefer the main article if the page marks one
  const pick = (re) => { const m = h.match(re); return m && m[1] && m[1].length > 600 ? m[1] : null; };
  const main = pick(/<article\b[^>]*>([\s\S]*?)<\/article>/i) || pick(/<main\b[^>]*>([\s\S]*?)<\/main>/i) || pick(/<div[^>]+(?:id|class)=["'][^"']*(?:content|article|post|entry|story)[^"']*["'][^>]*>([\s\S]*)/i) || h;
  let t = main
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<\/(p|div|section|h[1-6]|li|tr|table|blockquote|pre|ul|ol|dd|dt)>/gi, "\n")
    .replace(/<h([1-6])\b[^>]*>/gi, "\n\n")
    .replace(/<(td|th)\b[^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, " ");
  t = decode(t).replace(/[ \t\f\v\r]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  // drop very short boilerplate lines (menus, buttons) but keep list items and headings
  t = t.split("\n").filter((line) => line.length > 30 || /^• /.test(line) || line === "" || /[.:?!]$/.test(line)).join("\n").replace(/\n{3,}/g, "\n\n");
  return { title, description: desc, text: t };
}

/* ---------- Search ---------- */
function unwrapDDG(href) {
  try {
    const u = new URL(href.startsWith("//") ? "https:" + href : href, "https://duckduckgo.com");
    const real = u.searchParams.get("uddg");
    return real ? decodeURIComponent(real) : u.href;
  } catch { return href; }
}

async function searchDDG(q, region) {
  const body = new URLSearchParams({ q, kl: region || "us-en" }).toString();
  const r = await get("https://html.duckduckgo.com/html/", { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", referer: "https://html.duckduckgo.com/" } });
  if (!r.ok) throw new Error("DuckDuckGo " + r.status);
  const out = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/div>)?/g;
  let m;
  while ((m = re.exec(r.text)) && out.length < 10) {
    const url = unwrapDDG(decode(m[1]));
    if (!/^https?:/.test(url) || /duckduckgo\.com\/y\.js|ad_domain|\/aclick/.test(url)) continue;
    out.push({ title: strip(m[2]), url, snippet: strip(m[3] || m[4] || "") });
  }
  return out;
}

async function searchBing(q) {
  const r = await get("https://www.bing.com/search?" + new URLSearchParams({ q, setlang: "en-US", cc: "US" }));
  if (!r.ok) throw new Error("Bing " + r.status);
  const out = [];
  const blocks = r.text.split(/<li class="b_algo"/).slice(1);
  for (const b of blocks) {
    const a = b.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    let url = decode(a[1]);
    // Bing sometimes wraps links: /ck/a?...&u=a1<base64>
    const u = url.match(/[?&]u=a1([^&]+)/);
    if (u) { try { url = Buffer.from(u[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"); } catch {} }
    const p = b.match(/<p[^>]*>([\s\S]*?)<\/p>/) || b.match(/<div class="b_caption"[^>]*>([\s\S]*?)<\/div>/);
    if (/^https?:/.test(url)) out.push({ title: strip(a[2]), url, snippet: strip(p ? p[1] : "") });
    if (out.length >= 10) break;
  }
  return out;
}

async function search(query, { engine = "auto", region } = {}) {
  const q = query.trim();
  if (!q) return { ok: false, error: "Empty search", results: [] };
  const order = engine === "bing" ? [searchBing, searchDDG] : [searchDDG, searchBing];
  let lastErr = null;
  for (const fn of order) {
    try {
      const results = await fn(q, region);
      if (results.length) return { ok: true, engine: fn === searchDDG ? "DuckDuckGo" : "Bing", query: q, results: dedupe(results) };
    } catch (e) { lastErr = e; }
  }
  return { ok: false, error: lastErr ? String(lastErr.message || lastErr) : "No results", results: [] };
}
function dedupe(list) {
  const seen = new Set();
  return list.filter((r) => { const k = r.url.replace(/[#?].*$/, "").replace(/\/$/, ""); if (seen.has(k)) return false; seen.add(k); return true; });
}

/* ---------- Read a page ---------- */
function isBlockedHost(u) {
  const h = u.hostname;
  return h === "localhost" || h.endsWith(".local") || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === "[::1]";
}

async function fetchPage(url) {
  let u;
  try { u = new URL(url); } catch { return { ok: false, error: "Not a valid link" }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, error: "Only web links can be read" };
  if (isBlockedHost(u)) return { ok: false, error: "Assist doesn't read addresses on your local network" };
  try {
    const r = await get(u.href, { timeout: 10000 });
    if (!r.ok) return { ok: false, url: r.url, error: `The site answered ${r.status}` };
    if (/pdf/i.test(r.type)) return { ok: false, url: r.url, error: "That link is a PDF — download it and attach it instead" };
    if (/json|text\/plain|markdown|csv/i.test(r.type)) return { ok: true, url: r.url, title: u.hostname + u.pathname, text: r.text.slice(0, 60000) };
    const { title, description, text } = htmlToText(r.text);
    if (!text || text.length < 80) return { ok: Boolean(description), url: r.url, title: title || u.hostname, text: description || "", error: description ? undefined : "This page needs JavaScript or a login, so Assist couldn't read it" };
    return { ok: true, url: r.url, title: title || u.hostname, description, text: text.slice(0, 60000) };
  } catch (e) {
    return { ok: false, url: u.href, error: e.name === "AbortError" ? "The site took too long to answer" : "Couldn't reach the site" };
  }
}

module.exports = { search, fetchPage, htmlToText };
