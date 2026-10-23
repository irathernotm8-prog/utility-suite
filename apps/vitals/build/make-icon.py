# Regenerates build/icon.png and build/trayTemplate*.png (run: python3 build/make-icon.py). Needs Pillow.
# A deep slate tile with a mint-to-cyan ring gauge, and a heartbeat line running through it.
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

mask = squircle(N, int(N * 0.085))
bg = lin((N, N), (22, 36, 44), (8, 14, 19), 0)
glow = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ImageDraw.Draw(glow).ellipse((P(200), P(180), P(830), P(810)), fill=(40, 220, 170, 70))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(P(120))))

cx, cy, R, W = 512, 520, 300, 62
# track
track = Image.new('RGBA', (N, N), (0, 0, 0, 0)); td = ImageDraw.Draw(track)
start, end = 135, 405
td.arc((P(cx - R), P(cy - R), P(cx + R), P(cy + R)), start, end, fill=(255, 255, 255, 30), width=int(P(W)))
# value arc with a sweep gradient mint -> cyan
arcm = Image.new('L', (N, N), 0); ad = ImageDraw.Draw(arcm)
vend = 345
ad.arc((P(cx - R), P(cy - R), P(cx + R), P(cy + R)), start, vend, fill=255, width=int(P(W)))
for ang in (start, vend):  # round caps
    a = math.radians(ang); px = cx + (R - W / 2 + 1) * math.cos(a); py = cy + (R - W / 2 + 1) * math.sin(a)
    ad.ellipse((P(px - W / 2), P(py - W / 2), P(px + W / 2), P(py + W / 2)), fill=255)
sweep = lin((N, N), (58, 240, 168), (56, 178, 255), -30)
arc = Image.new('RGBA', (N, N), (0, 0, 0, 0)); arc.paste(sweep, mask=arcm)
arcglow = Image.new('RGBA', (N, N), (0, 0, 0, 0)); arcglow.paste((60, 230, 190, 150), mask=arcm)
arcglow = arcglow.filter(ImageFilter.GaussianBlur(P(26)))

# heartbeat line
pts = [(250, 560), (390, 560), (430, 490), (478, 660), (540, 380), (590, 600), (622, 540), (774, 540)]
pts = [(P(x), P(y)) for x, y in pts]
lw = int(P(40))
linem = Image.new('L', (N, N), 0); ld = ImageDraw.Draw(linem)
ld.line(pts, fill=255, width=lw, joint='curve')
for p in (pts[0], pts[-1]): ld.ellipse((p[0] - lw / 2, p[1] - lw / 2, p[0] + lw / 2, p[1] + lw / 2), fill=255)
line = Image.new('RGBA', (N, N), (0, 0, 0, 0)); line.paste((255, 255, 255, 255), mask=linem)
lineglow = Image.new('RGBA', (N, N), (0, 0, 0, 0)); lineglow.paste((120, 255, 220, 170), mask=linem)
lineglow = lineglow.filter(ImageFilter.GaussianBlur(P(22)))
# end dot (live)
dot = Image.new('RGBA', (N, N), (0, 0, 0, 0)); dd = ImageDraw.Draw(dot)
ex, ey = 774, 540
dd.ellipse((P(ex - 34), P(ey - 34), P(ex + 34), P(ey + 34)), fill=(58, 240, 168, 255))
dd.ellipse((P(ex - 16), P(ey - 16), P(ex + 16), P(ey + 16)), fill=(255, 255, 255, 255))

out = bg
for layer in (track, arcglow, arc, lineglow, line, dot): out = Image.alpha_composite(out, layer)

# soft top sheen
sheen = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ImageDraw.Draw(sheen).ellipse((P(-200), P(-620), P(1224), P(330)), fill=(255, 255, 255, 14))
out = Image.alpha_composite(out, sheen.filter(ImageFilter.GaussianBlur(P(30))))

rim = ImageChops.subtract(mask, mask.filter(ImageFilter.MinFilter(int(N * .004) * 2 + 1)))
out.putalpha(mask)
rl = Image.new('RGBA', (N, N), (140, 255, 220, 255)); rl.putalpha(rim.point(lambda v: v * 50 // 255)); out = Image.alpha_composite(out, rl)
out.resize((1024, 1024), Image.LANCZOS).save(os.path.join(HERE, 'icon.png'))

# menu bar / tray: a black heartbeat in a ring, as a template image (macOS tints it)
def tray(px):
    T = px * 8; im = Image.new('L', (T, T), 0); d = ImageDraw.Draw(im)
    c = T / 2; r = T * .42; w = max(2, int(T * .1))
    d.arc((c - r, c - r, c + r, c + r), 135, 405, fill=255, width=w)
    q = [(.2, .56), (.38, .56), (.44, .44), (.52, .72), (.6, .3), (.67, .62), (.72, .52), (.82, .52)]
    d.line([(x * T, y * T) for x, y in q], fill=255, width=w, joint='curve')
    a = im.resize((px, px), Image.LANCZOS)
    o = Image.new('RGBA', (px, px), (0, 0, 0, 0)); o.putalpha(a); return o
tray(16).save(os.path.join(HERE, 'trayTemplate.png'))
tray(32).save(os.path.join(HERE, 'trayTemplate@2x.png'))
print('icon written')
