// 离线规则模式：没有 API key 或 AI 调用失败时使用。界面会明确标注“非 AI”。
//
// 原则：先守住主理人的风格，再满足用户的要求。
// - 候选池（buildCandidatePool 的结果）再收窄：只用本衣橱的单品，或与被替换单品/原搭配风格标签有交集的单品；
//   替换一律同类一换一（连衣裙只换连衣裙），叠穿搭配的两件上装保留为两件。
// - 硬性要求（排除的材质/颜色、平底、尺码、场合黑名单）先处理：原搭配里命中的单品必须换掉；
//   候选里找不到时保留原款，并在 summary 里如实说明“目录内没有……保留原款”，不再声称已排除。
// - 场合偏好：最多换掉 2 件与场合最不搭的单品，换成本衣橱/同风格里更合场合的同类。
// - 预算：每次只替换能省最多的那一件，只在本衣橱/同风格里换，场合匹配度最多低一档；还超预算才去掉最贵的非必需件。
// - 被去掉的单品由服务端按实际差异生成说明（见 finalize.ts），这里不写“去掉了…”。
// - 多语言（D70）：也认常见英文说法（预算、场合、平底、舒适、不要皮革等，映射到同一组中文约束）；
//   给用户看的理由与概括按 locale 生成（copy.ts，默认中文），挑选逻辑与语言无关。
import type { Item, Outfit } from "../catalog";
import { CATEGORY_ORDER, sumPrice } from "../catalog-core";
import { DEFAULT_LOCALE, type Locale } from "../i18n/config";
import { adaptCopy, itemName, outfitName, type ViolationKind } from "./copy";
import { fitsSize, interchangeable, parseSizes, relevantCategories, type SizeWish } from "./rules";
import type { AdaptDraft } from "./types";

type Constraints = {
  budget: number | null;
  flat: boolean;
  comfy: boolean;
  /** 识别到的场合/季节（展示用） */
  wantTags: string[];
  /** 参与打分的场合/季节（户外 + 正式时，户外只表示场地，不参与打分） */
  scoreTags: string[];
  formal: boolean;
  sport: boolean;
  exclude: string[];
  sizes: SizeWish;
};

const OCCASION_TAGS: [RegExp, string][] = [
  [/户外|草地|露天|海边|度假|\boutdoors?\b|\bgarden\b|\blawn\b|\bbeach\b|\bseaside\b|\bholiday\b|\bvacation\b/i, "户外"],
  [/婚礼|晚宴|正式|宴会|\bwedding\b|\bgala\b|\bformal\b|\bbanquet\b|\bblack[- ]tie\b|\bdinner party\b/i, "正式"],
  // 英文只认明确的说法：“would this work”“running late”里的 work、run 不算场合。
  [/通勤|上班|面试|办公|\bcommut\w*|\boffice\b|\bworkday\b|\bworkwear\b|\b(?:for|at|to) work\b|\binterview\b/i, "通勤"],
  [/运动|健身|跑步|徒步|\bsports?\b|\bsporty\b|\bgym\b|\bworkout\b|\bjog\w*|\bfor a run\b|\brunning (?:shoes|gear|outfit)\b|\bhik(?:e|ing)\b|\btraining\b/i, "运动"],
  [/冬|冷|降温|\bwinter\b|\bcold\b|\bchilly\b|\bautumn\b/i, "秋冬"],
  [/夏|热|透气|\bsummer\b|\bhot\b|\bbreathable\b|\bwarm weather\b/i, "春夏"],
  [/休闲|周末|逛街|\bcasual\b|\bweekend\b|\bshopping\b|\bstroll\b/i, "休闲"],
];

// 场合词在单品上对应的标签（tags 与 occasion_tags 都算）
const TAG_MATCH: Record<string, string[]> = {
  户外: ["户外", "露营"],
  正式: ["正式", "晚宴", "婚礼"],
  通勤: ["通勤", "面试"],
  运动: ["运动"],
  休闲: ["休闲", "周末"],
};

// 排除词的同义展开：说“不要皮革/皮的/真皮”时，牛皮、羊皮、麂皮、PU 等都算皮革。
const LEATHER = ["皮革", "真皮", "牛皮", "羊皮", "麂皮", "漆皮", "皮衣", "PU", "人造革"];

// 英文排除词 → 中文规范词（目录字段是中文）。没有对应的英文词不参与排除。
const EXCLUDE_FROM_EN: Record<string, string> = {
  leather: "皮革",
  leathers: "皮革",
  wool: "羊毛",
  silk: "真丝",
  denim: "牛仔",
  fur: "皮草",
  down: "羽绒",
  polyester: "涤纶",
  sequins: "亮片",
  sequin: "亮片",
  lace: "蕾丝",
  suede: "麂皮",
  black: "黑",
  white: "白",
  prints: "印花",
  print: "印花",
};

function expandExclude(word: string): string[] {
  if (/皮|革/.test(word) && !/皮草/.test(word)) return LEATHER;
  return [word];
}

// 正式场合不穿的品类与面料；运动场合不穿的鞋跟与面料。
const FORMAL_BLOCK_SUB = new Set([
  "卫衣", "运动裤", "工装裤", "冲锋衣", "抓绒外套", "工装夹克", "棒球服",
  "越野跑鞋", "徒步鞋", "运动鞋", "老爹鞋", "板鞋", "帆布鞋", "胸包", "双肩包", "帆布包", "袜子",
  "T恤", "牛仔裤", "牛仔夹克",
]);
const FORMAL_BLOCK_MAT = new Set(["抓绒", "速干面料", "网面", "锦纶氨纶"]);
const SPORT_BLOCK_HEEL = new Set(["高跟", "中跟"]);
const SPORT_BLOCK_MAT = new Set(["真丝", "缎面", "醋酸缎面"]);

export function parseConstraints(text: string): Constraints {
  let budget: number | null = null;
  const m =
    text.match(/预算\s*(?:在|是|为)?\s*(\d{2,6})/) ??
    text.match(/(\d{2,6})\s*(?:元|块|以内|以下|之内)/) ??
    // 英文：“under 800”“budget of ¥450”；只有介词没有币种时至少 3 位数（“within 10 minutes”不是预算）。
    text.match(/\b(?:under|below|within|less than|no more than|max(?:imum)?|up to|budget(?: of| is)?:?)\s*(?:(?:[¥￥$]|rmb|cny)\s*(\d{2,6})|(\d{3,6}))\b/i) ??
    text.match(/(?:[¥￥$]|\brmb\s*|\bcny\s*)(\d{2,6})\b/i) ??
    text.match(/\b(\d{2,6})\s*(?:yuan|rmb|cny)\b/i);
  if (m) budget = Number(m[1] ?? m[2]);

  const flat = /平底|平跟|不穿高跟|不要高跟|好走|舒服的鞋|\bflats?\b|\bno (?:high )?heels\b|\bwithout heels\b|\blow[- ]heel|\beasy to walk/i.test(text);
  const comfy = /舒服|舒适|好走|轻松|\bcomf(?:y|ortable|ort)\b|\beasy to walk|\brelaxed\b/i.test(text);
  const wantTags = OCCASION_TAGS.filter(([re]) => re.test(text)).map(([, t]) => t);
  const formal = wantTags.includes("正式");
  const sport = wantTags.includes("运动");
  const scoreTags = formal ? wantTags.filter((t) => t !== "户外") : wantTags;
  const exclude = [...text.matchAll(/(?:不要|排除|不穿|别要|不想要)([一-龥A-Za-z]{1,4}?)(?:的|，|,|。|；|$|\s)/g)]
    .map((x) => x[1])
    .filter((w) => w !== "高跟");
  for (const x of text.matchAll(/\b(?:no|not|without|avoid|skip|exclude|don'?t want|do not want)\s+(?:any\s+)?([a-z]+)/gi)) {
    const zh = EXCLUDE_FROM_EN[x[1].toLowerCase()];
    if (zh && !exclude.includes(zh)) exclude.push(zh);
  }
  return { budget, flat, comfy, wantTags, scoreTags, formal, sport, exclude, sizes: parseSizes(text) };
}

const has = (it: Item, words: string[]) => {
  const hay = [it.name, it.material ?? "", it.subcategory ?? "", it.color, it.colorFamily ?? "", ...it.tags];
  return words.some((w) => hay.some((h) => h.includes(w)));
};

/** kind 决定保留原款时怎么说明；why 决定替换理由怎么写（copy.ts）。 */
type Violation = { kind: "exclude" | "flat" | "size" | "occasion"; word?: string; why: ViolationKind };

function violation(it: Item, c: Constraints): Violation | null {
  for (const w of c.exclude) if (has(it, expandExclude(w))) return { kind: "exclude", word: w, why: "exclude" };
  if (c.flat && it.category === "鞋" && !it.tags.includes("平底")) return { kind: "flat", why: "flat" };
  if (c.comfy && it.category === "鞋" && it.heel === "高跟") return { kind: "flat", why: "heel" };
  if (c.formal && (FORMAL_BLOCK_SUB.has(it.subcategory ?? "") || FORMAL_BLOCK_MAT.has(it.material ?? "")))
    return { kind: "occasion", why: "formal" };
  if (c.sport && (SPORT_BLOCK_HEEL.has(it.heel ?? "") || SPORT_BLOCK_MAT.has(it.material ?? "")))
    return { kind: "occasion", why: "sport" };
  if (!fitsSize(it, c.sizes)) return { kind: "size", why: "size" };
  return null;
}

function matchesTag(it: Item, t: string) {
  if (t === "秋冬" || t === "春夏") return it.tags.includes(t) || it.season === t || it.season === "四季";
  const words = TAG_MATCH[t] ?? [t];
  return words.some((w) => it.tags.includes(w) || it.occasionTags.includes(w));
}

function score(it: Item, c: Constraints) {
  let s = c.scoreTags.filter((t) => matchesTag(it, t)).length;
  // 户外婚礼、舒服一点：鞋优先平底（软偏好，不是硬性要求）
  if ((c.comfy || (c.formal && c.wantTags.includes("户外"))) && it.category === "鞋" && it.tags.includes("平底")) s += 1;
  return s;
}

const overlap = (a: string[], b: string[]) => a.filter((x) => b.includes(x)).length;

/**
 * 与被替换单品/原搭配的亲近程度：2 = 本衣橱或风格标签有交集；1 = 只是与原单品同色系；0 = 无关。
 */
function kinship(i: Item, orig: Item, outfit: Outfit) {
  if (
    i.curatorId === outfit.curatorId ||
    overlap(i.styleTags, orig.styleTags) > 0 ||
    overlap(i.styleTags, outfit.styleTags) > 0
  )
    return 2;
  return i.colorFamily && i.colorFamily === orig.colorFamily ? 1 : 0;
}

/**
 * 替换 orig 时可用的同类候选（满足全部硬性要求），分层取：先本衣橱/同风格，没有再看同色系。
 * anyCloset 只用于硬性要求（例如“不要皮革”）：前两层都找不到时，放宽到同性别的全部单品。
 */
function candidatesFor(
  orig: Item,
  outfit: Outfit,
  pool: Item[],
  used: Set<string>,
  c: Constraints,
  extra: (i: Item) => boolean = () => true,
  anyCloset = false,
) {
  const ok = pool.filter(
    (i) =>
      i.category === orig.category &&
      !used.has(i.id) &&
      interchangeable(i, orig) &&
      !violation(i, c) &&
      extra(i),
  );
  const close = ok.filter((i) => kinship(i, orig, outfit) === 2);
  if (close.length) return close;
  const color = ok.filter((i) => kinship(i, orig, outfit) === 1);
  if (color.length) return color;
  return anyCloset ? ok : [];
}

/** 同等场合匹配下：本衣橱 > 风格交集多 > 同色系 > 价格接近原件 */
function rank(orig: Item, outfit: Outfit, c: Constraints) {
  const own = (i: Item) => (i.curatorId === outfit.curatorId ? 1 : 0);
  const style = (i: Item) => overlap(i.styleTags, orig.styleTags) + overlap(i.styleTags, outfit.styleTags);
  const color = (i: Item) => (i.colorFamily && i.colorFamily === orig.colorFamily ? 1 : 0);
  return (a: Item, b: Item) =>
    score(b, c) - score(a, c) ||
    own(b) - own(a) ||
    style(b) - style(a) ||
    color(b) - color(a) ||
    Math.abs(a.price - orig.price) - Math.abs(b.price - orig.price);
}

/** pool 必须是 buildCandidatePool(outfit, …) 的结果。locale 只决定理由与概括的语言。 */
export function adaptOffline(outfit: Outfit, request: string, pool: Item[], locale: Locale = DEFAULT_LOCALE): AdaptDraft {
  const t = adaptCopy(locale);
  const nameOf = (i: Item) => itemName(i, locale);
  const c = parseConstraints(request);
  const cats = new Set<string>(relevantCategories(outfit, request));
  const all = pool.filter((i) => cats.has(i.category));
  const reasons = new Map<string, string>();
  const keptNotes: string[] = []; // 硬性要求没能满足、保留原款的说明（写进 summary）
  const unmet = new Set<string>(); // 没能完全满足的排除词
  let picks: Item[] = [...outfit.items];
  for (const it of picks) reasons.set(it.id, t.keep);
  const usedIds = () => new Set(picks.map((p) => p.id));
  // 当前单品 → 它替换掉的原搭配单品（连续替换时仍指向最初那件）
  const originOf = new Map<string, Item>();
  const replace = (from: Item, to: Item, why: string) => {
    const origin = originOf.get(from.id) ?? from;
    picks = picks.map((p) => (p.id === from.id ? to : p));
    originOf.set(to.id, origin);
    reasons.set(to.id, t.replaced(nameOf(origin), why));
  };

  // 1) 硬性要求：原搭配里命中的单品必须换掉；找不到同类替代就保留原款并如实说明。
  for (const it of [...picks]) {
    const v = violation(it, c);
    if (!v) continue;
    const alt = candidatesFor(it, outfit, all, usedIds(), c, undefined, true).sort(rank(it, outfit, c))[0];
    if (alt) {
      replace(it, alt, t.violation(v.why, v.word));
      continue;
    }
    if (v.kind === "exclude") unmet.add(v.word!);
    keptNotes.push(t.kept(v.kind, it.displayCategory || it.category, nameOf(it), v.word));
  }

  // 2) 场合偏好：最多换 2 件与场合最不搭的单品（只换成更合场合的同类，不动已经合适的）。
  if (c.scoreTags.length || c.comfy) {
    const swaps: { from: Item; to: Item; gain: number }[] = [];
    for (const it of picks) {
      if (!outfit.items.some((o) => o.id === it.id)) continue; // 已经换过的不再动
      const to = candidatesFor(it, outfit, all, usedIds(), c, (i) => score(i, c) > score(it, c)).sort(
        rank(it, outfit, c),
      )[0];
      if (to) swaps.push({ from: it, to, gain: score(to, c) - score(it, c) });
    }
    swaps.sort(
      (a, b) =>
        b.gain - a.gain ||
        score(a.from, c) - score(b.from, c) ||
        CATEGORY_ORDER.indexOf(a.from.category as never) - CATEGORY_ORDER.indexOf(b.from.category as never),
    );
    const taken = new Set<string>();
    let n = 0;
    for (const s of swaps) {
      if (n >= 2) break;
      if (taken.has(s.to.id)) continue;
      taken.add(s.to.id);
      replace(s.from, s.to, t.forOccasion(c.wantTags, s.to.displayCategory || s.to.category));
      n++;
    }
  }

  // 3) 预算：每次只换最贵、省得最多的那一件；替换件场合匹配度不低于原件。
  if (c.budget !== null) {
    let guard = 0;
    while (sumPrice(picks) > c.budget && guard++ < 30) {
      const used = usedIds();
      let best: { from: Item; to: Item; saving: number } | null = null;
      for (const it of picks) {
        const own = (i: Item) => (i.curatorId === outfit.curatorId ? 1 : 0);
        // 为省钱只在本衣橱/同风格里换（不为省钱换成别的风格），场合匹配度最多低一档（例如同衣橱的芭蕾鞋顶替乐福鞋）
        const enough = (i: Item) => kinship(i, it, outfit) === 2 && score(i, c) >= score(it, c) - 1;
        const to = candidatesFor(it, outfit, all, used, c, (i) => i.price < it.price && enough(i)).sort(
          (a, b) =>
            own(b) - own(a) ||
            score(b, c) - score(a, c) ||
            overlap(b.styleTags, it.styleTags) - overlap(a.styleTags, it.styleTags) ||
            a.price - b.price,
        )[0];
        if (to && (!best || it.price - to.price > best.saving)) best = { from: it, to, saving: it.price - to.price };
      }
      if (!best) break;
      replace(best.from, best.to, t.forBudget(best.to.displayCategory || best.to.category));
    }
    // 4) 还超预算就去掉非必需件（说明由服务端按实际差异生成）
    //    先去掉最贵的那件非必需件，尽量少去掉
    const optional = picks.filter((p) => ["外套", "包", "配饰"].includes(p.category)).sort((a, b) => b.price - a.price);
    for (const p of optional) {
      if (sumPrice(picks) <= c.budget) break;
      picks = picks.filter((x) => x.id !== p.id);
    }
  }

  picks.sort((a, b) => CATEGORY_ORDER.indexOf(a.category as never) - CATEGORY_ORDER.indexOf(b.category as never));

  const excludeHonored = c.exclude.filter((w) => !unmet.has(w));
  const occasion =
    c.formal && c.wantTags.includes("户外")
      ? t.partOutdoorFormal(c.wantTags.length > 2 ? c.wantTags.filter((x) => x !== "户外" && x !== "正式") : [])
      : c.wantTags.length
        ? t.partOccasion(c.wantTags)
        : null;
  const sizes = t.sizeText(c.sizes);
  const parts = [
    c.budget !== null ? t.partBudget(c.budget) : null,
    c.flat ? t.partFlat : c.comfy ? t.partComfy : null,
    occasion,
    excludeHonored.length ? t.partExclude(excludeHonored) : null,
    sizes ? t.partSize(sizes) : null,
  ].filter((x): x is string => !!x);
  const recognized = parts.length > 0 || c.exclude.length > 0;
  const summary = !recognized ? t.unrecognized : t.adapted(parts, outfitName(outfit, locale), t.joinKept(keptNotes));

  return {
    mode: "offline",
    picks: picks.map((p) => ({ itemId: p.id, reason: reasons.get(p.id) ?? "" })),
    summary,
    budget: c.budget,
    notes: c.budget !== null && sumPrice(picks) > c.budget ? [t.overBudget(c.budget)] : [],
    recognized,
  };
}
