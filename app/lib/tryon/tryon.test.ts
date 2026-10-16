import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { pngWithMetadata } from "@/lib/avatar/testing";
import { notWornLabels, planTryon, stepFor, wearableInOrder, wearOn } from "./plan";

// 临时目录里的 PGlite 与本地存储；fetch 全部被替换，不访问任何外部服务。测试图由代码生成。
const dir = mkdtempSync(path.join(tmpdir(), "sc-tryon-"));
process.env.PGLITE_DIR = path.join(dir, "pglite");
process.env.UPLOADS_DIR = path.join(dir, "uploads");
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.FAL_KEY;
delete process.env.TRYON_PROVIDER;

type Mods = {
  db: typeof import("@/lib/db");
  storage: typeof import("@/lib/storage");
  svc: typeof import("./service");
};
let m: Mods;
const realFetch = globalThis.fetch;
type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];
const RESULT_PNG = pngWithMetadata(96, 144, [120, 90, 60]);

before(async () => {
  const db = await import("@/lib/db");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  await migrate(db.db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  m = { db, storage: await import("@/lib/storage"), svc: await import("./service") };
  const { schema } = db;
  await db.db.insert(schema.user).values([
    { id: "u1", name: "测试一", email: "t1@example.test" },
    { id: "u2", name: "测试二", email: "t2@example.test" },
    { id: "u3", name: "测试三", email: "t3@example.test" },
  ]);
  const base = { color: "黑色", price: 100, currency: "CNY", buyUrl: "https://example.test/buy" };
  await db.db.insert(schema.item).values([
    { ...base, id: "T1", name: "衬衫", category: "上装", displayCategory: "上装", image: "/catalog/items/I001.webp" },
    { ...base, id: "B1", name: "长裤", category: "下装", displayCategory: "下装", image: "/catalog/items/I002.webp" },
    { ...base, id: "O1", name: "大衣", category: "外套", displayCategory: "外套", image: "/catalog/items/I003.webp" },
    { ...base, id: "S1", name: "乐福鞋", category: "鞋", displayCategory: "鞋", image: "/catalog/items/I001.webp" },
    { ...base, id: "G1", name: "托特包", category: "包", displayCategory: "包", image: "/catalog/items/I001.webp" },
    { ...base, id: "A1", name: "丝巾", category: "配饰", displayCategory: "配饰", image: "/catalog/items/I001.webp" },
    { ...base, id: "K1", name: "半身裙", category: "下装", displayCategory: "半身裙", image: "/catalog/items/I002.webp" },
  ]);
  // 试衣间里的一套（u1）：上装、下装、外套 + 鞋、包、配饰；u2 也有一套
  await db.db.insert(schema.look).values([
    { id: "L1", userId: "u1", title: "通勤", mode: "original" },
    { id: "L2", userId: "u2", title: "周末", mode: "original" },
  ]);
  await db.db.insert(schema.lookItem).values([
    ...["T1", "B1", "O1", "S1", "G1", "A1"].map((itemId, position) => ({ lookId: "L1", itemId, position })),
    { lookId: "L2", itemId: "T1", position: 0 },
  ]);
  // 正面照：代码生成的纯色 PNG。
  const key = m.storage.photoKey("u1", "front1", "png");
  await m.storage.getStorage().put(key, pngWithMetadata(64, 96), "image/png");
  await db.db.insert(schema.avatarPhoto).values({ id: "front1", userId: "u1", slot: "front", storageKey: key, mime: "image/png" });

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "https://fal.run/fal-ai/fashn/tryon/v1.6") {
      const n = calls.filter((c) => c.url.startsWith("https://fal.run/")).length;
      return new Response(JSON.stringify({ images: [{ url: `https://v3.fal.media/files/r${n}.png`, width: 864, height: 1296 }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.startsWith("https://v3.fal.media/")) return new Response(Buffer.from(RESULT_PNG), { status: 200 });
    throw new Error("unexpected network call in tests");
  }) as typeof fetch;
});

beforeEach(() => {
  calls = [];
  delete process.env.FAL_KEY;
  delete process.env.TRYON_PROVIDER;
});

after(() => {
  globalThis.fetch = realFetch;
  rmSync(dir, { recursive: true, force: true });
});

const it = (id: string, category: string, displayCategory = category) => ({ id, category, displayCategory, image: `/catalog/items/${id}.webp` });

test("叠加顺序：上装内搭 → 下装 → 外套；鞋包配饰不参与", () => {
  const steps = planTryon([it("o", "外套"), it("s", "鞋"), it("b", "下装", "半身裙"), it("bag", "包"), it("t", "上装"), it("a", "配饰")]);
  assert.deepEqual(
    steps.map((s) => [s.itemId, s.category, s.label]),
    [
      ["t", "tops", "上装"],
      ["b", "bottoms", "下装"],
      ["o", "tops", "外套"],
    ],
  );
});

test("叠加顺序：连衣裙用 one-pieces，外套最后；连衣裙之外的内搭与下装不叠加", () => {
  const steps = planTryon([it("t", "上装"), it("d", "上装", "连衣裙"), it("b", "下装"), it("o", "外套")]);
  assert.deepEqual(
    steps.map((s) => [s.itemId, s.category]),
    [
      ["d", "one-pieces"],
      ["o", "tops"],
    ],
  );
  assert.deepEqual(planTryon([it("s", "鞋"), it("a", "配饰")]), []);
  assert.deepEqual(planTryon([{ id: "x", category: "上装", image: null }]), [], "没有单品图的不试穿");
});

test("没有 FAL_KEY：不开放、不发任何请求", async () => {
  const ctx = await m.svc.getTryonContext("u1");
  assert.equal(ctx.enabled, false);
  await assert.rejects(m.svc.createTryon("u1", { itemIds: ["T1", "B1"], consent: true }), (e: Error & { status?: number }) => e.status === 503);
  process.env.FAL_KEY = "test-key";
  process.env.TRYON_PROVIDER = "other";
  assert.equal((await m.svc.getTryonContext("u1")).enabled, false, "TRYON_PROVIDER 不是 fashn_fal 时不启用");
  assert.equal(calls.length, 0);
});

test("未同意时不发请求", async () => {
  process.env.FAL_KEY = "test-key";
  await assert.rejects(m.svc.createTryon("u1", { itemIds: ["T1"] }), (e: Error & { status?: number }) => e.status === 403);
  assert.equal(calls.length, 0);
});

test("整套试穿：依次调用、上一步结果作为下一步 model_image，结果存本人私有存储；他人读取与删除为 404", async () => {
  process.env.FAL_KEY = "test-key";
  const view = await m.svc.createTryon("u1", { outfitId: "X", itemIds: ["O1", "S1", "B1", "T1"], consent: true });
  assert.equal(view.status, "succeeded");
  assert.deepEqual(view.applied, ["上装", "下装", "外套"]);
  assert.deepEqual(view.appliedItemIds, ["T1", "B1", "O1"]);

  const fal = calls.filter((c) => c.url.startsWith("https://fal.run/"));
  assert.equal(fal.length, 3);
  const bodies = fal.map((c) => JSON.parse(String(c.init?.body)));
  assert.deepEqual(bodies.map((b) => b.category), ["tops", "bottoms", "tops"]);
  assert.ok(bodies[0].model_image.startsWith("data:image/png;base64,"), "第一步用本人正面照");
  assert.equal(bodies[1].model_image, "https://v3.fal.media/files/r1.png");
  assert.equal(bodies[2].model_image, "https://v3.fal.media/files/r2.png");
  assert.ok(bodies.every((b) => b.mode === "balanced" && b.garment_photo_type === "flat-lay" && b.output_format === "png"));
  assert.ok(bodies.every((b) => b.garment_image.startsWith("data:image/webp;base64,")));
  assert.equal((fal[0].init?.headers as Record<string, string>).Authorization, "Key test-key");
  assert.equal(calls.at(-1)?.url, "https://v3.fal.media/files/r3.png", "最后取回结果图");

  assert.ok(view.resultUrl?.startsWith("/api/avatar/files/u1/avatars/tryon-"));
  const key = `u1/avatars/tryon-${view.id}.png`;
  assert.ok(existsSync(path.join(process.env.UPLOADS_DIR!, key)));

  // 他人：读取与删除都当作不存在
  assert.equal(await m.svc.getTryon("u2", view.id), null);
  assert.equal(await m.svc.deleteTryon("u2", view.id), false);
  assert.ok(existsSync(path.join(process.env.UPLOADS_DIR!, key)));

  assert.equal((await m.svc.getTryon("u1", view.id))?.id, view.id);
  assert.equal(await m.svc.deleteTryon("u1", view.id), true);
  assert.ok(!existsSync(path.join(process.env.UPLOADS_DIR!, key)));
  assert.equal(await m.svc.getTryon("u1", view.id), null);
});

test("单件品类：上装 / 下装（含半身裙）/ 外套 / 连衣裙可试穿，鞋包配饰与无图单品不可", () => {
  assert.deepEqual(stepFor(it("t", "上装")), { itemId: "t", category: "tops", label: "上装" });
  assert.deepEqual(stepFor(it("k", "下装", "半身裙")), { itemId: "k", category: "bottoms", label: "下装" });
  assert.deepEqual(stepFor(it("o", "外套")), { itemId: "o", category: "tops", label: "外套" });
  assert.deepEqual(stepFor(it("d", "上装", "连衣裙")), { itemId: "d", category: "one-pieces", label: "连衣裙" });
  for (const c of ["鞋", "包", "配饰"]) assert.equal(stepFor(it("x", c)), null, c);
  assert.equal(stepFor({ id: "n", category: "上装", image: null }), null);
  assert.deepEqual(
    wearableInOrder([it("o", "外套"), it("s", "鞋"), it("b", "下装"), it("t", "上装")]).map((x) => x.item.id),
    ["t", "b", "o"],
    "按建议顺序：内搭 → 下装 → 外套",
  );
});

test("逐件叠加：新一件盖掉同区域已穿的单品，外套保留内搭", () => {
  const top = { itemId: "t", label: "上装" } as const;
  const bottom = { itemId: "b", label: "下装" } as const;
  const coat = { itemId: "o", label: "外套" } as const;
  const dress = { itemId: "d", label: "连衣裙" } as const;
  assert.deepEqual(wearOn([top, bottom], coat).map((w) => w.itemId), ["t", "b", "o"]);
  assert.deepEqual(wearOn([top, bottom, coat], dress).map((w) => w.itemId), ["d"]);
  assert.deepEqual(wearOn([dress], bottom).map((w) => w.itemId), ["b"]);
  assert.deepEqual(wearOn([top, coat], { itemId: "t2", label: "上装" }).map((w) => w.itemId), ["t2"]);
  assert.deepEqual(wearOn([top, bottom], top).map((w) => w.itemId), ["b", "t"], "同一件重穿只保留一次");
});

const falCalls = () => calls.filter((c) => c.url.startsWith("https://fal.run/"));
const falBodies = () => falCalls().map((c) => JSON.parse(String(c.init?.body)));
const status = (n: number) => (e: Error & { status?: number }) => e.status === n;

test("逐件试穿：只调用一次 FASHN 且 mode=quality；默认穿在正面照上，带 baseTryonId 时在那张结果上继续穿", async () => {
  process.env.FAL_KEY = "test-key";
  const v1 = await m.svc.createTryon("u1", { lookId: "L1", itemIds: ["T1"], consent: true });
  assert.equal(v1.status, "succeeded");
  assert.equal(falCalls().length, 1, "单件只调用一次");
  let [body] = falBodies();
  assert.equal(body.mode, "quality");
  assert.equal(body.category, "tops");
  assert.equal(body.garment_photo_type, "flat-lay");
  assert.ok(body.model_image.startsWith("data:image/png;base64,"), "底图是本人正面照");
  assert.equal(Buffer.from(body.model_image.split(",")[1], "base64").length, pngWithMetadata(64, 96).length);
  assert.equal(v1.kind, "item");
  assert.equal(v1.mode, "quality");
  assert.equal(v1.wornItemId, "T1");
  assert.equal(v1.baseTryonId, null);
  assert.deepEqual(v1.appliedItemIds, ["T1"]);
  assert.deepEqual(v1.applied, ["上装"]);
  assert.equal(v1.sourceLookId, "L1");
  assert.deepEqual(
    v1.items.map((i) => i.id),
    ["T1", "B1", "O1", "S1", "G1", "A1"],
    "快照是整套单品，不含逐件记录",
  );

  calls = [];
  const v2 = await m.svc.createTryon("u1", { lookId: "L1", itemIds: ["O1"], baseTryonId: v1.id });
  assert.equal(falCalls().length, 1);
  [body] = falBodies();
  assert.equal(body.mode, "quality");
  assert.equal(body.category, "tops");
  assert.equal(body.model_image, `data:image/png;base64,${Buffer.from(RESULT_PNG).toString("base64")}`, "底图是上一张试穿结果");
  assert.equal(v2.wornItemId, "O1");
  assert.equal(v2.baseTryonId, v1.id);
  assert.deepEqual(v2.appliedItemIds, ["T1", "O1"]);
  assert.deepEqual(v2.applied, ["上装", "外套"]);

  const again = await m.svc.getTryon("u1", v2.id);
  assert.equal(again?.kind, "item");
  assert.equal(again?.baseTryonId, v1.id);
  assert.equal(again?.wornItemId, "O1");

  const frames = await m.svc.listLookTryons("u1", ["L1", "L2"]);
  assert.deepEqual(frames.L1.map((f) => f.id), [v1.id, v2.id], "穿搭进度按先后排列");
  assert.equal(frames.L2, undefined);
  assert.deepEqual(await m.svc.listLookTryons("u2", ["L1"]), {}, "他人看不到");

  await m.svc.deleteTryon("u1", v1.id);
  await m.svc.deleteTryon("u1", v2.id);
});

test("逐件试穿：baseTryonId 属于他人、失败、处理中或不存在时 404，不调用 FASHN", async () => {
  process.env.FAL_KEY = "test-key";
  const { db, schema } = m.db;
  const otherKey = "u2/avatars/tryon-other.png";
  await m.storage.getStorage().put(otherKey, RESULT_PNG, "image/png");
  await db.insert(schema.tryon).values([
    { id: "other", userId: "u2", status: "succeeded", resultKey: otherKey, itemIds: ["T1"], appliedCategories: ["上装"] },
    { id: "failed1", userId: "u1", status: "failed", error: "试穿失败，请稍后再试" },
    { id: "busy1", userId: "u1", status: "processing" },
  ]);
  const messages = new Set<string>();
  for (const baseTryonId of ["other", "failed1", "busy1", "missing"]) {
    await assert.rejects(m.svc.createTryon("u1", { lookId: "L1", itemIds: ["B1"], baseTryonId }), (e: Error & { status?: number }) => {
      messages.add(e.message);
      return e.status === 404;
    });
  }
  assert.equal(messages.size, 1, "不区分不存在与不属于");
  assert.equal(calls.length, 0);
  assert.equal((await db.select().from(schema.tryon)).length, 3, "没有新增记录");

  // 结果图已被清掉的本人记录：同样 404，并清理掉这条记录
  await db.insert(schema.tryon).values({ id: "gone1", userId: "u1", status: "succeeded", resultKey: "u1/avatars/tryon-gone1.png" });
  await assert.rejects(m.svc.createTryon("u1", { lookId: "L1", itemIds: ["B1"], baseTryonId: "gone1" }), status(404));
  assert.equal(await m.svc.getTryon("u1", "gone1"), null);
  assert.equal(calls.length, 0);
  await db.delete(schema.tryon);
  await m.storage.getStorage().remove([otherKey]);
});

test("逐件试穿：鞋、包、配饰不能单件试穿；不在这套里的单品 404；一次只能一件", async () => {
  process.env.FAL_KEY = "test-key";
  for (const id of ["S1", "G1", "A1"]) {
    await assert.rejects(m.svc.createTryon("u1", { lookId: "L1", itemIds: [id] }), status(422), id);
    await assert.rejects(m.svc.createTryon("u1", { outfitId: "X", itemIds: [id] }), status(422), `${id}（outfitId）`);
  }
  await assert.rejects(m.svc.createTryon("u1", { lookId: "L1", itemIds: ["K1"] }), status(404), "不在这套里");
  await assert.rejects(m.svc.createTryon("u1", { lookId: "L2", itemIds: ["T1"] }), status(404), "他人的搭配");
  await assert.rejects(m.svc.createTryon("u1", { lookId: "L1", itemIds: ["T1", "B1"], baseTryonId: "x" }), status(400));
  assert.equal(calls.length, 0);
  assert.equal((await m.db.db.select().from(m.db.schema.tryon)).length, 0);
});

test("整套请求保持兼容：{ lookId } 仍依次叠加、mode=balanced", async () => {
  process.env.FAL_KEY = "test-key";
  const view = await m.svc.createTryon("u1", { lookId: "L1" });
  assert.equal(view.kind, "outfit");
  assert.equal(view.wornItemId, null);
  assert.equal(view.baseTryonId, null);
  assert.deepEqual(view.appliedItemIds, ["T1", "B1", "O1"]);
  assert.equal(falCalls().length, 3);
  assert.ok(falBodies().every((b) => b.mode === "balanced"));
  assert.equal(view.items.length, 6);
  await m.svc.deleteTryon("u1", view.id);
});

test("已过 30 天期限、尚未被清理的正面照不再用于试穿", async () => {
  process.env.FAL_KEY = "test-key";
  const { db, schema } = m.db;
  const { eq } = await import("drizzle-orm");
  await db.update(schema.avatarPhoto).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.avatarPhoto.id, "front1"));
  assert.equal((await m.svc.getTryonContext("u1")).frontPhotoUrl, null);
  await assert.rejects(m.svc.createTryon("u1", { lookId: "L1", itemIds: ["T1"] }), status(409));
  assert.equal(calls.length, 0);
  await db.update(schema.avatarPhoto).set({ expiresAt: null }).where(eq(schema.avatarPhoto.id, "front1"));
});

test("一键删除清空用户前缀后，旧的试穿记录读取为 404 并被清理", async () => {
  process.env.FAL_KEY = "test-key";
  const view = await m.svc.createTryon("u1", { itemIds: ["T1"] });
  await m.storage.getStorage().removeUserPrefix("u1");
  assert.equal(await m.svc.getTryon("u1", view.id), null);
  assert.equal((await m.db.db.select().from(m.db.schema.tryon)).length, 0);
});

test("3D 形象一键删除同时删除试穿记录、结果图与试穿同意", async () => {
  process.env.FAL_KEY = "test-key";
  // 上一项测试清空了用户前缀：重新放回正面照文件（代码生成的纯色 PNG）
  await m.storage.getStorage().put(m.storage.photoKey("u1", "front1", "png"), pngWithMetadata(64, 96), "image/png");
  const view = await m.svc.createTryon("u1", { itemIds: ["T1"], consent: true });
  assert.ok(view.resultUrl);
  const avatar = await import("@/lib/avatar/service");
  await avatar.deleteAll("u1");
  assert.equal((await m.db.db.select().from(m.db.schema.tryon)).length, 0);
  assert.equal((await m.db.db.select().from(m.db.schema.tryonConsent)).length, 0);
  assert.equal(await m.svc.getTryon("u1", view.id), null);
});

test("试穿卡上传的正面照写入 30 天 expires_at（D47），并替换旧的一张", async () => {
  process.env.FAL_KEY = "test-key";
  const { db, schema } = m.db;
  const { and, eq, isNull } = await import("drizzle-orm");
  const photo = () => new File([Buffer.from(pngWithMetadata(256, 384))], "front.png", { type: "image/png" });
  const t0 = Date.now();
  const first = await m.svc.uploadFrontPhoto("u3", photo());
  assert.ok(first.frontPhotoUrl.startsWith("/api/avatar/files/u3/photos/"));
  const rows = await db.select().from(schema.avatarPhoto).where(eq(schema.avatarPhoto.userId, "u3"));
  assert.equal(rows.length, 1);
  const exp = rows[0].expiresAt?.getTime() ?? 0;
  const day = 86400_000;
  assert.ok(exp >= t0 + 30 * day - 1000 && exp <= Date.now() + 30 * day + 1000, "expires_at = 上传时间 + 30 天");

  await m.svc.uploadFrontPhoto("u3", photo());
  const live = await db
    .select()
    .from(schema.avatarPhoto)
    .where(and(eq(schema.avatarPhoto.userId, "u3"), isNull(schema.avatarPhoto.deletedAt)));
  assert.equal(live.length, 1, "每个位置只保留一张");
  assert.ok(live[0].expiresAt, "新照片同样带期限");
  assert.equal(calls.length, 0);
});

test("notWornLabels：列出没穿到结果图上的单品类别，按展示类别去重", () => {
  const items = [
    { id: "D", category: "上装", displayCategory: "连衣裙" },
    { id: "S", category: "鞋", displayCategory: "鞋" },
    { id: "G", category: "包", displayCategory: "包" },
    { id: "A1", category: "配饰", displayCategory: "配饰" },
    { id: "A2", category: "配饰", displayCategory: null },
  ];
  assert.deepEqual(notWornLabels(items, ["D"]), ["鞋", "包", "配饰"]);
  assert.deepEqual(notWornLabels(items.slice(0, 1), ["D"]), []);
});
