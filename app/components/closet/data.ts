// 首页卡片与衣橱页共用的衣橱展示数据（可序列化，传给客户端组件）。
// tagline / avatar / cover / cover_wide / video / video_poster 都可能为空（兼容 v0.1），这里统一兜底。
import type { Curator, CuratorSummary } from "@/lib/catalog";

export type ClosetView = {
  id: string;
  displayName: string;
  closetName: string;
  closetType: string;
  gender: string;
  tagline: string;
  intro: string;
  styleTags: string[];
  palette: string[];
  avatar: string | null;
  /** 竖屏海报（视频首帧优先），窄屏卡片与衣橱页使用 */
  poster: string;
  /** 横屏场景，宽屏卡片与衣橱页使用 */
  wide: string;
  video: string | null;
  personaNote: string | null;
  outfitCount: number;
};

const clean = (s: string | null | undefined) => (s ?? "").replace(/^占位：/, "").trim();

function firstSentence(s: string) {
  const m = s.match(/^[^。！？!?]+[。！？!?]?/);
  return (m ? m[0] : s).slice(0, 40);
}

export function toClosetView(c: Curator | CuratorSummary, outfitCount?: number): ClosetView {
  const intro = clean(c.intro);
  return {
    id: c.id,
    displayName: clean(c.displayName),
    closetName: clean(c.closetName),
    closetType: c.closetType,
    gender: c.gender,
    tagline: clean(c.tagline) || firstSentence(intro),
    intro,
    styleTags: c.styleTags ?? [],
    palette: c.palette ?? [],
    avatar: c.avatar,
    poster: c.videoPoster || c.cover || "/scenes/night-portrait.jpg",
    wide: c.coverWide || c.cover || "/scenes/night-wide.jpg",
    video: c.video,
    personaNote: c.personaNote,
    outfitCount: outfitCount ?? ("outfitCount" in c ? c.outfitCount : 0),
  };
}
