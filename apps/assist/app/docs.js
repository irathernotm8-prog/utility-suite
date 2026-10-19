// Reading attachments (PDF, Word, text, images) and picking the most relevant passages.
const MAX_FILE = 30 * 1024 * 1024;
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|xml|yaml|yml|html?|css|js|mjs|ts|tsx|jsx|py|rb|go|rs|java|kt|swift|c|h|cpp|cs|php|sql|sh|ini|toml|log|srt|vtt|rtf|tex)$/i;

let pdfjs = null;
async function loadPdfjs() {
  if (pdfjs) return pdfjs;
  pdfjs = await import("./vendor/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.mjs", import.meta.url).href;
  return pdfjs;
}
function loadMammoth() {
  if (window.mammoth) return Promise.resolve(window.mammoth);
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = new URL("./vendor/mammoth.js", import.meta.url).href;
    s.onload = () => res(window.mammoth);
    s.onerror = () => rej(new Error("Word reader failed to load"));
    document.head.append(s);
  });
}

async function pdfText(buf) {
  const lib = await loadPdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
  const pages = Math.min(doc.numPages, 300);
  const out = [];
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    let line = "", lastY = null;
    const lines = [];
    for (const it of tc.items) {
      const y = it.transform ? Math.round(it.transform[5]) : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) { lines.push(line); line = ""; }
      line += it.str + (it.hasEOL ? "\n" : "");
      lastY = y;
    }
    lines.push(line);
    out.push(`[Page ${i}]\n` + lines.join("\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim());
  }
  return { text: out.join("\n\n"), pages: doc.numPages };
}

async function imageData(file, max = 1024) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return { dataUrl: c.toDataURL("image/jpeg", 0.86), width: c.width, height: c.height };
  } finally { URL.revokeObjectURL(url); }
}

// → { name, kind: "text" | "image", text?, dataUrl?, pages?, chars, error? }
export async function readFile(file) {
  const name = file.name || "file";
  if (file.size > MAX_FILE) return { name, kind: "text", error: "Too large (max 30 MB)" };
  try {
    if (/^image\//.test(file.type)) {
      const d = await imageData(file);
      return { name, kind: "image", dataUrl: d.dataUrl, chars: 0 };
    }
    if (file.type === "application/pdf" || /\.pdf$/i.test(name)) {
      const { text, pages } = await pdfText(await file.arrayBuffer());
      if (!text.replace(/\[Page \d+\]/g, "").trim()) return { name, kind: "text", error: "This PDF has no selectable text (it may be a scan)" };
      return { name, kind: "text", text, pages, chars: text.length };
    }
    if (/\.docx$/i.test(name) || /officedocument\.wordprocessingml/.test(file.type)) {
      const mammoth = await loadMammoth();
      const r = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      const text = r.value.replace(/\n{3,}/g, "\n\n").trim();
      return { name, kind: "text", text, chars: text.length };
    }
    if (/^text\//.test(file.type) || TEXT_EXT.test(name) || file.type === "application/json") {
      let text = await file.text();
      if (/\.html?$/i.test(name)) text = new DOMParser().parseFromString(text, "text/html").body.innerText;
      return { name, kind: "text", text, chars: text.length };
    }
    return { name, kind: "text", error: "Assist can read PDF, Word (.docx), text, code and image files" };
  } catch (e) {
    console.error(e);
    return { name, kind: "text", error: "Couldn't read this file" };
  }
}

/* ---------- Relevance: pick the passages that matter for a question ---------- */
const STOP = new Set("a an and are as at be but by can could did do does for from had has have how i if in into is it its me my of on or our please should so than that the their them then there these they this to was we were what when where which who why will with would you your about tell give show explain summarize summary".split(" "));
export function terms(s) {
  return String(s || "").toLowerCase().match(/[a-z0-9][a-z0-9'’.-]*/g)?.map((w) => w.replace(/[’']s$/, "").replace(/\.$/, "")).filter((w) => w.length > 1 && !STOP.has(w)) || [];
}

export function chunk(text, size = 900, overlap = 120) {
  const out = [];
  const paras = String(text).split(/\n{2,}/);
  let cur = "";
  for (const p of paras) {
    if ((cur + "\n\n" + p).length > size && cur) { out.push(cur); cur = cur.slice(-overlap) + "\n\n" + p; }
    else cur = cur ? cur + "\n\n" + p : p;
    while (cur.length > size * 1.6) { out.push(cur.slice(0, size)); cur = cur.slice(size - overlap); }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// Returns text no longer than maxChars: the whole thing if it fits, otherwise the best passages in order.
export function selectRelevant(text, query, maxChars) {
  text = String(text || "");
  if (text.length <= maxChars) return { text, partial: false };
  const q = [...new Set(terms(query))];
  const pieces = chunk(text);
  if (!q.length) {
    // No real question (e.g. "summarize this"): take an even spread through the document
    const step = Math.max(1, Math.floor(pieces.length / Math.max(1, Math.floor(maxChars / 900))));
    const picked = pieces.filter((_, i) => i % step === 0);
    return { text: fit(picked, maxChars), partial: true };
  }
  const df = new Map();
  const toks = pieces.map((p) => { const t = terms(p); new Set(t).forEach((w) => df.set(w, (df.get(w) || 0) + 1)); return t; });
  const N = pieces.length;
  const scored = pieces.map((p, i) => {
    const tf = new Map(); toks[i].forEach((w) => tf.set(w, (tf.get(w) || 0) + 1));
    let s = 0;
    for (const w of q) { const f = tf.get(w) || 0; if (f) s += (Math.log(1 + N / (df.get(w) || 1))) * (f * 2.2) / (f + 1.2); }
    if (i === 0) s += 0.5; // the opening usually gives context
    return { i, s };
  }).sort((a, b) => b.s - a.s);
  const chosen = [];
  let total = 0;
  for (const { i } of scored) { if (total + pieces[i].length > maxChars) continue; chosen.push(i); total += pieces[i].length + 8; }
  chosen.sort((a, b) => a - b);
  return { text: fit(chosen.map((i) => pieces[i]), maxChars), partial: true };
}
function fit(list, maxChars) {
  let out = "";
  for (const p of list) { if (out.length + p.length + 8 > maxChars) break; out += (out ? "\n\n[…]\n\n" : "") + p; }
  return out || list[0]?.slice(0, maxChars) || "";
}
