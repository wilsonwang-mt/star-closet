// 离线规则模式：没有 API key 或 AI 调用失败时使用。界面会明确标注“非 AI”。
// 只在候选池（同衣橱 + 同性别/中性，见 rules.ts）里、且只在相关类目里替换；替换一律同类一换一，
// 所以叠穿搭配的两件上装会保留为两件。
import { CATEGORY_ORDER, sumPrice, type Item, type Outfit } from "../catalog";
import { fitsSize, parseSizes, relevantCategories, sizeText, type SizeWish } from "./rules";
import type { AdaptDraft } from "./types";

type Constraints = {
  budget: number | null;
  flat: boolean;
  wantTags: string[];
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

export function parseConstraints(text: string): Constraints {
  let budget: number | null = null;
  const m =
    text.match(/预算\s*(?:在|是|为)?\s*(\d{2,6})/) ??
    text.match(/(\d{2,6})\s*(?:元|块|以内|以下|之内)/);
  if (m) budget = Number(m[1]);

  const flat = /平底|平跟|不穿高跟|不要高跟|好走|舒服的鞋/.test(text);
  const wantTags = OCCASION_TAGS.filter(([re]) => re.test(text)).map(([, t]) => t);
  const exclude = [...text.matchAll(/(?:不要|排除|不穿|别要)([一-龥]{1,4}?)(?:的|，|,|。|$|\s)/g)]
    .map((x) => x[1])
    .filter((w) => w !== "高跟");
  return { budget, flat, wantTags, exclude, sizes: parseSizes(text) };
}

function violates(it: Item, c: Constraints): string | null {
  if (c.flat && it.category === "鞋" && !it.tags.includes("平底")) return "不是平底";
  for (const w of c.exclude) if (it.name.includes(w) || it.tags.includes(w)) return `含“${w}”`;
  if (!fitsSize(it, c.sizes)) return "没有你要的尺码";
  return null;
}

function score(it: Item, c: Constraints) {
  return c.wantTags.filter((t) => it.tags.includes(t)).length;
}

function bestAlternative(cat: string, all: Item[], used: Set<string>, c: Constraints, curatorId: string) {
  const own = (i: Item) => (i.curatorId === curatorId ? 1 : 0);
  return all
    .filter((i) => i.category === cat && !used.has(i.id) && !violates(i, c))
    .sort((a, b) => score(b, c) - score(a, c) || own(b) - own(a) || a.price - b.price)[0];
}

/** pool 必须是 buildCandidatePool(outfit, …) 的结果。 */
export function adaptOffline(outfit: Outfit, request: string, pool: Item[]): AdaptDraft {
  const c = parseConstraints(request);
  const cats = new Set<string>(relevantCategories(outfit, request));
  const all = pool.filter((i) => cats.has(i.category));
  const notes: string[] = [];
  const reasons = new Map<string, string>();
  let picks: Item[] = [...outfit.items];
  for (const it of picks) reasons.set(it.id, "保留主理人原搭配");

  // 1) 替换不满足硬性要求的单品
  picks = picks.flatMap((it) => {
    const why = violates(it, c);
    if (!why) return [it];
    const used = new Set(picks.map((p) => p.id));
    const alt = bestAlternative(it.category, all, used, c, outfit.curatorId);
    if (!alt) {
      notes.push(`目录里没有满足要求的${it.category}，已去掉「${it.name.replace(/^占位：/, "")}」`);
      return [];
    }
    reasons.set(alt.id, `原单品${why}，换成同类款`);
    return [alt];
  });

  // 2) 按预算换成更便宜的同类：先动配饰、包、外套，再动核心件；
  //    连衣裙只换连衣裙，替换件的场合匹配度不低于原件，避免为省钱换掉搭配的主角。
  if (c.budget !== null) {
    const isDress = (i: Item) => i.tags.includes("连衣裙");
    for (const group of [["配饰", "包", "外套"], ["鞋", "下装", "上装"]]) {
      let guard = 0;
      while (sumPrice(picks) > c.budget && guard++ < 20) {
        const used = new Set(picks.map((p) => p.id));
        let best: { from: Item; to: Item; saving: number } | null = null;
        for (const it of picks.filter((p) => group.includes(p.category))) {
          const to = all
            .filter(
              (i) =>
                i.category === it.category &&
                !used.has(i.id) &&
                !violates(i, c) &&
                i.price < it.price &&
                isDress(i) === isDress(it) &&
                score(i, c) >= score(it, c),
            )
            .sort((a, b) => a.price - b.price)[0];
          if (to && (!best || it.price - to.price > best.saving)) best = { from: it, to, saving: it.price - to.price };
        }
        if (!best) break;
        const { from, to } = best;
        picks = picks.map((p) => (p.id === from.id ? to : p));
        reasons.set(to.id, `为控制预算，换成更实惠的${to.category}`);
      }
    }
    // 3) 还超预算就去掉非必需件
    for (const cat of ["配饰", "外套", "包"]) {
      if (sumPrice(picks) <= c.budget) break;
      const drop = picks.filter((p) => p.category === cat);
      if (drop.length) {
        picks = picks.filter((p) => p.category !== cat);
        notes.push(`为守住预算去掉了${cat}：${drop.map((d) => d.name.replace(/^占位：/, "")).join("、")}`);
      }
    }
    if (sumPrice(picks) > c.budget) notes.push(`目录内找不到 ${c.budget} 元以内的完整搭配，这是最接近的一套`);
  }

  picks.sort((a, b) => CATEGORY_ORDER.indexOf(a.category as never) - CATEGORY_ORDER.indexOf(b.category as never));
  const parts = [
    c.budget !== null ? `预算 ${c.budget} 元` : null,
    c.flat ? "平底鞋" : null,
    c.wantTags.length ? `场合偏向${c.wantTags.join("、")}` : null,
    c.exclude.length ? `排除${c.exclude.join("、")}` : null,
    sizeText(c.sizes) ? `尺码${sizeText(c.sizes)}` : null,
  ].filter(Boolean);
  return {
    mode: "offline",
    picks: picks.map((p) => ({ itemId: p.id, reason: reasons.get(p.id) ?? "" })),
    summary: parts.length
      ? `按「${parts.join("，")}」改编了「${outfit.name.replace(/^占位：/, "")}」。`
      : "没有识别到具体约束，保留了原搭配。可以试试说预算、场合或想换的单品。",
    budget: c.budget,
    notes,
  };
}
