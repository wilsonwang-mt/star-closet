#!/usr/bin/env python3
"""把 deck.html 里的素材占位符内联，生成单文件 index.html。

用法（仓库根目录）：python3 docs/pitch/build.py
占位符（路径相对仓库根目录）：
  {{img:路径|最大宽度}}   图片缩放后转 WebP，以 data URI 内联
  {{svg:路径}}            内联 SVG 源码
  {{video:路径}}          MP4 以 data URI 内联
依赖：Pillow。
"""
import base64
import io
import pathlib
import re

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
HERE = pathlib.Path(__file__).resolve().parent


def img(spec):
    path, _, width = spec.partition("|")
    im = Image.open(ROOT / path).convert("RGB")
    w = int(width or 1200)
    if im.width > w:
        im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=80, method=6)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


SVG_COUNT = [0]


def svg(path):
    """内联 SVG；同一文件可能出现多次，给内部 id 加前缀，避免 clipPath、渐变互相引用错位。"""
    text = (ROOT / path).read_text(encoding="utf-8")
    text = re.sub(r"<\?xml[^>]*\?>\s*", "", text).strip()
    SVG_COUNT[0] += 1
    p = f"s{SVG_COUNT[0]}-"
    text = re.sub(r'id="([^"]+)"', lambda m: f'id="{p}{m.group(1)}"', text)
    return re.sub(r"(url\(#|href=\"#)([^)\"]+)", lambda m: m.group(1) + p + m.group(2), text)


def video(path):
    return "data:video/mp4;base64," + base64.b64encode((ROOT / path).read_bytes()).decode()


KINDS = {"img": img, "svg": svg, "video": video}


def main():
    src = (HERE / "deck.html").read_text(encoding="utf-8")
    out = re.sub(r"\{\{(img|svg|video):([^}]+)\}\}", lambda m: KINDS[m.group(1)](m.group(2).strip()), src)
    (HERE / "index.html").write_text(out, encoding="utf-8")
    print(f"index.html {len(out.encode()) / 1024 / 1024:.2f} MB")


if __name__ == "__main__":
    main()
