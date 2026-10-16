import { getCurrentUser } from "@/lib/auth";
import { readSceneVideo } from "@/lib/scene/service";

// 本人上身效果的 Live 视频。支持 Range（iOS Safari 播放视频必须），他人或不存在一律 404。
const ID_RE = /^[0-9a-f-]{36}$/;
const HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes" };

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const notFound = () => new Response("Not Found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  const user = await getCurrentUser();
  if (!user) return notFound();
  const { id } = await params;
  if (!ID_RE.test(id)) return notFound();
  const obj = await readSceneVideo(user.id, id).catch(() => null);
  if (!obj) return notFound();
  const size = obj.bytes.byteLength;
  const range = req.headers.get("range");
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { ...HEADERS, "Content-Range": `bytes */${size}` } });
    }
    start = Math.max(0, start);
    return new Response(Buffer.from(obj.bytes.subarray(start, end + 1)), {
      status: 206,
      headers: { ...HEADERS, "Content-Type": "video/mp4", "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}` },
    });
  }
  return new Response(Buffer.from(obj.bytes), { headers: { ...HEADERS, "Content-Type": "video/mp4", "Content-Length": String(size) } });
}
