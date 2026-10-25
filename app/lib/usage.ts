import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "./db";

// 每用户每日调用上限（D64 防滥用与花费上限）。计数存数据库表 usage_counter（迁移 0006），按北京时间自然日重置。
// 默认值可用环境变量覆盖（正整数；填错或不填用默认值）：
//   QUOTA_ADAPT=100       一句话改编（调用 Claude）
//   QUOTA_TRYON=60        试衣间逐件试穿、预热、整套试穿、详情页一键试穿（共用一个额度）
//   QUOTA_SCENE=20        场景出图（D75）：商品详情页上身效果每次 1 次；场景与姿势、封面换成我每张 1 次
//   QUOTA_TWIN=10         数字分身生成
//   QUOTA_BODY_ANALYSIS=20 体型分析（调用 Claude）
export type UsageKind = "adapt" | "tryon" | "scene" | "twin" | "body_analysis";

const DEFAULTS: Record<UsageKind, number> = { adapt: 100, tryon: 60, scene: 20, twin: 10, body_analysis: 20 };
const ENV: Record<UsageKind, string> = {
  adapt: "QUOTA_ADAPT",
  tryon: "QUOTA_TRYON",
  scene: "QUOTA_SCENE",
  twin: "QUOTA_TWIN",
  body_analysis: "QUOTA_BODY_ANALYSIS",
};
const LABEL: Record<UsageKind, string> = {
  adapt: "改编",
  tryon: "试穿",
  scene: "场景图",
  twin: "数字分身生成",
  body_analysis: "体型分析",
};

export function quotaLimit(kind: UsageKind, env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env[ENV[kind]]);
  return Number.isInteger(n) && n > 0 ? n : DEFAULTS[kind];
}

/** 北京时间日期 YYYY-MM-DD（en-CA 的日期格式正好是这个形式）。 */
export function usageDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
}

export class QuotaError extends Error {
  status = 429;
  constructor(kind: UsageKind, limit: number) {
    super(`今天的${LABEL[kind]}次数已用完（每天 ${limit} 次），明天再来试试`);
  }
}

/**
 * 记一次调用；超过当日上限时抛 QuotaError（429），且不再增加计数。
 * 单条 upsert 原子完成：并发请求不会同时越过上限。
 */
export async function consumeQuota(userId: string, kind: UsageKind, now = new Date()): Promise<number> {
  const limit = quotaLimit(kind);
  const c = schema.usageCounter;
  const rows = await db
    .insert(c)
    .values({ userId, day: usageDay(now), kind, count: 1 })
    .onConflictDoUpdate({
      target: [c.userId, c.day, c.kind],
      set: { count: sql`${c.count} + 1` },
      setWhere: sql`${c.count} < ${limit}`,
    })
    .returning({ count: c.count });
  if (!rows.length) throw new QuotaError(kind, limit);
  return rows[0].count;
}

/** 今天还剩几次（只读，给界面显示；实际扣减仍以 consumeQuota 的原子判断为准）。 */
export async function quotaRemaining(userId: string, kind: UsageKind, now = new Date()): Promise<{ remaining: number; limit: number }> {
  const limit = quotaLimit(kind);
  const c = schema.usageCounter;
  const rows = await db
    .select({ count: c.count })
    .from(c)
    .where(and(eq(c.userId, userId), eq(c.day, usageDay(now)), eq(c.kind, kind)))
    .limit(1);
  return { remaining: Math.max(0, limit - (rows[0]?.count ?? 0)), limit };
}

/** 退回一次计数（调用在花钱之前就因校验失败被拒绝时用）。 */
export async function refundQuota(userId: string, kind: UsageKind, now = new Date()): Promise<void> {
  const c = schema.usageCounter;
  await db
    .update(c)
    .set({ count: sql`greatest(${c.count} - 1, 0)` })
    .where(and(eq(c.userId, userId), eq(c.day, usageDay(now)), eq(c.kind, kind)));
}

/**
 * 先扣额度再执行；执行中抛出 4xx 业务错误（未同意、缺照片、格式不对等，尚未调用付费服务）时退回这次计数，
 * 带 noCharge 标记的错误（全站每日总额已满，lib/spend.ts）同样退回。
 * 其余 5xx 与第三方失败不退回：宁可少给一次，也不让失败重试绕过上限。
 */
export async function withQuota<T>(userId: string, kind: UsageKind, fn: () => Promise<T>): Promise<T> {
  const now = new Date();
  await consumeQuota(userId, kind, now);
  try {
    return await fn();
  } catch (e) {
    const { status, noCharge } = (e ?? {}) as { status?: unknown; noCharge?: unknown };
    if (noCharge === true || (typeof status === "number" && status >= 400 && status < 500)) await refundQuota(userId, kind, now).catch(() => {});
    throw e;
  }
}
