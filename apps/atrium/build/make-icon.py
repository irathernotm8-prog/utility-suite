# Regenerates build/icon.png (run: python3 build/make-icon.py). Needs Pillow.
# A deep graphite tile with a cool glow: a glowing archway (the atrium) in the suite's gradient stroke — mint →
# azure → violet — framing a stack of website sections (a hero block and two content rows) that sit inside the
# doorway like a page, with a small sparkle for the AI, like the companion twinkles on the other suite icons.
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import math, os
HERE = os.path.dirname(os.path.abspath(__file__))
S = 4; N = 1024 * S
def P(v): return v * N / 1024

def squircle(size, inset, n=4.4):
    m = Image.new('L', (size, size), 0); r = (size - 2 * inset) / 2; c = size / 2; pts = []
    for i in range(720):
        t = i / 720 * 2 * math.pi; x = math.cos(t); y = math.sin(t)
        pts.append((c + r * math.copysign(abs(x) ** (2 / n), x), c + r * math.copysign(abs(y) ** (2 / n), y)))
    ImageDraw.Draw(m).polygon(pts, fill=255); return m

def lin(size, c0, c1, angle=0):
    g = Image.linear_gradient('L').rotate(angle, expand=False).resize(size)
    return Image.merge('RGB', [g.point(lambda v, a=a, b=b: int(a + (b - a) * v / 255)) for a, b in zip(c0, c1)]).convert('RGBA')

def grad3(size, stops, angle):
    # diagonal 3-stop gradient (mint → azure → violet)
    w, h = size; g = Image.linear_gradient('L').rotate(angle, expand=False).resize(size)
    def ch(i):
        lut = []
        for v in range(256):
            t = v / 255
            if t < .5: a, b, k = stops[0], stops[1], t / .5
            else: a, b, k = stops[1], stops[2], (t - .5) / .5
            lut.append(int(a[i] + (b[i] - a[i]) * k))
        return g.point(lut)
    return Image.merge('RGB', [ch(0), ch(1), ch(2)]).convert('RGBA')

mask = squircle(N, int(N * 0.085))
bg = lin((N, N), (24, 24, 40), (8, 8, 14), 0)
glow = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ImageDraw.Draw(glow).ellipse((P(230), P(250), P(800), P(860)), fill=(110, 130, 255, 70))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(P(130))))

GRAD = grad3((N, N), [(88, 236, 208), (111, 139, 255), (176, 107, 255)], 45)

# ── the archway: a thick rounded stroke, open at the bottom
cx, top, bot, half = 512, 196, 812, 238
arch = Image.new('L', (N, N), 0); da = ImageDraw.Draw(arch); sw = 46
da.arc((P(cx - half), P(top), P(cx + half), P(top + 2 * half)), 180, 360, fill=255, width=int(P(sw)))
da.line((P(cx - half + sw / 2), P(top + half), P(cx - half + sw / 2), P(bot)), fill=255, width=int(P(sw)))
da.line((P(cx + half - sw / 2), P(top + half), P(cx + half - sw / 2), P(bot)), fill=255, width=int(P(sw)))
for x in (cx - half + sw / 2, cx + half - sw / 2):
    da.ellipse((P(x - sw / 2), P(bot - sw / 2), P(x + sw / 2), P(bot + sw / 2)), fill=255)

# ── the page inside: hero block + two section rows (website layout)
inner = Image.new('L', (N, N), 0); di = ImageDraw.Draw(inner)
ix0, ix1 = cx - half + sw + 36, cx + half - sw - 36
di.rounded_rectangle((P(ix0), P(402), P(ix1), P(560)), radius=P(26), fill=235)          # hero
di.rounded_rectangle((P(ix0), P(592), P(cx - 9), P(690)), radius=P(20), fill=170)        # card
di.rounded_rectangle((P(cx + 9), P(592), P(ix1), P(690)), radius=P(20), fill=170)        # card
di.rounded_rectangle((P(ix0), P(722), P(ix1), P(772)), radius=P(18), fill=110)           # row
# hero details: a headline bar and a button pill, cut out of the hero
cut = Image.new('L', (N, N), 0); dc = ImageDraw.Draw(cut)
dc.rounded_rectangle((P(ix0 + 34), P(444), P(ix0 + 210), P(468)), radius=P(12), fill=255)
dc.rounded_rectangle((P(ix0 + 34), P(486), P(ix0 + 150), P(504)), radius=P(9), fill=255)
dc.rounded_rectangle((P(ix0 + 34), P(520), P(ix0 + 112), P(540)), radius=P(10), fill=255)
inner = ImageChops.subtract(inner, cut.point(lambda v: v * 150 // 255))
# the sections fade towards the bottom, like a page receding into the doorway
fade = Image.linear_gradient('L').resize((N, N)).point(lambda v: 255 - int(v * .42))
inner = ImageChops.multiply(inner, fade)

def paint(m, a=255):
    layer = GRAD.copy(); layer.putalpha(m.point(lambda v: v * a // 255)); return layer

arch_l = paint(arch)
inner_l = paint(inner)
shadow = Image.new('RGBA', (N, N), (0, 0, 0, 0)); shadow.paste((4, 2, 14, 170), mask=ImageChops.lighter(arch, inner))
shadow = ImageChops.offset(shadow, 0, int(P(18))).filter(ImageFilter.GaussianBlur(P(26)))
aglow = paint(arch.filter(ImageFilter.GaussianBlur(P(34))), 190)
# a glassy highlight along the top of the arch
hl = Image.new('L', (N, N), 0); ImageDraw.Draw(hl).arc((P(cx - half + 12), P(top + 10), P(cx + half - 12), P(top + 2 * half)), 200, 300, fill=150, width=int(P(10)))
hl = hl.filter(ImageFilter.GaussianBlur(P(4))); hl_l = Image.new('RGBA', (N, N), (255, 255, 255, 0)); hl_l.putalpha(ImageChops.multiply(hl, arch))

# sparkle (AI) top right
sp = Image.new('RGBA', (N, N), (0, 0, 0, 0)); ds = ImageDraw.Draw(sp)
def star(x, y, r, col):
    pts = []
    for i in range(16):
        a = i / 16 * 2 * math.pi - math.pi / 2; rr = r if i % 4 == 0 else r * (0.22 if i % 2 else 0.12) if i % 4 != 2 else r * 0.12
        rr = r if i % 4 == 0 else r * 0.2
        pts.append((P(x + math.cos(a) * rr), P(y + math.sin(a) * rr)))
    ds.polygon(pts, fill=col)
star(804, 230, 62, (226, 255, 248, 255)); star(872, 330, 24, (176, 200, 255, 230))
spg = sp.filter(ImageFilter.GaussianBlur(P(18)))

out = bg
for layer in [shadow, aglow, inner_l, arch_l, hl_l, spg, sp]: out = Image.alpha_composite(out, layer)
sheen = Image.new('RGBA', (N, N), (0, 0, 0, 0)); ImageDraw.Draw(sheen).ellipse((P(-200), P(-640), P(1224), P(300)), fill=(255, 255, 255, 12))
out = Image.alpha_composite(out, sheen.filter(ImageFilter.GaussianBlur(P(30))))
rim = ImageChops.subtract(mask, mask.filter(ImageFilter.MinFilter(int(N * .004) * 2 + 1)))
out.putalpha(mask)
rl = Image.new('RGBA', (N, N), (200, 210, 255, 255)); rl.putalpha(rim.point(lambda v: v * 46 // 255)); out = Image.alpha_composite(out, rl)
out.resize((1024, 1024), Image.LANCZOS).save(os.path.join(HERE, 'icon.png'))
print('icon written')
