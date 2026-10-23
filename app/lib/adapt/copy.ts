// 改编结果里给用户看的文字（D70）：规则模式的理由与概括、服务端收尾的“去掉了…”与无改动说明、硬规则的提示。
// 按 locale 生成，默认中文（与改造前逐字一致，现有测试断言中文）。这些句子嵌着单品名，不走 lib/i18n/phrases：
// 单品名、搭配名按编号查当前语言的目录（缺译文时为中文原名），品类等固定词用 term()。
// 逻辑（选哪件、换哪件）完全不看这里，中英文两条路径挑出的单品相同。
import { localizeItem, localizeOutfit, term } from "@/lib/i18n/catalog";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";
import type { Item } from "../catalog";
import type { RuleNotes, SizeWish } from "./rules";

const clean = (name: string) => name.replace(/^占位：/, "");

/** 单品名（当前语言，去掉“占位：”前缀）。 */
export const itemName = (i: { id: string; name: string }, locale: Locale = DEFAULT_LOCALE) => clean(localizeItem(i, locale).name);
/** 搭配名（当前语言，去掉“占位：”前缀）。 */
export const outfitName = (o: { id: string; name: string }, locale: Locale = DEFAULT_LOCALE) => clean(localizeOutfit(o, locale).name);

/** 句子里引用单品名：中文「」，英文 “”。 */
export const quote = (name: string, locale: Locale = DEFAULT_LOCALE) => (locale === "en" ? `“${name}”` : `「${name}」`);

/** 原搭配单品违反了哪条硬性要求（offline.ts 的 violation）。 */
export type ViolationKind = "exclude" | "flat" | "heel" | "formal" | "sport" | "size";

// 场合 / 季节标签（offline.ts OCCASION_TAGS 的结果）在英文句子里的说法。
const OCCASION_EN: Record<string, string> = {
  户外: "the outdoors",
  正式: "a formal occasion",
  通勤: "the commute",
  运动: "sport",
  秋冬: "autumn and winter",
  春夏: "spring and summer",
  休闲: "a casual day",
};

// 排除词（中文规范词，英文请求在 offline.ts 里先映射成中文）在英文句子里的说法。
const EXCLUDE_EN: Record<string, string> = {
  皮革: "leather",
  真皮: "leather",
  皮: "leather",
  革: "leather",
  羊毛: "wool",
  真丝: "silk",
  丝: "silk",
  牛仔: "denim",
  皮草: "fur",
  羽绒: "down",
  涤纶: "polyester",
  亮片: "sequins",
  蕾丝: "lace",
  麂皮: "suede",
  黑: "black",
  黑色: "black",
  白: "white",
  白色: "white",
  印花: "prints",
};

const CJK = /[㐀-鿿]/;

function occasionEn(tag: string) {
  return OCCASION_EN[tag] ?? term("en", tag).toLowerCase();
}

function excludeEn(word: string) {
  if (EXCLUDE_EN[word]) return EXCLUDE_EN[word];
  const t = term("en", word);
  return CJK.test(t) ? t : t.toLowerCase();
}

/** “a、b 和 c”的英文：a, b and c。 */
function listEn(xs: string[]) {
  return xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

export type AdaptCopy = {
  keep: string;
  /** 替换理由：origin 为被替换的原搭配单品名（已按语言取好）。 */
  replaced: (origin: string, why: string) => string;
  violation: (kind: ViolationKind, word?: string) => string;
  /** 场合偏好的替换理由：tags 为识别到的场合（中文标签），为空表示只是“舒适”。cat 为替换件的品类（中文）。 */
  forOccasion: (tags: string[], cat: string) => string;
  forBudget: (cat: string) => string;
  /** 硬性要求没能满足、保留原款的说明。cat 为品类（中文），name 为原款名（已按语言取好）。 */
  kept: (kind: "exclude" | "flat" | "occasion" | "size", cat: string, name: string, word?: string) => string;
  joinKept: (notes: string[]) => string;
  partBudget: (n: number) => string;
  partFlat: string;
  partComfy: string;
  partOutdoorFormal: (others: string[]) => string;
  partOccasion: (tags: string[]) => string;
  partExclude: (words: string[]) => string;
  partSize: (text: string) => string;
  unrecognized: string;
  adapted: (parts: string[], name: string, kept: string) => string;
  overBudget: (n: number) => string;
  /** finalize：被去掉的原搭配单品。 */
  removed: (forBudget: boolean, cat: string, name: string) => string;
  /** finalize：结果与原搭配相同。rest 为规则模式概括里“按…改编了…”之后的部分。 */
  unchanged: (name: string, rest: string) => string;
  /** 规则模式概括开头的“按…改编了…”，结果没变时要去掉。 */
  adaptedLead: RegExp;
  /** 改编器自己写的“去掉了…”说明（一律不采用，由服务端按实际差异生成）。 */
  removalClaim: RegExp;
  /** enforceRules：超过类目上限没有采用。cat 为品类（中文）。 */
  overCap: (cat: string, cap: number, name: string) => string;
  /** enforceRules：不在候选池（性别或尺码不符）。 */
  outside: (n: number) => string;
  sizeText: (wish: SizeWish) => string;
};

/** 给 enforceRules 的校验说明（单品名按语言取）。 */
export function ruleNotes(locale: Locale = DEFAULT_LOCALE): RuleNotes {
  const t = adaptCopy(locale);
  return {
    overCap: (cat: string, cap: number, item: Item) => t.overCap(cat, cap, itemName(item, locale)),
    outside: t.outside,
  };
}

const ZH: AdaptCopy = {
  keep: "保留主理人原搭配",
  replaced: (origin, why) => `替换「${origin}」：${why}`,
  violation: (kind, word) =>
    ({
      exclude: `原款含${word ?? ""}`,
      flat: "原款不是平底",
      heel: "原款是高跟",
      formal: "原款不适合正式场合",
      sport: "原款不适合运动",
      size: "原款没有你要的尺码",
    })[kind],
  forOccasion: (tags, cat) => `换成更适合${tags.length ? tags.join("、") : "舒适"}的${cat}`,
  forBudget: (cat) => `为控制预算，换成更实惠的${cat}`,
  kept: (kind, cat, name, word) =>
    ({
      exclude: `目录内没有非${word ?? ""}的${cat}，保留原款「${name}」`,
      flat: `目录内没有合适的平底${cat}，保留原款「${name}」`,
      occasion: `这间衣橱里没有更适合这个场合的${cat}，保留原款「${name}」`,
      size: `没有找到有你尺码的同类${cat}，保留原款「${name}」`,
    })[kind],
  joinKept: (notes) => (notes.length ? notes.join("；") + "。" : ""),
  partBudget: (n) => `预算 ${n} 元`,
  partFlat: "平底鞋",
  partComfy: "舒适",
  partOutdoorFormal: (others) => `场合：户外的正式场合${others.length ? `，${others.join("、")}` : ""}`,
  partOccasion: (tags) => `场合偏向${tags.join("、")}`,
  partExclude: (words) => `排除${words.join("、")}`,
  partSize: (text) => `尺码${text}`,
  unrecognized: "没有识别到具体约束，保留了原搭配。可以试试说预算、场合或想换的单品。",
  adapted: (parts, name, kept) => (parts.length ? `按「${parts.join("，")}」改编了「${name}」。${kept}` : `改编了「${name}」。${kept}`),
  overBudget: (n) => `目录内找不到 ${n} 元以内的完整搭配，这是最接近的一套`,
  removed: (forBudget, cat, name) => `${forBudget ? "为守住预算" : ""}去掉了${cat}「${name}」`,
  unchanged: (name, rest) => `这句要求在「${name}」里没有可改动的地方，保留了原搭配。${rest}`,
  adaptedLead: /^(?:按「[^」]*」)?改编了「[^」]*」。/,
  removalClaim: /去掉|删掉|删除|移除|拿掉|去除/,
  overCap: (cat, cap, name) => `${cat}最多 ${cap} 件，没有采用「${name}」`,
  outside: (n) => `有 ${n} 件推荐单品不适用于这套搭配（性别或尺码不符），没有采用`,
  sizeText: (wish) => [wish.letter ? `衣服 ${wish.letter}` : null, wish.shoe ? `鞋 ${wish.shoe} 码` : null].filter(Boolean).join("、"),
};

const EN: AdaptCopy = {
  keep: "Kept from the curator's original look",
  replaced: (origin, why) => `Replaces “${origin}”: ${why}`,
  violation: (kind, word) =>
    ({
      exclude: `the original contains ${excludeEn(word ?? "")}`,
      flat: "the original isn't flat",
      heel: "the original has a high heel",
      formal: "the original is too casual for a formal occasion",
      sport: "the original isn't made for sport",
      size: "the original doesn't come in your size",
    })[kind],
  forOccasion: (tags) => (tags.length ? `a better match for ${listEn(tags.map(occasionEn))}` : "a more comfortable pick"),
  forBudget: () => "a more affordable pick to stay on budget",
  kept: (kind, _cat, name, word) =>
    ({
      exclude: `There's no alternative without ${excludeEn(word ?? "")} in the collection, so we kept “${name}”`,
      flat: `There's no suitable flat alternative in the collection, so we kept “${name}”`,
      occasion: `Nothing in this closet suits the occasion better, so we kept “${name}”`,
      size: `There's no alternative in your size, so we kept “${name}”`,
    })[kind],
  joinKept: (notes) => (notes.length ? notes.join("; ") + "." : ""),
  partBudget: (n) => `a budget of ¥${n}`,
  partFlat: "flat shoes",
  partComfy: "comfort",
  partOutdoorFormal: (others) => `a formal occasion outdoors${others.length ? `, ${others.map(occasionEn).join(", ")}` : ""}`,
  partOccasion: (tags) => tags.map(occasionEn).join(", "),
  partExclude: (words) => `no ${listEn(words.map(excludeEn)).replace(/ and /g, " or ")}`,
  partSize: (text) => text,
  unrecognized: "We couldn't spot a specific request, so we kept the original look. Try a budget, an occasion or a piece you'd like to swap.",
  adapted: (parts, name, kept) => `Adapted “${name}”${parts.length ? ` for ${parts.join(", ")}` : ""}.${kept ? ` ${kept}` : ""}`,
  overBudget: (n) => `There's no complete look under ¥${n} in the collection; this is the closest one`,
  removed: (forBudget, _cat, name) => `Removed “${name}”${forBudget ? " to stay on budget" : ""}`,
  unchanged: (name, rest) => `Nothing in “${name}” needed changing for this request, so we kept the original look.${rest ? ` ${rest}` : ""}`,
  adaptedLead: /^Adapted “[^”]*”(?: for [^.]*)?\.\s*/,
  removalClaim: /\b(?:removed|removing|dropped|took out|taken out|left out)\b|去掉|删掉|删除|移除|拿掉|去除/i,
  overCap: (cat, cap, name) => `Left out “${name}”: only ${cap} ${cap === 1 ? "piece" : "pieces"} allowed from ${term("en", cat)}`,
  outside: (n) =>
    `${n} suggested ${n === 1 ? "piece doesn't" : "pieces don't"} match this look's line or your size, so we left ${n === 1 ? "it" : "them"} out`,
  sizeText: (wish) => [wish.letter ? `${wish.letter} clothing` : null, wish.shoe ? `size ${wish.shoe} shoes` : null].filter(Boolean).join(", "),
};

export function adaptCopy(locale: Locale = DEFAULT_LOCALE): AdaptCopy {
  return locale === "en" ? EN : ZH;
}
