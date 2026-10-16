import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { pngWithMetadata } from "@/lib/avatar/testing";
import { planTryon } from "./plan";

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
  ]);
  const base = { color: "黑色", price: 100, currency: "CNY", buyUrl: "https://example.test/buy" };
  await db.db.insert(schema.item).values([
    { ...base, id: "T1", name: "衬衫", category: "上装", displayCategory: "上装", image: "/catalog/items/I001.webp" },
    { ...base, id: "B1", name: "长裤", category: "下装", displayCategory: "下装", image: "/catalog/items/I002.webp" },
    { ...base, id: "O1", name: "大衣", category: "外套", displayCategory: "外套", image: "/catalog/items/I003.webp" },
    { ...base, id: "S1", name: "乐福鞋", category: "鞋", displayCategory: "鞋", image: "/catalog/items/I001.webp" },
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
