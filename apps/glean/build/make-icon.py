# NOTE: build/icon.png is now drawn from build/icon.svg (the Utility Suite icon family). Running this script
# overwrites icon.png with the old design; keep only its tray-icon output if you rerun it.
# Regenerates build/icon.png (run: python3 build/make-icon.py). Needs Pillow.
# A porcelain tile with a fanned stack of photos (an iris-to-rose sunset over hills on top),
# gathered by an iris badge with a down arrow.
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
bg = lin((N, N), (255, 255, 255), (231, 227, 242), 0)
glow = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ImageDraw.Draw(glow).ellipse((P(120), P(620), P(1100), P(1300)), fill=(150, 120, 255, 60))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(P(90))))

def card(cx, cy, w, h, angle, art, frame=(255, 255, 255)):
    """A photo with a white frame, rotated about its centre. Returns (layer, shadow)."""
    W = int(P(w)); H = int(P(h)); pad = int(P(21)); r = int(P(34))
    tile = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    m = Image.new('L', (W, H), 0); ImageDraw.Draw(m).rounded_rectangle((0, 0, W - 1, H - 1), radius=r, fill=255)
    tile.paste(frame + (255,), mask=m)
    inner = art(W - 2 * pad, H - 2 * pad - int(P(10)))
    im = Image.new('L', inner.size, 0); ImageDraw.Draw(im).rounded_rectangle((0, 0, inner.size[0] - 1, inner.size[1] - 1), radius=int(P(22)), fill=255)
    tile.paste(inner, (pad, pad), im)
    big = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    rot = tile.rotate(angle, resample=Image.BICUBIC, expand=True)
    big.alpha_composite(rot, (int(P(cx) - rot.size[0] / 2), int(P(cy) - rot.size[1] / 2)))
    sh = Image.new('RGBA', (N, N), (0, 0, 0, 0)); sh.paste((40, 20, 90, 120), mask=big.getchannel('A'))
    sh = ImageChops.offset(sh.filter(ImageFilter.GaussianBlur(P(24))), 0, int(P(20)))
    return big, sh

def art_sunset(w, h):
    a = lin((w, h), (104, 90, 250), (255, 150, 196), 0)              # iris sky to rose
    d = ImageDraw.Draw(a)
    d.ellipse((w * .58, h * .2, w * .82, h * .2 + w * .24), fill=(255, 226, 170, 255))  # sun
    hill1 = [(0, h * .72), (w * .3, h * .5), (w * .55, h * .66), (w * .8, h * .48), (w, h * .6), (w, h), (0, h)]
    hill2 = [(0, h * .86), (w * .4, h * .7), (w * .75, h * .84), (w, h * .76), (w, h), (0, h)]
    d.polygon(hill1, fill=(72, 52, 170, 255)); d.polygon(hill2, fill=(42, 30, 110, 255))
    return a
def art_mint(w, h):
    a = lin((w, h), (120, 220, 200), (70, 150, 240), 0); d = ImageDraw.Draw(a)
    d.ellipse((w * .2, h * .25, w * .45, h * .25 + w * .25), fill=(255, 255, 255, 200)); return a
def art_peach(w, h):
    a = lin((w, h), (255, 200, 120), (255, 120, 140), 0); d = ImageDraw.Draw(a)
    d.rectangle((0, h * .7, w, h), fill=(230, 90, 120, 255)); return a

back, sb = card(410, 488, 312, 370, 13, art_mint)
mid, sm = card(616, 488, 312, 370, -12, art_peach)
front, sf = card(508, 506, 352, 418, 0, art_sunset)

out = bg
for layer in (sb, back, sm, mid, sf, front): out = Image.alpha_composite(out, layer)

# badge: iris circle with a white down arrow, bottom right
bx, by, br = 680, 690, 98
bm = Image.new('L', (N, N), 0); ImageDraw.Draw(bm).ellipse((P(bx - br), P(by - br), P(bx + br), P(by + br)), fill=255)
ring = Image.new('L', (N, N), 0); ImageDraw.Draw(ring).ellipse((P(bx - br - 15), P(by - br - 15), P(bx + br + 15), P(by + br + 15)), fill=255)
bsh = Image.new('RGBA', (N, N), (0, 0, 0, 0)); bsh.paste((50, 20, 120, 150), mask=ring)
bsh = ImageChops.offset(bsh.filter(ImageFilter.GaussianBlur(P(20))), 0, int(P(14)))
ringl = Image.new('RGBA', (N, N), (0, 0, 0, 0)); ringl.paste((255, 255, 255, 255), mask=ring)
grad = lin((N, N), (98, 84, 250), (196, 96, 220), -45)
badge = Image.new('RGBA', (N, N), (0, 0, 0, 0)); badge.paste(grad, mask=bm)
ad = ImageDraw.Draw(badge); lw = int(P(23))
ad.line([(P(bx), P(by - 48)), (P(bx), P(by + 38))], fill=(255, 255, 255, 255), width=lw)
ad.line([(P(bx - 39), P(by + 1)), (P(bx), P(by + 40)), (P(bx + 39), P(by + 1))], fill=(255, 255, 255, 255), width=lw, joint='curve')
for p in [(bx, by - 48), (bx - 39, by + 1), (bx + 39, by + 1), (bx, by + 40)]:
    ad.ellipse((P(p[0]) - lw / 2, P(p[1]) - lw / 2, P(p[0]) + lw / 2, P(p[1]) + lw / 2), fill=(255, 255, 255, 255))
for layer in (bsh, ringl, badge): out = Image.alpha_composite(out, layer)

rim = ImageChops.subtract(mask, mask.filter(ImageFilter.MinFilter(int(N * .004) * 2 + 1)))
out.putalpha(mask)
rl = Image.new('RGBA', (N, N), (120, 100, 200, 255)); rl.putalpha(rim.point(lambda v: v * 40 // 255)); out = Image.alpha_composite(out, rl)
out.resize((1024, 1024), Image.LANCZOS).save(os.path.join(HERE, 'icon.png'))
print('icon written')
