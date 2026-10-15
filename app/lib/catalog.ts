import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";

export type Item = typeof schema.item.$inferSelect;
export type Curator = typeof schema.curator.$inferSelect;

export type Outfit = typeof schema.outfit.$inferSelect & {
  items: Item[];
  total: number;
};

export const CATEGORY_ORDER = ["上装", "下装", "外套", "鞋", "包", "配饰"] as const;

export function sumPrice(items: Pick<Item, "price">[]) {
  return items.reduce((s, i) => s + i.price, 0);
}

export async function getCurator(): Promise<Curator | undefined> {
  const rows = await db.select().from(schema.curator).orderBy(asc(schema.curator.id)).limit(1);
  return rows[0];
}

export async function getAllItems(): Promise<Item[]> {
  return db.select().from(schema.item).orderBy(asc(schema.item.id));
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

export async function getOutfits(): Promise<Outfit[]> {
  const rows = await db.select().from(schema.outfit).orderBy(asc(schema.outfit.sortOrder));
  return attachItems(rows);
}

export async function getOutfit(id: string): Promise<Outfit | undefined> {
  const rows = await db.select().from(schema.outfit).where(eq(schema.outfit.id, id));
  return (await attachItems(rows))[0];
}
