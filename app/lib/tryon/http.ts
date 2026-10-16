import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { AvatarError } from "@/lib/avatar/service";
import { TryonError } from "./fashn";

const NO_STORE = { "Cache-Control": "private, no-store" };

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

export const notFound = () => json({ error: "没有找到" }, 404);

// 未登录 401；业务错误按状态码返回中文说明；其他错误 500，不回显内部信息。
export async function withTryonUser(fn: (userId: string) => Promise<Response>): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return json({ error: "请先登录" }, 401);
  try {
    return await fn(user.id);
  } catch (e) {
    if (e instanceof TryonError || e instanceof AvatarError) return json({ error: e.message }, e.status);
    console.error("[tryon]", e instanceof Error ? e.message : "unknown error");
    return json({ error: "服务暂时不可用，请稍后再试" }, 500);
  }
}
