"""把定稿标识装进网站：python3 web_assets.py（先运行 export.py）
- app/public/brand/：横排 logo（深 / 浅）、PWA 图标 192 / 512
- app/public/icon.svg：PWA 矢量图标
- app/app/apple-icon.png（180）、app/app/favicon.ico（16 / 32 / 48）
"""
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
APP = HERE.parents[2] / "app"
SVG, PNG = HERE / "final" / "svg", HERE / "final" / "png"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BRAND = APP / "public" / "brand"
BRAND.mkdir(parents=True, exist_ok=True)

for name in ["seen-lockup-horizontal", "seen-lockup-horizontal-light", "seen-mark", "seen-wordmark"]:
    shutil.copy(SVG / f"{name}.svg", BRAND / f"{name}.svg")
shutil.copy(SVG / "seen-app-icon.svg", APP / "public" / "icon.svg")

icon = Image.open(PNG / "seen-app-icon.png").convert("RGBA")  # 2048 方形深底
for size, path in [(512, BRAND / "icon-512.png"), (192, BRAND / "icon-192.png"), (180, APP / "app" / "apple-icon.png")]:
    icon.resize((size, size), Image.LANCZOS).save(path)

# favicon：小尺寸图形放在深色圆角方块上
mark = Image.open(PNG / "seen-mark-small.png").convert("RGBA")
base = 256
tile = Image.new("RGBA", (base, base), (0, 0, 0, 0))
ImageDraw.Draw(tile).rounded_rectangle((0, 0, base - 1, base - 1), radius=56, fill=(11, 13, 16, 255))
m = mark.copy()
m.thumbnail((int(base * .84), int(base * .84)), Image.LANCZOS)
tile.alpha_composite(m, ((base - m.width) // 2, (base - m.height) // 2 + 6))
tile.save(APP / "app" / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
print("ok:", sorted(p.name for p in BRAND.iterdir()))
