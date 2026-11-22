"""確認配對：哪幾個滴答是 3000 Hz（八拍的 1），畫面上八拍的 1 在哪。
用法：python3 -I check_pairing.py 影片 a|b 聲音開頭(逗號分隔)"""
import subprocess, sys
import numpy as np

FF = "/opt/homebrew/bin/ffmpeg"
FP = "/opt/homebrew/bin/ffprobe"
path, kind, ons = sys.argv[1], sys.argv[2], [float(x) for x in sys.argv[3].split(",")]
SR = 48000
a = np.frombuffer(subprocess.run([FF, "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                                 capture_output=True).stdout, np.float32).astype(np.float64)
ast = float(subprocess.run([FP, "-v", "error", "-select_streams", "a", "-show_entries", "stream=start_time", "-of", "csv=p=0", path],
                           capture_output=True, text=True).stdout.strip() or 0)
for o in ons:
    i = int((o - ast) * SR)
    seg = a[i:i + int(0.03 * SR)]
    if len(seg) < 256:
        continue
    spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg))))
    f = np.fft.rfftfreq(len(seg), 1 / SR)
    e2 = spec[(f > 1800) & (f < 2200)].sum()
    e3 = spec[(f > 2800) & (f < 3200)].sum()
    print(f"sound {o:.4f}: {'3000Hz (八拍的1)' if e3 > e2 else '2000Hz'}  e3/e2={e3 / e2:.2f}")

if kind == "a":
    pts = subprocess.run([FP, "-v", "error", "-select_streams", "v", "-show_entries", "frame=pts_time", "-of", "csv=p=0", path],
                         capture_output=True, text=True).stdout
    t = np.array([float(x.strip(",")) for x in pts.split() if x.strip(",")])
    raw = subprocess.run([FF, "-v", "error", "-i", path, "-vf", "crop=340:280:740:200", "-fps_mode", "passthrough",
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
    fr = np.frombuffer(raw, np.uint8).reshape(-1, 280, 340, 3).astype(np.int16)
    m = min(len(t), len(fr))
    R, G, B = fr[:m, ..., 0], fr[:m, ..., 1], fr[:m, ..., 2]
    red = ((R - G > 90) & (R - B > 90)).sum(axis=(1, 2))
    base = np.median(red)
    lit = red - base > 500
    print("red flash onsets:", [round(float(t[i]), 4) for i in range(1, m) if lit[i] and not lit[i - 1]])
    print("red excess max:", int((red - base).max()))
