// 测试用：直接从 data/catalog.json 构造与数据库同形的 Item / Outfit（映射同 scripts/setup-db.ts），不连接数据库。
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Item, Outfit } from "../catalog";
import { sumPrice } from "../catalog-core";

type RawItem = Record<string, unknown> & { item_id: string };
type RawOutfit = Record<string, unknown> & { outfit_id: string; item_ids: string[] };

export function loadCatalog() {
  const raw = JSON.parse(readFileSync(path.join(process.cwd(), "data/catalog.json"), "utf-8")) as {
    items: RawItem[];
    outfits: RawOutfit[];
  };
  const s = (v: unknown) => (typeof v === "string" && v ? v : null);
  const arr = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);
  const items: Item[] = raw.items.map((i) => ({
    id: i.item_id,
    name: String(i.name),
    category: String(i.category),
    color: String(i.color),
    price: Number(i.price),
    currency: String(i.currency),
    priceCheckedAt: s(i.price_checked_at),
    buyUrl: String(i.buy_url),
    image: s(i.image),
    imageRights: s(i.image_rights),
    imageRightsNote: s(i.image_rights_note),
    sizeNote: s(i.size_note),
    tags: arr(i.tags),
    curatorId: s(i.curator_id),
    gender: s(i.gender) ?? "女装",
    displayCategory: s(i.display_category),
    subcategory: s(i.subcategory),
    colorFamily: s(i.color_family),
    material: s(i.material),
    season: s(i.season),
    fit: s(i.fit),
    heel: s(i.heel),
    sizes: arr(i.sizes),
    styleTags: arr(i.style_tags),
    occasionTags: arr(i.occasion_tags),
    searchKeyword: s(i.search_keyword),
    buyLabel: s(i.buy_label),
    priceNote: s(i.price_note),
  }));
  const byId = new Map(items.map((i) => [i.id, i]));
  const outfits: Outfit[] = raw.outfits.map((o, idx) => {
    const its = o.item_ids.map((id) => byId.get(id)!).filter(Boolean);
    return {
      id: o.outfit_id,
      curatorId: String(o.curator_id),
      name: String(o.name),
      styleNote: String(o.style_note),
      occasionTags: arr(o.occasion_tags),
      sortOrder: idx,
      gender: s(o.gender) ?? "女装",
      styleTags: arr(o.style_tags),
      season: s(o.season),
      budgetTier: s(o.budget_tier),
      cover: s(o.cover),
      coverNote: s(o.cover_note),
      items: its,
      total: sumPrice(its),
    } as Outfit;
  });
  return { items, outfits };
}
