import { checkBotId } from "botid/server";
import { NextResponse } from "next/server";
import { localizeServer } from "@/lib/i18n/server";

// Vercel BotID（D76）：注册、登录与付费接口先确认请求来自真实浏览器，再做登录、额度与总闸判断。
// - 受保护的路径见 lib/botid-routes.ts；浏览器端由 instrumentation-client.ts 的 initBotId 给这些请求带上挑战结果。
// - 只在 Vercel 上检查（VERCEL=1）：本地 next dev 下 checkBotId 本来就放行，但本地 next start（production 构建、不在 Vercel）
//   时它会因为拿不到 x-vercel-oidc-token 而抛错，所以不在 Vercel 时直接跳过。BOTID=off 可临时关闭（浏览器端需重新构建才不再加挑战）。
// - 检查级别跟随 Vercel 项目的 BotID 设置（默认 Basic，免费；Deep Analysis 在 Pro 上每 1000 次 1 美元）。
//   客户端与服务端都不写 checkLevel：两边写的不一致会导致校验失败，交给后台统一切换。
// - checkBotId 自身出错（OIDC 未开启、网络问题）时放行并打 error 日志：只在明确判定为机器人时拒绝，
//   其后还有每人额度、同一网络合计与全站总闸兜底，不因为 BotID 故障让全站付费功能不可用。

export const BOT_MESSAGE = "安全校验没有通过，请刷新页面后再试";

type Checker = () => Promise<{ isBot: boolean }>;

export function botIdEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL === "1" && env.BOTID !== "off";
}

/** true：判定为机器人，应拒绝。check 可替换（测试用）。 */
export async function isBotRequest(check: Checker = checkBotId, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (!botIdEnabled(env)) return false;
  try {
    return (await check()).isBot === true;
  } catch (e) {
    console.error("[botid] 校验出错，本次放行：", e instanceof Error ? e.message : "unknown error");
    return false;
  }
}

/** 付费接口用：机器人返回 403（{ error }，按当前语言），否则返回 null 继续处理。 */
export async function rejectBot(check?: Checker): Promise<Response | null> {
  if (!(await isBotRequest(check))) return null;
  return NextResponse.json({ error: await localizeServer(BOT_MESSAGE) }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
}
