import { and, asc, eq, sql } from "drizzle-orm";
import { getItemsByIds, type Item } from "@/lib/catalog";
import { db, schema } from "@/lib/db";
import { catalogText } from "@/lib/i18n/catalog";
import type { Locale } from "@/lib/i18n/config";
import { bagTotals, clampQty, mergeLines, normalizeSize, type AddLine } from "./core";

// 购物袋（D67）：登录用户存数据库（bag_item），同一件同一尺码再次加入时数量累加（上限 9）。
// 结算与付款这次不做：这里只有加入、改数量 / 尺码、移除与列出。

export type BagLine = {
  itemId: string;
  size: string;
  qty: number;
  name: string;
  image: string | null;
  color: string;
  price: number;
  sizes: string[];
  category: string;
};

export type BagView = { lines: BagLine[]; count: number; total: number };

const t = schema.bagItem;

/** 加入购物袋；未知单品被忽略。返回加入后的件数（数量合计）。 */
export async function addToBag(userId: string, input: { itemId: string; size?: string; qty?: number }[]): Promise<number> {
  const known = new Map((await getItemsByIds([...new Set(input.map((i) => i.itemId))])).map((i) => [i.id, i]));
  const lines: AddLine[] = mergeLines(
    input.flatMap((i) => {
      const item = known.get(i.itemId);
      return item ? [{ itemId: item.id, size: normalizeSize(i.size, item.sizes ?? []), qty: clampQty(i.qty ?? 1) }] : [];
    }),
  );
  if (!lines.length) throw new Error("没有可加入的单品");
  for (const l of lines) {
    await db
      .insert(t)
      .values({ userId, itemId: l.itemId, size: l.size, qty: l.qty })
      .onConflictDoUpdate({
        target: [t.userId, t.itemId, t.size],
        set: { qty: sql`least(${t.qty} + ${l.qty}, 9)` },
      });
  }
  return bagCount(userId);
}

export async function bagCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${t.qty}), 0)::int` })
    .from(t)
    .where(eq(t.userId, userId));
  return Number(row?.n ?? 0);
}

export async function listBag(userId: string): Promise<BagView> {
  const rows = await db.select().from(t).where(eq(t.userId, userId)).orderBy(asc(t.createdAt), asc(t.itemId), asc(t.size));
  const items = new Map((await getItemsByIds([...new Set(rows.map((r) => r.itemId))])).map((i) => [i.id, i] as const));
  const lines = rows.flatMap((r): BagLine[] => {
    const it: Item | undefined = items.get(r.itemId);
    if (!it) return [];
    return [
      {
        itemId: r.itemId,
        size: r.size,
        qty: r.qty,
        name: it.name.replace(/^占位：/, ""),
        image: it.image,
        color: it.color,
        price: it.price,
        sizes: it.sizes ?? [],
        category: it.displayCategory || it.category,
      },
    ];
  });
  return { lines, ...bagTotals(lines) };
}

/**
 * 给人看的单品名换成当前语言（D70）：接口与服务端页面在返回前调用；数量、价格、品类等字段不动。
 * 品类、颜色是中文固定词，前端用 useTerm 显示。
 */
export function localizeBag(view: BagView, locale: Locale): BagView {
  return {
    ...view,
    lines: view.lines.map((l) => {
      const name = catalogText(locale, "items", l.itemId, "name");
      return name ? { ...l, name: name.replace(/^占位：/, "") } : l;
    }),
  };
}

/** 改数量或尺码。改尺码时若新尺码已有一行，两行合并（数量相加，上限 9）。不存在返回 false。 */
export async function updateBagLine(
  userId: string,
  input: { itemId: string; size: string; qty?: number; toSize?: string },
): Promise<boolean> {
  const where = and(eq(t.userId, userId), eq(t.itemId, input.itemId), eq(t.size, input.size));
  const [row] = await db.select().from(t).where(where);
  if (!row) return false;
  const qty = input.qty !== undefined ? clampQty(input.qty) : row.qty;
  if (input.toSize === undefined || input.toSize === input.size) {
    await db.update(t).set({ qty }).where(where);
    return true;
  }
  const [item] = await getItemsByIds([input.itemId]);
  const toSize = normalizeSize(input.toSize, item?.sizes ?? []);
  if (toSize === input.size) {
    await db.update(t).set({ qty }).where(where);
    return true;
  }
  await db.transaction(async (tx) => {
    await tx.delete(t).where(where);
    await tx
      .insert(t)
      .values({ userId, itemId: input.itemId, size: toSize, qty, createdAt: row.createdAt })
      .onConflictDoUpdate({ target: [t.userId, t.itemId, t.size], set: { qty: sql`least(${t.qty} + ${qty}, 9)` } });
  });
  return true;
}

export async function removeBagLine(userId: string, itemId: string, size: string): Promise<boolean> {
  const rows = await db
    .delete(t)
    .where(and(eq(t.userId, userId), eq(t.itemId, itemId), eq(t.size, size)))
    .returning({ itemId: t.itemId });
  return rows.length > 0;
}
