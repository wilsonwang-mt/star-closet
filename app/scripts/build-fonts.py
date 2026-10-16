#!/usr/bin/env python3
"""重新生成自托管正文字体子集（思源黑体 Light 300 / Noto Sans SC，SIL OFL 1.1）。

用法（需要 fonttools 与 brotli：python3 -m pip install fonttools brotli）：
    python3 scripts/build-fonts.py /path/to/NotoSansSC[wght].ttf
源字体：https://github.com/google/fonts/tree/main/ofl/notosanssc
输出：public/fonts/sc-sans-light-{core,1,2}.v1.woff2 与 app/fonts.css。
- core：仓库内全部文案（data/catalog.json 与 app/、components/、lib/ 源码）用到的字 + ASCII + 常用标点，首屏预加载。
- 1 / 2：GB2312 一级 / 二级其余常用字，按 unicode-range 只在页面真正用到时下载（例如 AI 改编生成的文字）。
新增文案或目录后重跑本脚本；改了字表时把文件名里的 v1 改为 v2，避免浏览器缓存旧文件。
"""
import glob
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERSION = "v1"
WEIGHT = 300
PUNCT = "，。、；：？！“”‘’（）《》【】—…·￥¥°×～「」『』％＋－／"


def repo_chars() -> set[str]:
    text = ""
    for pat in ["data/catalog.json", "app/**/*.ts", "app/**/*.tsx", "components/**/*.ts", "components/**/*.tsx", "lib/**/*.ts"]:
        for f in glob.glob(os.path.join(APP, pat), recursive=True):
            text += open(f, encoding="utf-8", errors="ignore").read()
    chars = {ch for ch in text if ord(ch) >= 0x2000} | set(PUNCT)
    return chars | {chr(c) for c in range(0x20, 0x7F)}


def gb2312(lo_row: int, hi_row: int) -> set[str]:
    out = set()
    for hi in range(lo_row, hi_row):
        for lo in range(0xA1, 0xFF):
            try:
                out.add(bytes([hi, lo]).decode("gb2312"))
            except UnicodeDecodeError:
                pass
    return out


def ranges(chars) -> str:
    cps = sorted(ord(c) for c in chars)
    spans, start, prev = [], cps[0], cps[0]
    for cp in cps[1:]:
        if cp == prev + 1:
            prev = cp
            continue
        spans.append((start, prev))
        start = prev = cp
    spans.append((start, prev))
    return ", ".join(f"U+{a:X}" if a == b else f"U+{a:X}-{b:X}" for a, b in spans)


def main(src: str) -> None:
    static = instancer.instantiateVariableFont(TTFont(src), {"wght": WEIGHT})
    cmap = static.getBestCmap()
    core = {c for c in repo_chars() if ord(c) in cmap}
    level1 = {c for c in gb2312(0xB0, 0xD8) if ord(c) in cmap} - core
    level2 = {c for c in gb2312(0xD8, 0xF8) if ord(c) in cmap} - core
    out_dir = os.path.join(APP, "public", "fonts")
    os.makedirs(out_dir, exist_ok=True)
    tmp = os.path.join(out_dir, ".static.ttf")
    static.save(tmp)
    css = [
        "/* 正文字体：思源黑体 Light 300（Noto Sans SC，SIL OFL 1.1，许可见 public/fonts/OFL.txt），自托管子集，由 scripts/build-fonts.py 生成。",
        " * core = 仓库内全部文案用到的字；1/2 = GB2312 一/二级其余常用字，按 unicode-range 只在页面用到时下载。",
        " * 只有一个字重：font-weight 300 400 都落到这一个文件，不做合成加粗。 */",
    ]
    for part, chars in [("core", core), ("1", level1), ("2", level2)]:
        name = f"sc-sans-light-{part}.{VERSION}.woff2"
        opts = subset.Options()
        opts.flavor = "woff2"
        opts.layout_features = ["*"]
        opts.name_IDs = ["*"]
        opts.notdef_outline = True
        opts.hinting = False
        opts.desubroutinize = True
        font = TTFont(tmp)
        sub = subset.Subsetter(opts)
        sub.populate(text="".join(sorted(chars)))
        sub.subset(font)
        font.flavor = "woff2"
        font.save(os.path.join(out_dir, name))
        print(name, len(chars), "chars", os.path.getsize(os.path.join(out_dir, name)), "bytes")
        css.append(
            f'@font-face {{ font-family: "SC Sans"; font-style: normal; font-weight: 300 400; font-display: swap; '
            f'src: url(/fonts/{name}) format("woff2"); unicode-range: {ranges(chars)}; }}'
        )
    os.remove(tmp)
    with open(os.path.join(APP, "app", "fonts.css"), "w", encoding="utf-8") as f:
        f.write("\n".join(css) + "\n")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
