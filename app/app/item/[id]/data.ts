import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCuratorById, getItemsByIds, getOutfitsByCurator, sumPrice, type Curator, type Item } from "@/lib/catalog";

// 商品详情页的数据：单品、所属衣橱、包含这件单品的搭配（按目录顺序，附所属衣橱内的 N° 序号）。

export type ItemOutfit = {
  id: string;
  name: string;
  cover: string | null;
  closetName: string;
  number: number | null;
  total: number;
};

export async function getItemDetail(id: string): Promise<{ item: Item; curator: Curator | undefined; outfits: ItemOutfit[] } | null> {
  const [item] = await getItemsByIds([id]);
  if (!item) return null;
  const links = await db.select({ outfitId: schema.outfitItem.outfitId }).from(schema.outfitItem).where(eq(schema.outfitItem.itemId, id));
  const outfitIds = [...new Set(links.map((l) => l.outfitId))];
  const rows = outfitIds.length
    ? await db.select().from(schema.outfit).where(inArray(schema.outfit.id, outfitIds)).orderBy(asc(schema.outfit.sortOrder))
    : [];
  const curatorIds = [...new Set([item.curatorId, ...rows.map((r) => r.curatorId)].filter((x): x is string => !!x))];
  const curators = new Map((await Promise.all(curatorIds.map((c) => getCuratorById(c)))).filter((c): c is Curator => !!c).map((c) => [c.id, c]));
  // N° 与衣橱页一致：搭配在所属衣橱里的位置；总价按各单品标价。
  const siblings = new Map(await Promise.all([...new Set(rows.map((r) => r.curatorId))].map(async (c) => [c, await getOutfitsByCurator(c)] as const)));
  const outfits: ItemOutfit[] = rows.map((o) => {
    const list = siblings.get(o.curatorId) ?? [];
    const idx = list.findIndex((x) => x.id === o.id);
    const full = list[idx];
    return {
      id: o.id,
      name: o.name.replace(/^占位：/, ""),
      cover: o.cover,
      closetName: (curators.get(o.curatorId)?.closetName ?? "").replace(/^占位：/, ""),
      number: idx >= 0 ? idx + 1 : null,
      total: full ? sumPrice(full.items) : 0,
    };
  });
  return { item, curator: item.curatorId ? curators.get(item.curatorId) : undefined, outfits };
}
