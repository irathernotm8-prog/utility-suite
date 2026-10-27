# Regenerates build/icon.png and build/trayTemplate*.png (run: python3 build/make-icon.py). Needs Pillow.
# Same family as the other suite icons: a dark tile with one bold, glowing glyph in a single gradient.
# Scene's glyph is a screen with its layout inside (a tall pane on the left, two stacked on the right), gold to rose.
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
bg = lin((N, N), (36, 26, 32), (12, 10, 14), 0)
glow = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ImageDraw.Draw(glow).ellipse((P(190), P(200), P(840), P(820)), fill=(255, 140, 110, 62))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(P(130))))

# the glyph, as one mask: a thick rounded screen outline, a short stand, and three panes inside
g = Image.new('L', (N, N), 0); d = ImageDraw.Draw(g)
X0, Y0, X1, Y1, W = 214, 250, 810, 690, 50
d.rounded_rectangle((P(X0), P(Y0), P(X1), P(Y1)), radius=P(84), fill=255)
d.rounded_rectangle((P(X0 + W), P(Y0 + W), P(X1 - W), P(Y1 - W)), radius=P(40), fill=0)
gap = 26; ix0, iy0, ix1, iy1 = X0 + W + gap, Y0 + W + gap, X1 - W - gap, Y1 - W - gap
split = ix0 + (ix1 - ix0) * 0.56
mid = (iy0 + iy1) / 2
d.rounded_rectangle((P(ix0), P(iy0), P(split - gap / 2), P(iy1)), radius=P(22), fill=255)
d.rounded_rectangle((P(split + gap / 2), P(iy0), P(ix1), P(mid - gap / 2)), radius=P(22), fill=255)
d.rounded_rectangle((P(split + gap / 2), P(mid + gap / 2), P(ix1), P(iy1)), radius=P(22), fill=255)
d.rounded_rectangle((P(452), P(Y1 + 10), P(572), P(Y1 + 66)), radius=P(10), fill=255)       # neck
d.rounded_rectangle((P(352), P(Y1 + 54), P(672), P(Y1 + 104)), radius=P(25), fill=255)      # foot

grad = lin((N, N), (255, 204, 92), (255, 92, 140), -55)
glyph = Image.new('RGBA', (N, N), (0, 0, 0, 0)); glyph.paste(grad, mask=g)
# a soft top highlight on the glyph, like the others
hl = lin((N, N), (255, 255, 255), (255, 255, 255), 0); hm = Image.linear_gradient('L').rotate(180).resize((N, N)).point(lambda v: max(0, v - 150))
hm = ImageChops.multiply(hm, g); hlay = Image.new('RGBA', (N, N), (0, 0, 0, 0)); hlay.paste(hl, mask=hm.point(lambda v: v * 40 // 255))
halo = Image.new('RGBA', (N, N), (0, 0, 0, 0)); halo.paste((255, 130, 110, 170), mask=g); halo = halo.filter(ImageFilter.GaussianBlur(P(34)))
shadow = Image.new('RGBA', (N, N), (0, 0, 0, 0)); shadow.paste((0, 0, 0, 150), mask=g)
shadow = ImageChops.offset(shadow, 0, int(P(16))).filter(ImageFilter.GaussianBlur(P(20)))

out = bg
for layer in (shadow, halo, glyph, hlay): out = Image.alpha_composite(out, layer)
sheen = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ImageDraw.Draw(sheen).ellipse((P(-200), P(-640), P(1224), P(300)), fill=(255, 255, 255, 12))
out = Image.alpha_composite(out, sheen.filter(ImageFilter.GaussianBlur(P(30))))
rim = ImageChops.subtract(mask, mask.filter(ImageFilter.MinFilter(int(N * .004) * 2 + 1)))
out.putalpha(mask)
rl = Image.new('RGBA', (N, N), (255, 214, 190, 255)); rl.putalpha(rim.point(lambda v: v * 44 // 255)); out = Image.alpha_composite(out, rl)
out.resize((1024, 1024), Image.LANCZOS).save(os.path.join(HERE, 'icon.png'))

# menu bar / tray: the same glyph as a template image (macOS tints it)
def tray(px):
    T = px * 8; im = Image.new('L', (T, T), 0); d = ImageDraw.Draw(im); w = max(2, int(T * .1))
    d.rounded_rectangle((T * .06, T * .14, T * .94, T * .74), radius=T * .12, outline=255, width=w)
    d.rounded_rectangle((T * .22, T * .28, T * .52, T * .60), radius=T * .04, fill=255)
    d.rounded_rectangle((T * .58, T * .28, T * .78, T * .41), radius=T * .03, fill=255)
    d.rounded_rectangle((T * .58, T * .47, T * .78, T * .60), radius=T * .03, fill=255)
    d.rounded_rectangle((T * .30, T * .80, T * .70, T * .90), radius=T * .05, fill=255)
    a = im.resize((px, px), Image.LANCZOS)
    o = Image.new('RGBA', (px, px), (0, 0, 0, 0)); o.putalpha(a); return o
tray(16).save(os.path.join(HERE, 'trayTemplate.png'))
tray(32).save(os.path.join(HERE, 'trayTemplate@2x.png'))
print('icon written')
