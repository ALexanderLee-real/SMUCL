# -*- coding: utf-8 -*-
"""
SMUCL logo pipeline:
  1. crop + square
  2. downscale to a small pixel grid (default 64x64) -> Minecraft-style pixel art
  3. palette quantize (limited color set, like MC textures)
  4. nearest-neighbour upscale (hard pixel edges, no blur)
  5. circular badge mask + MC-style bevel ring
  6. export png set + multi-size ico
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

SRC = r"C:\Users\Survaetr ExcelzZ\.workbuddy\clipboard-images\clipboard-2026-10-22T01-19-29-805Z-6d4508db.jpg"
OUT = r"C:\Users\Survaetr ExcelzZ\WorkBuddy\2026-10-22-09-19-19\SMUCL\assets"

GRID = 64          # pixel-art resolution
SCALE = 8          # 64 * 8 = 512
PALETTE = 22       # number of colors in the quantized palette
POSTERIZE = 5      # per-channel levels after quantize -> flat MC texture feel
RING = "#0d1220"   # outline color (near-black navy, MC GUI border)
RING_MID = "#2f5f9e"


def pixelize(img: Image.Image, grid: int = GRID) -> Image.Image:
    """Downscale to `grid`, punch up saturation, quantize, upscale with NEAREST."""
    # step-down in two passes keeps the silhouette cleaner than a single jump
    mid = img.resize((grid * 3, grid * 3), Image.LANCZOS)
    small = mid.resize((grid, grid), Image.LANCZOS)

    small = ImageEnhance.Color(small).enhance(1.30)
    small = ImageEnhance.Contrast(small).enhance(1.16)
    small = ImageEnhance.Brightness(small).enhance(0.97)
    small = ImageEnhance.Sharpness(small).enhance(1.45)

    # limited palette => Minecraft texture feel
    small = small.convert("RGB").quantize(colors=PALETTE, method=Image.MEDIANCUT, dither=Image.NONE)
    small = small.convert("RGB")
    # flatten the gradients into steps (textures, not photos)
    small = Image.eval(small, lambda v: round(v / 255 * (POSTERIZE - 1)) * (255 // (POSTERIZE - 1)))

    big = small.resize((grid * SCALE, grid * SCALE), Image.NEAREST)
    return big


def circular_badge(flat: Image.Image, ring_w: int = 14) -> Image.Image:
    """Cut to a circle, then wrap it in a thick MC-style bevel ring."""
    size = flat.size[0]
    ss = 4
    big = size * ss

    # --- hard circular alpha mask ---
    mask = Image.new("L", (big, big), 0)
    d = ImageDraw.Draw(mask)
    inset = 2 * ss
    d.ellipse([inset, inset, big - 1 - inset, big - 1 - inset], fill=255)
    mask = mask.resize((size, size), Image.LANCZOS).point(lambda v: 255 if v > 128 else 0)

    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(flat.convert("RGBA"), (0, 0), mask)

    # --- ring band ---
    ring = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    rd = ImageDraw.Draw(ring)
    w = ring_w * ss
    # outer edge of the band sits on the circle itself
    rd.ellipse([2 * ss, 2 * ss, big - 1 - 2 * ss, big - 1 - 2 * ss],
               outline=RING, width=w)
    ring = ring.resize((size, size), Image.LANCZOS)
    out.alpha_composite(ring)

    # --- bevel: light arc on the upper-left of the band, shadow lower-right ---
    bev = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    bd = ImageDraw.Draw(bev)
    band = w // 2                       # center line of the band
    r = (big // 2 - 2 * ss) - band      # arc radius = band center
    box = [big // 2 - r, big // 2 - r, big // 2 + r, big // 2 + r]
    bw = max(3, ring_w // 3) * ss
    bd.arc(box, start=178, end=322, fill=(150, 190, 245, 205), width=bw)   # highlight
    bd.arc(box, start=-12, end=95, fill=(0, 0, 0, 130), width=bw)          # shadow
    bev = bev.resize((size, size), Image.LANCZOS)
    bev.putalpha(Image.composite(bev.getchannel("A"), Image.new("L", (size, size), 0), mask))
    out.alpha_composite(bev)

    # --- 4px inner light seam so the artwork separates from the ring ---
    seam = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    sd = ImageDraw.Draw(seam)
    inner = 2 * ss + w
    sd.ellipse([inner, inner, big - 1 - inner, big - 1 - inner],
               outline=(255, 255, 255, 70), width=max(2, ss * 1))
    seam = seam.resize((size, size), Image.LANCZOS)
    out.alpha_composite(seam)

    final = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    final.paste(out, (0, 0), mask)
    return final


GLYPHS = {
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "C": ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
}


def make_wordmark(text="SMUCL", scale=10, gap=1, color=(255, 255, 255, 255)):
    """Render `text` from a 5x7 bitmap font, upscaled with hard pixels + dark outline."""
    cols = len(text) * 5 + (len(text) - 1) * gap
    rows = 7
    pad = 2
    cell = scale
    W = (cols + pad * 2) * cell
    H = (rows + pad * 2) * cell

    # 1) ink mask at final resolution (hard pixel cells)
    ink = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(ink)
    for i, ch in enumerate(text):
        g = GLYPHS[ch]
        ox = (pad + i * (5 + gap)) * cell
        oy = pad * cell
        for y, row in enumerate(g):
            for x, v in enumerate(row):
                if v == "1":
                    x0 = ox + x * cell
                    y0 = oy + y * cell
                    d.rectangle([x0, y0, x0 + cell - 1, y0 + cell - 1], fill=255)

    # 2) thin outline via dilation (keeps 1-cell gaps between strokes readable)
    outline_mask = ink.filter(ImageFilter.MaxFilter(2 * max(2, cell // 4) + 1))

    base = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dark = Image.new("RGBA", (W, H), (13, 18, 32, 255))
    base.paste(dark, (0, 0), outline_mask)

    fill = Image.new("RGBA", (W, H), color)
    base.paste(fill, (0, 0), ink)

    # 3) subtle top-light band, MC GUI style
    hi = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hi)
    hd.rectangle([0, 0, W, int(H * 0.20)], fill=(255, 255, 255, 22))
    hi.putalpha(Image.composite(hi.getchannel("A"), Image.new("L", (W, H), 0), ink))
    base.alpha_composite(hi)

    base.save(os.path.join(OUT, "wordmark.png"), "PNG")
    print("written wordmark.png", W, "x", H)


def main():
    os.makedirs(OUT, exist_ok=True)
    make_wordmark()
    src = Image.open(SRC).convert("RGB")

    # ---- square crop ----
    w, h = src.size
    side = min(w, h)
    src = src.crop(((w - side) // 2, (h - side) // 2, (w - side) // 2 + side, (h - side) // 2 + side))

    flat = pixelize(src)

    # ---- square (item-slot style) variant ----
    square = flat.copy()

    # ---- circular badge variant ----
    badge = circular_badge(flat)

    exports = [
        ("logo-mc.png", badge, 512),
        ("logo-mc-256.png", badge, 256),
        ("logo-mc-128.png", badge, 128),
        ("logo-mc-flat.png", square, 512),
        ("logo-mc-flat-128.png", square, 128),
    ]
    for name, im, px in exports:
        im.resize((px, px), Image.NEAREST).save(os.path.join(OUT, name), "PNG")
        print("written", name, px)

    # ---- .ico for the window / taskbar ----
    ico_sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)]
    badge.resize((256, 256), Image.NEAREST).save(
        os.path.join(OUT, "icon.ico"), format="ICO", sizes=ico_sizes
    )
    print("written icon.ico")

    # ---- favicon-sized preview strip ----
    preview = Image.new("RGBA", (512 + 256 + 128 + 64 + 32 + 60, 512), (26, 29, 38, 255))
    x = 10
    for px in (512, 256, 128, 64, 32):
        im = badge.resize((px, px), Image.NEAREST)
        preview.alpha_composite(im, (x, (512 - px) // 2))
        x += px + 10
    preview.save(os.path.join(OUT, "_preview.png"), "PNG")
    print("written _preview.png")


if __name__ == "__main__":
    main()
