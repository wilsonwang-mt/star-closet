import { toNextJsHandler } from "better-auth/next-js";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { BOT_MESSAGE, isBotRequest } from "@/lib/botid";
import { localizeServer } from "@/lib/i18n/server";

const handler = toNextJsHandler(auth);

// 注册、登录先过 Vercel BotID（D76，见 lib/botid.ts）：防脚本批量注册账号刷额度。
// 被拒时按 better-auth 的错误格式返回 { code, message }，登录页按 code 显示“安全校验没有通过”。
const GUARDED = new Set(["/api/auth/sign-up/email", "/api/auth/sign-in/email"]);

export const GET = handler.GET;

export async function POST(req: Request) {
  if (GUARDED.has(new URL(req.url).pathname) && (await isBotRequest())) {
    return NextResponse.json({ code: "BOT_DETECTED", message: await localizeServer(BOT_MESSAGE) }, { status: 403 });
  }
  return handler.POST(req);
}
