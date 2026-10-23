# Regenerates build/icon.png (run: python3 build/make-icon.py). Needs Pillow.
# Touchline: a floodlit pitch at night. Dark mown-stripe squircle, lime pitch
# markings seen from above, and a glowing ball on the centre spot.
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import math, os
S = 4; N = 1024 * S

def squircle(size, inset, n=4.4):
    m = Image.new('L', (size, size), 0); r = (size - 2 * inset) / 2; c = size / 2; pts = []
    for i in range(720):
        t = i / 720 * 2 * math.pi; x = math.cos(t); y = math.sin(t)
        pts.append((c + r * math.copysign(abs(x) ** (2 / n), x), c + r * math.copysign(abs(y) ** (2 / n), y)))
    ImageDraw.Draw(m).polygon(pts, fill=255); return m

mask = squircle(N, int(N * 0.07))
g = Image.linear_gradient('L').resize((N, N))
top = (22, 68, 46); bot = (6, 22, 15)
grad = Image.merge('RGBA', [g.point(lambda v, a=a, b=b: int(a + (b - a) * v / 255)) for a, b in zip(top + (255,), bot + (255,))])

# mown stripes, very faint
stripes = Image.new('RGBA', (N, N), (0, 0, 0, 0)); sd = ImageDraw.Draw(stripes)
band = N / 8
for i in range(9):
    if i % 2: sd.rectangle((i * band, 0, (i + 1) * band, N), fill=(120, 255, 170, 9))
grad = Image.alpha_composite(grad, stripes)

# floodlight sheen from the top
hl = Image.new('RGBA', (N, N), (0, 0, 0, 0)); ImageDraw.Draw(hl).ellipse((-N * .2, -N * .62, N * 1.2, N * .36), fill=(190, 255, 200, 40))
grad = Image.alpha_composite(grad, hl.filter(ImageFilter.GaussianBlur(N * .05)))

# glyph: a pitch seen from above (outline, halfway line, centre circle, boxes)
shape = Image.new('L', (N, N), 0); d = ImageDraw.Draw(shape)
w = int(N * 0.052)
L, T, Rr, B = N * 0.2, N * 0.29, N * 0.8, N * 0.71
d.rounded_rectangle((L, T, Rr, B), radius=N * 0.05, outline=255, width=w)
cx = cy = N / 2
d.line((cx, T + w / 2, cx, B - w / 2), fill=255, width=w)
R = N * 0.105
d.ellipse((cx - R, cy - R, cx + R, cy + R), outline=255, width=w)
bh = N * 0.17; bw = N * 0.075
d.rounded_rectangle((L, cy - bh / 2, L + bw, cy + bh / 2), radius=N * 0.02, outline=255, width=w)
d.rounded_rectangle((Rr - bw, cy - bh / 2, Rr, cy + bh / 2), radius=N * 0.02, outline=255, width=w)
lime = Image.merge('RGBA', [g.point(lambda v, a=a, b=b: int(a + (b - a) * v / 255)) for a, b in zip((222, 255, 120, 255), (86, 222, 140, 255))])
gl = Image.new('RGBA', (N, N), (0, 0, 0, 0)); gl.paste(lime, mask=shape)

# ball on the centre spot
dot = Image.new('RGBA', (N, N), (0, 0, 0, 0)); dr = N * 0.05
ImageDraw.Draw(dot).ellipse((cx - dr, cy - dr, cx + dr, cy + dr), fill=(255, 255, 255, 255))
glow = Image.new('RGBA', (N, N), (0, 0, 0, 0)); gr = N * 0.09
ImageDraw.Draw(glow).ellipse((cx - gr, cy - gr, cx + gr, cy + gr), fill=(230, 255, 140, 150))
glow = glow.filter(ImageFilter.GaussianBlur(N * .04))
lineglow = gl.filter(ImageFilter.GaussianBlur(N * .02)); lineglow.putalpha(lineglow.split()[3].point(lambda v: v * 70 // 255))

sh = Image.new('RGBA', (N, N), (0, 0, 0, 0)); sh.paste((0, 10, 5, 140), mask=ImageChops.add(gl.split()[3], dot.split()[3]))
sh = ImageChops.offset(sh.filter(ImageFilter.GaussianBlur(N * .012)), 0, int(N * .012))
out = Image.alpha_composite(grad, sh)
for layer in (lineglow, glow, gl, dot): out = Image.alpha_composite(out, layer)
rim = ImageChops.subtract(mask, mask.filter(ImageFilter.MinFilter(int(N * .004) * 2 + 1)))
out.putalpha(mask)
rl = Image.new('RGBA', (N, N), (255, 255, 255, 30)); rl.putalpha(rim.point(lambda v: v * 30 // 255)); out = Image.alpha_composite(out, rl)
out.resize((1024, 1024), Image.LANCZOS).save(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'icon.png'))
