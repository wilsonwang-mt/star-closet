import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { pngWithMetadata } from "@/lib/avatar/testing";

// 默认编排（Kolors 快出图 → nano-banana 多参考细化）、底图优先数字分身、鞋包配饰只跑 nano、同意版本升级。
// 临时目录里的 PGlite 与本地存储；fetch 全部被替换（模拟 fal 队列三步），不访问任何外部服务；数字分身用注入的假实现，测试图由代码生成。
const dir = mkdtempSync(path.join(tmpdir(), "sc-kolors-"));
process.env.PGLITE_DIR = path.join(dir, "pglite");
process.env.UPLOADS_DIR = path.join(dir, "uploads");
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.FAL_KEY;
delete process.env.TRYON_PROVIDER;

const Q_KOLORS = "https://queue.fal.run/fal-ai/kling/v1-5/kolors-virtual-try-on";
const Q_NANO = "https://queue.fal.run/fal-ai/nano-banana-pro/edit";
const SCENE_NANO = "https://fal.run/fal-ai/nano-banana-pro/edit";
const TWIN_FRONT = "data:image/png;base64,VFdJTi1GUk9OVA==";
const FACE = "data:image/png;base64,RkFDRQ==";
const REFS = [TWIN_FRONT, FACE, "data:image/png;base64,UFJPRklMRQ=="];

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
let kolorsSubmitStatus = 200;
const RESULT_PNG = pngWithMetadata(96, 144, [120, 90, 60]);
const RESULT_URI = `data:image/png;base64,${Buffer.from(RESULT_PNG).toString("base64")}`;
let seq = 0;
const seenNano = new Set<string>();

/** 轮询到完成（出图且不在细化），最多 6 次。 */
async function pollDone(userId: string, id: string) {
  let v = null;
  for (let i = 0; i < 6; i++) {
    v = await m.svc.pollTryon(userId, id);
    if (!v || v.status === "failed" || (v.status === "succeeded" && !v.refining)) break;
  }
  return v;
}

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
        ? { jobId: "job3", images: { front: "u3/avatars/twin-front.png", side: null, back: null }, summary: null, traits: null, gender: "male" as const }
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
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
    if (init?.method === "POST" && (url === Q_KOLORS || url === Q_NANO)) {
      if (url === Q_KOLORS && kolorsSubmitStatus !== 200) return json({}, kolorsSubmitStatus);
      const model = url === Q_KOLORS ? "kolors" : "nano";
      const at = `https://queue.fal.run/fal-ai/${model}/requests/r${++seq}`;
      return json({ request_id: `r${seq}`, status_url: `${at}/status`, response_url: at, cancel_url: `${at}/cancel` });
    }
    if (url.startsWith("https://queue.fal.run/fal-ai/kolors/requests/") || url.startsWith("https://queue.fal.run/fal-ai/nano/requests/")) {
      if (url.endsWith("/status")) {
        // nano 比 Kolors 慢：每个 nano 请求第一次查询时还在生成，第二次才完成（模拟“先出图、再细化”的先后）。
        if (url.includes("/nano/") && !seenNano.has(url)) {
          seenNano.add(url);
          return json({ status: "IN_PROGRESS" });
        }
        return json({ status: "COMPLETED" });
      }
      // Kolors 返回 image.url（单个对象），nano-banana 返回 images[0].url。
      return url.includes("/kolors/") ? json({ image: { url: RESULT_URI } }) : json({ images: [{ url: RESULT_URI }] });
    }
    if (url === SCENE_NANO) return json({ images: [{ url: "https://v3.fal.media/files/scene.jpg" }] });
    if (url.startsWith("https://queue.fal.run/")) return json({}, 500);
    if (url.startsWith("https://v3.fal.media/")) return new Response(Buffer.from(RESULT_PNG), { status: 200 });
    throw new Error("unexpected network call in tests");
  }) as typeof fetch;
});

beforeEach(async () => {
  calls = [];
  kolorsSubmitStatus = 200;
  process.env.FAL_KEY = "test-key";
  delete process.env.TRYON_PROVIDER;
});

after(() => {
  globalThis.fetch = realFetch;
  m.base.__setTwinApiForTests(null);
  rmSync(dir, { recursive: true, force: true });
});

const bodyOf = (c: Call) => JSON.parse(String(c.init?.body));
const submits = (q: string) => calls.filter((c) => c.url === q && c.init?.method === "POST");
const status = (n: number) => (e: Error & { status?: number }) => e.status === n;

test("默认两段式：先提交 Kolors（human_image_url / garment_image_url），再提交 nano-banana 细化；没有分身时底图是正面照", async () => {
  const ctx = await m.svc.getTryonContext("u1");
  assert.equal(ctx.enabled, true);
  assert.equal(ctx.baseSource, "photo");
  assert.ok(ctx.frontPhotoUrl?.startsWith("/api/avatar/files/u1/photos/"));
  assert.equal(ctx.providerName, "fal.ai 上的 AI 模型");

  const v0 = await m.svc.createTryon("u1", { itemIds: ["T1"], consent: true });
  assert.equal(v0.status, "processing");
  const [k] = submits(Q_KOLORS);
  const kb = bodyOf(k);
  assert.deepEqual(Object.keys(kb).sort(), ["garment_image_url", "human_image_url", "sync_mode"]);
  assert.ok(kb.human_image_url.startsWith("data:image/png;base64,"), "底图是本人正面照");
  assert.ok(kb.garment_image_url.startsWith("data:image/webp;base64,"));
  assert.equal(kb.sync_mode, true);
  const headers = k.init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Key test-key");
  assert.equal(headers["X-Fal-Store-IO"], "0");

  const [n] = submits(Q_NANO);
  const nb = bodyOf(n);
  assert.equal(nb.image_urls.length, 2, "没有正脸参考：底图 + 商品图");
  assert.ok(nb.image_urls.every((u: string) => u.startsWith("data:image/jpeg;base64,")), "每张转成 JPEG");
  assert.equal(nb.aspect_ratio, "3:4");
  assert.equal(nb.resolution, "2K");
  assert.equal(nb.num_images, 1);
  assert.match(nb.prompt, /^Virtual try-on\. Reference 1 is the person \(full body\), reference 2 is a garment product photo\./);
  assert.match(nb.prompt, /wearing the garment from reference 2, replacing the corresponding clothing; keep her other clothing items unchanged/);
  assert.doesNotMatch(nb.prompt, /close-up/);

  const v1 = await m.svc.pollTryon("u1", v0.id);
  assert.equal(v1?.status, "succeeded");
  assert.equal(v1?.mode, "performance");
  assert.equal(v1?.refining, true, "Kolors 出图后正在细化");
  const v2 = await m.svc.pollTryon("u1", v0.id);
  assert.equal(v2?.mode, "quality");
  assert.equal(v2?.refining, false);
  assert.deepEqual(v2?.applied, ["上装"]);
  await m.svc.deleteTryon("u1", v0.id);
});

test("有数字分身时底图优先用分身正面照；nano 加正脸参考，按性别换代词", async () => {
  const ctx = await m.svc.getTryonContext("u3");
  assert.equal(ctx.baseSource, "twin");
  assert.equal(ctx.frontPhotoUrl, "/api/avatar/files/u3/avatars/twin-front.png");
  const v = await m.svc.createTryon("u3", { itemIds: ["T1"], consent: true });
  assert.equal(bodyOf(submits(Q_KOLORS)[0]).human_image_url, TWIN_FRONT);
  const nb = bodyOf(submits(Q_NANO)[0]);
  assert.equal(nb.image_urls.length, 3);
  assert.equal(nb.image_urls[0], TWIN_FRONT, "底图（假图转不了 JPEG 时原样发送）");
  assert.equal(nb.image_urls[1], FACE, "正脸参考");
  assert.match(nb.prompt, /reference 2 is a close-up of the same person's face, reference 3 is a garment product photo/);
  assert.match(nb.prompt, /keep his other clothing items unchanged/);
  assert.doesNotMatch(nb.prompt, /\bher\b/);
  await m.svc.deleteTryon("u3", v.id);
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

test("同意版本升级：旧的 v1（FASHN）同意需要重新同意；新版本 tryon-consent-v2:fal，切换 fal 上的模型不需要重新同意", async () => {
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
  assert.equal(row.consentVersion, "tryon-consent-v2:fal");
  assert.equal((await m.svc.getTryonContext("u1")).consented, true);
  for (const p of ["nano_fal", "kolors_fal", "fashn_fal"]) {
    process.env.TRYON_PROVIDER = p;
    assert.equal((await m.svc.getTryonContext("u1")).consented, true, p);
  }
  process.env.TRYON_PROVIDER = "something_else";
  assert.equal((await m.svc.getTryonContext("u1")).enabled, false, "未知模型不开放");
});

test("一键试穿：上装走 Kolors → nano；鞋包只跑 nano 一段（wearing / carrying the item）", async () => {
  await m.svc.recordConsent("u3");
  const top = await m.svc.createQuickTryon("u3", "T1");
  assert.equal(submits(Q_KOLORS).length, 1);
  assert.equal(submits(Q_NANO).length, 1);
  assert.equal(top.wornItemId, "T1");
  assert.equal(top.sourceLookId, null);
  await pollDone("u3", top.id);

  calls = [];
  const shoe0 = await m.svc.createQuickTryon("u3", "S1");
  assert.equal(submits(Q_KOLORS).length, 0, "鞋不走 Kolors");
  const nano = submits(Q_NANO);
  assert.equal(nano.length, 1, "只跑一段");
  const body = bodyOf(nano[0]);
  assert.equal(body.image_urls.length, 3);
  assert.equal(body.image_urls[1], FACE);
  assert.ok(body.image_urls[2].startsWith("data:image/jpeg;base64,"), "最后是商品图");
  assert.match(body.prompt, /reference 3 is a shoes product photo/);
  assert.match(body.prompt, /wearing the item from reference 3; keep his clothing unchanged/);
  const shoe = await pollDone("u3", shoe0.id);
  assert.equal(shoe?.status, "succeeded");
  assert.equal(shoe?.refining, false, "鞋包没有细化段");
  assert.deepEqual(shoe?.appliedItemIds, ["S1"]);
  assert.deepEqual(shoe?.applied, []);

  assert.equal((await m.svc.getItemTryon("u3", "S1"))?.id, shoe0.id);
  assert.equal((await m.svc.getItemTryon("u3", "T1"))?.id, top.id);
  assert.equal(await m.svc.getItemTryon("u1", "S1"), null, "他人看不到");

  // 没有分身的用户：没有正脸参考
  await m.svc.recordConsent("u1");
  calls = [];
  const bag = await m.svc.createQuickTryon("u1", "G1");
  const b2 = bodyOf(submits(Q_NANO)[0]);
  assert.equal(b2.image_urls.length, 2);
  assert.match(b2.prompt, /carrying the item from reference 2; keep her clothing unchanged/);
  for (const v of [top, shoe0]) await m.svc.deleteTryon("u3", v.id);
  await m.svc.deleteTryon("u1", bag.id);
});

test("上身效果：身份参考用分身多张，并带上一键试穿结果作衣服参考", async () => {
  await m.svc.recordConsent("u3");
  const top = await m.svc.createQuickTryon("u3", "T1");
  await pollDone("u3", top.id);
  calls = [];
  const [item] = await (await import("@/lib/catalog")).getItemsByIds(["T1"]);
  const state = await m.scene.createScenes("u3", item);
  assert.ok(state.hasFrontPhoto);
  const nano = calls.filter((c) => c.url === SCENE_NANO);
  assert.equal(nano.length, 2, "两张场景图");
  for (const c of nano) {
    const b = bodyOf(c);
    assert.equal(b.image_urls.length, REFS.length + 2);
    assert.deepEqual(b.image_urls.slice(0, REFS.length), REFS);
    assert.ok(b.image_urls[REFS.length].startsWith("data:image/"), "一键试穿结果");
    assert.ok(b.image_urls.at(-1).startsWith("data:image/webp;base64,"), "商品图在最后");
    assert.match(b.prompt, /Image 4 shows this person already wearing the garment/);
    assert.match(b.prompt, /Image 5 is the garment/);
  }
  await m.scene.deleteAllSceneRenders("u3");
  await m.svc.deleteTryon("u3", top.id);
});

test("Kolors 提交出错时给出中文说明，不写记录", async () => {
  await m.svc.recordConsent("u1");
  kolorsSubmitStatus = 422;
  await assert.rejects(m.svc.createTryon("u1", { itemIds: ["T1"] }), (e: Error & { status?: number }) => e.status === 422 && /无法试穿/.test(e.message));
  kolorsSubmitStatus = 429;
  await assert.rejects(m.svc.createTryon("u1", { itemIds: ["T1"] }), status(429));
  assert.equal((await m.db.db.select().from(m.db.schema.tryon)).length, 0);
});

test("TRYON_PROVIDER=nano_fal 只跑 nano 一段；kolors_fal 只跑 Kolors 一段", async () => {
  await m.svc.recordConsent("u1");
  process.env.TRYON_PROVIDER = "nano_fal";
  const a = await m.svc.createTryon("u1", { itemIds: ["T1"] });
  assert.equal(submits(Q_KOLORS).length, 0);
  assert.equal(submits(Q_NANO).length, 1);
  assert.equal((await pollDone("u1", a.id))?.refining, false);
  await m.svc.deleteTryon("u1", a.id);
  calls = [];
  process.env.TRYON_PROVIDER = "kolors_fal";
  const b = await m.svc.createTryon("u1", { itemIds: ["T1"] });
  assert.equal(submits(Q_KOLORS).length, 1);
  assert.equal(submits(Q_NANO).length, 0);
  await m.svc.deleteTryon("u1", b.id);
});
