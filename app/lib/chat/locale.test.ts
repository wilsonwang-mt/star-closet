// 悬浮对话英文化（D70）的单元测试：英文输入能被规则层认出、理解行与兜底回复为英文、系统提示与目录快照按语言生成。
// 不连数据库、不调用 AI；不依赖英文目录覆盖表的具体内容（data/catalog.en.json 可能还没生成完）。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { loadCatalog } from "../adapt/catalog-fixture";
import { MESSAGES } from "../i18n/messages";
import { locate, localizeLabels, parseQuery, ruleLabels, type LocateQuery } from "../locate/core";
import { catalogForPrompt, chatTools, systemPrompt, toMessages } from "./ai";
import { pageCard, type ChatCatalog } from "./cards";
import { describePage, describeUser, hasOwnSignal, rulesHint, type ChatUser } from "./context";
import { normalizeEnglish } from "./english";
import { formatYuan } from "./protocol";

const CJK = /[㐀-鿿！-～]/;

function buildCatalog(): ChatCatalog {
  const raw = JSON.parse(readFileSync(path.join(process.cwd(), "data/catalog.json"), "utf-8")) as { curators: Record<string, unknown>[] };
  const { items, outfits } = loadCatalog();
  const seen = new Map<string, number>();
  return {
    closets: raw.curators.map((c) => ({
      id: String(c.curator_id),
      displayName: String(c.display_name),
      closetName: String(c.closet_name),
      closetType: String(c.closet_type),
      gender: String(c.gender ?? "女装"),
      tagline: String(c.tagline ?? ""),
      styleTags: (c.style_tags as string[]) ?? [],
      avatar: null,
      cover: "",
      outfitCount: outfits.filter((o) => o.curatorId === c.curator_id).length,
    })),
    outfits: outfits.map((o) => {
      const no = (seen.get(o.curatorId) ?? 0) + 1;
      seen.set(o.curatorId, no);
      return {
        id: o.id,
        curatorId: o.curatorId,
        name: o.name,
        styleNote: o.styleNote,
        occasionTags: o.occasionTags,
        styleTags: o.styleTags,
        season: o.season,
        budgetTier: o.budgetTier,
        gender: o.gender,
        total: o.total,
        cover: o.cover,
        no,
        itemIds: o.items.map((i) => i.id),
      };
    }),
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      category: i.category,
      subcategory: i.subcategory,
      color: i.color,
      material: i.material,
      price: i.price,
      gender: i.gender,
    })),
  };
}

const catalog = buildCatalog();
const zh = MESSAGES.zh.chat;
const en = MESSAGES.en.chat;

/** 与 app/api/chat/route.ts 相同的解析路径：英文先换成规则层认得的词。 */
const ask = (text: string, locale: "zh" | "en", prev?: LocateQuery, shown: string[] = []) =>
  locate(catalog, parseQuery(normalizeEnglish(text), catalog.closets, prev, shown), locale);

const signal = (q: LocateQuery) => ({
  person: q.person,
  styles: q.styles,
  occasions: q.occasions,
  avoid: q.avoid,
  gender: q.gender,
  budget: q.budget,
  tier: q.tier,
  skipClosets: q.skipClosets,
});

test("英文示例与追问 chip 被规则层认出的条件与中文原句相同（没有 AI 时也名副其实，D48）", () => {
  const pairs: [string, string][] = [
    [en.examples.wedding, zh.examples.wedding],
    [en.examples.date, zh.examples.date],
    [en.examples.newYear, zh.examples.newYear],
    [en.chips.wedding, zh.chips.wedding],
    [en.chips.date, zh.chips.date],
    [en.chips.newYear, zh.chips.newYear],
    [en.chips.under1000, zh.chips.under1000],
  ];
  for (const [e, z] of pairs) {
    const re = ask(e, "en");
    const rz = ask(z, "zh");
    assert.deepEqual(signal(re.query), signal(rz.query), `${e} ≠ ${z}`);
    assert.equal(re.outfits[0]?.outfit.id, rz.outfits[0]?.outfit.id, `${e} 的首选与中文不同`);
  }
});

test("英文追问沿用上一轮条件：Only womenswear / A bit cheaper / Try another style", () => {
  const first = ask("Weekend hiking, under ¥1,000", "en");
  assert.equal(first.ambiguousGender, true);
  assert.deepEqual(first.chips, [en.chips.womenOnly, en.chips.menOnly, en.chips.cheaper]);
  const women = ask(en.chips.womenOnly, "en", first.query);
  assert.equal(women.query.gender, "女装");
  assert.equal(women.query.budget, 1000);
  assert.equal(women.outfits[0].outfit.id, "O13");

  const wedding = ask("Outdoor wedding, budget 2000", "en");
  assert.equal(ask(en.chips.cheaper, "en", wedding.query).query.budget, 1400);

  const commute = ask("Old money look for the office", "en");
  assert.equal(commute.closets[0].closet.id, "C01");
  const other = ask(en.chips.otherStyle, "en", commute.query, ["C01"]);
  assert.ok(other.closets.every((c) => c.closet.id !== "C01"));
});

test("英文理解行：条件名为英文，价格带千分位；中文仍是 parseQuery 原样的标签", () => {
  const r = ask("Outdoor wedding next week, under ¥1,500, something soft", "en");
  const labels = localizeLabels(r.query, catalog.closets, "en");
  assert.deepEqual(labels, ["Outdoor wedding", "Elegant", "Under ¥1,500"]);
  const z = ask("下周去朋友的户外婚礼，预算 1500，想温柔一点", "zh");
  assert.equal(localizeLabels(z.query, catalog.closets, "zh"), z.query.labels);
  // 查询里的值保持中文（会存进 sessionStorage、下一轮带回来）
  assert.deepEqual(r.query.occasionLabels, ["户外婚礼"]);

  // 避开的条件名来自目录固定词表（term），不断言具体译文
  const [occasion, gender, avoid, ...rest] = localizeLabels(ask(en.examples.date, "en").query, catalog.closets, "en");
  assert.deepEqual([occasion, gender, rest], ["Date", "Menswear", []]);
  assert.ok(avoid.startsWith("Not too "), avoid);
  assert.equal(localizeLabels(ask("Dress like Vera for an interview", "en").query, catalog.closets, "en")[0], "Like 林薇 Vera");
});

test("规则层词表里的每个条件标签在 chat 字典里都有英文", () => {
  const known = new Set([...Object.values(zh.labels.occasion), ...Object.values(zh.labels.style)]);
  assert.deepEqual(ruleLabels().filter((l) => !known.has(l)), []);
  for (const v of [...Object.values(en.labels.occasion), ...Object.values(en.labels.style)]) assert.ok(!CJK.test(v), v);
});

test("英文兜底回复与追问：没有中文", () => {
  for (const text of ["just browsing", "Outdoor wedding, under ¥1,500", "Summer wedding", "Concert, sweet and cool, under 800", "Show me my bag"]) {
    const r = ask(text, "en");
    assert.ok(!CJK.test(r.text), `${text} → ${r.text}`);
    for (const c of r.chips) assert.ok(!CJK.test(c), `${text} → ${c}`);
  }
  assert.match(ask("Concert, sweet and cool, under 800", "en").text, /over budget/);
  assert.equal(ask("just browsing", "en").text, en.reply.ask);
});

test("hasOwnSignal 认英文：找衣服的条件与功能页算，闲聊与追问不算", () => {
  assert.equal(hasOwnSignal("Outdoor wedding, under ¥1,500", catalog), true);
  assert.equal(hasOwnSignal(en.chips.womenOnly, catalog), true);
  assert.equal(hasOwnSignal("Take me to my fitting room", catalog), true);
  assert.equal(hasOwnSignal("Hi there!", catalog), false);
  assert.equal(hasOwnSignal("Why does the first one suit me?", catalog), false);
  assert.equal(hasOwnSignal("What are the shoes in this look?", catalog), false);
  // work 作动词时不算通勤
  assert.doesNotMatch(normalizeEnglish("Would this work for a wedding?"), /通勤/);
  assert.match(normalizeEnglish("Something for work"), /通勤/);
});

test("normalizeEnglish：中文原样；常见词里的主理人名不误认", () => {
  assert.equal(normalizeEnglish("下周户外婚礼，1500 以内"), "下周户外婚礼，1500 以内");
  assert.equal(parseQuery(normalizeEnglish("Suede boots with a leopard print bag"), catalog.closets).person, null);
  assert.equal(parseQuery(normalizeEnglish("Something like Leo"), catalog.closets).person, "C09");
});

test("目录快照按语言生成并分开缓存；中文快照不变", () => {
  const zhText = catalogForPrompt(catalog, "zh");
  const enText = catalogForPrompt(catalog, "en");
  assert.ok(zhText.startsWith("目录（币种人民币"));
  assert.match(zhText, /衣橱（id｜衣橱名｜主理人/);
  assert.ok(enText.startsWith("Catalog (currency RMB"));
  for (const header of ["Closets (id | closet name | curator", "Looks (id | closet | number and name", "Pieces (id | name | category", "Feature pages (page | name | description)"])
    assert.ok(enText.includes(header), header);
  assert.match(enText, /^bag \| Bag \| /m);
  assert.notEqual(zhText, enText);
  assert.equal(catalogForPrompt(catalog, "en"), enText);
  assert.equal(catalogForPrompt(catalog), zhText);
});

test("系统提示：英文站有明确的英文回复指令，中文站与原规则相同；工具名与参数一致，只换说明", () => {
  const enSys = systemPrompt(catalog, "en");
  const zhSys = systemPrompt(catalog, "zh");
  assert.match(enSys[0].text, /Always reply in English/);
  assert.ok(!CJK.test(enSys[0].text), "英文规则里有中文");
  assert.match(zhSys[0].text, /中文口语/);
  assert.doesNotMatch(zhSys[0].text, /reply in English/);
  for (const s of [enSys, zhSys]) assert.deepEqual(s[1].cache_control, { type: "ephemeral" });

  const strip = (tools: ReturnType<typeof chatTools>) =>
    JSON.parse(JSON.stringify(tools), (k, v) => (k === "description" ? undefined : v)) as unknown;
  assert.deepEqual(strip(chatTools("en")), strip(chatTools("zh")));
  for (const t of chatTools("en")) assert.ok(!CJK.test(JSON.stringify(t)), t.name);
});

test("消息附注：英文站用英文括注并要求英文回复", () => {
  const msgs = toMessages(
    [
      { role: "user", text: "Outdoor wedding" },
      { role: "assistant", text: "Here are two looks.", shown: ["O31", "C06"] },
      { role: "user", text: "Why the first one?" },
    ],
    "The user is on the home page.",
    "en",
  );
  assert.equal(msgs[1].content, "Here are two looks.\n(Shown: O31, C06)");
  assert.equal(msgs[2].content, "Why the first one?\n\n(Page & user: a system note, not said by the user; reply in English. The user is on the home page.)");
  const zhMsgs = toMessages([{ role: "user", text: "你好" }], "用户在首页。");
  assert.equal(zhMsgs[0].content, "你好\n\n（页面与用户，系统附注，不是用户说的话：用户在首页。）");
});

test("页面与用户说明、初筛提示：英文站写英文", () => {
  assert.match(describePage({ kind: "outfit", outfitId: "O31" }, catalog, "en"), /^The user is viewing look O31 ".+" \(N°\d\d in closet C06/);
  assert.equal(describePage({ kind: "bag" }, catalog, "en"), "The user is on the Bag page.");
  const u: ChatUser = {
    signedIn: true,
    styleTags: [],
    favoriteColors: [],
    sizeTop: "M",
    sizeBottom: null,
    sizeShoe: "38",
    budgetMin: 500,
    budgetMax: 1500,
    city: "Shanghai",
    avatar: "twin",
    tryonEnabled: true,
    looks: 2,
    bag: 1,
  };
  const s = describeUser({ ...u, heightCm: 165 } as ChatUser, "en");
  assert.ok(!CJK.test(s), s);
  assert.match(s, /tops M \/ shoes 38/);
  assert.match(s, /¥500–¥1,500/);
  assert.doesNotMatch(s, /165/);
  assert.match(describeUser(null, "en"), /not signed in/);
  const hint = rulesHint(ask("Outdoor wedding, under ¥1,500", "en"), catalog.closets, "en");
  assert.match(hint, /^recognized Outdoor wedding, Under ¥1,500; rule-based shortlist O31 /);
});

test("功能页卡片与价格格式按语言", () => {
  assert.equal(pageCard("bag", "en").title, "Bag");
  assert.equal(pageCard("bag").title, "购物袋");
  assert.equal(pageCard("bag", "en").href, pageCard("bag").href);
  assert.equal(formatYuan(1280, "en"), "¥1,280");
  assert.equal(formatYuan(1280, "zh"), "¥1280");
});
