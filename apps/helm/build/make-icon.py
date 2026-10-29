# NOTE: build/icon.png and icon.svg are now drawn in the Utility Package chat (the Utility Suite icon family).
# Running this script overwrites them with the old design; keep only its tray-icon output if you rerun it.
# Regenerates build/icon.png and the tray icons (run: python3 build/make-icon.py). Needs Pillow.
# Same family as the other suite icons: a dark tile with one bold, glowing glyph in a single gradient.
# Helm's glyph is a controller drawn as one thick outline, with a d-pad and face buttons, and a pointer arrow resting
# on its touchpad: the controller is the mouse. Cyan to violet to pink.
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

def grad3(size, c0, c1, c2, angle=-45):
    g = Image.linear_gradient('L').rotate(angle, expand=False).resize(size)
    def ch(i):
        return g.point(lambda v, i=i: int(c0[i] + (c1[i] - c0[i]) * (v / 127.5)) if v < 128 else int(c1[i] + (c2[i] - c1[i]) * ((v - 128) / 127)))
    return Image.merge('RGB', [ch(0), ch(1), ch(2)]).convert('RGBA')

def P(v): return v * N / 1024

def body_mask(grow=0):
    """The controller silhouette: a wide rounded top joined to two angled grips."""
    m = Image.new('L', (N, N), 0); d = ImageDraw.Draw(m); g = grow
    d.rounded_rectangle((P(180 - g), P(330 - g), P(844 + g), P(560 + g)), radius=P(120 + g), fill=255)
    for side in (-1, 1):
        cx = 512 + side * 238
        grip = Image.new('L', (N, N), 0)
        ImageDraw.Draw(grip).rounded_rectangle((P(cx - 96 - g), P(380 - g), P(cx + 96 + g), P(760 + g)), radius=P(96 + g), fill=255)
        grip = grip.rotate(side * 16, center=(P(cx), P(420)), resample=Image.BICUBIC)
        m = ImageChops.lighter(m, grip)
    return m

def erode(m, r):
    return m.filter(ImageFilter.GaussianBlur(r / 2)).point(lambda v: 255 if v > 232 else 0)

mask = squircle(N, int(N * 0.085))
bg = lin((N, N), (16, 20, 34), (8, 9, 14), 0)
glow = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ImageDraw.Draw(glow).ellipse((P(150), P(250), P(880), P(860)), fill=(90, 120, 255, 66))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(P(130))))

# glyph: outline of the controller (outer minus inner), plus the controls inside
outer = body_mask(0)
inner = body_mask(-46)
g = ImageChops.subtract(outer, inner)
d = ImageDraw.Draw(g)
# d-pad
cx, cy, a, w = 340, 446, 46, 26
d.rounded_rectangle((P(cx - a), P(cy - w / 2), P(cx + a), P(cy + w / 2)), radius=P(8), fill=255)
d.rounded_rectangle((P(cx - w / 2), P(cy - a), P(cx + w / 2), P(cy + a)), radius=P(8), fill=255)
# face buttons
fx, fy, sp, r = 684, 446, 44, 17
for dx, dy in ((0, -1), (1, 0), (0, 1), (-1, 0)):
    d.ellipse((P(fx + dx * sp - r), P(fy + dy * sp - r), P(fx + dx * sp + r), P(fy + dy * sp + r)), fill=255)
# touchpad, as an outline
tx0, ty0, tx1, ty1 = 430, 356, 594, 470
pad = Image.new('L', (N, N), 0); pd = ImageDraw.Draw(pad)
pd.rounded_rectangle((P(tx0), P(ty0), P(tx1), P(ty1)), radius=P(26), fill=255)
pd.rounded_rectangle((P(tx0 + 18), P(ty0 + 18), P(tx1 - 18), P(ty1 - 18)), radius=P(12), fill=0)
g = ImageChops.lighter(g, pad)
# sticks
for sx in (430, 594):
    d.ellipse((P(sx - 30), P(520 - 30), P(sx + 30), P(520 + 30)), fill=255)

# shrink the glyph so it sits inside the tile like the others' do, centred a touch high
K, CY = 0.80, 548   # scale, and the glyph's centre line before scaling
def place(m):
    small = m.resize((int(N * K), int(N * K)), Image.LANCZOS); c = Image.new('L', (N, N), 0)
    c.paste(small, (int(P(512 * (1 - K))), int(P(512 - CY * K)))); return c
def at(x, y): return (512 + (x - 512) * K, 512 + (y - CY) * K)
g = place(g)
grad = grad3((N, N), (56, 214, 255), (118, 112, 255), (246, 92, 214), 120)
glyph = Image.new('RGBA', (N, N), (0, 0, 0, 0)); glyph.paste(grad, mask=g)
hl = Image.new('RGBA', (N, N), (255, 255, 255, 255)); hm = Image.linear_gradient('L').rotate(180).resize((N, N)).point(lambda v: max(0, v - 150))
hm = ImageChops.multiply(hm, g); hlay = Image.new('RGBA', (N, N), (0, 0, 0, 0)); hlay.paste(hl, mask=hm.point(lambda v: v * 40 // 255))
halo = Image.new('RGBA', (N, N), (0, 0, 0, 0)); halo.paste((110, 130, 255, 170), mask=g); halo = halo.filter(ImageFilter.GaussianBlur(P(34)))
shadow = Image.new('RGBA', (N, N), (0, 0, 0, 0)); shadow.paste((0, 0, 0, 160), mask=g)
shadow = ImageChops.offset(shadow, 0, int(P(16))).filter(ImageFilter.GaussianBlur(P(20)))

# the pointer, white with a dark rim, its tip on the touchpad
px, py = 512, 408
ptr = [(0, 0), (0, 250), (62, 194), (106, 290), (152, 270), (108, 176), (190, 176)]
ptr = [(px + x * 0.98, py + y * 0.98) for x, y in ptr]
tip = at(512, 413)
ptr = [(tip[0] + (x - px) * 0.72, tip[1] + (y - py) * 0.72) for x, y in ptr]
pm = Image.new('L', (N, N), 0); ImageDraw.Draw(pm).polygon([(P(x), P(y)) for x, y in ptr], fill=255)
pm_out = pm.filter(ImageFilter.GaussianBlur(P(11))).point(lambda v: 255 if v > 20 else int(v * 255 / 20))
psh = Image.new('RGBA', (N, N), (0, 0, 0, 0)); psh.paste((4, 6, 20, 200), mask=pm_out)
psh = ImageChops.offset(psh, int(P(8)), int(P(18))).filter(ImageFilter.GaussianBlur(P(18)))
pout = Image.new('RGBA', (N, N), (0, 0, 0, 0)); pout.paste((14, 16, 30, 255), mask=pm_out)
pin = Image.new('RGBA', (N, N), (0, 0, 0, 0)); pin.paste((255, 255, 255, 255), mask=pm)
ring = Image.new('RGBA', (N, N), (0, 0, 0, 0))
rx, ry = ptr[0]
ImageDraw.Draw(ring).ellipse((P(rx - 34), P(ry - 34), P(rx + 34), P(ry + 34)), outline=(255, 255, 255, 170), width=int(P(8)))
ring = ring.filter(ImageFilter.GaussianBlur(P(2)))

out = bg
for layer in (shadow, halo, glyph, hlay, ring, psh, pout, pin): out = Image.alpha_composite(out, layer)
sheen = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ImageDraw.Draw(sheen).ellipse((P(-200), P(-640), P(1224), P(300)), fill=(255, 255, 255, 12))
out = Image.alpha_composite(out, sheen.filter(ImageFilter.GaussianBlur(P(30))))
rim = ImageChops.subtract(mask, mask.filter(ImageFilter.MinFilter(int(N * .004) * 2 + 1)))
out.putalpha(mask)
rl = Image.new('RGBA', (N, N), (200, 215, 255, 255)); rl.putalpha(rim.point(lambda v: v * 44 // 255)); out = Image.alpha_composite(out, rl)
out.resize((1024, 1024), Image.LANCZOS).save(os.path.join(HERE, 'icon.png'))

# menu bar / tray: the controller outline with the pointer (template = black on transparent for macOS)
def tray(px, color):
    T = px * 8; m = body_mask(0).resize((T, T), Image.LANCZOS)
    inn = body_mask(-70).resize((T, T), Image.LANCZOS)
    a = ImageChops.subtract(m, inn).point(lambda v: 255 if v > 110 else 0)
    # crop to the glyph and centre it
    bb = m.getbbox(); a = a.crop(bb); m2 = m.crop(bb)
    side = max(a.size); canvas = Image.new('L', (side, side), 0); canvas.paste(a, ((side - a.size[0]) // 2, (side - a.size[1]) // 2 + side // 14))
    d = ImageDraw.Draw(canvas); s = side / 22
    pts = [(10.2, 5.2), (10.2, 15), (12.5, 12.9), (14.2, 16.2), (15.9, 15.4), (14.3, 12.2), (17.4, 12.2)]
    cut = Image.new('L', (side, side), 0); ImageDraw.Draw(cut).polygon([(x * s, y * s) for x, y in pts], fill=255)
    canvas = ImageChops.subtract(canvas, cut.filter(ImageFilter.MaxFilter(int(1.6 * s) | 1)))
    ImageDraw.Draw(canvas).polygon([(x * s, y * s) for x, y in pts], fill=255)
    canvas = canvas.resize((px, px), Image.LANCZOS)
    o = Image.new('RGBA', (px, px), color); o.putalpha(canvas); return o
tray(16, (0, 0, 0, 255)).save(os.path.join(HERE, 'trayTemplate.png'))
tray(32, (0, 0, 0, 255)).save(os.path.join(HERE, 'trayTemplate@2x.png'))
tray(32, (255, 255, 255, 255)).save(os.path.join(HERE, 'tray.png'))
print('icons written')
