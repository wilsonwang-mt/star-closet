// 悬浮对话用的目录快照（服务端，读数据库）。
// 目录对外只读、变化很少：进程内缓存 5 分钟，规则层的第一行结果不必每次都等数据库。
// 快照永远是中文原文（规则层与 id 校验按中文工作）；类型与卡片数据在 ./cards.ts（纯函数，测试不连数据库也能用），这里一并转出。
import { toClosetView } from "@/components/closet/data";
import { getCurators, getOutfits } from "../catalog";
import type { LocateCloset } from "../locate/core";
import type { ChatCatalog, ChatItem, ChatOutfit } from "./cards";

export { availablePages, closetCard, outfitCard, pageCard, pagesForPrompt } from "./cards";
export type { ChatCatalog, ChatItem, ChatOutfit } from "./cards";

const TTL_MS = 5 * 60 * 1000;
let cache: { at: number; data: Promise<ChatCatalog> } | null = null;

async function load(): Promise<ChatCatalog> {
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
  const items = new Map<string, ChatItem>();
  const list: ChatOutfit[] = outfits.map((o) => {
    for (const i of o.items) {
      if (!items.has(i.id))
        items.set(i.id, {
          id: i.id,
          name: i.name.replace(/^占位：/, ""),
          category: i.category,
          subcategory: i.subcategory,
          color: i.color,
          material: i.material,
          price: i.price,
          gender: i.gender,
        });
    }
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
      itemIds: o.items.map((i) => i.id),
    };
  });
  return { closets, outfits: list, items: [...items.values()] };
}

export function getChatCatalog(): Promise<ChatCatalog> {
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
