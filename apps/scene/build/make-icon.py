# Regenerates build/icon.png and build/trayTemplate*.png (run: python3 build/make-icon.py). Needs Pillow.
# A warm dark tile lit by a soft spotlight, with three window panes arranged like a layout:
# a tall gold pane on the left, a rose and a lilac pane stacked on the right.
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
bg = lin((N, N), (40, 27, 30), (14, 11, 16), 0)
# spotlight: a soft warm cone from above
spot = Image.new('RGBA', (N, N), (0, 0, 0, 0)); sd = ImageDraw.Draw(spot)
sd.polygon([(P(420), P(-40)), (P(604), P(-40)), (P(930), P(900)), (P(94), P(900))], fill=(255, 196, 120, 46))
bg = Image.alpha_composite(bg, spot.filter(ImageFilter.GaussianBlur(P(70))))
pool = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ImageDraw.Draw(pool).ellipse((P(150), P(700), P(874), P(930)), fill=(255, 150, 110, 60))
bg = Image.alpha_composite(bg, pool.filter(ImageFilter.GaussianBlur(P(60))))

def pane(box, c0, c1, angle, r=46):
    x0, y0, x1, y1 = box
    m = Image.new('L', (N, N), 0); ImageDraw.Draw(m).rounded_rectangle((P(x0), P(y0), P(x1), P(y1)), radius=P(r), fill=255)
    g = lin((N, N), c0, c1, angle); layer = Image.new('RGBA', (N, N), (0, 0, 0, 0)); layer.paste(g, mask=m)
    # title bar band and three dots, like a window
    tb = Image.new('L', (N, N), 0); ImageDraw.Draw(tb).rounded_rectangle((P(x0), P(y0), P(x1), P(y0 + 58)), radius=P(r), fill=255)
    tb = ImageChops.multiply(tb, m)
    band = Image.new('RGBA', (N, N), (255, 255, 255, 0)); band.putalpha(tb.point(lambda v: v * 46 // 255))
    layer = Image.alpha_composite(layer, band)
    dd = ImageDraw.Draw(layer)
    for k in range(3):
        cx = x0 + 34 + k * 30; cy = y0 + 29
        dd.ellipse((P(cx - 9), P(cy - 9), P(cx + 9), P(cy + 9)), fill=(255, 255, 255, 150))
    sh = Image.new('RGBA', (N, N), (0, 0, 0, 0)); sh.paste((10, 4, 8, 150), mask=m)
    sh = ImageChops.offset(sh, 0, int(P(22))).filter(ImageFilter.GaussianBlur(P(28)))
    glow = Image.new('RGBA', (N, N), (0, 0, 0, 0)); glow.paste(c0 + (90,), mask=m); glow = glow.filter(ImageFilter.GaussianBlur(P(40)))
    return sh, glow, layer

layers = []
for box, c0, c1, ang in [
    ((196, 262, 548, 794), (255, 205, 96), (255, 136, 92), -70),
    ((584, 262, 832, 508), (255, 118, 150), (214, 98, 230), -40),
    ((584, 548, 832, 794), (190, 172, 255), (118, 150, 255), -40),
]:
    layers.append(pane(box, c0, c1, ang))
out = bg
for sh, _, _ in layers: out = Image.alpha_composite(out, sh)
for _, glow, _ in layers: out = Image.alpha_composite(out, glow)
for _, _, l in layers: out = Image.alpha_composite(out, l)

sheen = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ImageDraw.Draw(sheen).ellipse((P(-200), P(-640), P(1224), P(300)), fill=(255, 255, 255, 12))
out = Image.alpha_composite(out, sheen.filter(ImageFilter.GaussianBlur(P(30))))
rim = ImageChops.subtract(mask, mask.filter(ImageFilter.MinFilter(int(N * .004) * 2 + 1)))
out.putalpha(mask)
rl = Image.new('RGBA', (N, N), (255, 214, 170, 255)); rl.putalpha(rim.point(lambda v: v * 46 // 255)); out = Image.alpha_composite(out, rl)
out.resize((1024, 1024), Image.LANCZOS).save(os.path.join(HERE, 'icon.png'))

# menu bar / tray: the same three panes as a template image (macOS tints it)
def tray(px):
    T = px * 8; im = Image.new('L', (T, T), 0); d = ImageDraw.Draw(im)
    r = T * .1; w = max(2, int(T * .09))
    d.rounded_rectangle((T * .08, T * .16, T * .52, T * .84), radius=r, fill=255)
    d.rounded_rectangle((T * .60, T * .16, T * .92, T * .46), radius=r, outline=255, width=w)
    d.rounded_rectangle((T * .60, T * .54, T * .92, T * .84), radius=r, outline=255, width=w)
    a = im.resize((px, px), Image.LANCZOS)
    o = Image.new('RGBA', (px, px), (0, 0, 0, 0)); o.putalpha(a); return o
tray(16).save(os.path.join(HERE, 'trayTemplate.png'))
tray(32).save(os.path.join(HERE, 'trayTemplate@2x.png'))
print('icon written')
