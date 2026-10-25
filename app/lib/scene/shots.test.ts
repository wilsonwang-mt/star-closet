import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";
import { jpegWithExif, pngWithMetadata } from "@/lib/avatar/testing";

// 场景与姿势试穿（D75）：临时目录里的 PGlite 与本地存储；fetch 全部被替换（模拟 fal 同步出图），不访问任何外部服务。
const dir = mkdtempSync(path.join(tmpdir(), "sc-shots-"));
process.env.PGLITE_DIR = path.join(dir, "pglite");
process.env.UPLOADS_DIR = path.join(dir, "uploads");
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SCENE_IMAGE_MODEL;
delete process.env.SCENE_LIVE;
delete process.env.SPEND_DAILY_USD;
process.env.FAL_KEY = "test-key";

type Mods = {
  db: typeof import("@/lib/db");
  storage: typeof import("@/lib/storage");
  shots: typeof import("./shots");
  usage: typeof import("@/lib/usage");
  spend: typeof import("@/lib/spend");
  tryon: typeof import("@/lib/tryon/service");
};
let m: Mods;
const realFetch = globalThis.fetch;
const NB21 = "https://fal.run/fal-ai/nano-banana-2.1/edit";
const PRO = "https://fal.run/fal-ai/nano-banana-pro/edit";
const OUT = jpegWithExif(90, 120, 1);
type Call = { url: string; body: Record<string, unknown>; headers: Record<string, string> };
let calls: Call[] = [];
/** 接下来每次调用 2.1 的结果："ok" | "500" | "422" | "empty"；用完后都是 ok。 */
let nbPlan: string[] = [];

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const OUTFIT = {
  id: "O01",
  cover: "/catalog/outfits/O01.webp",
  items: [
    { id: "T1", category: "上装", displayCategory: "上装", image: "/catalog/items/I001.webp" },
    { id: "B1", category: "下装", displayCategory: "下装", image: "/catalog/items/I002.webp" },
    { id: "S1", category: "鞋", displayCategory: "鞋", image: "/catalog/items/I001.webp" },
  ],
} as unknown as Parameters<typeof import("./shots").createCoverShot>[1];

async function addTryon(id: string, userId: string, itemIds: string[], outfitId: string | null = "O01") {
  const { db, schema } = m.db;
  const key = m.storage.avatarKey(userId, `tryon-${id}`, "png");
  await m.storage.getStorage().put(key, pngWithMetadata(64, 96), "image/png");
  await db.insert(schema.tryon).values({ id, userId, sourceOutfitId: outfitId, itemIds, status: "succeeded", resultKey: key });
}

before(async () => {
  const db = await import("@/lib/db");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  await migrate(db.db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  m = {
    db,
    storage: await import("@/lib/storage"),
    shots: await import("./shots"),
    usage: await import("@/lib/usage"),
    spend: await import("@/lib/spend"),
    tryon: await import("@/lib/tryon/service"),
  };
  const { schema } = db;
  await db.db.insert(schema.user).values([
    { id: "u1", name: "测试一", email: "s1@example.test" },
    { id: "u2", name: "测试二", email: "s2@example.test" },
  ]);
  for (const u of ["u1", "u2"]) {
    const key = m.storage.photoKey(u, `front-${u}`, "png");
    await m.storage.getStorage().put(key, pngWithMetadata(64, 96), "image/png");
    await db.db.insert(schema.avatarPhoto).values({ id: `front-${u}`, userId: u, slot: "front", storageKey: key, mime: "image/png" });
  }
  await m.tryon.recordConsent("u1");

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === NB21 || url === PRO) {
      calls.push({ url, body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string> });
      const plan = url === NB21 ? (nbPlan.shift() ?? "ok") : "ok";
      if (plan === "500") return json({ detail: "boom" }, 500);
      if (plan === "422") return json({ detail: "rejected" }, 422);
      if (plan === "empty") return json({ images: [], description: "no" });
      return json({ images: [{ url: `https://v3.fal.media/out/${calls.length}.jpg` }], description: "" });
    }
    if (url.startsWith("https://v3.fal.media/")) return new Response(Buffer.from(OUT), { status: 200 });
    throw new Error(`unexpected network call in tests: ${url}`);
  }) as typeof fetch;
});

beforeEach(async () => {
  calls = [];
  nbPlan = [];
  delete process.env.SPEND_DAILY_USD;
  const { db, schema } = m.db;
  await db.delete(schema.sceneShot);
  await db.delete(schema.tryon);
  await db.delete(schema.usageCounter);
  await db.delete(schema.spendDay);
});

after(() => {
  globalThis.fetch = realFetch;
});

test("姿势图：默认用 Nano Banana 2.1 · 1K · minimal，输入为身份参考 + 标准图，不让 fal 保存", async () => {
  await addTryon("t1", "u1", ["T1"]);
  const shot = await m.shots.createPoseShot("u1", "t1", "cafe", "sit");
  assert.equal(shot.status, "succeeded");
  assert.equal(shot.sceneTitle, "周五的咖啡馆");
  assert.equal(shot.poseTitle, "坐着");
  assert.match(shot.imageUrl ?? "", /^\/api\/avatar\/files\/u1\//);
  assert.equal(calls.length, 1);
  const [c] = calls;
  assert.equal(c.url, NB21);
  assert.equal(c.body.resolution, "1K");
  assert.equal(c.body.aspect_ratio, "3:4");
  assert.equal(c.body.thinking_level, "minimal");
  assert.equal((c.body.image_urls as string[]).length, 2);
  assert.equal(c.headers["X-Fal-Store-IO"], "0");
  const state = await m.shots.getShots("u1", "t1");
  assert.equal(state.shots.length, 1);
  assert.ok((await m.spend.spentToday()) > 0, "每次出图都计入全站花费");
});

test("姿势图：不能用别人的试穿图；未知场景或姿势 400", async () => {
  await addTryon("t2", "u2", ["T1"]);
  await assert.rejects(m.shots.createPoseShot("u1", "t2", "cafe", "sit"), { status: 404 });
  await addTryon("t1", "u1", ["T1"]);
  await assert.rejects(m.shots.createPoseShot("u1", "t1", "moon", "sit"), { status: 400 });
  await assert.rejects(m.shots.createPoseShot("u1", "t1", "cafe", "jump"), { status: 400 });
  assert.equal(calls.length, 0);
});

test("同一组合重做：成功后只留新图；失败时旧图还在", async () => {
  await addTryon("t1", "u1", ["T1"]);
  const first = await m.shots.createPoseShot("u1", "t1", "street", "walk");
  const second = await m.shots.createPoseShot("u1", "t1", "street", "walk");
  let state = await m.shots.getShots("u1", "t1");
  assert.deepEqual(
    state.shots.map((s) => s.id),
    [second.id],
  );
  assert.notEqual(first.id, second.id);
  nbPlan = ["422"];
  await assert.rejects(m.shots.createPoseShot("u1", "t1", "street", "walk"), { status: 422 });
  state = await m.shots.getShots("u1", "t1");
  assert.deepEqual(
    state.shots.map((s) => s.id),
    [second.id],
  );
});

test("主模型 5xx 或没返回图片时改用 Pro 重试一次；4xx 不重试", async () => {
  await addTryon("t1", "u1", ["T1"]);
  nbPlan = ["500"];
  await m.shots.createPoseShot("u1", "t1", "cafe", "stand");
  assert.deepEqual(
    calls.map((c) => c.url),
    [NB21, PRO],
  );
  calls = [];
  nbPlan = ["empty"];
  await m.shots.createPoseShot("u1", "t1", "cafe", "turn");
  assert.deepEqual(
    calls.map((c) => c.url),
    [NB21, PRO],
  );
  calls = [];
  nbPlan = ["422"];
  await assert.rejects(m.shots.createPoseShot("u1", "t1", "cafe", "detail"), { status: 422, message: "这一张没有生成出来，换个场景或姿势再试" });
  assert.deepEqual(
    calls.map((c) => c.url),
    [NB21],
  );
});

test("每人同时只生成一张：已有一张在生成时 429；超时残留会被顶掉", async () => {
  await addTryon("t1", "u1", ["T1"]);
  const { db, schema } = m.db;
  await db.insert(schema.sceneShot).values({ id: "busy", userId: "u1", kind: "pose", tryonId: "t1", sceneId: "cafe", pose: "sit", status: "processing" });
  await assert.rejects(m.shots.createPoseShot("u1", "t1", "gallery", "turn"), { status: 429 });
  assert.equal(calls.length, 0);
  // 别人不受影响
  await addTryon("t9", "u2", ["T1"]);
  await m.tryon.recordConsent("u2");
  await m.shots.createPoseShot("u2", "t9", "gallery", "turn");
  // 超过时限的残留：标为失败，新请求照常生成
  await db.update(schema.sceneShot).set({ createdAt: new Date(Date.now() - 10 * 60_000) }).where(eq(schema.sceneShot.id, "busy"));
  const shot = await m.shots.createPoseShot("u1", "t1", "gallery", "turn");
  assert.equal(shot.status, "succeeded");
  const [stale] = await db.select().from(schema.sceneShot).where(eq(schema.sceneShot.id, "busy"));
  assert.equal(stale.status, "failed");
});

test("全站每日总额：满了拒绝（503）且退回用户额度，不调用 fal", async () => {
  await addTryon("t1", "u1", ["T1"]);
  process.env.SPEND_DAILY_USD = "0.05"; // 小于一张的估价
  await assert.rejects(
    m.usage.withQuota("u1", "scene", () => m.shots.createPoseShot("u1", "t1", "cafe", "sit")),
    { status: 503, message: "今天的生成名额已经用完了，明天再来试试" },
  );
  assert.equal(calls.length, 0);
  const q = await m.usage.quotaRemaining("u1", "scene");
  assert.equal(q.remaining, q.limit, "总额已满不扣用户额度");
  process.env.SPEND_DAILY_USD = "1";
  await m.usage.withQuota("u1", "scene", () => m.shots.createPoseShot("u1", "t1", "cafe", "sit"));
  assert.equal((await m.usage.quotaRemaining("u1", "scene")).remaining, q.limit - 1);
});

test("每日额度：用完后 429，剩余次数可读", async () => {
  await addTryon("t1", "u1", ["T1"]);
  process.env.QUOTA_SCENE = "2";
  try {
    await m.usage.withQuota("u1", "scene", () => m.shots.createPoseShot("u1", "t1", "cafe", "sit"));
    await m.usage.withQuota("u1", "scene", () => m.shots.createPoseShot("u1", "t1", "cafe", "walk"));
    assert.deepEqual(await m.usage.quotaRemaining("u1", "scene"), { remaining: 0, limit: 2 });
    await assert.rejects(
      m.usage.withQuota("u1", "scene", () => m.shots.createPoseShot("u1", "t1", "cafe", "turn")),
      { status: 429 },
    );
    assert.equal(calls.length, 2);
  } finally {
    delete process.env.QUOTA_SCENE;
  }
});

test("封面换成我：没有整套标准图时 409；有了以后输入顺序为 身份参考 → 标准图 → 封面", async () => {
  await addTryon("half", "u1", ["T1"]); // 只穿了上装，不算整套
  await assert.rejects(m.shots.createCoverShot("u1", OUTFIT), { status: 409 });
  await addTryon("full", "u1", ["T1", "B1"]);
  const shot = await m.shots.createCoverShot("u1", OUTFIT);
  assert.equal(shot.kind, "cover");
  const imgs = calls[0].body.image_urls as string[];
  assert.equal(imgs.length, 3);
  assert.match(imgs[2], /^data:image\/webp;base64,/);
  const cover = await m.shots.getCoverState("u1", OUTFIT);
  assert.equal(cover.standard?.tryonId, "full");
  assert.equal(cover.shot?.id, shot.id);
  assert.equal(cover.busy, false);
  const guest = await m.shots.getCoverState(null, OUTFIT);
  assert.equal(guest.signedIn, false);
  assert.equal(guest.shot, null);
});

test("删除试穿图时一并删除用它生成的场景图与文件", async () => {
  await addTryon("t1", "u1", ["T1", "B1"]);
  const shot = await m.shots.createPoseShot("u1", "t1", "seaside", "lookback");
  const key = await m.shots.shotImageKey("u1", shot.id);
  assert.ok(key && (await m.storage.getStorage().get(key)));
  assert.equal(await m.shots.shotImageKey("u2", shot.id), null);
  assert.equal(await m.tryon.deleteTryon("u1", "t1"), true);
  assert.equal((await m.shots.getShots("u1", "t1")).shots.length, 0);
  assert.equal(await m.storage.getStorage().get(key!).catch(() => null), null);
});

test("Live 视频默认关闭（只做静态图），SCENE_LIVE=1 才开启", async () => {
  const { sceneLiveEnabled } = await import("./service");
  assert.equal(sceneLiveEnabled({}), false);
  assert.equal(sceneLiveEnabled({ SCENE_LIVE: "1" }), true);
});
