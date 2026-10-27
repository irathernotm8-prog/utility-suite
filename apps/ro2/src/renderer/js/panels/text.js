// Text: headings, body, styled font pairings.
import { h, ico } from '../ui.js';
import { makeText, TEXT_PRESETS } from '../editor/objects.js';
import { fabric } from '../editor/fab.js';
import { ensureEditor } from '../app.js';
import { register } from '../drawer.js';
import { draggable } from './elements.js';
import { ensureFont } from '../fonts.js';

// Font pairings: each is a few text boxes placed together
export const COMBOS = [
  { name: 'Big & bold', parts: [{ text: 'BIG NEWS', fontFamily: 'Anton', size: 0.13, fill: '#111418', charSpacing: 20 }, { text: 'Something exciting is coming', fontFamily: 'Inter', size: 0.032, fill: '#3d4249', dy: 0.1 }] },
  { name: 'Elegant', parts: [{ text: 'The Wedding', fontFamily: 'Great Vibes', size: 0.1, fill: '#7a5c3e' }, { text: 'OF EMMA & JAMES', fontFamily: 'Montserrat', fontWeight: 700, size: 0.028, fill: '#3d4249', charSpacing: 400, dy: 0.085 }] },
  { name: 'Editorial', parts: [{ text: 'Spring Issue', fontFamily: 'Playfair Display', fontWeight: 900, size: 0.1, fill: '#111418', fontStyle: 'normal' }, { text: 'Stories, style & everything new', fontFamily: 'Lora', size: 0.032, fill: '#3d4249', dy: 0.085 }] },
  { name: 'Modern', parts: [{ text: 'Launch day', fontFamily: 'Space Grotesk', fontWeight: 700, size: 0.095, fill: '#111418' }, { text: 'NOV 14 · 7PM', fontFamily: 'Space Grotesk', size: 0.034, fill: '#0097b2', charSpacing: 200, dy: 0.08 }] },
  { name: 'Playful', parts: [{ text: 'Hello summer!', fontFamily: 'Pacifico', size: 0.09, fill: '#ff5757' }, { text: 'pool party · snacks · music', fontFamily: 'Quicksand', fontWeight: 700, size: 0.034, fill: '#3d4249', dy: 0.085 }] },
  { name: 'Sale tag', parts: [{ text: '50% OFF', fontFamily: 'Archivo Black', size: 0.12, fill: '#ff3131' }, { text: 'EVERYTHING MUST GO', fontFamily: 'Oswald', fontWeight: 700, size: 0.04, fill: '#111418', charSpacing: 150, dy: 0.095 }] },
  { name: 'Handwritten', parts: [{ text: 'thank you', fontFamily: 'Caveat', fontWeight: 700, size: 0.12, fill: '#111418' }, { text: 'for being here', fontFamily: 'Dancing Script', size: 0.05, fill: '#7c8b98', dy: 0.085 }] },
  { name: 'Retro', parts: [{ text: 'GAME ON', fontFamily: 'Press Start 2P', size: 0.06, fill: '#5e17eb' }, { text: 'Friday night tournament', fontFamily: 'Rubik', fontWeight: 700, size: 0.034, fill: '#111418', dy: 0.075 }] },
  { name: 'Statement', parts: [{ text: 'Make it happen.', fontFamily: 'Bricolage Grotesque', fontWeight: 800, size: 0.1, fill: '#111418' }] },
  { name: 'Outline', parts: [{ text: 'NEON', fontFamily: 'Bungee', size: 0.13, fill: 'rgba(0,0,0,0)', stroke: '#ff66c4', strokeWidth: 4, shadow: { color: 'rgba(255,102,196,.8)', blur: 30, offsetX: 0, offsetY: 0 } }] },
];

export async function addTextPreset(key, at) {
  const ed = ensureEditor(); const p = TEXT_PRESETS[key];
  const t = await makeText(ed, p); ed.add(t, { at: at || ed.dropPoint() });
  return t;
}
export async function addCombo(c, at) {
  const ed = ensureEditor(); const base = Math.min(ed.W, ed.H); const p0 = at || ed.dropPoint();
  const objs = [];
  for (const part of c.parts) {
    const t = await makeText(ed, { ...part, fontWeight: part.fontWeight || 400 });
    t.set({ left: p0.x, top: p0.y + (part.dy || 0) * base }); objs.push(t);
  }
  // centre the pairing vertically on the drop point
  const top = Math.min(...objs.map((o) => o.top - o.height / 2)), bottom = Math.max(...objs.map((o) => o.top + o.height / 2)); const shift = p0.y - (top + bottom) / 2;
  objs.forEach((o) => { o.top += shift; ed.add(o, { select: false, commit: false }); });
  ed.select(objs); ed.commit();
}
register('text', {
  label: 'Text', icon: 'type',
  async render(root) {
    root.append(h('div.p-title', 'Text'));
    const big = h('button.btn.primary.block.lg', { html: ico('type') + '<span>Add a text box</span>', on: { click: () => addTextPreset('body') } }); root.append(big);
    root.append(h('div.sec', h('h4', 'Default styles')));
    const pv = (key, label, css) => draggable(h('button.text-preset', { style: css }, label), { kind: 'text', preset: key });
    root.append(pv('heading', 'Add a heading', { font: '800 26px Poppins' }), pv('subheading', 'Add a subheading', { font: '600 18px Poppins' }), pv('body', 'Add a little bit of body text', { font: '400 13px Inter' }));
    root.append(h('div.sec', h('h4', 'Font pairings')));
    const g = h('div.tiles.c2'); root.append(g);
    for (const c of COMBOS) {
      await Promise.all(c.parts.map((p) => ensureFont(p.fontFamily, p.fontWeight || 400)));
      const card = h('button.combo', { title: c.name, on: { click: () => addCombo(c) } });
      const inner = h('div', { style: { textAlign: 'center', lineHeight: 1.05, padding: '6px', background: c.name === 'Outline' ? '#14161a' : '#f4f6f8', width: '100%', height: '100%', display: 'grid', placeContent: 'center', gap: '4px' } });
      c.parts.forEach((p, i) => inner.append(h('div', { style: { fontFamily: `"${p.fontFamily}"`, fontWeight: p.fontWeight || 400, fontSize: i === 0 ? '17px' : '8.5px', color: p.fill === 'rgba(0,0,0,0)' ? 'transparent' : p.fill, letterSpacing: (p.charSpacing || 0) / 1500 + 'em', WebkitTextStroke: p.stroke ? `1px ${p.stroke}` : null, maxWidth: '140px', overflowWrap: 'anywhere' } }, p.text)));
      card.append(inner); g.append(card);
    }
    root.append(h('p.tiny.dim', { style: { marginTop: '12px' } }, 'Tip: double-click any text on the page to type. Fonts are free to use (SIL Open Font License); your computer’s own fonts are in the font list too.'));
  },
});
export { fabric };
