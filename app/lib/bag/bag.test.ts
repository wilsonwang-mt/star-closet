process.env.TRYON_BASE_WAIT_MS = "50";
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
  l10n: typeof import("@/lib/looks-l10n");
};
let m: Mods;
const U = "user-bag-1";
const U2 = "user-bag-2";

before(async () => {
  const db = await import("@/lib/db");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  await migrate(db.db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  m = {
    db,
    core: await import("./core"),
    bag: await import("./service"),
    looks: await import("@/lib/looks"),
    l10n: await import("@/lib/looks-l10n"),
  };
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
  // 试衣间标题的多语言：用目录里真实的编号（O01 周一晨会），英文名来自 data/catalog.en.json。
  await db.db.insert(schema.curator).values({ id: "C01", displayName: "测试主理人", closetType: "博主", closetName: "测试衣橱", intro: "测试" });
  await db.db.insert(schema.item).values([
    { ...base, id: "I001", name: "奶白垂感醋酸衬衫", category: "上装", price: 900 },
    { ...base, id: "I005", name: "炭灰羊毛直筒西装裤", category: "下装", price: 1100 },
    { ...base, id: "I019", name: "金色细链耳线", category: "配饰", price: 300 },
  ]);
  await db.db.insert(schema.outfit).values({ id: "O01", curatorId: "C01", name: "周一晨会", styleNote: "测试" });
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
  const single = lookPayload({ kind: "single", sourceOutfitId: null, items: [{ id: "t1" }] });
  assert.equal("title" in single, false, "标题由服务端生成");
  assert.equal(single.mode, "pick");
  assert.deepEqual(single.items, [{ itemId: "t1", reason: null }]);

  const pick = lookPayload({ kind: "pick", sourceOutfitId: null, items: [{ id: "t1" }, { id: "a1" }, { id: "t1" }] });
  assert.deepEqual(pick.items.map((i) => i.itemId), ["t1", "a1"], "去重并保持顺序");

  const whole = lookPayload({ kind: "outfit", sourceOutfitId: null, items: [{ id: "t1" }, { id: "b1" }] });
  assert.equal(whole.mode, "original");

  // 与 POST /api/looks 同一条保存路径：createLook 只保存已知单品、去重，标题按实际保存的单品生成。
  const id1 = await m.looks.createLook(U, single);
  const id2 = await m.looks.createLook(U, { ...pick, items: [...pick.items, { itemId: "nope", reason: null }] });
  const id3 = await m.looks.createLook(U, whole);
  const looks = await m.looks.listLooks(U);
  const byId = new Map(looks.map((l) => [l.id, l]));
  assert.deepEqual(byId.get(id1)!.items.map((i) => i.id), ["t1"]);
  assert.equal(byId.get(id1)!.title, "测试衬衫");
  assert.deepEqual(byId.get(id2)!.items.map((i) => i.id), ["t1", "a1"]);
  assert.equal(byId.get(id2)!.title, "挑选的 2 件");
  assert.equal(byId.get(id2)!.mode, "pick");
  assert.equal(byId.get(id2)!.total, 420);
  assert.equal(byId.get(id3)!.title, "整套搭配");
});

const titleOf = async (id: string) => (await m.looks.listLooks(U)).find((l) => l.id === id)!;
const reasons = (l: { items: { id: string; reason: string | null }[] }) => Object.fromEntries(l.items.map((i) => [i.id, i.reason]));

test("试衣间保存：自动标题与“你手动替换”存中文，与保存时的界面语言无关", async () => {
  const { lookPayload } = m.core;
  const save = (input: Parameters<typeof m.looks.createLook>[1]) => m.looks.createLook(U, input);
  const adapted = {
    sourceOutfitId: "O01",
    request: "更正式一点",
    summary: "Swapped the trousers.",
    mode: "ai",
    items: [
      { itemId: "I001", reason: "AI wrote this" },
      { itemId: "I005", reason: null, manual: true },
    ],
  };

  // 现在的客户端：不带标题，手动替换只带标记
  const outfit = await save(lookPayload({ kind: "outfit", sourceOutfitId: "O01", items: [{ id: "I001" }, { id: "I005" }, { id: "I019" }] }));
  const picked = await save(lookPayload({ kind: "pick", sourceOutfitId: "O01", items: [{ id: "I001" }, { id: "I019" }] }));
  const single = await save(lookPayload({ kind: "single", sourceOutfitId: "O01", items: [{ id: "I019" }] }));
  const mine = await save(adapted);
  assert.equal((await titleOf(outfit)).title, "周一晨会");
  assert.equal((await titleOf(picked)).title, "周一晨会 · 挑选 2 件");
  assert.equal((await titleOf(single)).title, "金色细链耳线");
  const mineRow = await titleOf(mine);
  assert.equal(mineRow.title, "周一晨会 · 我的版本");
  assert.deepEqual(reasons(mineRow), { I001: "AI wrote this", I005: "你手动替换" }, "AI 写的理由原样保存");
  assert.equal(mineRow.request, "更正式一点");
  assert.equal(mineRow.summary, "Swapped the trousers.");

  // 修复前的英文界面客户端（滚动发布期间仍可能发来）：按界面语言拼的标题与理由也存成中文
  const oldEn = await save({
    ...adapted,
    title: "Monday Morning Meeting · My version",
    items: [{ itemId: "I005", reason: "Swapped by you" }],
  });
  const oldMixed = await save({ ...lookPayload({ kind: "pick", sourceOutfitId: "O01", items: [{ id: "I001" }, { id: "I005" }] }), title: "Monday Morning Meeting · 挑选 2 件" });
  const oldSingle = await save({ ...lookPayload({ kind: "single", sourceOutfitId: null, items: [{ id: "I001" }] }), title: "Cream Fluid Acetate Shirt" });
  assert.equal((await titleOf(oldEn)).title, "周一晨会 · 我的版本");
  assert.deepEqual(reasons(await titleOf(oldEn)), { I005: "你手动替换" });
  assert.equal((await titleOf(oldMixed)).title, "周一晨会 · 挑选 2 件");
  assert.equal((await titleOf(oldSingle)).title, "奶白垂感醋酸衬衫");

  // 用户自己写的标题原样保存
  const custom = await save({ ...lookPayload({ kind: "outfit", sourceOutfitId: "O01", items: [{ id: "I001" }] }), title: "周末去看展" });
  assert.equal((await titleOf(custom)).title, "周末去看展");

  await assert.rejects(save({ ...adapted, sourceOutfitId: "O999" }), /搭配不存在/);
});

test("试衣间显示：任一语言保存的自动标题与理由，切换语言后都显示为当前语言（含修复前的旧记录）", async () => {
  const { catalogText } = await import("@/lib/i18n/catalog");
  const en = {
    outfit: catalogText("en", "outfits", "O01", "name")!,
    shirt: catalogText("en", "items", "I001", "name")!,
    earrings: catalogText("en", "items", "I019", "name")!,
  };
  assert.ok(en.outfit && en.shirt && en.earrings, "目录里有英文名");
  const { schema } = m.db;
  // 直接写库，模拟修复前按界面语言存下的记录（英文、中文、英文名拼中文后缀），以及用户自己写的标题
  const rows: { id: string; title: string; mode: string; outfit: string | null; items: [string, string | null][] }[] = [
    { id: "zh-orig", title: "周一晨会", mode: "original", outfit: "O01", items: [["I001", null], ["I005", null]] },
    { id: "en-orig", title: en.outfit, mode: "original", outfit: "O01", items: [["I001", null], ["I005", null]] },
    { id: "zh-mine", title: "周一晨会 · 我的版本", mode: "offline", outfit: "O01", items: [["I001", "规则写的"], ["I005", "你手动替换"]] },
    { id: "en-mine", title: `${en.outfit} · My version`, mode: "ai", outfit: "O01", items: [["I001", null], ["I005", "Swapped by you"]] },
    { id: "mixed-pick", title: `${en.outfit} · 挑选 2 件`, mode: "pick", outfit: "O01", items: [["I001", null], ["I019", null]] },
    { id: "en-pick", title: `${en.outfit} · 2 picked`, mode: "pick", outfit: "O01", items: [["I001", null], ["I019", null]] },
    { id: "zh-single", title: "金色细链耳线", mode: "pick", outfit: "O01", items: [["I019", null]] },
    { id: "en-single", title: en.shirt, mode: "pick", outfit: null, items: [["I001", null]] },
    { id: "zh-picked", title: "挑选的 3 件", mode: "pick", outfit: null, items: [["I001", null], ["I005", null], ["I019", null]] },
    { id: "en-whole", title: "Full look", mode: "original", outfit: null, items: [["I001", null]] },
    { id: "custom", title: "周末去看展", mode: "original", outfit: "O01", items: [["I001", null]] },
  ];
  for (const r of rows) {
    await m.db.db.insert(schema.look).values({ id: r.id, userId: U, sourceOutfitId: r.outfit, title: r.title, request: null, summary: null, mode: r.mode });
    await m.db.db.insert(schema.lookItem).values(r.items.map(([itemId, reason], position) => ({ lookId: r.id, itemId, position, reason })));
  }
  const looks = await m.looks.listLooks(U);
  const show = (locale: "zh" | "en") => new Map(looks.map((l) => [l.id, m.l10n.localizeLook(l, locale)]));
  const zh = show("zh");
  const enView = show("en");
  const expected: Record<string, [string, string]> = {
    "zh-orig": ["周一晨会", en.outfit],
    "en-orig": ["周一晨会", en.outfit],
    "zh-mine": ["周一晨会 · 我的版本", `${en.outfit} · My version`],
    "en-mine": ["周一晨会 · 我的版本", `${en.outfit} · My version`],
    "mixed-pick": ["周一晨会 · 挑选 2 件", `${en.outfit} · 2 picked`],
    "en-pick": ["周一晨会 · 挑选 2 件", `${en.outfit} · 2 picked`],
    "zh-single": ["金色细链耳线", en.earrings],
    "en-single": ["奶白垂感醋酸衬衫", en.shirt],
    "zh-picked": ["挑选的 3 件", "3 pieces picked"],
    "en-whole": ["整套搭配", "Full look"],
    custom: ["周末去看展", "周末去看展"],
  };
  for (const [id, [zhTitle, enTitle]] of Object.entries(expected)) {
    assert.equal(zh.get(id)!.title, zhTitle, `${id} 中文`);
    assert.equal(enView.get(id)!.title, enTitle, `${id} 英文`);
  }
  assert.deepEqual(reasons(zh.get("zh-mine")!), { I001: "规则写的", I005: "你手动替换" });
  assert.deepEqual(reasons(enView.get("zh-mine")!), { I001: "规则写的", I005: "Swapped by you" }, "生成时写下的理由原样显示");
  assert.deepEqual(reasons(zh.get("en-mine")!), { I001: null, I005: "你手动替换" });
  assert.equal(enView.get("en-mine")!.items[0].name, en.shirt, "单品名按当前语言");
  assert.equal(enView.get("zh-mine")!.sourceOutfitName, en.outfit);
  assert.equal(zh.get("zh-mine")!.sourceOutfitName, "周一晨会");
});
