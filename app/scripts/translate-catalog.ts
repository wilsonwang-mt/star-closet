// 生成目录英文覆盖表 data/catalog.en.json（D70）。付费：调用 Claude API（claude-opus-5-5），逐笔记账，--budget 封顶（美元，默认 10）。
// 用法：npx tsx --env-file=<含 ANTHROPIC_API_KEY 的 .env> scripts/translate-catalog.ts [--budget 10] [--force]
// 可续跑：已有译文的条目跳过；--force 全部重翻。先翻固定词表，再把它作为术语表交给后面的批次，保证用词一致。
// 只生成数据，不改数据库；页面在显示时按编号查这份表（lib/i18n/catalog.ts）。
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";

const MODEL = "claude-opus-5-5";
const PRICE_IN = 4 / 1e6; // 美元 / token（2026-10 价目）
const PRICE_OUT = 20 / 1e6;
const OUT = "data/catalog.en.json";

const args = process.argv.slice(2);
const budgetIdx = args.indexOf("--budget");
const BUDGET = budgetIdx >= 0 ? Number(args[budgetIdx + 1]) : 10;
const FORCE = args.includes("--force");

type Json = Record<string, unknown>;
type Overlay = {
  version: number;
  source_catalog_version: string;
  terms: Record<string, string>;
  curators: Record<string, Record<string, string>>;
  outfits: Record<string, Record<string, string>>;
  items: Record<string, Record<string, string>>;
};

const raw = JSON.parse(readFileSync("data/catalog.json", "utf-8")) as Json;
const list = (v: unknown) => (Array.isArray(v) ? v : Object.values(v as object)) as Json[];
const curators = list(raw.curators);
const outfits = list(raw.outfits);
const items = list(raw.items);

const overlay: Overlay =
  existsSync(OUT) && !FORCE
    ? (JSON.parse(readFileSync(OUT, "utf-8")) as Overlay)
    : { version: 1, source_catalog_version: String(raw.catalog_version ?? ""), terms: {}, curators: {}, outfits: {}, items: {} };
overlay.source_catalog_version = String(raw.catalog_version ?? "");

const client = new Anthropic();
let spent = 0;
const ledger: string[] = [];

const STYLE = `You translate the Chinese catalog of SEEN., a fashion platform where curators share complete looks, into English for an international audience.
Voice: editorial luxury fashion e-commerce (think SSENSE, Net-a-Porter, MR PORTER) — precise, warm, never gushing.
Rules:
- Translate meaning, not word by word. Keep it natural for native English readers.
- Product names: Title Case, concise, in the order colour + key detail + material + garment (e.g. "Ivory Fluid Acetate Shirt"). No brand names are invented.
- Short labels and tags: sentence case (e.g. "Quiet luxury", "Commute", "Fall/winter").
- Descriptions: fluent English prose, same length or shorter than the source; keep every factual claim (colours, materials, occasions, prices) and add none.
- Keep proper nouns and names of people as they are. Keep "SEEN." as is. Prices stay in Chinese yuan if mentioned (¥).
- Honesty notes (AI-generated imagery, fictional curators, reference prices) must stay accurate; do not soften or drop them.
- Output English only — no Chinese characters, no full-width punctuation.`;

function save() {
  writeFileSync(OUT, `${JSON.stringify(overlay, null, 2)}\n`);
}

async function call<T extends z.ZodTypeAny>(label: string, schema: T, prompt: string): Promise<z.infer<T>> {
  if (spent >= BUDGET) throw new Error(`已达预算上限 $${BUDGET}，停止（已花 $${spent.toFixed(3)}）`);
  const started = Date.now();
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium", format: zodOutputFormat(schema) },
    system: STYLE,
    messages: [{ role: "user", content: prompt }],
  });
  if (res.stop_reason === "refusal") throw new Error(`${label}：模型拒绝（${res.stop_details?.category ?? "未知"}）`);
  if (res.stop_reason === "max_tokens") throw new Error(`${label}：输出被截断，请把批次调小`);
  const cost = res.usage.input_tokens * PRICE_IN + res.usage.output_tokens * PRICE_OUT;
  spent += cost;
  const line = `${label}: in ${res.usage.input_tokens} out ${res.usage.output_tokens} $${cost.toFixed(4)} ${((Date.now() - started) / 1000).toFixed(1)}s 累计 $${spent.toFixed(4)}`;
  ledger.push(line);
  console.log(line);
  if (!res.parsed_output) throw new Error(`${label}：结构化输出解析失败`);
  return res.parsed_output;
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string" && !!x) : []);

// ---------- 1. 固定词 ----------
const termSet = new Set<string>();
const addTerm = (v: unknown) => {
  const s = str(v);
  if (s) termSet.add(s);
};
for (const c of curators) [c.closet_type, c.gender, ...arr(c.style_tags), ...arr(c.palette)].forEach(addTerm);
for (const o of outfits) [o.season, o.budget_tier, o.gender, ...arr(o.occasion_tags), ...arr(o.style_tags)].forEach(addTerm);
for (const i of items) {
  [i.category, i.display_category, i.subcategory, i.color, i.color_family, i.material, i.season, i.fit, i.heel, i.image_rights, i.gender].forEach(
    addTerm,
  );
  [...arr(i.style_tags), ...arr(i.occasion_tags), ...arr(i.tags)].forEach(addTerm);
}

const TERM_CONTEXT = `Context for fixed vocabulary:
- gender: 女装 = womenswear, 男装 = menswear, 中性 = unisex.
- closet types: 风格主题 (a closet built around a style), 穿搭博主 (style creator), 个人主理人 (independent curator), 品牌主题 (brand edit), 明星 (celebrity).
- budget tiers: 平价 (affordable, under ¥1,200 per look), 适中 (mid-range), 进阶 (investment).
- seasons like 秋冬 / 春夏 / 春秋 / 四季; categories like 上装 (tops), 下装 (bottoms), 外套 (outerwear), 鞋 (shoes), 包 (bags), 配饰 (accessories), 连衣裙 (dresses), 半身裙 (skirts).
- colour words, colour families (…色系), materials, fits, heel heights, style tags and occasion tags.
- 图片版权 "AI 生成" means the image is AI-generated.`;

async function translateTerms() {
  const todo = [...termSet].filter((t) => !overlay.terms[t]).sort();
  if (!todo.length) return console.log("固定词：已齐全");
  const schema = z.object({ terms: z.array(z.object({ zh: z.string(), en: z.string() })) });
  for (const batch of chunks(todo, 150)) {
    const out = await call(
      `固定词 ${batch.length}`,
      schema,
      `${TERM_CONTEXT}\n\nTranslate each fixed catalog term below into a short English label (sentence case). Return every input exactly once, copying "zh" verbatim.\n\n${batch.join("\n")}`,
    );
    for (const { zh, en } of out.terms) if (batch.includes(zh) && en.trim()) overlay.terms[zh] = en.trim();
    save();
  }
  const missing = [...termSet].filter((t) => !overlay.terms[t]);
  if (missing.length) console.warn(`固定词仍缺 ${missing.length}：${missing.join("、")}`);
}

function glossary(): string {
  return Object.entries(overlay.terms)
    .map(([zh, en]) => `${zh} = ${en}`)
    .join("\n");
}

// ---------- 2. 衣橱 ----------
async function translateCurators() {
  const todo = curators.filter((c) => FORCE || !overlay.curators[String(c.curator_id)]?.closetName);
  if (!todo.length) return console.log("衣橱：已齐全");
  const schema = z.object({
    curators: z.array(
      z.object({ id: z.string(), closetName: z.string(), tagline: z.string(), intro: z.string(), personaNote: z.string() }),
    ),
  });
  const input = todo.map((c) => ({
    id: c.curator_id,
    curator: c.display_name,
    closetType: c.closet_type,
    closetName: c.closet_name,
    tagline: c.tagline ?? "",
    intro: c.intro,
    personaNote: c.persona_note ?? "",
  }));
  const out = await call(
    `衣橱 ${todo.length}`,
    schema,
    `Glossary (use these exact renderings when the term appears):\n${glossary()}\n\nTranslate each closet: closetName is the closet's title (2–4 words, Title Case, evocative), tagline is one short line, intro is the curator's own voice (first person if the source is), personaNote is an honesty note. Leave "curator" names untouched (they are context only). Return every id once; return an empty string where the source is empty.\n\n${JSON.stringify(input, null, 1)}`,
  );
  for (const c of out.curators) {
    if (!todo.some((t) => t.curator_id === c.id)) continue;
    overlay.curators[c.id] = Object.fromEntries(Object.entries(c).filter(([k, v]) => k !== "id" && v.trim())) as Record<string, string>;
  }
  save();
}

// ---------- 3. 搭配 ----------
async function translateOutfits() {
  const todo = outfits.filter((o) => FORCE || !overlay.outfits[String(o.outfit_id)]?.name);
  if (!todo.length) return console.log("搭配：已齐全");
  const schema = z.object({
    outfits: z.array(z.object({ id: z.string(), name: z.string(), styleNote: z.string(), coverNote: z.string() })),
  });
  const closetName = (id: unknown) => overlay.curators[String(id)]?.closetName ?? "";
  for (const batch of chunks(todo, 20)) {
    const input = batch.map((o) => ({
      id: o.outfit_id,
      closet: closetName(o.curator_id),
      name: o.name,
      styleNote: o.style_note,
      coverNote: o.cover_note ?? "",
      occasions: arr(o.occasion_tags),
    }));
    const out = await call(
      `搭配 ${batch.length}`,
      schema,
      `Glossary:\n${glossary()}\n\nTranslate each look: name is the look's title (2–5 words, Title Case, like an editorial caption), styleNote is the curator's styling note (fluent prose, keep every garment, colour and reason), coverNote is an honesty note shown on the cover image. Return every id once; empty string where the source is empty.\n\n${JSON.stringify(input, null, 1)}`,
    );
    for (const o of out.outfits) {
      if (!batch.some((b) => b.outfit_id === o.id)) continue;
      overlay.outfits[o.id] = Object.fromEntries(Object.entries(o).filter(([k, v]) => k !== "id" && v.trim())) as Record<string, string>;
    }
    save();
  }
}

// ---------- 4. 单品名 + 重复出现的备注 ----------
async function translateItems() {
  const todo = items.filter((i) => FORCE || !overlay.items[String(i.item_id)]?.name);
  const schema = z.object({ items: z.array(z.object({ id: z.string(), name: z.string() })) });
  for (const batch of chunks(todo, 70)) {
    const input = batch.map((i) => ({
      id: i.item_id,
      name: i.name,
      category: i.subcategory ?? i.category,
      colour: i.color,
      material: i.material ?? "",
    }));
    const out = await call(
      `单品名 ${batch.length}`,
      schema,
      `Glossary:\n${glossary()}\n\nTranslate each product name into an English product title (Title Case, concise). "category", "colour" and "material" are context only. Return every id once.\n\n${JSON.stringify(input, null, 1)}`,
    );
    for (const o of out.items) {
      if (!batch.some((b) => b.item_id === o.id) || !o.name.trim()) continue;
      overlay.items[o.id] = { ...(overlay.items[o.id] ?? {}), name: o.name.trim() };
    }
    save();
  }

  // 价格说明、尺码说明、图片说明、购买按钮文字大量重复：去重后一次翻完，再按原文回填到每件单品。
  const fields = [
    ["price_note", "priceNote"],
    ["size_note", "sizeNote"],
    ["image_rights_note", "imageRightsNote"],
    ["buy_label", "buyLabel"],
  ] as const;
  const phrases = new Set<string>();
  for (const i of items) for (const [src] of fields) if (str(i[src])) phrases.add(String(i[src]));
  const done = new Map<string, string>();
  for (const i of items) {
    const o = overlay.items[String(i.item_id)] ?? {};
    for (const [src, dst] of fields) if (str(i[src]) && o[dst]) done.set(String(i[src]), o[dst]);
  }
  const pending = [...phrases].filter((p) => FORCE || !done.has(p));
  const phraseSchema = z.object({ phrases: z.array(z.object({ zh: z.string(), en: z.string() })) });
  for (const batch of chunks(pending, 80)) {
    const out = await call(
      `单品备注 ${batch.length}`,
      phraseSchema,
      `Glossary:\n${glossary()}\n\nThese are short notes shown on product pages: reference-price notes, size notes, image honesty notes (AI-generated product images, not real photos of items on sale) and the label of a button that searches Taobao for similar items. Translate each faithfully and concisely. Return every input once, copying "zh" verbatim.\n\n${batch.join("\n")}`,
    );
    for (const { zh, en } of out.phrases) if (batch.includes(zh) && en.trim()) done.set(zh, en.trim());
  }
  for (const i of items) {
    const id = String(i.item_id);
    const o = { ...(overlay.items[id] ?? {}) };
    for (const [src, dst] of fields) {
      const zh = str(i[src]);
      if (zh && done.has(zh)) o[dst] = done.get(zh)!;
    }
    overlay.items[id] = o;
  }
  save();
}

async function main() {
  console.log(`模型 ${MODEL}，预算 $${BUDGET}${FORCE ? "，全部重翻" : ""}`);
  console.log(`固定词 ${termSet.size}，衣橱 ${curators.length}，搭配 ${outfits.length}，单品 ${items.length}`);
  await translateTerms();
  await translateCurators();
  await translateOutfits();
  await translateItems();
  save();
  console.log(`完成，共 ${ledger.length} 次调用，花费 $${spent.toFixed(4)}`);
}

main().catch((e) => {
  save();
  console.error(e instanceof Error ? e.message : e);
  console.log(`中断，已花费 $${spent.toFixed(4)}；已保存的译文下次续跑会跳过`);
  process.exit(1);
});
