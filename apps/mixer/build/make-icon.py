# Regenerates build/icon.png (run: python3 build/make-icon.py). Needs Pillow.
# A deep ink tile with a cool glow: four console faders whose caps sit at different heights, so the row reads as a
# little melody. The level under each cap is lit mint → cyan → periwinkle, and a faint waveform runs behind them.
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

mask = squircle(N, int(N * 0.085))
bg = lin((N, N), (20, 34, 48), (7, 10, 16), 0)
glow = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ImageDraw.Draw(glow).ellipse((P(200), P(260), P(840), P(900)), fill=(60, 200, 230, 58))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(P(130))))

# a faint waveform behind the faders
wave = Image.new('RGBA', (N, N), (0, 0, 0, 0)); dw = ImageDraw.Draw(wave)
for i in range(0, 760, 14):
    x = 132 + i; t = i / 760
    a = (0.35 + 0.65 * abs(math.sin(t * 9.2) * math.sin(t * 2.3 + .4))) * 150 * (1 - abs(t - .5) * 0.9)
    dw.rounded_rectangle((P(x), P(520 - a), P(x + 7), P(520 + a)), radius=P(3.5), fill=(120, 220, 255, 34))
bg = Image.alpha_composite(bg, wave)

GRAD = [(70, 240, 190), (62, 200, 255), (128, 140, 255)]
def grad_at(t):
    t = max(0, min(1, t)); k = t * (len(GRAD) - 1); i = min(int(k), len(GRAD) - 2); f = k - i
    return tuple(int(GRAD[i][c] + (GRAD[i + 1][c] - GRAD[i][c]) * f) for c in range(3))

xs = [272, 432, 592, 752]; caps = [590, 400, 500, 330]   # cap centre heights (lower y = higher level)
top, bot, tw = 214, 812, 68
tracks = Image.new('RGBA', (N, N), (0, 0, 0, 0)); dt = ImageDraw.Draw(tracks)
levels = Image.new('RGBA', (N, N), (0, 0, 0, 0)); dl = ImageDraw.Draw(levels)
capsL = Image.new('RGBA', (N, N), (0, 0, 0, 0)); dc = ImageDraw.Draw(capsL)
for k, (x, cy) in enumerate(zip(xs, caps)):
    dt.rounded_rectangle((P(x - tw / 2), P(top), P(x + tw / 2), P(bot)), radius=P(tw / 2), fill=(255, 255, 255, 20))
    # the lit level, a vertical gradient from the cap down to the floor
    for y in range(int(cy), bot, 4):
        c = grad_at((k / 3) * 0.75 + (y - cy) / (bot - cy) * 0.25)
        dl.rectangle((P(x - tw / 2), P(y), P(x + tw / 2), P(y + 4)), fill=c + (255,))
lvl_mask = Image.new('L', (N, N), 0); dm = ImageDraw.Draw(lvl_mask)
for x, cy in zip(xs, caps): dm.rounded_rectangle((P(x - tw / 2), P(cy), P(x + tw / 2), P(bot)), radius=P(tw / 2), fill=255)
levels.putalpha(ImageChops.multiply(levels.split()[3], lvl_mask))
for k, (x, cy) in enumerate(zip(xs, caps)):
    c = grad_at(k / 3 * 0.75)
    dc.rounded_rectangle((P(x - 66), P(cy - 40), P(x + 66), P(cy + 40)), radius=P(28), fill=(236, 250, 255, 255))
    dc.rounded_rectangle((P(x - 44), P(cy - 6), P(x + 44), P(cy + 6)), radius=P(6), fill=c + (255,))

alpha = ImageChops.lighter(levels.split()[3], capsL.split()[3])
shadow = Image.new('RGBA', (N, N), (0, 0, 0, 0)); shadow.paste((2, 8, 16, 190), mask=capsL.split()[3])
shadow = ImageChops.offset(shadow, 0, int(P(16))).filter(ImageFilter.GaussianBlur(P(18)))
lglow = Image.new('RGBA', (N, N), (0, 0, 0, 0)); lglow.paste((80, 220, 255, 170), mask=alpha); lglow = lglow.filter(ImageFilter.GaussianBlur(P(44)))
hl = Image.new('RGBA', (N, N), (0, 0, 0, 0)); dh = ImageDraw.Draw(hl)
for x, cy in zip(xs, caps): dh.rounded_rectangle((P(x - 54), P(cy - 32), P(x + 54), P(cy - 20)), radius=P(6), fill=(255, 255, 255, 140))
# a small sparkle, top right, like the rest of the suite
sp = Image.new('RGBA', (N, N), (0, 0, 0, 0)); ds = ImageDraw.Draw(sp)
cx, cy, r = 850, 190, 38
ds.polygon([(P(cx), P(cy - r)), (P(cx + 6), P(cy - 6)), (P(cx + r), P(cy)), (P(cx + 6), P(cy + 6)), (P(cx), P(cy + r)), (P(cx - 6), P(cy + 6)), (P(cx - r), P(cy)), (P(cx - 6), P(cy - 6))], fill=(230, 252, 255, 235))

out = bg
for layer in [tracks, lglow, levels, shadow, capsL, hl, sp]: out = Image.alpha_composite(out, layer)
sheen = Image.new('RGBA', (N, N), (0, 0, 0, 0)); ImageDraw.Draw(sheen).ellipse((P(-200), P(-640), P(1224), P(300)), fill=(255, 255, 255, 12))
out = Image.alpha_composite(out, sheen.filter(ImageFilter.GaussianBlur(P(30))))
rim = ImageChops.subtract(mask, mask.filter(ImageFilter.MinFilter(int(N * .004) * 2 + 1)))
out.putalpha(mask)
rl = Image.new('RGBA', (N, N), (190, 240, 255, 255)); rl.putalpha(rim.point(lambda v: v * 46 // 255)); out = Image.alpha_composite(out, rl)
out.resize((1024, 1024), Image.LANCZOS).save(os.path.join(HERE, 'icon.png'))
print('icon written')
