import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";

// 用临时目录里的 PGlite 与本地存储，不连接任何外部数据库或存储，也不访问网络。
const dir = mkdtempSync(path.join(tmpdir(), "sc-purge-"));
process.env.PGLITE_DIR = path.join(dir, "pglite");
process.env.UPLOADS_DIR = path.join(dir, "uploads");
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.FAL_KEY;
delete process.env.AVATAR3D_PROVIDER;

type Mods = {
  db: typeof import("@/lib/db");
  storage: typeof import("@/lib/storage");
  purge: typeof import("./purge");
};
let m: Mods;
const realFetch = globalThis.fetch;
let fetchCalls = 0;

before(async () => {
  const db = await import("@/lib/db");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  await migrate(db.db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  m = { db, storage: await import("@/lib/storage"), purge: await import("./purge") };
  // 任何外部请求都算失败：清理流程在没有 key 时不得访问网络。
  globalThis.fetch = (async () => {
    fetchCalls++;
    throw new Error("network disabled in tests");
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = realFetch;
  rmSync(dir, { recursive: true, force: true });
});

const DAY = 86400_000;

async function photo(userId: string, id: string, expiresAt: Date | null) {
  const { db, schema } = m.db;
  const key = m.storage.photoKey(userId, id, "png");
  await m.storage.getStorage().put(key, new Uint8Array([1, 2, 3]), "image/png");
  await db.insert(schema.avatarPhoto).values({ id, userId, slot: "front", storageKey: key, mime: "image/png", expiresAt });
  return path.join(process.env.UPLOADS_DIR!, key);
}

test("purgeExpiredPhotos：删除到期照片与文件，保留未到期的，按旧作业补写期限", async () => {
  const { db, schema } = m.db;
  const now = new Date();
  await db.insert(schema.user).values([
    { id: "u1", name: "测试一", email: "u1@example.test" },
    { id: "u2", name: "测试二", email: "u2@example.test" },
  ]);
  const expired = await photo("u1", "p-expired", new Date(now.getTime() - DAY));
  const fresh = await photo("u1", "p-fresh", new Date(now.getTime() + 10 * DAY));
  const legacy = await photo("u2", "p-legacy", null);
  const unused = await photo("u2", "p-unused", null);
  // 旧数据：40 天前成功的作业用过 p-legacy，但照片没有 expires_at。
  await db.insert(schema.avatarJob).values({
    id: "j-old",
    userId: "u2",
    status: "succeeded",
    inputPhotoIds: ["p-legacy"],
    createdAt: new Date(now.getTime() - 40 * DAY),
    updatedAt: new Date(now.getTime() - 40 * DAY),
  });

  // 只清理 u1：u2 不受影响
  assert.deepEqual(await m.purge.purgeExpiredPhotos({ userId: "u1", now }), { photos: 1 });
  assert.ok(!existsSync(expired));
  assert.ok(existsSync(fresh) && existsSync(legacy));

  // 全部用户
  assert.deepEqual(await m.purge.purgeExpiredPhotos({ now }), { photos: 1 });
  assert.ok(!existsSync(legacy), "旧作业用过的照片应按完成时间 + 30 天清理");
  assert.ok(existsSync(fresh) && existsSync(unused), "未到期或从未用于生成的照片应保留");

  const rows = await db.select().from(schema.avatarPhoto);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.ok(byId["p-expired"].deletedAt && byId["p-legacy"].deletedAt);
  assert.equal(byId["p-fresh"].deletedAt, null);
  assert.equal(byId["p-unused"].expiresAt, null);
  assert.equal(byId["p-legacy"].expiresAt?.getTime(), now.getTime() - 40 * DAY + 30 * DAY);

  // 再跑一次是幂等的
  assert.deepEqual(await m.purge.purgeExpiredPhotos({ now }), { photos: 0 });
});

test("setPhotoExpiry：写入成功时间 + 30 天，已有期限不延后", async () => {
  const { db, schema } = m.db;
  const t0 = new Date("2026-10-01T00:00:00Z");
  await photo("u1", "p-new", null);
  await m.purge.setPhotoExpiry("u1", ["p-new"], t0);
  await m.purge.setPhotoExpiry("u1", ["p-new"], new Date("2026-10-10T00:00:00Z"));
  const [row] = await db.select().from(schema.avatarPhoto).where(eq(schema.avatarPhoto.id, "p-new"));
  assert.equal(row.expiresAt?.toISOString(), "2026-10-31T00:00:00.000Z");
});

test("第三方副本删除：mock 与无 key 时不访问网络", async () => {
  const { db, schema } = m.db;
  const before = fetchCalls;
  assert.equal(await m.purge.purgeRemoteForJob({ id: "x", provider: "mock", providerTaskId: null, providerStatusUrl: null }), "skipped");
  await db.insert(schema.avatarJob).values({
    id: "j-fal",
    userId: "u1",
    status: "succeeded",
    provider: "tripo_fal",
    providerTaskId: "6f1c7d1e-2b1a-4c55-9f43-0a3c8f6b2e11",
    providerStatusUrl: "https://queue.fal.run/tripo3d/h3.1/requests/6f1c7d1e-2b1a-4c55-9f43-0a3c8f6b2e11/status",
  });
  const [job] = await db.select().from(schema.avatarJob).where(eq(schema.avatarJob.id, "j-fal"));
  assert.equal(await m.purge.purgeRemoteForJob(job), "failed");
  const [marked] = await db.select().from(schema.avatarJob).where(eq(schema.avatarJob.id, "j-fal"));
  assert.equal(m.purge.remoteState(marked.providerStatusUrl), "failed");
  assert.deepEqual(await m.purge.retryRemotePurges(), { sent: 0, failed: 0, pending: 0, skipped: 1 });
  assert.equal(fetchCalls, before, "不应发出任何网络请求");
});

test("删除标记的读写", () => {
  assert.equal(m.purge.remoteState(m.purge.remoteMark("sent")), "sent");
  assert.equal(m.purge.remoteState("https://queue.fal.run/x/requests/1/status"), null);
  assert.equal(m.purge.isLiveStatusUrl(m.purge.remoteMark("pending")), false);
});
