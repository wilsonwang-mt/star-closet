import { BudgetError, reserveSpend } from "@/lib/spend";
import { consumeGuestQuota, consumeQuota, refundGuestQuota, refundQuota } from "@/lib/usage";

/**
 * 悬浮对话每次调用 Claude 的估价（用于全站每日总闸 lib/spend.ts，宁高勿低；以 Anthropic 账单为准再校正，
 * 每次调用的实际 token 数记在 “chat ok … tok=” 日志里）：
 * - 模型 Opus 5.5 fast mode（lib/chat/ai.ts）：输入 8、输出 40 美元 / 百万 token（标准速度 4 / 20 的 2 倍）；
 *   缓存读取为输入价的 0.1 倍（0.8），5 分钟缓存写入为 1.25 倍（10）。
 * - 系统提示（规则 + 完整目录）整块缓存：中文约 1.5 万字符（其中汉字 7.8 千）、英文约 4.2 万字符，按约 1.2 万 token 计。
 * - 命中缓存时：读缓存 1.2 万 × 0.8 ≈ 0.010；对话历史与附注不缓存，最多约 3 千 × 8 ≈ 0.024；
 *   输出（含思考，effort low）通常不超过 800 × 40 ≈ 0.032，合计约 0.066 美元。
 * - 5 分钟内每种语言的第一次要写缓存，多约 1.2 万 × (10 − 0.8) ≈ 0.11 美元；输出上限 max_tokens 2048 时输出约 0.082。
 * 按 0.08 美元 / 次记：只看对话的话，30 美元的总闸一天约放行 375 次。
 */
export const CHAT_CALL_MICRO_USD = 80_000;

/**
 * 悬浮对话调用 Claude 之前（D76）：登录用户扣个人额度（并计入同一网络的合计），访客按网络扣访客额度，
 * 再向全站每日总闸预留这次的估价。额度用完抛 QuotaError（429，界面把提示显示成这一轮的回复）；
 * 总闸已满时退回刚扣的额度并返回 false，调用方改用规则层回复（不花钱；界面不提示“规则模式”，D48）。
 */
export async function chargeChat(userId: string | null, ip: string | null, now = new Date()): Promise<boolean> {
  if (userId) await consumeQuota(userId, "chat", now, ip);
  else await consumeGuestQuota("chat", ip, now);
  try {
    await reserveSpend("chat:claude", CHAT_CALL_MICRO_USD, now);
    return true;
  } catch (e) {
    if (userId) await refundQuota(userId, "chat", now, ip).catch(() => {});
    else await refundGuestQuota("chat", ip, now).catch(() => {});
    if (e instanceof BudgetError) return false;
    throw e;
  }
}
