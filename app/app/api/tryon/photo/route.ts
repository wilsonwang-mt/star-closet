import { readBodyLimited } from "@/lib/avatar/http";
import { MAX_PHOTO_BYTES } from "@/lib/avatar/image";
import { json, withTryonUser } from "@/lib/tryon/http";
import { TryonError, uploadFrontPhoto } from "@/lib/tryon/service";

// 在试穿卡里上传一张正面全身照：multipart/form-data 字段 file。请求体在解析前限制为 8MB + 表单开销；
// 服务端去元数据（EXIF/GPS 等）后存私有存储，作为正面照（3D 形象流程同样复用）。
const BODY_LIMIT = MAX_PHOTO_BYTES + 64 * 1024;

export async function POST(req: Request) {
  return withTryonUser(async (userId) => {
    const type = req.headers.get("content-type") ?? "";
    if (!type.toLowerCase().startsWith("multipart/form-data")) throw new TryonError(400, "请用表单上传照片");
    const body = await readBodyLimited(req, BODY_LIMIT, "照片不能超过 8MB");
    const form = await new Response(Buffer.from(body), { headers: { "content-type": type } }).formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new TryonError(400, "缺少照片");
    return json(await uploadFrontPhoto(userId, file), 201);
  });
}
