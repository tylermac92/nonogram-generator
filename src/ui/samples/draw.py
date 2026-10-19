"""Draws cat.jpg, sailboat.jpg and skyline.jpg: dark subjects on a soft sky, with grain. Needs Pillow."""
import random, sys
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
W, H, K = 600, 450, 2  # drawn at 2x, then downsampled for soft edges


def sky(top, bottom):
    img = Image.new('RGB', (W * K, H * K))
    d = ImageDraw.Draw(img)
    for y in range(H * K):
        t = y / (H * K - 1)
        d.line([(0, y), (W * K, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
    return img, d


def finish(img, name, seed):
    img = img.resize((W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.8))
    rnd = random.Random(seed)
    px = img.load()
    for y in range(H):
        for x in range(W):
            n = rnd.randint(-10, 10)
            px[x, y] = tuple(max(0, min(255, c + n)) for c in px[x, y])
    img.save(f'{OUT}/{name}.jpg', quality=85, optimize=True)


def s(*v):
    return [c * K for c in v]


INK = (28, 24, 36)

# Cat sitting on a wall at dusk
img, d = sky((250, 190, 140), (190, 120, 160))
d.rectangle(s(0, 380, 600, 450), fill=INK)  # wall
d.ellipse(s(220, 210, 370, 390), fill=INK)  # body
d.ellipse(s(250, 120, 350, 225), fill=INK)  # head
d.polygon(s(258, 160, 262, 85, 300, 135), fill=INK)  # ears
d.polygon(s(342, 160, 338, 85, 300, 135), fill=INK)
d.arc(s(330, 260, 470, 400), 270, 90, fill=INK, width=22 * K)  # tail
finish(img, 'cat', 1)

# Sailboat at sunset
img, d = sky((255, 215, 150), (240, 150, 110))
d.rectangle(s(0, 340, 600, 450), fill=(120, 140, 170))  # sea
for y in range(350, 450, 18):
    d.line(s(0, y, 600, y), fill=(150, 165, 190), width=3 * K)
d.polygon(s(300, 60, 300, 300, 160, 300), fill=INK)  # mainsail
d.polygon(s(312, 90, 312, 300, 430, 300), fill=INK)  # jib
d.rectangle(s(300, 50, 308, 320), fill=INK)  # mast
d.polygon(s(140, 315, 460, 315, 420, 365, 180, 365), fill=INK)  # hull
finish(img, 'sailboat', 2)

# City skyline at twilight, with lit windows
img, d = sky((170, 190, 230), (240, 200, 170))
rnd = random.Random(3)
x = 0
while x < 600:
    w = rnd.randint(50, 95)
    top = rnd.randint(120, 330)
    d.rectangle(s(x, top, x + w, 450), fill=INK)
    for wy in range(top + 14, 430, 26):
        for wx in range(x + 10, x + w - 14, 20):
            if rnd.random() < 0.45:
                d.rectangle(s(wx, wy, wx + 9, wy + 12), fill=(250, 220, 130))
    x += w + rnd.randint(4, 14)
finish(img, 'skyline', 3)
