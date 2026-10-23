// 多语言框架（D70）的测试：语言协商、消息格式、各语言字典完整一致、目录与服务端提示的译文覆盖。
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { catalogTerms, localizeCurator, localizeItem, localizeOutfit, term } from "./catalog";
import { LOCALES, negotiateLocale, resolveLocale } from "./config";
import { formatMessage, placeholdersOf } from "./format";
import { MESSAGES } from "./messages";
import { localizeServerText } from "./phrases";
import { phrases } from "./phrases/en";
import { createTranslator } from "./translator";

const CJK = /[㐀-鿿！-～]/;

test("negotiateLocale：按权重找第一个支持的语言，q=0 跳过，对不上返回 null", () => {
  assert.equal(negotiateLocale("en-US,en;q=0.9,zh-CN;q=0.8"), "en");
  assert.equal(negotiateLocale("zh-CN,zh;q=0.9,en;q=0.8"), "zh");
  assert.equal(negotiateLocale("zh-TW"), "zh");
  assert.equal(negotiateLocale("ja,en;q=0.8,zh;q=0.5"), "en");
  assert.equal(negotiateLocale("en;q=0.2,zh;q=0.9"), "zh");
  assert.equal(negotiateLocale("en;q=0,fr"), null);
  assert.equal(negotiateLocale("fr-FR,de"), null);
  assert.equal(negotiateLocale("*"), null);
  assert.equal(negotiateLocale(""), null);
  assert.equal(negotiateLocale(null), null);
});

test("resolveLocale：手动选择优先，其次浏览器，最后中文", () => {
  assert.equal(resolveLocale("zh", "en-US"), "zh");
  assert.equal(resolveLocale("en", "zh-CN"), "en");
  assert.equal(resolveLocale("xx", "en-GB"), "en");
  assert.equal(resolveLocale(undefined, "fr"), "zh");
  assert.equal(resolveLocale(undefined, undefined), "zh");
});

test("formatMessage：插值、复数、精确匹配、选择与嵌套", () => {
  assert.equal(formatMessage("你好，{name}", { name: "Vera" }, "zh"), "你好，Vera");
  const pieces = "{n, plural, =0 {No pieces} one {# piece} other {# pieces}}";
  assert.equal(formatMessage(pieces, { n: 0 }, "en"), "No pieces");
  assert.equal(formatMessage(pieces, { n: 1 }, "en"), "1 piece");
  assert.equal(formatMessage(pieces, { n: 3 }, "en"), "3 pieces");
  assert.equal(formatMessage("{n, plural, other {# 件}}", { n: 1 }, "zh"), "1 件");
  assert.equal(formatMessage("{g, select, f {她} m {他} other {TA}}", { g: "m" }, "zh"), "他");
  assert.equal(
    formatMessage("{step} of {total}: {n, plural, one {# try} other {# tries}} for {name}", { step: 2, total: 3, n: 2, name: "Tops" }, "en"),
    "2 of 3: 2 tries for Tops",
  );
  assert.equal(formatMessage("没有参数 {x}", undefined, "zh"), "没有参数 {x}");
  assert.equal(formatMessage("缺参数 {x}", {}, "zh"), "缺参数 {x}");
});

test("createTranslator：按命名空间取值，缺键时显示键名", () => {
  const t = createTranslator("en", MESSAGES.en, "nav");
  assert.equal(t("bagWithCount", { n: 2 }), "Bag, 2 items");
  assert.equal(t("theme.aria", { current: "Night", next: "Day" }), "Display mode: Night. Tap to switch to Day");
  const loose = t as unknown as (k: string) => string;
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(loose("nope.missing"), "nav.nope.missing");
  } finally {
    console.warn = warn;
  }
});

function leaves(dict: unknown, prefix = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [k, v] of Object.entries(dict as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") for (const [kk, vv] of leaves(v, key)) out.set(kk, vv);
    else out.set(key, v);
  }
  return out;
}

test("各语言字典：键与中文完全一致，值都是非空字符串，占位符一致", () => {
  const source = leaves(MESSAGES.zh);
  for (const locale of LOCALES) {
    const dict = leaves(MESSAGES[locale]);
    assert.deepEqual([...dict.keys()].sort(), [...source.keys()].sort(), `${locale} 的键与中文不一致`);
    for (const [key, value] of dict) {
      assert.equal(typeof value, "string", `${locale}:${key} 不是字符串`);
      assert.ok((value as string).trim(), `${locale}:${key} 为空`);
      assert.deepEqual(placeholdersOf(value as string), placeholdersOf(source.get(key) as string), `${locale}:${key} 的占位符与中文不一致`);
    }
  }
});

test("英文字典里没有残留中文", () => {
  const leftovers = [...leaves(MESSAGES.en)].filter(([, v]) => CJK.test(String(v)));
  assert.deepEqual(leftovers.map(([k, v]) => `${k}: ${v}`), []);
});

type CatalogJson = {
  curators: { curator_id: string; closet_type: string; style_tags: string[]; palette: string[]; gender: string }[];
  outfits: { outfit_id: string; occasion_tags: string[]; style_tags: string[]; season: string; budget_tier: string; gender: string }[];
  items: {
    item_id: string;
    category: string;
    display_category: string;
    subcategory: string;
    color: string;
    color_family: string;
    material: string;
    season: string;
    fit: string;
    heel: string | null;
    image_rights: string;
    style_tags: string[];
    occasion_tags: string[];
    tags: string[];
    sizes?: string[];
    gender: string;
  }[];
};

function readCatalog(): CatalogJson {
  const raw = JSON.parse(readFileSync(path.join(process.cwd(), "data/catalog.json"), "utf-8")) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v : Object.values(v as object));
  return { curators: list(raw.curators), outfits: list(raw.outfits), items: list(raw.items) } as CatalogJson;
}

test("目录英文：每个固定词都有译文，每间衣橱、每套搭配、每件单品的文字都有译文且不含中文", () => {
  const cat = readCatalog();
  const used = new Set<string>();
  const add = (v: string | null | undefined) => v && used.add(v);
  for (const c of cat.curators) [c.closet_type, c.gender, ...c.style_tags, ...c.palette].forEach(add);
  for (const o of cat.outfits) [o.season, o.budget_tier, o.gender, ...o.occasion_tags, ...o.style_tags].forEach(add);
  for (const i of cat.items) {
    [i.category, i.display_category, i.subcategory, i.color, i.color_family, i.material, i.season, i.fit, i.heel, i.image_rights, i.gender]
      .forEach(add);
    [...i.style_tags, ...i.occasion_tags, ...i.tags].forEach(add);
    (i.sizes ?? []).filter((s) => CJK.test(s)).forEach(add); // 如“均码”
  }
  const table = catalogTerms("en");
  const missing = [...used].filter((t) => !table[t]);
  assert.deepEqual(missing, [], "缺少译文的固定词");
  const cjkTerms = Object.entries(table).filter(([, v]) => CJK.test(v));
  assert.deepEqual(cjkTerms, [], "固定词译文里有中文");

  for (const c of cat.curators) {
    const l = localizeCurator({ id: c.curator_id, closetName: "原", tagline: "原", intro: "原" }, "en");
    for (const f of ["closetName", "tagline", "intro"] as const) assert.ok(!CJK.test(l[f] ?? ""), `衣橱 ${c.curator_id}.${f} 没有英文`);
  }
  for (const o of cat.outfits) {
    const l = localizeOutfit({ id: o.outfit_id, name: "原", styleNote: "原" }, "en");
    assert.ok(!CJK.test(l.name ?? "") && !CJK.test(l.styleNote ?? ""), `搭配 ${o.outfit_id} 没有英文`);
  }
  for (const i of cat.items) {
    const l = localizeItem({ id: i.item_id, name: "原" }, "en");
    assert.ok(!CJK.test(l.name ?? ""), `单品 ${i.item_id} 没有英文名`);
  }
});

test("目录本地化：中文原样；英文只换自由文本，固定词与价格等字段不动", () => {
  const item = { id: "I001", name: "奶白垂感醋酸衬衫", category: "上装", price: 299, priceNote: null };
  assert.equal(localizeItem(item, "zh"), item);
  const en = localizeItem(item, "en");
  assert.equal(en.category, "上装");
  assert.equal(en.price, 299);
  assert.equal(en.priceNote, null);
  assert.equal(term("zh", "上装"), "上装");
  assert.equal(term("en", "不存在的词"), "不存在的词");
  const outfit = localizeOutfit({ id: "O01", name: "周一晨会", styleNote: "说明", items: [item] }, "en");
  assert.equal(outfit.items?.[0].category, "上装");
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}

test("服务端提示：app/api 里写死的中文错误都有英文，中文原样返回", () => {
  const literals = new Set<string>();
  for (const file of walk(path.join(process.cwd(), "app/api"))) {
    const src = readFileSync(file, "utf-8");
    for (const m of src.matchAll(/(?:error|jsonError\()\s*:?\s*"([^"\n]*[一-鿿][^"\n]*)"/g)) literals.add(m[1]);
  }
  const missing = [...literals].filter((s) => localizeServerText("en", s) === s);
  assert.deepEqual(missing, [], "以下服务端提示缺英文（lib/i18n/phrases/en.ts）");
  assert.equal(localizeServerText("zh", "请先登录"), "请先登录");
  const cjk = Object.entries(phrases).filter(([, v]) => CJK.test(v));
  assert.deepEqual(cjk, [], "服务端提示的英文里有中文");
});
