import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { AvatarError } from "./service";

const NO_STORE = { "Cache-Control": "private, no-store" };

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

// 统一：未登录 401；业务错误按 AvatarError.status；其他错误 500，不回显内部信息。
export async function withUser(fn: (userId: string) => Promise<Response>): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return json({ error: "请先登录" }, 401);
  try {
    return await fn(user.id);
  } catch (e) {
    if (e instanceof AvatarError) return json({ error: e.message }, e.status);
    console.error("[avatar]", e instanceof Error ? e.message : "unknown error");
    return json({ error: "服务暂时不可用，请稍后再试" }, 500);
  }
}
