# -*- coding: utf-8 -*-
"""
SMUCL logo v3（最终）—— 校徽 × Minecraft × 航海：舵轮
校徽圆章作为舵轮中心盘（含 1909），木质轮缘 + 8 根手柄，全像素手绘。

输出
  assets/logo-mc.png        512 RGBA（透明，用于界面/标题栏）
  assets/logo-mc-256.png    256
  assets/logo-mc-128.png    128
  assets/logo-mc-flat.png   512 RGB（深色底板，用于商店图/预览）
  assets/icon.ico           16/24/32/48/64/128/256
"""
import math
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")

GRID = 64
SIZE = 512
SCALE = SIZE // GRID

# 木头：车木同心纹（深-中-浅三阶）
WOOD = ["#b0814d", "#946640", "#78502f", "#57381d", "#3a2410"]
NAVY = ["#3d7bd0", "#2b5fa8", "#1d4479", "#123059"]
WHITE = "#f4f9ff"
WHITE_DIM = "#c9d9ef"
GOLD = "#e9b64a"
INK = "#0a1526"

GLYPH = {
    "1": ["010", "110", "010", "010", "111"],
    "9": ["111", "101", "111", "001", "110"],
    "0": ["111", "101", "101", "101", "111"],
}


def canvas():
    img = Image.new("RGBA", (GRID, GRID), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def disc(d, cx, cy, r, color):
    for y in range(GRID):
        for x in range(GRID):
            if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r:
                d.point((x, y), fill=color)


def band(d, cx, cy, r_out, r_in, color):
    for y in range(GRID):
        for x in range(GRID):
            dist = ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) ** 0.5
            if r_in <= dist <= r_out:
                d.point((x, y), fill=color)


def draw_emblem(d, cx, cy, r):
    """蓝底圆章：白环 + 帆船 + 波浪 + 1909"""
    disc(d, cx, cy, r, INK)
    disc(d, cx, cy, r - 0.9, GOLD)
    disc(d, cx, cy, r - 2.0, NAVY[0])
    disc(d, cx, cy, r - 2.8, NAVY[1])
    band(d, cx, cy, r - 2.8, r - 3.6, NAVY[2])

    u = r / 10.0
    hull_top = cy + 1.6 * u
    hull_bottom = cy + 3.6 * u
    for y in range(int(hull_top), int(hull_bottom) + 1):
        t = (y - hull_top) / max(1.0, hull_bottom - hull_top)
        half = (4.6 - 2.1 * t) * u
        for x in range(int(cx - half), int(cx + half) + 1):
            d.point((x, y), fill=WHITE if y < hull_bottom - 0.4 else WHITE_DIM)

    mast_x = int(round(cx - 0.9 * u))
    mast_top = int(cy - 4.6 * u)
    for y in range(mast_top, int(hull_top) + 1):
        d.point((mast_x, y), fill=WHITE)

    sail_h = int(4.3 * u)
    for i in range(sail_h):
        y = mast_top + 1 + i
        width = int((i + 1) / sail_h * 3.5 * u)
        for x in range(mast_x + 1, mast_x + 1 + width):
            d.point((x, y), fill=WHITE)

    for i in range(int(2.4 * u)):
        y = mast_top + int(1.3 * u) + i
        width = int((i + 1) / (2.4 * u) * 2.0 * u)
        for x in range(mast_x - width, mast_x):
            d.point((x, y), fill=WHITE_DIM)

    for row, col in ((0, WHITE), (1, WHITE_DIM)):
        y = int(hull_bottom + (1.3 + row * 1.5) * u)
        step = max(1, int(1.6 * u))
        for i in range(-int(4.2 * u), int(4.2 * u) + 1):
            xx = int(cx + i)
            yy = y + (0 if (i // step) % 2 == 0 else 1)
            d.point((xx, yy), fill=col)

    if r >= 11:
        y0 = int(cy + r * 0.47)
        text = "1909"
        gw, gap = 3, 1
        total = len(text) * gw + (len(text) - 1) * gap
        x0 = int(round(cx - total / 2))
        for idx, ch in enumerate(text):
            for ry, row_s in enumerate(GLYPH[ch]):
                for rx, bit in enumerate(row_s):
                    if bit == "1":
                        d.point((x0 + idx * (gw + gap) + rx, y0 + ry), fill=WHITE)


def draw_wheel(d, cx=32.0, cy=32.0):
    R_OUT, R_IN = 27, 21

    # ---- 轮毂底盘（避免辐条之间露出透明） ----
    disc(d, cx, cy, R_IN + 0.6, WOOD[2])
    for y in range(GRID):
        for x in range(GRID):
            if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= (R_IN + 0.6) ** 2:
                if (x * 3 + y * 5) % 11 == 0:
                    d.point((x, y), fill=WOOD[4])

    # ---- 轮缘：同心车木纹 ----
    for y in range(GRID):
        for x in range(GRID):
            dist = ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) ** 0.5
            if R_IN <= dist <= R_OUT:
                ring = int((R_OUT - dist) / 1.6) % 3
                d.point((x, y), fill=WOOD[1] if ring == 0 else (WOOD[2] if ring == 1 else WOOD[3]))

    # 轮缘内外描边 + 高光
    band(d, cx, cy, R_OUT, R_OUT - 1.1, INK)
    band(d, cx, cy, R_IN + 1.1, R_IN, INK)
    band(d, cx, cy, R_OUT - 1.6, R_OUT - 2.6, WOOD[0])

    # ---- 辐条（4 条直线 = 8 根），带深色描边 ----
    for k in range(4):
        ang = math.radians(k * 45)
        dx, dy = math.cos(ang), math.sin(ang)
        for t in range(-(R_IN + 1), R_IN + 2):
            if abs(t) < 12:
                continue
            x = int(round(cx + dx * t))
            y = int(round(cy + dy * t))
            if not (0 <= x < GRID and 0 <= y < GRID):
                continue
            d.rectangle([x - 1, y - 1, x + 1, y], fill=WOOD[1])
            d.point((x - 1, y - 1), fill=WOOD[2])
            d.point((x + 1, y), fill=WOOD[4])

    # ---- 8 根手柄：与辐条同一角度，露出轮缘外 ----
    for k in range(8):
        ang = math.radians(k * 45)
        dx, dy = math.cos(ang), math.sin(ang)
        for t in range(R_OUT - 3, R_OUT + 4):
            x = int(round(cx + dx * t))
            y = int(round(cy + dy * t))
            if not (0 <= x < GRID and 0 <= y < GRID):
                continue
            # 3 格宽的手柄 + 深色描边
            for ox, oy in ((-1, -1), (0, -1), (1, -1), (-1, 0), (0, 0), (1, 0)):
                px, py = x + ox, y + oy
                if 0 <= px < GRID and 0 <= py < GRID:
                    d.point((px, py), fill=WOOD[1])
            d.point((x - 1, y - 1), fill=WOOD[0])
            d.point((x + 1, y), fill=WOOD[4])

    # ---- 中心校徽 ----
    draw_emblem(d, cx, cy, 19)
    band(d, cx, cy, 19.9, 19.2, INK)


def build():
    img, d = canvas()
    draw_wheel(d)

    # 整体轮廓：给透明边缘补一圈墨线，避免深色背景上糊掉
    alpha = img.split()[3]
    outline = alpha.filter(__import__("PIL.ImageFilter", fromlist=["ImageFilter"]).MaxFilter(3))
    out_img = Image.new("RGBA", (GRID, GRID), (0, 0, 0, 0))
    ink_layer = Image.new("RGBA", (GRID, GRID), (10, 21, 38, 255))
    out_img.paste(ink_layer, (0, 0), outline)
    out_img.alpha_composite(img)

    big = out_img.resize((SIZE, SIZE), Image.NEAREST)
    big.save(os.path.join(ASSETS, "logo-mc.png"))
    big.resize((256, 256), Image.NEAREST).save(os.path.join(ASSETS, "logo-mc-256.png"))
    big.resize((128, 128), Image.NEAREST).save(os.path.join(ASSETS, "logo-mc-128.png"))

    # 深色底板版本
    flat = Image.new("RGB", (SIZE, SIZE), "#0e1420")
    flat.paste(big, (0, 0), big)
    flat.save(os.path.join(ASSETS, "logo-mc-flat.png"))
    flat.resize((128, 128), Image.NEAREST).save(os.path.join(ASSETS, "logo-mc-flat-128.png"))

    # 多尺寸 ico
    big.save(
        os.path.join(ASSETS, "icon.ico"),
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print("logo 已更新")


if __name__ == "__main__":
    build()
