"""导出 SEEN. 定稿资产：python3 export.py
1. 用无头 Chrome 打开 final.html，读出 #dump 里的全部 SVG，写入 final/svg/
2. 逐个 SVG 截图成透明底 PNG（2 倍），写入 final/png/
3. 截一张总览 out/final-sheet.png
"""
import html
import json
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BASE = [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-proxy-server", "--allow-file-access-from-files"]

dom = subprocess.run(BASE + ["--virtual-time-budget=4000", "--dump-dom", (HERE / "final.html").as_uri()],
                     capture_output=True, text=True, check=True).stdout
raw = re.search(r'<pre id="dump">(.*?)</pre>', dom, re.S).group(1)
assets = json.loads(html.unescape(raw))

svg_dir, png_dir = HERE / "final" / "svg", HERE / "final" / "png"
svg_dir.mkdir(parents=True, exist_ok=True)
png_dir.mkdir(parents=True, exist_ok=True)

for name, svg in assets.items():
    path = svg_dir / f"{name}.svg"
    path.write_text('<?xml version="1.0" encoding="UTF-8"?>\n' + svg, encoding="utf-8")
    w, h = (round(float(v)) for v in re.search(r'width="([\d.]+)" height="([\d.]+)"', svg).groups())
    subprocess.run(BASE + ["--default-background-color=00000000", "--force-device-scale-factor=2",
                           f"--window-size={w},{h}", f"--screenshot={png_dir / (name + '.png')}", path.as_uri()],
                   capture_output=True, check=True)
    print(f"{name}: {w}x{h}")

(HERE / "out").mkdir(exist_ok=True)
subprocess.run(BASE + ["--force-device-scale-factor=1", "--window-size=2400,1500", "--virtual-time-budget=4000",
                       f"--screenshot={HERE / 'out' / 'final-sheet.png'}", (HERE / "final.html").as_uri()],
               capture_output=True, check=True)
print("sheet: out/final-sheet.png")
