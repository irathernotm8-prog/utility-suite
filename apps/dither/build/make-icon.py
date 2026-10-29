# Regenerates build/icon.png (run: python3 build/make-icon.py). Needs Pillow.
# A deep ink tile with a warm glow: a pixel-art sparkle built from square pixels, its colour stepping gold → coral →
# magenta through an ordered-dither band (the technique the app is named for), with two fading onion-skin ghosts
# trailing behind it to say "animation".
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
bg = lin((N, N), (34, 24, 52), (10, 9, 18), 0)
glow = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ImageDraw.Draw(glow).ellipse((P(220), P(200), P(820), P(800)), fill=(255, 110, 120, 62))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(P(120))))

# the sparkle on a 15×15 pixel grid
G = 11; cell = 58; C = G // 2; ox = 512 - G * cell / 2 + 22; oy = 512 - G * cell / 2 - 14
half = {0: 2, 1: 2, 2: 1, 3: 1, 4: 0, 5: 0}
def inside(dx, dy):
    if abs(dx) + abs(dy) <= 3: return True
    return (abs(dy) <= C and abs(dx) <= half.get(abs(dy), -1)) or (abs(dx) <= C and abs(dy) <= half.get(abs(dx), -1))
cells = [(i, j) for j in range(G) for i in range(G) if inside(i - C, j - C)]
BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
RAMP = [(255, 214, 102), (255, 160, 92), (255, 112, 112), (236, 84, 150)]
def color(i, j):
    t = (j + i * 0.35) / (G - 1 + (G - 1) * 0.35)        # top-left → bottom-right
    v = t * (len(RAMP) - 1); lo = int(v); f = v - lo
    k = lo + (1 if f > 0.62 or (f > 0.38 and (i + j) % 2) else 0)        # a checker-dithered seam between bands
    return RAMP[max(0, min(len(RAMP) - 1, k))]

def blocks(offx, offy, fill_fn, shrink=5, radius=10):
    im = Image.new('RGBA', (N, N), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    for (i, j) in cells:
        x0 = ox + offx + i * cell + shrink / 2; y0 = oy + offy + j * cell + shrink / 2
        d.rounded_rectangle((P(x0), P(y0), P(x0 + cell - shrink), P(y0 + cell - shrink)), radius=P(radius), fill=fill_fn(i, j))
    return im

# onion-skin ghosts trailing down-left
ghosts = []
for k, (dx, a, col) in enumerate([(-84, 50, (124, 96, 255)), (-44, 92, (196, 104, 236))]):
    ghosts.append(blocks(dx, -dx * 0.7, lambda i, j, a=a, col=col: col + (a,), shrink=0, radius=6))
star = blocks(0, 0, lambda i, j: color(i, j) + (255,))
# the brightest pixel in the middle
core = Image.new('RGBA', (N, N), (0, 0, 0, 0)); dc = ImageDraw.Draw(core)
for (i, j) in [(C, C)]:
    x0 = ox + i * cell + 2; y0 = oy + j * cell + 2
    dc.rounded_rectangle((P(x0), P(y0), P(x0 + cell - 4), P(y0 + cell - 4)), radius=P(9), fill=(255, 248, 228, 255))
# a small companion twinkle, top right
tw = Image.new('RGBA', (N, N), (0, 0, 0, 0)); dt = ImageDraw.Draw(tw)
for (i, j, c) in [(0, -1, (255, 214, 102)), (-1, 0, (255, 214, 102)), (0, 0, (255, 248, 228)), (1, 0, (255, 214, 102)), (0, 1, (255, 214, 102))]:
    x0 = 800 + i * 30; y0 = 236 + j * 30
    dt.rounded_rectangle((P(x0), P(y0), P(x0 + 27), P(y0 + 27)), radius=P(6), fill=c + (255,))

alpha = star.split()[3]
shadow = Image.new('RGBA', (N, N), (0, 0, 0, 0)); shadow.paste((8, 2, 16, 170), mask=alpha)
shadow = ImageChops.offset(shadow, 0, int(P(18))).filter(ImageFilter.GaussianBlur(P(24)))
sglow = Image.new('RGBA', (N, N), (0, 0, 0, 0)); sglow.paste((255, 120, 110, 130), mask=alpha); sglow = sglow.filter(ImageFilter.GaussianBlur(P(48)))
cglow = Image.new('RGBA', (N, N), (0, 0, 0, 0)); ImageDraw.Draw(cglow).ellipse((P(ox + C * cell - 80), P(oy + C * cell - 80), P(ox + (C + 1) * cell + 80), P(oy + (C + 1) * cell + 80)), fill=(255, 230, 190, 120)); cglow = cglow.filter(ImageFilter.GaussianBlur(P(34)))
# a soft top highlight on each pixel block
hl = Image.new('RGBA', (N, N), (0, 0, 0, 0)); dh = ImageDraw.Draw(hl)
for (i, j) in cells:
    x0 = ox + i * cell + 6; y0 = oy + j * cell + 5
    dh.rounded_rectangle((P(x0), P(y0), P(x0 + cell - 12), P(y0 + 7)), radius=P(4), fill=(255, 255, 255, 46))

out = bg
for layer in [*ghosts, shadow, sglow, star, hl, cglow, core, tw]: out = Image.alpha_composite(out, layer)
sheen = Image.new('RGBA', (N, N), (0, 0, 0, 0)); ImageDraw.Draw(sheen).ellipse((P(-200), P(-640), P(1224), P(300)), fill=(255, 255, 255, 12))
out = Image.alpha_composite(out, sheen.filter(ImageFilter.GaussianBlur(P(30))))
rim = ImageChops.subtract(mask, mask.filter(ImageFilter.MinFilter(int(N * .004) * 2 + 1)))
out.putalpha(mask)
rl = Image.new('RGBA', (N, N), (255, 200, 210, 255)); rl.putalpha(rim.point(lambda v: v * 46 // 255)); out = Image.alpha_composite(out, rl)
out.resize((1024, 1024), Image.LANCZOS).save(os.path.join(HERE, 'icon.png'))
print('icon written')
