import { getCurrentUser } from "@/lib/auth";
import { getStorage, isValidKey } from "@/lib/storage";

// 读取本人的私有文件（照片、GLB）。key 必须以当前用户 id 为前缀，否则一律 404（不区分“不存在”与“无权限”）。
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const notFound = () => new Response("Not Found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  const user = await getCurrentUser();
  if (!user) return notFound();
  const { key: parts } = await params;
  let key: string;
  try {
    key = parts.map((p) => decodeURIComponent(p)).join("/");
  } catch {
    return notFound();
  }
  if (!isValidKey(key) || !key.startsWith(`${user.id}/`)) return notFound();
  const obj = await getStorage()
    .get(key)
    .catch(() => null);
  if (!obj) return notFound();
  return new Response(Buffer.from(obj.bytes), {
    headers: {
      "Content-Type": obj.contentType,
      "Content-Length": String(obj.bytes.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
