# Regenerates build/icon.png (run: python3 build/make-icon.py). Needs Pillow and NumPy.
# A deep ink-violet tile with a faceted crystal (a lit icosahedron) floating over a prism glow:
# a 3D model made of facets. Faces shade from lilac through violet to sky blue; the edges catch the light.
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import numpy as np
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

def P(v): return v * N / 1024
def blur(img, r): return img.filter(ImageFilter.GaussianBlur(P(r)))

mask = squircle(N, int(N * 0.085))
bg = lin((N, N), (26, 22, 44), (8, 8, 14), 0)
glow = Image.new('RGBA', (N, N), (120, 120, 255, 0))
d = ImageDraw.Draw(glow)
d.ellipse((P(170), P(420), P(860), P(1020)), fill=(143, 110, 255, 88))
d.ellipse((P(420), P(520), P(980), P(1040)), fill=(70, 170, 255, 54))
bg = Image.alpha_composite(bg, blur(glow, 120))
top = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ImageDraw.Draw(top).ellipse((P(160), P(-220), P(900), P(330)), fill=(200, 185, 255, 24))
bg = Image.alpha_composite(bg, blur(top, 90))

# ── the crystal: an icosahedron, slightly tall, turned to show many facets
phi = (1 + 5 ** 0.5) / 2
V = np.array([[-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0], [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
              [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1]], dtype=float)
F = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
     (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
V /= np.linalg.norm(V[0])
def rot(ax, a):
    c, s = math.cos(a), math.sin(a)
    return {'x': np.array([[1, 0, 0], [0, c, -s], [0, s, c]]), 'y': np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]]), 'z': np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])}[ax]
R = rot('x', -0.36) @ rot('y', 0.52) @ rot('z', 0.30)
W = (V * np.array([1, 1.12, 1])) @ R.T
cx, cy, scale = 512, 452, 238
cam = 5.2
def proj(p):
    k = cam / (cam - p[2])
    return (P(cx + p[0] * scale * k), P(cy - p[1] * scale * k))

light = np.array([-0.45, 0.75, 0.55]); light /= np.linalg.norm(light)
rim = np.array([0.7, -0.2, 0.4]); rim /= np.linalg.norm(rim)
view = np.array([0, 0, 1.0])
C_LILAC, C_VIOLET, C_SKY, C_DEEP = np.array([212, 192, 255]), np.array([128, 90, 255]), np.array([44, 178, 255]), np.array([40, 26, 130])

faces = []
for f in F:
    a, b, c = W[list(f)]
    n = np.cross(b - a, c - a); n /= np.linalg.norm(n)
    cen = (a + b + c) / 3
    if n @ cen < 0: n = -n
    if n @ (np.array([0, 0, cam]) - cen) <= 0: continue    # back face
    diff = max(0.0, n @ light)
    rimv = max(0.0, n @ rim) ** 2
    # colour runs lilac (top-left) → violet → sky (lower right), then is lit
    t = np.clip(0.5 - 0.42 * n[1] + 0.38 * n[0], 0, 1)
    base = C_LILAC * (1 - t) + C_VIOLET * t if t < 0.55 else C_VIOLET * (1 - (t - 0.55) / 0.45) + C_SKY * ((t - 0.55) / 0.45)
    shade = 0.40 + 0.80 * diff
    col = base * shade + C_SKY * 0.35 * rimv
    col = col * (1 - 0.10 * (1 - diff)) + C_DEEP * 0.10 * (1 - diff)
    spec = max(0.0, (2 * (n @ light) * n - light) @ view) ** 18
    col = np.clip(col + 255 * 0.55 * spec, 0, 255)
    faces.append((cen[2], [proj(p) for p in (a, b, c)], tuple(int(x) for x in col), diff))
faces.sort(key=lambda x: x[0])

out = bg
# soft contact shadow and a glow pool under the crystal
sh = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ImageDraw.Draw(sh).ellipse((P(360), P(790), P(670), P(850)), fill=(0, 0, 0, 160))
out = Image.alpha_composite(out, blur(sh, 22))
pool = Image.new('RGBA', (N, N), (140, 110, 255, 0))
ImageDraw.Draw(pool).ellipse((P(260), P(690), P(770), P(880)), fill=(140, 110, 255, 95))
out = Image.alpha_composite(out, blur(pool, 60))
# halo behind the gem
halo = Image.new('RGBA', (N, N), (150, 125, 255, 0))
ImageDraw.Draw(halo).ellipse((P(250), P(190), P(780), P(720)), fill=(150, 125, 255, 72))
out = Image.alpha_composite(out, blur(halo, 80))

gem = Image.new('RGBA', (N, N), (0, 0, 0, 0))
gd = ImageDraw.Draw(gem)
for _, pts, col, diff in faces:
    gd.polygon(pts, fill=col + (255,))
# gentle gradient sheen across the whole crystal
gm = gem.getchannel('A')
sheen = lin((N, N), (255, 255, 255), (60, 120, 255), -50)
sheen.putalpha(gm.point(lambda v: v * 26 // 255))
gem = Image.alpha_composite(gem, sheen)
# glowing edges
edges = Image.new('RGBA', (N, N), (240, 236, 255, 0))
ed = ImageDraw.Draw(edges)
for _, pts, col, diff in faces:
    a = int(55 + 110 * diff)
    ed.line(pts + [pts[0]], fill=(240, 236, 255, a), width=int(P(4.2)), joint='curve')
edges = ImageChops.multiply(edges, Image.merge('RGBA', [Image.new('L', (N, N), 255)] * 3 + [gm]))
gem_glow = gem.copy(); gem_glow.putalpha(gm.point(lambda v: v * 170 // 255))
out = Image.alpha_composite(out, blur(gem_glow, 28))
out = Image.alpha_composite(out, gem)
out = Image.alpha_composite(out, blur(edges, 1.2))

# a few sparkle points at bright vertices
sp = Image.new('RGBA', (N, N), (255, 255, 255, 0))
spd = ImageDraw.Draw(sp)
best = sorted(range(len(W)), key=lambda i: -(W[i] @ light))[:1]
for i in best:
    x, y = proj(W[i]); r = P(7)
    spd.ellipse((x - r, y - r, x + r, y + r), fill=(255, 255, 255, 255))
    for L, w in ((P(46), P(3.2)), (P(30), P(2.4))):
        spd.line((x - L, y, x + L, y), fill=(255, 255, 255, 200), width=int(w))
        spd.line((x, y - L, x, y + L), fill=(255, 255, 255, 200), width=int(w))
out = Image.alpha_composite(out, blur(sp, 2.2))
out = Image.alpha_composite(out, blur(sp, 10))

sheen2 = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ImageDraw.Draw(sheen2).ellipse((P(-200), P(-640), P(1224), P(300)), fill=(255, 255, 255, 12))
out = Image.alpha_composite(out, blur(sheen2, 30))
rimm = ImageChops.subtract(mask, mask.filter(ImageFilter.MinFilter(int(N * .004) * 2 + 1)))
out.putalpha(mask)
rl = Image.new('RGBA', (N, N), (215, 205, 255, 255)); rl.putalpha(rimm.point(lambda v: v * 46 // 255)); out = Image.alpha_composite(out, rl)
out.resize((1024, 1024), Image.LANCZOS).save(os.path.join(HERE, 'icon.png'))
print('icon written')
