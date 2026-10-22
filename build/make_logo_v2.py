# -*- coding: utf-8 -*-
"""
SMUCL logo v2 —— 校徽 × Minecraft
校徽不做照片下采样，改为符号化重绘：蓝底圆章 + 帆船 + 波浪 + 1909。
全部在 64 格像素网格上手工绘制，最近邻放大，保证 32px 图标仍然清晰。

方案：
  A 草方块立牌（正视）—— 草皮 + 泥土 + 嵌在中间的校徽
  B 等距方块（斜视）—— 立方体顶面立着校徽圆章
  C 盾牌 —— MC 盾的轮廓 + 校徽
输出：build/logo-concepts/
"""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), "logo-concepts")
os.makedirs(OUT, exist_ok=True)

GRID = 64
SCALE = 8
SIZE = GRID * SCALE

# ---------------- 调色板 ----------------
GRASS = ["#7cc45c", "#63a847", "#4d8737", "#3a6b29"]
DIRT = ["#90603f", "#7a4f33", "#63402a", "#4d311f"]
STONE = ["#a7adb4", "#8b929a", "#6f767e", "#565c64"]
NAVY = ["#3470c6", "#26559c", "#1b3f75", "#122c52", "#0d2140"]
WHITE = "#f2f7ff"
WHITE_DIM = "#c8d8ee"
GOLD = "#e9b64a"
INK = "#0a1526"


def canvas():
    img = Image.new("RGBA", (GRID, GRID), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def save(img, name):
    img.resize((SIZE, SIZE), Image.NEAREST).save(os.path.join(OUT, name))
    img.resize((128, 128), Image.NEAREST).save(os.path.join(OUT, name.replace(".png", "-128.png")))
    img.resize((32, 32), Image.NEAREST).save(os.path.join(OUT, name.replace(".png", "-32.png")))


def disc(d, cx, cy, r, color):
    y0, y1 = int(cy - r) - 1, int(cy + r) + 2
    x0, x1 = int(cx - r) - 1, int(cx + r) + 2
    for y in range(max(0, y0), min(GRID, y1)):
        for x in range(max(0, x0), min(GRID, x1)):
            if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r:
                d.point((x, y), fill=color)


def band(d, cx, cy, r_out, r_in, color):
    y0, y1 = int(cy - r_out) - 1, int(cy + r_out) + 2
    x0, x1 = int(cx - r_out) - 1, int(cx + r_out) + 2
    for y in range(max(0, y0), min(GRID, y1)):
        for x in range(max(0, x0), min(GRID, x1)):
            dist = ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) ** 0.5
            if r_in <= dist <= r_out:
                d.point((x, y), fill=color)


GLYPH = {
    "1": ["010", "110", "010", "010", "111"],
    "9": ["111", "101", "111", "001", "110"],
    "0": ["111", "101", "101", "101", "111"],
}


def draw_emblem(d, cx, cy, r, year=True):
    """蓝底圆章：白环 + 帆船 + 波浪 + 1909"""
    disc(d, cx, cy, r, INK)
    disc(d, cx, cy, r - 0.8, WHITE)
    disc(d, cx, cy, r - 2.6, NAVY[0])
    disc(d, cx, cy, r - 3.4, NAVY[1])
    band(d, cx, cy, r - 3.4, r - 3.9, NAVY[2])

    u = r / 10.0

    # 船体：上宽下窄的梯形
    hull_top = cy + 1.6 * u
    hull_bottom = cy + 3.6 * u
    for y in range(int(hull_top), int(hull_bottom) + 1):
        t = (y - hull_top) / max(1.0, hull_bottom - hull_top)
        half = (4.6 - 2.1 * t) * u
        for x in range(int(cx - half), int(cx + half) + 1):
            d.point((x, y), fill=WHITE if y < hull_bottom - 0.4 else WHITE_DIM)

    # 桅杆
    mast_x = int(round(cx - 0.8 * u))
    mast_top = int(cy - 4.6 * u)
    for y in range(mast_top, int(hull_top) + 1):
        d.point((mast_x, y), fill=WHITE)

    # 主帆（右侧三角）
    sail_h = int(4.4 * u)
    for i in range(sail_h):
        y = mast_top + 1 + i
        width = int((i + 1) / sail_h * 3.6 * u)
        for x in range(mast_x + 1, mast_x + 1 + width):
            d.point((x, y), fill=WHITE)

    # 前帆（左侧小三角）
    for i in range(int(2.6 * u)):
        y = mast_top + int(1.2 * u) + i
        width = int((i + 1) / (2.6 * u) * 2.2 * u)
        for x in range(mast_x - width, mast_x):
            d.point((x, y), fill=WHITE_DIM)

    # 波浪两道
    for row, col in ((0, WHITE), (1, WHITE_DIM)):
        y = int(hull_bottom + (1.4 + row * 1.5) * u)
        step = max(1, int(1.6 * u))
        for i in range(-int(4.4 * u), int(4.4 * u) + 1):
            xx = int(cx + i)
            yy = y + (0 if (i // step) % 2 == 0 else 1)
            d.point((xx, yy), fill=col)

    # 1909
    if year and r >= 12:
        y0 = int(cy + r * 0.60)
        text = "1909"
        gw, gap = 3, 1
        total = len(text) * gw + (len(text) - 1) * gap
        x0 = int(round(cx - total / 2))
        for idx, ch in enumerate(text):
            for ry, row_s in enumerate(GLYPH[ch]):
                for rx, bit in enumerate(row_s):
                    if bit == "1":
                        d.point((x0 + idx * (gw + gap) + rx, y0 + ry), fill=WHITE)


# ---------------- A：草方块立牌 ----------------
def concept_a():
    img, d = canvas()
    # 整块底色：草皮 14 行 + 泥土
    for y in range(GRID):
        for x in range(GRID):
            if y < 14:
                d.point((x, y), fill=GRASS[1] if (x // 3 + y // 3) % 3 else GRASS[0])
            else:
                d.point((x, y), fill=DIRT[1] if (x * 7 + y * 13) % 11 else DIRT[2])

    # 草皮锯齿下缘
    teeth = [15, 16, 14, 17, 15, 16, 18, 14]
    for x in range(GRID):
        for y in range(14, 14 + (teeth[x % len(teeth)] - 14)):
            d.point((x, y), fill=GRASS[2])

    # 顶部高光
    for x in range(GRID):
        d.point((x, 0), fill=GRASS[0])

    # 中央校徽（带白环外描边）
    draw_emblem(d, GRID / 2, GRID / 2 + 3, 21)

    # 四角切角，做出方块图标感
    for (x, y) in [(0, 0), (1, 0), (0, 1), (GRID - 1, 0), (GRID - 2, 0), (GRID - 1, 1),
                   (0, GRID - 1), (1, GRID - 1), (0, GRID - 2),
                   (GRID - 1, GRID - 1), (GRID - 2, GRID - 1), (GRID - 1, GRID - 2)]:
        d.point((x, y), fill=(0, 0, 0, 0))
    save(img, "concept-a.png")


# ---------------- B：等距方块 + 校徽 ----------------
def concept_b():
    img, d = canvas()
    cx, cy = 32.0, 30.0          # 顶面中心
    w, depth = 27, 17            # 半宽、厚度
    h = w // 2

    top = [(cx, cy - h), (cx + w, cy), (cx, cy + h), (cx - w, cy)]
    left = [(cx - w, cy), (cx, cy + h), (cx, cy + h + depth), (cx - w, cy + depth)]
    right = [(cx + w, cy), (cx, cy + h), (cx, cy + h + depth), (cx + w, cy + depth)]

    top_mask = Image.new("L", (GRID, GRID), 0)
    ImageDraw.Draw(top_mask).polygon(top, fill=255)
    left_mask = Image.new("L", (GRID, GRID), 0)
    ImageDraw.Draw(left_mask).polygon(left, fill=255)
    right_mask = Image.new("L", (GRID, GRID), 0)
    ImageDraw.Draw(right_mask).polygon(right, fill=255)

    d.polygon(top, fill=GRASS[1])
    d.polygon(left, fill=DIRT[1])
    d.polygon(right, fill=DIRT[0])

    # 顶面斑点
    for y in range(GRID):
        for x in range(GRID):
            if top_mask.getpixel((x, y)):
                if (x * 5 + y * 3) % 13 == 0:
                    d.point((x, y), fill=GRASS[0])
                elif (x * 3 + y * 7) % 17 == 0:
                    d.point((x, y), fill=GRASS[2])

    # 侧面纹理
    for y in range(GRID):
        for x in range(GRID):
            if left_mask.getpixel((x, y)) and (x * 7 + y * 5) % 9 == 0:
                d.point((x, y), fill=DIRT[2])
            if right_mask.getpixel((x, y)) and (x * 5 + y * 11) % 8 == 0:
                d.point((x, y), fill=DIRT[1])

    # 侧面上沿的草皮（贴着顶面往下 3 行）
    for x in range(GRID):
        for y in range(GRID):
            if left_mask.getpixel((x, y)):
                edge = cy + (cx - (x + 0.5)) * (h / w)
                if edge <= y + 0.5 <= edge + 3:
                    d.point((x, y), fill=GRASS[2] if (x + y) % 4 else GRASS[3])
            if right_mask.getpixel((x, y)):
                edge = cy + ((x + 0.5) - cx) * (h / w)
                if edge <= y + 0.5 <= edge + 3:
                    d.point((x, y), fill=GRASS[2] if (x + y) % 4 else GRASS[3])

    # 立方体描边
    for poly in (top, left, right):
        for i in range(len(poly)):
            d.line([poly[i], poly[(i + 1) % len(poly)]], fill=INK)

    # 顶面中央的校徽（略小，压在草皮上）
    draw_emblem(d, cx, cy - 1, 13, year=False)
    save(img, "concept-b.png")


# ---------------- C：盾牌 ----------------
def concept_c():
    img, d = canvas()
    cx = 32.0
    top_y, bot_y = 6, 58
    half = 21

    for y in range(top_y, bot_y):
        t = (y - top_y) / (bot_y - top_y)
        # 上部平直，下部收成盾尖
        wide = half if t < 0.55 else half * (1 - ((t - 0.55) / 0.45) ** 1.7)
        for x in range(int(cx - wide), int(cx + wide) + 1):
            d.point((x, y), fill=INK)
        for x in range(int(cx - wide) + 2, int(cx + wide) - 1):
            d.point((x, y), fill=NAVY[2] if t < 0.5 else NAVY[3])

    # 内圈描边
    for y in range(top_y, bot_y):
        t = (y - top_y) / (bot_y - top_y)
        wide = (half if t < 0.55 else half * (1 - ((t - 0.55) / 0.45) ** 1.7)) - 3
        if wide <= 2:
            continue
        d.point((int(cx - wide), y), fill=GOLD)
        d.point((int(cx + wide), y), fill=GOLD)

    # 顶部装饰铆钉
    for x in range(int(cx - half) + 4, int(cx + half) - 3, 6):
        d.point((x, top_y + 3), fill=GOLD)

    draw_emblem(d, cx, 30, 15, year=False)
    save(img, "concept-c.png")


if __name__ == "__main__":
    concept_a()
    concept_b()
    concept_c()
    print("ok")
