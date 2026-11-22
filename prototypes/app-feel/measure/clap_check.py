"""拍手那一下：聲音的開頭 vs 手停下來的那一格。用法：python3 -I clap_check.py 影片 開始秒 結束秒"""
import subprocess, sys
import numpy as np

FF = "/opt/homebrew/bin/ffmpeg"
FP = "/opt/homebrew/bin/ffprobe"
path, t0, t1 = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
SR = 48000
a = np.frombuffer(subprocess.run([FF, "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                                 capture_output=True).stdout, np.float32).astype(np.float64)
seg = np.abs(a[int(t0 * SR):int(t1 * SR)])
noise = np.median(seg)
i = int(np.argmax(seg > noise * 15 + 0.02))
print(f"clap sound onset {t0 + i / SR:.4f} s (peak {seg.max():.3f})")

pts = subprocess.run([FP, "-v", "error", "-select_streams", "v", "-show_entries", "frame=pts_time", "-of", "csv=p=0", path],
                     capture_output=True, text=True).stdout
t = np.array([float(x.strip(",")) for x in pts.split() if x.strip(",")])
raw = subprocess.run([FF, "-v", "error", "-i", path, "-vf", "scale=270:480", "-fps_mode", "passthrough",
                      "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
fr = np.frombuffer(raw, np.uint8).reshape(-1, 480, 270, 3).astype(np.int16)
m = min(len(t), len(fr))
sel = [k for k in range(m) if t0 <= t[k] <= t1]
prev = None
for k in sel:
    R, G, B = fr[k, ..., 0], fr[k, ..., 1], fr[k, ..., 2]
    skin = (R > 150) & (R - B > 30) & (R - G > 10) & (G > 90)
    ys, xs = np.nonzero(skin[:, :160])
    top = np.percentile(ys, 2) if len(ys) else -1
    # 背景（右上角）跟上一格差多少：手打到拿手機的手，整個畫面會跳
    bg = fr[k, 0:120, 160:270].mean(axis=2)
    jolt = np.abs(bg - prev).mean() if prev is not None else 0
    prev = bg
    print(f"{t[k]:.4f}  hand top y={top:6.1f}  skin px={len(ys):5d}  background change={jolt:5.1f}")
