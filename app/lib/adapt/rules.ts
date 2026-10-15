// 改编预筛与硬规则（纯函数，AI、规则模式、逐件替换、服务端校验共用一份）。
//
// 候选池：当前搭配所属衣橱的单品 + 与搭配同性别或“中性”的单品。
//   女装搭配 → 女装 + 中性；男装搭配 → 男装 + 中性；中性搭配 → 只用中性。男装不会被换成女装，反之亦然。
//   同衣橱单品排在前面，同分时优先选用。
// 类目上限：上装在叠穿搭配（原搭配有 2 件上装，如内搭 + 叠穿、连衣裙 + 开衫）里最多 2 件，否则 1 件；
//   配饰沿用原搭配件数（最多 2 件，原搭配只有 0–1 件时为 1 件）；下装、外套、鞋、包各最多 1 件。
//   配饰放宽到 2 件是因为目录里有 5 套主理人原搭配带 2 件配饰（O08、O25、O26、O33、O57），保留原搭配不能被校验删掉。
// 尺码：只有用户在要求里说了尺码（如“XL”“44 码”）才按单品 sizes 过滤；“均码”总是可选。
import type { Gender, Item, Outfit } from "../catalog";
import { CATEGORY_ORDER, type Category } from "../catalog-core";

export function allowedGenders(outfitGender: string): Gender[] {
  if (outfitGender === "男装") return ["男装", "中性"];
  if (outfitGender === "中性") return ["中性"];
  return ["女装", "中性"];
}

/** 候选池（同衣橱优先）。逐件替换的下拉选项也只从这里取。 */
export function buildCandidatePool(outfit: Pick<Outfit, "curatorId" | "gender">, all: Item[]): Item[] {
  const genders = new Set<string>(allowedGenders(outfit.gender));
  const ok = all.filter((i) => genders.has(i.gender));
  const own = ok.filter((i) => i.curatorId === outfit.curatorId);
  const rest = ok.filter((i) => i.curatorId !== outfit.curatorId);
  return [...own, ...rest];
}

// ---- 同类替换 ----

export const isDress = (i: Pick<Item, "tags" | "subcategory">) => i.tags.includes("连衣裙") || i.subcategory === "连衣裙";
// 马甲只换马甲：针织马甲顶替衬衫会让上身只剩一件马甲
export const isVest = (i: Pick<Item, "subcategory">) => (i.subcategory ?? "").includes("马甲");

/** a 能否顶替 b：同类目，且连衣裙只换连衣裙、马甲只换马甲（规则模式与逐件替换下拉共用）。 */
export function interchangeable(a: Pick<Item, "category" | "tags" | "subcategory">, b: Pick<Item, "category" | "tags" | "subcategory">) {
  return a.category === b.category && isDress(a) === isDress(b) && isVest(a) === isVest(b);
}

function countBy(items: Pick<Item, "category">[]) {
  const m = new Map<string, number>();
  for (const i of items) m.set(i.category, (m.get(i.category) ?? 0) + 1);
  return m;
}

export function isLayered(outfit: Pick<Outfit, "items">) {
  return (countBy(outfit.items).get("上装") ?? 0) >= 2;
}

/** 每个类目最多几件（按原搭配计算）。 */
export function categoryCaps(outfit: Pick<Outfit, "items">): Record<Category, number> {
  const n = countBy(outfit.items);
  return {
    上装: isLayered(outfit) ? 2 : 1,
    下装: 1,
    外套: 1,
    鞋: 1,
    包: 1,
    配饰: Math.min(2, Math.max(1, n.get("配饰") ?? 0)),
  };
}

export function capsText(outfit: Pick<Outfit, "items">) {
  const caps = categoryCaps(outfit);
  return CATEGORY_ORDER.map((c) => `${c}最多 ${caps[c]} 件`).join("，");
}

// ---- 尺码 ----

export type SizeWish = { letter: string | null; shoe: string | null };

const LETTER_SIZE = /(?<![A-Za-z])(XXXL|3XL|XXL|2XL|XL|XS|S|M|L)(?![A-Za-z])\s*(?:码|号)?/i;
const SHOE_SIZE = /(?:鞋码?|码数)\s*(3[4-9]|4[0-6])|(3[4-9]|4[0-6])\s*(?:码|号)/;

export function parseSizes(text: string): SizeWish {
  const l = text.match(LETTER_SIZE)?.[1]?.toUpperCase() ?? null;
  const s = text.match(SHOE_SIZE);
  const letter = l === "2XL" ? "XXL" : l === "3XL" ? "XXXL" : l;
  return { letter, shoe: s ? (s[1] ?? s[2]) : null };
}

const CLOTHING = new Set(["上装", "下装", "外套"]);

export function fitsSize(it: Pick<Item, "category" | "sizes">, wish: SizeWish) {
  if (it.sizes.length === 0 || it.sizes.includes("均码")) return true;
  if (CLOTHING.has(it.category) && wish.letter) return it.sizes.includes(wish.letter);
  if (it.category === "鞋" && wish.shoe) return it.sizes.includes(wish.shoe);
  return true;
}

export function sizeText(wish: SizeWish) {
  return [wish.letter ? `衣服 ${wish.letter}` : null, wish.shoe ? `鞋 ${wish.shoe} 码` : null].filter(Boolean).join("、");
}

// ---- 相关类目 ----

const CATEGORY_WORDS: [RegExp, Category][] = [
  [/上衣|上装|衬衫|T恤|t恤|毛衣|针织|卫衣|开衫|马甲|连衣裙|Polo/i, "上装"],
  [/下装|裤|半身裙|马面裙|短裙|长裙/, "下装"],
  [/外套|大衣|风衣|夹克|西装|羽绒|皮衣|冲锋衣|披肩|保暖|冷|降温/, "外套"],
  [/鞋|靴|高跟|平底|低跟|中跟/, "鞋"],
  [/包(?!括|含)/, "包"],
  [/配饰|首饰|项链|耳环|耳饰|手链|手表|腕表|眼镜|墨镜|围巾|丝巾|帽|腰带|发饰|袜/, "配饰"],
];

/** 只把这些类目送进提示词与规则模式：原搭配已有的类目 + 用户话里提到的类目。 */
export function relevantCategories(outfit: Pick<Outfit, "items">, request: string): Category[] {
  const set = new Set<string>(outfit.items.map((i) => i.category));
  for (const [re, cat] of CATEGORY_WORDS) if (re.test(request)) set.add(cat);
  return CATEGORY_ORDER.filter((c) => set.has(c));
}

export function groupByCategory(items: Item[], cats: readonly Category[]) {
  const out: Partial<Record<Category, Item[]>> = {};
  for (const c of cats) out[c] = items.filter((i) => i.category === c);
  return out;
}

// ---- 服务端校验 ----

const clean = (name: string) => name.replace(/^占位：/, "");

/**
 * 只保留候选池内的单品，去重，并按类目上限截断（保留先出现的）。
 * 返回被丢弃的原因，供结果的 notes 展示。
 */
export function enforceRules<P extends { itemId: string }>(
  picks: P[],
  outfit: Pick<Outfit, "items">,
  pool: Item[],
): { picks: P[]; notes: string[] } {
  const byId = new Map(pool.map((i) => [i.id, i]));
  const caps = categoryCaps(outfit);
  const used = new Map<string, number>();
  const seen = new Set<string>();
  const notes: string[] = [];
  const outside: string[] = [];
  const kept: P[] = [];
  for (const p of picks) {
    if (seen.has(p.itemId)) continue;
    seen.add(p.itemId);
    const it = byId.get(p.itemId);
    if (!it) {
      outside.push(p.itemId);
      continue;
    }
    const n = used.get(it.category) ?? 0;
    const cap = caps[it.category as Category] ?? 1;
    if (n >= cap) {
      notes.push(`${it.category}最多 ${cap} 件，没有采用「${clean(it.name)}」`);
      continue;
    }
    used.set(it.category, n + 1);
    kept.push(p);
  }
  if (outside.length) notes.push(`有 ${outside.length} 件推荐单品不适用于这套搭配（性别或尺码不符），没有采用`);
  return { picks: kept, notes };
}
