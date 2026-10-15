import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import { getItemsByIds, sumPrice, type Item } from "./catalog";

export type Look = typeof schema.look.$inferSelect & {
  items: (Item & { reason: string | null })[];
  total: number;
};

export async function listLooks(userId: string): Promise<Look[]> {
  const looks = await db
    .select()
    .from(schema.look)
    .where(eq(schema.look.userId, userId))
    .orderBy(desc(schema.look.createdAt));
  if (looks.length === 0) return [];
  const links = await db
    .select()
    .from(schema.lookItem)
    .where(inArray(schema.lookItem.lookId, looks.map((l) => l.id)))
    .orderBy(asc(schema.lookItem.position));
  const items = await getItemsByIds([...new Set(links.map((l) => l.itemId))]);
  const byId = new Map(items.map((i) => [i.id, i]));
  return looks.map((l) => {
    const its = links
      .filter((x) => x.lookId === l.id)
      .flatMap((x) => {
        const it = byId.get(x.itemId);
        return it ? [{ ...it, reason: x.reason }] : [];
      });
    return { ...l, items: its, total: sumPrice(its) };
  });
}

export async function createLook(
  userId: string,
  input: {
    title: string;
    sourceOutfitId: string | null;
    request: string | null;
    summary: string | null;
    mode: string;
    items: { itemId: string; reason: string | null }[];
  },
) {
  const known = await getItemsByIds(input.items.map((i) => i.itemId));
  const knownIds = new Set(known.map((k) => k.id));
  const seen = new Set<string>();
  const items = input.items.filter((i) => knownIds.has(i.itemId) && !seen.has(i.itemId) && seen.add(i.itemId));
  if (items.length === 0) throw new Error("没有可保存的单品");

  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(schema.look).values({
      id,
      userId,
      sourceOutfitId: input.sourceOutfitId,
      title: input.title,
      request: input.request,
      summary: input.summary,
      mode: input.mode,
    });
    await tx
      .insert(schema.lookItem)
      .values(items.map((i, position) => ({ lookId: id, itemId: i.itemId, position, reason: i.reason })));
  });
  return id;
}

export async function deleteLook(userId: string, lookId: string) {
  const rows = await db
    .delete(schema.look)
    .where(and(eq(schema.look.id, lookId), eq(schema.look.userId, userId)))
    .returning({ id: schema.look.id });
  return rows.length > 0;
}
