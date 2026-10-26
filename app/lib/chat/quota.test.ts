import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";

// 悬浮对话的额度与总闸（D76）：临时目录里的 PGlite；fetch 全部被替换，发往 Anthropic 的请求一律返回 500（走规则层兜底），
// 不调用任何付费接口。IP 都是文档保留段（RFC 5737）。
const dir = mkdtempSync(path.join(tmpdir(), "sc-chat-quota-"));
process.env.PGLITE_DIR = path.join(dir, "pglite");
process.env.UPLOADS_DIR = path.join(dir, "uploads");
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SPEND_DAILY_USD;
delete process.env.VERCEL;
for (const k of Object.keys(process.env)) if (k.startsWith("QUOTA_")) delete process.env[k];
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

type Mods = {
  db: typeof import("@/lib/db");
  usage: typeof import("@/lib/usage");
  spend: typeof import("@/lib/spend");
  quota: typeof import("./quota");
  route: typeof import("@/app/api/chat/route");
};
let m: Mods;
const realFetch = globalThis.fetch;
let anthropicCalls = 0;
const IP = "203.0.113.9";

before(async () => {
  const db = await import("@/lib/db");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  await migrate(db.db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  m = {
    db,
    usage: await import("@/lib/usage"),
    spend: await import("@/lib/spend"),
    quota: await import("./quota"),
    route: await import("@/app/api/chat/route"),
  };
  await db.db.insert(db.schema.user).values({ id: "c1", name: "对话", email: "c1@example.test", createdAt: new Date("2026-01-01T00:00:00Z") });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://api.anthropic.com/")) {
      anthropicCalls++;
      return new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: "mock" } }), { status: 500, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
});

beforeEach(async () => {
  anthropicCalls = 0;
  await m.db.db.delete(m.db.schema.spendDay);
  await m.db.db.delete(m.db.schema.usageCounter);
  await m.db.db.delete(m.db.schema.ipCounter);
  delete process.env.SPEND_DAILY_USD;
});

after(() => {
  globalThis.fetch = realFetch;
  rmSync(dir, { recursive: true, force: true });
});

const userCount = async () => (await m.db.db.select().from(m.db.schema.usageCounter)).find((r) => r.kind === "chat")?.count ?? 0;
const guestCount = async () => (await m.db.db.select().from(m.db.schema.ipCounter)).find((r) => r.kind === "guest:chat")?.count ?? 0;

test("chargeChat：登录用户扣个人额度（计入同一网络合计），访客按网络扣；每次向总闸预留 0.08 美元", async () => {
  assert.equal(m.quota.CHAT_CALL_MICRO_USD, 80_000);
  assert.equal(await m.quota.chargeChat("c1", IP), true);
  assert.equal(await userCount(), 1);
  assert.equal(await m.quota.chargeChat(null, IP), true);
  assert.equal(await guestCount(), 1);
  assert.equal(await m.spend.spentToday(), 160_000);
  assert.equal(anthropicCalls, 0);
});

test("chargeChat：额度用完抛 QuotaError（429）；全站总额已满返回 false 并退回刚扣的额度", async () => {
  process.env.QUOTA_CHAT = "1";
  try {
    await m.quota.chargeChat("c1", IP);
    await assert.rejects(m.quota.chargeChat("c1", IP), (e: Error & { status?: number }) => e instanceof m.usage.QuotaError && e.status === 429);
  } finally {
    delete process.env.QUOTA_CHAT;
  }
  await m.db.db.delete(m.db.schema.usageCounter);
  await m.db.db.delete(m.db.schema.spendDay);
  process.env.SPEND_DAILY_USD = "0.1"; // 只够一次
  assert.equal(await m.quota.chargeChat(null, IP), true);
  assert.equal(await m.quota.chargeChat(null, IP), false);
  assert.equal(await guestCount(), 1, "总闸拒绝的那次退回访客计数");
  assert.equal(await m.quota.chargeChat("c1", IP), false);
  assert.equal(await userCount(), 0, "总闸拒绝的那次退回个人计数");
});

const post = (headers: Record<string, string> = {}) =>
  m.route.POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ messages: [{ role: "user", text: "周末去看展穿什么" }] }),
    }),
  );
const events = async (res: Response) =>
  (await res.text())
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { t: string });

test("/api/chat：访客同一网络用完后 429 与提示，不再调用 Claude；拿不到 IP（本地开发）时不计", async () => {
  process.env.QUOTA_CHAT_GUEST = "1";
  const quiet = console.error;
  console.error = () => {};
  try {
    const first = await post({ "x-forwarded-for": IP });
    assert.equal(first.status, 200);
    const ev = await events(first);
    assert.equal(ev.at(-1)?.t, "done");
    assert.ok(ev.some((e) => e.t === "fallback"), "mock 的 Claude 失败后走规则层");
    assert.equal(anthropicCalls, 1);
    assert.equal(await m.spend.spentToday(), m.quota.CHAT_CALL_MICRO_USD);

    const second = await post({ "x-forwarded-for": IP });
    assert.equal(second.status, 429);
    assert.deepEqual(await second.json(), { error: m.usage.GUEST_CHAT_LIMIT_MESSAGE });
    assert.equal(anthropicCalls, 1, "额度用完不调用 Claude");

    const local = await post();
    assert.equal(local.status, 200);
    await events(local);
    assert.equal(await guestCount(), 1, "没有来源头时不计访客次数");
  } finally {
    console.error = quiet;
    delete process.env.QUOTA_CHAT_GUEST;
  }
});

test("/api/chat：全站总额已满时只走规则层（不调用 Claude，不扣访客次数）", async () => {
  process.env.SPEND_DAILY_USD = "0.05"; // 小于单次估价
  const quiet = [console.error, console.warn] as const;
  console.error = () => {};
  console.warn = () => {};
  try {
    const res = await post({ "x-forwarded-for": IP });
    assert.equal(res.status, 200);
    const ev = await events(res);
    assert.ok(ev.some((e) => e.t === "fallback"));
    assert.ok(!ev.some((e) => e.t === "delta"));
    assert.equal(anthropicCalls, 0);
    assert.equal(await guestCount(), 0);
  } finally {
    [console.error, console.warn] = quiet;
  }
});
