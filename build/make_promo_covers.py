# -*- coding: utf-8 -*-
"""宣传片封面：B站 16:9 / 抖音 9:16"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "build", "promo")
LOGO = os.path.join(ROOT, "assets", "logo-mc.png")

FONT_CN_B = "C:/Windows/Fonts/msyhbd.ttc"
FONT_CN = "C:/Windows/Fonts/msyh.ttc"
FONT_EN_B = "C:/Windows/Fonts/segoeuib.ttf"
FONT_EN = "C:/Windows/Fonts/segoeui.ttf"

ACCENT = (122, 168, 240)
WHITE = (246, 249, 255)
GREY = (150, 162, 182)
GREEN = (108, 195, 95)


def bg(w, h, cx=0.5, cy=0.42):
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    dx = (x - w * cx) / (w * 0.62)
    dy = (y - h * cy) / (h * 0.80)
    d = np.sqrt(dx * dx + dy * dy)
    glow = np.clip(1.0 - d, 0, 1) ** 2.3
    img = np.zeros((h, w, 3), np.float32) + np.array([5, 7, 11], np.float32)
    img += glow[..., None] * np.array([26, 54, 100], np.float32)
    vx = (x - w / 2) / (w / 2)
    vy = (y - h / 2) / (h / 2)
    img *= (1 - 0.42 * np.clip((vx * vx + vy * vy) * 0.6, 0, 1))[..., None]
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), "RGB").convert("RGBA")


def tracked(d, s, f, center, fill, tracking=0):
    total = sum(d.textlength(c, font=f) + tracking for c in s) - tracking
    x = center[0] - total / 2
    for c in s:
        d.text((x, center[1]), c, font=f, fill=fill, anchor="lm")
        x += d.textlength(c, font=f) + tracking


def logo_glow(size):
    lg = Image.open(LOGO).convert("RGBA").resize((size, size), Image.LANCZOS)
    pad = 120
    cv = Image.new("RGBA", (size + pad * 2, size + pad * 2), (0, 0, 0, 0))
    cv.alpha_composite(lg, (pad, pad))
    a = cv.split()[3].point(lambda v: int(v * 0.6))
    a = a.point(lambda v: 0 if v < 20 else min(255, int((v - 20) * 1.6)))
    g = Image.new("RGBA", cv.size, (90, 140, 220, 0))
    g.putalpha(a.filter(ImageFilter.GaussianBlur(48)))
    return lg, g


def cover_wide():
    W, H = 1146, 717
    im = bg(W, H, 0.34, 0.44)
    lg, gl = logo_glow(280)
    im.alpha_composite(gl, (W - 300 - gl.width // 2 + 110, H // 2 - gl.height // 2))
    im.alpha_composite(lg, (W - 300 - 60, H // 2 - 140))

    d = ImageDraw.Draw(im)
    tracked(d, "SMUCL", ImageFont.truetype(FONT_EN_B, 96), (330, 210), WHITE, 14)
    d.text((96, 300), "上海海事大学 Minecraft 启动器", font=ImageFont.truetype(FONT_CN_B, 40), fill=WHITE)
    d.text((96, 372), "不用搬家，直接开玩", font=ImageFont.truetype(FONT_CN, 30), fill=GREY)
    d.text((96, 470), "接管 PCL 实例与存档 · 深色浅色 · 自动更新", font=ImageFont.truetype(FONT_CN, 22), fill=ACCENT)

    # 底部标签
    chip_f = ImageFont.truetype(FONT_CN, 20)
    x = 96
    for text, col in [("Windows", (36, 44, 60)), ("免费", (36, 44, 60)), ("开源 MIT", (36, 44, 60))]:
        w = d.textlength(text, font=chip_f) + 28
        d.rounded_rectangle([x, 560, x + w, 600], 10, fill=col + (255,), outline=(255, 255, 255, 30))
        d.text((x + 14, 580), text, font=chip_f, fill=(200, 210, 226), anchor="lm")
        x += w + 12

    im.convert("RGB").save(os.path.join(OUT, "cover_bilibili_1146x717.jpg"), "JPEG", quality=92)


def cover_vertical():
    W, H = 1080, 1920
    im = bg(W, H, 0.5, 0.38)
    lg, gl = logo_glow(420)
    im.alpha_composite(gl, (W // 2 - gl.width // 2, 500 - gl.height // 2))
    im.alpha_composite(lg, (W // 2 - 210, 290))

    d = ImageDraw.Draw(im)
    tracked(d, "SMUCL", ImageFont.truetype(FONT_EN_B, 150), (W // 2, 880), WHITE, 22)
    d.text((W // 2, 1010), "上海海事大学 Minecraft 启动器",
           font=ImageFont.truetype(FONT_CN_B, 48), fill=WHITE, anchor="mm")

    d.text((W // 2, 1160), "不用搬家", font=ImageFont.truetype(FONT_CN_B, 96), fill=WHITE, anchor="mm")
    d.text((W // 2, 1280), "直接开玩", font=ImageFont.truetype(FONT_CN_B, 96), fill=ACCENT, anchor="mm")

    d.text((W // 2, 1480), "github.com/Survaetr/SMUCL",
           font=ImageFont.truetype(FONT_EN, 40), fill=(210, 220, 236), anchor="mm")

    chip_f = ImageFont.truetype(FONT_CN, 30)
    labels = "WINDOWS · 免费 · 开源"
    w = sum(d.textlength(c, font=chip_f) + 3 for c in labels) + 96
    d.rounded_rectangle([W // 2 - w / 2, 1580, W // 2 + w / 2, 1656], 18,
                        fill=(22, 29, 44, 255), outline=(90, 104, 128, 255))
    tracked(d, labels, chip_f, (W // 2, 1618), GREY, 3)

    im.convert("RGB").save(os.path.join(OUT, "cover_douyin_1080x1920.jpg"), "JPEG", quality=92)


if __name__ == "__main__":
    cover_wide()
    cover_vertical()
    print("封面已生成")
