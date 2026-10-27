// Bundled fonts (vendor/fonts, SIL OFL) plus the fonts installed on this computer.
let bundled = []; let system = []; const loaded = new Set();

export async function initFonts() {
  bundled = await (await fetch('vendor/fonts/fonts.json')).json();
  const css = bundled.map((f) => Object.entries(f.files).map(([w, file]) => `@font-face{font-family:"${f.family}";font-weight:${w};font-style:normal;font-display:block;src:url("vendor/fonts/${file}") format("woff2")}`).join('')).join('');
  const st = document.createElement('style'); st.textContent = css; document.head.append(st);
  // warm up the most common ones so the first text box renders right away
  await Promise.all(['Inter', 'Poppins', 'Montserrat', 'Playfair Display'].map((f) => ensureFont(f, 400).catch(() => {})));
}
export async function loadSystemFonts() {
  if (system.length || !window.queryLocalFonts) return system;
  try {
    const list = await window.queryLocalFonts(); const fam = new Set();
    for (const f of list) fam.add(f.family);
    const mine = new Set(bundled.map((b) => b.family));
    system = [...fam].filter((f) => !mine.has(f) && !/^\.|LastResort/.test(f)).sort((a, b) => a.localeCompare(b));
  } catch { system = []; }
  return system;
}
export const bundledFonts = () => bundled;
export const systemFonts = () => system;
export const weightsOf = (family) => { const f = bundled.find((b) => b.family === family); return f ? Object.keys(f.files).map(Number) : [400, 700]; };
export function boldWeight(family) { const w = weightsOf(family); return w.includes(700) ? 700 : w[w.length - 1]; }
export async function ensureFont(family, weight = 400) {
  const key = family + '|' + weight; if (loaded.has(key)) return;
  try { await document.fonts.load(`${weight} 32px "${family}"`); } catch {}
  loaded.add(key);
}
// All fonts a design uses must be ready before it is drawn or exported.
export async function ensureFontsFor(objects) {
  const want = new Set();
  const walk = (o) => {
    if (!o) return;
    if (o.fontFamily) want.add(`${o.fontFamily}|${o.fontWeight || 400}`);
    if (o.styles) for (const line of Object.values(o.styles)) for (const s of Object.values(line)) if (s.fontFamily) want.add(`${s.fontFamily}|${s.fontWeight || o.fontWeight || 400}`);
    (o.objects || o._objects || []).forEach(walk);
  };
  objects.forEach(walk);
  await Promise.all([...want].map((k) => { const [f, w] = k.split('|'); return ensureFont(f, w); }));
}
