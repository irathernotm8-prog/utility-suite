# Regenerates build/icon.png (run: python3 build/make-icon.py). Needs Pillow.
# A twilight tile (deep plum-navy) with a warm sunset glow low on the horizon: a dotted route winds up
# from a small start point to a bold amber-to-rose map pin (plan the way, then follow it).
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

def layer(m, col=None, g=None):
    l = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    if g is not None: l.paste(g, mask=m)
    else: l.paste(col, mask=m)
    return l

mask = squircle(N, int(N * 0.085))
bg = lin((N, N), (34, 24, 52), (12, 10, 22), 0)            # plum at the top → ink at the bottom
# sunset glow low on the tile
glow = Image.new('RGBA', (N, N), (0, 0, 0, 0)); dg = ImageDraw.Draw(glow)
dg.ellipse((P(-160), P(700), P(1184), P(1320)), fill=(255, 84, 110, 120))
dg.ellipse((P(120), P(820), P(900), P(1220)), fill=(255, 170, 80, 120))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(P(120))))
cool = Image.new('RGBA', (N, N), (0, 0, 0, 0)); ImageDraw.Draw(cool).ellipse((P(420), P(40), P(1060), P(560)), fill=(140, 110, 255, 45))
bg = Image.alpha_composite(bg, cool.filter(ImageFilter.GaussianBlur(P(140))))

# the route: a cubic curve from the start dot (lower left) to the pin's point
def bez(p0, p1, p2, p3, t):
    u = 1 - t
    return (u**3*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t**3*p3[0], u**3*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t**3*p3[1])
start = (262, 790); tip = (640, 700)
c1, c2 = (470, 820), (300, 560)
c3, c4 = (520, 470), (720, 600)
pts = [bez(start, c1, c2, (420, 560), i / 400) for i in range(401)] + [bez((420, 560), c3, c4, tip, i / 400) for i in range(1, 401)]
# even spacing along the path
dist = [0]
for a, b in zip(pts, pts[1:]): dist.append(dist[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
route = Image.new('L', (N, N), 0); dr = ImageDraw.Draw(route)
step = 50; d = 92
while d < dist[-1] - 70:
    i = next(k for k, v in enumerate(dist) if v >= d)
    x, y = pts[i]; r = 15
    dr.ellipse((P(x - r), P(y - r), P(x + r), P(y + r)), fill=255)
    d += step
sd = Image.new('L', (N, N), 0); ImageDraw.Draw(sd).ellipse((P(start[0] - 40), P(start[1] - 40), P(start[0] + 40), P(start[1] + 40)), fill=255)
ring = Image.new('L', (N, N), 0); ImageDraw.Draw(ring).ellipse((P(start[0] - 66), P(start[1] - 66), P(start[0] + 66), P(start[1] + 66)), outline=255, width=int(P(12)))

# the pin: a teardrop with its point at `tip`
px, py, R = 640, 330, 190           # head centre and radius; point at (640, 700)
pin = Image.new('L', (N, N), 0); dp = ImageDraw.Draw(pin)
dp.ellipse((P(px - R), P(py - R), P(px + R), P(py + R)), fill=255)
ang = math.asin(R / (tip[1] - py))
l = (px - R * math.cos(ang), py + R * math.sin(ang)); rr = (px + R * math.cos(ang), py + R * math.sin(ang))
dp.polygon([(P(l[0]), P(l[1])), (P(rr[0]), P(rr[1])), (P(tip[0]), P(tip[1]))], fill=255)
pin = pin.filter(ImageFilter.GaussianBlur(P(6))).point(lambda v: 255 if v > 128 else 0)
hole = Image.new('L', (N, N), 0); ImageDraw.Draw(hole).ellipse((P(px - 64), P(py - 64), P(px + 64), P(py + 64)), fill=255)
pinBody = ImageChops.subtract(pin, hole)

grad = Image.new('RGBA', (N, N), (0, 0, 0, 0))
_g = lin((int(P(2 * R + 40)), int(P(tip[1] - py + R + 40))), (255, 200, 84), (255, 72, 122), 0)
grad.paste(_g, (int(P(px - R - 20)), int(P(py - R - 20))))
shadow = layer(pin, (10, 2, 10, 190)); shadow = ImageChops.offset(shadow, 0, int(P(26))).filter(ImageFilter.GaussianBlur(P(30)))
pglow = layer(pin, (255, 130, 80, 120)).filter(ImageFilter.GaussianBlur(P(70)))
pinL = layer(pinBody, g=grad)
holeL = layer(hole, (255, 244, 232, 255))
# a soft highlight on the upper left of the pin head
hl = Image.new('L', (N, N), 0); ImageDraw.Draw(hl).arc((P(px - R + 26), P(py - R + 26), P(px + R - 26), P(py + R - 26)), start=196, end=262, fill=150, width=int(P(16)))
hl = ImageChops.multiply(hl.filter(ImageFilter.GaussianBlur(P(6))), pin)
hlL = Image.new('RGBA', (N, N), (255, 255, 255, 0)); hlL.putalpha(hl)
routeL = layer(route, g=lin((N, N), (255, 236, 210), (255, 170, 120), -30))
rglow = layer(route, (255, 160, 100, 90)).filter(ImageFilter.GaussianBlur(P(16)))
startL = layer(sd, (255, 236, 210, 255)); ringL = layer(ring, (255, 220, 190, 110))
# the pin's shadow on the ground: a small ellipse under the point
gsh = Image.new('L', (N, N), 0); ImageDraw.Draw(gsh).ellipse((P(tip[0] - 70), P(tip[1] - 14), P(tip[0] + 70), P(tip[1] + 22)), fill=150)
gshL = layer(gsh.filter(ImageFilter.GaussianBlur(P(10))), (20, 6, 10, 255))

out = bg
for x in (rglow, routeL, ringL, startL, gshL, shadow, pglow, pinL, holeL, hlL): out = Image.alpha_composite(out, x)
sheen = Image.new('RGBA', (N, N), (0, 0, 0, 0)); ImageDraw.Draw(sheen).ellipse((P(-200), P(-640), P(1224), P(300)), fill=(255, 255, 255, 12))
out = Image.alpha_composite(out, sheen.filter(ImageFilter.GaussianBlur(P(30))))
rim = ImageChops.subtract(mask, mask.filter(ImageFilter.MinFilter(int(N * .004) * 2 + 1)))
out.putalpha(mask)
rl = Image.new('RGBA', (N, N), (255, 210, 180, 255)); rl.putalpha(rim.point(lambda v: v * 50 // 255)); out = Image.alpha_composite(out, rl)
out.resize((1024, 1024), Image.LANCZOS).save(os.path.join(HERE, 'icon.png'))
print('icon written')
