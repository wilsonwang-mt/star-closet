import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { pngWithMetadata } from "@/lib/avatar/testing";

// D62 / D63：默认试穿模型可灵 Kolors、底图优先数字分身、鞋包配饰走 nano-banana、同意版本升级。
// 临时目录里的 PGlite 与本地存储；fetch 全部被替换，不访问任何外部服务；数字分身用注入的假实现，测试图由代码生成。
const dir = mkdtempSync(path.join(tmpdir(), "sc-kolors-"));
process.env.PGLITE_DIR = path.join(dir, "pglite");
process.env.UPLOADS_DIR = path.join(dir, "uploads");
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.FAL_KEY;
delete process.env.TRYON_PROVIDER;

const KOLORS = "https://fal.run/fal-ai/kling/v1-5/kolors-virtual-try-on";
const NANO = "https://fal.run/fal-ai/nano-banana-pro/edit";
const TWIN_FRONT = "data:image/png;base64,VFdJTi1GUk9OVA==";
const REFS = [TWIN_FRONT, "data:image/png;base64,RkFDRQ==", "data:image/png;base64,UFJPRklMRQ=="];

type Mods = {
  db: typeof import("@/lib/db");
  storage: typeof import("@/lib/storage");
  svc: typeof import("./service");
  base: typeof import("./base");
  scene: typeof import("@/lib/scene/service");
};
let m: Mods;
const realFetch = globalThis.fetch;
type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];
let kolorsStatus = 200;
const RESULT_PNG = pngWithMetadata(96, 144, [120, 90, 60]);

before(async () => {
  const db = await import("@/lib/db");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  await migrate(db.db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  m = {
    db,
    storage: await import("@/lib/storage"),
    svc: await import("./service"),
    base: await import("./base"),
    scene: await import("@/lib/scene/service"),
  };
  const { schema } = db;
  // u1：只有正面照；u2：什么都没有；u3：有数字分身（也有正面照，用来证明分身优先）
  await db.db.insert(schema.user).values([
    { id: "u1", name: "测试一", email: "k1@example.test" },
    { id: "u2", name: "测试二", email: "k2@example.test" },
    { id: "u3", name: "测试三", email: "k3@example.test" },
  ]);
  const base = { color: "黑色", price: 100, currency: "CNY", buyUrl: "https://example.test/buy" };
  await db.db.insert(schema.item).values([
    { ...base, id: "T1", name: "衬衫", category: "上装", displayCategory: "上装", image: "/catalog/items/I001.webp" },
    { ...base, id: "S1", name: "乐福鞋", category: "鞋", displayCategory: "鞋", image: "/catalog/items/I001.webp" },
    { ...base, id: "G1", name: "托特包", category: "包", displayCategory: "包", image: "/catalog/items/I001.webp" },
  ]);
  for (const uid of ["u1", "u3"]) {
    const key = m.storage.photoKey(uid, `front-${uid}`, "png");
    await m.storage.getStorage().put(key, pngWithMetadata(64, 96), "image/png");
    await db.db.insert(schema.avatarPhoto).values({ id: `front-${uid}`, userId: uid, slot: "front", storageKey: key, mime: "image/png" });
  }
  m.base.__setTwinApiForTests({
    getTwin: async (userId: string) =>
      userId === "u3"
        ? { jobId: "job3", images: { front: "u3/avatars/twin-front.png", side: null, back: null }, summary: null, traits: null, gender: "female" as const }
        : null,
    readTwinImageDataUri: async (key: string) => {
      assert.equal(key, "u3/avatars/twin-front.png");
      return TWIN_FRONT;
    },
    getIdentityRefs: async (userId: string) => (userId === "u3" ? REFS : []),
  });

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
    if (url === KOLORS) {
      if (kolorsStatus !== 200) return new Response("{}", { status: kolorsStatus });
      return ok({ image: { url: "https://v3.fal.media/files/kolors.png", width: 768, height: 1024, content_type: "image/png" } });
    }
    if (url === NANO) return ok({ images: [{ url: "https://v3.fal.media/files/nano.png" }] });
    if (url.startsWith("https://queue.fal.run/")) return new Response("{}", { status: 500 });
    if (url.startsWith("https://v3.fal.media/")) return new Response(Buffer.from(RESULT_PNG), { status: 200 });
    throw new Error("unexpected network call in tests");
  }) as typeof fetch;
});

beforeEach(async () => {
  calls = [];
  kolorsStatus = 200;
  process.env.FAL_KEY = "test-key";
  delete process.env.TRYON_PROVIDER;
});

after(() => {
  globalThis.fetch = realFetch;
  m.base.__setTwinApiForTests(null);
  rmSync(dir, { recursive: true, force: true });
});

const bodyOf = (c: Call) => JSON.parse(String(c.init?.body));
const status = (n: number) => (e: Error & { status?: number }) => e.status === n;

test("默认模型是 Kolors：请求体只有 human_image_url / garment_image_url，取 image.url 作结果；没有分身时底图是正面照", async () => {
  const ctx = await m.svc.getTryonContext("u1");
  assert.equal(ctx.enabled, true);
  assert.equal(ctx.baseSource, "photo");
  assert.ok(ctx.frontPhotoUrl?.startsWith("/api/avatar/files/u1/photos/"));
  assert.equal(ctx.providerName, "fal.ai（可灵 Kolors）");

  const view = await m.svc.createTryon("u1", { itemIds: ["T1"], consent: true });
  assert.equal(view.status, "succeeded");
  const fal = calls.filter((c) => c.url.startsWith("https://fal.run/"));
  assert.equal(fal.length, 1);
  assert.equal(fal[0].url, KOLORS);
  const body = bodyOf(fal[0]);
  assert.deepEqual(Object.keys(body).sort(), ["garment_image_url", "human_image_url"]);
  assert.ok(body.human_image_url.startsWith("data:image/png;base64,"), "底图是本人正面照");
  assert.equal(Buffer.from(body.human_image_url.split(",")[1], "base64").length, pngWithMetadata(64, 96).length);
  assert.ok(body.garment_image_url.startsWith("data:image/webp;base64,"));
  const headers = fal[0].init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Key test-key");
  assert.equal(headers["X-Fal-Store-IO"], "0");
  assert.equal(calls.at(-1)?.url, "https://v3.fal.media/files/kolors.png", "取回 image.url");
  assert.ok(view.resultUrl?.startsWith("/api/avatar/files/u1/avatars/tryon-"));
  assert.deepEqual(view.applied, ["上装"]);
  await m.svc.deleteTryon("u1", view.id);
});

test("有数字分身时底图优先用分身正面照", async () => {
  const ctx = await m.svc.getTryonContext("u3");
  assert.equal(ctx.baseSource, "twin");
  assert.equal(ctx.frontPhotoUrl, "/api/avatar/files/u3/avatars/twin-front.png");
  const view = await m.svc.createTryon("u3", { itemIds: ["T1"], consent: true });
  const [k] = calls.filter((c) => c.url === KOLORS);
  assert.equal(bodyOf(k).human_image_url, TWIN_FRONT);
  await m.svc.deleteTryon("u3", view.id);
});

test("没有分身也没有正面照：409 引导建立形象，不调用模型", async () => {
  const ctx = await m.svc.getTryonContext("u2");
  assert.equal(ctx.frontPhotoUrl, null);
  assert.equal(ctx.baseSource, null);
  await assert.rejects(m.svc.createTryon("u2", { itemIds: ["T1"], consent: true }), (e: Error & { status?: number }) => {
    return e.status === 409 && e.message.includes("先建立你的形象");
  });
  await assert.rejects(m.svc.createQuickTryon("u2", "S1"), status(409));
  assert.equal(calls.length, 0);
});

test("同意版本升级：旧的 v1（FASHN）同意需要重新同意；新版本带模型名", async () => {
  const { db, schema } = m.db;
  const { eq } = await import("drizzle-orm");
  await db
    .insert(schema.tryonConsent)
    .values({ userId: "u1", consentVersion: "tryon-consent-v1:fashn_fal", consentAt: new Date() })
    .onConflictDoUpdate({ target: schema.tryonConsent.userId, set: { consentVersion: "tryon-consent-v1:fashn_fal" } });
  assert.equal((await m.svc.getTryonContext("u1")).consented, false);
  assert.equal((await m.scene.getSceneState("u1", "T1")).consented, false, "上身效果共用同一项同意");
  await assert.rejects(m.svc.createTryon("u1", { itemIds: ["T1"] }), status(403));
  await assert.rejects(m.svc.createQuickTryon("u1", "S1"), status(403));
  assert.equal(calls.length, 0);

  await m.svc.recordConsent("u1");
  const [row] = await db.select().from(schema.tryonConsent).where(eq(schema.tryonConsent.userId, "u1"));
  assert.equal(row.consentVersion, "tryon-consent-v2:kolors_fal");
  assert.equal((await m.svc.getTryonContext("u1")).consented, true);
  // 切回 FASHN：处理方变了，同样需要重新同意
  process.env.TRYON_PROVIDER = "fashn_fal";
  assert.equal((await m.svc.getTryonContext("u1")).consented, false);
  assert.equal((await m.svc.getTryonContext("u1")).providerName, "FASHN（fal.ai）");
  process.env.TRYON_PROVIDER = "something_else";
  assert.equal((await m.svc.getTryonContext("u1")).enabled, false, "未知模型不开放");
});

test("一键试穿：上装走 Kolors；鞋包走 nano-banana，image_urls = 分身多张参考 + 商品图", async () => {
  await m.svc.recordConsent("u3");
  const top = await m.svc.createQuickTryon("u3", "T1");
  assert.equal(calls.filter((c) => c.url === KOLORS).length, 1);
  assert.equal(top.wornItemId, "T1");
  assert.equal(top.sourceLookId, null);

  calls = [];
  const shoe = await m.svc.createQuickTryon("u3", "S1");
  assert.equal(calls.filter((c) => c.url === KOLORS).length, 0, "鞋不走 Kolors");
  const nano = calls.filter((c) => c.url === NANO);
  assert.equal(nano.length, 1);
  const body = bodyOf(nano[0]);
  assert.equal(body.image_urls.length, REFS.length + 1);
  assert.deepEqual(body.image_urls.slice(0, REFS.length), REFS, "先放身份参考");
  assert.ok(body.image_urls.at(-1).startsWith("data:image/webp;base64,"), "最后是商品图");
  assert.match(body.prompt, /Images 1–3 are reference photos of the same person/);
  assert.match(body.prompt, /Image 4 is the product/);
  assert.match(body.prompt, /full-body/);
  assert.match(body.prompt, /light beige studio/);
  assert.equal(shoe.status, "succeeded");
  assert.equal(shoe.wornItemId, "S1");
  assert.deepEqual(shoe.appliedItemIds, ["S1"]);

  assert.equal((await m.svc.getItemTryon("u3", "S1"))?.id, shoe.id);
  assert.equal((await m.svc.getItemTryon("u3", "T1"))?.id, top.id);
  assert.equal(await m.svc.getItemTryon("u1", "S1"), null, "他人看不到");

  // 没有分身的用户：身份参考退回正面照一张
  await m.svc.recordConsent("u1");
  calls = [];
  const bag = await m.svc.createQuickTryon("u1", "G1");
  const [nb] = calls.filter((c) => c.url === NANO);
  const b2 = bodyOf(nb);
  assert.equal(b2.image_urls.length, 2);
  assert.ok(b2.image_urls[0].startsWith("data:image/png;base64,"));
  assert.match(b2.prompt, /carrying the product from image 2/);
  for (const v of [top, shoe]) await m.svc.deleteTryon("u3", v.id);
  await m.svc.deleteTryon("u1", bag.id);
});

test("上身效果：身份参考用分身多张，并带上一键试穿结果作衣服参考", async () => {
  await m.svc.recordConsent("u3");
  const top = await m.svc.createQuickTryon("u3", "T1");
  calls = [];
  const [item] = await (await import("@/lib/catalog")).getItemsByIds(["T1"]);
  const state = await m.scene.createScenes("u3", item);
  assert.ok(state.hasFrontPhoto);
  const nano = calls.filter((c) => c.url === NANO);
  assert.equal(nano.length, 2, "两张场景图");
  for (const c of nano) {
    const b = bodyOf(c);
    assert.equal(b.image_urls.length, REFS.length + 2);
    assert.deepEqual(b.image_urls.slice(0, REFS.length), REFS);
    assert.ok(b.image_urls[REFS.length].startsWith("data:image/png;base64,"), "一键试穿结果");
    assert.ok(b.image_urls.at(-1).startsWith("data:image/webp;base64,"), "商品图在最后");
    assert.match(b.prompt, /Image 4 shows this person already wearing the garment/);
    assert.match(b.prompt, /Image 5 is the garment/);
  }
  await m.scene.deleteAllSceneRenders("u3");
  await m.svc.deleteTryon("u3", top.id);
});

test("Kolors 出错时给出中文说明并记录失败", async () => {
  await m.svc.recordConsent("u1");
  kolorsStatus = 422;
  await assert.rejects(m.svc.createTryon("u1", { itemIds: ["T1"] }), (e: Error & { status?: number }) => e.status === 422 && /无法试穿/.test(e.message));
  kolorsStatus = 429;
  await assert.rejects(m.svc.createTryon("u1", { itemIds: ["T1"] }), status(429));
  kolorsStatus = 500;
  await assert.rejects(m.svc.createTryon("u1", { itemIds: ["T1"] }), (e: Error & { status?: number }) => e.status === 502 && /暂时不可用/.test(e.message));
  const rows = await m.db.db.select().from(m.db.schema.tryon);
  assert.ok(rows.length >= 3 && rows.every((r) => r.status === "failed" && !!r.error));
  await m.db.db.delete(m.db.schema.tryon);
});
