// 视觉规范 v5「电影感买手店」（docs/design/visual-v04/视觉规范.md）的深色 Night Edit。
import { loadFont as loadBodoni } from "@remotion/google-fonts/BodoniModa";

// 字体：Bodoni Moda（拉丁，只有几个分片）渲染时从 Google Fonts 下载，需要网络。
// 中文不在渲染时下载：思源宋体 / 思源黑体经 Google Fonts 要拉 100–200 个分片，渲染慢且易超时。
// 优先用本机已安装的 Noto Serif SC / Noto Sans SC，没有时退到 macOS 自带的宋体（Songti SC）与苹方（PingFang SC）。
const bodoni = loadBodoni("normal", { weights: ["400"], subsets: ["latin"] });
loadBodoni("italic", { weights: ["400"], subsets: ["latin"] });

export const fonts = {
  didone: `${bodoni.fontFamily}, "Bodoni 72", "Didot", serif`,
  serif: `"Noto Serif SC", "Source Han Serif SC", "Songti SC", "STSong", serif`,
  sans: `"Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Hiragino Sans GB", sans-serif`,
};

export const colors = {
  bg: "#0B0D10",
  ink: "#F4F2ED",
  ink2: "#B9B2A6",
  champ: "#C9A96E",
  champText: "#E8CF9C",
  glass: "rgba(255,246,230,.08)",
  glassEdge: "rgba(255,246,230,.22)",
};

/** 金箔渐变：只用于 N° 编号与价格。 */
export const foil = "linear-gradient(100deg, #8a6a36 0%, #e8cf9c 28%, #fff4d6 45%, #c9a96e 62%, #8a6a36 100%)";

export const FPS = 30;
export const sec = (s: number) => Math.round(s * FPS);
