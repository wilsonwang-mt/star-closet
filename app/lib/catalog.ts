// 商品目录读取（v0.2：多衣橱）。字段含义见 docs/supply/目录结构与搜索维度.md。
import { and, arrayContains, asc, count, eq, inArray, type SQL } from "drizzle-orm";
import { db, schema } from "./db";

export type Item = typeof schema.item.$inferSelect;
export type Curator = typeof schema.curator.$inferSelect;

export type Outfit = typeof schema.outfit.$inferSelect & {
  items: Item[];
  total: number;
};

export type Gender = "女装" | "男装" | "中性";
export type ClosetType = "风格主题" | "穿搭博主" | "个人主理人" | "品牌主题" | "明星";
export type BudgetTier = "平价" | "适中" | "进阶";
export type Category = (typeof CATEGORY_ORDER)[number];

export const GENDERS: readonly Gender[] = ["女装", "男装", "中性"];
export const CLOSET_TYPES: readonly ClosetType[] = ["风格主题", "穿搭博主", "个人主理人", "品牌主题", "明星"];
export const BUDGET_TIERS: readonly BudgetTier[] = ["平价", "适中", "进阶"];
export const CATEGORY_ORDER = ["上装", "下装", "外套", "鞋", "包", "配饰"] as const;

/** 首页衣橱卡片：衣橱本身 + 搭配数量。 */
export type CuratorSummary = Curator & { outfitCount: number };

export type CuratorFilter = {
  gender?: Gender;
  closetType?: ClosetType;
  /** 风格标签，命中 curator.style_tags 之一 */
  style?: string;
};

export type OutfitFilter = {
  curatorId?: string;
  gender?: Gender;
  /** 风格标签，命中 outfit.style_tags */
  style?: string;
  /** 场合标签，命中 outfit.occasion_tags */
  occasion?: string;
  budgetTier?: BudgetTier;
};

export type ItemFilter = {
  curatorId?: string;
  /** 传入多个时取并集，例如 ["男装","中性"] */
  gender?: Gender | Gender[];
  category?: Category;
  displayCategory?: string;
  colorFamily?: string;
  style?: string;
  occasion?: string;
};

export function sumPrice(items: Pick<Item, "price">[]) {
  return items.reduce((s, i) => s + i.price, 0);
}

/** 第一间衣橱（按编号）。旧首页使用；新代码请用 getCurators()。 */
export async function getCurator(): Promise<Curator | undefined> {
  const rows = await db.select().from(schema.curator).orderBy(asc(schema.curator.id)).limit(1);
  return rows[0];
}

export async function getCuratorById(id: string): Promise<Curator | undefined> {
  const rows = await db.select().from(schema.curator).where(eq(schema.curator.id, id));
  return rows[0];
}

/** 全部衣橱，按编号固定排序，附搭配数量；可按性别、入驻方类型、风格筛选。 */
export async function getCurators(filter: CuratorFilter = {}): Promise<CuratorSummary[]> {
  const where: SQL[] = [];
  if (filter.gender) where.push(eq(schema.curator.gender, filter.gender));
  if (filter.closetType) where.push(eq(schema.curator.closetType, filter.closetType));
  if (filter.style) where.push(arrayContains(schema.curator.styleTags, [filter.style]));
  const [rows, counts] = await Promise.all([
    db
      .select()
      .from(schema.curator)
      .where(where.length ? and(...where) : undefined)
      .orderBy(asc(schema.curator.id)),
    db
      .select({ curatorId: schema.outfit.curatorId, n: count() })
      .from(schema.outfit)
      .groupBy(schema.outfit.curatorId),
  ]);
  const byCurator = new Map(counts.map((c) => [c.curatorId, Number(c.n)]));
  return rows.map((r) => ({ ...r, outfitCount: byCurator.get(r.id) ?? 0 }));
}

export async function getAllItems(): Promise<Item[]> {
  return db.select().from(schema.item).orderBy(asc(schema.item.id));
}

export async function getItems(filter: ItemFilter = {}): Promise<Item[]> {
  const where: SQL[] = [];
  if (filter.curatorId) where.push(eq(schema.item.curatorId, filter.curatorId));
  if (filter.gender) {
    const gs = Array.isArray(filter.gender) ? filter.gender : [filter.gender];
    where.push(inArray(schema.item.gender, gs));
  }
  if (filter.category) where.push(eq(schema.item.category, filter.category));
  if (filter.displayCategory) where.push(eq(schema.item.displayCategory, filter.displayCategory));
  if (filter.colorFamily) where.push(eq(schema.item.colorFamily, filter.colorFamily));
  if (filter.style) where.push(arrayContains(schema.item.styleTags, [filter.style]));
  if (filter.occasion) where.push(arrayContains(schema.item.occasionTags, [filter.occasion]));
  return db
    .select()
    .from(schema.item)
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(schema.item.id));
}

export async function getItemsByIds(ids: string[]): Promise<Item[]> {
  if (ids.length === 0) return [];
  const rows = await db.select().from(schema.item).where(inArray(schema.item.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is Item => Boolean(r));
}

async function attachItems(outfits: (typeof schema.outfit.$inferSelect)[]): Promise<Outfit[]> {
  if (outfits.length === 0) return [];
  const links = await db
    .select()
    .from(schema.outfitItem)
    .where(inArray(schema.outfitItem.outfitId, outfits.map((o) => o.id)))
    .orderBy(asc(schema.outfitItem.position));
  const items = await getItemsByIds([...new Set(links.map((l) => l.itemId))]);
  const byId = new Map(items.map((i) => [i.id, i]));
  return outfits.map((o) => {
    const its = links
      .filter((l) => l.outfitId === o.id)
      .map((l) => byId.get(l.itemId))
      .filter((i): i is Item => Boolean(i));
    return { ...o, items: its, total: sumPrice(its) };
  });
}

/** 搭配列表（含单品与总价），按目录顺序；可按衣橱、性别、风格、场合、预算档筛选。 */
export async function getOutfits(filter: OutfitFilter = {}): Promise<Outfit[]> {
  const where: SQL[] = [];
  if (filter.curatorId) where.push(eq(schema.outfit.curatorId, filter.curatorId));
  if (filter.gender) where.push(eq(schema.outfit.gender, filter.gender));
  if (filter.style) where.push(arrayContains(schema.outfit.styleTags, [filter.style]));
  if (filter.occasion) where.push(arrayContains(schema.outfit.occasionTags, [filter.occasion]));
  if (filter.budgetTier) where.push(eq(schema.outfit.budgetTier, filter.budgetTier));
  const rows = await db
    .select()
    .from(schema.outfit)
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(schema.outfit.sortOrder));
  return attachItems(rows);
}

export function getOutfitsByCurator(curatorId: string): Promise<Outfit[]> {
  return getOutfits({ curatorId });
}

export async function getOutfit(id: string): Promise<Outfit | undefined> {
  const rows = await db.select().from(schema.outfit).where(eq(schema.outfit.id, id));
  return (await attachItems(rows))[0];
}

/** 一间衣橱及其全部搭配；衣橱页使用。 */
export async function getCloset(curatorId: string): Promise<{ curator: Curator; outfits: Outfit[] } | undefined> {
  const [curator, outfits] = await Promise.all([getCuratorById(curatorId), getOutfitsByCurator(curatorId)]);
  return curator ? { curator, outfits } : undefined;
}
