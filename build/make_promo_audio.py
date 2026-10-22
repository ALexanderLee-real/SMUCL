# -*- coding: utf-8 -*-
"""生成宣传片氛围音轨（纯合成，无版权问题）48kHz 立体声"""
import os
import wave
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "build", "promo", "audio.wav")
SR = 48000
DUR = 41.0
N = int(SR * DUR)
t = np.arange(N) / SR

rng = np.random.default_rng(3)


def env_ad(n, attack, decay, curve=2.0):
    a = int(attack * SR)
    d = n - a
    e = np.ones(n)
    if a > 0:
        e[:a] = np.linspace(0, 1, a) ** 0.6
    if d > 0:
        e[a:] = np.exp(-np.linspace(0, curve * 6, d))
    return e


def note(freq, start, dur, amp, attack=0.01, curve=2.0, detune=0.0):
    n = int(dur * SR)
    i0 = int(start * SR)
    if i0 >= N:
        return np.zeros(N)
    n = min(n, N - i0)
    tt = np.arange(n) / SR
    sig = np.sin(2 * np.pi * freq * tt)
    if detune:
        sig = 0.6 * sig + 0.4 * np.sin(2 * np.pi * freq * (1 + detune) * tt)
    sig *= env_ad(n, attack, dur - attack, curve)
    out = np.zeros(N)
    out[i0:i0 + n] = sig * amp
    return out


# ---------------- 和声垫 ----------------
CHORDS = [
    (0.0, 11.0, [110.00, 164.81, 220.00, 261.63]),   # Am
    (10.0, 11.0, [87.31, 130.81, 174.61, 220.00]),   # F
    (20.0, 11.0, [130.81, 196.00, 261.63, 329.63]),  # C
    (30.0, 11.0, [98.00, 146.83, 196.00, 246.94]),   # G
]
pad = np.zeros(N)
for start, dur, freqs in CHORDS:
    for f in freqs:
        pad += note(f, start, dur, 0.055, attack=2.2, curve=1.2, detune=0.004)

# 高频空气感
air = note(880, 0, DUR, 0.006, attack=3.0, curve=0.8) + note(1318.5, 12, 26, 0.004, attack=4.0, curve=0.8)

# ---------------- 低音 ----------------
sub = np.zeros(N)
for start, dur, freqs in CHORDS:
    sub += note(freqs[0] / 2, start, dur, 0.075, attack=0.8, curve=1.0)

# ---------------- 心跳式低鼓 ----------------
def kick(start, amp=0.14):
    n = int(0.5 * SR)
    i0 = int(start * SR)
    if i0 >= N:
        return np.zeros(N)
    n = min(n, N - i0)
    tt = np.arange(n) / SR
    f = 52 * np.exp(-tt * 9) + 34
    sig = np.sin(2 * np.pi * np.cumsum(f) / SR)
    sig *= np.exp(-tt * 7.5)
    out = np.zeros(N)
    out[i0:i0 + n] = sig * amp
    return out


drums = np.zeros(N)
start = 9.0
while start < 36.0:
    drums += kick(start, 0.13)
    if start >= 20.0:
        drums += kick(start + 1.0, 0.06)
    start += 2.0

# ---------------- 转场 whoosh ----------------
def whoosh(start, amp=0.05, dur=1.1):
    n = int(dur * SR)
    i0 = int(start * SR - n * 0.55)
    if i0 + n <= 0 or i0 >= N:
        return np.zeros(N)
    i0 = max(0, i0)
    n = min(n, N - i0)
    tt = np.arange(n) / SR
    noise = rng.normal(0, 1, n)
    # 一阶低通，截止频率扫动
    out = np.zeros(n)
    prev = 0.0
    for i in range(n):
        a = 0.02 + 0.5 * (i / n) ** 2
        prev = prev + a * (noise[i] - prev)
        out[i] = prev
    out *= np.sin(np.pi * np.linspace(0, 1, n)) ** 1.5 * amp
    res = np.zeros(N)
    res[i0:i0 + n] = out
    return res


fx = np.zeros(N)
for cut in [3.6, 9.0, 14.4, 19.8, 25.2, 31.2, 36.2]:
    fx += whoosh(cut, 0.055)

# ---------------- 收尾钟声 ----------------
bell = (note(523.25, 36.3, 4.2, 0.10, attack=0.005, curve=1.6)
        + note(784.0, 36.32, 3.6, 0.05, attack=0.005, curve=1.9)
        + note(1046.5, 36.34, 3.0, 0.028, attack=0.005, curve=2.2))

# ---------------- 混音 ----------------
mix = pad + air + sub + drums + fx + bell

# 整体包络：淡入 0.6s，最后 2.5s 淡出
fade = np.ones(N)
fi = int(0.6 * SR)
fade[:fi] = np.linspace(0, 1, fi) ** 0.7
fo = int(2.6 * SR)
fade[-fo:] = np.linspace(1, 0, fo) ** 1.2
mix *= fade

# 轻微立体声：右声道加一点延迟
delay = int(0.011 * SR)
right = np.concatenate([np.zeros(delay), mix[:-delay]]) * 0.92 + mix * 0.08
left = mix

peak = max(np.abs(left).max(), np.abs(right).max())
gain = 0.62 / peak if peak > 0 else 1.0
stereo = np.stack([left * gain, right * gain], axis=1)
pcm = (np.clip(stereo, -1, 1) * 32767).astype("<i2")

with wave.open(OUT, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())

print("音轨已生成:", OUT, f"{DUR}s")
