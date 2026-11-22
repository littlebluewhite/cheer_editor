"""B 網頁小樣：八拍表橘色那一格跳格的時間 vs 滴答聲。相機會靠近、移動，所以整張畫面找「橘色、扁長的一條」。
用法：python3 -I bt_sync_b2.py 影片 從幾秒開始"""
import subprocess, sys
import numpy as np

FF = "/opt/homebrew/bin/ffmpeg"
FP = "/opt/homebrew/bin/ffprobe"
path, start = sys.argv[1], float(sys.argv[2])

# ---------- 聲音（同 bt_sync.py）----------
SR = 48000
a = np.frombuffer(subprocess.run([FF, "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                                 capture_output=True).stdout, np.float32).astype(np.float64)
ast = float(subprocess.run([FP, "-v", "error", "-select_streams", "a", "-show_entries", "stream=start_time", "-of", "csv=p=0", path],
                           capture_output=True, text=True).stdout.strip() or 0)
n = len(a)
F = np.fft.rfft(a)
f = np.fft.rfftfreq(n, 1 / SR)
F[(f < 1500) | (f > 3600)] = 0
bp = np.fft.irfft(F, n)

def matched(freq):
    tt = np.arange(int(0.03 * SR)) / SR
    tpl = np.exp(-tt * 150) * np.sin(2 * np.pi * freq * tt)
    tpl /= np.linalg.norm(tpl)
    m = len(tpl)
    N = 1 << int(np.ceil(np.log2(n + m)))
    c = np.fft.irfft(np.fft.rfft(bp, N) * np.conj(np.fft.rfft(tpl, N)), N)[:n]
    C = np.fft.fft(c)
    h = np.zeros(n); h[0] = 1
    if n % 2 == 0:
        h[n // 2] = 1; h[1:n // 2] = 2
    else:
        h[1:(n + 1) // 2] = 2
    return np.abs(np.fft.ifft(C * h))

e2, e3 = matched(2000), matched(3000)
env = np.maximum(e2, e3)
lo = int(start * SR)
noise = np.median(env[lo:])
mad = np.median(np.abs(env[lo:] - noise))
thr = noise + 12 * mad
cand, i = [], lo
while i < n:
    if env[i] > thr:
        j = min(n, i + int(0.1 * SR))
        k = i + int(np.argmax(env[i:j]))
        cand.append(k)
        i = k + int(0.3 * SR)
    else:
        i += 1
on = np.array(cand) / SR + ast
one = [bool(e3[k] > e2[k]) for k in cand]
print("sound onsets:", np.round(on, 4).tolist())
print("3000 Hz (八拍的 1):", [round(float(x), 4) for x, o in zip(on, one) if o])
print("sound gaps ms:", np.round(np.diff(on) * 1000, 1).tolist())

# ---------- 畫面：一格一格讀，不全部放進記憶體 ----------
pts = subprocess.run([FP, "-v", "error", "-select_streams", "v", "-show_entries", "frame=pts_time", "-of", "csv=p=0", path],
                     capture_output=True, text=True).stdout
t = np.array([float(x.strip(",")) for x in pts.split() if x.strip(",")])
W, H = 540, 960
p = subprocess.Popen([FF, "-v", "error", "-i", path, "-vf", f"scale={W}:{H}", "-fps_mode", "passthrough",
                      "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
size = W * H * 3
cx, cy, cnt = [], [], []
k = 0
while True:
    buf = p.stdout.read(size)
    if len(buf) < size:
        break
    if k < len(t) and t[k] >= start:
        fr = np.frombuffer(buf, np.uint8).reshape(H, W, 3).astype(np.int16)
        R, G, B = fr[..., 0], fr[..., 1], fr[..., 2]
        m = (R > 170) & (R - B > 80) & (R - G > 35) & (B < 140)
        # 去掉細線（目前這一列的外框）：上下各 2 列都要是橘色
        v = m.copy()
        v[2:-2] &= m[:-4] & m[4:] & m[1:-3] & m[3:-1]
        v[:2] = False; v[-2:] = False
        # 只留橫向連續 28 px 以上的（圓點、文字比較短）
        keep = np.zeros_like(v)
        for y in np.nonzero(v.sum(axis=1) >= 28)[0]:
            row = np.concatenate(([0], v[y].astype(np.int8), [0]))
            d = np.diff(row)
            s, e = np.nonzero(d == 1)[0], np.nonzero(d == -1)[0]
            for a0, b0 in zip(s, e):
                if b0 - a0 >= 28:
                    keep[y, a0:b0] = True
        ys, xs = np.nonzero(keep)
        cnt.append(len(xs))
        cx.append(xs.mean() if len(xs) else np.nan)
        cy.append(ys.mean() if len(xs) else np.nan)
    else:
        cnt.append(0); cx.append(np.nan); cy.append(np.nan)
    k += 1
p.wait()
cnt, cx, cy = np.array(cnt), np.array(cx), np.array(cy)
m = min(len(t), len(cnt))
t, cnt, cx, cy = t[:m], cnt[:m], cx[:m], cy[:m]

ev, last = [], -1
for i in range(1, m):
    if t[i] < start or t[i] - last < 0.25:
        continue
    ok = cnt[i] > 60 and cnt[i - 1] > 60
    if ok and (abs(cx[i] - cx[i - 1]) > 20 or abs(cy[i] - cy[i - 1]) > 12):
        ev.append((t[i], "J" if abs(cy[i] - cy[i - 1]) <= 12 else "ROW"))
        last = t[i]
print("bar px (every 30th frame from start):", cnt[t >= start][::30].tolist())
print("picture events:", [(round(float(x), 4), kk) for x, kk in ev])

res = []
for x, kk in ev:
    j = int(np.argmin(np.abs(on - x)))
    if abs(on[j] - x) < 0.25:
        res.append((round(float(x), 4), kk, round(float((x - on[j]) * 1000), 1)))
print("picture minus sound ms:", res)
js = np.array([r[2] for r in res if r[1] == "J"])
if len(js):
    print(f"J only: n={len(js)} median={np.median(js):.1f} min={js.min():.1f} max={js.max():.1f}")
