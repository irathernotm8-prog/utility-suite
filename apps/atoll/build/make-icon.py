# Regenerates build/icon.png, build/tray.png and build/trayTemplate*.png (run: python3 build/make-icon.py). Needs Pillow.
# A deep graphite tile with a black island capsule ringed in iridescent light (teal, blue, violet, pink): album art
# on the left, a little equaliser on the right, the glow pooling below like light on a lagoon.
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import math, os
HERE = os.path.dirname(os.path.abspath(__file__))
S = 4; N = 1024 * S

def P(v): return int(round(v * N / 1024))

def squircle(size, inset, n=4.4):
    m = Image.new('L', (size, size), 0); r = (size - 2 * inset) / 2; c = size / 2; pts = []
    for i in range(720):
        t = i / 720 * 2 * math.pi; x = math.cos(t); y = math.sin(t)
        pts.append((c + r * math.copysign(abs(x) ** (2 / n), x), c + r * math.copysign(abs(y) ** (2 / n), y)))
    ImageDraw.Draw(m).polygon(pts, fill=255); return m

def lin(size, c0, c1, angle=0):
    g = Image.linear_gradient('L').rotate(angle, expand=False).resize(size)
    return Image.merge('RGB', [g.point(lambda v, a=a, b=b: int(a + (b - a) * v / 255)) for a, b in zip(c0, c1)]).convert('RGBA')

STOPS = [(0.00, (94, 240, 208)), (0.30, (79, 163, 255)), (0.58, (165, 139, 255)), (0.82, (255, 143, 179)), (1.00, (255, 186, 120))]
def iri(t):
    t = max(0.0, min(1.0, t))
    for (a, ca), (b, cb) in zip(STOPS, STOPS[1:]):
        if t <= b:
            k = (t - a) / (b - a)
            return tuple(int(ca[i] + (cb[i] - ca[i]) * k) for i in range(3))
    return STOPS[-1][1]

def iri_layer():
    # horizontal iridescent sweep across the capsule, computed at low res then scaled
    w = 512; strip = Image.new('RGB', (w, 1))
    for x in range(w): strip.putpixel((x, 0), iri(x / (w - 1)))
    return strip.resize((N, N)).convert('RGBA')

mask = squircle(N, int(N * 0.085))
bg = lin((N, N), (24, 24, 34), (6, 6, 9), 0)
halo = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ImageDraw.Draw(halo).ellipse((P(120), P(380), P(904), P(980)), fill=(110, 110, 255, 70))
bg = Image.alpha_composite(bg, halo.filter(ImageFilter.GaussianBlur(P(110))))

# capsule
cx0, cy0, cx1, cy1 = 150, 352, 874, 598
R = (cy1 - cy0) / 2
cap = Image.new('L', (N, N), 0); ImageDraw.Draw(cap).rounded_rectangle((P(cx0), P(cy0), P(cx1), P(cy1)), radius=P(R), fill=255)
ring_outer = Image.new('L', (N, N), 0); ImageDraw.Draw(ring_outer).rounded_rectangle((P(cx0 - 9), P(cy0 - 9), P(cx1 + 9), P(cy1 + 9)), radius=P(R + 9), fill=255)
rim = ImageChops.subtract(ring_outer, cap)
col = iri_layer()

# soft iridescent glow (wide) + tighter glow + crisp rim
for blur, alpha, grow in [(70, 150, 40), (26, 190, 14)]:
    g = Image.new('L', (N, N), 0); ImageDraw.Draw(g).rounded_rectangle((P(cx0 - grow), P(cy0 - grow), P(cx1 + grow), P(cy1 + grow)), radius=P(R + grow), fill=255)
    g = ImageChops.subtract(g, cap).filter(ImageFilter.GaussianBlur(P(blur)))
    lay = col.copy(); lay.putalpha(g.point(lambda v, a=alpha: v * a // 255)); bg = Image.alpha_composite(bg, lay)
lay = col.copy(); lay.putalpha(rim); bg = Image.alpha_composite(bg, lay)

black = Image.new('RGBA', (N, N), (0, 0, 0, 255)); blk = Image.new('RGBA', (N, N), (0, 0, 0, 0)); blk.paste(black, mask=cap)
# a faint inner top sheen on the capsule
sh = Image.new('L', (N, N), 0); ImageDraw.Draw(sh).rounded_rectangle((P(cx0 + 30), P(cy0 + 8), P(cx1 - 30), P(cy0 + 80)), radius=P(40), fill=255)
sh = ImageChops.multiply(sh.filter(ImageFilter.GaussianBlur(P(20))), cap)
bg = Image.alpha_composite(bg, blk)
shl = Image.new('RGBA', (N, N), (255, 255, 255, 0)); shl.putalpha(sh.point(lambda v: v * 22 // 255)); bg = Image.alpha_composite(bg, shl)

# album art tile
ax0, ay0 = cx0 + 62, cy0 + 58; asz = (cy1 - cy0) - 116
am = Image.new('L', (N, N), 0); ImageDraw.Draw(am).rounded_rectangle((P(ax0), P(ay0), P(ax0 + asz), P(ay0 + asz)), radius=P(30), fill=255)
art = lin((N, N), (255, 120, 160), (140, 110, 255), -45); al = Image.new('RGBA', (N, N), (0, 0, 0, 0)); al.paste(art, mask=am)
ag = Image.new('RGBA', (N, N), (0, 0, 0, 0)); ag.paste((255, 110, 170, 120), mask=am); ag = ag.filter(ImageFilter.GaussianBlur(P(22)))
bg = Image.alpha_composite(bg, ag); bg = Image.alpha_composite(bg, al)
hl = Image.new('L', (N, N), 0); ImageDraw.Draw(hl).ellipse((P(ax0 - 40), P(ay0 - 60), P(ax0 + asz * .8), P(ay0 + asz * .45)), fill=255)
hl = ImageChops.multiply(hl.filter(ImageFilter.GaussianBlur(P(18))), am)
hll = Image.new('RGBA', (N, N), (255, 255, 255, 0)); hll.putalpha(hl.point(lambda v: v * 70 // 255)); bg = Image.alpha_composite(bg, hll)

# equaliser bars, iridescent
bars = [0.42, 0.86, 0.58, 1.0, 0.66]
bw, gap = 26, 22; total = len(bars) * bw + (len(bars) - 1) * gap
bx = cx1 - 80 - total; mid = (cy0 + cy1) / 2; hmax = (cy1 - cy0) - 112
bm = Image.new('L', (N, N), 0); d = ImageDraw.Draw(bm)
for i, h in enumerate(bars):
    x = bx + i * (bw + gap); hh = hmax * h
    d.rounded_rectangle((P(x), P(mid - hh / 2), P(x + bw), P(mid + hh / 2)), radius=P(bw / 2), fill=255)
bc = lin((N, N), (94, 240, 208), (255, 143, 179), -90)
bl = Image.new('RGBA', (N, N), (0, 0, 0, 0)); bl.paste(bc, mask=bm)
bgw = Image.new('RGBA', (N, N), (0, 0, 0, 0)); bgw.paste(bc, mask=bm); bgw.putalpha(bm.filter(ImageFilter.GaussianBlur(P(16))).point(lambda v: v * 120 // 255))
bg = Image.alpha_composite(bg, bgw); bg = Image.alpha_composite(bg, bl)

# reflection of the light on the "water" below
refl = Image.new('L', (N, N), 0); ImageDraw.Draw(refl).ellipse((P(260), P(690), P(764), P(760)), fill=255)
rl = col.copy(); rl.putalpha(refl.filter(ImageFilter.GaussianBlur(P(28))).point(lambda v: v * 70 // 255)); bg = Image.alpha_composite(bg, rl)

sheen = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ImageDraw.Draw(sheen).ellipse((P(-200), P(-640), P(1224), P(260)), fill=(255, 255, 255, 10))
bg = Image.alpha_composite(bg, sheen.filter(ImageFilter.GaussianBlur(P(30))))
out = bg.copy(); out.putalpha(mask)
edge = ImageChops.subtract(mask, mask.filter(ImageFilter.MinFilter(int(N * .004) * 2 + 1)))
el = Image.new('RGBA', (N, N), (200, 200, 255, 255)); el.putalpha(edge.point(lambda v: v * 40 // 255)); out = Image.alpha_composite(out, el)
out.resize((1024, 1024), Image.LANCZOS).save(os.path.join(HERE, 'icon.png'))

# menu bar (template) and tray icons: a capsule with a dot and two bars
def glyph(px, color):
    T = px * 8; im = Image.new('L', (T, T), 0); d = ImageDraw.Draw(im)
    d.rounded_rectangle((T * .04, T * .28, T * .96, T * .72), radius=T * .22, fill=255)
    d.rounded_rectangle((T * .16, T * .39, T * .38, T * .61), radius=T * .06, fill=0)
    for i, h in enumerate([.12, .2, .14]):
        x = T * (.58 + i * .1); d.rounded_rectangle((x, T * (.5 - h / 2), x + T * .055, T * (.5 + h / 2)), radius=T * .03, fill=0)
    a = im.resize((px, px), Image.LANCZOS)
    o = Image.new('RGBA', (px, px), color + (0,)); o.putalpha(a); return o
glyph(16, (0, 0, 0)).save(os.path.join(HERE, 'trayTemplate.png'))
glyph(32, (0, 0, 0)).save(os.path.join(HERE, 'trayTemplate@2x.png'))
# Windows tray: the app icon, small
Image.open(os.path.join(HERE, 'icon.png')).resize((32, 32), Image.LANCZOS).save(os.path.join(HERE, 'tray.png'))
print('icon written')
