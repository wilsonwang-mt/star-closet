// 首页「按场合，整套穿走」（D71）挑选逻辑的测试：直接读 data/catalog.json，不连数据库。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { buildEdit, EDIT_OCCASIONS, LOOKS_PER_OCCASION } from "./edit";

type Raw = { curators: Record<string, unknown>[]; outfits: Record<string, unknown>[]; items: Record<string, unknown>[] };
const list = (v: unknown) => (Array.isArray(v) ? v : Object.values(v as object)) as Record<string, unknown>[];
const raw = JSON.parse(readFileSync(path.join(process.cwd(), "data/catalog.json"), "utf-8")) as Raw;
const itemsById = new Map(list(raw.items).map((i) => [i.item_id as string, i]));
const curators = list(raw.curators).map((c) => ({
  id: c.curator_id as string,
  closetName: c.closet_name as string,
  displayName: c.display_name as string,
  avatar: (c.avatar as string) ?? null,
  closetType: c.closet_type as string,
}));
const outfits = list(raw.outfits).map((o) => {
  const items = (o.item_ids as string[]).map((id) => itemsById.get(id)!).map((i) => ({
    id: i.item_id as string,
    name: i.name as string,
    image: (i.image as string) ?? null,
    color: i.color as string,
    category: i.category as string,
    displayCategory: (i.display_category as string) ?? null,
    price: i.price as number,
  }));
  return {
    id: o.outfit_id as string,
    name: o.name as string,
    styleNote: o.style_note as string,
    cover: (o.cover as string) ?? null,
    total: items.reduce((s, i) => s + i.price, 0),
    curatorId: o.curator_id as string,
    occasionTags: o.occasion_tags as string[],
    items,
  };
});

test("buildEdit：六个场合都有整套，每个最多 4 套，都带这个场合标签", () => {
  const groups = buildEdit(outfits, curators);
  assert.deepEqual(groups.map((g) => g.occasion), [...EDIT_OCCASIONS]);
  for (const g of groups) {
    assert.ok(g.looks.length >= 2 && g.looks.length <= LOOKS_PER_OCCASION, `${g.occasion} ${g.looks.length}`);
    for (const l of g.looks) {
      const src = outfits.find((o) => o.id === l.id)!;
      assert.ok(src.occasionTags.includes(g.occasion));
      assert.ok(l.items.length > 0 && l.total === src.total);
      assert.equal(l.curator.id, src.curatorId);
    }
  }
});

test("buildEdit：同一场合里尽量不同衣橱轮流出现", () => {
  for (const g of buildEdit(outfits, curators)) {
    const closets = g.looks.map((l) => l.curator.id);
    const available = new Set(outfits.filter((o) => o.occasionTags.includes(g.occasion)).map((o) => o.curatorId)).size;
    assert.equal(new Set(closets).size, Math.min(available, closets.length), `${g.occasion}: ${closets.join(",")}`);
  }
});

test("buildEdit：不足 2 套的场合不展示；没有单品或衣橱不存在的搭配跳过", () => {
  assert.deepEqual(buildEdit(outfits, curators, ["下午茶"]), []);
  const broken = outfits.map((o) => ({ ...o, curatorId: "nope" }));
  assert.deepEqual(buildEdit(broken, curators), []);
});

test("buildEdit：各场合的主推不重复", () => {
  const leads = buildEdit(outfits, curators).map((g) => g.looks[0].id);
  assert.equal(new Set(leads).size, leads.length, leads.join(","));
});
