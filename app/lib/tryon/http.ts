import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { AvatarError } from "@/lib/avatar/service";
import { localizeServer } from "@/lib/i18n/server";
import { BudgetError } from "@/lib/spend";
import { QuotaError } from "@/lib/usage";
import { TryonError } from "./fashn";

const NO_STORE = { "Cache-Control": "private, no-store" };

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

/** 错误响应：中文提示按当前请求语言翻译（lib/i18n/phrases），同样不缓存。 */
export async function jsonError(message: string, status: number) {
  return json({ error: await localizeServer(message) }, status);
}

export const notFound = () => jsonError("没有找到", 404);

// 未登录 401；业务错误（含额度 429、全站每日总额已满 503）按状态码返回说明（按请求语言翻译）；其他错误 500，不回显内部信息。
export async function withTryonUser(fn: (userId: string) => Promise<Response>): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return jsonError("请先登录", 401);
  try {
    return await fn(user.id);
  } catch (e) {
    if (e instanceof TryonError || e instanceof AvatarError || e instanceof QuotaError || e instanceof BudgetError) return jsonError(e.message, e.status);
    console.error("[tryon]", e instanceof Error ? e.message : "unknown error");
    return jsonError("服务暂时不可用，请稍后再试", 500);
  }
}
