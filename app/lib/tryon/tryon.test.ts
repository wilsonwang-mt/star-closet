import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { jpegWithExif, pngWithMetadata } from "@/lib/avatar/testing";
import { planTryon, stepFor, wearableInOrder, wearOn } from "./plan";

// 临时目录里的 PGlite 与本地存储；fetch 全部被替换（模拟 fal 队列：提交 → 状态 → 结果），不访问任何外部服务。测试图由代码生成。
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
/** 快速出图（performance / balanced）与细化（quality）的结果：两张尺寸不同的合成 JPEG，便于区分。 */
const FAST_JPG = jpegWithExif(96, 144, 1);
const HQ_JPG = jpegWithExif(864, 1296, 1);

const QUEUE = "https://queue.fal.run/fal-ai/fashn/tryon/v1.6";
type FalReq = { id: string; body: Record<string, unknown>; statuses: string[] };
let falReqs: FalReq[] = [];
/** 接下来每次提交依次使用的状态序列（最后一个一直保持）；不设时直接 COMPLETED。 */
let plans: string[][] = [];
/** 这些 mode 的结果接口返回 422（FASHN 生成失败）。 */
let failModes = new Set<string>();

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

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
  // 试衣间里的一套（u1）：上装、下装、外套 + 鞋、包、配饰；u1 另一套也有 T1；u2 也有一套
  await db.db.insert(schema.look).values([
    { id: "L1", userId: "u1", title: "通勤", mode: "original" },
    { id: "L2", userId: "u2", title: "周末", mode: "original" },
    { id: "L3", userId: "u1", title: "周末", mode: "original" },
  ]);
  await db.db.insert(schema.lookItem).values([
    ...["T1", "B1", "O1", "S1", "G1", "A1"].map((itemId, position) => ({ lookId: "L1", itemId, position })),
    { lookId: "L2", itemId: "T1", position: 0 },
    { lookId: "L3", itemId: "T1", position: 0 },
    { lookId: "L3", itemId: "B1", position: 1 },
  ]);
  // 正面照：代码生成的纯色 PNG。
  const key = m.storage.photoKey("u1", "front1", "png");
  await m.storage.getStorage().put(key, pngWithMetadata(64, 96), "image/png");
  await db.db.insert(schema.avatarPhoto).values({ id: "front1", userId: "u1", slot: "front", storageKey: key, mime: "image/png" });

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === QUEUE && init?.method === "POST") {
      const id = `r${falReqs.length + 1}`;
      const body = JSON.parse(String(init.body));
      falReqs.push({ id, body, statuses: [...(plans.shift() ?? ["COMPLETED"])] });
      const at = `https://queue.fal.run/fal-ai/fashn/requests/${id}`;
      return json({ request_id: id, status_url: `${at}/status`, response_url: at, cancel_url: `${at}/cancel` });
    }
    const hit = url.match(/^https:\/\/queue\.fal\.run\/fal-ai\/fashn\/requests\/(r\d+)(\/status|\/cancel)?$/);
    if (hit) {
      const req = falReqs.find((r) => r.id === hit[1]);
      if (!req) return json({ detail: "not found" }, 404);
      if (hit[2] === "/cancel") return json({});
      if (hit[2] === "/status") {
        const st = req.statuses.length > 1 ? req.statuses.shift()! : req.statuses[0];
        return json({ status: st, ...(st === "IN_QUEUE" ? { queue_position: 2 } : {}) });
      }
      if (failModes.has(String(req.body.mode))) return json({ detail: "pose not detected" }, 422);
      const bytes = req.body.mode === "quality" ? HQ_JPG : FAST_JPG;
      const out = req.body.sync_mode ? `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}` : `https://cdn.fashn.ai/out/${req.id}.jpg`;
      return json({ images: [{ url: out, content_type: "image/jpeg" }] });
    }
    if (url.startsWith("https://cdn.fashn.ai/")) return new Response(Buffer.from(FAST_JPG), { status: 200 });
    throw new Error("unexpected network call in tests");
  }) as typeof fetch;
});

beforeEach(() => {
  calls = [];
  falReqs = [];
  plans = [];
  failModes = new Set();
  delete process.env.FAL_KEY;
  // 本文件覆盖备选的 FASHN 路径（默认 Kolors → nano 见 kolors.test.ts）：固定 TRYON_PROVIDER=fashn_fal。
  process.env.TRYON_PROVIDER = "fashn_fal";
});

after(() => {
  globalThis.fetch = realFetch;
  rmSync(dir, { recursive: true, force: true });
});

const it = (id: string, category: string, displayCategory = category) => ({ id, category, displayCategory, image: `/catalog/items/${id}.webp` });
const status = (n: number) => (e: Error & { status?: number }) => e.status === n;
const submits = () => falReqs.map((r) => r.body);
const uploaded = (key: string) => existsSync(path.join(process.env.UPLOADS_DIR!, key));
const dataUri = (b: Uint8Array) => `data:image/jpeg;base64,${Buffer.from(b).toString("base64")}`;

/** 反复轮询直到满足条件（模拟前端轮询）。 */
async function pollUntil(userId: string, id: string, done: (v: Awaited<ReturnType<typeof m.svc.pollTryon>>) => boolean, max = 10) {
  for (let i = 0; i < max; i++) {
    const v = await m.svc.pollTryon(userId, id);
    if (done(v)) return v;
  }
  throw new Error("poll did not settle");
}

async function clearTryons() {
  await m.db.db.delete(m.db.schema.tryon);
}

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

test("没有 FAL_KEY：不开放、不发任何请求", async () => {
  const ctx = await m.svc.getTryonContext("u1");
  assert.equal(ctx.enabled, false);
  await assert.rejects(m.svc.createTryon("u1", { itemIds: ["T1", "B1"], consent: true }), status(503));
  process.env.FAL_KEY = "test-key";
  process.env.TRYON_PROVIDER = "other";
  assert.equal((await m.svc.getTryonContext("u1")).enabled, false, "TRYON_PROVIDER 不是 fashn_fal 时不启用");
  assert.equal(calls.length, 0);
});

test("未同意时不发请求（含预热）", async () => {
  process.env.FAL_KEY = "test-key";
  await assert.rejects(m.svc.createTryon("u1", { itemIds: ["T1"] }), status(403));
  await assert.rejects(m.svc.createTryon("u1", { lookId: "L1", itemIds: ["T1"], prewarm: true }), status(403));
  assert.equal(calls.length, 0);
});

test("逐件两段式：先提交 performance 立即返回，quality 随后提交；轮询依次报排队 → 出图并细化中 → 换成清晰的一张", async () => {
  process.env.FAL_KEY = "test-key";
  plans = [["IN_QUEUE", "COMPLETED"], ["IN_PROGRESS", "IN_PROGRESS", "COMPLETED"]];
  const v0 = await m.svc.createTryon("u1", { lookId: "L1", itemIds: ["T1"], consent: true });
  assert.equal(v0.status, "processing");
  assert.equal(v0.stage, "queued");
  assert.equal(v0.resultUrl, null);
  assert.deepEqual(
    submits().map((b) => b.mode),
    ["performance", "quality"],
    "两段：先 performance，再 quality",
  );
  for (const b of submits()) {
    assert.equal(b.category, "tops");
    assert.equal(b.garment_photo_type, "flat-lay");
    assert.equal(b.output_format, "jpeg");
    assert.equal(b.sync_mode, true, "结果以 data URI 返回，fal 不留 CDN 副本");
    assert.ok(String(b.model_image).startsWith("data:image/png;base64,"), "底图是本人正面照");
    assert.ok(String(b.garment_image).startsWith("data:image/webp;base64,"));
  }
  const submit = calls.find((c) => c.url === QUEUE)!;
  const headers = submit.init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Key test-key");
  assert.equal(headers["X-Fal-Store-IO"], "0");

  const v1 = await m.svc.pollTryon("u1", v0.id);
  assert.equal(v1?.stage, "queued");
  assert.equal(v1?.queuePosition, 2);

  const v2 = await m.svc.pollTryon("u1", v0.id);
  assert.equal(v2?.status, "succeeded");
  assert.equal(v2?.stage, "refining");
  assert.equal(v2?.refining, true);
  assert.equal(v2?.mode, "performance");
  assert.equal(v2?.resultUrl, dataUri(FAST_JPG), "刚出的一张随响应返回");
  assert.ok(uploaded(`u1/avatars/tryon-${v0.id}.jpg`), "快速结果写入本人私有存储");

  // 细化中的记录也出现在穿搭进度里（前端接着等）
  const listed = (await m.svc.listLookTryons("u1", ["L1"])).L1;
  assert.deepEqual(listed.map((f) => [f.id, f.refining]), [[v0.id, true]]);
  assert.ok(listed[0].resultUrl?.startsWith("/api/avatar/files/u1/avatars/tryon-"));

  const v3 = await m.svc.pollTryon("u1", v0.id);
  assert.equal(v3?.stage, "done");
  assert.equal(v3?.refining, false);
  assert.equal(v3?.mode, "quality");
  assert.equal(v3?.resultUrl, dataUri(HQ_JPG));
  assert.ok(uploaded(`u1/avatars/tryon-${v0.id}-hq.jpg`));

  const settled = await m.svc.getTryon("u1", v0.id);
  assert.equal(settled?.mode, "quality");
  assert.ok(settled?.resultUrl?.endsWith(`tryon-${v0.id}-hq.jpg`), "之后读取的是清晰的一张");
  assert.equal(settled?.kind, "item");
  assert.equal(settled?.wornItemId, "T1");
  assert.deepEqual(settled?.appliedItemIds, ["T1"]);
  assert.deepEqual(
    settled?.items.map((i) => i.id),
    ["T1", "B1", "O1", "S1", "G1", "A1"],
    "快照是整套单品，不含生成记录",
  );

  // 他人：读取与删除都当作不存在
  assert.equal(await m.svc.getTryon("u2", v0.id), null);
  assert.equal(await m.svc.deleteTryon("u2", v0.id), false);

  assert.equal(await m.svc.deleteTryon("u1", v0.id), true);
  assert.ok(!uploaded(`u1/avatars/tryon-${v0.id}.jpg`) && !uploaded(`u1/avatars/tryon-${v0.id}-hq.jpg`), "两张都删除");
});

test("缓存：同一底图 + 同一单品重复试穿直接返回，不再调用 FASHN；另一套里复制已完成的结果", async () => {
  process.env.FAL_KEY = "test-key";
  const v = await m.svc.createTryon("u1", { lookId: "L1", itemIds: ["T1"] });
  await pollUntil("u1", v.id, (x) => x?.stage === "done");
  calls = [];
  falReqs = [];

  const again = await m.svc.createTryon("u1", { lookId: "L1", itemIds: ["T1"] });
  assert.equal(again.id, v.id, "同一套：返回同一条");
  assert.equal(again.stage, "done");
  assert.equal(calls.length, 0);

  const other = await m.svc.createTryon("u1", { lookId: "L3", itemIds: ["T1"] });
  assert.notEqual(other.id, v.id);
  assert.equal(other.status, "succeeded");
  assert.equal(other.mode, "quality");
  assert.equal(other.sourceLookId, "L3");
  assert.equal(calls.length, 0, "另一套：复制结果图，不调用 FASHN");
  assert.ok(uploaded(`u1/avatars/tryon-${other.id}-hq.jpg`) || uploaded(`u1/avatars/tryon-${other.id}.jpg`));
  await clearTryons();
});

test("预热：只提交 performance，用户点试穿前不进穿搭进度；点试穿时命中并补提交 quality", async () => {
  process.env.FAL_KEY = "test-key";
  const p = await m.svc.createTryon("u1", { lookId: "L1", itemIds: ["B1"], prewarm: true });
  assert.deepEqual(submits().map((b) => b.mode), ["performance"], "预热只跑一段");
  const fast = await m.svc.pollTryon("u1", p.id);
  assert.equal(fast?.stage, "done", "没有细化");
  assert.equal(fast?.refining, false);
  assert.equal((await m.svc.listLookTryons("u1", ["L1"])).L1, undefined, "预热结果不出现在穿搭进度里");

  // 重复预热不再提交
  const p2 = await m.svc.createTryon("u1", { lookId: "L1", itemIds: ["B1"], prewarm: true });
  assert.equal(p2.id, p.id);
  assert.equal(falReqs.length, 1);

  const claimed = await m.svc.createTryon("u1", { lookId: "L1", itemIds: ["B1"] });
  assert.equal(claimed.id, p.id, "命中预热的那条");
  assert.equal(claimed.status, "succeeded");
  assert.equal(claimed.refining, true);
  assert.deepEqual(submits().map((b) => b.mode), ["performance", "quality"], "认领后补提交 quality");
  assert.deepEqual((await m.svc.listLookTryons("u1", ["L1"])).L1.map((f) => f.id), [p.id]);

  const hq = await m.svc.pollTryon("u1", p.id);
  assert.equal(hq?.mode, "quality");

  // 再点一次不重复提交
  await m.svc.createTryon("u1", { lookId: "L1", itemIds: ["B1"] });
  assert.equal(falReqs.length, 2);
  await assert.rejects(m.svc.createTryon("u1", { lookId: "L1", itemIds: ["O1"], baseTryonId: p.id, prewarm: true }), status(400), "预热只用于正面照");
  await clearTryons();
});

test("在上一张（细化中）继续穿：底图用当前最好的一张", async () => {
  process.env.FAL_KEY = "test-key";
  plans = [["COMPLETED"], ["IN_PROGRESS"]];
  const v1 = await m.svc.createTryon("u1", { lookId: "L1", itemIds: ["T1"] });
  const shown = await m.svc.pollTryon("u1", v1.id);
  assert.equal(shown?.stage, "refining");
  falReqs = [];
  const v2 = await m.svc.createTryon("u1", { lookId: "L1", itemIds: ["O1"], baseTryonId: v1.id });
  assert.equal(submits()[0].model_image, dataUri(FAST_JPG), "细化还没好：用快速出的那张");
  assert.equal(v2.baseTryonId, v1.id);
  assert.deepEqual(v2.appliedItemIds, ["T1", "O1"]);
  assert.deepEqual(v2.applied, ["上装", "外套"]);
  await clearTryons();
});

test("失败与降级：细化失败保留快速的一张；快速失败等细化；两段都失败才算失败", async () => {
  process.env.FAL_KEY = "test-key";
  failModes = new Set(["quality"]);
  const a = await m.svc.createTryon("u1", { lookId: "L1", itemIds: ["T1"] });
  await m.svc.pollTryon("u1", a.id);
  const kept = await m.svc.pollTryon("u1", a.id);
  assert.equal(kept?.status, "succeeded");
  assert.equal(kept?.refining, false);
  assert.equal(kept?.mode, "performance");
  await clearTryons();

  failModes = new Set(["performance"]);
  const b = await m.svc.createTryon("u1", { lookId: "L1", itemIds: ["T1"] });
  const fine = await pollUntil("u1", b.id, (x) => x?.status !== "processing");
  assert.equal(fine?.status, "succeeded");
  assert.equal(fine?.mode, "quality", "快速失败时直接等到清晰的一张");
  await clearTryons();

  failModes = new Set(["performance", "quality"]);
  const c = await m.svc.createTryon("u1", { lookId: "L1", itemIds: ["T1"] });
  const failed = await pollUntil("u1", c.id, (x) => x?.status !== "processing");
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.stage, "failed");
  assert.equal(failed?.error, "这张照片无法试穿，请换一张光线充足的正面全身照");
  assert.equal((await m.svc.createTryon("u1", { lookId: "L1", itemIds: ["T1"] })).status, "processing", "失败的不进缓存，可以重试");
  await clearTryons();
});

test("改造前遗留的处理中记录：轮询时判为失败", async () => {
  process.env.FAL_KEY = "test-key";
  const { db, schema } = m.db;
  await db.insert(schema.tryon).values({
    id: "old1",
    userId: "u1",
    status: "processing",
    sourceLookId: "L1",
    outfitSnapshot: [{ kind: "step", wornItemId: "T1", baseTryonId: null, mode: "quality" }],
  });
  const v = await m.svc.pollTryon("u1", "old1");
  assert.equal(v?.status, "failed");
  assert.equal(calls.length, 0);
  await clearTryons();
});

test("逐件试穿：baseTryonId 属于他人、失败、处理中或不存在时 404，不调用 FASHN", async () => {
  process.env.FAL_KEY = "test-key";
  const { db, schema } = m.db;
  const otherKey = "u2/avatars/tryon-other.jpg";
  await m.storage.getStorage().put(otherKey, FAST_JPG, "image/jpeg");
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
  await db.insert(schema.tryon).values({ id: "gone1", userId: "u1", status: "succeeded", resultKey: "u1/avatars/tryon-gone1.jpg" });
  await assert.rejects(m.svc.createTryon("u1", { lookId: "L1", itemIds: ["B1"], baseTryonId: "gone1" }), status(404));
  assert.equal(await m.svc.getTryon("u1", "gone1"), null);
  assert.equal(calls.length, 0);
  await clearTryons();
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

test("整套（旧调用方式）：走队列逐步推进，上一步结果地址作为下一步 model_image，最后一步取回结果存本人私有存储", async () => {
  process.env.FAL_KEY = "test-key";
  plans = [["IN_PROGRESS", "COMPLETED"], ["COMPLETED"], ["COMPLETED"]];
  const v0 = await m.svc.createTryon("u1", { outfitId: "X", itemIds: ["O1", "S1", "B1", "T1"], consent: true });
  assert.equal(v0.kind, "outfit");
  assert.equal(v0.status, "processing");
  assert.deepEqual(v0.progress, { step: 1, total: 3 });
  assert.deepEqual(v0.appliedItemIds, ["T1", "B1", "O1"]);
  assert.equal(falReqs.length, 1, "只先提交第一步");

  assert.equal((await m.svc.pollTryon("u1", v0.id))?.stage, "generating");
  const s2 = await m.svc.pollTryon("u1", v0.id);
  assert.deepEqual(s2?.progress, { step: 2, total: 3 });
  const s3 = await m.svc.pollTryon("u1", v0.id);
  assert.deepEqual(s3?.progress, { step: 3, total: 3 });
  const done = await m.svc.pollTryon("u1", v0.id);
  assert.equal(done?.status, "succeeded");
  assert.equal(done?.resultUrl, dataUri(FAST_JPG));

  const bodies = submits();
  assert.deepEqual(bodies.map((b) => b.category), ["tops", "bottoms", "tops"]);
  assert.ok(bodies.every((b) => b.mode === "balanced" && b.output_format === "jpeg"));
  assert.deepEqual(bodies.map((b) => b.sync_mode), [false, false, true], "中间步骤把结果地址交给下一步，最后一步以 data URI 返回");
  assert.ok(String(bodies[0].model_image).startsWith("data:image/png;base64,"), "第一步用本人正面照");
  assert.equal(bodies[1].model_image, "https://cdn.fashn.ai/out/r1.jpg");
  assert.equal(bodies[2].model_image, "https://cdn.fashn.ai/out/r2.jpg");
  assert.ok(uploaded(`u1/avatars/tryon-${v0.id}.jpg`));

  const again = await m.svc.getTryon("u1", v0.id);
  assert.equal(again?.status, "succeeded");
  assert.ok(again?.resultUrl?.startsWith("/api/avatar/files/u1/avatars/tryon-"));
  assert.equal(await m.svc.getTryon("u2", v0.id), null);
  assert.equal(await m.svc.deleteTryon("u1", v0.id), true);
  assert.ok(!uploaded(`u1/avatars/tryon-${v0.id}.jpg`));

  // { lookId } 仍是整套
  const look = await m.svc.createTryon("u1", { lookId: "L1" });
  assert.equal(look.kind, "outfit");
  assert.equal(look.items.length, 6);
  await clearTryons();
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
  await pollUntil("u1", view.id, (x) => x?.stage === "done");
  await m.storage.getStorage().removeUserPrefix("u1");
  assert.equal(await m.svc.getTryon("u1", view.id), null);
  assert.equal((await m.db.db.select().from(m.db.schema.tryon)).length, 0);
});

test("3D 形象一键删除同时删除试穿记录、结果图与试穿同意", async () => {
  process.env.FAL_KEY = "test-key";
  // 上一项测试清空了用户前缀：重新放回正面照文件（代码生成的纯色 PNG）
  await m.storage.getStorage().put(m.storage.photoKey("u1", "front1", "png"), pngWithMetadata(64, 96), "image/png");
  const view = await m.svc.createTryon("u1", { itemIds: ["T1"], consent: true });
  assert.ok((await pollUntil("u1", view.id, (x) => x?.stage === "done"))?.resultUrl);
  const avatar = await import("@/lib/avatar/service");
  await avatar.deleteAll("u1");
  assert.equal((await m.db.db.select().from(m.db.schema.tryon)).length, 0);
  assert.equal((await m.db.db.select().from(m.db.schema.tryonConsent)).length, 0);
  assert.equal(await m.svc.getTryon("u1", view.id), null);
});

test("试穿卡上传的正面照写入 30 天 expires_at（D47），替换旧的一张，并清掉旧照片上没用上的预热结果", async () => {
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
  assert.equal(calls.length, 0);

  const warm = await m.svc.createTryon("u3", { outfitId: "X", itemIds: ["T1"], prewarm: true, consent: true });
  await m.svc.pollTryon("u3", warm.id);
  assert.ok(uploaded(`u3/avatars/tryon-${warm.id}.jpg`));

  await m.svc.uploadFrontPhoto("u3", photo());
  const live = await db
    .select()
    .from(schema.avatarPhoto)
    .where(and(eq(schema.avatarPhoto.userId, "u3"), isNull(schema.avatarPhoto.deletedAt)));
  assert.equal(live.length, 1, "每个位置只保留一张");
  assert.ok(live[0].expiresAt, "新照片同样带期限");
  assert.equal(await m.svc.getTryon("u3", warm.id), null, "没用上的预热结果随换照片删除");
  assert.ok(!uploaded(`u3/avatars/tryon-${warm.id}.jpg`));
});
