import { json, readBodyLimited, withUser } from "@/lib/avatar/http";
import { AvatarError, importMetaperson } from "@/lib/avatar/service";

// 导入 MetaPerson 导出的形象：body { url, avatarCode }。
// 服务端立即下载导出文件（仅 https、主机白名单：avatarsdk.com 及子域 + AVATARSDK_EXPORT_HOSTS），
// 限制 100MB 并校验 GLB 头，存入私有存储并创建 succeeded 作业；返回最新的 AvatarState。
export async function POST(req: Request) {
  return withUser(async (userId) => {
    const raw = await readBodyLimited(req, 8 * 1024, "请求过大");
    let body: unknown = null;
    try {
      body = JSON.parse(Buffer.from(raw).toString("utf8"));
    } catch {
      body = null;
    }
    if (!body || typeof body !== "object") throw new AvatarError(400, "请求格式不对");
    const b = body as { url?: unknown; avatarCode?: unknown };
    return json(await importMetaperson(userId, { url: b.url, avatarCode: b.avatarCode }), 201);
  });
}
