# Regenerates build/icon.png (run: python3 build/make-icon.py). Needs Pillow.
# A boarding pass on a twilight tile: a cream ticket, tilted, with a sunset map pin and a little route
# (origin → plane → destination) on the main part, and a sunset-coloured stub with a barcode.
# Plan it, book it, carry it.
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
    l = Image.new('RGBA', m.size, (0, 0, 0, 0))
    if g is not None: l.paste(g, mask=m)
    else: l.paste(col, mask=m)
    return l
def blur(img, r): return img.filter(ImageFilter.GaussianBlur(P(r)))

mask = squircle(N, int(N * 0.085))
bg = lin((N, N), (40, 28, 66), (14, 10, 24), 0)
glow = Image.new('L', (N, N), 0); ImageDraw.Draw(glow).ellipse((P(60), P(420), P(1000), P(1220)), fill=255)
bg = Image.alpha_composite(bg, layer(blur(glow, 150), (255, 110, 90, 120)))
cool = Image.new('L', (N, N), 0); ImageDraw.Draw(cool).ellipse((P(380), P(-120), P(1100), P(460)), fill=255)
bg = Image.alpha_composite(bg, layer(blur(cool, 150), (150, 110, 255, 60)))

# ── the ticket, drawn flat at W×H then rotated into place
W, H, CUT, R = 780, 440, 575, 48
w, h = int(P(W)), int(P(H))
def flat(): return Image.new('L', (w, h), 0)
shape = flat(); ds = ImageDraw.Draw(shape)
ds.rounded_rectangle((0, 0, w, h), radius=P(R), fill=255)
for y in (0, H): ds.ellipse((P(CUT - 34), P(y - 34), P(CUT + 34), P(y + 34)), fill=0)
main = ImageChops.multiply(shape, (lambda m: (ImageDraw.Draw(m).rectangle((0, 0, P(CUT), h), fill=255), m)[1])(flat()))
stub = ImageChops.subtract(shape, main)
perf = flat(); dp = ImageDraw.Draw(perf)
for y in range(66, H - 50, 32): dp.ellipse((P(CUT - 7), P(y - 7), P(CUT + 7), P(y + 7)), fill=255)
bars = flat(); db = ImageDraw.Draw(bars); x = CUT + 52; i = 0
while x < W - 44:
    bw = [7, 13, 5, 10, 6, 15, 8, 5][i % 8]; db.rectangle((P(x), P(92), P(x + bw), P(H - 92)), fill=255); x += bw + 8; i += 1
# route on the ticket: two code blocks with a plane between, and two quiet lines under
txt = flat(); dt = ImageDraw.Draw(txt)
dt.rounded_rectangle((P(296), P(128), P(366), P(166)), radius=P(10), fill=255)
dt.rounded_rectangle((P(470), P(128), P(540), P(166)), radius=P(10), fill=255)
quiet = flat(); dq = ImageDraw.Draw(quiet)
for (x0, y0, x1) in [(296, 236, 520), (296, 288, 450), (296, 340, 488)]: dq.rounded_rectangle((P(x0), P(y0), P(x1), P(y0 + 20)), radius=P(10), fill=255)
dots = flat(); dd = ImageDraw.Draw(dots)
for xx in (384, 404, 446, 466): dd.ellipse((P(xx - 5), P(147 - 5), P(xx + 5), P(147 + 5)), fill=255)
plane = flat(); dpl = ImageDraw.Draw(plane)
px0, py0, sc = 425, 147, 1.15
shp = [(30, 0), (22, -5), (6, -6), (-6, -30), (-15, -30), (-7, -6), (-21, -6), (-27, -15), (-32, -15), (-28, 0), (-32, 15), (-27, 15), (-21, 6), (-7, 6), (-15, 30), (-6, 30), (6, 6), (22, 5)]
dpl.polygon([(P(px0 + a * sc), P(py0 + b * sc)) for a, b in shp], fill=255)
# the pin
pin = flat(); dpn = ImageDraw.Draw(pin)
cx, cy, PR, tip = 162, 196, 98, 368
dpn.ellipse((P(cx - PR), P(cy - PR), P(cx + PR), P(cy + PR)), fill=255)
ang = math.asin(PR / (tip - cy))
dpn.polygon([(P(cx - PR * math.cos(ang)), P(cy + PR * math.sin(ang))), (P(cx + PR * math.cos(ang)), P(cy + PR * math.sin(ang))), (P(cx), P(tip))], fill=255)
pin = pin.filter(ImageFilter.GaussianBlur(P(4))).point(lambda v: 255 if v > 128 else 0)
hole = flat(); ImageDraw.Draw(hole).ellipse((P(cx - 36), P(cy - 36), P(cx + 36), P(cy + 36)), fill=255)
pinShadow = flat(); ImageDraw.Draw(pinShadow).ellipse((P(cx - 52), P(tip - 9), P(cx + 52), P(tip + 13)), fill=120)
hl = flat(); ImageDraw.Draw(hl).arc((P(cx - PR + 18), P(cy - PR + 18), P(cx + PR - 18), P(cy + PR - 18)), start=200, end=258, fill=170, width=int(P(12)))
hl = ImageChops.multiply(hl.filter(ImageFilter.GaussianBlur(P(4))), pin)

def tgrad(c0, c1, angle=0): return lin((w, h), c0, c1, angle)
def pgrad(c0, c1, box):
    g = Image.new('RGBA', (w, h), (0, 0, 0, 0)); x0, y0, x1, y1 = [int(P(v)) for v in box]
    g.paste(lin((x1 - x0, y1 - y0), c0, c1, 0), (x0, y0)); return g

ticket = Image.new('RGBA', (w, h), (0, 0, 0, 0))
for l in (layer(main, g=tgrad((255, 251, 245), (248, 232, 220), 0)),
          layer(stub, g=tgrad((255, 186, 76), (238, 70, 116), 0)),
          layer(perf, (40, 28, 66, 255)),
          layer(ImageChops.multiply(bars, stub), (255, 246, 236, 235)),
          layer(quiet, (226, 208, 200, 255)), layer(txt, (60, 44, 70, 255)), layer(dots, (240, 140, 110, 255)), layer(plane, (240, 100, 100, 255)),
          layer(pinShadow.filter(ImageFilter.GaussianBlur(P(6))), (120, 70, 60, 255)),
          layer(ImageChops.subtract(pin, hole), g=pgrad((255, 200, 84), (245, 70, 120), (cx - PR, cy - PR, cx + PR, tip))),
          layer(hole, (255, 251, 245, 255))):
    ticket = Image.alpha_composite(ticket, l)
hlL = Image.new('RGBA', (w, h), (255, 255, 255, 0)); hlL.putalpha(hl); ticket = Image.alpha_composite(ticket, hlL)
# a soft top sheen across the ticket
sh = flat(); ImageDraw.Draw(sh).rectangle((0, 0, w, P(110)), fill=46); sh = ImageChops.multiply(sh.filter(ImageFilter.GaussianBlur(P(40))), shape)
shL = Image.new('RGBA', (w, h), (255, 255, 255, 0)); shL.putalpha(sh); ticket = Image.alpha_composite(ticket, shL)

def place(img, angle, ox, oy):
    r = img.rotate(angle, resample=Image.BICUBIC, expand=True)
    c = Image.new(img.mode, (N, N), 0 if img.mode == 'L' else (0, 0, 0, 0))
    c.paste(r, (int(P(ox)) - r.width // 2, int(P(oy)) - r.height // 2), r if img.mode == 'RGBA' else None)
    return c
ANG, CX, CY = 11, 512, 548
front = place(ticket, ANG, CX, CY)
fmask = place(shape, ANG, CX, CY)

out = bg
out = Image.alpha_composite(out, blur(ImageChops.offset(layer(fmask, (8, 3, 12, 210)), 0, int(P(34))), 38))
out = Image.alpha_composite(out, front)
rim = ImageChops.subtract(mask, mask.filter(ImageFilter.MinFilter(int(N * .004) * 2 + 1)))
sheen = Image.new('RGBA', (N, N), (0, 0, 0, 0)); ImageDraw.Draw(sheen).ellipse((P(-200), P(-640), P(1224), P(300)), fill=(255, 255, 255, 12))
out = Image.alpha_composite(out, blur(sheen, 30))
out.putalpha(mask)
rl = Image.new('RGBA', (N, N), (255, 210, 180, 255)); rl.putalpha(rim.point(lambda v: v * 50 // 255)); out = Image.alpha_composite(out, rl)
out.resize((1024, 1024), Image.LANCZOS).save(os.path.join(HERE, 'icon.png'))
print('icon written')
