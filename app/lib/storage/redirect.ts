import type { StorageDriver } from "./types";

// Vercel 函数响应体上限 4.5 MB：2K 试穿图、3D 形象 GLB、14–17 MB 的 Live 视频都会超（D64）。
// Supabase 驱动时，私有文件路由在鉴权与归属校验之后不再经函数转发字节，而是 302 跳到短时签名链接；
// 本地驱动返回 null，由路由照旧直接返回字节。签名链接有效期限定在 60–300 秒，跳转响应本身不缓存。
export const SIGNED_URL_TTL = { file: 120, video: 300 } as const;

const NO_STORE = { "Cache-Control": "private, no-store" };
const clampTtl = (s: number) => Math.min(300, Math.max(60, Math.round(s)));

export async function signedRedirect(storage: StorageDriver, key: string, ttlSeconds: number): Promise<Response | null> {
  if (storage.kind !== "supabase") return null;
  // 对象不存在时 Supabase 拒绝签名，这里统一返回 404（与“无权限”不区分）。
  const url = await storage.signedUrl(key, clampTtl(ttlSeconds)).catch(() => null);
  if (!url) return new Response("Not Found", { status: 404, headers: NO_STORE });
  return new Response(null, {
    status: 302,
    headers: { ...NO_STORE, Location: url, "Referrer-Policy": "no-referrer" },
  });
}
