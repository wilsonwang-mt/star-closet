// 改编的英文路径（D70）：说明、理由与概括用英文写，挑选逻辑与中文完全一致；英文请求也能识别常见约束。
// 直接读 data/catalog.json，不连接数据库、不调用 AI（AI 只检查构造出的提示词）。
import assert from "node:assert/strict";
import { test } from "node:test";
import { localizeItem } from "../i18n/catalog";
import { adaptSystemPrompt, buildAdaptPrompt } from "./ai";
import { loadCatalog } from "./catalog-fixture";
import { itemName } from "./copy";
import { finalizeAdapt } from "./finalize";
import { adaptOffline, parseConstraints } from "./offline";
import { buildCandidatePool, parseSizes } from "./rules";
import type { AdaptResult } from "./types";
import type { Outfit } from "../catalog";

const CJK = /[㐀-鿿]/;
// 单品名、搭配名按目录取（英文目录缺译文时为中文原名），检查模板时先去掉引号里的名称。
const withoutNames = (s: string) => s.replace(/“[^”]*”/g, "“”");

const { items, outfits } = loadCatalog();
const byId = new Map(outfits.map((o) => [o.id, o]));

function run(o: Outfit, request: string, locale: "zh" | "en") {
  const pool = buildCandidatePool(o, items);
  return finalizeAdapt(o, adaptOffline(o, request, pool, locale), pool, request, [], locale);
}

const shape = (r: AdaptResult) => ({
  ids: r.items.map((i) => i.id),
  total: r.total,
  changed: r.changed,
  recognized: r.recognized,
  overBudget: r.overBudget,
  notes: r.notes.length,
});

function assertEnglish(r: AdaptResult, where: string) {
  const texts = [r.summary, ...r.notes, ...r.items.map((i) => i.reason)];
  for (const t of texts) assert.ok(!CJK.test(withoutNames(t)), `${where}：${t}`);
}

const ZH_EXAMPLES = ["预算 800 以内，户外婚礼，换成平底鞋", "冬天通勤穿，不要皮革", "周末逛街，舒服一点，600 以内"];
const EN_EXAMPLES = ["Under 800, outdoor wedding, flat shoes", "Winter commute, no leather", "Weekend shopping, something comfy, under 600"];

for (const o of outfits) {
  test(`${o.id} 英文界面：中文要求挑出的单品与中文界面相同，说明全部是英文`, () => {
    for (const ex of [...ZH_EXAMPLES, "asdfghjkl"]) {
      const zh = run(o, ex, "zh");
      const en = run(o, ex, "en");
      assert.deepEqual(shape(en), shape(zh), `${o.id}「${ex}」`);
      assert.equal(en.items.map((i) => i.reason).filter(Boolean).length, zh.items.map((i) => i.reason).filter(Boolean).length);
      assertEnglish(en, `${o.id}「${ex}」`);
      // 被去掉的原单品都有英文说明（按英文名点名）
      const kept = new Set(en.items.map((i) => i.id));
      for (const it of o.items) {
        if (kept.has(it.id)) continue;
        const q = `“${itemName(it, "en")}”`;
        assert.ok(en.notes.some((n) => n.includes(q)) || en.items.some((i) => i.reason.includes(q)), `${o.id}「${ex}」：${q} 被移除却没有说明`);
      }
      if (!en.changed && en.recognized) assert.match(en.summary, /^Nothing in “[^”]*” needed changing/);
      if (!en.recognized) assert.match(en.summary, /couldn't spot a specific request/);
    }
  });
}

test("英文要求：识别出与中文示例相同的约束，挑出相同的单品", () => {
  for (const [i, en] of EN_EXAMPLES.entries()) {
    const zh = ZH_EXAMPLES[i];
    const a = parseConstraints(en);
    const b = parseConstraints(zh);
    assert.deepEqual(
      { budget: a.budget, flat: a.flat, comfy: a.comfy, tags: a.wantTags, exclude: a.exclude },
      { budget: b.budget, flat: b.flat, comfy: b.comfy, tags: b.wantTags, exclude: b.exclude },
      en,
    );
    for (const id of ["O01", "O13"]) {
      const o = byId.get(id)!;
      assert.deepEqual(run(o, en, "en").items.map((x) => x.id), run(o, zh, "zh").items.map((x) => x.id), `${id}「${en}」`);
    }
  }
  const r = run(byId.get("O01")!, "Winter commute, no leather", "en");
  assert.match(r.summary, /^Adapted “[^”]+” for .*no leather/);
  assert.ok(r.items.some((i) => /^Replaces “[^”]+”: /.test(i.reason)));
  assert.ok(r.items.some((i) => i.reason === "Kept from the curator's original look"));
  assert.equal(parseConstraints("Budget of ¥450 please").budget, 450);
  assert.equal(parseConstraints("no more than 1200 yuan").budget, 1200);
  assert.equal(parseConstraints("Something for a dinner").budget, null);
  assert.equal(parseConstraints("Ready within 10 minutes").budget, null);
  // 常见动词不当场合：“would this work”“running late”
  assert.deepEqual(parseConstraints("Would this work? I'm running late").wantTags, []);
  assert.deepEqual(parseConstraints("Smart enough for work, then the gym").wantTags, ["通勤", "运动"]);
});

test("尺码：英文缩写里的 m、s 不当尺码；size 38、XL 照常识别", () => {
  assert.deepEqual(parseSizes("I'm going to a wedding, let's keep it simple"), { letter: null, shoe: null });
  assert.deepEqual(parseSizes("It’s for work"), { letter: null, shoe: null });
  assert.deepEqual(parseSizes("XL please, size 38 shoes"), { letter: "XL", shoe: "38" });
  assert.deepEqual(parseSizes("size m"), { letter: "M", shoe: null });
  // 中文说法不变
  assert.deepEqual(parseSizes("衣服 L 码，鞋 37 码"), { letter: "L", shoe: "37" });
});

test("服务端收尾（英文）：去掉了的单品、无改动说明、超过类目上限都用英文；改编器自己写的移除说明不采用", () => {
  const o = byId.get("O01")!;
  const pool = buildCandidatePool(o, items);
  const [first, ...rest] = o.items;
  // 去掉第一件，并附一条模型自己写的“Removed …”说明（应被丢弃，由服务端按实际差异生成）
  const dropped = finalizeAdapt(
    o,
    {
      mode: "ai",
      picks: rest.map((i) => ({ itemId: i.id, reason: "Keeps the original palette" })),
      summary: "A lighter take on the look.",
      budget: null,
      notes: ["Removed the bag to simplify", "The trousers run long"],
    },
    pool,
    "lighter",
    [],
    "en",
  );
  assert.ok(dropped.notes.includes(`Removed “${itemName(first, "en")}”`), dropped.notes.join(" | "));
  assert.ok(!dropped.notes.includes("Removed the bag to simplify"));
  assert.ok(dropped.notes.includes("The trousers run long"));

  // 结果与原搭配相同：规则模式“Adapted … for …”开头被换成无改动说明，后半句保留
  const same = finalizeAdapt(
    o,
    {
      mode: "offline",
      picks: o.items.map((i) => ({ itemId: i.id, reason: "Kept from the curator's original look" })),
      summary: `Adapted “${o.name}” for a budget of ¥9999. There's no alternative in your size, so we kept “X”.`,
      budget: 9999,
      notes: [],
      recognized: true,
    },
    pool,
    "budget 9999",
    [],
    "en",
  );
  assert.equal(same.changed, false);
  assert.match(same.summary, /^Nothing in “[^”]+” needed changing for this request, so we kept the original look\. There's no alternative in your size/);

  // 同一类目超过上限：英文说明点名没采用的那件
  const shoes = pool.filter((i) => i.category === "鞋").slice(0, 2);
  const capped = finalizeAdapt(
    o,
    { mode: "ai", picks: shoes.map((i) => ({ itemId: i.id, reason: "x" })), summary: "s", budget: null, notes: [] },
    pool,
    "shoes",
    [],
    "en",
  );
  assert.ok(capped.notes.some((n) => n.startsWith(`Left out “${itemName(shoes[1], "en")}”: only 1 piece allowed from `)), capped.notes.join(" | "));
  for (const n of capped.notes) assert.ok(!CJK.test(withoutNames(n)), n);
});

test("AI 提示词（英文）：同一批候选编号；给用户看的文字要求用英文，目录名称换成英文；中文提示词不变", () => {
  const o = byId.get("O13")!;
  const pool = buildCandidatePool(o, items);
  const req = "Weekend market, under 900";
  const zh = buildAdaptPrompt(o, req, pool, "zh");
  const en = buildAdaptPrompt(o, req, pool, "en");
  assert.deepEqual([...en.known].sort(), [...zh.known].sort());
  assert.equal(zh.system, adaptSystemPrompt());
  assert.match(zh.system, /reason 用中文写一句话/);
  assert.match(en.system, /English only/);
  assert.match(en.system, /reason 用英文写一句话/);
  assert.match(en.system, /summary 用英文写/);
  assert.doesNotMatch(en.system, /用中文写/);
  const byItem = new Map(items.map((i) => [i.id, i]));
  for (const id of en.known) {
    const it = byItem.get(id)!;
    const enName = localizeItem(it, "en").name;
    assert.ok(en.userText.includes(JSON.stringify(enName).slice(1, -1)), `${id} 的名称应为英文目录名`);
    assert.ok(en.userText.includes(`"item_id":"${id}"`));
  }
  // 中文提示词仍是中文目录名
  for (const id of zh.known) assert.ok(zh.userText.includes(JSON.stringify(byItem.get(id)!.name).slice(1, -1)));
  assert.match(en.userText, /用户的要求：Weekend market, under 900$/);
});
