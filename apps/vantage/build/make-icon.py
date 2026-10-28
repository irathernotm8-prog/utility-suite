# NOTE: build/icon.png and icon.svg are now the Utility Suite globe icon (drawn in the Utility Package chat).
# Running this script for Vantage overwrites them with the old design; keep only its tray-icon output if you rerun it.
# Writes build/icon.svg (the Utility Suite icon family: dark tinted squircle, soft top sheen, a gradient glyph
# with a glow) and renders build/icon.png (1024px) plus the small tray glyphs. Needs: pip install resvg-py pillow
#   python3 build/make-icon.py            -> Vantage
#   python3 build/make-icon.py relay DIR  -> Relay's icon into DIR/build
import io, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
FAMILY = os.path.join(HERE, '..', '..', 'beam', 'build', 'icon.svg')   # borrow the shared squircle outline

def squircle():
    svg = open(FAMILY, encoding='utf-8').read()
    return re.search(r'<clipPath id="clip"><path d="([^"]+)"', svg).group(1)

def build(tile, rim, defs, glyph):
    d = squircle()
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs>
  <linearGradient id="tile" x1="0.15" y1="0" x2="0.85" y2="1"><stop offset="0" stop-color="{tile[0]}"/><stop offset="0.55" stop-color="{tile[1]}"/><stop offset="1" stop-color="{tile[2]}"/></linearGradient>
  <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.07"/><stop offset="0.45" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <radialGradient id="glow" cx="0.5" cy="0.32" r="0.75"><stop offset="0" stop-color="#fff" stop-opacity="0.06"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  <clipPath id="clip"><path d="{d}"/></clipPath>
  <filter id="outer" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000" flood-opacity="0.22"/></filter>
  <filter id="gshadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#000" flood-opacity="0.5"/></filter>
  {defs}
</defs>
<path d="{d}" fill="url(#tile)" filter="url(#outer)"/>
<g clip-path="url(#clip)">
  <rect width="1024" height="1024" fill="url(#glow)"/>
  <rect width="1024" height="1024" fill="url(#sheen)"/>
  <g filter="url(#gshadow)">{glyph}</g>
</g>
<path d="{d}" fill="none" stroke="{rim}" stroke-opacity="0.22" stroke-width="3" clip-path="url(#clip)"/>
</svg>
'''

# Vantage: a "V" — two panes meeting at a point — with the vantage point glowing above it
VANTAGE = dict(
  tile=('#0F2E36', '#08171D', '#03090C'), rim='#2FD3BD',
  defs='''<linearGradient id="vg" gradientUnits="userSpaceOnUse" x1="300" y1="300" x2="720" y2="720"><stop offset="0" stop-color="#3BF0D2"/><stop offset="0.55" stop-color="#2FB8F0"/><stop offset="1" stop-color="#5A7CFF"/></linearGradient>
  <linearGradient id="vg2" gradientUnits="userSpaceOnUse" x1="512" y1="330" x2="740" y2="700"><stop offset="0" stop-color="#7FF7E3"/><stop offset="1" stop-color="#4F8CFF"/></linearGradient>
  <radialGradient id="dot" cx="0.5" cy="0.45" r="0.6"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.6" stop-color="#C9FFF6"/><stop offset="1" stop-color="#5CE8D2"/></radialGradient>
  <filter id="vglow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="0" stdDeviation="24" flood-color="#2FD3BD" flood-opacity="0.55"/></filter>
  <filter id="dglow" x="-100%" y="-100%" width="300%" height="300%"><feDropShadow dx="0" dy="0" stdDeviation="18" flood-color="#7FF7E3" flood-opacity="0.9"/></filter>''',
  glyph='''<g filter="url(#vglow)">
    <path d="M318 388 L470 690 Q512 770 554 690 L590 618" stroke="url(#vg)" stroke-width="104" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <path d="M626 548 L706 388" stroke="url(#vg2)" stroke-width="104" stroke-linecap="round" fill="none"/>
  </g>
  <circle cx="512" cy="330" r="50" fill="url(#dot)" filter="url(#dglow)"/>''')

# Relay: a mail card and a chat bubble behind it (inboxes and chats in one place)
RELAY = dict(
  tile=('#2A2147', '#141022', '#09070F'), rim='#9A74FF',
  defs='''<linearGradient id="rp" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6F63FF"/><stop offset="0.52" stop-color="#9A74FF"/><stop offset="1" stop-color="#E27BD0"/></linearGradient>
  <filter id="rglow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="0" stdDeviation="24" flood-color="#9A74FF" flood-opacity="0.5"/></filter>''',
  glyph='''<g filter="url(#rglow)">
    <path d="M300 300 h300 a72 72 0 0 1 72 72 v150 a72 72 0 0 1 -72 72 h-150 l-96 72 v-72 h-54 a72 72 0 0 1 -72 -72 v-150 a72 72 0 0 1 72 -72 z" fill="url(#rp)" opacity="0.38" transform="rotate(-8 450 450)"/>
    <rect x="352" y="420" width="420" height="300" rx="70" fill="url(#rp)"/>
    <path d="M392 470 L562 590 L732 470" stroke="#140F24" stroke-opacity="0.55" stroke-width="34" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </g>
  <circle cx="730" cy="436" r="58" fill="#fff"/>
  <path d="M706 436 h48 M734 414 l22 22 -22 22" stroke="url(#rp)" stroke-width="20" stroke-linecap="round" stroke-linejoin="round" fill="none"/>''')

def render(svg, out_dir, tray_color):
    import resvg_py
    from PIL import Image
    open(os.path.join(out_dir, 'icon.svg'), 'w', encoding='utf-8').write(svg)
    png = bytes(resvg_py.svg_to_bytes(svg_string=svg))
    Image.open(io.BytesIO(png)).convert('RGBA').resize((1024, 1024), Image.LANCZOS).save(os.path.join(out_dir, 'icon.png'))
    if tray_color:
        # tray / menu bar: the glyph alone, as a template image
        tray_svg = re.sub(r'<path d="[^"]+" fill="url\(#tile\)"[^>]*/>', '', svg)
        tray_svg = re.sub(r'<rect width="1024" height="1024" fill="url\(#(glow|sheen)\)"/>', '', tray_svg)
        tray_svg = re.sub(r'<path d="[^"]+" fill="none" stroke="[^"]+"[^>]*/>\s*</svg>', '</svg>', tray_svg)
        big = Image.open(io.BytesIO(bytes(resvg_py.svg_to_bytes(svg_string=tray_svg)))).convert('RGBA')
        a = big.getchannel('A').point(lambda v: 255 if v > 90 else int(v * 2.8))
        for name, px, col in (('trayTemplate.png', 16, (0, 0, 0)), ('trayTemplate@2x.png', 32, (0, 0, 0)), ('tray.png', 32, tray_color)):
            m = a.crop((150, 150, 874, 874)).resize((px, px), Image.LANCZOS)
            o = Image.new('RGBA', (px, px), col + (0,)); o.putalpha(m); o.save(os.path.join(out_dir, name))

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'relay':
        out = os.path.join(sys.argv[2], 'build') if len(sys.argv) > 2 else HERE
        render(build(**RELAY), out, None)
    else:
        render(build(**VANTAGE), HERE, (90, 220, 200))
    print('icon written')
