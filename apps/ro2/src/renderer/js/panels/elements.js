// Elements: shapes, lines, photo frames, icons and emoji.
import { h, ico, iconNames, iconData, debounce, esc } from '../ui.js';
import { SHAPES, SHAPE_CATS, LINES, shapeSvg, lineSvg, byId } from '../editor/shapes.js';
import { makeShape, makeLine, makeIcon, makeEmoji, loadImage } from '../editor/objects.js';
import { fabric } from '../editor/fab.js';
import { FRAMES, applyFrame } from './image.js';
import { app, ensureEditor } from '../app.js';
import { register } from '../drawer.js';

export const POPULAR_ICONS = ['heart', 'star', 'sparkles', 'zap', 'flame', 'sun', 'moon', 'cloud', 'check', 'circle-check', 'x', 'plus', 'arrow-right', 'arrow-up-right', 'trending-up', 'chart-column', 'chart-pie', 'target',
  'rocket', 'lightbulb', 'trophy', 'crown', 'gift', 'tag', 'percent', 'shopping-bag', 'shopping-cart', 'credit-card', 'wallet', 'dollar-sign', 'badge-check', 'thumbs-up', 'smile', 'party-popper',
  'camera', 'image', 'video', 'music', 'headphones', 'mic', 'phone', 'mail', 'message-circle', 'send', 'bell', 'calendar', 'clock', 'map-pin', 'globe', 'wifi', 'router', 'signal', 'tv', 'monitor', 'smartphone', 'laptop',
  'house', 'building-2', 'users', 'user', 'briefcase', 'graduation-cap', 'book-open', 'pen-tool', 'palette', 'brush', 'scissors', 'coffee', 'pizza', 'utensils', 'leaf', 'flower-2', 'tree-pine', 'mountain', 'waves', 'umbrella',
  'car', 'plane', 'bike', 'dumbbell', 'trophy', 'shield-check', 'lock', 'key', 'settings', 'search', 'info', 'circle-help', 'triangle-alert', 'quote', 'hash', 'at-sign', 'link', 'share-2', 'download', 'upload', 'play', 'pause'];
export const EMOJI = '😀 😂 🥹 😍 🤩 😎 🥳 😇 🤔 😴 😭 😡 👍 👏 🙌 🙏 💪 👀 🔥 ✨ 💯 ⭐ 🌟 ⚡ 💥 🎉 🎊 🎁 🎈 🏆 🥇 🎯 🚀 💡 📈 📊 💰 💸 🛒 📣 📢 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 ✅ ❌ ⚠️ 📌 📍 🔔 🕒 📅 ☀️ 🌙 ☁️ 🌈 🌊 🌸 🌻 🍀 🌴 🍕 🍔 🍩 ☕ 🍹 🎂 ⚽ 🏀 🏈 🎮 🎧 🎵 📸 🎬 💻 📱 📶 🏠 🏙️ ✈️ 🚗 🐶 🐱'.split(' ');

// Drag a tile onto the page (or click it to add in the middle)
export function draggable(el, payload) {
  el.draggable = true;
  el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-ro2', JSON.stringify(payload)); e.dataTransfer.effectAllowed = 'copy'; });
  el.addEventListener('click', () => addPayload(payload));
  return el;
}
export async function addPayload(p, at) {
  const ed = ensureEditor(); let o;
  if (p.kind === 'shape') o = makeShape(ed, byId(p.id));
  else if (p.kind === 'line') o = makeLine(ed, LINES.find((l) => l.id === p.id));
  else if (p.kind === 'icon') o = await makeIcon(ed, p.id);
  else if (p.kind === 'emoji') o = await makeEmoji(ed, p.ch);
  else if (p.kind === 'frame') o = await makeFrame(ed, p.id);
  else if (p.kind === 'text') { const { addTextPreset } = await import('./text.js'); return addTextPreset(p.preset, at); }
  else if (p.kind === 'photo') { const { addLibraryPhoto } = await import('./photos.js'); return addLibraryPhoto(p.photo, at); }
  else if (p.kind === 'logo') { const B = await import('./brand.js'); const k = app.brand.kits.find((x) => x.id === p.kit); const l = k && k.logos.find((x) => x.id === p.id); return l && B.addLogo(k, l, at); }
  else if (p.kind === 'brandtext') { const B = await import('./brand.js'); return B.addBrandText(p.role, at); }
  else if (p.kind === 'asset') { const { addImage } = await import('../app.js'); return addImage(ed.assetUrl(p.id), { name: p.name, at }); }
  if (o) ed.add(o, { at: at || ed.dropPoint() });
  return o;
}
// A photo frame: a placeholder picture inside a shape; drop a photo on it to fill it
let placeholder = null;
async function placeholderUrl() {
  if (placeholder) return placeholder;
  const c = document.createElement('canvas'); c.width = c.height = 800; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 800, 800); g.addColorStop(0, '#d9dee3'); g.addColorStop(1, '#b9c1c8'); x.fillStyle = g; x.fillRect(0, 0, 800, 800);
  x.strokeStyle = 'rgba(60,70,80,.55)'; x.lineWidth = 14; x.lineCap = 'round'; x.lineJoin = 'round';
  x.strokeRect(290, 310, 220, 180); x.beginPath(); x.moveTo(300, 470); x.lineTo(370, 400); x.lineTo(420, 440); x.lineTo(460, 400); x.lineTo(500, 450); x.stroke(); x.beginPath(); x.arc(450, 360, 18, 0, 7); x.stroke();
  x.fillStyle = 'rgba(60,70,80,.7)'; x.font = '700 34px UI, sans-serif'; x.textAlign = 'center'; x.fillText('Drop a photo here', 400, 560);
  placeholder = c.toDataURL('image/png'); return placeholder;
}
async function makeFrame(ed, id) {
  const url = await placeholderUrl(); const el = await loadImage(url);
  const s = byId(id); const aw = s.w || 100, ah = s.h || 100;
  const img = new fabric.FabricImage(el, { ro2Name: 'Frame', assetId: ed.addAsset(url) });
  // crop the square placeholder to the frame's shape ratio
  const r = aw / ah; if (r > 1) img.set({ height: 800 / r, cropY: (800 - 800 / r) / 2 }); else img.set({ width: 800 * r, cropX: (800 - 800 * r) / 2 });
  const S = Math.min(ed.W, ed.H) * 0.45 / Math.max(img.width, img.height); img.set({ scaleX: S, scaleY: S });
  applyFrame(img, id); img.ro2Placeholder = true;
  return img;
}

register('elements', {
  label: 'Elements', icon: 'shapes',
  render(root, opts, alive) {
    let q = '';
    const search = h('input.input', { placeholder: 'Search shapes and icons', value: '', on: { input: debounce(() => { q = search.value.trim().toLowerCase(); body(); }, 120) } });
    root.append(h('div.p-title', 'Elements'), h('div.search', { html: ico('search') }, search));
    const out = h('div'); root.append(out);
    const body = () => {
      out.innerHTML = '';
      const shapes = SHAPES.filter((s) => !q || s.name.toLowerCase().includes(q) || s.id.includes(q));
      if (shapes.length) {
        out.append(h('div.sec', h('h4', 'Shapes')));
        const g = h('div.tiles'); for (const s of (q ? shapes : shapes)) g.append(draggable(h('button.tile', { title: s.name, style: { color: 'var(--tile-ink)' }, html: shapeSvg(s, 'currentColor') }), { kind: 'shape', id: s.id }));
        out.append(g);
      }
      const lines = LINES.filter((l) => !q || l.name.toLowerCase().includes(q) || 'line arrow'.includes(q));
      if (lines.length) {
        out.append(h('div.sec', h('h4', 'Lines & arrows')));
        const g = h('div.tiles'); for (const l of lines) g.append(draggable(h('button.tile', { title: l.name, html: lineSvg(l), style: { color: 'var(--tile-ink)' } }), { kind: 'line', id: l.id }));
        out.append(g);
      }
      const frames = FRAMES.filter((id) => !q || byId(id).name.toLowerCase().includes(q) || 'frame photo'.includes(q));
      if (frames.length) {
        out.append(h('div.sec', h('h4', 'Photo frames')));
        const g = h('div.tiles.c5'); for (const id of frames) { const s = byId(id); g.append(draggable(h('button.tile', { style: { color: 'var(--tile-ink)' }, title: s.name + ' frame', html: shapeSvg(s, 'none').replace(/fill="none"/, 'fill="none" stroke="currentColor" stroke-width="5" stroke-dasharray="7 5" vector-effect="non-scaling-stroke"') }), { kind: 'frame', id })); }
        out.append(g);
        if (!q) out.append(h('p.tiny.dim', { style: { marginTop: '6px' } }, 'Drop any photo onto a frame to fill it.'));
      }
      if (!q || 'html code web video motion animation clip'.includes(q)) {
        out.append(h('div.sec', h('h4', 'Code & motion')));
        out.append(h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' } },
          h('button.btn', { title: 'Write (or paste) HTML/CSS at the design size. Animations become video.', html: ico('code-xml') + '<span>HTML layer</span>', on: { click: () => import('../modals/html-editor.js').then((m) => m.openHtmlEditor()) } }),
          h('button.btn', { title: 'Add a video clip (MP4, MOV, WebM…)', html: ico('clapperboard') + '<span>Video clip</span>', on: { click: () => import('../video-layer.js').then((m) => m.pickVideo(ensureEditor())) } })));
        out.append(h('p.tiny.dim', { style: { marginTop: '6px' } }, 'Or let Claude or ChatGPT design it for you in the AI design tab.'));
      }
      if (!q || 'qr code link url'.includes(q)) {
        out.append(h('div.sec', h('h4', 'QR code')));
        const inp = h('input.input', { placeholder: 'https://… or any text', style: { flex: 1 }, on: { keydown: (e) => { if (e.key === 'Enter') go(); e.stopPropagation(); } } });
        const go = async () => { const v = inp.value.trim(); if (!v) return inp.focus(); const ed = ensureEditor(); const { makeQr } = await import('../editor/objects.js'); ed.add(await makeQr(ed, v), { at: ed.dropPoint() }); inp.value = ''; };
        out.append(h('div', { style: { display: 'flex', gap: '6px' } }, inp, h('button.btn', { html: ico('qr-code') + '<span>Add</span>', on: { click: go } })));
      }
      // icons
      const names = iconNames();
      const match = q ? names.filter((n) => n.includes(q) || (iconData(n)[1] || '').includes(q)) : POPULAR_ICONS.filter((n, i, a) => iconData(n) && a.indexOf(n) === i);
      out.append(h('div.sec', h('h4', q ? `Icons (${match.length})` : 'Icons'), q ? null : h('a', { on: { click: () => { q = ' '; showAllIcons(); } } }, `All ${names.length}`)));
      const ig = h('div.tiles.c6'); out.append(ig);
      let shown = 0; const more = h('button.btn.sm.block.ghost', { style: { marginTop: '8px' } }, 'Show more');
      const page = () => { for (const n of match.slice(shown, shown + 120)) ig.append(draggable(h('button.tile', { title: n.replace(/-/g, ' '), html: `<svg class="i" viewBox="0 0 24 24">${iconData(n)[0]}</svg>` }), { kind: 'icon', id: n })); shown += 120; more.style.display = shown < match.length ? '' : 'none'; };
      more.onclick = page; page(); out.append(more);
      if (!q || 'emoji'.includes(q)) {
        out.append(h('div.sec', h('h4', 'Emoji')));
        const eg = h('div.tiles.c6'); for (const ch of EMOJI) eg.append(draggable(h('button.tile.emoji', ch), { kind: 'emoji', ch })); out.append(eg);
      }
      if (!out.children.length || (!shapes.length && !lines.length && !match.length)) out.append(h('p.muted', { style: { marginTop: '20px' } }, `Nothing matches “${esc(q)}”.`));
    };
    const showAllIcons = () => {
      out.innerHTML = ''; const names = iconNames();
      out.append(h('div.sec', h('h4', `All icons (${names.length})`), h('a', { on: { click: () => { q = ''; body(); } } }, 'Back')));
      const ig = h('div.tiles.c6'); out.append(ig); let shown = 0;
      const more = h('button.btn.sm.block.ghost', { style: { marginTop: '8px' } }, 'Show more');
      const page = () => { for (const n of names.slice(shown, shown + 240)) ig.append(draggable(h('button.tile', { title: n.replace(/-/g, ' '), html: `<svg class="i" viewBox="0 0 24 24">${iconData(n)[0]}</svg>` }), { kind: 'icon', id: n })); shown += 240; more.style.display = shown < names.length ? '' : 'none'; };
      more.onclick = page; page(); out.append(more);
    };
    body();
  },
});
export { app };
