// 目录内容的多语言（D70）。数据库与 data/catalog.json 里始终是中文原文：筛选、试穿品类判断、改编规则都按中文工作。
// 只在“给人看”的边界换成当前语言：
// - 固定词（品类、颜色、材质、季节、版型、风格 / 场合标签、性别、衣橱类型、预算档…）查 terms 表；
// - 自由文本（衣橱名、简介、搭配名与说明、单品名与备注）按编号查覆盖表。
// 英文数据在 data/catalog.en.json，由 scripts/translate-catalog.ts 生成；缺译文时原样显示中文。
import enOverlay from "@/data/catalog.en.json";
import type { Locale } from "./config";

type CuratorText = { closetName?: string; tagline?: string; intro?: string; personaNote?: string };
type OutfitText = { name?: string; styleNote?: string; coverNote?: string };
type ItemText = { name?: string; priceNote?: string; sizeNote?: string; imageRightsNote?: string; buyLabel?: string };

export type CatalogOverlay = {
  terms: Record<string, string>;
  curators: Record<string, CuratorText>;
  outfits: Record<string, OutfitText>;
  items: Record<string, ItemText>;
};

const OVERLAYS: Partial<Record<Locale, CatalogOverlay>> = { en: enOverlay as unknown as CatalogOverlay };

/** 当前语言的固定词表（中文 → 译文）；中文返回空表。传给客户端的 useTerm()。 */
export function catalogTerms(locale: Locale): Record<string, string> {
  return OVERLAYS[locale]?.terms ?? {};
}

/** 固定词的显示名；没有译文时原样返回。 */
export function term(locale: Locale, zh: string | null | undefined): string {
  if (!zh) return "";
  return OVERLAYS[locale]?.terms[zh] ?? zh;
}

export function terms(locale: Locale, list: readonly string[] | null | undefined): string[] {
  return (list ?? []).map((t) => term(locale, t));
}

/** 原字段有内容才替换：原本为空（null / ""）的保持为空。 */
const has = (v: unknown) => typeof v === "string" && v.length > 0;

function pick<T extends object>(src: T | undefined, key: keyof T): string | undefined {
  const v = src?.[key];
  return typeof v === "string" && v ? v : undefined;
}

/** 按编号取某个自由文本字段的译文（给不走数据库行的地方用，如对话的目录快照）。 */
export function catalogText(
  locale: Locale,
  kind: "curators" | "outfits" | "items",
  id: string,
  field: string,
): string | undefined {
  const entry = OVERLAYS[locale]?.[kind][id] as Record<string, unknown> | undefined;
  const v = entry?.[field];
  return typeof v === "string" && v ? v : undefined;
}

type CuratorLike = { id: string; closetName?: string; tagline?: string | null; intro?: string; personaNote?: string | null };
type ItemLike = {
  id: string;
  name?: string;
  priceNote?: string | null;
  sizeNote?: string | null;
  imageRightsNote?: string | null;
  buyLabel?: string | null;
};
type OutfitLike = { id: string; name?: string; styleNote?: string; coverNote?: string | null; items?: ItemLike[] };

/** 换掉衣橱的自由文本字段；其余字段（含 styleTags、closetType 等中文固定词）不动。 */
export function localizeCurator<T extends CuratorLike>(c: T, locale: Locale): T {
  const o = OVERLAYS[locale]?.curators[c.id];
  if (!o) return c;
  return {
    ...c,
    ...(has(c.closetName) && pick(o, "closetName") ? { closetName: pick(o, "closetName") } : {}),
    ...(has(c.tagline) && pick(o, "tagline") ? { tagline: pick(o, "tagline") } : {}),
    ...(has(c.intro) && pick(o, "intro") ? { intro: pick(o, "intro") } : {}),
    ...(has(c.personaNote) && pick(o, "personaNote") ? { personaNote: pick(o, "personaNote") } : {}),
  } as T;
}

export function localizeItem<T extends ItemLike>(item: T, locale: Locale): T {
  const o = OVERLAYS[locale]?.items[item.id];
  if (!o) return item;
  return {
    ...item,
    ...(has(item.name) && pick(o, "name") ? { name: pick(o, "name") } : {}),
    ...(has(item.priceNote) && pick(o, "priceNote") ? { priceNote: pick(o, "priceNote") } : {}),
    ...(has(item.sizeNote) && pick(o, "sizeNote") ? { sizeNote: pick(o, "sizeNote") } : {}),
    ...(has(item.imageRightsNote) && pick(o, "imageRightsNote") ? { imageRightsNote: pick(o, "imageRightsNote") } : {}),
    ...(has(item.buyLabel) && pick(o, "buyLabel") ? { buyLabel: pick(o, "buyLabel") } : {}),
  } as T;
}

/** 换掉搭配的自由文本字段，并逐件换掉其中单品的名称等。 */
export function localizeOutfit<T extends OutfitLike>(outfit: T, locale: Locale): T {
  const o = OVERLAYS[locale]?.outfits[outfit.id];
  const items = outfit.items?.map((i) => localizeItem(i, locale));
  if (!o && !items) return outfit;
  return {
    ...outfit,
    ...(has(outfit.name) && pick(o, "name") ? { name: pick(o, "name") } : {}),
    ...(has(outfit.styleNote) && pick(o, "styleNote") ? { styleNote: pick(o, "styleNote") } : {}),
    ...(has(outfit.coverNote) && pick(o, "coverNote") ? { coverNote: pick(o, "coverNote") } : {}),
    ...(items ? { items } : {}),
  } as T;
}
