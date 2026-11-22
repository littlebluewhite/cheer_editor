"""每個滴答聲的大小和音高；加上前 0.3 秒的音量。用法：python3 -I beats.py 影片"""
import subprocess, sys
import numpy as np
FF = "/opt/homebrew/bin/ffmpeg"
sr = 44100
a = np.frombuffer(subprocess.run([FF, "-v", "error", "-i", sys.argv[1], "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"], capture_output=True).stdout, np.float32)
print("first 0.3 s peak per 50ms:", [round(float(np.abs(a[i:i+2205]).max()), 3) for i in range(0, int(sr*0.6), 2205)])
for k in range(0, int(len(a)/sr*2)):
    s = int((0.2 + k*0.5) * sr) - 2205
    seg = a[max(s,0):s+4410+2205]
    if len(seg) < 1000: continue
    i = np.argmax(np.abs(seg) > np.abs(seg).max()*0.3)
    on = (max(s,0)+i)/sr
    win = seg[i:i+1024]
    f = np.fft.rfftfreq(len(win), 1/sr)[np.argmax(np.abs(np.fft.rfft(win*np.hanning(len(win)))))]
    print(f"onset {on:.3f}  peak {np.abs(seg).max():.3f}  freq {f:.0f}")
