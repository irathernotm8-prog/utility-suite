# NOTE: build/icon.png is now drawn from build/icon.svg (the Utility Suite icon family). Running this script
# overwrites icon.png with the old design; keep only its tray-icon output if you rerun it.
# Regenerates build/icon.png, build/tray.png and build/trayTemplate*.png (run: python3 build/make-icon.py). Needs Pillow.
# A midnight-blue tile with a cool azure glow: a bold arrow launching up and to the right,
# with three signal waves rippling out ahead of it (send, and it lands nearby).
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
bg = lin((N, N), (20, 34, 66), (7, 10, 22), 0)
glow = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ImageDraw.Draw(glow).ellipse((P(250), P(120), P(930), P(800)), fill=(70, 150, 255, 80))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(P(130))))

# the arrow: a thick rounded shaft from lower-left to upper-right, with a solid head
ax0, ay0 = 236, 788          # tail
ax1, ay1 = 500, 524          # where the head starts
ang = math.atan2(ay1 - ay0, ax1 - ax0)
ux, uy = math.cos(ang), math.sin(ang); nx, ny = -uy, ux
arrow = Image.new('L', (N, N), 0); d = ImageDraw.Draw(arrow)
W = 92
d.line([(P(ax0), P(ay0)), (P(ax1), P(ay1))], fill=255, width=int(P(W)))
d.ellipse((P(ax0 - W / 2), P(ay0 - W / 2), P(ax0 + W / 2), P(ay0 + W / 2)), fill=255)
HL, HW = 196, 150
tip = (ax1 + ux * HL * .78, ay1 + uy * HL * .78)
b1 = (ax1 - ux * HL * .22 + nx * HW, ay1 - uy * HL * .22 + ny * HW)
b2 = (ax1 - ux * HL * .22 - nx * HW, ay1 - uy * HL * .22 - ny * HW)
d.polygon([(P(tip[0]), P(tip[1])), (P(b1[0]), P(b1[1])), (P(b2[0]), P(b2[1]))], fill=255)
# round off the head's corners
arrow = arrow.filter(ImageFilter.GaussianBlur(P(14))).point(lambda v: 255 if v > 128 else 0)

# three waves ahead of the arrow tip, centred on the tail so they read as ripples spreading out
waves = Image.new('L', (N, N), 0); dw = ImageDraw.Draw(waves)
cx, cy = ax0, ay0
deg = math.degrees(ang)
for k, (R, w, a) in enumerate([(590, 42, 255), (682, 38, 205), (774, 34, 150)]):
    span = 21 - k * 3
    dw.arc((P(cx - R), P(cy - R), P(cx + R), P(cy + R)), start=deg - span, end=deg + span, fill=a, width=int(P(w)))
# soften the wave ends
waves = waves.filter(ImageFilter.GaussianBlur(P(2)))
clip = Image.new('L', (N, N), 0); ImageDraw.Draw(clip).rectangle((0, 0, N, N), fill=255)
waves = ImageChops.multiply(waves, mask)

grad = lin((N, N), (150, 246, 255), (84, 112, 255), -45)
def layer(m, col=None, g=None):
    l = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    if g is not None: l.paste(g, mask=m)
    else: l.paste(col, mask=m)
    return l
shadow = layer(arrow, (2, 6, 20, 180)); shadow = ImageChops.offset(shadow, 0, int(P(20))).filter(ImageFilter.GaussianBlur(P(28)))
aglow = layer(arrow, (80, 170, 255, 130)).filter(ImageFilter.GaussianBlur(P(50)))
wglow = layer(waves, (90, 200, 255, 110)).filter(ImageFilter.GaussianBlur(P(30)))
arrowL = layer(arrow, g=grad)
wavesL = layer(waves, g=lin((N, N), (190, 250, 255), (110, 160, 255), -45))
# a soft highlight along the upper edge of the shaft
hl = Image.new('L', (N, N), 0)
ImageDraw.Draw(hl).line([(P(ax0 + nx * -26 + ux * 30), P(ay0 + ny * -26 + uy * 30)), (P(ax1 + nx * -26 - ux * 20), P(ay1 + ny * -26 - uy * 20))], fill=80, width=int(P(12)))
hl = ImageChops.multiply(hl.filter(ImageFilter.GaussianBlur(P(5))), arrow)
hlL = Image.new('RGBA', (N, N), (255, 255, 255, 0)); hlL.putalpha(hl)

out = bg
for l in (wglow, wavesL, shadow, aglow, arrowL, hlL): out = Image.alpha_composite(out, l)
sheen = Image.new('RGBA', (N, N), (0, 0, 0, 0)); ImageDraw.Draw(sheen).ellipse((P(-200), P(-640), P(1224), P(300)), fill=(255, 255, 255, 12))
out = Image.alpha_composite(out, sheen.filter(ImageFilter.GaussianBlur(P(30))))
rim = ImageChops.subtract(mask, mask.filter(ImageFilter.MinFilter(int(N * .004) * 2 + 1)))
out.putalpha(mask)
rl = Image.new('RGBA', (N, N), (170, 210, 255, 255)); rl.putalpha(rim.point(lambda v: v * 50 // 255)); out = Image.alpha_composite(out, rl)
out.resize((1024, 1024), Image.LANCZOS).save(os.path.join(HERE, 'icon.png'))

# menu bar (template) and Windows tray icons: the arrow and two waves
def glyph(px, color):
    T = px * 8; im = Image.new('L', (T, T), 0); d = ImageDraw.Draw(im)
    s = T / 1024
    w = int(150 * s)
    d.line([(ax0 * s - 40 * s, ay0 * s + 40 * s), (ax1 * s, ay1 * s)], fill=255, width=w)
    hl, hw = HL * 1.25, HW * 1.35
    t = (ax1 + ux * hl * .78, ay1 + uy * hl * .78)
    c1 = (ax1 - ux * hl * .22 + nx * hw, ay1 - uy * hl * .22 + ny * hw)
    c2 = (ax1 - ux * hl * .22 - nx * hw, ay1 - uy * hl * .22 - ny * hw)
    d.polygon([(t[0] * s, t[1] * s), (c1[0] * s, c1[1] * s), (c2[0] * s, c2[1] * s)], fill=255)
    for R, span in ((620, 22), (780, 17)):
        d.arc(((cx - R) * s, (cy - R) * s, (cx + R) * s, (cy + R) * s), start=deg - span, end=deg + span, fill=255, width=int(70 * s))
    a2 = im.resize((px, px), Image.LANCZOS)
    o = Image.new('RGBA', (px, px), color + (0,)); o.putalpha(a2); return o
glyph(16, (0, 0, 0)).save(os.path.join(HERE, 'trayTemplate.png'))
glyph(32, (0, 0, 0)).save(os.path.join(HERE, 'trayTemplate@2x.png'))
glyph(32, (120, 190, 255)).save(os.path.join(HERE, 'tray.png'))
print('icon written')
