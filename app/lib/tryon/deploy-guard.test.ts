import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

// D64 部署前防护：每日上限（usage_counter）、生产环境变量快速失败、私有文件签名跳转。
// 用临时目录里的 PGlite，不连接任何外部数据库或存储，也不访问网络。
const dir = mkdtempSync(path.join(tmpdir(), "sc-guard-"));
process.env.PGLITE_DIR = path.join(dir, "pglite");
process.env.UPLOADS_DIR = path.join(dir, "uploads");
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.QUOTA_TWIN;

type Mods = { db: typeof import("@/lib/db"); usage: typeof import("@/lib/usage") };
let m: Mods;

before(async () => {
  const db = await import("@/lib/db");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  await migrate(db.db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  m = { db, usage: await import("@/lib/usage") };
  await db.db.insert(db.schema.user).values([
    { id: "q1", name: "限次一", email: "q1@example.test" },
    { id: "q2", name: "限次二", email: "q2@example.test" },
  ]);
});

after(() => rmSync(dir, { recursive: true, force: true }));

test("每日上限：并发请求也不会越过上限，超限抛 429 且不再计数；换一天、换用户重新计", async () => {
  const { consumeQuota, QuotaError, quotaLimit } = m.usage;
  process.env.QUOTA_TWIN = "3";
  assert.equal(quotaLimit("twin"), 3);
  const day1 = new Date("2026-10-17T02:00:00Z");
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => consumeQuota("q1", "twin", day1)));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 3);
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  assert.equal(rejected.length, 3);
  for (const r of rejected) {
    assert.ok(r.reason instanceof QuotaError);
    assert.equal(r.reason.status, 429);
    assert.match(r.reason.message, /数字分身生成次数已用完/);
  }
  const rows = await m.db.db.select().from(m.db.schema.usageCounter);
  assert.equal(rows.find((r) => r.userId === "q1" && r.kind === "twin")?.count, 3);
  // 北京时间次日（UTC 16:00 之后）重新计数；其他用户不受影响。
  assert.equal(await consumeQuota("q1", "twin", new Date("2026-10-17T16:30:00Z")), 1);
  assert.equal(await consumeQuota("q2", "twin", day1), 1);
  delete process.env.QUOTA_TWIN;
});

test("withQuota：4xx 业务错误退回计数，5xx 不退回；默认值与非法覆盖", async () => {
  const { withQuota, quotaLimit } = m.usage;
  const count = async () =>
    (await m.db.db.select().from(m.db.schema.usageCounter)).find((r) => r.userId === "q2" && r.kind === "scene")?.count ?? 0;
  await assert.rejects(withQuota("q2", "scene", async () => Promise.reject(Object.assign(new Error("请先同意"), { status: 403 }))));
  assert.equal(await count(), 0);
  await assert.rejects(withQuota("q2", "scene", async () => Promise.reject(Object.assign(new Error("上游失败"), { status: 502 }))));
  assert.equal(await count(), 1);
  assert.equal(await withQuota("q2", "scene", async () => "ok"), "ok");
  assert.equal(await count(), 2);
  assert.equal(quotaLimit("tryon", {} as NodeJS.ProcessEnv), 60);
  assert.equal(quotaLimit("adapt", { QUOTA_ADAPT: "abc" } as unknown as NodeJS.ProcessEnv), 100);
  assert.equal(quotaLimit("scene", { QUOTA_SCENE: "5" } as unknown as NodeJS.ProcessEnv), 5);
});

test("生产环境快速失败：Vercel 缺三个变量逐个报出；本地 next start 只要求 DATABASE_URL；构建阶段不检查", async () => {
  const { missingDeployEnv, assertDeployEnv } = await import("@/lib/env");
  const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
  assert.deepEqual(missingDeployEnv(env({ VERCEL: "1", NODE_ENV: "production" })), [
    "DATABASE_URL",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]);
  assert.deepEqual(missingDeployEnv(env({ VERCEL: "1", DATABASE_URL: "x", SUPABASE_URL: "y" })), ["SUPABASE_SERVICE_ROLE_KEY"]);
  assert.deepEqual(missingDeployEnv(env({ NODE_ENV: "production" })), ["DATABASE_URL"]);
  assert.deepEqual(missingDeployEnv(env({ NODE_ENV: "production", DATABASE_URL: "x" })), []);
  assert.deepEqual(missingDeployEnv(env({ NODE_ENV: "development" })), []);
  assert.deepEqual(missingDeployEnv(env({ VERCEL: "1", NEXT_PHASE: "phase-production-build" })), []);
  assert.throws(() => assertDeployEnv(env({ VERCEL: "1", DATABASE_URL: "x" })), /SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY/);
});

test("私有文件：Supabase 驱动 302 到短时签名链接（有效期限定 60–300 秒、不缓存），本地驱动交回路由", async () => {
  const { signedRedirect } = await import("@/lib/storage/redirect");
  const { localDriver } = await import("@/lib/storage/local");
  const ttls: number[] = [];
  const fake = {
    ...localDriver(path.join(dir, "fake")),
    kind: "supabase" as const,
    async signedUrl(key: string, ttl: number) {
      ttls.push(ttl);
      return key.endsWith("missing.png") ? Promise.reject(new Error("sign failed: 400")) : `https://storage.example.test/sign/${key}?token=t`;
    },
  };
  const res = await signedRedirect(fake, "q1/avatars/scene-1.mp4", 900);
  assert.equal(res?.status, 302);
  assert.equal(res?.headers.get("location"), "https://storage.example.test/sign/q1/avatars/scene-1.mp4?token=t");
  assert.equal(res?.headers.get("cache-control"), "private, no-store");
  await signedRedirect(fake, "q1/photos/a.png", 10);
  assert.deepEqual(ttls, [300, 60]);
  assert.equal((await signedRedirect(fake, "q1/photos/missing.png", 120))?.status, 404);
  assert.equal(await signedRedirect(localDriver(path.join(dir, "local")), "q1/photos/a.png", 120), null);
});
