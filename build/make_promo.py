# -*- coding: utf-8 -*-
"""
SMUCL 宣传片渲染器 —— 发布会风格（逐帧程序化渲染）
1920x1080 / 60fps / 约 41 秒
"""
import os
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "build", "promo")
os.makedirs(OUT, exist_ok=True)

W, H, FPS = 1920, 1080, 60
DUR = 41.0

SHOT = os.path.join(ROOT, "docs", "screenshots")
LOGO = os.path.join(ROOT, "assets", "logo-mc.png")

FONT_CN_B = "C:/Windows/Fonts/msyhbd.ttc"
FONT_CN = "C:/Windows/Fonts/msyh.ttc"
FONT_EN_B = "C:/Windows/Fonts/segoeuib.ttf"
FONT_EN = "C:/Windows/Fonts/segoeui.ttf"

BG_DEEP = np.array([5, 7, 11], float)
BG_GLOW = np.array([26, 54, 100], float)
ACCENT = (122, 168, 240)
WHITE = (246, 249, 255)
GREY = (150, 162, 182)


# ---------------------------------------------------------------- 缓动
def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def ease_out_expo(x):
    x = clamp(x)
    return 1.0 if x >= 1 else 1 - 2 ** (-10 * x)


def ease_out_cubic(x):
    x = clamp(x)
    return 1 - (1 - x) ** 3


def ease_in_out(x):
    x = clamp(x)
    return 3 * x * x - 2 * x * x * x


def seg(t, t0, t1):
    """把 t0..t1 映射到 0..1"""
    if t1 <= t0:
        return 1.0 if t >= t1 else 0.0
    return clamp((t - t0) / (t1 - t0))


# ---------------------------------------------------------------- 背景
def build_background():
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    cx, cy = W * 0.5, H * 0.44
    dx = (x - cx) / (W * 0.62)
    dy = (y - cy) / (H * 0.80)
    d = np.sqrt(dx * dx + dy * dy)
    glow = np.clip(1.0 - d, 0, 1) ** 2.4

    img = np.zeros((H, W, 3), np.float32)
    img += BG_DEEP
    img += glow[..., None] * BG_GLOW

    # 上方微弱冷光
    top = np.clip(1 - y / (H * 0.55), 0, 1) ** 3
    img += top[..., None] * np.array([10, 16, 28], np.float32)

    # 暗角
    vx = (x - W / 2) / (W / 2)
    vy = (y - H / 2) / (H / 2)
    vig = 1 - 0.45 * np.clip((vx * vx + vy * vy) * 0.55, 0, 1)
    img *= vig[..., None]

    return np.clip(img, 0, 255).astype(np.uint8)


BG = Image.fromarray(build_background(), "RGB")

# 胶片颗粒（固定图样，避免逐帧闪烁）
_rng = np.random.default_rng(7)
GRAIN = (_rng.normal(0, 1.6, (H, W, 1))).repeat(3, axis=2).astype(np.float32)


# ---------------------------------------------------------------- 资源
def rounded_mask(size, radius):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius, fill=255)
    return m


def load_card(path, target_w):
    src = Image.open(path).convert("RGB")
    ratio = target_w / src.width
    im = src.resize((target_w, int(src.height * ratio)), Image.LANCZOS)
    w, h = im.size
    radius = 22

    card = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    card.paste(im, (0, 0), rounded_mask((w, h), radius))

    # 1px 内描边
    bd = ImageDraw.Draw(card)
    bd.rounded_rectangle([0, 0, w - 1, h - 1], radius, outline=(255, 255, 255, 26), width=1)

    # 投影
    pad = 90
    sh = Image.new("RGBA", (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
    sh.paste(Image.new("RGBA", (w, h), (0, 0, 0, 190)), (pad, pad), rounded_mask((w, h), radius))
    sh = sh.filter(ImageFilter.GaussianBlur(36))

    return card, sh


CARDS = {}
for name, tw in [
    ("home", 1120),
    ("saves", 1120),
    ("versions", 1120),
    ("home-light", 1120),
    ("update", 1120),
]:
    path = os.path.join(ROOT, "build", "promo", {
        "home": "src_home.png",
        "saves": "src_saves.png",
        "versions": "src_versions.png",
        "home-light": "src_homelight.png",
        "update": "src_update.png",
    }[name])
    if os.path.exists(path):
        CARDS[name] = load_card(path, tw)

LOGOTEX = Image.open(LOGO).convert("RGBA")
LOGO_BIG = LOGOTEX.resize((260, 260), Image.LANCZOS)
LOGO_SM = LOGOTEX.resize((120, 120), Image.LANCZOS)


def glow_copy(img, radius, strength):
    """给图像做一层柔光，用于 Logo 辉光（带内边距，避免方形边界）"""
    pad = int(radius * 2)
    canvas = Image.new("RGBA", (img.width + pad * 2, img.height + pad * 2), (0, 0, 0, 0))
    canvas.alpha_composite(img, (pad, pad))
    a = canvas.split()[3].point(lambda v: int(v * strength))
    # 掐掉低透明度尾巴，否则整块画布会透出一层淡蓝方块
    a = a.point(lambda v: 0 if v < 20 else min(255, int((v - 20) * 1.7)))
    g = Image.new("RGBA", canvas.size, (90, 140, 220, 0))
    g.putalpha(a.filter(ImageFilter.GaussianBlur(radius)))
    return g


LOGO_GLOW = glow_copy(LOGO_BIG, 46, 0.62)


# ---------------------------------------------------------------- 文字
_font_cache = {}


def font(path, size):
    key = (path, size)
    if key not in _font_cache:
        _font_cache[key] = ImageFont.truetype(path, size, index=0)
    return _font_cache[key]


def text_w(draw, s, f, tracking=0):
    if not s:
        return 0
    w = 0
    for ch in s:
        w += draw.textlength(ch, font=f) + tracking
    return w - tracking if tracking else w


def draw_tracked(layer, s, f, center, fill, tracking=0, alpha=255):
    if alpha <= 0 or not s:
        return
    d = ImageDraw.Draw(layer)
    total = text_w(d, s, f, tracking)
    x = center[0] - total / 2
    y = center[1]
    col = fill + (int(alpha),) if len(fill) == 3 else fill
    for ch in s:
        d.text((x, y), ch, font=f, fill=col, anchor="lm")
        x += d.textlength(ch, font=f) + tracking


def draw_text(layer, s, f, center, fill, alpha=255, anchor="mm"):
    if alpha <= 0 or not s:
        return
    d = ImageDraw.Draw(layer)
    col = fill + (int(alpha),) if len(fill) == 3 else fill
    d.text(center, s, font=f, fill=col, anchor=anchor)


def new_layer():
    return Image.new("RGBA", (W, H), (0, 0, 0, 0))


# ---------------------------------------------------------------- 场景
def scene_logo(frame, t, a):
    """0 - 3.6s"""
    local = t
    layer = new_layer()

    # 辉光呼吸
    pulse = 0.55 + 0.45 * math.sin(local * 2.2)
    glow = LOGO_GLOW.copy()
    glow.putalpha(glow.split()[3].point(lambda v: int(v * (0.5 + 0.5 * pulse))))
    layer.alpha_composite(glow, (W // 2 - glow.width // 2, 430 - glow.height // 2))

    # Logo 缩放落位
    k = ease_out_expo(seg(local, 0.15, 1.5))
    size = int(250 + 70 * k)
    logo = LOGOTEX.resize((size, size), Image.LANCZOS)
    if k > 0.02:
        tmp = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        tmp.alpha_composite(logo, (W // 2 - size // 2, 420 - size // 2))
        tmp.putalpha(tmp.split()[3].point(lambda v: int(v * k * a * 255 / 255)))
        layer.alpha_composite(tmp)

    # 品牌名
    a2 = seg(local, 1.0, 1.9) * a
    draw_tracked(layer, "SMUCL", font(FONT_EN_B, 92), (W // 2, 690), WHITE, 26, a2 * 255)

    a3 = seg(local, 1.5, 2.4) * a
    draw_tracked(layer, "上海海事大学 · MINECRAFT 启动器", font(FONT_CN, 30), (W // 2, 770), GREY, 6, a3 * 235)

    frame.alpha_composite(layer)


def scene_bigword(frame, t, a, word, sub=None, accent_word=None):
    layer = new_layer()
    f = font(FONT_CN_B, 132)
    # 逐字浮现
    d = ImageDraw.Draw(layer)
    total = text_w(d, word, f, 4)
    x = W // 2 - total / 2
    for i, ch in enumerate(word):
        k = ease_out_expo(seg(t, 0.05 + i * 0.075, 0.55 + i * 0.075))
        if k <= 0:
            x += d.textlength(ch, font=f) + 4
            continue
        dy = (1 - k) * 26
        col = WHITE + (int(255 * k * a),)
        d.text((x, 470 + dy), ch, font=f, fill=col, anchor="lm")
        x += d.textlength(ch, font=f) + 4

    if sub:
        k = ease_out_expo(seg(t, 0.5, 1.2))
        draw_tracked(layer, sub, font(FONT_CN, 34), (W // 2, 600), GREY, 8, k * 200 * a)

    frame.alpha_composite(layer)


def scene_shot(frame, t, a, key, kicker, title, sub=None, hold_scale=True):
    """截图滑入 + 文案（文案在上方）"""
    layer = new_layer()
    card, shadow = CARDS[key]

    k = ease_out_expo(seg(t, 0.0, 0.95))
    dy = (1 - k) * 56
    alpha = k * a

    cw, chh = card.size
    x = W // 2 - cw // 2
    y = 286 + dy

    # 阴影
    sh = shadow.copy()
    sh.putalpha(sh.split()[3].point(lambda v: int(v * alpha * 0.85)))
    layer.alpha_composite(sh, (int(x - (sh.width - cw) // 2), int(y - (sh.height - chh) // 2 + 26)))

    c = card.copy()
    c.putalpha(c.split()[3].point(lambda v: int(v * alpha)))
    layer.alpha_composite(c, (int(x), int(y)))

    # 文案
    ka = seg(t, 0.15, 0.85) * a
    draw_tracked(layer, kicker, font(FONT_EN_B, 22), (W // 2, 140), ACCENT, 10, ka * 240)
    draw_text(layer, title, font(FONT_CN_B, 60), (W // 2, 200), WHITE, ka * 255)
    if sub:
        ks = seg(t, 0.35, 1.05) * a
        draw_text(layer, sub, font(FONT_CN, 28), (W // 2, 252), GREY, ks * 220)

    frame.alpha_composite(layer)


def scene_theme(frame, t, a):
    """深色 → 浅色 渐变"""
    layer = new_layer()
    dark, dsh = CARDS["home"]
    light, lsh = CARDS["home-light"]
    cw, chh = dark.size
    x = W // 2 - cw // 2
    y = 286

    k = ease_out_expo(seg(t, 0.0, 0.8))
    alpha = k * a

    sh = dsh.copy()
    sh.putalpha(sh.split()[3].point(lambda v: int(v * alpha * 0.85)))
    layer.alpha_composite(sh, (int(x - (sh.width - cw) // 2), int(y - (sh.height - chh) // 2 + 26)))

    mix = ease_in_out(seg(t, 1.0, 2.4))

    c = dark.copy()
    c.putalpha(c.split()[3].point(lambda v: int(v * alpha * (1 - mix))))
    layer.alpha_composite(c, (int(x), int(y)))

    if mix > 0:
        l = light.copy()
        l.putalpha(l.split()[3].point(lambda v: int(v * alpha * mix)))
        layer.alpha_composite(l, (x, y))

    ka = seg(t, 0.15, 0.85) * a
    draw_tracked(layer, "APPEARANCE", font(FONT_EN_B, 22), (W // 2, 140), ACCENT, 10, ka * 240)
    draw_text(layer, "深色 · 浅色 · 跟随系统", font(FONT_CN_B, 60), (W // 2, 200), WHITE, ka * 255)

    # 切换时的小提示
    kb = seg(t, 1.1, 1.7) * a
    label = "DARK" if mix < 0.5 else "LIGHT"
    draw_tracked(layer, label, font(FONT_EN_B, 20), (W // 2, 940), GREY, 8, kb * 200)

    frame.alpha_composite(layer)


def scene_update(frame, t, a):
    """动效卡：发现新版本 + 下载进度"""
    layer = new_layer()

    ka = seg(t, 0.10, 0.70) * a
    draw_tracked(layer, "UPDATES", font(FONT_EN_B, 22), (W // 2, 140), ACCENT, 10, ka * 240)
    draw_text(layer, "后台盯着新版本", font(FONT_CN_B, 60), (W // 2, 200), WHITE, ka * 255)
    ks = seg(t, 0.30, 0.95) * a
    draw_text(layer, "发现即提示 · 260 KB 增量更新", font(FONT_CN, 28), (W // 2, 252), GREY, ks * 220)

    k = ease_out_expo(seg(t, 0.45, 1.25))
    cw, ch = 960, 190
    x = W // 2 - cw // 2
    y = 400 + int((1 - k) * 46)

    card = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    d = ImageDraw.Draw(card)
    d.rounded_rectangle([0, 0, cw - 1, ch - 1], 26, fill=(19, 25, 38, int(232 * k * a)))
    d.rounded_rectangle([0, 0, cw - 1, ch - 1], 26, outline=(255, 255, 255, int(30 * k * a)), width=1)

    # 左：图标
    ic = LOGOTEX.resize((74, 74), Image.LANCZOS)
    card.alpha_composite(ic, (46, ch // 2 - 37))

    # 中：文字
    p = ease_in_out(seg(t, 1.55, 3.55))
    pct = int(p * 100)
    d.text((150, 62), "发现新版本 v1.2.3", font=font(FONT_CN_B, 34),
           fill=(246, 249, 255, int(255 * k * a)), anchor="lm")
    sub = "正在下载…" if pct < 100 else "已完成，重启后生效"
    d.text((150, 106), sub, font=font(FONT_CN, 24), fill=(150, 162, 182, int(235 * k * a)), anchor="lm")
    d.text((cw - 46, 62), f"{pct}%", font=font(FONT_EN_B, 32),
           fill=(122, 168, 240, int(255 * k * a)), anchor="rm")

    # 底部进度条
    bx0, bx1, by = 150, cw - 46, 146
    d.rounded_rectangle([bx0, by, bx1, by + 6], 3, fill=(255, 255, 255, int(26 * k * a)))
    if p > 0:
        wid = int((bx1 - bx0) * p)
        d.rounded_rectangle([bx0, by, bx0 + max(wid, 6), by + 6], 3,
                            fill=(122, 168, 240, int(255 * k * a)))

    layer.alpha_composite(card, (x, y))

    # 完成后的对勾
    kc = seg(t, 3.55, 3.95) * a
    if kc > 0:
        cx0, cy0 = W // 2, 690
        d2 = ImageDraw.Draw(layer)
        r = 30
        d2.ellipse([cx0 - r, cy0 - r, cx0 + r, cy0 + r], fill=(96, 200, 120, int(200 * kc)))
        d2.line([cx0 - 12, cy0 + 1, cx0 - 3, cy0 + 10], fill=(255, 255, 255, int(255 * kc)), width=6)
        d2.line([cx0 - 3, cy0 + 10, cx0 + 13, cy0 - 9], fill=(255, 255, 255, int(255 * kc)), width=6)

    frame.alpha_composite(layer)
def scene_end(frame, t, a):
    layer = new_layer()
    k = ease_out_expo(seg(t, 0.0, 0.9))
    logo = LOGO_SM.resize((int(92 + 16 * (1 - k)),) * 2, Image.LANCZOS) if False else LOGO_SM
    tmp = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    tmp.alpha_composite(logo, (W // 2 - logo.width // 2, 330))
    tmp.putalpha(tmp.split()[3].point(lambda v: int(v * k * a)))
    layer.alpha_composite(tmp)

    a1 = seg(t, 0.3, 1.1) * a
    draw_tracked(layer, "SMUCL", font(FONT_EN_B, 96), (W // 2, 520), WHITE, 28, a1 * 255)

    a2 = seg(t, 0.6, 1.4) * a
    draw_tracked(layer, "github.com/Survaetr/SMUCL", font(FONT_EN, 40), (W // 2, 620), ACCENT, 2, a2 * 235)

    a3 = seg(t, 0.9, 1.7) * a
    draw_tracked(layer, "WINDOWS · 免费 · 开源", font(FONT_CN, 30), (W // 2, 700), GREY, 8, a3 * 220)

    frame.alpha_composite(layer)


# ---------------------------------------------------------------- 时间线
def render_frame(t):
    frame = BG.copy()
    frame = frame.convert("RGBA")

    def add(fn, t0, t1, fin=0.0, fout=0.0, *args):
        if t < t0 or t > t1:
            return
        local = t - t0
        a = 1.0
        if fout > 0:
            a *= 1.0 - seg(local, (t1 - t0) - fout, (t1 - t0))
        if fin > 0:
            a *= seg(local, 0, fin)
        fn(frame, local, a, *args)

    # 0 - 3.6  片头
    add(scene_logo, 0.0, 3.9, 0, 0.4)
    # 3.6 - 6.4 不用搬家
    add(scene_bigword, 3.6, 6.6, 0, 0.35, "不用搬家。")
    # 6.4 - 9.2 直接开玩
    add(scene_bigword, 6.4, 9.4, 0, 0.35, "直接开玩。")
    # 9.0 - 14.6 首页
    add(scene_shot, 9.0, 14.8, 0, 0.5, "home", "LAUNCH", "一屏启动", "版本、内存、玩家名，都在这一屏")
    # 14.4 - 20.0 存档
    add(scene_shot, 14.4, 20.2, 0, 0.5, "saves", "SAVES", "11 个存档，原样读出来", "世界名 · 版本 · 最后游玩时间")
    # 19.8 - 25.4 版本
    add(scene_shot, 19.8, 25.6, 0, 0.5, "versions", "VERSIONS", "601 个模组，一个都没少", "多目录汇总，版本隔离自动识别")
    # 25.2 - 31.4 主题
    add(scene_theme, 25.2, 31.6, 0, 0.5)
    # 31.2 - 36.4 更新
    add(scene_update, 31.2, 36.4, 0, 0.4)
    # 36.2 - 41.0 收尾
    add(scene_end, 36.2, DUR + 1, 0, 0)

    # 颗粒 + 轻微暗角
    arr = np.asarray(frame.convert("RGB"), np.float32) + GRAIN
    frame = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")
    return frame


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "stills":
        for name, t in [
            ("01_logo", 2.2),
            ("02_word", 5.0),
            ("03_home", 12.0),
            ("04_saves", 17.5),
            ("05_versions", 23.0),
            ("06_theme_dark", 27.0),
            ("07_theme_light", 30.0),
            ("08_update", 34.0),
            ("09_end", 39.0),
        ]:
            render_frame(t).save(os.path.join(OUT, f"still_{name}.png"))
            print("still", name)
    elif sys.argv[1] == "render":
        import subprocess
        import imageio_ffmpeg

        ff = imageio_ffmpeg.get_ffmpeg_exe()
        audio = os.path.join(OUT, "audio.wav")
        out = os.path.join(OUT, "SMUCL_promo_1080p60.mp4")
        total = int(DUR * FPS)

        cmd = [ff, "-y", "-f", "rawvideo", "-vcodec", "rawvideo",
               "-s", f"{W}x{H}", "-pix_fmt", "rgb24", "-r", str(FPS), "-i", "-"]
        if os.path.exists(audio):
            cmd += ["-i", audio, "-c:a", "aac", "-b:a", "192k"]
        cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", "18",
                "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-shortest", out]

        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for i in range(total):
            proc.stdin.write(render_frame(i / FPS).tobytes())
            if i % 300 == 0:
                print(f"  {i}/{total}  {i / total * 100:.0f}%", flush=True)
        proc.stdin.close()
        proc.wait()
        print("完成:", out, round(os.path.getsize(out) / 1024 / 1024, 1), "MB")
    else:
        print("用法: python make_promo.py stills|render")
