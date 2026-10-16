import { z } from "zod";

// 购物袋（D67）的纯函数部分：请求校验、数量与尺码规整、合计。前后端共用，便于单测。

export const MAX_QTY = 9;
export const MAX_LINES_PER_ADD = 12;

const ItemId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const Size = z.string().trim().max(16);
const Qty = z.number().int().min(1).max(MAX_QTY);

/** 加入购物袋：单件、整套或多选，一次最多 12 件。 */
export const AddBody = z.object({
  items: z
    .array(z.object({ itemId: ItemId, size: Size.optional(), qty: Qty.optional() }))
    .min(1)
    .max(MAX_LINES_PER_ADD),
});

/** 改数量或尺码：定位到 itemId + size 这一行；toSize 为新尺码。 */
export const PatchBody = z
  .object({ itemId: ItemId, size: Size, qty: Qty.optional(), toSize: Size.optional() })
  .refine((b) => b.qty !== undefined || b.toSize !== undefined, { message: "没有要修改的内容" });

export const DeleteBody = z.object({ itemId: ItemId, size: Size });

export type AddLine = { itemId: string; size: string; qty: number };

export const clampQty = (n: number) => Math.min(MAX_QTY, Math.max(1, Math.round(Number.isFinite(n) ? n : 1)));

/**
 * 尺码规整：单品有尺码表时只接受表里的值（不在表里视为未选，存空字符串）；
 * 只有一个尺码时直接选它；没有尺码表（均码、配饰）时存空字符串。
 */
export function normalizeSize(size: string | undefined, sizes: readonly string[]): string {
  const s = (size ?? "").trim();
  if (sizes.length === 1) return sizes[0];
  if (!sizes.length) return "";
  return sizes.includes(s) ? s : "";
}

/** 同一件同一尺码在一次请求里出现多次时合并数量（上限 9）；保持首次出现的顺序。 */
export function mergeLines(lines: AddLine[]): AddLine[] {
  const out = new Map<string, AddLine>();
  for (const l of lines) {
    const key = `${l.itemId}\u0000${l.size}`;
    const prev = out.get(key);
    if (prev) prev.qty = clampQty(prev.qty + l.qty);
    else out.set(key, { ...l, qty: clampQty(l.qty) });
  }
  return [...out.values()];
}

export function bagTotals(lines: { price: number; qty: number }[]) {
  return lines.reduce((acc, l) => ({ count: acc.count + l.qty, total: acc.total + l.price * l.qty }), { count: 0, total: 0 });
}

/** 加入试衣间的请求体：单件（一件的 look）、多选（选中的几件）或整套。与 POST /api/looks 的格式一致。 */
export function lookPayload(input: {
  kind: "single" | "pick" | "outfit";
  outfitName: string | null;
  sourceOutfitId: string | null;
  items: { id: string; name: string }[];
}) {
  const clean = (n: string) => n.replace(/^占位：/, "");
  const ids = [...new Set(input.items.map((i) => i.id))];
  const outfitName = input.outfitName ? clean(input.outfitName) : null;
  let title: string;
  if (input.kind === "single" || ids.length === 1) title = clean(input.items[0]?.name ?? "单品");
  else if (input.kind === "outfit") title = outfitName ?? "整套搭配";
  else title = outfitName ? `${outfitName} · 挑选 ${ids.length} 件` : `挑选的 ${ids.length} 件`;
  return {
    title: title.slice(0, 60),
    sourceOutfitId: input.sourceOutfitId,
    request: null,
    summary: null,
    mode: input.kind === "outfit" ? ("original" as const) : ("pick" as const),
    items: ids.map((itemId) => ({ itemId, reason: null })),
  };
}
