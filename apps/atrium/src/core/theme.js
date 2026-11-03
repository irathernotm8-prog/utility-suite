// Atrium — a site's theme (colours, fonts, shape, density) → CSS custom properties, the Google Fonts link,
// colour maths for contrast checks, and a palette generator from one brand colour.
'use strict';
const { PRESETS, FONTS } = require('./presets');

const DEFAULT_THEME = {
  preset: 'midnight', mode: 'dark',
  colors: { bg: '#0b0d14', surface: '#131726', surface2: '#0f1220', text: '#eef1fb', muted: '#9aa3bd', primary: '#7c8cff', primaryText: '#0b0d14', accent: '#38d6e8', border: '#232a40' },
  fonts: { heading: 'Inter', body: 'Inter', headingWeight: 700 },
  radius: 16, buttonShape: 'pill', density: 'comfortable', maxWidth: 1200, shadow: 'soft', headingTracking: -0.02,
};

function presetTheme(id) {
  const p = PRESETS.find((x) => x.id === id) || PRESETS[0];
  if (!p) return JSON.parse(JSON.stringify(DEFAULT_THEME));
  const { name, description, ...rest } = p;
  return normalizeTheme({ ...JSON.parse(JSON.stringify(rest)), preset: p.id });
}

function normalizeTheme(t) {
  const d = DEFAULT_THEME; t = t || {};
  return {
    ...d, ...t,
    colors: { ...d.colors, ...(t.colors || {}) },
    fonts: { ...d.fonts, ...(t.fonts || {}) },
  };
}

const fontInfo = (name) => FONTS.find((f) => f.name.toLowerCase() === String(name || '').toLowerCase());
function fontStack(name) {
  const f = fontInfo(name);
  if (!f) return `"${name}", system-ui, -apple-system, "Segoe UI", sans-serif`;
  if (f.google === false) return f.fallback || 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  return `"${f.name}", ${f.fallback || 'system-ui, sans-serif'}`;
}
function googleFontsHref(theme) {
  const want = [...new Set([theme.fonts.heading, theme.fonts.body].filter(Boolean))].map(fontInfo).filter((f) => f && f.google !== false);
  if (!want.length) return null;
  const fam = want.map((f) => { const w = (f.weights && f.weights.length ? f.weights : [400, 700]).slice().sort((a, b) => a - b); return `family=${encodeURIComponent(f.name).replace(/%20/g, '+')}:wght@${w.join(';')}`; });
  return `https://fonts.googleapis.com/css2?${fam.join('&')}&display=swap`;
}

// colour helpers
function hexToRgb(h) { let s = String(h || '').trim().replace('#', ''); if (s.length === 3) s = s.split('').map((c) => c + c).join(''); const n = parseInt(s.slice(0, 6), 16); if (Number.isNaN(n)) return [0, 0, 0]; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
const rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
function luminance(hex) { const [r, g, b] = hexToRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
function contrast(a, b) { const la = luminance(a), lb = luminance(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
function rgbToHsl(r, g, b) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2; if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; } return [h, s, l]; }
function hslToHex(h, s, l) { h = ((h % 360) + 360) % 360; const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2; let [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]; return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255); }
const readableOn = (bg) => (contrast(bg, '#ffffff') >= contrast(bg, '#0b0d14') ? '#ffffff' : '#0b0d14');

// a full palette from one brand colour (and light/dark)
function paletteFrom(primary, mode = 'dark', accentShift = 48) {
  const [h, s] = rgbToHsl(...hexToRgb(primary)); const sat = Math.min(0.9, Math.max(0.35, s));
  const accent = hslToHex(h + accentShift, sat, mode === 'dark' ? 0.62 : 0.5);
  if (mode === 'dark') return { bg: hslToHex(h, 0.28, 0.055), surface: hslToHex(h, 0.24, 0.095), surface2: hslToHex(h, 0.26, 0.075), text: hslToHex(h, 0.25, 0.95), muted: hslToHex(h, 0.12, 0.66), primary, primaryText: readableOn(primary), accent, border: hslToHex(h, 0.22, 0.17) };
  return { bg: hslToHex(h, 0.3, 0.985), surface: '#ffffff', surface2: hslToHex(h, 0.32, 0.955), text: hslToHex(h, 0.3, 0.1), muted: hslToHex(h, 0.1, 0.42), primary, primaryText: readableOn(primary), accent, border: hslToHex(h, 0.2, 0.89) };
}

function themeVars(theme) {
  const t = normalizeTheme(theme); const c = t.colors;
  const btn = t.buttonShape === 'pill' ? '999px' : t.buttonShape === 'square' ? '0px' : Math.max(6, Math.round(t.radius * 0.6)) + 'px';
  const pad = t.density === 'compact' ? 'clamp(48px, 7vw, 88px)' : t.density === 'airy' ? 'clamp(88px, 12vw, 168px)' : 'clamp(64px, 9vw, 128px)';
  const gap = t.density === 'compact' ? '18px' : t.density === 'airy' ? '32px' : '24px';
  const dark = t.mode === 'dark';
  const sh = t.shadow === 'none' ? ['none', 'none']
    : t.shadow === 'deep' ? [dark ? '0 18px 50px rgba(0,0,0,.55)' : '0 18px 50px rgba(15,20,40,.16)', dark ? '0 40px 120px rgba(0,0,0,.65)' : '0 40px 110px rgba(15,20,40,.24)']
      : [dark ? '0 10px 30px rgba(0,0,0,.35)' : '0 8px 28px rgba(15,20,40,.08)', dark ? '0 30px 90px rgba(0,0,0,.5)' : '0 30px 80px rgba(15,20,40,.16)'];
  const v = {
    '--at-bg': c.bg, '--at-surface': c.surface, '--at-surface-2': c.surface2, '--at-text': c.text, '--at-muted': c.muted,
    '--at-primary': c.primary, '--at-primary-text': c.primaryText, '--at-accent': c.accent, '--at-border': c.border,
    '--at-grad': `linear-gradient(120deg, ${c.primary} 0%, ${c.accent} 100%)`,
    '--at-radius': t.radius + 'px', '--at-radius-sm': Math.max(4, Math.round(t.radius * 0.55)) + 'px', '--at-btn-radius': btn,
    '--at-font-h': fontStack(t.fonts.heading), '--at-font-b': fontStack(t.fonts.body), '--at-h-weight': String(t.fonts.headingWeight || 700),
    '--at-h-track': (t.headingTracking ?? -0.02) + 'em', '--at-max': (t.maxWidth || 1200) + 'px', '--at-pad': pad, '--at-gap': gap,
    '--at-shadow': sh[0], '--at-shadow-lg': sh[1],
  };
  return `:root{${Object.entries(v).map(([k, x]) => `${k}:${x}`).join(';')};color-scheme:${dark ? 'dark' : 'light'}}`;
}

// contrast report for the theme's main pairs (used by audits and the theme panel)
function themeChecks(theme) {
  const c = normalizeTheme(theme).colors; const pairs = [['text', 'bg', 4.5], ['muted', 'bg', 4.5], ['text', 'surface', 4.5], ['muted', 'surface', 4.5], ['primaryText', 'primary', 4.5], ['primary', 'bg', 3]];
  return pairs.map(([a, b, min]) => { const r = contrast(c[a], c[b]); return { pair: `${a} on ${b}`, ratio: Math.round(r * 100) / 100, min, ok: r >= min }; });
}

module.exports = { DEFAULT_THEME, presetTheme, normalizeTheme, themeVars, googleFontsHref, fontStack, fontInfo, contrast, luminance, hexToRgb, rgbToHex, paletteFrom, themeChecks, readableOn };
