// 对话定位规则层的回归测试：直接读 data/catalog.json，不连接数据库、不调用 AI。
// 12 句样例来自 docs/design/AI对话定位方案.md §3.5。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { loadCatalog } from "../adapt/catalog-fixture";
import { locate, parseQuery, type LocateCatalog, type LocateQuery } from "./core";

function buildCatalog(): LocateCatalog {
  const raw = JSON.parse(readFileSync(path.join(process.cwd(), "data/catalog.json"), "utf-8")) as {
    curators: Record<string, unknown>[];
  };
  const { outfits } = loadCatalog();
  const closets = raw.curators.map((c) => ({
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
  }));
  const seen = new Map<string, number>();
  return {
    closets,
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
      };
    }),
  };
}

const catalog = buildCatalog();
const ask = (text: string, prev?: LocateQuery, shown: string[] = []) =>
  locate(catalog, parseQuery(text, catalog.closets, prev, shown));

test("户外婚礼 + 预算 + 温柔 → 阿May · 户外草坪婚礼（不把「户外」再算成运动）", () => {
  const r = ask("下周去朋友的户外婚礼，预算 1500，想温柔一点");
  assert.deepEqual(r.query.occasions, ["户外婚礼", "婚礼宾客"]);
  assert.equal(r.query.budget, 1500);
  assert.equal(r.outfits[0].outfit.id, "O31");
  assert.equal(r.closets[0].closet.id, "C06");
});

test("男生、别太正式 → 只给男装或中性，约会优先，正式被记为避开", () => {
  const r = ask("男生，第一次约会，别太正式");
  assert.equal(r.query.gender, "男装");
  assert.ok(r.query.avoid.includes("正式"));
  assert.ok(!r.query.occasions.includes("正式"));
  assert.equal(r.outfits[0].outfit.id, "O46");
  assert.ok(r.outfits.every((s) => s.outfit.gender === "男装" || s.outfit.gender === "中性"));
});

test("周末去爬山 → 「周末」降权，徒步搭配优先；男女同分时追问性别", () => {
  const r = ask("周末去爬山，1000 以内");
  assert.ok(["O51", "O13"].includes(r.outfits[0].outfit.id));
  assert.equal(r.ambiguousGender, true);
  assert.deepEqual(r.chips.slice(0, 2), ["只看女装", "只看男装"]);
  assert.match(r.text, /超出预算/);
});

test("追问「只看女装」沿用上一轮条件", () => {
  const first = ask("周末去爬山，1000 以内");
  const r = ask("只看女装", first.query);
  assert.equal(r.query.gender, "女装");
  assert.equal(r.query.budget, 1000);
  assert.equal(r.outfits[0].outfit.id, "O13");
});

test("像 Vera 那样去面试 → 静奢通勤 · 面试第一印象", () => {
  const r = ask("想穿得像 Vera 那样去面试");
  assert.equal(r.query.person, "C01");
  assert.equal(r.outfits[0].outfit.id, "O02");
});

test("过年回家，新中式 → 新中式 · 过年回家", () => {
  assert.equal(ask("过年回家见亲戚，新中式一点").outfits[0].outfit.id, "O20");
});

test("演唱会 + 甜酷 + 预算低于所有搭配 → 仍选对口的那套，并提示可以按预算改", () => {
  const r = ask("去看演唱会，甜酷，800 以内");
  assert.equal(r.outfits[0].outfit.id, "O26");
  assert.match(r.text, /按预算改/);
});

test("老钱风通勤 → 静奢通勤 · 周一晨会", () => {
  const r = ask("老钱风通勤");
  assert.equal(r.closets[0].closet.id, "C01");
  assert.equal(r.outfits[0].outfit.id, "O01");
});

test("露营 + 工装 → 美式复古工装 · 秋日露营", () => {
  assert.equal(ask("露营，工装风").outfits[0].outfit.id, "O59");
});

test("给男朋友挑出差 → 男士都市通勤 · 出差两天", () => {
  assert.equal(ask("给男朋友挑一套出差穿的").outfits[0].outfit.id, "O47");
});

test("公司年会 → 婚礼宾客与派对 · 公司年会", () => {
  assert.equal(ask("公司年会穿什么").outfits[0].outfit.id, "O34");
});

test("看展 + 暖色：规则只保证场合对，交给 AI 精排", () => {
  const r = ask("秋天去看展，想要暖一点的颜色");
  assert.ok(r.query.styles.includes("美拉德"));
  assert.ok(r.outfits[0].outfit.occasionTags.includes("看展"));
});

test("随便看看 → 不给卡片，给示例追问", () => {
  const r = ask("随便看看");
  assert.equal(r.outfits.length, 0);
  assert.equal(r.closets.length, 0);
  assert.equal(r.chips.length, 3);
});

test("功能页意图：3D 形象、试衣间", () => {
  assert.deepEqual(ask("我想生成自己的 3D 形象").pages, ["avatar"]);
  assert.deepEqual(ask("打开我的试衣间").pages, ["fitting-room"]);
});

test("换个风格：跳过上一轮展示过的衣橱", () => {
  const first = ask("老钱风通勤");
  const r = ask("换个风格", first.query, ["C01"]);
  assert.ok(r.closets.every((c) => c.closet.id !== "C01"));
  assert.ok(r.outfits[0].outfit.occasionTags.includes("通勤"));
});

test("再便宜一点：预算按上一轮降三成", () => {
  const first = ask("户外婚礼，预算 2000");
  const r = ask("再便宜一点", first.query);
  assert.equal(r.query.budget, 1400);
  assert.deepEqual(r.query.occasions, first.query.occasions);
});

test("换话题：新场合不沿用上一轮的性别与预算；衣橱名「新中式」不当成「像谁」", () => {
  const first = ask("男生，第一次约会，2000 以内");
  const r = ask("过年回家见亲戚，新中式一点", first.query);
  assert.equal(r.query.gender, null);
  assert.equal(r.query.budget, null);
  assert.equal(r.query.person, null);
  assert.equal(r.outfits[0].outfit.id, "O20");
});
