# NOTE: build/icon.png is now drawn from build/icon.svg (the Utility Suite icon family). Running this script
# overwrites icon.png with the old design; keep only its tray-icon output if you rerun it.
# Regenerates build/icon.png and the tray icons in src/assets (run: python3 build/make-icon.py). Needs Pillow.
# A cream note card on warm charcoal: a coral-to-amber waveform at the top turns into lines of ink and a ticked to-do.
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import math, os
HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, '..', 'src', 'assets')
S = 4; N = 1024 * S

def squircle(size, inset, n=4.4):
    m = Image.new('L', (size, size), 0); r = (size - 2 * inset) / 2; c = size / 2; pts = []
    for i in range(720):
        t = i / 720 * 2 * math.pi; x = math.cos(t); y = math.sin(t)
        pts.append((c + r * math.copysign(abs(x) ** (2 / n), x), c + r * math.copysign(abs(y) ** (2 / n), y)))
    ImageDraw.Draw(m).polygon(pts, fill=255); return m

def lin(size, c0, c1, angle=0):
    g = Image.linear_gradient('L').rotate(angle, expand=False).resize(size)
    return Image.merge('RGB', [g.point(lambda v, a=a, b=b: int(a + (b - a) * v / 255)) for a, b in zip(c0, c1)]).convert('RGBA')

def P(v): return v * N / 1024

mask = squircle(N, int(N * 0.085))
bg = lin((N, N), (46, 33, 25), (14, 11, 9))
glow = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ImageDraw.Draw(glow).ellipse((P(-120), P(-560), P(1144), P(420)), fill=(255, 140, 80, 46))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(P(70))))

# card
card_box = (P(226), P(190), P(798), P(834))
cm = Image.new('L', (N, N), 0); ImageDraw.Draw(cm).rounded_rectangle(card_box, radius=P(70), fill=255)
shadow = Image.new('RGBA', (N, N), (0, 0, 0, 0)); shadow.paste((0, 0, 0, 170), mask=cm)
shadow = ImageChops.offset(shadow.filter(ImageFilter.GaussianBlur(P(26))), 0, int(P(22)))
paper = lin((N, N), (252, 246, 236), (236, 224, 205), -90)
card = Image.new('RGBA', (N, N), (0, 0, 0, 0)); card.paste(paper, mask=cm)

warm = lin((N, N), (255, 112, 84), (255, 196, 92), -20)
# waveform
wave = Image.new('L', (N, N), 0); wd = ImageDraw.Draw(wave)
heights = [70, 136, 214, 276, 196, 128, 84, 46]
w = 40; gap = 22; x0 = 512 - (len(heights) * w + (len(heights) - 1) * gap) / 2; cy = 370
for i, hgt in enumerate(heights):
    x = x0 + i * (w + gap)
    wd.rounded_rectangle((P(x), P(cy - hgt / 2), P(x + w), P(cy + hgt / 2)), radius=P(w / 2), fill=255)
wavel = Image.new('RGBA', (N, N), (0, 0, 0, 0)); wavel.paste(warm, mask=wave)

# ink lines
ink = Image.new('RGBA', (N, N), (0, 0, 0, 0)); idr = ImageDraw.Draw(ink)
INK = (58, 44, 34, 235)
idr.rounded_rectangle((P(300), P(548), P(724), P(580)), radius=P(16), fill=INK)
idr.rounded_rectangle((P(300), P(620), P(632), P(652)), radius=P(16), fill=(58, 44, 34, 150))
# ticked to-do
box = Image.new('L', (N, N), 0); ImageDraw.Draw(box).rounded_rectangle((P(300), P(700), P(366), P(766)), radius=P(18), fill=255)
boxl = Image.new('RGBA', (N, N), (0, 0, 0, 0)); boxl.paste(warm, mask=box)
ck = ImageDraw.Draw(boxl)
ck.line([(P(316), P(734)), (P(330), P(749)), (P(352), P(718))], fill=(255, 255, 255, 255), width=int(P(11)), joint='curve')
for p in [(316, 734), (352, 718)]:
    ck.ellipse((P(p[0]) - P(5.5), P(p[1]) - P(5.5), P(p[0]) + P(5.5), P(p[1]) + P(5.5)), fill=(255, 255, 255, 255))
idr.rounded_rectangle((P(396), P(717), P(664), P(749)), radius=P(16), fill=(58, 44, 34, 110))

out = bg
for layer in (shadow, card, wavel, ink, boxl): out = Image.alpha_composite(out, layer)
rim = ImageChops.subtract(mask, mask.filter(ImageFilter.MinFilter(int(N * .004) * 2 + 1)))
out.putalpha(mask)
rl = Image.new('RGBA', (N, N), (255, 255, 255, 30)); rl.putalpha(rim.point(lambda v: v * 34 // 255)); out = Image.alpha_composite(out, rl)
out.resize((1024, 1024), Image.LANCZOS).save(os.path.join(HERE, 'icon.png'))

# ---- tray icons: a waveform (template = black + alpha for the macOS menu bar), with a dot while recording
os.makedirs(ASSETS, exist_ok=True)
def tray(px, rec, color=None, bgc=None):
    k = 8; M = px * k; im = Image.new('RGBA', (M, M), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    if bgc:
        d.rounded_rectangle((0, 0, M - 1, M - 1), radius=M * 0.26, fill=bgc)
    hs = [0.30, 0.62, 0.92, 0.56, 0.34] if not bgc else [0.26, 0.5, 0.72, 0.46, 0.28]
    bw = M * (0.12 if not bgc else 0.1); gp = M * (0.075 if not bgc else 0.06)
    total = len(hs) * bw + (len(hs) - 1) * gp
    xs = (M - total) / 2 - (M * 0.06 if rec and not bgc else 0)
    for i, hh in enumerate(hs):
        x = xs + i * (bw + gp); hgt = M * hh * (0.82 if not bgc else 1)
        d.rounded_rectangle((x, M / 2 - hgt / 2, x + bw, M / 2 + hgt / 2), radius=bw / 2, fill=color or (0, 0, 0, 255))
    if rec:
        r = M * 0.15; cx = M - r - M * 0.02; cy = r + M * 0.02
        if not bgc:
            d.ellipse((cx - r - M * 0.05, cy - r - M * 0.05, cx + r + M * 0.05, cy + r + M * 0.05), fill=(0, 0, 0, 0))
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(255, 70, 60, 255) if bgc else (0, 0, 0, 255))
    return im.resize((px, px), Image.LANCZOS)
for rec, name in ((False, 'trayTemplate'), (True, 'trayRecTemplate')):
    tray(16, rec).save(os.path.join(ASSETS, name + '.png')); tray(32, rec).save(os.path.join(ASSETS, name + '@2x.png'))
tray(32, False, (255, 255, 255, 255), (238, 104, 64, 255)).save(os.path.join(ASSETS, 'tray.png'))
tray(32, True, (255, 255, 255, 255), (238, 104, 64, 255)).save(os.path.join(ASSETS, 'tray-rec.png'))
print('icons written')
