// 首页第二部分「按场合，整套穿走」（D71）的数据：服务端从全部搭配里按场合挑出可直接试穿、加入试衣间的整套。
// 纯函数，不读数据库，方便测试；页面把 getOutfits() 与 getCurators() 的结果传进来。

/** 首页展示的场合：按目录 v0.2 统计，搭配最多、最贴近“明天穿什么”的六个（中文原值，显示时翻译）。 */
export const EDIT_OCCASIONS = ["周末", "通勤", "约会", "聚会", "旅行", "婚礼宾客"] as const;

/** 每个场合最多几套：1 套主推（大图 + 逐件），其余为“更多”卡片。 */
export const LOOKS_PER_OCCASION = 4;

export type EditItem = {
  id: string;
  name: string;
  image: string | null;
  color: string;
  category: string;
  displayCategory: string | null;
  price: number;
};

export type EditLook = {
  id: string;
  name: string;
  styleNote: string;
  cover: string | null;
  total: number;
  curator: { id: string; closetName: string; displayName: string; avatar: string | null; closetType: string };
  items: EditItem[];
};

export type EditGroup = { occasion: string; looks: EditLook[] };

type OutfitIn = {
  id: string;
  name: string;
  styleNote: string;
  cover: string | null;
  total: number;
  curatorId: string | null;
  occasionTags: string[];
  items: EditItem[];
};
type CuratorIn = { id: string; closetName: string; displayName: string; avatar: string | null; closetType: string };

/**
 * 每个场合按目录顺序取搭配，再在主理人之间轮流挑（同一间衣橱不连着出现），最多 LOOKS_PER_OCCASION 套。
 * 不足 2 套的场合不展示。各场合的主推（第一套）尽量不重复：已在前面场合做过主推的整套往后排。
 */
export function buildEdit(outfits: OutfitIn[], curators: CuratorIn[], occasions: readonly string[] = EDIT_OCCASIONS): EditGroup[] {
  const byId = new Map(curators.map((c) => [c.id, c]));
  const groups: EditGroup[] = [];
  const featured = new Set<string>();
  for (const occasion of occasions) {
    const queues = new Map<string, OutfitIn[]>();
    for (const o of outfits) {
      if (!o.curatorId || !byId.has(o.curatorId) || !o.occasionTags.includes(occasion) || o.items.length === 0) continue;
      const q = queues.get(o.curatorId) ?? [];
      q.push(o);
      queues.set(o.curatorId, q);
    }
    const picked: OutfitIn[] = [];
    while (picked.length < LOOKS_PER_OCCASION && [...queues.values()].some((q) => q.length)) {
      for (const q of queues.values()) {
        const next = q.shift();
        if (next) picked.push(next);
        if (picked.length >= LOOKS_PER_OCCASION) break;
      }
    }
    if (picked.length < 2) continue;
    const lead = picked.findIndex((o) => !featured.has(o.id));
    if (lead > 0) picked.unshift(...picked.splice(lead, 1));
    featured.add(picked[0].id);
    groups.push({
      occasion,
      looks: picked.map((o) => {
        const c = byId.get(o.curatorId!)!;
        return {
          id: o.id,
          name: o.name.replace(/^占位：/, ""),
          styleNote: o.styleNote,
          cover: o.cover,
          total: o.total,
          curator: { id: c.id, closetName: c.closetName.replace(/^占位：/, ""), displayName: c.displayName, avatar: c.avatar, closetType: c.closetType },
          items: o.items.map((i) => ({
            id: i.id,
            name: i.name,
            image: i.image,
            color: i.color,
            category: i.category,
            displayCategory: i.displayCategory,
            price: i.price,
          })),
        };
      }),
    });
  }
  return groups;
}
