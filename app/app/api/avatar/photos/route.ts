import { json, readBodyLimited, withUser } from "@/lib/avatar/http";
import { MAX_PHOTO_BYTES } from "@/lib/avatar/image";
import { addPhoto, AvatarError } from "@/lib/avatar/service";

// 上传一张照片：multipart/form-data，字段 slot 与 file。slot：photos 模式 front|side|back；
// MetaPerson 模式 face|front|side（D56，需已同意由 MetaPerson 处理，照片自上传起保留 30 天）。
// 请求体在解析前限制为 8MB + 表单开销（含 chunked 上传）；服务端按文件头识别类型（JPG/PNG/WebP），
// 剥离 EXIF（含 GPS）等元数据后再存储，记录宽高与质量提示。
const BODY_LIMIT = MAX_PHOTO_BYTES + 64 * 1024;

export async function POST(req: Request) {
  return withUser(async (userId) => {
    const type = req.headers.get("content-type") ?? "";
    if (!type.toLowerCase().startsWith("multipart/form-data")) throw new AvatarError(400, "请用表单上传照片");
    const body = await readBodyLimited(req, BODY_LIMIT, "单张照片不能超过 8MB");
    const form = await new Response(Buffer.from(body), { headers: { "content-type": type } }).formData().catch(() => null);
    if (!form) throw new AvatarError(400, "请用表单上传照片");
    const slot = form.get("slot");
    const file = form.get("file");
    if (typeof slot !== "string" || !(file instanceof File)) throw new AvatarError(400, "缺少照片或位置");
    return json(await addPhoto(userId, slot, file), 201);
  });
}
