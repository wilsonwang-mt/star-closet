import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { MetapersonError } from "./metaperson";
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
    if (e instanceof AvatarError || e instanceof MetapersonError) return json({ error: e.message }, e.status);
    console.error("[avatar]", e instanceof Error ? e.message : "unknown error");
    return json({ error: "服务暂时不可用，请稍后再试" }, 500);
  }
}

/**
 * 在解析之前限制请求体大小：先看 Content-Length，再边读边数（覆盖 chunked 与谎报长度的请求），
 * 超过 limit 立即中止读取并抛 413，不会把超大请求体读进内存。
 */
export async function readBodyLimited(req: Request, limit: number, message: string): Promise<Uint8Array> {
  const declared = req.headers.get("content-length");
  if (declared && Number(declared) > limit) throw new AvatarError(413, message);
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw new AvatarError(413, message);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}
