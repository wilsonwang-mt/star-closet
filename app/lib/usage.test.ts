import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

// D76 防滥用第二批：新账号分级额度、同一网络（IP）跨账号每日合计、访客按网络计次。
// 临时目录里的 PGlite，不连外部数据库、不访问网络。IP 都是文档保留段（RFC 5737）。
const dir = mkdtempSync(path.join(tmpdir(), "sc-usage-"));
process.env.PGLITE_DIR = path.join(dir, "pglite");
process.env.UPLOADS_DIR = path.join(dir, "uploads");
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
for (const k of Object.keys(process.env)) if (k.startsWith("QUOTA_")) delete process.env[k];

type Mods = { db: typeof import("@/lib/db"); usage: typeof import("./usage") };
let m: Mods;
const NOW = new Date("2026-10-26T04:00:00Z");
const OLD = new Date("2026-01-01T00:00:00Z");
const DAY = 86_400_000;
const IP_A = "203.0.113.7";
const IP_B = "198.51.100.20";
const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;

before(async () => {
  const db = await import("@/lib/db");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  await migrate(db.db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  m = { db, usage: await import("./usage") };
  await db.db.insert(db.schema.user).values([
    { id: "old1", name: "老账号一", email: "old1@example.test", createdAt: OLD },
    { id: "old2", name: "老账号二", email: "old2@example.test", createdAt: OLD },
    { id: "old3", name: "老账号三", email: "old3@example.test", createdAt: OLD },
    { id: "new1", name: "新账号", email: "new1@example.test", createdAt: new Date(NOW.getTime() - 2 * DAY) },
  ]);
});

after(() => rmSync(dir, { recursive: true, force: true }));

const userCount = async (userId: string, kind: string) =>
  (await m.db.db.select().from(m.db.schema.usageCounter)).find((r) => r.userId === userId && r.kind === kind)?.count ?? 0;

test("新账号分级：注册 7 天内每项额度减半（向下取整、至少 1 次），满 7 天恢复；可调天数或关闭", () => {
  const { effectiveLimit } = m.usage;
  const fresh = new Date(NOW.getTime() - 2 * DAY);
  assert.equal(effectiveLimit("scene", fresh, NOW, env({})), 10);
  assert.equal(effectiveLimit("chat", fresh, NOW, env({})), 25);
  assert.equal(effectiveLimit("twin", fresh, NOW, env({ QUOTA_TWIN: "1" })), 1, "至少 1 次");
  assert.equal(effectiveLimit("scene", new Date(NOW.getTime() - 7 * DAY), NOW, env({})), 20, "满 7 天恢复");
  assert.equal(effectiveLimit("scene", null, NOW, env({})), 10, "查不到注册时间按新账号");
  assert.equal(effectiveLimit("scene", fresh, NOW, env({ QUOTA_NEW_ACCOUNT_DAYS: "0" })), 20, "0 关闭");
  assert.equal(effectiveLimit("scene", fresh, NOW, env({ QUOTA_NEW_ACCOUNT_DAYS: "" })), 10, "空值按默认，不关闭");
  assert.equal(effectiveLimit("scene", new Date(NOW.getTime() - 10 * DAY), NOW, env({ QUOTA_NEW_ACCOUNT_DAYS: "14" })), 10);
});

test("新账号分级：consumeQuota 与 quotaRemaining 按注册时间取上限", async () => {
  const { consumeQuota, quotaRemaining, QuotaError } = m.usage;
  process.env.QUOTA_TWIN = "4";
  try {
    assert.deepEqual(await quotaRemaining("new1", "twin", NOW), { remaining: 2, limit: 2 });
    await consumeQuota("new1", "twin", NOW);
    await consumeQuota("new1", "twin", NOW);
    await assert.rejects(consumeQuota("new1", "twin", NOW), (e: Error) => e instanceof QuotaError && /每天 2 次/.test(e.message));
    for (let i = 0; i < 4; i++) await consumeQuota("old1", "twin", NOW);
    await assert.rejects(consumeQuota("old1", "twin", NOW), QuotaError);
  } finally {
    delete process.env.QUOTA_TWIN;
  }
});

test("同一网络跨账号合计：默认个人额度的 3 倍（数字分身 2 倍），可按用途覆盖", () => {
  const { ipLimit } = m.usage;
  assert.equal(ipLimit("scene", env({})), 60);
  assert.equal(ipLimit("tryon", env({})), 180);
  assert.equal(ipLimit("twin", env({})), 20);
  assert.equal(ipLimit("chat", env({})), 150);
  assert.equal(ipLimit("scene", env({ QUOTA_SCENE: "5" })), 15, "跟着个人额度走");
  assert.equal(ipLimit("scene", env({ QUOTA_IP_SCENE: "7" })), 7);
  assert.equal(ipLimit("body_analysis", env({ QUOTA_IP_BODY_ANALYSIS: "x" })), 60, "填错用默认");
});

test("同一网络跨账号合计：几个账号加起来到上限后拒绝，且不扣个人额度；换网络、换一天重新计", async () => {
  const { consumeQuota, QuotaError, NETWORK_LIMIT_MESSAGE } = m.usage;
  process.env.QUOTA_IP_SCENE = "3";
  try {
    await consumeQuota("old1", "scene", NOW, IP_A);
    await consumeQuota("old2", "scene", NOW, IP_A);
    await consumeQuota("old3", "scene", NOW, IP_A);
    await assert.rejects(consumeQuota("old1", "scene", NOW, IP_A), (e: Error & { status?: number }) => e instanceof QuotaError && e.status === 429 && e.message === NETWORK_LIMIT_MESSAGE);
    assert.equal(await userCount("old1", "scene"), 1, "被网络合计拒绝的那次退回个人计数");
    assert.equal(await consumeQuota("old1", "scene", NOW, IP_B), 2, "另一个网络不受影响");
    assert.equal(await consumeQuota("old2", "scene", new Date(NOW.getTime() + DAY), IP_A), 1, "北京时间次日重新计");
    assert.equal(await consumeQuota("old3", "scene", NOW), 2, "拿不到 IP（本地开发）时只看个人额度");
  } finally {
    delete process.env.QUOTA_IP_SCENE;
  }
});

test("withQuota 带 ip：校验类错误（4xx）同时退回个人与网络计数", async () => {
  const { withQuota } = m.usage;
  const ipRow = async () => (await m.db.db.select().from(m.db.schema.ipCounter)).find((r) => r.kind === "adapt")?.count ?? 0;
  await assert.rejects(withQuota("old1", "adapt", async () => Promise.reject(Object.assign(new Error("搭配不存在"), { status: 404 })), { ip: IP_A }));
  assert.equal(await userCount("old1", "adapt"), 0);
  assert.equal(await ipRow(), 0);
  assert.equal(await withQuota("old1", "adapt", async () => "ok", { ip: IP_A }), "ok");
  assert.equal(await userCount("old1", "adapt"), 1);
  assert.equal(await ipRow(), 1);
});

test("访客：按网络每天 QUOTA_CHAT_GUEST 次，用完提示登录后继续；拿不到 IP 时不计；可退回", async () => {
  const { consumeGuestQuota, refundGuestQuota, QuotaError, GUEST_CHAT_LIMIT_MESSAGE, guestLimit } = m.usage;
  assert.equal(guestLimit("chat", env({})), 20);
  process.env.QUOTA_CHAT_GUEST = "2";
  try {
    await consumeGuestQuota("chat", IP_B, NOW);
    await consumeGuestQuota("chat", IP_B, NOW);
    await assert.rejects(consumeGuestQuota("chat", IP_B, NOW), (e: Error) => e instanceof QuotaError && e.message === GUEST_CHAT_LIMIT_MESSAGE);
    await refundGuestQuota("chat", IP_B, NOW);
    await consumeGuestQuota("chat", IP_B, NOW);
    await consumeGuestQuota("chat", null, NOW);
    await consumeGuestQuota("chat", null, NOW);
    await consumeGuestQuota("chat", null, NOW);
    // 访客与登录用户的合计分开记
    const rows = await m.db.db.select().from(m.db.schema.ipCounter);
    assert.ok(rows.some((r) => r.kind === "guest:chat" && r.count === 2));
    assert.ok(!rows.some((r) => r.kind === "chat"));
  } finally {
    delete process.env.QUOTA_CHAT_GUEST;
  }
});

test("不存原始 IP：落库的是带日期的 HMAC，换一天、换密钥就对不上", async () => {
  const { ipHash, usageDay } = m.usage;
  const rows = await m.db.db.select().from(m.db.schema.ipCounter);
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.ok(!r.ipHash.includes("203.0.113") && !r.ipHash.includes("198.51.100"));
    assert.match(r.ipHash, /^[A-Za-z0-9_-]{32}$/);
  }
  const day = usageDay(NOW);
  const next = usageDay(new Date(NOW.getTime() + DAY));
  assert.equal(ipHash(IP_A, day), ipHash(IP_A, day));
  assert.notEqual(ipHash(IP_A, day), ipHash(IP_A, next));
  assert.notEqual(ipHash(IP_A, day, env({ IP_HASH_SECRET: "a" })), ipHash(IP_A, day, env({ IP_HASH_SECRET: "b" })));
});

test("ip_counter 还没迁移（生产库未执行 0009）：按网络的限额放行并打日志，个人额度照常", async () => {
  const { consumeQuota, consumeGuestQuota } = m.usage;
  await m.db.db.execute("drop table ip_counter");
  const quiet = console.error;
  const logged: string[] = [];
  console.error = (msg: string) => void logged.push(msg);
  try {
    assert.equal(await consumeQuota("old2", "tryon", NOW, IP_A), 1);
    await consumeGuestQuota("chat", IP_A, NOW);
  } finally {
    console.error = quiet;
  }
  assert.ok(logged.some((l) => /ip_counter 表不存在/.test(l)));
});
