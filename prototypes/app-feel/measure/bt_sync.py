"""藍牙錄影：每個滴答聲 vs 畫面拍點。
用法：python3 -I bt_sync.py 影片 a|b
a：右上角方塊亮（白或紅）。b：八拍表那一格（橘色）跳到下一格。
相機會晃，所以不用固定的小框：在一大塊區域裡找亮的方塊／橘色格子。"""
import subprocess, sys
import numpy as np

FF = "/opt/homebrew/bin/ffmpeg"
FP = "/opt/homebrew/bin/ffprobe"
path, kind = sys.argv[1], sys.argv[2]

def probe(sel, entry):
    out = subprocess.run([FP, "-v", "error", "-select_streams", sel, "-show_entries", entry, "-of", "csv=p=0", path],
                         capture_output=True, text=True).stdout
    return out

# ---------- 聲音：2000／3000 Hz 的短音，用匹配濾波找開頭 ----------
SR = 48000
a = np.frombuffer(subprocess.run([FF, "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                                 capture_output=True).stdout, np.float32).astype(np.float64)
ast = float(probe("a", "stream=start_time").strip() or 0)
n = len(a)
F = np.fft.rfft(a)
f = np.fft.rfftfreq(n, 1 / SR)
F[(f < 1500) | (f > 3600)] = 0
bp = np.fft.irfft(F, n)

def matched(freq):
    tt = np.arange(int(0.03 * SR)) / SR
    tpl = np.exp(-tt * 150) * np.sin(2 * np.pi * freq * tt)
    tpl /= np.linalg.norm(tpl)
    # 相關：輸出 i 對應「短音從 i 開始」
    m = len(tpl)
    N = 1 << int(np.ceil(np.log2(n + m)))
    c = np.fft.irfft(np.fft.rfft(bp, N) * np.conj(np.fft.rfft(tpl, N)), N)[:n]
    # 包絡（解析訊號）
    C = np.fft.fft(c)
    h = np.zeros(n); h[0] = 1
    if n % 2 == 0:
        h[n // 2] = 1; h[1:n // 2] = 2
    else:
        h[1:(n + 1) // 2] = 2
    return np.abs(np.fft.ifft(C * h))

env = np.maximum(matched(2000), matched(3000))
noise = np.median(env)
mad = np.median(np.abs(env - noise))
thr = noise + 12 * mad
cand = []
i = 0
while i < n:
    if env[i] > thr:
        j = min(n, i + int(0.1 * SR))
        k = i + int(np.argmax(env[i:j]))
        cand.append(k)
        i = k + int(0.3 * SR)
    else:
        i += 1
cand = np.array(cand)
on = cand / SR + ast
print(f"sound: thr/noise={thr / noise:.1f} peaks(xnoise)={[round(float(env[k] / noise), 1) for k in cand]}")
print("sound onsets:", np.round(on, 4).tolist())
print("sound gaps ms:", np.round(np.diff(on) * 1000, 1).tolist())

# ---------- 畫面 ----------
pts = probe("v", "frame=pts_time")
t = np.array([float(x.strip(",")) for x in pts.split() if x.strip(",")])
W, H = 1080, 1920
raw = subprocess.run([FF, "-v", "error", "-i", path, "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                     capture_output=True).stdout
fr = np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3)
m = min(len(t), len(fr))
t, fr = t[:m], fr[:m]

if kind == "a":
    reg = fr[:, 200:480, 740:1080].astype(np.int16)
    R, G, B = reg[..., 0], reg[..., 1], reg[..., 2]
    white = ((R > 200) & (G > 200) & (B > 200)).sum(axis=(1, 2))
    red = ((R > 170) & (G < 120) & (B < 120)).sum(axis=(1, 2))
    wb, rb = np.median(white), np.median(red)
    litw = white - wb > 500
    litr = red - rb > 500
    lit = litw | litr
    print("white excess (median-subtracted) sample:", (white - wb)[:40].tolist())
    print("red excess sample:", (red - rb)[:40].tolist())
    ev = [(t[i], "R" if litr[i] else "W") for i in range(1, m) if lit[i] and not lit[i - 1]]
    durs = []
    for i in range(1, m):
        if lit[i] and not lit[i - 1]:
            j = i
            while j < m and lit[j]:
                j += 1
            durs.append(j - i)
    print("flash lengths (frames):", durs)
else:
    reg = fr[:, 1100:1320, 0:950].astype(np.int16)
    R, G, B = reg[..., 0], reg[..., 1], reg[..., 2]
    orange = (R > 170) & (R - B > 80) & (R - G > 35) & (B < 140)
    cnt = orange.sum(axis=(1, 2))
    xs = np.arange(orange.shape[2])
    cx = np.array([(orange[i].sum(axis=0) * xs).sum() / max(cnt[i], 1) for i in range(m)])
    print("orange px sample:", cnt[:30].tolist())
    print("orange cx sample:", np.round(cx[:30]).tolist())
    ev = []
    last = -1
    for i in range(1, m):
        if cnt[i] > 400 and cnt[i - 1] > 400 and abs(cx[i] - cx[i - 1]) > 35 and t[i] - last > 0.25:
            ev.append((t[i], "J"))
            last = t[i]
        elif cnt[i] > 400 and cnt[i - 1] <= 400 and t[i] - last > 0.25:
            ev.append((t[i], "A"))
            last = t[i]

evt = np.array([e[0] for e in ev])
print("picture events:", [(round(float(x), 4), k) for x, k in ev])

off = []
for e in evt:
    j = int(np.argmin(np.abs(on - e)))
    if abs(on[j] - e) < 0.25:
        off.append((e - on[j]) * 1000)
off = np.array(off)
print("picture minus sound ms:", np.round(off, 1).tolist())
if len(off):
    print(f"n={len(off)} median={np.median(off):.1f} min={off.min():.1f} max={off.max():.1f}  (one video frame = 16.7 ms)")
