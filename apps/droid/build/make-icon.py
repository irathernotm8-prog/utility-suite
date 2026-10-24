# Regenerates build/icon.png (run: python3 build/make-icon.py). Needs Pillow.
# A deep graphite-green tile with a soft green glow and two virtual phones: one tilted behind,
# and one in front whose screen glows lime-to-teal with a grid of app tiles.
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
bg = lin((N, N), (22, 36, 31), (8, 11, 12), 0)
glow = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ImageDraw.Draw(glow).ellipse((P(170), P(330), P(870), P(1000)), fill=(73, 224, 138, 70))
bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(P(110))))
top = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ImageDraw.Draw(top).ellipse((P(260), P(-160), P(980), P(380)), fill=(196, 245, 106, 26))
bg = Image.alpha_composite(bg, top.filter(ImageFilter.GaussianBlur(P(90))))

def phone(box, body0, body1, scr0, scr1, angle, tiles=True, alpha=255):
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    L = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    m = Image.new('L', (N, N), 0); ImageDraw.Draw(m).rounded_rectangle((P(x0), P(y0), P(x1), P(y1)), radius=P(w * 0.2), fill=255)
    body = lin((N, N), body0, body1, -60); L.paste(body, mask=m)
    bz = w * 0.075
    sm = Image.new('L', (N, N), 0); ImageDraw.Draw(sm).rounded_rectangle((P(x0 + bz), P(y0 + bz), P(x1 - bz), P(y1 - bz)), radius=P(w * 0.15), fill=255)
    scr = lin((N, N), scr0, scr1, -55); L.paste(scr, mask=sm)
    d = ImageDraw.Draw(L)
    # punch-hole camera
    cx = (x0 + x1) / 2; cy = y0 + bz + w * 0.07
    d.ellipse((P(cx - w * 0.035), P(cy - w * 0.035), P(cx + w * 0.035), P(cy + w * 0.035)), fill=(6, 14, 10, 255))
    if tiles:
        g = w * 0.16; gap = w * 0.08; sx = cx - g - gap / 2; sy = y0 + h * 0.36
        for r in range(3):
            for c in range(2):
                tx = sx + c * (g + gap); ty = sy + r * (g + gap)
                a = 235 if (r, c) != (0, 1) else 120
                d.rounded_rectangle((P(tx), P(ty), P(tx + g), P(ty + g)), radius=P(g * 0.3), fill=(255, 255, 255, a))
        d.rounded_rectangle((P(cx - w * 0.16), P(y1 - bz - w * 0.09), P(cx + w * 0.16), P(y1 - bz - w * 0.065)), radius=P(w * 0.02), fill=(255, 255, 255, 200))
    # subtle edge highlight
    edge = ImageChops.subtract(m, m.filter(ImageFilter.MinFilter(int(P(6)) | 1)))
    hl = Image.new('RGBA', (N, N), (255, 255, 255, 0)); hl.putalpha(edge.point(lambda v: v * 70 // 255)); L = Image.alpha_composite(L, hl)
    if alpha < 255: L.putalpha(L.getchannel('A').point(lambda v: v * alpha // 255))
    sh = Image.new('RGBA', (N, N), (0, 0, 0, 0)); sh.paste((0, 0, 0, 170), mask=m)
    sh = ImageChops.offset(sh, 0, int(P(26))).filter(ImageFilter.GaussianBlur(P(34)))
    if angle:
        L = L.rotate(angle, resample=Image.BICUBIC, center=(P((x0 + x1) / 2), P((y0 + y1) / 2)))
        sh = sh.rotate(angle, resample=Image.BICUBIC, center=(P((x0 + x1) / 2), P((y0 + y1) / 2)))
    return sh, L

back_sh, back = phone((402, 208, 712, 792), (60, 78, 74), (26, 34, 34), (31, 198, 180), (22, 86, 110), -14, tiles=False, alpha=235)
front_sh, front = phone((300, 236, 616, 836), (44, 52, 52), (16, 20, 21), (196, 245, 106), (31, 198, 180), 6)
out = bg
out = Image.alpha_composite(out, back_sh); out = Image.alpha_composite(out, back)
fg = Image.new('RGBA', (N, N), (0, 0, 0, 0)); fg.paste((73, 224, 138, 80), mask=front.getchannel('A'))
out = Image.alpha_composite(out, fg.filter(ImageFilter.GaussianBlur(P(50))))
out = Image.alpha_composite(out, front_sh); out = Image.alpha_composite(out, front)

sheen = Image.new('RGBA', (N, N), (0, 0, 0, 0))
ImageDraw.Draw(sheen).ellipse((P(-200), P(-640), P(1224), P(300)), fill=(255, 255, 255, 12))
out = Image.alpha_composite(out, sheen.filter(ImageFilter.GaussianBlur(P(30))))
rim = ImageChops.subtract(mask, mask.filter(ImageFilter.MinFilter(int(N * .004) * 2 + 1)))
out.putalpha(mask)
rl = Image.new('RGBA', (N, N), (200, 255, 220, 255)); rl.putalpha(rim.point(lambda v: v * 46 // 255)); out = Image.alpha_composite(out, rl)
out.resize((1024, 1024), Image.LANCZOS).save(os.path.join(HERE, 'icon.png'))
print('icon written')
