// Route Handler 返回错误时用：按当前请求语言翻译中文提示（见 phrases/en.ts）。
//   return jsonError("请先登录", 401);
import { NextResponse } from "next/server";
import { localizeServer } from "./server";

export async function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ ...extra, error: await localizeServer(message) }, { status });
}
