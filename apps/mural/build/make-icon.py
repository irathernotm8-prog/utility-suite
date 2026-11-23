# Regenerates build/icon.png, build/tray.png, build/trayTemplate*.png and src/renderer/icon.png (python3 build/make-icon.py; needs Pillow).
# A deep graphite tile; on it a screen whose picture is a lit, folding ribbon in the suite's iridescent colors — a
# wallpaper that's alive — with the glow pooling beneath like light from the screen.
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import math, os
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
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
        if t <= b: k = (t - a) / (b - a); return tuple(int(ca[i] + (cb[i] - ca[i]) * k) for i in range(3))
    return STOPS[-1][1]
def sweep(angle=0):
    w = 256; strip = Image.new('RGB', (w, 1))
    for x in range(w): strip.putpixel((x, 0), iri(x / (w - 1)))
    return strip.resize((N, N)).rotate(angle).convert('RGBA')

mask = squircle(N, int(N * 0.085))
bg = lin((N, N), (26, 27, 38), (7, 7, 11), 0)
halo = Image.new('RGBA', (N, N), (0, 0, 0, 0)); ImageDraw.Draw(halo).ellipse((P(150), P(560), P(874), P(1000)), fill=(120, 110, 255, 80))
bg = Image.alpha_composite(bg, halo.filter(ImageFilter.GaussianBlur(P(100))))

# the screen
x0, y0, x1, y1 = 168, 238, 856, 702; R = 64
scr = Image.new('L', (N, N), 0); ImageDraw.Draw(scr).rounded_rectangle((P(x0), P(y0), P(x1), P(y1)), radius=P(R), fill=255)
glow = Image.new('L', (N, N), 0); ImageDraw.Draw(glow).rounded_rectangle((P(x0 - 26), P(y0 - 26), P(x1 + 26), P(y1 + 26)), radius=P(R + 26), fill=255)
g = sweep(-18); g.putalpha(ImageChops.subtract(glow, scr).filter(ImageFilter.GaussianBlur(P(34))).point(lambda v: v * 150 // 255)); bg = Image.alpha_composite(bg, g)
pic = lin((N, N), (4, 6, 16), (24, 30, 58), -60)
# ribbons: wide bands following sine curves, lit along one edge
rib = Image.new('RGBA', (N, N), (0, 0, 0, 0))
for k, (amp, off, thick, alpha) in enumerate([(70, 520, 120, 205), (60, 590, 90, 255)]):
    band = Image.new('L', (N, N), 0); d = ImageDraw.Draw(band); top = []; bot = []
    for i in range(201):
        u = i / 200; x = x0 - 20 + (x1 - x0 + 40) * u
        y = off - 90 * u + amp * math.sin(u * math.pi * 1.6 + k * 0.9)
        top.append((P(x), P(y))); bot.append((P(x), P(y + thick * (0.55 + 0.45 * math.sin(u * math.pi)))))
    d.polygon(top + bot[::-1], fill=255)
    col = sweep(-10 + k * 20); shade = Image.linear_gradient('L').resize((N, N)).point(lambda v: int(130 + 125 * (1 - v / 255)))
    a = ImageChops.multiply(band, shade).point(lambda v, al=alpha: v * al // 255)
    lay = col.copy(); lay.putalpha(a); rib = Image.alpha_composite(rib, lay)
    edge = Image.new('L', (N, N), 0); ImageDraw.Draw(edge).line(top, fill=255, width=P(5))
    el = Image.new('RGBA', (N, N), (255, 255, 255, 0)); el.putalpha(edge.point(lambda v: v * 210 // 255)); rib = Image.alpha_composite(rib, el)
pic = Image.alpha_composite(pic, rib)
sh = Image.new('L', (N, N), 0); ImageDraw.Draw(sh).ellipse((P(x0 - 100), P(y0 - 200), P(x1 - 200), P(y0 + 160)), fill=255)
shl = Image.new('RGBA', (N, N), (255, 255, 255, 0)); shl.putalpha(sh.filter(ImageFilter.GaussianBlur(P(40))).point(lambda v: v * 22 // 255)); pic = Image.alpha_composite(pic, shl)
scrl = Image.new('RGBA', (N, N), (0, 0, 0, 0)); scrl.paste(pic, mask=scr); bg = Image.alpha_composite(bg, scrl)
rim = Image.new('L', (N, N), 0); ImageDraw.Draw(rim).rounded_rectangle((P(x0), P(y0), P(x1), P(y1)), radius=P(R), outline=255, width=P(4))
rl = Image.new('RGBA', (N, N), (255, 255, 255, 0)); rl.putalpha(rim.point(lambda v: v * 60 // 255)); bg = Image.alpha_composite(bg, rl)
# stand
st = Image.new('L', (N, N), 0); d = ImageDraw.Draw(st); d.rounded_rectangle((P(456), P(718), P(568), P(782)), radius=P(10), fill=255); d.rounded_rectangle((P(352), P(774), P(672), P(812)), radius=P(19), fill=255)
stl = sweep(-18); stl.putalpha(st.point(lambda v: v * 200 // 255)); bg = Image.alpha_composite(bg, stl)
# sparkle
sp = Image.new('L', (N, N), 0); cx, cy, r = 806, 196, 44
ImageDraw.Draw(sp).polygon([(P(cx), P(cy - r)), (P(cx + r * .22), P(cy - r * .22)), (P(cx + r), P(cy)), (P(cx + r * .22), P(cy + r * .22)), (P(cx), P(cy + r)), (P(cx - r * .22), P(cy + r * .22)), (P(cx - r), P(cy)), (P(cx - r * .22), P(cy - r * .22))], fill=255)
spl = Image.new('RGBA', (N, N), (225, 245, 255, 0)); spl.putalpha(sp); bg = Image.alpha_composite(bg, spl)
out = Image.new('RGBA', (N, N), (0, 0, 0, 0)); out.paste(bg, mask=mask)
border = ImageChops.subtract(mask, squircle(N, int(N * 0.085) + P(3)))
bl = Image.new('RGBA', (N, N), (255, 255, 255, 0)); bl.putalpha(border.point(lambda v: v * 38 // 255)); out = Image.alpha_composite(out, bl)
icon = out.resize((1024, 1024), Image.LANCZOS); icon.save(os.path.join(HERE, 'icon.png'))
icon.resize((128, 128), Image.LANCZOS).save(os.path.join(ROOT, 'src', 'renderer', 'icon.png'))
# tray: a screen outline with a wave
def tray(size, color):
    s = 8; T = Image.new('RGBA', (size * s, size * s), (0, 0, 0, 0)); d = ImageDraw.Draw(T); w = size * s
    d.rounded_rectangle((w * .08, w * .14, w * .92, w * .72), radius=w * .12, outline=color, width=int(w * .085))
    pts = [(w * (.18 + .64 * i / 40), w * (.5 - .12 * math.sin(i / 40 * math.pi * 1.6))) for i in range(41)]
    d.line(pts, fill=color, width=int(w * .085), joint='curve')
    d.rounded_rectangle((w * .3, w * .8, w * .7, w * .89), radius=w * .04, fill=color)
    return T.resize((size, size), Image.LANCZOS)
tray(22, (0, 0, 0, 255)).save(os.path.join(HERE, 'trayTemplate.png')); tray(44, (0, 0, 0, 255)).save(os.path.join(HERE, 'trayTemplate@2x.png'))
tray(32, (235, 238, 248, 255)).save(os.path.join(HERE, 'tray.png'))
print('icons written')
