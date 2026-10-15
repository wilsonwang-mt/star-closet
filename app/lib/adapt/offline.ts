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
import type { Item, Outfit } from "../catalog";
import { CATEGORY_ORDER, sumPrice } from "../catalog-core";
import { fitsSize, interchangeable, parseSizes, relevantCategories, sizeText, type SizeWish } from "./rules";
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
  [/户外|草地|露天|海边|度假/, "户外"],
  [/婚礼|晚宴|正式|宴会/, "正式"],
  [/通勤|上班|面试|办公/, "通勤"],
  [/运动|健身|跑步|徒步/, "运动"],
  [/冬|冷|降温/, "秋冬"],
  [/夏|热|透气/, "春夏"],
  [/休闲|周末|逛街/, "休闲"],
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
    text.match(/(\d{2,6})\s*(?:元|块|以内|以下|之内)/);
  if (m) budget = Number(m[1]);

  const flat = /平底|平跟|不穿高跟|不要高跟|好走|舒服的鞋/.test(text);
  const comfy = /舒服|舒适|好走|轻松/.test(text);
  const wantTags = OCCASION_TAGS.filter(([re]) => re.test(text)).map(([, t]) => t);
  const formal = wantTags.includes("正式");
  const sport = wantTags.includes("运动");
  const scoreTags = formal ? wantTags.filter((t) => t !== "户外") : wantTags;
  const exclude = [...text.matchAll(/(?:不要|排除|不穿|别要|不想要)([一-龥A-Za-z]{1,4}?)(?:的|，|,|。|；|$|\s)/g)]
    .map((x) => x[1])
    .filter((w) => w !== "高跟");
  return { budget, flat, comfy, wantTags, scoreTags, formal, sport, exclude, sizes: parseSizes(text) };
}

const has = (it: Item, words: string[]) => {
  const hay = [it.name, it.material ?? "", it.subcategory ?? "", it.color, it.colorFamily ?? "", ...it.tags];
  return words.some((w) => hay.some((h) => h.includes(w)));
};

type Violation = { kind: "exclude" | "flat" | "size" | "occasion"; word?: string; why: string };

function violation(it: Item, c: Constraints): Violation | null {
  for (const w of c.exclude) if (has(it, expandExclude(w))) return { kind: "exclude", word: w, why: `含${w}` };
  if (c.flat && it.category === "鞋" && !it.tags.includes("平底")) return { kind: "flat", why: "不是平底" };
  if (c.comfy && it.category === "鞋" && it.heel === "高跟") return { kind: "flat", why: "是高跟" };
  if (c.formal && (FORMAL_BLOCK_SUB.has(it.subcategory ?? "") || FORMAL_BLOCK_MAT.has(it.material ?? "")))
    return { kind: "occasion", why: "不适合正式场合" };
  if (c.sport && (SPORT_BLOCK_HEEL.has(it.heel ?? "") || SPORT_BLOCK_MAT.has(it.material ?? "")))
    return { kind: "occasion", why: "不适合运动" };
  if (!fitsSize(it, c.sizes)) return { kind: "size", why: "没有你要的尺码" };
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
const clean = (name: string) => name.replace(/^占位：/, "");

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

/** pool 必须是 buildCandidatePool(outfit, …) 的结果。 */
export function adaptOffline(outfit: Outfit, request: string, pool: Item[]): AdaptDraft {
  const c = parseConstraints(request);
  const cats = new Set<string>(relevantCategories(outfit, request));
  const all = pool.filter((i) => cats.has(i.category));
  const reasons = new Map<string, string>();
  const keptNotes: string[] = []; // 硬性要求没能满足、保留原款的说明（写进 summary）
  const unmet = new Set<string>(); // 没能完全满足的排除词
  let picks: Item[] = [...outfit.items];
  for (const it of picks) reasons.set(it.id, "保留主理人原搭配");
  const usedIds = () => new Set(picks.map((p) => p.id));
  // 当前单品 → 它替换掉的原搭配单品（连续替换时仍指向最初那件）
  const originOf = new Map<string, Item>();
  const replace = (from: Item, to: Item, why: string) => {
    const origin = originOf.get(from.id) ?? from;
    picks = picks.map((p) => (p.id === from.id ? to : p));
    originOf.set(to.id, origin);
    reasons.set(to.id, `替换「${clean(origin.name)}」：${why}`);
  };

  // 1) 硬性要求：原搭配里命中的单品必须换掉；找不到同类替代就保留原款并如实说明。
  for (const it of [...picks]) {
    const v = violation(it, c);
    if (!v) continue;
    const alt = candidatesFor(it, outfit, all, usedIds(), c, undefined, true).sort(rank(it, outfit, c))[0];
    if (alt) {
      replace(it, alt, `原款${v.why}`);
      continue;
    }
    if (v.kind === "exclude") {
      unmet.add(v.word!);
      keptNotes.push(`目录内没有非${v.word}的${it.category}，保留原款「${clean(it.name)}」`);
    } else if (v.kind === "flat") {
      keptNotes.push(`目录内没有合适的平底${it.category}，保留原款「${clean(it.name)}」`);
    } else if (v.kind === "occasion") {
      keptNotes.push(`这间衣橱里没有更适合这个场合的${it.category}，保留原款「${clean(it.name)}」`);
    } else {
      keptNotes.push(`没有找到有你尺码的同类${it.category}，保留原款「${clean(it.name)}」`);
    }
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
      const label = c.wantTags.length ? c.wantTags.join("、") : "舒适";
      replace(s.from, s.to, `换成更适合${label}的${s.to.category}`);
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
      replace(best.from, best.to, `为控制预算，换成更实惠的${best.to.category}`);
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
      ? `场合：户外的正式场合${c.wantTags.length > 2 ? `，${c.wantTags.filter((t) => t !== "户外" && t !== "正式").join("、")}` : ""}`
      : c.wantTags.length
        ? `场合偏向${c.wantTags.join("、")}`
        : null;
  const parts = [
    c.budget !== null ? `预算 ${c.budget} 元` : null,
    c.flat ? "平底鞋" : c.comfy ? "舒适" : null,
    occasion,
    excludeHonored.length ? `排除${excludeHonored.join("、")}` : null,
    sizeText(c.sizes) ? `尺码${sizeText(c.sizes)}` : null,
  ].filter(Boolean);
  const recognized = parts.length > 0 || c.exclude.length > 0;
  const name = clean(outfit.name);
  const kept = keptNotes.length ? keptNotes.join("；") + "。" : "";
  const summary = !recognized
    ? "没有识别到具体约束，保留了原搭配。可以试试说预算、场合或想换的单品。"
    : parts.length
      ? `按「${parts.join("，")}」改编了「${name}」。${kept}`
      : `改编了「${name}」。${kept}`;

  return {
    mode: "offline",
    picks: picks.map((p) => ({ itemId: p.id, reason: reasons.get(p.id) ?? "" })),
    summary,
    budget: c.budget,
    notes: c.budget !== null && sumPrice(picks) > c.budget ? [`目录内找不到 ${c.budget} 元以内的完整搭配，这是最接近的一套`] : [],
    recognized,
  };
}
