// 服务端收尾（纯函数，route 与测试共用）：校验单品、计算总价，并按“原搭配 → 结果”的实际差异生成说明。
// “去掉了…”只来自这里，用被移除单品的真实名称；改编器（AI 或规则）自己写的移除说明一律不采用。
// 多语言（D70）：说明按 locale 生成（copy.ts，默认中文）；返回的 items 仍是中文目录数据，接口在序列化前再换成当前语言。
import type { Item, Outfit } from "../catalog";
import { CATEGORY_ORDER, sumPrice } from "../catalog-core";
import { DEFAULT_LOCALE, type Locale } from "../i18n/config";
import { adaptCopy, itemName, outfitName, quote, ruleNotes } from "./copy";
import { enforceRules, fitsSize, parseSizes } from "./rules";
import type { AdaptDraft, AdaptResult } from "./types";

/**
 * 原搭配里被“去掉”（而不是被同类替换）的单品。
 * 同类目有几件新单品，就有几件原单品算被替换；新单品 reason 里点名替换的那件优先算作被替换
 * （中文「名称」；英文 “Name” 或 "Name"，名称按 locale 取）。
 */
export function removedOriginals(
  original: Item[],
  result: (Pick<Item, "id" | "category"> & { reason?: string })[],
  locale: Locale = DEFAULT_LOCALE,
) {
  const resultIds = new Set(result.map((i) => i.id));
  const originalIds = new Set(original.map((i) => i.id));
  const mentions = (o: Item) => {
    const zh = quote(itemName(o), "zh");
    if (locale !== "en") return [zh];
    const en = itemName(o, "en");
    return [zh, quote(en, "en"), `"${en}"`];
  };
  const named = new Set(
    result.flatMap((i) => original.filter((o) => mentions(o).some((m) => i.reason?.includes(m))).map((o) => o.id)),
  );
  const removed: Item[] = [];
  for (const cat of CATEGORY_ORDER) {
    const gone = original.filter((i) => i.category === cat && !resultIds.has(i.id));
    let added = result.filter((i) => i.category === cat && !originalIds.has(i.id)).length;
    for (const g of [...gone.filter((x) => named.has(x.id)), ...gone.filter((x) => !named.has(x.id))]) {
      if (added > 0) added--;
      else removed.push(g);
    }
  }
  return removed;
}

export function finalizeAdapt(
  outfit: Outfit,
  draft: AdaptDraft,
  pool: Item[],
  request: string,
  extraNotes: string[] = [],
  locale: Locale = DEFAULT_LOCALE,
): AdaptResult {
  const t = adaptCopy(locale);
  // 只接受候选池内（且符合用户所说尺码）的单品，去重并按类目上限截断。
  const wish = parseSizes(request);
  const sized = pool.filter((i) => fitsSize(i, wish));
  const checked = enforceRules(draft.picks, outfit, sized, ruleNotes(locale));

  const byId = new Map(sized.map((i) => [i.id, i]));
  const items = checked.picks
    .map((p) => {
      const it = byId.get(p.itemId);
      return it ? { ...it, reason: p.reason } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const total = sumPrice(items);
  const overBudget = draft.budget !== null && total > draft.budget;
  const forBudget = draft.budget !== null && outfit.total > draft.budget;
  const removalNotes = removedOriginals(outfit.items, items, locale).map((r) => t.removed(forBudget, r.category, itemName(r, locale)));

  const originalIds = new Set(outfit.items.map((i) => i.id));
  const changed = items.length !== outfit.items.length || items.some((i) => !originalIds.has(i.id));
  const recognized = draft.recognized ?? true;
  let summary = draft.summary;
  if (!changed && recognized) {
    // 规则模式的 summary 写的是“按…改编了…”，结果没变就不能这么说
    const rest = draft.mode === "offline" ? summary.replace(t.adaptedLead, "") : "";
    summary = t.unchanged(outfitName(outfit, locale), rest);
  }

  return {
    mode: draft.mode,
    items,
    summary,
    budget: draft.budget,
    total,
    overBudget,
    notes: [...draft.notes.filter((n) => !t.removalClaim.test(n)), ...removalNotes, ...checked.notes, ...extraNotes],
    changed,
    recognized,
  };
}
