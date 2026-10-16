// 把视频要用的素材复制到 public/（已在 .gitignore 中忽略，避免在仓库里重复保存大文件）。
// - 品牌场景：docs/design/visual-v04/video、keyframes
// - 演示素材（T2）：app/public/demo/（在 feat/studio-demo-assets 分支；合并前不存在时跳过，画面显示占位）
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const pub = resolve(here, "../public");
const jobs = [
  [resolve(root, "docs/design/visual-v04/video"), resolve(pub, "brand/video")],
  [resolve(root, "docs/design/visual-v04/keyframes"), resolve(pub, "brand/keyframes")],
  [resolve(root, "app/public/demo"), resolve(pub, "demo")],
  // 痛点段“收藏了一百套”的卡片墙用搭配封面（AI 生成示意图）
  [resolve(root, "app/public/catalog/outfits"), resolve(pub, "brand/outfits")],
];
for (const [from, to] of jobs) {
  if (!existsSync(from)) {
    console.log("跳过（不存在）", from.replace(root + "/", ""));
    continue;
  }
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true, filter: (p) => !p.includes(".sb-") });
  console.log("已复制", from.replace(root + "/", ""), "→", to.replace(pub + "/", "public/"));
}
mkdirSync(resolve(pub, "recordings"), { recursive: true });
