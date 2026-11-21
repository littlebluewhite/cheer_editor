"""每一格的時間、場地區畫面有沒有變（找頓）。用法：python3 -I frames.py 影片 crop(w:h:x:y)"""
import subprocess, sys
import numpy as np
from collections import Counter

FF = "/opt/homebrew/bin/ffmpeg"
FP = "/opt/homebrew/bin/ffprobe"
path, crop = sys.argv[1], sys.argv[2]
w, h = [int(v) for v in crop.split(":")[:2]]
sw, sh = w // 4, h // 4

pts = subprocess.run([FP, "-v", "error", "-select_streams", "v", "-show_entries", "frame=pts_time",
                      "-of", "csv=p=0", path], capture_output=True, text=True).stdout
t = np.array([float(x.strip(",")) for x in pts.split() if x.strip(",")])
raw = subprocess.run([FF, "-v", "error", "-i", path, "-vf", f"crop={crop},scale={sw}:{sh}", "-fps_mode", "passthrough",
                      "-f", "rawvideo", "-pix_fmt", "gray", "-"], capture_output=True).stdout
fr = np.frombuffer(raw, np.uint8).reshape(-1, sh, sw).astype(np.int16)
n = min(len(t), len(fr))
t, fr = t[:n], fr[:n]
gap = np.diff(t) * 1000
diff = np.abs(np.diff(fr, axis=0)).mean(axis=(1, 2))
print("frames", n, "span", round(t[-1] - t[0], 2), "s")
print("gap ms (top)", Counter(np.round(gap, 1)).most_common(6))
print("gaps > 25ms:", [(round(t[i], 3), round(g, 1)) for i, g in enumerate(gap) if g > 25])
moving = diff > 0.05
print("frames with no change in field:", int((~moving).sum()), "of", len(diff))
still = [(round(t[i + 1], 3), round(gap[i], 1)) for i in range(len(diff)) if not moving[i]]
print("no-change frames (time, gap):", still[:40])

# 動的段落裡夾著的不動格＝頓（前後 3 格內都在動，中間停 1–3 格）
runs, cur = [], [moving[0], 1]
for m in moving[1:]:
    if m == cur[0]: cur[1] += 1
    else: runs.append(tuple(cur)); cur = [m, 1]
runs.append(tuple(cur))
print("runs (moving?, frames):", [(int(m), k) for m, k in runs])
pos, hitches = 0, []
for i, (m, k) in enumerate(runs):
    if not m and k <= 3 and 0 < i < len(runs) - 1 and runs[i - 1][1] >= 3 and runs[i + 1][1] >= 3:
        hitches.append((round(t[pos + 1], 3), k))
    pos += k
print("hitches inside motion (time, frozen frames):", hitches)
