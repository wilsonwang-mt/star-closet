process.env.TRYON_BASE_WAIT_MS = "50";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, beforeEach, mock, test } from "node:test";
import { jpegWithExif, pngWithMetadata } from "@/lib/avatar/testing";

// 轮询里刚完成的结果怎么交出去（D65 / Supabase Storage 实测发现 2、3）：
// - nano 提交体要求 output_format: jpeg（默认 PNG 的 2K 结果 6.7–7.1MB，超过 Vercel 函数 4.5MB 的响应上限）；
// - 结果图太大放不进响应时，先写桶，响应里只给存储地址；
// - 写桶完成之前，再次轮询不再向 fal 取结果、不再写桶。
// 临时目录里的 PGlite 与本地存储；fetch 全部被替换（模拟 fal 队列），不访问任何外部服务，不用真实 key；测试图由代码生成。
const dir = mkdtempSync(path.join(tmpdir(), "sc-delivery-"));
process.env.PGLITE_DIR = path.join(dir, "pglite");
process.env.UPLOADS_DIR = path.join(dir, "uploads");
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.TRYON_PROVIDER;

const Q_KOLORS = "https://queue.fal.run/fal-ai/kling/v1-5/kolors-virtual-try-on";
const Q_NANO = "https://queue.fal.run/fal-ai/nano-banana-pro/edit";

type Mods = {
  db: typeof import("@/lib/db");
  storage: typeof import("@/lib/storage");
  svc: typeof import("./service");
};
let m: Mods;
const realFetch = globalThis.fetch;

type FalReq = { model: "kolors" | "nano"; body: Record<string, unknown>; done: boolean; resultFetches: number };
let reqs: FalReq[] = [];
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const uri = (mime: string, bytes: Uint8Array) => `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
const KOLORS_URI = uri("image/png", pngWithMetadata(96, 144, [120, 90, 60]));
const NANO_URI = uri("image/jpeg", jpegWithExif(864, 1296, 1));

const kolors = () => reqs.filter((r) => r.model === "kolors").at(-1)!;
const nano = () => reqs.filter((r) => r.model === "nano").at(-1)!;

/** 写桶放到响应之后：任务先攒着，由测试决定什么时候跑（模拟 Next 的 after）。 */
let tasks: (() => Promise<void>)[] = [];
const defer = (task: () => Promise<void>) => void tasks.push(task);
const flush = async () => {
  for (const t of tasks.splice(0)) await t();
};

/** 记录实际写进存储的 key；failNextPut 为 true 时下一次写入失败。 */
let puts: string[] = [];
let failNextPut = false;

before(async () => {
  const db = await import("@/lib/db");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  await migrate(db.db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  m = { db, storage: await import("@/lib/storage"), svc: await import("./service") };
  const { schema } = db;
  await db.db.insert(schema.user).values({ id: "u1", name: "测试一", email: "d1@example.test" });
  const base = { color: "黑色", price: 100, currency: "CNY", buyUrl: "https://example.test/buy" };
  await db.db.insert(schema.item).values({ ...base, id: "T1", name: "衬衫", category: "上装", displayCategory: "上装", image: "/catalog/items/I001.webp" });
  // 整套（旧调用方式）：一套里只有一件上装，那一步就是最后一步。
  await db.db.insert(schema.look).values({ id: "L1", userId: "u1", title: "通勤", mode: "original" });
  await db.db.insert(schema.lookItem).values({ lookId: "L1", itemId: "T1", position: 0 });
  const key = m.storage.photoKey("u1", "front-u1", "png");
  await m.storage.getStorage().put(key, pngWithMetadata(64, 96), "image/png");
  await db.db.insert(schema.avatarPhoto).values({ id: "front-u1", userId: "u1", slot: "front", storageKey: key, mime: "image/png" });

  const storage = m.storage.getStorage();
  const realPut = storage.put.bind(storage);
  storage.put = async (key, bytes, contentType) => {
    if (failNextPut) {
      failNextPut = false;
      throw new Error("storage down");
    }
    puts.push(key);
    return realPut(key, bytes, contentType);
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST" && (url === Q_KOLORS || url === Q_NANO)) {
      const model = url === Q_KOLORS ? "kolors" : "nano";
      reqs.push({ model, body: JSON.parse(String(init.body)), done: false, resultFetches: 0 });
      const at = `https://queue.fal.run/fal-ai/${model}/requests/r${reqs.length - 1}`;
      return json({ request_id: `r${reqs.length - 1}`, status_url: `${at}/status`, response_url: at, cancel_url: `${at}/cancel` });
    }
    const hit = url.match(/^https:\/\/queue\.fal\.run\/fal-ai\/(kolors|nano)\/requests\/r(\d+)(\/status|\/cancel)?$/);
    if (hit) {
      const req = reqs[Number(hit[2])];
      if (!req) return json({ detail: "not found" }, 404);
      if (hit[3] === "/cancel") return json({});
      if (hit[3] === "/status") return json({ status: req.done ? "COMPLETED" : "IN_PROGRESS" });
      req.resultFetches++;
      // Kolors 返回 image.url（单个对象），nano-banana 返回 images[0].url。
      return req.model === "kolors" ? json({ image: { url: KOLORS_URI } }) : json({ images: [{ url: NANO_URI }] });
    }
    throw new Error("unexpected network call in tests");
  }) as typeof fetch;
});

beforeEach(async () => {
  reqs = [];
  tasks = [];
  puts = [];
  failNextPut = false;
  process.env.FAL_KEY = "test-key";
});

afterEach(() => {
  m.svc.__setInlineLimitForTests(null);
  mock.restoreAll();
});

after(() => {
  globalThis.fetch = realFetch;
  rmSync(dir, { recursive: true, force: true });
});

const stored = (key: string) => existsSync(path.join(process.env.UPLOADS_DIR!, key));
const fileUrlOf = (key: string) => `/api/avatar/files/${key}`;
const start = () => m.svc.createTryon("u1", { itemIds: ["T1"], consent: true });

test("nano 提交体要求 output_format: jpeg（2K 结果不再是 6.7–7.1MB 的 PNG）", async () => {
  const v = await start();
  const body = nano().body;
  assert.equal(body.output_format, "jpeg");
  assert.equal(body.resolution, "2K");
  assert.equal(body.sync_mode, true);
  await m.svc.deleteTryon("u1", v.id);
});

test("快出图：写桶还没结束时再次轮询，不再向 fal 取结果、不再写桶；写完后给存储地址", async () => {
  const v = await start();
  kolors().done = true;
  const first = await m.svc.pollTryon("u1", v.id, defer);
  assert.ok(first?.resultUrl?.startsWith("data:image/png;base64,"), "不大的结果图随响应内联返回");
  assert.equal(first?.status, "succeeded");
  assert.equal(tasks.length, 1);

  // 前端刷新页面、或另一个标签页同时在轮询：写桶任务还没跑完。
  const second = await m.svc.pollTryon("u1", v.id, defer);
  assert.equal(kolors().resultFetches, 1, "没有再从 fal 取一遍结果");
  assert.equal(tasks.length, 1, "没有再排一个写桶任务");
  assert.equal(second?.status, "processing");
  assert.equal(second?.resultUrl, null);

  await flush();
  const key = `u1/avatars/tryon-${v.id}.png`;
  assert.deepEqual(puts, [key], "只写了一次");
  const third = await m.svc.pollTryon("u1", v.id, defer);
  assert.equal(third?.status, "succeeded");
  assert.equal(third?.resultUrl, fileUrlOf(key));
  assert.equal(third?.refining, true);
  assert.equal(kolors().resultFetches, 1);
  assert.equal(tasks.length, 0);
  await m.svc.deleteTryon("u1", v.id);
});

test("细化：写桶还没结束时再次轮询，仍显示快出图那张并继续“正在细化”，不重复取结果、不重复写桶", async () => {
  const v = await start();
  kolors().done = true;
  await m.svc.pollTryon("u1", v.id, defer);
  await flush();
  puts = [];

  nano().done = true;
  const first = await m.svc.pollTryon("u1", v.id, defer);
  assert.ok(first?.resultUrl?.startsWith("data:image/jpeg;base64,"));
  assert.equal(first?.mode, "quality");
  assert.equal(tasks.length, 1);

  const second = await m.svc.pollTryon("u1", v.id, defer);
  assert.equal(nano().resultFetches, 1, "没有再从 fal 取一遍结果");
  assert.equal(tasks.length, 1, "没有再排一个写桶任务");
  assert.equal(second?.resultUrl, fileUrlOf(`u1/avatars/tryon-${v.id}.png`), "还是快出图那张");
  assert.equal(second?.refining, true);
  assert.equal(second?.mode, "performance");

  await flush();
  const hq = `u1/avatars/tryon-${v.id}-hq.jpg`;
  assert.deepEqual(puts, [hq], "细化结果只写了一次");
  const third = await m.svc.pollTryon("u1", v.id, defer);
  assert.equal(third?.resultUrl, fileUrlOf(hq));
  assert.equal(third?.mode, "quality");
  assert.equal(third?.refining, false);
  assert.equal(nano().resultFetches, 1);
  await m.svc.deleteTryon("u1", v.id);
});

test("标记超时失效（另一个实例、任务被丢弃）后又取了一遍结果：后到的写桶任务发现已经写过，不再写", async () => {
  const v = await start();
  kolors().done = true;
  await m.svc.pollTryon("u1", v.id, defer);
  await flush();
  puts = [];

  nano().done = true;
  await m.svc.pollTryon("u1", v.id, defer);
  // 过了 100 秒（标记 90 秒失效，细化 150 秒才超时）：这次轮询当作没有人在写。
  const realNow = Date.now();
  mock.method(Date, "now", () => realNow + 100_000);
  await m.svc.pollTryon("u1", v.id, defer);
  assert.equal(nano().resultFetches, 2);
  assert.equal(tasks.length, 2);
  await flush(); // 依次执行：第一个写桶，第二个读到记录里已有 hqKey，不再写
  assert.deepEqual(puts, [`u1/avatars/tryon-${v.id}-hq.jpg`]);
  await m.svc.deleteTryon("u1", v.id);
});

test("整套的最后一步：同样不重复取结果、不重复写桶", async () => {
  const v = await m.svc.createTryon("u1", { lookId: "L1", consent: true });
  assert.equal(v.kind, "outfit");
  kolors().done = true;
  const first = await m.svc.pollTryon("u1", v.id, defer);
  assert.ok(first?.resultUrl?.startsWith("data:image/png;base64,"));
  assert.equal(tasks.length, 1);

  const second = await m.svc.pollTryon("u1", v.id, defer);
  assert.equal(kolors().resultFetches, 1);
  assert.equal(tasks.length, 1);
  assert.equal(second?.status, "processing");
  assert.equal(second?.resultUrl, null);

  await flush();
  const key = `u1/avatars/tryon-${v.id}.png`;
  assert.deepEqual(puts, [key]);
  const third = await m.svc.pollTryon("u1", v.id, defer);
  assert.equal(third?.status, "succeeded");
  assert.equal(third?.resultUrl, fileUrlOf(key));
  await m.svc.deleteTryon("u1", v.id);
});

test("结果图超过内联上限：先写桶，响应里只给存储地址，不排延后任务（快出图、细化）", async () => {
  m.svc.__setInlineLimitForTests(100);
  const v = await start();
  kolors().done = true;
  const fast = await m.svc.pollTryon("u1", v.id, defer);
  const fastKey = `u1/avatars/tryon-${v.id}.png`;
  assert.equal(fast?.status, "succeeded");
  assert.equal(fast?.resultUrl, fileUrlOf(fastKey), "不是 data URI");
  assert.equal(fast?.refining, true);
  assert.equal(fast?.mode, "performance");
  assert.equal(tasks.length, 0);
  assert.ok(stored(fastKey));

  nano().done = true;
  const fine = await m.svc.pollTryon("u1", v.id, defer);
  const hqKey = `u1/avatars/tryon-${v.id}-hq.jpg`;
  assert.equal(fine?.resultUrl, fileUrlOf(hqKey));
  assert.equal(fine?.mode, "quality");
  assert.equal(fine?.refining, false);
  assert.equal(fine?.stage, "done");
  assert.equal(tasks.length, 0);
  assert.ok(stored(hqKey));
  assert.deepEqual(puts, [fastKey, hqKey]);
  await m.svc.deleteTryon("u1", v.id);
});

test("结果图超过内联上限：整套最后一步也先写桶", async () => {
  m.svc.__setInlineLimitForTests(100);
  const v = await m.svc.createTryon("u1", { lookId: "L1", consent: true });
  kolors().done = true;
  const done = await m.svc.pollTryon("u1", v.id, defer);
  const key = `u1/avatars/tryon-${v.id}.png`;
  assert.equal(done?.status, "succeeded");
  assert.equal(done?.resultUrl, fileUrlOf(key));
  assert.equal(tasks.length, 0);
  assert.ok(stored(key));
  await m.svc.deleteTryon("u1", v.id);
});

test("结果图太大且这次写桶失败：不返回 data URI，也不报失败，下次轮询再取再写", async () => {
  m.svc.__setInlineLimitForTests(100);
  const v = await start();
  kolors().done = true;
  failNextPut = true;
  const first = await m.svc.pollTryon("u1", v.id, defer);
  assert.equal(first?.status, "processing");
  assert.equal(first?.resultUrl, null);
  assert.equal(first?.stage, "generating");
  assert.equal(tasks.length, 0);

  const second = await m.svc.pollTryon("u1", v.id, defer);
  assert.equal(kolors().resultFetches, 2, "标记已清掉，重新取了结果");
  assert.equal(second?.status, "succeeded");
  assert.equal(second?.resultUrl, fileUrlOf(`u1/avatars/tryon-${v.id}.png`));
  await m.svc.deleteTryon("u1", v.id);
});
