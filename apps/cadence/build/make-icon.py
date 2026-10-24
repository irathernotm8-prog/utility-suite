# Regenerates build/icon.png, build/tray.png and build/trayTemplate*.png (run: python3 build/make-icon.py). Needs Pillow.
# A deep plum tile with a soft violet glow: a looping arrow (it runs again and again) around three linked steps.
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
bg = lin((N, N), (40, 26, 62), (13, 10, 22), 0)
glow = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ImageDraw.Draw(glow).ellipse((P(170), P(150), P(854), P(834)), fill=(150, 110, 255, 70))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(P(120))))

cx, cy, R, W = 512, 520, 268, 78
# loop arc: from 300° round to 230° (clockwise gap at top-right for the arrow head)
start, end = -40, 228  # degrees, PIL measures clockwise from 3 o'clock
ring = Image.new('L', (N, N), 0)
Ro = R + W / 2
ImageDraw.Draw(ring).arc((P(cx - Ro), P(cy - Ro), P(cx + Ro), P(cy + Ro)), start=start, end=end, fill=255, width=int(P(W)))
# rounded tail cap
tail = math.radians(start)
tx, ty = cx + R * math.cos(tail) - 0, cy + R * math.sin(tail)
d = ImageDraw.Draw(ring); r2 = W / 2 - 1
d.ellipse((P(tx - r2), P(ty - r2), P(tx + r2), P(ty + r2)), fill=255)
# arrow head at the start of the arc, pointing clockwise
a = math.radians(end)
hx, hy = cx + R * math.cos(a), cy + R * math.sin(a)
tang = (-math.sin(a), math.cos(a))  # clockwise direction
back = (-tang[0], -tang[1]); nrm = (math.cos(a), math.sin(a))
L, Wd = 120, 108
tip = (hx + tang[0] * L * 0.9, hy + tang[1] * L * 0.9)
b1 = (hx + back[0] * L * 0.1 + nrm[0] * Wd, hy + back[1] * L * 0.38 + nrm[1] * Wd)
b2 = (hx + back[0] * L * 0.1 - nrm[0] * Wd, hy + back[1] * L * 0.38 - nrm[1] * Wd)
head = Image.new('L', (N, N), 0); ImageDraw.Draw(head).polygon([(P(tip[0]), P(tip[1])), (P(b1[0]), P(b1[1])), (P(b2[0]), P(b2[1]))], fill=255)
head = head.filter(ImageFilter.GaussianBlur(P(3))).point(lambda v: 255 if v > 120 else 0)
loop = ImageChops.lighter(ring, head)
grad = lin((N, N), (214, 196, 255), (176, 92, 240), -35)
shadow = Image.new('RGBA', (N, N), (0, 0, 0, 0)); shadow.paste((8, 2, 20, 170), mask=loop)
shadow = ImageChops.offset(shadow, 0, int(P(18))).filter(ImageFilter.GaussianBlur(P(26)))
lglow = Image.new('RGBA', (N, N), (0, 0, 0, 0)); lglow.paste((160, 110, 255, 120), mask=loop); lglow = lglow.filter(ImageFilter.GaussianBlur(P(46)))
loopL = Image.new('RGBA', (N, N), (0, 0, 0, 0)); loopL.paste(grad, mask=loop)
# a soft highlight along the top of the ring
hl = Image.new('L', (N, N), 0); ImageDraw.Draw(hl).arc((P(cx - R + 18), P(cy - R + 18), P(cx + R - 18), P(cy + R - 18)), start=170, end=245, fill=90, width=int(P(10)))
hl = ImageChops.multiply(hl.filter(ImageFilter.GaussianBlur(P(4))), loop)
hlL = Image.new('RGBA', (N, N), (255, 255, 255, 0)); hlL.putalpha(hl)

# three linked steps inside the loop
nodes = [(400, 600), (512, 470), (624, 560)]
inner = Image.new('RGBA', (N, N), (0, 0, 0, 0)); di = ImageDraw.Draw(inner)
di.line([(P(x), P(y)) for x, y in nodes], fill=(235, 226, 255, 150), width=int(P(16)), joint='curve')
for i, (x, y) in enumerate(nodes):
    r = 50 if i == 1 else 40
    col = (255, 255, 255, 255) if i == 1 else (233, 222, 255, 235)
    di.ellipse((P(x - r), P(y - r), P(x + r), P(y + r)), fill=col)
ig = Image.new('RGBA', (N, N), (0, 0, 0, 0)); ImageDraw.Draw(ig).ellipse((P(512 - 70), P(470 - 70), P(512 + 70), P(470 + 70)), fill=(220, 180, 255, 150)); ig = ig.filter(ImageFilter.GaussianBlur(P(30)))

out = bg
for layer in (shadow, lglow, loopL, hlL, ig, inner): out = Image.alpha_composite(out, layer)
sheen = Image.new('RGBA', (N, N), (0, 0, 0, 0)); ImageDraw.Draw(sheen).ellipse((P(-200), P(-640), P(1224), P(300)), fill=(255, 255, 255, 12))
out = Image.alpha_composite(out, sheen.filter(ImageFilter.GaussianBlur(P(30))))
rim = ImageChops.subtract(mask, mask.filter(ImageFilter.MinFilter(int(N * .004) * 2 + 1)))
out.putalpha(mask)
rl = Image.new('RGBA', (N, N), (210, 190, 255, 255)); rl.putalpha(rim.point(lambda v: v * 50 // 255)); out = Image.alpha_composite(out, rl)
out.resize((1024, 1024), Image.LANCZOS).save(os.path.join(HERE, 'icon.png'))

# menu bar (template) and Windows tray icons: the loop and the middle step
def glyph(px, color):
    T = px * 8; im = Image.new('L', (T, T), 0); d = ImageDraw.Draw(im)
    c = T / 2; r = T * 0.36; w = max(2, int(T * 0.13))
    ro = r + w / 2; d.arc((c - ro, c - ro, c + ro, c + ro), start=-40, end=228, fill=255, width=w)
    a = math.radians(228); hx, hy = c + r * math.cos(a), c + r * math.sin(a)
    tg = (-math.sin(a), math.cos(a)); nm = (math.cos(a), math.sin(a)); L = T * 0.16; Wd = T * 0.15
    d.polygon([(hx + tg[0] * L, hy + tg[1] * L), (hx - tg[0] * L * .1 + nm[0] * Wd, hy - tg[1] * L * .1 + nm[1] * Wd), (hx - tg[0] * L * .1 - nm[0] * Wd, hy - tg[1] * L * .1 - nm[1] * Wd)], fill=255)
    rr = T * 0.11; d.ellipse((c - rr, c - rr, c + rr, c + rr), fill=255)
    a2 = im.resize((px, px), Image.LANCZOS)
    o = Image.new('RGBA', (px, px), color + (0,)); o.putalpha(a2); return o
glyph(16, (0, 0, 0)).save(os.path.join(HERE, 'trayTemplate.png'))
glyph(32, (0, 0, 0)).save(os.path.join(HERE, 'trayTemplate@2x.png'))
glyph(32, (176, 140, 255)).save(os.path.join(HERE, 'tray.png'))
print('icon written')
