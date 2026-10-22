// Glean — scripts run inside the page (in an isolated world, so the page can't see or break them).
// SCAN returns what's visible in the DOM; SCROLL nudges the feed down one screen and reports progress.

const SCAN = `(() => {
  const abs = (u) => { try { return new URL(u, location.href).href; } catch (e) { return null; } };
  const bestSrcset = (ss) => {
    if (!ss) return null; let top = null, topW = -1;
    for (const part of ss.split(/,\\s+(?=\\S)/)) {
      const [u, d] = part.trim().split(/\\s+/); const w = d ? parseFloat(d) * (/x$/.test(d) ? 1000 : 1) : 1;
      if (u && w > topW) { top = u; topW = w; }
    }
    return top ? abs(top) : null;
  };
  const linkOf = (el) => { const a = el.closest && el.closest('a[href]'); return a ? abs(a.getAttribute('href')) : null; };
  const images = [], videos = [], backgrounds = [], links = [], json = [];
  const seen = new Set();
  for (const img of document.images) {
    const src = bestSrcset(img.getAttribute('srcset')) || bestSrcset(img.closest('picture') && [...img.closest('picture').querySelectorAll('source')].map(s => s.getAttribute('srcset')).filter(Boolean).join(', ')) || abs(img.currentSrc || img.src || img.getAttribute('data-src') || '');
    if (!src || seen.has(src) || /^data:/.test(src)) continue; seen.add(src);
    const r = img.getBoundingClientRect();
    images.push({ src, thumb: abs(img.currentSrc || img.src), w: img.naturalWidth || 0, h: img.naturalHeight || 0, shownW: Math.round(r.width), alt: (img.alt || '').slice(0, 400), link: linkOf(img) });
  }
  for (const v of document.querySelectorAll('video')) {
    const src = abs(v.currentSrc || v.src || (v.querySelector('source[src]') || {}).src || '');
    const poster = v.poster ? abs(v.poster) : null;
    videos.push({ src, poster, w: v.videoWidth || 0, h: v.videoHeight || 0, link: linkOf(v) });
  }
  let n = 0;
  for (const el of document.querySelectorAll('[style*="background"]')) {
    if (++n > 4000) break;
    const m = /url\\(["']?([^"')]+)["']?\\)/.exec(el.style.backgroundImage || '');
    if (!m) continue; const src = abs(m[1]); if (!src || seen.has(src) || /^data:/.test(src)) continue; seen.add(src);
    const r = el.getBoundingClientRect(); if (r.width < 120 && r.height < 120) continue;
    backgrounds.push({ src, w: 0, h: 0, link: linkOf(el) });
  }
  for (const a of document.querySelectorAll('a[href]')) {
    const href = abs(a.getAttribute('href'));
    if (href && /\\.(jpe?g|png|gif|webp|avif|mp4|mov|webm)(\\?|$)/i.test(href) && !seen.has(href)) { seen.add(href); links.push({ href, text: (a.textContent || '').trim().slice(0, 200) }); }
  }
  const KEYS = /image_versions2|display_url|image_urls|download_url|viewer_image|photo_image|extended_entities|"uri":"https/;
  // Data the page shipped with: read once per script (marked), so repeat scans stay cheap.
  for (const s of document.querySelectorAll('script[type="application/json"]:not([data-glean-read]), script#__NEXT_DATA__:not([data-glean-read]), script[type="application/ld+json"]:not([data-glean-read])')) {
    s.setAttribute('data-glean-read', '');
    const t = s.textContent || ''; if (t.length > 20 && t.length < 8e6 && KEYS.test(t)) json.push(t);
  }
  const og = document.querySelector('meta[property="og:image"]');
  return { url: location.href, title: document.title, images, videos, backgrounds, links, json, og: og ? abs(og.content) : null };
})()`;

// Scrolls the page's main feed one step. Finds the biggest scrolling element when the window itself doesn't scroll.
const SCROLL = `(() => {
  const se = document.scrollingElement || document.documentElement;
  let el = se;
  if (se.scrollHeight <= innerHeight + 4) {
    let top = null, topA = 0;
    for (const x of document.querySelectorAll('div, main, section')) {
      if (x.scrollHeight > x.clientHeight + 40) { const cs = getComputedStyle(x); if (!/(auto|scroll)/.test(cs.overflowY)) continue; const a = x.clientWidth * x.clientHeight; if (a > topA) { top = x; topA = a; } }
    }
    if (top) el = top;
  }
  const before = el.scrollTop, h = el.scrollHeight;
  const view = el === se ? innerHeight : el.clientHeight;
  el.scrollBy ? el.scrollBy({ top: Math.round(view * 0.85), behavior: 'smooth' }) : (el.scrollTop += Math.round(view * 0.85));
  return { before, height: h, view, atBottom: before + view >= h - 8 };
})()`;

const RESET = `(() => { for (const s of document.querySelectorAll('[data-glean-read]')) s.removeAttribute('data-glean-read'); return true; })()`;

const SCROLL_TOP = `(() => { (document.scrollingElement || document.documentElement).scrollTo({ top: 0 }); return true; })()`;

module.exports = { SCAN, SCROLL, SCROLL_TOP, RESET };
