import { sql } from "drizzle-orm";
import { db, schema } from "./db";
import { isMissingTable } from "./db/errors";
import { usageDay } from "./usage";

// 全站每日生成花费总闸（D75 防滥用第一批：平台承担费用，防止批量注册账号刷图把钱烧光）。
// - 调用付费出图模型前，按 lib/scene/image.ts 里的估价原子地累加到 spend_day（bucket = "all"）；
//   当日合计会超过 SPEND_DAILY_USD（默认 30 美元）时不累加、抛 BudgetError（503），本次不调用服务商。
// - 北京时间自然日重置（与每用户额度 lib/usage.ts 同一个“日”）。估价是保守估计，不是账单，实际以服务商后台为准。
// - 合计越过 50%、80% 时打一条 warn 日志，被总闸拒绝时打 error 日志（Vercel 日志可检索 “[spend]”）。
// - 表还没迁移（生产库未执行 0008）时放行并打 error 日志：总闸失效但不让已有功能整体报错。
// 接入（各自的估价常量写在调用处，并注明依据）：
//   出图（场景与姿势、上身效果）lib/scene/image.ts；2D 试穿每一段提交 lib/tryon/provider.ts；
//   数字分身每次生成（预留整次）lib/avatar/twin.ts；悬浮对话每次调用 Claude lib/chat/quota.ts（D76 第二批）。

export const DEFAULT_DAILY_USD = 30;

export function dailyBudgetMicro(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.SPEND_DAILY_USD);
  return Math.round((Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_USD) * 1_000_000);
}

export class BudgetError extends Error {
  status = 503;
  /** 尚未调用付费服务：withQuota 据此退回用户额度。 */
  noCharge = true;
  constructor() {
    super("今天的生成名额已经用完了，明天再来试试");
  }
}

/**
 * 预留一次调用的估算花费；超过当日总额时抛 BudgetError。单条 upsert 原子完成，并发请求不会一起越过总额。
 * service 只用于明细（例如 "scene:fal-ai/nano-banana-2.1/edit"）。
 */
export async function reserveSpend(service: string, microUsd: number, now = new Date()): Promise<void> {
  const budget = dailyBudgetMicro();
  const s = schema.spendDay;
  const day = usageDay(now);
  // 当天第一条走的是 insert（不经过 setWhere）：单次估价本身就超过总额时在这里拒绝。
  if (microUsd > budget) {
    console.error(`[spend] ${service} 单次估价超过每日总额 ${budget / 1_000_000} 美元`);
    throw new BudgetError();
  }
  let total: number;
  try {
    const rows = await db
      .insert(s)
      .values({ day, bucket: "all", microUsd, calls: 1 })
      .onConflictDoUpdate({
        target: [s.day, s.bucket],
        set: { microUsd: sql`${s.microUsd} + ${microUsd}`, calls: sql`${s.calls} + 1` },
        setWhere: sql`${s.microUsd} + ${microUsd} <= ${budget}`,
      })
      .returning({ microUsd: s.microUsd });
    if (!rows.length) {
      console.error(`[spend] ${day} 已达每日总额 ${budget / 1_000_000} 美元，拒绝 ${service}`);
      throw new BudgetError();
    }
    total = rows[0].microUsd;
  } catch (e) {
    if (e instanceof BudgetError) throw e;
    if (isMissingTable(e)) {
      console.error("[spend] spend_day 表不存在（迁移 0008 未执行），每日总额暂不生效");
      return;
    }
    throw e;
  }
  for (const pct of [50, 80]) {
    const line = (budget * pct) / 100;
    if (total >= line && total - microUsd < line) console.warn(`[spend] ${day} 估算花费已过 ${pct}%：${(total / 1_000_000).toFixed(2)} / ${budget / 1_000_000} 美元`);
  }
  await db
    .insert(s)
    .values({ day, bucket: service, microUsd, calls: 1 })
    .onConflictDoUpdate({ target: [s.day, s.bucket], set: { microUsd: sql`${s.microUsd} + ${microUsd}`, calls: sql`${s.calls} + 1` } })
    .catch(() => undefined);
}

/** 当日估算花费（百万分之一美元）；给测试与排查用。 */
export async function spentToday(now = new Date()): Promise<number> {
  const rows = await db
    .select({ microUsd: schema.spendDay.microUsd })
    .from(schema.spendDay)
    .where(sql`${schema.spendDay.day} = ${usageDay(now)} and ${schema.spendDay.bucket} = 'all'`);
  return rows[0]?.microUsd ?? 0;
}
