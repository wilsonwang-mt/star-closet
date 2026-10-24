import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import { getItemsByIds, sumPrice, type Item } from "./catalog";
import { canonicalLookTitle, canonicalReason, matchAutoTitle } from "./looks-l10n";

// 自动标题与“你手动替换”理由存中文，显示时按界面语言重算（lib/looks-l10n.ts）。
export type Look = typeof schema.look.$inferSelect & {
  /** 来源搭配的名称（目录中文原文），没有来源搭配或搭配已不在目录时为 null。 */
  sourceOutfitName: string | null;
  items: (Item & { reason: string | null })[];
  total: number;
};

async function outfitNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: schema.outfit.id, name: schema.outfit.name })
    .from(schema.outfit)
    .where(inArray(schema.outfit.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function listLooks(userId: string): Promise<Look[]> {
  const looks = await db
    .select()
    .from(schema.look)
    .where(eq(schema.look.userId, userId))
    .orderBy(desc(schema.look.createdAt));
  if (looks.length === 0) return [];
  const [links, names] = await Promise.all([
    db
      .select()
      .from(schema.lookItem)
      .where(inArray(schema.lookItem.lookId, looks.map((l) => l.id)))
      .orderBy(asc(schema.lookItem.position)),
    outfitNames([...new Set(looks.flatMap((l) => (l.sourceOutfitId ? [l.sourceOutfitId] : [])))]),
  ]);
  const items = await getItemsByIds([...new Set(links.map((l) => l.itemId))]);
  const byId = new Map(items.map((i) => [i.id, i]));
  return looks.map((l) => {
    const its = links
      .filter((x) => x.lookId === l.id)
      .flatMap((x) => {
        const it = byId.get(x.itemId);
        return it ? [{ ...it, reason: x.reason }] : [];
      });
    const sourceOutfitName = (l.sourceOutfitId && names.get(l.sourceOutfitId)) || null;
    return { ...l, sourceOutfitName, items: its, total: sumPrice(its) };
  });
}

/**
 * 保存一套。不传 title 时按模式、来源搭配与实际保存的单品生成中文标题；传了且认得出是自动标题
 * （旧客户端按界面语言拼的，任一语言）也换成中文，否则当作用户自己写的原样保存。
 * 单品的 manual 表示用户手动替换，理由存中文“你手动替换”。
 */
export async function createLook(
  userId: string,
  input: {
    title?: string | null;
    sourceOutfitId: string | null;
    request: string | null;
    summary: string | null;
    mode: string;
    items: { itemId: string; reason: string | null; manual?: boolean }[];
  },
) {
  const known = await getItemsByIds(input.items.map((i) => i.itemId));
  const byId = new Map(known.map((k) => [k.id, k]));
  const seen = new Set<string>();
  const items = input.items.filter((i) => byId.has(i.itemId) && !seen.has(i.itemId) && seen.add(i.itemId));
  if (items.length === 0) throw new Error("没有可保存的单品");

  const sourceOutfitName = input.sourceOutfitId ? (await outfitNames([input.sourceOutfitId])).get(input.sourceOutfitId) : null;
  if (input.sourceOutfitId && !sourceOutfitName) throw new Error("搭配不存在");
  const src = {
    mode: input.mode,
    sourceOutfitId: input.sourceOutfitId,
    sourceOutfitName: sourceOutfitName ?? null,
    items: items.map((i) => byId.get(i.itemId)!),
  };
  const custom = input.title?.trim();
  const title = custom && matchAutoTitle(custom, src) === null ? custom : canonicalLookTitle(src);

  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(schema.look).values({
      id,
      userId,
      sourceOutfitId: input.sourceOutfitId,
      title,
      request: input.request,
      summary: input.summary,
      mode: input.mode,
    });
    await tx.insert(schema.lookItem).values(
      items.map((i, position) => ({ lookId: id, itemId: i.itemId, position, reason: canonicalReason(i.reason, i.manual) })),
    );
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
