// 悬浮对话用的目录快照与卡片数据（服务端）。
// 目录对外只读、变化很少：进程内缓存 5 分钟，规则层的第一行结果不必每次都等数据库。
import { toClosetView } from "@/components/closet/data";
import { getCurators, getOutfits } from "../catalog";
import type { LocateCatalog, LocateCloset, LocateOutfit, PageKey } from "../locate/core";
import type { ClosetCard, OutfitCard, PageCard } from "./protocol";

const TTL_MS = 5 * 60 * 1000;
let cache: { at: number; data: Promise<LocateCatalog> } | null = null;

async function load(): Promise<LocateCatalog> {
  const [curators, outfits] = await Promise.all([getCurators(), getOutfits()]);
  const closets: LocateCloset[] = curators.map((c) => {
    const v = toClosetView(c);
    return {
      id: v.id,
      displayName: v.displayName,
      closetName: v.closetName,
      closetType: v.closetType,
      gender: v.gender,
      tagline: v.tagline,
      styleTags: v.styleTags,
      avatar: v.avatar,
      cover: v.poster,
      outfitCount: v.outfitCount,
    };
  });
  // N° 与衣橱页一致：这套在所属衣橱里按目录顺序的位置
  const seen = new Map<string, number>();
  const list: LocateOutfit[] = outfits.map((o) => {
    const no = (seen.get(o.curatorId) ?? 0) + 1;
    seen.set(o.curatorId, no);
    return {
      id: o.id,
      curatorId: o.curatorId,
      name: o.name.replace(/^占位：/, ""),
      styleNote: o.styleNote,
      occasionTags: o.occasionTags,
      styleTags: o.styleTags,
      season: o.season,
      budgetTier: o.budgetTier,
      gender: o.gender,
      total: o.total,
      cover: o.cover,
      no,
    };
  });
  return { closets, outfits: list };
}

export function getChatCatalog(): Promise<LocateCatalog> {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    const data = load();
    cache = { at: Date.now(), data };
    // 读取失败不缓存，下一次重试
    data.catch(() => {
      if (cache?.data === data) cache = null;
    });
  }
  return cache.data;
}

export function closetCard(c: LocateCloset): ClosetCard {
  return {
    kind: "closet",
    id: c.id,
    closetName: c.closetName,
    displayName: c.displayName,
    closetType: c.closetType,
    tagline: c.tagline,
    avatar: c.avatar,
    cover: c.cover,
    outfitCount: c.outfitCount,
  };
}

export function outfitCard(o: LocateOutfit, closets: LocateCloset[]): OutfitCard {
  return {
    kind: "outfit",
    id: o.id,
    name: o.name,
    closetName: closets.find((c) => c.id === o.curatorId)?.closetName ?? "",
    curatorId: o.curatorId,
    no: o.no,
    total: o.total,
    cover: o.cover,
    occasion: o.occasionTags.slice(0, 2).join(" · "),
  };
}

/** 2D 试穿只在配置了 FAL_KEY 时才有入口（AGENTS.md D55）。 */
export function availablePages(): PageKey[] {
  const all: PageKey[] = ["closets", "fitting-room", "avatar", "tryon", "profile", "login"];
  return all.filter((p) => p !== "tryon" || Boolean(process.env.FAL_KEY));
}

const PAGES: Record<PageKey, Omit<PageCard, "kind" | "page">> = {
  closets: { href: "/", title: "全部衣橱", kicker: "The Closets", desc: "左右滑动，挑一间走进去" },
  "fitting-room": { href: "/fitting-room", title: "个人试衣间", kicker: "Fitting Room", desc: "加入试衣间的搭配都在这里" },
  avatar: { href: "/profile/avatar", title: "我的 3D 形象", kicker: "Avatar", desc: "用你的自拍生成可以 360° 旋转的形象" },
  tryon: { href: "/fitting-room", title: "2D 试穿", kicker: "Try On", desc: "在试衣间里把整套衣服穿到你的正面照上" },
  profile: { href: "/profile", title: "个人档案", kicker: "Profile", desc: "尺码、预算和喜欢的风格，只有你自己可见" },
  login: { href: "/login", title: "登录", kicker: "Sign In", desc: "登录后可以保存搭配、生成形象" },
};

export function pageCard(page: PageKey): PageCard {
  return { kind: "page", page, ...PAGES[page] };
}

/** 给 AI 看的功能页清单 */
export function pagesForPrompt(): string {
  return availablePages()
    .map((p) => `${p}｜${PAGES[p].title}｜${PAGES[p].desc}`)
    .join("\n");
}
