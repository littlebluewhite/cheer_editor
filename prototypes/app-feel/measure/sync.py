"""錄影裡滴答聲和畫面上的拍點差多少。用法：python3 -I sync.py 影片 crop(w:h:x:y) mode(flash|change)"""
import subprocess, sys
import numpy as np

FF = "/opt/homebrew/bin/ffmpeg"
FP = "/opt/homebrew/bin/ffprobe"
path, crop, mode = sys.argv[1], sys.argv[2], sys.argv[3]
w, h = [int(v) for v in crop.split(":")[:2]]

# 聲音：拍點＝音量突然變大的地方
sr = 44100
a = np.frombuffer(subprocess.run([FF, "-v", "error", "-i", path, "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
                                 capture_output=True).stdout, np.float32)
env = np.abs(a)
win = int(sr * 0.001)
env = np.convolve(env, np.ones(win) / win, "same")
thr = env.max() * 0.2
on, last = [], -1
for i in np.nonzero(env > thr)[0]:
    if i - last > sr * 0.25:
        on.append(i / sr)
    last = i
on = np.array(on)
# 聲音的第一個 sample 在影片時間軸上的位置
ast = float(subprocess.run([FP, "-v", "error", "-select_streams", "a", "-show_entries", "stream=start_time", "-of", "csv=p=0", path],
                           capture_output=True, text=True).stdout.strip() or 0)
vst = float(subprocess.run([FP, "-v", "error", "-select_streams", "v", "-show_entries", "stream=start_time", "-of", "csv=p=0", path],
                           capture_output=True, text=True).stdout.strip() or 0)
on = on + ast
print("audio start", ast, "video start", vst)
print("audio beats:", np.round(on, 3).tolist())
print("beat gaps ms:", np.round(np.diff(on) * 1000, 1).tolist())

# 畫面
pts = subprocess.run([FP, "-v", "error", "-select_streams", "v", "-show_entries", "frame=pts_time", "-of", "csv=p=0", path],
                     capture_output=True, text=True).stdout
t = np.array([float(x.strip(",")) for x in pts.split() if x.strip(",")])
raw = subprocess.run([FF, "-v", "error", "-i", path, "-vf", f"crop={crop}", "-fps_mode", "passthrough",
                      "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
fr = np.frombuffer(raw, np.uint8).reshape(-1, h, w, 3).astype(np.int16)
n = min(len(t), len(fr))
t, fr = t[:n], fr[:n]
if mode == "flash":
    lum = fr.mean(axis=(1, 2, 3))
    base = np.median(lum)
    lit = lum > base + 30
    ev = [t[i] for i in range(1, n) if lit[i] and not lit[i - 1]]
else:
    d = np.abs(np.diff(fr, axis=0)).mean(axis=(1, 2, 3))
    thr = max(d.max() * 0.3, 1)
    ev, lastt = [], -1
    for i in np.nonzero(d > thr)[0]:
        if t[i + 1] - lastt > 0.25:
            ev.append(t[i + 1])
        lastt = t[i + 1]
ev = np.array(ev)
print("picture beats:", np.round(ev, 3).tolist())

# 每個畫面拍點配最近的聲音拍點：正的＝畫面比聲音晚
off = []
for e in ev:
    j = np.argmin(np.abs(on - e))
    if abs(on[j] - e) < 0.2:
        off.append((e - on[j]) * 1000)
off = np.array(off)
print("picture minus sound ms:", np.round(off, 1).tolist())
if len(off):
    print(f"n={len(off)} median={np.median(off):.1f} min={off.min():.1f} max={off.max():.1f}  (one frame = 16.7 ms)")
