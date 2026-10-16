import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";

// 购物袋与批量加入试衣间（D67）：本地临时 PGlite + 真实迁移，不访问任何外部服务；单品是程序写入的虚构数据。
const dir = mkdtempSync(path.join(tmpdir(), "sc-bag-"));
process.env.PGLITE_DIR = path.join(dir, "pglite");
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

type Mods = {
  db: typeof import("@/lib/db");
  core: typeof import("./core");
  bag: typeof import("./service");
  looks: typeof import("@/lib/looks");
};
let m: Mods;
const U = "user-bag-1";
const U2 = "user-bag-2";

before(async () => {
  const db = await import("@/lib/db");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  await migrate(db.db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  m = { db, core: await import("./core"), bag: await import("./service"), looks: await import("@/lib/looks") };
  const { schema } = db;
  await db.db.insert(schema.user).values([
    { id: U, name: "测试一", email: "bag1@example.test" },
    { id: U2, name: "测试二", email: "bag2@example.test" },
  ]);
  const base = { color: "黑色", currency: "CNY", buyUrl: "https://example.test/item" };
  await db.db.insert(schema.item).values([
    { ...base, id: "t1", name: "测试衬衫", category: "上装", price: 300, sizes: ["S", "M", "L"] },
    { ...base, id: "b1", name: "测试长裤", category: "下装", price: 500, sizes: ["M"] },
    { ...base, id: "a1", name: "测试耳线", category: "配饰", price: 120, sizes: [] },
  ]);
});

beforeEach(async () => {
  await m.db.db.delete(m.db.schema.bagItem);
  await m.db.db.delete(m.db.schema.look);
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("请求校验：数量 1–9、单次最多 12 件、itemId 格式", () => {
  const { AddBody, PatchBody } = m.core;
  assert.equal(AddBody.safeParse({ items: [{ itemId: "t1" }] }).success, true);
  assert.equal(AddBody.safeParse({ items: [] }).success, false);
  assert.equal(AddBody.safeParse({ items: [{ itemId: "t1", qty: 10 }] }).success, false);
  assert.equal(AddBody.safeParse({ items: [{ itemId: "../x" }] }).success, false);
  assert.equal(AddBody.safeParse({ items: Array.from({ length: 13 }, () => ({ itemId: "t1" })) }).success, false);
  assert.equal(PatchBody.safeParse({ itemId: "t1", size: "M" }).success, false, "没有要修改的内容");
  assert.equal(PatchBody.safeParse({ itemId: "t1", size: "M", qty: 2 }).success, true);
});

test("尺码规整与合并", () => {
  const { normalizeSize, mergeLines, bagTotals } = m.core;
  assert.equal(normalizeSize("M", ["S", "M"]), "M");
  assert.equal(normalizeSize("XXL", ["S", "M"]), "", "不在尺码表里视为未选");
  assert.equal(normalizeSize(undefined, ["均码"]), "均码", "只有一个尺码时直接选它");
  assert.equal(normalizeSize("M", []), "");
  assert.deepEqual(
    mergeLines([
      { itemId: "t1", size: "M", qty: 5 },
      { itemId: "t1", size: "M", qty: 7 },
      { itemId: "t1", size: "S", qty: 1 },
    ]),
    [
      { itemId: "t1", size: "M", qty: 9 },
      { itemId: "t1", size: "S", qty: 1 },
    ],
  );
  assert.deepEqual(bagTotals([{ price: 300, qty: 2 }, { price: 120, qty: 1 }]), { count: 3, total: 720 });
});

test("加入购物袋：整套批量加入、重复加入累加、未知单品忽略、按用户隔离", async () => {
  const count = await m.bag.addToBag(U, [{ itemId: "t1" }, { itemId: "b1" }, { itemId: "a1" }, { itemId: "nope" }]);
  assert.equal(count, 3);
  await m.bag.addToBag(U, [{ itemId: "b1", qty: 2 }]);
  const view = await m.bag.listBag(U);
  assert.deepEqual(
    view.lines.map((l) => [l.itemId, l.size, l.qty]).sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    [
      ["a1", "", 1],
      ["b1", "M", 3],
      ["t1", "", 1],
    ],
  );
  assert.equal(view.count, 5);
  assert.equal(view.total, 300 + 500 * 3 + 120);
  assert.equal(await m.bag.bagCount(U2), 0, "另一个用户看不到");
  await assert.rejects(m.bag.addToBag(U, [{ itemId: "nope" }]), /没有可加入的单品/);
});

test("数量上限 9", async () => {
  await m.bag.addToBag(U, [{ itemId: "t1", size: "M", qty: 8 }]);
  await m.bag.addToBag(U, [{ itemId: "t1", size: "M", qty: 5 }]);
  assert.equal(await m.bag.bagCount(U), 9);
});

test("改尺码：新尺码已有一行时合并；改数量；移除", async () => {
  await m.bag.addToBag(U, [{ itemId: "t1" }, { itemId: "t1", size: "M", qty: 2 }]);
  assert.equal(await m.bag.updateBagLine(U, { itemId: "t1", size: "", toSize: "M" }), true);
  let view = await m.bag.listBag(U);
  assert.deepEqual(view.lines.map((l) => [l.size, l.qty]), [["M", 3]]);
  assert.equal(await m.bag.updateBagLine(U, { itemId: "t1", size: "M", qty: 1 }), true);
  view = await m.bag.listBag(U);
  assert.equal(view.lines[0].qty, 1);
  assert.equal(await m.bag.updateBagLine(U2, { itemId: "t1", size: "M", qty: 4 }), false, "不能改别人的");
  assert.equal(await m.bag.removeBagLine(U, "t1", "M"), true);
  assert.equal(await m.bag.bagCount(U), 0);
  assert.equal(await m.bag.removeBagLine(U, "t1", "M"), false);
});

test("删除用户时购物袋级联删除", async () => {
  const { schema } = m.db;
  const { eq } = await import("drizzle-orm");
  await m.db.db.insert(schema.user).values({ id: "user-bag-tmp", name: "临时", email: "tmp@example.test" });
  await m.bag.addToBag("user-bag-tmp", [{ itemId: "t1" }]);
  await m.db.db.delete(schema.user).where(eq(schema.user.id, "user-bag-tmp"));
  const rows = await m.db.db.select().from(schema.bagItem).where(eq(schema.bagItem.userId, "user-bag-tmp"));
  assert.equal(rows.length, 0);
});

test("加入试衣间：单件是一件的 look，多选是选中几件的 look，整套沿用原搭配模式", async () => {
  const { lookPayload } = m.core;
  const single = lookPayload({ kind: "single", outfitName: "占位：通勤", sourceOutfitId: null, items: [{ id: "t1", name: "占位：测试衬衫" }] });
  assert.equal(single.title, "测试衬衫");
  assert.equal(single.mode, "pick");
  assert.deepEqual(single.items, [{ itemId: "t1", reason: null }]);

  const pick = lookPayload({
    kind: "pick",
    outfitName: "通勤",
    sourceOutfitId: null,
    items: [
      { id: "t1", name: "测试衬衫" },
      { id: "a1", name: "测试耳线" },
      { id: "t1", name: "测试衬衫" },
    ],
  });
  assert.equal(pick.title, "通勤 · 挑选 2 件");
  assert.deepEqual(pick.items.map((i) => i.itemId), ["t1", "a1"], "去重并保持顺序");

  const whole = lookPayload({ kind: "outfit", outfitName: "通勤", sourceOutfitId: null, items: [{ id: "t1", name: "x" }, { id: "b1", name: "y" }] });
  assert.equal(whole.mode, "original");
  assert.equal(whole.title, "通勤");

  // 与 POST /api/looks 同一条保存路径：createLook 只保存已知单品、去重。
  const id1 = await m.looks.createLook(U, single);
  const id2 = await m.looks.createLook(U, { ...pick, items: [...pick.items, { itemId: "nope", reason: null }] });
  const looks = await m.looks.listLooks(U);
  const byId = new Map(looks.map((l) => [l.id, l]));
  assert.deepEqual(byId.get(id1)!.items.map((i) => i.id), ["t1"]);
  assert.deepEqual(byId.get(id2)!.items.map((i) => i.id), ["t1", "a1"]);
  assert.equal(byId.get(id2)!.mode, "pick");
  assert.equal(byId.get(id2)!.total, 420);
});
