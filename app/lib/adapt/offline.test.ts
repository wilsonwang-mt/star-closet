// 规则模式改编的回归测试：直接读 data/catalog.json，不连接数据库、不调用 AI。
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadCatalog } from "./catalog-fixture";
import { finalizeAdapt } from "./finalize";
import { adaptOffline } from "./offline";
import { buildCandidatePool } from "./rules";
import type { Item, Outfit } from "../catalog";

// 与 components/Adapter.tsx 的示例 chip 保持一致
const EXAMPLES = ["预算 800 以内，户外婚礼，换成平底鞋", "冬天通勤穿，不要皮革", "周末逛街，舒服一点，600 以内"];
const LEATHER = /皮革|真皮|牛皮|羊皮|麂皮|漆皮|皮衣|PU|人造革/;
const isLeather = (i: Item) => LEATHER.test(i.name) || LEATHER.test(i.material ?? "");

const { items, outfits } = loadCatalog();
const byId = new Map(outfits.map((o) => [o.id, o]));

function run(o: Outfit, request: string) {
  const pool = buildCandidatePool(o, items);
  return finalizeAdapt(o, adaptOffline(o, request, pool), pool, request);
}

for (const id of ["O01", "O13"]) {
  for (const ex of EXAMPLES) {
    test(`${id}「${ex}」至少改动一件单品`, () => {
      const o = byId.get(id)!;
      const r = run(o, ex);
      const orig = new Set(o.items.map((i) => i.id));
      assert.equal(r.changed, true);
      assert.ok(r.items.some((i) => !orig.has(i.id)) || r.items.length < o.items.length);
      assert.doesNotMatch(r.summary, /没有可改动/);
    });
  }
}

test("O01「不要皮革」换掉牛皮乐福鞋与牛皮托特包，结果里没有皮革单品", () => {
  const o = byId.get("O01")!;
  const r = run(o, "冬天通勤穿，不要皮革");
  const ids = r.items.map((i) => i.id);
  assert.ok(!ids.includes("I012"), "乐福鞋应被换掉");
  assert.ok(!ids.includes("I016"), "托特包应被换掉");
  assert.deepEqual(r.items.filter(isLeather).map((i) => i.name), []);
  assert.match(r.summary, /排除皮革/);
  assert.ok(r.total < o.total);
});

test("O01 与 O13 的「周末逛街，600 以内」结果不同，且都留在本衣橱", () => {
  const a = run(byId.get("O01")!, EXAMPLES[2]);
  const b = run(byId.get("O13")!, EXAMPLES[2]);
  assert.notDeepEqual(
    a.items.map((i) => i.id),
    b.items.map((i) => i.id),
  );
  assert.ok(a.items.every((i) => i.curatorId === "C01"));
  assert.ok(b.items.every((i) => i.curatorId === "C03"));
  assert.ok(!b.items.some((i) => i.name.includes("百褶")), "户外衣橱不应被改成百褶裙");
});

test("O01「户外婚礼」不出现抓绒、卫衣、运动款", () => {
  const r = run(byId.get("O01")!, EXAMPLES[0]);
  for (const i of r.items) {
    assert.doesNotMatch(`${i.name}${i.subcategory}${i.material}`, /抓绒|卫衣|运动|冲锋衣|速干|T恤/, i.name);
  }
});

for (const o of outfits) {
  test(`${o.id} 三个示例：说明只提原搭配里的单品，排除承诺如实，无变化时如实提示`, () => {
    const origNames = new Set(o.items.map((i) => i.name.replace(/^占位：/, "")));
    for (const ex of EXAMPLES) {
      const r = run(o, ex);
      // 1) “去掉了…「名称」”里的单品必须属于原搭配
      for (const n of r.notes) {
        if (!/去掉了/.test(n)) continue;
        const names = [...n.matchAll(/「([^」]+)」/g)].map((m) => m[1]);
        assert.ok(names.length > 0, n);
        for (const name of names) assert.ok(origNames.has(name), `${o.id}「${ex}」：${n} 不在原搭配里`);
      }
      // 2) 被去掉的原单品都有说明
      const kept = new Set(r.items.map((i) => i.id));
      for (const it of o.items) {
        if (kept.has(it.id)) continue;
        const named = r.notes.some((n) => n.includes(`「${it.name}」`)) || r.items.some((i) => i.reason.includes(`「${it.name}」`));
        assert.ok(named, `${o.id}「${ex}」：原单品「${it.name}」被移除却没有说明`);
      }
      // 3) 声称“排除皮革”时结果里不能有皮革；有皮革时 summary 必须说明保留原款
      if (ex.includes("不要皮革")) {
        const left = r.items.filter(isLeather);
        if (left.length) {
          assert.doesNotMatch(r.summary, /排除皮革/, `${o.id}：仍有 ${left.map((i) => i.name).join("、")}`);
          for (const i of left) assert.match(r.summary, new RegExp(`保留原款「${i.name}」`));
        }
      }
      // 4) 结果与原搭配相同 → 不能说“改编了”
      if (!r.changed) {
        assert.match(r.summary, /没有可改动的地方/);
        assert.doesNotMatch(r.summary, /改编了/);
      }
    }
  });
}

test("无法识别的要求：recognized=false，结果不变", () => {
  const o = byId.get("O01")!;
  const r = run(o, "asdfghjkl");
  assert.equal(r.recognized, false);
  assert.equal(r.changed, false);
});
