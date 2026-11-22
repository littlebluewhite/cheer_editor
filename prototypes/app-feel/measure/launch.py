"""關掉再開：每一格的整體亮度、場地區藍色比例，找「點圖示 → 看到場地」。
用法：python3 -I launch.py 影片 開始秒 結束秒 場地crop(w:h:x:y)"""
import subprocess, sys
import numpy as np

FF = "/opt/homebrew/bin/ffmpeg"
FP = "/opt/homebrew/bin/ffprobe"
path, t0, t1, crop = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), sys.argv[4]
w, h, x, y = [int(v) for v in crop.split(":")]
W, H = 295, 639  # 整個畫面縮成 1/4
pts = subprocess.run([FP, "-v", "error", "-select_streams", "v", "-show_entries", "frame=pts_time", "-of", "csv=p=0", path],
                     capture_output=True, text=True).stdout
t = np.array([float(v.strip(",")) for v in pts.split() if v.strip(",")])
raw = subprocess.run([FF, "-v", "error", "-i", path, "-vf", f"scale={W}:{H}", "-fps_mode", "passthrough",
                      "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
fr = np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3).astype(np.int16)
n = min(len(t), len(fr))
prev = None
for i in range(n):
    if not (t0 <= t[i] <= t1):
        continue
    f = fr[i]
    lum = f.mean()
    a = f[y // 4:(y + h) // 4, x // 4:(x + w) // 4]
    blue = ((a[..., 2] > 150) & (a[..., 0] < 90) & (a[..., 1] < 140)).mean()
    d = 0 if prev is None else np.abs(f - prev).mean()
    prev = f
    print(f"{t[i]:7.3f}  亮{lum:6.1f}  藍{blue:5.2f}  變{d:5.1f}")
