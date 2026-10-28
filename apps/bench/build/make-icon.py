# Regenerates build/icon.png and the tray icons (run: python3 build/make-icon.py). Needs Pillow.
# A deep graphite-plum tile with a soft coral-pink glow: a desktop window whose screen glows coral → pink → violet,
# with a little app inside, and a white pointer (Claude at work) clicking on it with a spark.
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import math, os
HERE = os.path.dirname(os.path.abspath(__file__))
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

def grad3(size, c0, c1, c2, angle=-45):
    g = Image.linear_gradient('L').rotate(angle, expand=False).resize(size)
    def ch(i):
        return g.point(lambda v, i=i: int(c0[i] + (c1[i] - c0[i]) * (v / 127.5)) if v < 128 else int(c1[i] + (c2[i] - c1[i]) * ((v - 128) / 127)))
    return Image.merge('RGB', [ch(0), ch(1), ch(2)]).convert('RGBA')

def P(v): return v * N / 1024

def grow(m, r):
    # fast dilation: blur, then threshold (MaxFilter is far too slow at this size)
    return m.filter(ImageFilter.GaussianBlur(r / 2)).point(lambda v: 255 if v > 24 else int(v * 255 / 24))

mask = squircle(N, int(N * 0.085))
bg = lin((N, N), (34, 24, 42), (10, 9, 14), 0)
glow = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ImageDraw.Draw(glow).ellipse((P(150), P(360), P(880), P(1010)), fill=(255, 95, 168, 74))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(P(115))))
top = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ImageDraw.Draw(top).ellipse((P(330), P(-170), P(1040), P(360)), fill=(169, 120, 255, 30))
bg = Image.alpha_composite(bg, top.filter(ImageFilter.GaussianBlur(P(95))))

# the desktop window
x0, y0, x1, y1 = 188, 250, 836, 728
win_m = Image.new('L', (N, N), 0); ImageDraw.Draw(win_m).rounded_rectangle((P(x0), P(y0), P(x1), P(y1)), radius=P(54), fill=255)
shadow = Image.new('RGBA', (N, N), (0, 0, 0, 0)); shadow.paste((0, 0, 0, 175), mask=win_m)
shadow = ImageChops.offset(shadow, 0, int(P(28))).filter(ImageFilter.GaussianBlur(P(38)))
body = lin((N, N), (58, 52, 70), (24, 22, 30), -60)
W = Image.new('RGBA', (N, N), (0, 0, 0, 0)); W.paste(body, mask=win_m)
d = ImageDraw.Draw(W)
# title bar lights
for i, col in enumerate([(255, 95, 87), (254, 188, 46), (40, 200, 64)]):
    cx = x0 + 54 + i * 40; cy = y0 + 44
    d.ellipse((P(cx - 12), P(cy - 12), P(cx + 12), P(cy + 12)), fill=col + (255,))
# screen
sx0, sy0, sx1, sy1 = x0 + 30, y0 + 86, x1 - 30, y1 - 30
scr_m = Image.new('L', (N, N), 0); ImageDraw.Draw(scr_m).rounded_rectangle((P(sx0), P(sy0), P(sx1), P(sy1)), radius=P(30), fill=255)
scr = grad3((N, N), (255, 143, 107), (255, 95, 168), (169, 120, 255), -40)
W.paste(scr, mask=scr_m)
# a little app on the screen: sidebar + cards (drawn on their own layer so they blend with the glow)
ui_l = Image.new('RGBA', (N, N), (0, 0, 0, 0)); d = ImageDraw.Draw(ui_l)
d.rounded_rectangle((P(sx0 + 30), P(sy0 + 30), P(sx0 + 150), P(sy1 - 30)), radius=P(18), fill=(255, 255, 255, 64))
for r in range(3):
    d.rounded_rectangle((P(sx0 + 48), P(sy0 + 56 + r * 46), P(sx0 + 132), P(sy0 + 76 + r * 46)), radius=P(10), fill=(255, 255, 255, 235 if r == 0 else 130))
d.rounded_rectangle((P(sx0 + 180), P(sy0 + 30), P(sx1 - 30), P(sy0 + 128)), radius=P(20), fill=(255, 255, 255, 235))
d.rounded_rectangle((P(sx0 + 180), P(sy0 + 152), P(sx0 + 330), P(sy1 - 30)), radius=P(20), fill=(255, 255, 255, 96))
d.rounded_rectangle((P(sx0 + 352), P(sy0 + 152), P(sx1 - 30), P(sy1 - 30)), radius=P(20), fill=(255, 255, 255, 96))
W = Image.alpha_composite(W, ui_l)
edge = ImageChops.subtract(win_m, win_m.filter(ImageFilter.MinFilter(int(P(6)) | 1)))
hl = Image.new('RGBA', (N, N), (255, 255, 255, 0)); hl.putalpha(edge.point(lambda v: v * 60 // 255)); W = Image.alpha_composite(W, hl)

# pointer + click ring + spark
px, py = 600, 560
ring = Image.new('RGBA', (N, N), (0, 0, 0, 0)); rd = ImageDraw.Draw(ring)
rd.ellipse((P(px - 74), P(py - 74), P(px + 74), P(py + 74)), outline=(255, 255, 255, 150), width=int(P(12)))
ring = ring.filter(ImageFilter.GaussianBlur(P(2)))
ptr = [(0, 0), (0, 250), (62, 194), (106, 290), (152, 270), (108, 176), (190, 176)]
ptr = [(px + x * 0.92, py + y * 0.92) for x, y in ptr]
pm = Image.new('L', (N, N), 0); ImageDraw.Draw(pm).polygon([(P(x), P(y)) for x, y in ptr], fill=255)
pm_out = grow(pm, P(22))
psh = Image.new('RGBA', (N, N), (0, 0, 0, 0)); psh.paste((20, 6, 18, 190), mask=pm_out)
psh = ImageChops.offset(psh, int(P(8)), int(P(18))).filter(ImageFilter.GaussianBlur(P(18)))
pout = Image.new('RGBA', (N, N), (0, 0, 0, 0)); pout.paste((233, 56, 140, 255), mask=pm_out)
pin = Image.new('RGBA', (N, N), (0, 0, 0, 0)); pin.paste((255, 255, 255, 255), mask=pm)
def spark(cx, cy, r, col):
    L = Image.new('RGBA', (N, N), (0, 0, 0, 0)); pts = []
    for i in range(8):
        a = i * math.pi / 4 - math.pi / 2; rr = r if i % 2 == 0 else r * 0.3
        pts.append((P(cx + math.cos(a) * rr), P(cy + math.sin(a) * rr)))
    ImageDraw.Draw(L).polygon(pts, fill=col); return L
sp = spark(800, 206, 80, (255, 255, 255, 255))
spg = Image.new('RGBA', (N, N), (0, 0, 0, 0)); spg.paste((255, 120, 190, 150), mask=grow(sp.getchannel('A'), P(30)))
spg = spg.filter(ImageFilter.GaussianBlur(P(30)))
sp2 = spark(872, 318, 32, (255, 214, 236, 235))

out = bg
for L in (shadow, W, ring, psh, pout, pin, spg, sp, sp2): out = Image.alpha_composite(out, L)
sheen = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ImageDraw.Draw(sheen).ellipse((P(-200), P(-640), P(1224), P(300)), fill=(255, 255, 255, 12))
out = Image.alpha_composite(out, sheen.filter(ImageFilter.GaussianBlur(P(30))))
rim = ImageChops.subtract(mask, mask.filter(ImageFilter.MinFilter(int(N * .004) * 2 + 1)))
out.putalpha(mask)
rl = Image.new('RGBA', (N, N), (255, 220, 240, 255)); rl.putalpha(rim.point(lambda v: v * 46 // 255)); out = Image.alpha_composite(out, rl)
out.resize((1024, 1024), Image.LANCZOS).save(os.path.join(HERE, 'icon.png'))

# tray / menu bar icons: a window outline with a pointer (template = black on transparent for macOS)
def tray(size, color):
    T = 8; n = size * T; im = Image.new('RGBA', (n, n), (0, 0, 0, 0)); dr = ImageDraw.Draw(im)
    s = n / 22; lw = max(1, int(1.7 * s))
    dr.rounded_rectangle((2 * s, 3.5 * s, 20 * s, 17 * s), radius=2.6 * s, outline=color, width=lw)
    dr.line((2 * s, 7 * s, 20 * s, 7 * s), fill=color, width=lw)
    pts = [(11.5, 10), (11.5, 20.5), (14, 18.2), (15.8, 21.6), (17.6, 20.8), (15.9, 17.4), (19.2, 17.4)]
    cut = Image.new('L', (n, n), 0); ImageDraw.Draw(cut).polygon([(x * s, y * s) for x, y in pts], fill=255)
    cut = cut.filter(ImageFilter.MaxFilter(int(2.2 * s) | 1))
    a = im.getchannel('A'); a = ImageChops.subtract(a, cut); im.putalpha(a)
    ImageDraw.Draw(im).polygon([(x * s, y * s) for x, y in pts], fill=color)
    return im.resize((size, size), Image.LANCZOS)
tray(16, (0, 0, 0, 255)).save(os.path.join(HERE, 'trayTemplate.png'))
tray(32, (0, 0, 0, 255)).save(os.path.join(HERE, 'trayTemplate@2x.png'))
tray(32, (255, 255, 255, 255)).save(os.path.join(HERE, 'tray.png'))
print('icons written')
