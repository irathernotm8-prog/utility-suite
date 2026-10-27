# Draws build/icon.svg (the Utility Suite icon family: dark squircle tile, glowing gradient glyph) and renders build/icon.png.
# RO2: two of RO3's corner brackets around simple design shapes, with a sparkle for the AI tools.
# Run: python3 build/make-icon.py   (needs Playwright's Chromium for the PNG)
import math, os, subprocess, json
HERE = os.path.dirname(os.path.abspath(__file__))
def squircle(n=4.4, c=512, r=412, steps=720):
    pts = []
    for i in range(steps):
        t = i / steps * 2 * math.pi; x = math.cos(t); y = math.sin(t)
        pts.append((c + r * math.copysign(abs(x) ** (2 / n), x), c + r * math.copysign(abs(y) ** (2 / n), y)))
    return 'M' + ' L'.join(f'{x:.2f},{y:.2f}' for x, y in pts) + ' Z'
SQ = squircle()
glyph = '''
 <g filter="url(#gglow)">
  <path d="M292 486 V370 Q292 292 370 292 H486" stroke="url(#gm)" stroke-width="80" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <path d="M732 538 V654 Q732 732 654 732 H538" stroke="url(#gm)" stroke-width="80" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <rect x="404" y="452" width="190" height="190" rx="46" fill="url(#ga)"/>
  <circle cx="590" cy="438" r="92" fill="url(#gc)" fill-opacity="0.94"/>
  <path d="M712 248 C716 290 728 302 770 306 C728 310 716 322 712 364 C708 322 696 310 654 306 C696 302 708 290 712 248 Z" fill="#E9FFF6"/>
 </g>'''
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs>
  <linearGradient id="tile" x1="0.15" y1="0" x2="0.85" y2="1"><stop offset="0" stop-color="#173027"/><stop offset="0.55" stop-color="#0B1512"/><stop offset="1" stop-color="#050807"/></linearGradient>
  <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.07"/><stop offset="0.45" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <radialGradient id="glow" cx="0.5" cy="0.32" r="0.75"><stop offset="0" stop-color="#fff" stop-opacity="0.06"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  <clipPath id="clip"><path d="{SQ}"/></clipPath>
  <filter id="outer" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000" flood-opacity="0.22"/></filter>
  <filter id="gshadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#000" flood-opacity="0.5"/></filter>
  <linearGradient id="gm" gradientUnits="userSpaceOnUse" x1="0" y1="292" x2="0" y2="732"><stop offset="0" stop-color="#6FF5B8"/><stop offset="1" stop-color="#2FD68E"/></linearGradient>
  <linearGradient id="ga" gradientUnits="userSpaceOnUse" x1="404" y1="452" x2="594" y2="642"><stop offset="0" stop-color="#4FDDF0"/><stop offset="1" stop-color="#2E9CF2"/></linearGradient>
  <linearGradient id="gc" gradientUnits="userSpaceOnUse" x1="520" y1="350" x2="660" y2="530"><stop offset="0" stop-color="#8CFFCB"/><stop offset="1" stop-color="#3FE6A4"/></linearGradient>
  <filter id="gglow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="0" stdDeviation="24" flood-color="#46E6A2" flood-opacity="0.5"/></filter>
</defs>
<path d="{SQ}" fill="url(#tile)" filter="url(#outer)"/>
<g clip-path="url(#clip)">
  <rect width="1024" height="1024" fill="url(#glow)"/>
  <rect width="1024" height="1024" fill="url(#sheen)"/>
  <g filter="url(#gshadow)">{glyph}
  </g>
</g>
<path d="{SQ}" fill="none" stroke="#46E6A2" stroke-opacity="0.22" stroke-width="3" clip-path="url(#clip)"/>
</svg>
'''
open(os.path.join(HERE, 'icon.svg'), 'w').write(svg)
# the little mark in the title bar (no outer shadow)
mark = svg.replace('filter="url(#outer)"', '')
open(os.path.join(HERE, '..', 'src', 'renderer', 'img', 'mark.svg'), 'w').write(mark)
js = """const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
await p.goto('file://' + process.argv[2]); await p.screenshot({ path: process.argv[3], omitBackground: true }); await b.close(); })();"""
tmp = os.path.join(HERE, '.render.js'); open(tmp, 'w').write(js)
try:
    subprocess.run(['node', tmp, os.path.join(HERE, 'icon.svg'), os.path.join(HERE, 'icon.png')], check=True)
    print('icon written')
finally: os.remove(tmp)
