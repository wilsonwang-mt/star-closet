import { createHmac } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { isMissingTable } from "./db/errors";

// 每用户每日调用上限（D64 防滥用与花费上限）。计数存数据库表 usage_counter（迁移 0006），按北京时间自然日重置。
// 默认值可用环境变量覆盖（正整数；填错或不填用默认值）：
//   QUOTA_ADAPT=100       一句话改编（调用 Claude）
//   QUOTA_TRYON=60        试衣间逐件试穿、预热、整套试穿、详情页一键试穿（共用一个额度）
//   QUOTA_SCENE=20        场景出图（D75）：商品详情页上身效果每次 1 次；场景与姿势、封面换成我每张 1 次
//   QUOTA_TWIN=10         数字分身生成
//   QUOTA_BODY_ANALYSIS=20 体型分析（调用 Claude）
//   QUOTA_CHAT=50         悬浮对话（调用 Claude，D76）；没有 ANTHROPIC_API_KEY 时只走规则层，不计
// D76 防滥用第二批（不依赖外部服务）：
// - 新注册账号：注册后 QUOTA_NEW_ACCOUNT_DAYS 天内（默认 7，设 0 关闭）每项额度减半（向下取整，至少 1 次）。
// - 同一网络（IP，见 lib/client-ip.ts）下所有账号当天的合计（防批量注册账号刷图）：QUOTA_IP_<用途>（如 QUOTA_IP_SCENE），
//   默认为个人额度的 3 倍，数字分身 2 倍。办公室、校园等共用出口的网络会算在一起，集中演示时可临时调高。
// - 没登录的访客（只有悬浮对话可用）：同一网络每天 QUOTA_CHAT_GUEST 次（默认 20）。
// - 按网络的计数存 ip_counter（迁移 0009），只存“日期 + IP”的 HMAC（IP_HASH_SECRET，没设时用 BETTER_AUTH_SECRET）；
//   表还没迁移时按网络的限额放行并打 error 日志，个人额度照常。请求里拿不到 IP（本地开发）时跳过按网络的限额。
export type UsageKind = "adapt" | "tryon" | "scene" | "twin" | "body_analysis" | "chat";
/** 访客（未登录）按网络计次的用途。 */
export type GuestKind = "chat";

const DEFAULTS: Record<UsageKind, number> = { adapt: 100, tryon: 60, scene: 20, twin: 10, body_analysis: 20, chat: 50 };
const ENV: Record<UsageKind, string> = {
  adapt: "QUOTA_ADAPT",
  tryon: "QUOTA_TRYON",
  scene: "QUOTA_SCENE",
  twin: "QUOTA_TWIN",
  body_analysis: "QUOTA_BODY_ANALYSIS",
  chat: "QUOTA_CHAT",
};
const LABEL: Record<UsageKind, string> = {
  adapt: "改编",
  tryon: "试穿",
  scene: "场景图",
  twin: "数字分身生成",
  body_analysis: "体型分析",
  chat: "对话",
};
/** 同一网络的合计默认是个人额度的几倍：数字分身单次最贵（约 0.8 美元），放得最紧。 */
const IP_FACTOR: Record<UsageKind, number> = { adapt: 3, tryon: 3, scene: 3, twin: 2, body_analysis: 3, chat: 3 };
const GUEST_DEFAULTS: Record<GuestKind, number> = { chat: 20 };
const DEFAULT_NEW_ACCOUNT_DAYS = 7;
const DAY_MS = 86_400_000;

const positiveInt = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export function quotaLimit(kind: UsageKind, env: NodeJS.ProcessEnv = process.env): number {
  return positiveInt(env[ENV[kind]], DEFAULTS[kind]);
}

/** 同一网络下所有账号当天的合计上限。 */
export function ipLimit(kind: UsageKind, env: NodeJS.ProcessEnv = process.env): number {
  return positiveInt(env[`QUOTA_IP_${kind.toUpperCase()}`], quotaLimit(kind, env) * IP_FACTOR[kind]);
}

/** 访客按网络每天的次数。 */
export function guestLimit(kind: GuestKind, env: NodeJS.ProcessEnv = process.env): number {
  return positiveInt(env[`QUOTA_${kind.toUpperCase()}_GUEST`], GUEST_DEFAULTS[kind]);
}

/** 新账号减半额度持续几天；0 表示关闭。 */
export function newAccountDays(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.QUOTA_NEW_ACCOUNT_DAYS);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_NEW_ACCOUNT_DAYS;
}

/** 这个账号今天的上限：注册不满 newAccountDays 天减半（向下取整，至少 1 次）。查不到注册时间按新账号算。 */
export function effectiveLimit(kind: UsageKind, createdAt: Date | null, now = new Date(), env: NodeJS.ProcessEnv = process.env): number {
  const base = quotaLimit(kind, env);
  const days = newAccountDays(env);
  const isNew = days > 0 && (!createdAt || now.getTime() - createdAt.getTime() < days * DAY_MS);
  return isNew ? Math.max(1, Math.floor(base / 2)) : base;
}

/** 北京时间日期 YYYY-MM-DD（en-CA 的日期格式正好是这个形式）。 */
export function usageDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
}

/** 落库用的网络标识：日期 + IP 的 HMAC。没有密钥时（本地开发、测试）用固定的本地值。 */
export function ipHash(ip: string, day: string, env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.IP_HASH_SECRET || env.BETTER_AUTH_SECRET || "sc-local-ip-hash";
  return createHmac("sha256", secret).update(`${day}|${ip}`).digest("base64url").slice(0, 32);
}

/** 同一网络当天的合计已满（个人额度还有剩余）。 */
export const NETWORK_LIMIT_MESSAGE = "今天同一网络下的使用次数已达上限，明天再来试试";
/** 访客当天按网络的对话次数已满。 */
export const GUEST_CHAT_LIMIT_MESSAGE = "今天的对话次数已用完，登录后可以继续";

export class QuotaError extends Error {
  status = 429;
  constructor(kind: UsageKind, limit: number, message = `今天的${LABEL[kind]}次数已用完（每天 ${limit} 次），明天再来试试`) {
    super(message);
  }
}

async function accountCreatedAt(userId: string): Promise<Date | null> {
  const rows = await db.select({ createdAt: schema.user.createdAt }).from(schema.user).where(eq(schema.user.id, userId)).limit(1);
  return rows[0]?.createdAt ?? null;
}

/** 按网络 +1；已到 limit 时不计、返回 false。表还没迁移时放行（返回 true）。 */
async function bumpIp(ipHashValue: string, day: string, kind: string, limit: number): Promise<boolean> {
  const c = schema.ipCounter;
  try {
    const rows = await db
      .insert(c)
      .values({ ipHash: ipHashValue, day, kind, count: 1 })
      .onConflictDoUpdate({
        target: [c.ipHash, c.day, c.kind],
        set: { count: sql`${c.count} + 1` },
        setWhere: sql`${c.count} < ${limit}`,
      })
      .returning({ count: c.count });
    return rows.length > 0;
  } catch (e) {
    if (isMissingTable(e)) {
      console.error("[quota] ip_counter 表不存在（迁移 0009 未执行），按网络的限额暂不生效");
      return true;
    }
    throw e;
  }
}

async function unbumpIp(ipHashValue: string, day: string, kind: string): Promise<void> {
  const c = schema.ipCounter;
  await db
    .update(c)
    .set({ count: sql`greatest(${c.count} - 1, 0)` })
    .where(and(eq(c.ipHash, ipHashValue), eq(c.day, day), eq(c.kind, kind)))
    .catch(() => {});
}

async function refundUser(userId: string, kind: UsageKind, day: string): Promise<void> {
  const c = schema.usageCounter;
  await db
    .update(c)
    .set({ count: sql`greatest(${c.count} - 1, 0)` })
    .where(and(eq(c.userId, userId), eq(c.day, day), eq(c.kind, kind)));
}

/**
 * 记一次调用；超过当日上限时抛 QuotaError（429），且不再增加计数。单条 upsert 原子完成：并发请求不会同时越过上限。
 * ip（lib/client-ip.ts clientIp）给出时，再计入同一网络当天的合计；合计已满时退回个人这次计数并抛 QuotaError。
 */
export async function consumeQuota(userId: string, kind: UsageKind, now = new Date(), ip: string | null = null): Promise<number> {
  const day = usageDay(now);
  const limit = effectiveLimit(kind, await accountCreatedAt(userId), now);
  const c = schema.usageCounter;
  const rows = await db
    .insert(c)
    .values({ userId, day, kind, count: 1 })
    .onConflictDoUpdate({
      target: [c.userId, c.day, c.kind],
      set: { count: sql`${c.count} + 1` },
      setWhere: sql`${c.count} < ${limit}`,
    })
    .returning({ count: c.count });
  if (!rows.length) throw new QuotaError(kind, limit);
  if (ip) {
    const max = ipLimit(kind);
    if (!(await bumpIp(ipHash(ip, day), day, kind, max))) {
      await refundUser(userId, kind, day);
      throw new QuotaError(kind, max, NETWORK_LIMIT_MESSAGE);
    }
  }
  return rows[0].count;
}

/** 今天还剩几次（只读，给界面显示；按个人额度，不含同一网络的合计；实际扣减仍以 consumeQuota 的原子判断为准）。 */
export async function quotaRemaining(userId: string, kind: UsageKind, now = new Date()): Promise<{ remaining: number; limit: number }> {
  const limit = effectiveLimit(kind, await accountCreatedAt(userId), now);
  const c = schema.usageCounter;
  const rows = await db
    .select({ count: c.count })
    .from(c)
    .where(and(eq(c.userId, userId), eq(c.day, usageDay(now)), eq(c.kind, kind)))
    .limit(1);
  return { remaining: Math.max(0, limit - (rows[0]?.count ?? 0)), limit };
}

/** 退回一次计数（调用在花钱之前就因校验失败被拒绝时用）；带 ip 时同一网络的合计一并退回。 */
export async function refundQuota(userId: string, kind: UsageKind, now = new Date(), ip: string | null = null): Promise<void> {
  const day = usageDay(now);
  await refundUser(userId, kind, day);
  if (ip) await unbumpIp(ipHash(ip, day), day, kind);
}

/** 访客记一次（按网络）；已满时抛 QuotaError（提示登录后继续）。拿不到 IP（本地开发）时不计。 */
export async function consumeGuestQuota(kind: GuestKind, ip: string | null, now = new Date()): Promise<void> {
  if (!ip) return;
  const day = usageDay(now);
  const limit = guestLimit(kind);
  if (!(await bumpIp(ipHash(ip, day), day, `guest:${kind}`, limit))) throw new QuotaError(kind, limit, GUEST_CHAT_LIMIT_MESSAGE);
}

export async function refundGuestQuota(kind: GuestKind, ip: string | null, now = new Date()): Promise<void> {
  if (!ip) return;
  const day = usageDay(now);
  await unbumpIp(ipHash(ip, day), day, `guest:${kind}`);
}

/**
 * 先扣额度再执行；执行中抛出 4xx 业务错误（未同意、缺照片、格式不对等，尚未调用付费服务）时退回这次计数，
 * 带 noCharge 标记的错误（全站每日总额已满，lib/spend.ts）同样退回。
 * 其余 5xx 与第三方失败不退回：宁可少给一次，也不让失败重试绕过上限。
 * opts.ip：请求方的网络（clientIp(req.headers)），计入同一网络的合计。
 */
export async function withQuota<T>(userId: string, kind: UsageKind, fn: () => Promise<T>, opts: { ip?: string | null } = {}): Promise<T> {
  const now = new Date();
  const ip = opts.ip ?? null;
  await consumeQuota(userId, kind, now, ip);
  try {
    return await fn();
  } catch (e) {
    const { status, noCharge } = (e ?? {}) as { status?: unknown; noCharge?: unknown };
    if (noCharge === true || (typeof status === "number" && status >= 400 && status < 500)) await refundQuota(userId, kind, now, ip).catch(() => {});
    throw e;
  }
}
