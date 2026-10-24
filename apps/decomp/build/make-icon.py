# Regenerates build/icon.png (run: python3 build/make-icon.py). Needs Pillow.
# A deep graphite tile with a crimson glow and an isometric block pulled apart into three layers —
# an app taken apart. The top layer catches the light; a hot seam glows between the layers.
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

def P(v): return v * N / 1024
def poly(pts): return [(P(x), P(y)) for x, y in pts]

mask = squircle(N, int(N * 0.085))
bg = lin((N, N), (34, 20, 26), (9, 9, 12), 0)
glow = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ImageDraw.Draw(glow).ellipse((P(160), P(360), P(880), P(1010)), fill=(255, 60, 90, 72))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(P(120))))
top = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ImageDraw.Draw(top).ellipse((P(250), P(-180), P(1000), P(360)), fill=(255, 150, 120, 26))
bg = Image.alpha_composite(bg, top.filter(ImageFilter.GaussianBlur(P(90))))

W, H, T = 236, 136, 62   # half width, half height of the top face, slab thickness

def slab(cx, cy, top0, top1, left, right, alpha=255):
    L = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    tp = [(cx, cy - H), (cx + W, cy), (cx, cy + H), (cx - W, cy)]
    lp = [(cx - W, cy), (cx, cy + H), (cx, cy + H + T), (cx - W, cy + T)]
    rp = [(cx, cy + H), (cx + W, cy), (cx + W, cy + T), (cx, cy + H + T)]
    for pts, fill in ((lp, left), (rp, right)):
        m = Image.new('L', (N, N), 0); ImageDraw.Draw(m).polygon(poly(pts), fill=255)
        face = lin((N, N), fill[0], fill[1], 90); L.paste(face, mask=m)
    m = Image.new('L', (N, N), 0); ImageDraw.Draw(m).polygon(poly(tp), fill=255)
    L.paste(lin((N, N), top0, top1, -35), mask=m)
    # bevel highlights on the top face's front edges
    d = ImageDraw.Draw(L)
    d.line(poly([(cx - W, cy), (cx, cy + H), (cx + W, cy)]), fill=(255, 255, 255, 70), width=int(P(4)))
    d.line(poly([(cx - W, cy), (cx, cy - H), (cx + W, cy)]), fill=(255, 255, 255, 40), width=int(P(3)))
    if alpha < 255: L.putalpha(L.getchannel('A').point(lambda v: v * alpha // 255))
    sh = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    sm = Image.new('L', (N, N), 0); ImageDraw.Draw(sm).polygon(poly([(cx - W, cy), (cx, cy - H), (cx + W, cy), (cx + W, cy + T), (cx, cy + H + T), (cx - W, cy + T)]), fill=255)
    sh.paste((0, 0, 0, 150), mask=sm)
    sh = ImageChops.offset(sh, 0, int(P(30))).filter(ImageFilter.GaussianBlur(P(30)))
    return sh, L

def seam(cx, cy, strength):
    g = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    ImageDraw.Draw(g).polygon(poly([(cx, cy - H * .82), (cx + W * .82, cy), (cx, cy + H * .82), (cx - W * .82, cy)]), fill=(255, 92, 110, strength))
    return g.filter(ImageFilter.GaussianBlur(P(26)))

out = bg
layers = [
    (494, 668, (120, 42, 58), (78, 24, 38), ((92, 30, 44), (60, 18, 30)), ((56, 18, 28), (36, 12, 20)), 255),
    (534, 486, (214, 70, 92), (150, 36, 60), ((178, 44, 66), (120, 26, 44)), ((112, 24, 42), (78, 16, 30)), 255),
    (506, 300, (255, 196, 170), (255, 78, 104), ((236, 64, 92), (176, 34, 62)), ((150, 30, 56), (104, 20, 40)), 255),
]
for i, (cx, cy, t0, t1, lf, rf, a) in enumerate(layers):
    sh, L = slab(cx, cy, t0, t1, lf, rf, a)
    out = Image.alpha_composite(out, sh)
    if i: out = Image.alpha_composite(out, seam(cx, cy + 96, 190 if i == 2 else 150))
    out = Image.alpha_composite(out, L)

# "</>" engraved on the top layer, lying flat in the face's isometric plane
cx, cy = layers[2][0], layers[2][1]
K = 0.62
flat = lambda gx, gy: (P(cx + gx * K * W), P(cy + gy * K * H))
def glyph(dx, dy, color, width):
    g = Image.new('RGBA', (N, N), (0, 0, 0, 0)); d = ImageDraw.Draw(g)
    for seg in ([(-0.30, -0.42), (-0.62, 0), (-0.30, 0.42)], [(0.30, -0.42), (0.62, 0), (0.30, 0.42)], [(0.13, -0.52), (-0.13, 0.52)]):
        pts = [(x + P(dx), y + P(dy)) for x, y in [flat(a, b) for a, b in seg]]
        d.line(pts, fill=color, width=int(P(width)), joint='curve')
        for x, y in (pts[0], pts[-1]):
            r = P(width) / 2; d.ellipse((x - r, y - r, x + r, y + r), fill=color)
    return g
out = Image.alpha_composite(out, glyph(0, 3, (255, 236, 228, 110), 26).filter(ImageFilter.GaussianBlur(P(1.5))))
out = Image.alpha_composite(out, glyph(0, 0, (150, 22, 52, 225), 24))

sheen = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ImageDraw.Draw(sheen).ellipse((P(-200), P(-640), P(1224), P(300)), fill=(255, 255, 255, 12))
out = Image.alpha_composite(out, sheen.filter(ImageFilter.GaussianBlur(P(30))))
rim = ImageChops.subtract(mask, mask.filter(ImageFilter.MinFilter(int(N * .004) * 2 + 1)))
out.putalpha(mask)
rl = Image.new('RGBA', (N, N), (255, 210, 215, 255)); rl.putalpha(rim.point(lambda v: v * 46 // 255)); out = Image.alpha_composite(out, rl)
out.resize((1024, 1024), Image.LANCZOS).save(os.path.join(HERE, 'icon.png'))
print('icon written')
