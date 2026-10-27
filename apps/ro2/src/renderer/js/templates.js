// Starter templates, built from RO2's own shapes, text and icons (so every part stays editable).
import { fabric, Ro2Line, uid } from './editor/fab.js';
import { makeGradient } from './editor/editor.js';
import { byId } from './editor/shapes.js';
import { ensureFont } from './fonts.js';
import { iconData } from './ui.js';

const G = (a, b, angle = 135) => ({ gradient: { type: 'linear', angle, stops: [{ offset: 0, color: a }, { offset: 1, color: b }] } });
export const TEMPLATES = [
  { id: 'kpi', name: 'Weekly numbers', tag: 'Instagram post', w: 1080, h: 1080, bg: G('#0d1b2a', '#1b263b', 160), items: [
    { t: 'text', text: 'THIS WEEK IN NUMBERS', font: 'Montserrat', weight: 900, size: 46, color: '#5ef2ad', x: 540, y: 150, w: 900, spacing: 120 },
    { t: 'shape', shape: 'rounded', fill: 'rgba(255,255,255,0.06)', x: 540, y: 380, w: 900, h: 230, rx: 36 },
    { t: 'text', text: '2,481', font: 'Poppins', weight: 800, size: 120, color: '#ffffff', x: 380, y: 372, w: 520, align: 'left' },
    { t: 'text', text: 'new sign-ups\n+18% vs last week', font: 'Inter', weight: 400, size: 34, color: '#a9b8c9', x: 790, y: 380, w: 330, align: 'left', lh: 1.3 },
    { t: 'shape', shape: 'rounded', fill: 'rgba(255,255,255,0.06)', x: 305, y: 680, w: 430, h: 250, rx: 36 },
    { t: 'shape', shape: 'rounded', fill: 'rgba(255,255,255,0.06)', x: 775, y: 680, w: 430, h: 250, rx: 36 },
    { t: 'text', text: '64%', font: 'Poppins', weight: 800, size: 96, color: '#3fd2ea', x: 305, y: 650, w: 380 },
    { t: 'text', text: 'open rate', font: 'Inter', weight: 400, size: 32, color: '#a9b8c9', x: 305, y: 740, w: 380 },
    { t: 'text', text: '$12.40', font: 'Poppins', weight: 800, size: 96, color: '#ffde59', x: 775, y: 650, w: 400 },
    { t: 'text', text: 'cost per lead', font: 'Inter', weight: 400, size: 32, color: '#a9b8c9', x: 775, y: 740, w: 380 },
    { t: 'text', text: 'yourbrand.com', font: 'Inter', weight: 700, size: 28, color: '#5c6f84', x: 540, y: 960, w: 600 },
  ] },
  { id: 'sale', name: 'Big sale', tag: 'Instagram portrait', w: 1080, h: 1350, bg: { color: '#ff5757' }, items: [
    { t: 'shape', shape: 'burst', fill: '#ffde59', x: 820, y: 260, w: 380, h: 380, angle: 12 },
    { t: 'text', text: '50%\nOFF', font: 'Anton', weight: 400, size: 96, color: '#1b1f23', x: 820, y: 262, w: 300, lh: 0.95, angle: 12 },
    { t: 'text', text: 'SUMMER', font: 'Anton', weight: 400, size: 150, color: '#ffffff', x: 470, y: 500, w: 900, align: 'left' },
    { t: 'text', text: 'SALE', font: 'Anton', weight: 400, size: 330, color: '#ffffff', x: 470, y: 790, w: 900, align: 'left', lh: 0.9 },
    { t: 'shape', shape: 'pill', fill: '#1b1f23', x: 330, y: 1080, w: 500, h: 110 },
    { t: 'text', text: 'SHOP NOW', font: 'Montserrat', weight: 900, size: 44, color: '#ffffff', x: 330, y: 1080, w: 480, spacing: 100 },
    { t: 'text', text: 'This weekend only · in store and online', font: 'Inter', weight: 400, size: 32, color: '#ffe3e3', x: 540, y: 1250, w: 900 },
  ] },
  { id: 'event', name: 'Event story', tag: 'Instagram story', w: 1080, h: 1920, bg: G('#5e17eb', '#ff66c4', 120), items: [
    { t: 'shape', shape: 'blob1', fill: 'rgba(255,255,255,0.14)', x: 900, y: 260, w: 640, h: 640 },
    { t: 'shape', shape: 'blob2', fill: 'rgba(255,255,255,0.10)', x: 150, y: 1650, w: 720, h: 720 },
    { t: 'text', text: "YOU'RE INVITED", font: 'Montserrat', weight: 700, size: 46, color: '#ffffff', x: 540, y: 560, w: 900, spacing: 300 },
    { t: 'text', text: 'Launch\nNight', font: 'Playfair Display', weight: 900, size: 210, color: '#ffffff', x: 540, y: 820, w: 960, lh: 0.95 },
    { t: 'line', x: 540, y: 1080, w: 260, lw: 6, color: '#ffffff' },
    { t: 'text', text: 'FRIDAY · NOV 14 · 7 PM', font: 'Montserrat', weight: 700, size: 50, color: '#ffffff', x: 540, y: 1190, w: 960, spacing: 80 },
    { t: 'text', text: 'The Rooftop, Downtown Houston', font: 'Inter', weight: 400, size: 40, color: '#f6e9ff', x: 540, y: 1280, w: 900 },
    { t: 'shape', shape: 'pill', fill: '#ffffff', x: 540, y: 1520, w: 560, h: 120 },
    { t: 'text', text: 'RSVP', font: 'Montserrat', weight: 900, size: 50, color: '#5e17eb', x: 540, y: 1520, w: 500, spacing: 200 },
  ] },
  { id: 'thumb', name: 'Bold thumbnail', tag: 'YouTube thumbnail', w: 1280, h: 720, bg: { color: '#ffde59' }, items: [
    { t: 'shape', shape: 'circle', fill: '#1b1f23', x: 1010, y: 360, w: 560, h: 560 },
    { t: 'icon', name: 'zap', color: '#ffde59', x: 1010, y: 360, size: 300 },
    { t: 'text', text: 'I TRIED\nIT FOR\n30 DAYS', font: 'Anton', weight: 400, size: 150, color: '#1b1f23', x: 400, y: 360, w: 700, lh: 0.95, align: 'left', stroke: '#ffffff', sw: 10 },
    { t: 'shape', shape: 'arrow-right', fill: '#ff3131', x: 720, y: 600, w: 220, h: 130, angle: -20 },
  ] },
  { id: 'hiring', name: "We're hiring", tag: 'LinkedIn post', w: 1200, h: 1200, bg: { color: '#f5f7fa' }, items: [
    { t: 'shape', shape: 'quarter', fill: '#46e6a2', x: 1040, y: 160, w: 320, h: 320, angle: 90 },
    { t: 'shape', shape: 'circle', fill: '#3fd2ea', x: 140, y: 1080, w: 260, h: 260 },
    { t: 'text', text: "WE'RE", font: 'Poppins', weight: 600, size: 70, color: '#1b1f23', x: 420, y: 330, w: 640, align: 'left' },
    { t: 'text', text: 'HIRING', font: 'Poppins', weight: 800, size: 190, color: '#1b1f23', x: 540, y: 470, w: 880, align: 'left', lh: 1 },
    { t: 'text', text: '• Digital Marketing Manager\n• Content Designer\n• Data Analyst', font: 'Inter', weight: 400, size: 46, color: '#3d4249', x: 540, y: 720, w: 880, align: 'left', lh: 1.5 },
    { t: 'shape', shape: 'pill', fill: '#1b1f23', x: 380, y: 950, w: 400, h: 100 },
    { t: 'text', text: 'Apply today', font: 'Poppins', weight: 600, size: 40, color: '#ffffff', x: 380, y: 950, w: 380 },
    { t: 'text', text: 'careers.yourbrand.com', font: 'Inter', weight: 700, size: 32, color: '#7c8b98', x: 820, y: 950, w: 420, align: 'left' },
  ] },
  { id: 'quote', name: 'Quote', tag: 'Instagram post', w: 1080, h: 1080, bg: G('#0f2027', '#2c5364', 160), items: [
    { t: 'text', text: '“', font: 'Playfair Display', weight: 900, size: 360, color: '#5ef2ad', x: 540, y: 300, w: 300 },
    { t: 'text', text: 'Simplicity is the ultimate sophistication.', font: 'Playfair Display', weight: 700, size: 82, color: '#ffffff', x: 540, y: 560, w: 860, lh: 1.15 },
    { t: 'line', x: 540, y: 760, w: 120, lw: 5, color: '#5ef2ad' },
    { t: 'text', text: 'LEONARDO DA VINCI', font: 'Montserrat', weight: 700, size: 34, color: '#b9d3de', x: 540, y: 830, w: 800, spacing: 260 },
  ] },
  { id: 'launch', name: 'Product launch', tag: 'Facebook post', w: 1200, h: 630, bg: { color: '#0b0d0f' }, items: [
    { t: 'shape', shape: 'blob3', fill: { gradient: { type: 'linear', angle: 45, stops: [{ offset: 0, color: '#5ef2ad' }, { offset: 1, color: '#3fd2ea' }] } }, x: 930, y: 320, w: 520, h: 520 },
    { t: 'icon', name: 'rocket', color: '#0b0d0f', x: 930, y: 320, size: 220 },
    { t: 'text', text: 'NEW', font: 'Montserrat', weight: 900, size: 34, color: '#5ef2ad', x: 340, y: 170, w: 560, align: 'left', spacing: 400 },
    { t: 'text', text: 'Faster fiber,\nsame price.', font: 'Poppins', weight: 800, size: 84, color: '#ffffff', x: 340, y: 300, w: 560, align: 'left', lh: 1.05 },
    { t: 'text', text: 'Upgrade to 2 Gig today, free install.', font: 'Inter', weight: 400, size: 30, color: '#a9b3ba', x: 340, y: 450, w: 560, align: 'left' },
  ] },
  { id: 'poster', name: 'Minimal poster', tag: 'A4 portrait', w: 2480, h: 3508, bg: { color: '#f2ede4' }, items: [
    { t: 'shape', shape: 'circle', fill: '#ff914d', x: 1240, y: 1350, w: 1500, h: 1500 },
    { t: 'shape', shape: 'half-circle', fill: '#1b1f23', x: 1240, y: 1920, w: 1500, h: 750, angle: 180 },
    { t: 'text', text: 'GOLDEN HOUR', font: 'Bebas Neue', weight: 400, size: 380, color: '#1b1f23', x: 1240, y: 2700, w: 2200, spacing: 80 },
    { t: 'text', text: 'A photography exhibition · March 2027', font: 'DM Sans', weight: 400, size: 90, color: '#3d4249', x: 1240, y: 2980, w: 2100 },
  ] },
];

// Fabric objects for a template, sized for a page of w × h
export async function buildTemplate(tpl, W = tpl.w, H = tpl.h) {
  const k = Math.min(W / tpl.w, H / tpl.h), ox = (W - tpl.w * k) / 2, oy = (H - tpl.h * k) / 2;
  const out = [];
  for (const it of tpl.items) {
    let o;
    const fill = typeof it.fill === 'object' ? makeGradient(it.fill.gradient) : it.fill;
    if (it.t === 'shape') {
      const s = byId(it.shape);
      if (s.kind === 'rect') o = new fabric.Rect({ width: it.w * k, height: it.h * k, rx: Math.min((it.rx ?? s.rx) * k, (Math.min(it.w, it.h) * k) / 2), ry: Math.min((it.rx ?? s.rx) * k, (Math.min(it.w, it.h) * k) / 2), fill });
      else if (s.kind === 'circle') o = new fabric.Circle({ radius: (it.w * k) / 2, fill, scaleY: it.h / it.w });
      else { o = new fabric.Path(s.d, { fill, fillRule: s.evenodd ? 'evenodd' : 'nonzero' }); o.set({ scaleX: (it.w * k) / o.width, scaleY: (it.h * k) / o.height }); }
      o.set({ strokeWidth: 0, stroke: '#1b1f23', strokeUniform: true, ro2Shape: s.id, ro2Name: s.name });
      if (typeof it.fill === 'object') o.ro2Fill = it.fill.gradient;
    } else if (it.t === 'text') {
      await ensureFont(it.font, it.weight);
      o = new fabric.Textbox(it.text, { fontFamily: it.font, fontWeight: it.weight, fontSize: it.size * k, fill: it.color, width: it.w * k, textAlign: it.align || 'center', lineHeight: it.lh || 1.15, charSpacing: it.spacing || 0, ro2Name: 'Text' });
      if (it.stroke) o.set({ stroke: it.stroke, strokeWidth: it.sw * k, paintFirst: 'stroke', strokeLineJoin: 'round' });
      if (it.align === 'left') it.xLeft = true;
    } else if (it.t === 'line') {
      o = new Ro2Line({ width: it.w * k, lineWidth: it.lw * k, lineColor: it.color, ro2Name: 'Line' });
    } else if (it.t === 'icon') {
      const d = iconData(it.name);
      const { objects, options } = await fabric.loadSVGFromString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="${it.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d[0]}</svg>`);
      o = fabric.util.groupSVGElements(objects.filter(Boolean), options);
      const s = (it.size * k) / Math.max(o.width, o.height); o.set({ scaleX: s, scaleY: s, ro2Icon: it.name, ro2Name: it.name });
    }
    o.set({ left: ox + it.x * k, top: oy + it.y * k, angle: it.angle || 0 }); o.id = uid();
    out.push(o);
  }
  return out;
}
export function templateBg(tpl) { return tpl.bg; }
